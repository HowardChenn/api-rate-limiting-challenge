# API Rate Limiter

An Express and TypeScript API with Redis-backed rate limiting. A Sliding Window Log tracks requests by client IP and endpoint policy. API-key authentication selects higher limits, and temporary Redis overrides can raise an authenticated client's default-policy limit.

## Local setup

Prerequisites: Node.js 22.12+ in the 22.x series, Node.js 24.x, or Node.js 26+, npm, and Docker with Docker Compose. These versions match the installed Vitest dependency's Node.js requirements.

Run commands from the repository root (`api rate limiting challenge/`), the directory containing `package.json` and `compose.yaml`.

Install dependencies and create your environment file on first setup:

```bash
npm ci
cp .env.example .env
```

For subsequent runs, keep your existing `.env`. Edit it to replace the example API key with a local demo key. Start Redis with Docker running:

```bash
docker compose up -d
docker compose exec redis redis-cli ping
```

Redis should respond with `PONG`. Start the API:

```bash
npm run dev
```

The API listens on `http://localhost:3000` by default. Redis runs in Docker; the API runs locally.

## Environment variables

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listening port; defaults to 3000. |
| `REDIS_URL` | `redis://localhost:6379` | Required Redis connection URL. |
| `REDIS_KEY_PREFIX` | `rl:v1` | Required namespace for request logs and overrides. |
| `DEMO_API_KEY` | `replace-with-your-local-demo-key` | Valid bearer token for demo authentication. |
| `DEMO_CLIENT_ID` | `demo-client` | Trusted internal ID assigned to the authenticated client. |

Authentication requires both demo authentication variables to be configured. Send the API key as `Authorization: Bearer <key>`. Missing or invalid keys leave the request unauthenticated. The client ID comes from server configuration, rather than from a client-supplied ID.

Restart the API after changing `.env`. The file is excluded by `.gitignore`; `.env.example` supplies the configuration template.

## Policies and endpoints

Both policies use a rolling one-hour window.

| Policy | Anonymous limit | Authenticated limit | Requests |
|---|---:|---:|---|
| `default` | 100 | 200 | All requests outside the login policy. |
| `login` | 10 | 20 | `POST /api/login`, including casing and trailing-slash variants. |

| Endpoint | Behaviour |
|---|---|
| `GET /api/products` | Public endpoint returning products and authentication status. |
| `GET /api/account` | Requires a valid API key; returns the authenticated client ID. |
| `POST /api/login` | Placeholder endpoint subject to the strict login policy. |

Authentication runs before rate limiting. The account access check runs afterward, so unauthorized account requests also consume the applicable rate-limit allowance. The login endpoint is a placeholder and does not implement user login.

Configure limit values and window lengths in [src/rate-limit/policies.ts](src/rate-limit/policies.ts). Endpoint selection is defined by `selectPolicy` in [src/middleware/rate-limit.ts](src/middleware/rate-limit.ts). Adding another endpoint policy requires updating both. These settings are source configuration, rather than environment variables.

The request flow is:

```text
Request → API-key authentication → Rate-limit middleware → Route handler → Response
                                      ↓
                              Redis Lua decision
```

## API examples

Replace `YOUR_LOCAL_DEMO_KEY` with the key configured in `.env`. These examples use the default port; update the URLs if you change `PORT`.

Anonymous products request:

```bash
curl -i http://localhost:3000/api/products
```

Successful response body:

```json
{"products":[],"authenticated":false}
```

Authenticated products request:

```bash
curl -i -H "Authorization: Bearer YOUR_LOCAL_DEMO_KEY" http://localhost:3000/api/products
```

Successful response body:

```json
{"products":[],"authenticated":true}
```

Authenticated account request:

```bash
curl -i -H "Authorization: Bearer YOUR_LOCAL_DEMO_KEY" http://localhost:3000/api/account
```

With the example client ID, the successful response body is:

```json
{"clientId":"demo-client"}
```

Missing or invalid account authentication returns HTTP `401` while within the applicable rate limit. If that limit is already exhausted, the middleware returns `429` before the account access check:

```json
{
  "error": "authentication_required",
  "message": "A valid API key is required for this endpoint."
}
```

Anonymous login request:

```bash
curl -i -X POST http://localhost:3000/api/login
```

Successful response body:

```json
{"message":"Login endpoint placeholder"}
```

The configured number of requests is allowed; the next request returns HTTP `429`. For example, an anonymous login request is rejected after ten allowed login requests within the rolling hour:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again later."
}
```

## Redis keys and temporary overrides

Request logs are sorted sets keyed by policy and client IP:

```text
{prefix}:{policyId}:{clientIp}
rl:v1:default:203.0.113.50
rl:v1:login:203.0.113.50
```

Each allowed request stores a unique UUID member with its timestamp as the score. Requests from the same IP share a log within a policy, including anonymous and authenticated requests. Authentication changes the limit, not the request-log identity. Different endpoints using the default policy share its allowance for the same IP.

For example, after 100 anonymous products requests from one IP, another anonymous request is blocked. An authenticated request from that IP can still proceed under the ceiling of 200, but it uses the same existing history and has at most 100 additional slots. Login requests use a separate policy log.

Override keys belong to authenticated client IDs:

```text
{prefix}:override:{clientId}
rl:v1:override:demo-client
```

To give the example client an absolute default-policy limit of 500 for 60 seconds:

```bash
docker compose exec redis redis-cli SET rl:v1:override:demo-client 500 EX 60
```

Use the prefix and client ID configured in your `.env`. `EX 60` expires the override key after 60 seconds. The value replaces the normal ceiling when higher; it does not add 500 requests or reset the request log.

Create temporary overrides with `EX` or `PX`. Expiry comes from the Redis key's TTL; a value set without a TTL remains active until removed.

The override applies only to its matching authenticated client's default-policy requests. Anonymous requests and login requests cannot use it. A valid override must be a whole number higher than the normal limit and at most **1000**, inclusive. Missing, expired, nonnumeric, fractional, above-1000, or equal/lower values retain the normal limit. Once an override expires, existing timestamps still count; a client already above its normal limit is blocked until enough timestamps leave the window.

For the normal authenticated default limit of 200, overrides of `500` and `1000` are accepted; `1001`, `500.5`, and `200` are ignored. The Lua script validates the override within the same atomic operation that checks and records requests. The cap applies to overrides; normal policy limits remain configured in `src/rate-limit/policies.ts`.

| Override value | Effective default limit |
|---|---:|
| `500` | 500 |
| `1000` | 1000 |
| `1001`, `500.5`, or nonnumeric text | 200 |
| `200`, a lower value, or a missing/expired key | 200 |

Inspect or remove the example override:

```bash
docker compose exec redis redis-cli TTL rl:v1:override:demo-client
docker compose exec redis redis-cli DEL rl:v1:override:demo-client
```

## Sliding Window Log and Lua

For each check, the service supplies the current time, window, normal limit, unique request ID, and override eligibility to Redis. A Lua script performs these steps atomically:

1. Read an eligible override and select the effective limit.
2. Remove timestamps at or before the window's start.
3. Count the remaining entries.
4. Reject if the count has reached the limit.
5. Otherwise, record the new request and refresh the log's expiry.

Rejected requests are not recorded. The log expires after a window without an allowed request. Atomic execution prevents concurrent checks from reading the same available slot and collectively exceeding the limit.

A Sliding Window Log provides an exact count for the rolling window using the supplied timestamps. A fixed window can permit a burst across a reset boundary. A sliding-window counter uses less storage but approximates the count using time buckets. The log trades more Redis memory and per-request work for precise rolling-window enforcement.

## Tests

Redis must be running for integration tests. Supertest runs the imported Express app, so a separate development server is unnecessary.

Set up `.env` before running the tests. Middleware unit tests import the Redis client configuration and require `REDIS_URL`, although they use a fake service and do not connect to Redis.

```bash
docker compose up -d
npm test
```

Watch mode:

```bash
npm run test:watch
```

Run individual suites:

```bash
npm test -- tests/unit/key.test.ts
npm test -- tests/unit/rate-limit.test.ts
npm test -- tests/integration/redis-rate-limit-service.test.ts
npm test -- tests/integration/http-rate-limit.test.ts
npm test -- tests/integration/temporary-override.test.ts
```

| Suite | Tests | Coverage |
|---|---:|---|
| Key unit tests | 2 | Request and override key formats. |
| Middleware unit tests | 5 | Allowed/rejected paths, policy selection, and override client ID forwarding. |
| Redis integration tests | 5 | Limit enforcement, expired-entry cleanup, independent IPs, concurrency, and unchanged entries after rejection. |
| HTTP integration tests | 9 | Anonymous/authenticated limits, invalid keys, account access, and the rate-limit response. |
| Override integration tests | 12 | Matching and different clients, anonymous/login exclusions, missing/expired overrides, malformed/lower values, accepted limits of 500 and 1000, and rejected values of 1001 and 500.5. |

Integration suites assign a unique `rl:test:*` prefix per test, remove their own keys afterward, and restore environment variables. HTTP authentication tests use stubbed test credentials.

The latest verification on 11 October 2026 passed `npm run build` and all **33 tests across five files**. The build checks and compiles `src/`; Vitest runs the tests, but test files are not included in the build's TypeScript checking.

## Build and Docker commands

Compile TypeScript and run the compiled API:

```bash
npm run build
npm start
```

Inspect or stop Redis:

```bash
docker compose logs redis
docker compose down
```

The Compose configuration has no persistent volume. Removing and recreating the Redis container resets its local request logs and overrides.

## Troubleshooting

| Symptom | What to check |
|---|---|
| `REDIS_URL is not configured` | Create `.env` on first setup and run commands from the repository root (`api rate limiting challenge/`). |
| Redis connection errors or test hook timeouts | Start Docker and Redis, confirm `redis-cli ping` returns `PONG`, and check `REDIS_URL`. |
| Requests return `429` sooner than expected | Prior allowed requests from the same IP and policy still count. Wait for them to leave the window; removing an override does not clear the request history. |
| An API key is treated as anonymous | Match `DEMO_API_KEY` exactly, configure `DEMO_CLIENT_ID`, and send `Authorization: Bearer <key>`. |
| The HTTP port is in use | Stop the other server or change `PORT`, restart the API, and update your request URLs. |

## Scope and trade-offs

- One sorted-set entry is stored per allowed request until it ages out or the log expires, so Redis memory use grows with active traffic and IPs.
- Limits are keyed by IP and policy. Clients sharing an IP also share request counts, even when their authentication differs.
- This demo supports one configured API key and internal client ID. Overrides are managed directly in Redis.
- The implementation targets standalone Redis. Its Lua script accesses two keys without Redis Cluster hash tags.
- Time comes from the API process. Multiple API instances would require consistent clocks.
- Express uses its default proxy-trust setting. Deployment behind a proxy requires an explicit trusted-proxy configuration to obtain the intended client IP safely.
- Redis errors are forwarded to Express error handling; the API does not implement a custom outage response or rate-limit retry headers.
- The Redis client retries connections by default. Redis outages can delay startup or requests; explicit timeouts and outage behaviour would be needed for production use.
- Global middleware also counts requests that later return `401` or `404`. Rate limiting can reject them before those responses are produced.
- Integration cleanup uses Redis `KEYS` for a unique test prefix on the local instance. For a large shared Redis instance, use `SCAN` or tracked key cleanup.
- The server does not implement graceful shutdown to drain HTTP requests and explicitly close Redis.

## Project structure

```text
src/
  app.ts
  server.ts
  config/redis.ts
  middleware/authenticate.ts
  middleware/rate-limit.ts
  rate-limit/key.ts
  rate-limit/policies.ts
  rate-limit/redis-service.ts
  rate-limit/service.ts
  rate-limit/types.ts
  types/express.d.ts
tests/
  unit/
  integration/
```
