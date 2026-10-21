import express from "express";
import type { Request } from "express";
import { authenticate, requireAuthentication } from "./auth/middleware.js";
import { createRateLimit } from "./rate-limit/middleware.js";
import { rateLimitPolicies } from "./rate-limit/policies.js";
import { RedisRateLimitService } from "./rate-limit/redis-service.js";
import type { RateLimitPolicy, RateLimitService } from "./rate-limit/types.js";

function selectPolicy(request: Request): RateLimitPolicy {
  const path = request.path.toLowerCase().replace(/\/$/, "");
  return request.method === "POST" && path === "/api/login"
    ? rateLimitPolicies.login
    : rateLimitPolicies.default;
}

function createApp(rateLimitService: RateLimitService = new RedisRateLimitService()) {
  const app = express();
  const defaultLimiter = createRateLimit(rateLimitService, rateLimitPolicies.default);
  const loginLimiter = createRateLimit(rateLimitService, rateLimitPolicies.login);

  app.use(authenticate);
  app.use((request, response, next) => {
    const limiter = selectPolicy(request) === rateLimitPolicies.login
      ? loginLimiter
      : defaultLimiter;
    return limiter(request, response, next);
  });

  app.get("/api/products", (request, response) => {
    response.status(200).json({
      products: [],
      authenticated: Boolean(request.auth),
    });
  });

  app.get("/api/account", requireAuthentication, (request, response) => {
    response.status(200).json({ clientId: request.auth?.clientId });
  });

  app.post("/api/login", (_request, response) => {
    response.status(200).json({ message: "Login endpoint placeholder" });
  });

  return app;
}

const app = createApp();

export { app, createApp, selectPolicy };
