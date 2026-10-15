# API Rate Limiter

Express and TypeScript middleware using a Redis Sliding Window Log, API-key authentication, and temporary limit overrides.

## Commands

Requires Node.js 22.12+ in the 22.x series, 24.x, or 26+, npm, and Docker with Docker Compose. Run from the repository root (the folder containing `package.json`).

**First setup and development server**

```bash
npm ci
# First setup only: keep your existing .env on subsequent runs.
cp .env.example .env

docker compose up -d
docker compose exec redis redis-cli ping  # Expect PONG
npm run dev
```

**API examples — run in another terminal**

Run these from the repository root. Load your `.env` in this terminal so authenticated requests use your configured `DEMO_API_KEY`. The commands assume port `3000`, prefix `rl:v1`, and client ID `demo-client`; update those if your `.env` differs.

```bash
# Load the API key from your local configuration.
source .env

# Products: anonymous and authenticated
curl -i http://localhost:3000/api/products
curl -i -H "Authorization: Bearer ${DEMO_API_KEY}" http://localhost:3000/api/products

# Account: authenticated, missing key, and invalid key
curl -i -H "Authorization: Bearer ${DEMO_API_KEY}" http://localhost:3000/api/account
curl -i http://localhost:3000/api/account
curl -i -H 'Authorization: Bearer wrong-api-key' http://localhost:3000/api/account

# Login: anonymous and authenticated
curl -i -X POST http://localhost:3000/api/login
curl -i -X POST -H "Authorization: Bearer ${DEMO_API_KEY}" http://localhost:3000/api/login

# Exceed the anonymous login limit (earlier requests also count).
# With an empty login log: ten 200 responses, then 429.
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/login
done

# Raise demo-client's default-policy ceiling to 500 for 60 seconds.
docker compose exec redis redis-cli SET rl:v1:override:demo-client 500 EX 60
curl -i -H "Authorization: Bearer ${DEMO_API_KEY}" http://localhost:3000/api/products

# Inspect expiry, then remove the override.
docker compose exec redis redis-cli TTL rl:v1:override:demo-client
docker compose exec redis redis-cli DEL rl:v1:override:demo-client
```

**Tests**

Run commands from the folder containing `package.json`. A separate API server is unnecessary; HTTP integration tests exercise the Express app directly through Supertest.

| Tests | Requirements |
|---|---|
| Authentication and key unit tests | No running Redis or `.env` file required. Authentication tests supply and restore their own environment values. |
| Rate-limit middleware unit tests | `REDIS_URL` must be configured through `.env` or the environment because importing the middleware loads Redis configuration. The tests use a fake service and do not connect to Redis. |
| Integration tests | A running Redis instance and `REDIS_URL` pointing to it. Tests supply their own key prefixes and authentication values where needed. |

```bash
# Unit tests only (no running Redis required)
npm test -- tests/unit

# Integration tests or the full suite (configure REDIS_URL first)
docker compose up -d
npm test -- tests/integration
npm test

# Watch all tests (same requirements as the full suite)
npm run test:watch

# Individual suites
npm test -- tests/unit/authenticate.test.ts
npm test -- tests/unit/key.test.ts
npm test -- tests/unit/rate-limit.test.ts
npm test -- tests/integration/redis-rate-limit-service.test.ts
npm test -- tests/integration/http-rate-limit.test.ts
npm test -- tests/integration/temporary-override.test.ts
```

Vitest runs the tests without full TypeScript type checking. `npm run build` type-checks and compiles application source only; the current `tsconfig.json` does not include test files. Passing tests therefore does not guarantee that test files have no TypeScript errors.

**Build and Redis management**

```bash
npm run build
npm start  # Use instead of the development server.

docker compose logs redis
docker compose down
```

## Configuration

`.env` is ignored by Git. `.env.example` provides working local demo values. Restart the API after changing configuration.

| Variable | Example value | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL. |
| `REDIS_KEY_PREFIX` | `rl:v1` | Namespace for request logs and overrides. |
| `DEMO_API_KEY` | `local-demo-key` | Demo bearer token. |
| `DEMO_CLIENT_ID` | `demo-client` | Client ID assigned after valid authentication. |

Both authentication variables must be configured. `local-demo-key` is a public demo value; use a separate key for any nonlocal deployment.

## Policies and request flow

Both policies use a rolling one-hour window.

| Policy | Anonymous | Authenticated | Routes |
|---|---:|---:|---|
| Default | 100 | 200 | Products, account, and other requests outside the login policy. |
| Login | 10 | 20 | Login POST requests, including casing and trailing-slash variants. |

Authentication identifies the client first. Rate limiting then selects the policy and limit, asks Redis for a decision, and either returns `429` or continues to the route.

- Products returns an empty product list and authentication status.
- Account requires authentication and returns the client ID. Missing or invalid keys return `401` if rate limiting allows the request; otherwise they return `429` first.
- Login is a placeholder, not a user-login implementation.

Request logs use `{prefix}:{policyId}:{clientIp}`. Products and account share the default log for an IP. Anonymous and authenticated requests also share that log; authentication changes the ceiling rather than resetting the count. Requests allowed by rate limiting count even if the route later returns `401` or `404`.

## Redis and overrides

Each allowed request adds a unique member and timestamp to a Redis sorted set. The Lua script reads an eligible override, removes expired timestamps, checks the count, and records the request atomically. This prevents concurrent requests from claiming the same available slot. Rejected requests are not recorded.

The Sliding Window Log gives an exact rolling count, at the cost of storing one entry per allowed request. Logs expire after a window without an allowed request.

Overrides use `{prefix}:override:{clientId}` and apply only to that authenticated client's default-policy requests. The middleware passes the eligible client ID; the Lua script validates and applies the override.

An override must be an integer above the normal limit and no higher than 1000. For a normal limit of 200, `500` and `1000` work; `200`, `1001`, `500.5`, and nonnumeric values are ignored. Use an expiry when creating overrides. Expiry restores the normal ceiling without clearing request history.

## Structure and tests

| File or folder | Role |
|---|---|
| `src/server.ts` | Connects Redis and starts the HTTP server. |
| `src/app.ts` | Registers middleware and routes. |
| `src/config/redis.ts` | Creates the shared Redis client. |
| `src/middleware/authenticate.ts` | Identifies authenticated clients and provides the account access check. |
| `src/middleware/rate-limit.ts` | Selects policies, chooses limits, and handles the decision. |
| `src/rate-limit/policies.ts` | Defines policy values. |
| `src/rate-limit/types.ts` | Defines policy and decision shapes. |
| `src/rate-limit/service.ts` | Defines the check input and service interface. |
| `src/rate-limit/redis-service.ts` | Implements the check using Redis and Lua. |
| `src/rate-limit/key.ts` | Builds request-log and override keys. |
| `src/types/express.d.ts` | Adds optional authentication data to Express's request type. |
| `tests/unit/` | Checks authentication, protected-route access, key formats, and rate-limit middleware using a fake service. |
| `tests/integration/` | Checks Redis behaviour, HTTP responses, concurrency, and overrides. |

The service interface lets rate-limit middleware tests substitute a fake implementation. Authentication unit tests cover valid, invalid, missing, and malformed credentials, missing configuration, and protected-route access. Integration tests use unique Redis prefixes and clean up their keys.

## Local scope

This demo uses one API key and standalone Redis. Shared IPs share allowances. Production deployment would need explicit proxy trust, outage handling, graceful shutdown, and consistent clocks across API instances. Redis Cluster would require compatible key placement. The local Compose setup has no persistent volume, so recreating Redis resets logs and overrides.
