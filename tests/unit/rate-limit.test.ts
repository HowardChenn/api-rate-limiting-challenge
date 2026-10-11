import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createRateLimit } from "../../src/middleware/rate-limit.js";
import type { RateLimitService } from "../../src/rate-limit/service.js";
import { rateLimitPolicies } from "../../src/rate-limit/policies.js";

describe("createRateLimit", () => {
  it("calls next when the request is allowed", async () => {
    const mockNext = vi.fn();

    const mockRequest = {
      ip: "203.0.113.50",
      method: "GET",
      path: "/api/products",
    } as unknown as Request;

    const mockResponse = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as Response;

    const mockRateLimitService: RateLimitService = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
      }),
    };

    const rateLimitMiddleware = createRateLimit(mockRateLimitService);

    await rateLimitMiddleware(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledWith();
    expect(mockResponse.status).not.toHaveBeenCalled();
    expect(mockResponse.json).not.toHaveBeenCalled();
  });

  it("returns 429 when the request is rejected", async () => {
    const mockNext = vi.fn();

    const mockRequest = {
      ip: "203.0.113.50",
      method: "GET",
      path: "/api/products",
    } as unknown as Request;

    const mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const mockRateLimitService: RateLimitService = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        limit: 100,
        remaining: 0,
      }),
    };

    const rateLimitMiddleware = createRateLimit(mockRateLimitService);

    await rateLimitMiddleware(mockRequest, mockResponse, mockNext);

    expect(mockResponse.status).toHaveBeenCalledTimes(1);
    expect(mockResponse.status).toHaveBeenCalledWith(429);
    expect(mockResponse.json).toHaveBeenCalledTimes(1);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: "rate_limit_exceeded",
      message: "Too many requests. Please try again later.",
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("passes the client ID for an authenticated default request", async () => {
    const mockNext = vi.fn();

    const mockRequest = {
      ip: "203.0.113.50",
      method: "GET",
      path: "/api/products",
      auth: {
        clientId: "client-123",
      },
    } as unknown as Request;

    const mockResponse = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as Response;

    const mockRateLimitService: RateLimitService = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 200,
        remaining: 199,
      }),
    };

    const rateLimitMiddleware = createRateLimit(mockRateLimitService);

    await rateLimitMiddleware(mockRequest, mockResponse, mockNext);

    expect(mockRateLimitService.check).toHaveBeenCalledTimes(1);
    expect(mockRateLimitService.check).toHaveBeenCalledWith({
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 200,
      overrideClientId: "client-123",
    });
  });

  it("does not pass an override client ID for an authenticated login request", async () => {
    const mockNext = vi.fn();

    const mockRequest = {
      ip: "203.0.113.50",
      method: "POST",
      path: "/api/login",
      auth: {
          clientId: "client-123",
      },
    } as unknown as Request;

    const mockResponse = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as Response;

    const mockRateLimitService: RateLimitService = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 20,
        remaining: 19,
      }),
    };

    const rateLimitMiddleware = createRateLimit(mockRateLimitService);

    await rateLimitMiddleware(mockRequest, mockResponse, mockNext);

    expect(mockRateLimitService.check).toHaveBeenCalledTimes(1);
    expect(mockRateLimitService.check).toHaveBeenCalledWith({
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.login,
      limit: 20,
      overrideClientId: undefined,
    });
  });

  it("uses the anonymous default limit without an override client ID", async () => {
    const mockNext = vi.fn();

    const mockRequest = {
      ip: "203.0.113.50",
      method: "GET",
      path: "/api/products",
    } as unknown as Request;

    const mockResponse = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as Response;

    const mockRateLimitService: RateLimitService = {
      check: vi.fn().mockResolvedValue({
        allowed: true,
        limit: 100,
        remaining: 99,
      }),
    };

    const rateLimitMiddleware = createRateLimit(mockRateLimitService);

    await rateLimitMiddleware(mockRequest, mockResponse, mockNext);

    expect(mockRateLimitService.check).toHaveBeenCalledTimes(1);
    expect(mockRateLimitService.check).toHaveBeenCalledWith({
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 100,
      overrideClientId: undefined,
    });
  });
});
