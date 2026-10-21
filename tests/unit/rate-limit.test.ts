import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createRateLimit } from "../../src/rate-limit/middleware.js";
import type { RateLimitPolicy } from "../../src/rate-limit/types.js";
import { rateLimitPolicies } from "../../src/rate-limit/policies.js";

function setup(policy: RateLimitPolicy = rateLimitPolicies.default, authenticated = false) {
  const request = {
    ip: "203.0.113.50",
    ...(authenticated ? { auth: { clientId: "client-123" } } : {}),
  } as Request;
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
  const next = vi.fn();
  const service = {
    check: vi.fn().mockResolvedValue({ allowed: true, limit: 100, remaining: 99 }),
  };
  return { request, response, next, service, middleware: createRateLimit(service, policy) };
}

function expectNoResponse(response: Response) {
  expect(response.status).not.toHaveBeenCalled();
  expect(response.json).not.toHaveBeenCalled();
}

describe("createRateLimit", () => {
  it.each([
    { count: 1, remaining: 99 },
    { count: 100, remaining: 0 },
  ])("allows request $count with a limit of 100", async ({ remaining }) => {
    const { request, response, next, service, middleware } = setup();
    service.check.mockResolvedValue({ allowed: true, limit: 100, remaining });

    await middleware(request, response, next);

    expect(next).toHaveBeenCalledExactlyOnceWith();
    expectNoResponse(response);
    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: request.ip, policy: rateLimitPolicies.default, limit: 100, overrideClientId: undefined,
    });
  });

  it("rejects request 101 with a limit of 100", async () => {
    const { request, response, next, service, middleware } = setup();
    service.check.mockResolvedValue({ allowed: false, limit: 100, remaining: 0 });

    await middleware(request, response, next);

    expect(response.status).toHaveBeenCalledExactlyOnceWith(429);
    expect(response.json).toHaveBeenCalledExactlyOnceWith({
      error: "rate_limit_exceeded",
      message: "Too many requests. Please try again later.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    { name: "authenticated default", policy: rateLimitPolicies.default, authenticated: true, limit: 200, overrideClientId: "client-123" },
    { name: "unauthenticated default", policy: rateLimitPolicies.default, authenticated: false, limit: 100, overrideClientId: undefined },
    { name: "authenticated login", policy: rateLimitPolicies.login, authenticated: true, limit: 20, overrideClientId: undefined },
    { name: "unauthenticated login", policy: rateLimitPolicies.login, authenticated: false, limit: 10, overrideClientId: undefined },
  ])("passes the exact service input for $name", async ({ policy, authenticated, limit, overrideClientId }) => {
    const { request, response, next, service, middleware } = setup(policy, authenticated);

    await middleware(request, response, next);

    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: request.ip, policy, limit, overrideClientId,
    });
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expectNoResponse(response);
  });

  it("uses the supplied policy values", async () => {
    const policy = { id: "custom", windowMs: 5000, limits: { authenticated: 7, unauthenticated: 3 } };
    const { request, response, next, service, middleware } = setup(policy);

    await middleware(request, response, next);

    expect(service.check).toHaveBeenCalledExactlyOnceWith({
      clientIp: request.ip, policy, limit: 3, overrideClientId: undefined,
    });
  });

  it("throws a service error without sending a response or calling next", async () => {
    const { request, response, next, service, middleware } = setup();
    const error = new Error("Redis unavailable");
    service.check.mockRejectedValue(error);

    await expect(middleware(request, response, next)).rejects.toBe(error);

    expect(next).not.toHaveBeenCalled();
    expectNoResponse(response);
  });

  it("throws for a missing IP without checking the service or sending a response", async () => {
    const { response, next, service, middleware } = setup();

    await expect(middleware({} as Request, response, next))
      .rejects.toThrow("Unable to determine client IP address");

    expect(service.check).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expectNoResponse(response);
  });
});
