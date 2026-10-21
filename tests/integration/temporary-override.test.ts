import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { redis } from "../../src/infrastructure/redis.js";
import { buildRateLimitKey, buildRateLimitOverrideKey } from "../../src/rate-limit/key.js";
import { rateLimitPolicies } from "../../src/rate-limit/policies.js";
import { RedisRateLimitService } from "../../src/rate-limit/redis-service.js";
import request from "supertest";
import { app } from "../../src/app.js";

describe("temporary overrides", () => {
  let prefix: string;
  beforeAll(async () => {
    if (!redis.isOpen) {
      await redis.connect();
    }
  });

  beforeEach(() => {
    prefix = `rl:test:override:${randomUUID()}`;
    vi.stubEnv("REDIS_KEY_PREFIX", prefix);
  });

  afterEach(async () => {
    try {
      const keys = await redis.keys(`${prefix}:*`);

      if (keys.length > 0) {
        await redis.del(keys);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }
  });

  // override value acceptance
  it.each([500, 1000])("accepts and enforces an integer override of %i", async (limit) => {
    const clientIp = "203.0.113.50";
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    const requestKey = buildRateLimitKey(prefix, rateLimitPolicies.default.id, clientIp);
    await redis.set(overrideKey, limit.toString(), { EX: 60 });
    const now = Date.now();
    await redis.zAdd(requestKey, Array.from({ length: limit - 1 }, (_, index) => ({
      score: now,
      value: `existing-request-${index}`,
    })));

    const service = new RedisRateLimitService();
    const input = {
      clientIp,
      policy: rateLimitPolicies.default,
      limit: 200,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit,
      remaining: 0,
    });
    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit,
      remaining: 0,
    });
    expect(await redis.zCard(requestKey)).toBe(limit);
  });

  // override value rejection
  it.each(["1001", "500.5"])("ignores the invalid override %s and enforces the normal limit", async (value) => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, value, { EX: 60 });
    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });
    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });
    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });

  // matching client
  it("raises the limit for the matching authenticated client", async () => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "3", { EX: 60 });

    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 3,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 3,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
    });
  });

  // different client 
  it("does not apply another client's override", async () => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "3", { EX: 60 });

    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-b",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });

  // anonymous request
  it("does not apply an override to anonymous requests", async () => {
    vi.stubEnv("DEMO_API_KEY", "test-api-key");
    vi.stubEnv("DEMO_CLIENT_ID", "client-a");

    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "500", { EX: 60 });

    for (let count = 0; count < 100; count++) {
      const response = await request(app).get("/api/products");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        products: [],
        authenticated: false,
      });
    }

    const blockedResponse = await request(app).get("/api/products");

    expect(blockedResponse.status).toBe(429);
  });
  
  // login request - no override 
  it("does not apply a default override to authenticated login requests", async () => {
    vi.stubEnv("DEMO_API_KEY", "test-api-key");
    vi.stubEnv("DEMO_CLIENT_ID", "client-a");

    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "500", { EX: 60 });

    for (let count = 0; count < 20; count++) {
      const response = await request(app).post("/api/login")
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: "Login endpoint placeholder",
      });
    }

    const blockedResponse = await request(app).post("/api/login")
      .set("Authorization", "Bearer test-api-key");

    expect(blockedResponse.status).toBe(429);
  });
  
  // missing override
  it("uses the normal limit when the override is missing", async () => {
    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });

  // expired override
  it("uses the normal limit when the override has expired", async () => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "3", { EX: 60 });
    await redis.expireAt(overrideKey, Math.floor(Date.now() / 1000) - 1);

    expect(await redis.exists(overrideKey)).toBe(0);

    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });
  
  // malformed override
  it("ignores a malformed override value", async () => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "not-a-number", { EX: 60 });

    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });

  // lower limit override
  it("ignores an override lower than the normal limit", async () => {
    const overrideKey = buildRateLimitOverrideKey(prefix, "client-a");
    await redis.set(overrideKey, "1", { EX: 60 });

    const service = new RedisRateLimitService();
    const input = {
      clientIp: "203.0.113.50",
      policy: rateLimitPolicies.default,
      limit: 2,
      overrideClientId: "client-a",
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
    });
  });
});


