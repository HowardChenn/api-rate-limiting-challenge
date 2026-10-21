import type { NextFunction, Request, Response } from "express";
import type { RateLimitPolicy, RateLimitService } from "./types.js";

function createRateLimit(service: RateLimitService, policy: RateLimitPolicy) {
  return async function rateLimit(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const clientIp = request.ip;
    if (!clientIp) {
      throw new Error("Unable to determine client IP address");
    }

    const limit = request.auth
      ? policy.limits.authenticated
      : policy.limits.unauthenticated;
    const overrideClientId = policy.id === "default" ? request.auth?.clientId : undefined;

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
  };
}

export { createRateLimit };
