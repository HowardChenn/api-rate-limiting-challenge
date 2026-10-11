import type { NextFunction, Request, Response } from "express";
import { rateLimitPolicies } from "../rate-limit/policies.js";
import { RedisRateLimitService } from "../rate-limit/redis-service.js";
import type { RateLimitPolicy } from "../rate-limit/types.js";
import type { RateLimitService } from "../rate-limit/service.js";

const rateLimitService = new RedisRateLimitService();

function selectPolicy(request: Request): RateLimitPolicy {
  const path = request.path.toLowerCase().replace(/\/$/, "");
  if (request.method === "POST" && path === "/api/login") {
    return rateLimitPolicies.login;
  }

  return rateLimitPolicies.default;
}

function createRateLimit(service: RateLimitService) {
  return async function rateLimit(
      request: Request,
      response: Response,
      next: NextFunction,
    ): Promise<void> {
    try {
        const clientIp = request.ip;
        if (!clientIp) {
            throw new Error("Unable to determine client IP address");
        }

        const policy = selectPolicy(request);
        const limit = request.auth
            ? policy.limits.authenticated
            : policy.limits.unauthenticated;

        const overrideClientId = request.auth?.clientId && policy.id === "default" ? request.auth?.clientId : undefined;

        const decision = await service.check({
            clientIp,
            policy,
            limit,
            overrideClientId,
        });

        if (!decision.allowed) {
            response.status(429).json({
                error: "rate_limit_exceeded",
                message: "Too many requests. Please try again later.",
            });

            return;
        }

        next();
    } catch (error) {
        next(error);
    }
  };
}

const rateLimit = createRateLimit(rateLimitService);

export { createRateLimit, rateLimit };