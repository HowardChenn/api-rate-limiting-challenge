import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { ErrorRequestHandler, Request } from "express";
import { createApp, selectPolicy } from "../../src/app.js";
import { createRateLimit } from "../../src/rate-limit/middleware.js";
import { rateLimitPolicies } from "../../src/rate-limit/policies.js";

// App wiring tests inject a fake service and never load Redis configuration.
vi.mock("../../src/rate-limit/redis-service.js", () => ({
  RedisRateLimitService: class {},
}));
vi.mock("../../src/rate-limit/middleware.js", { spy: true });

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function setup() {
  vi.stubEnv("DEMO_API_KEY", "test-key");
  vi.stubEnv("DEMO_CLIENT_ID", "client-123");
  const service = {
    check: vi.fn().mockResolvedValue({ allowed: true, limit: 100, remaining: 99 }),
  };
  return { app: createApp(service), service };
}

describe("app policy wiring", () => {
  it("creates one limiter for each policy with the supplied service", () => {
    vi.mocked(createRateLimit).mockClear();
    const { service } = setup();

    expect(createRateLimit).toHaveBeenCalledTimes(2);
    expect(createRateLimit).toHaveBeenNthCalledWith(1, service, rateLimitPolicies.default);
    expect(createRateLimit).toHaveBeenNthCalledWith(2, service, rateLimitPolicies.login);
  });

  it.each([
    { method: "GET", path: "/api/products", policy: rateLimitPolicies.default, status: 200 },
    { method: "POST", path: "/api/login", policy: rateLimitPolicies.login, status: 200 },
    { method: "POST", path: "/API/LOGIN", policy: rateLimitPolicies.login, status: 200 },
    { method: "POST", path: "/api/login/", policy: rateLimitPolicies.login, status: 200 },
    { method: "GET", path: "/api/login", policy: rateLimitPolicies.default, status: 404 },
    { method: "GET", path: "/unknown", policy: rateLimitPolicies.default, status: 404 },
    { method: "POST", path: "/api/login/other", policy: rateLimitPolicies.default, status: 404 },
  ])("selects and applies the correct policy once for $method $path", async ({ method, path, policy, status }) => {
    const { app, service } = setup();
    expect(selectPolicy({ method, path } as Request)).toBe(policy);

    const response = await (method === "POST" ? request(app).post(path) : request(app).get(path));

    expect(response.status).toBe(status);
    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: expect.any(String), policy, limit: policy.limits.unauthenticated, overrideClientId: undefined,
    });
  });

  it.each([
    { path: "/api/products", login: false, policy: rateLimitPolicies.default, limit: 200, overrideClientId: "client-123" },
    { path: "/api/login", login: true, policy: rateLimitPolicies.login, limit: 20, overrideClientId: undefined },
  ])("authenticates before checking the limit for $path", async ({ path, login, policy, limit, overrideClientId }) => {
    const { app, service } = setup();
    const response = await (login ? request(app).post(path) : request(app).get(path))
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(200);
    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: expect.any(String), policy, limit, overrideClientId,
    });
  });

  it("checks the default limit before requiring account authentication", async () => {
    const { app, service } = setup();
    const response = await request(app).get("/api/account");

    expect(response.status).toBe(401);
    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: expect.any(String), policy: rateLimitPolicies.default, limit: 100, overrideClientId: undefined,
    });
  });

  it("lets Express forward a thrown service error to error middleware", async () => {
    const { app, service } = setup();
    const error = new Error("Redis unavailable");
    service.check.mockRejectedValue(error);
    const handleError = vi.fn<ErrorRequestHandler>((_error, _request, response, _next) => {
      response.status(500).json({ error: "internal_error" });
    });
    app.use(handleError);

    const response = await request(app).get("/api/products");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "internal_error" });
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(handleError.mock.calls[0]?.[0]).toBe(error);
  });
});
