import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "../../src/config/redis.js";
import { buildRateLimitKey } from "../../src/rate-limit/key.js";
import { rateLimitPolicies } from "../../src/rate-limit/policies.js";
import { RedisRateLimitService } from "../../src/rate-limit/redis-service.js";
import { randomUUID } from "crypto";

const clientIp = "203.0.113.50";
const policy = rateLimitPolicies.default;

describe("RedisRateLimitService", () => {
  let prefix: string;
  beforeAll(async () => {
    if (!redis.isOpen) {
      await redis.connect();
    }
  });

  beforeEach(async () => {
    prefix = `rl:test:service:${randomUUID()}`;
    vi.stubEnv("REDIS_KEY_PREFIX", prefix);
    const key = buildRateLimitKey(prefix, policy.id, clientIp);
    await redis.del(key);
  });

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }
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

  // limited enforcement 
  it("allows requests up to the limit and rejects the next request", async () => {
    const service = new RedisRateLimitService();
    const input = {
      clientIp,
      policy,
      limit: 2,
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

  // expired timestamp cleanup
  it("removes expired timestamps before checking the limit", async () => {
    const prefix = process.env.REDIS_KEY_PREFIX;
    if (!prefix) {
      throw new Error("REDIS_KEY_PREFIX is not configured");
    }

    const key = buildRateLimitKey(prefix, policy.id, clientIp);
    const now = Date.now();
    const testPolicy = {
      ...policy,
      windowMs: 60 * 1000,
    };

    await redis.zAdd(key, {
      score: now - 120000,
      value: `expired-request`,
    });
    await redis.zAdd(key, {
      score: now - 1000,
      value: `valid-request`,
    });

    const service = new RedisRateLimitService();
    await expect(service.check({
      clientIp,
      policy: testPolicy,
      limit: 2,
    })).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
    });

    const members = await redis.zRange(key, 0, -1);

    expect(members).toHaveLength(2);
    expect(members).not.toContain(`expired-request`);
    expect(members).toContain(`valid-request`);

  });

  // independent ips
  it("keeps request logs independent for different IPs", async () => {
    const prefix = process.env.REDIS_KEY_PREFIX;
    if (!prefix) {
      throw new Error("REDIS_KEY_PREFIX is not configured");
    }

    const ip1 = clientIp;
    const ip2 = "203.0.113.51";

    const key1 = buildRateLimitKey(prefix, policy.id, ip1);
    const key2 = buildRateLimitKey(prefix, policy.id, ip2);
    await redis.del(key1);
    await redis.del(key2);

    const service = new RedisRateLimitService();
    const input1 = {
      clientIp: ip1,
      policy,
      limit: 1,
    };
    const input2 = {
      clientIp: ip2,
      policy,
      limit: 1,
    };

    await expect(service.check(input1)).resolves.toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
    });
    await expect(service.check(input1)).resolves.toEqual({
      allowed: false,
      limit: 1,
      remaining: 0,
    });
    await expect(service.check(input2)).resolves.toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
    });
    await redis.del(key2);
  });

  // concurrent requests
  it("enforces the limit for concurrent requests", async () => {
    const prefix = process.env.REDIS_KEY_PREFIX;
    if (!prefix) {
      throw new Error("REDIS_KEY_PREFIX is not configured");
    }

    const key = buildRateLimitKey(prefix, policy.id, clientIp);
    await redis.del(key);

    const service = new RedisRateLimitService();
    const input = {
      clientIp,
      policy,
      limit: 3,
    };

    const promises = Array.from({ length: 10 }, () => service.check(input));
    const results = await Promise.all(promises);

    const allowed = results.filter((result) => result.allowed);
    const rejected = results.filter((result) => !result.allowed);

    expect(allowed).toHaveLength(3);
    expect(rejected).toHaveLength(7);

    const storedRequests = await redis.zCard(key);
    expect(storedRequests).toBe(3);
  });

  // rejected requests aren't recorded
  it("does not record rejected requests", async () => {
    const prefix = process.env.REDIS_KEY_PREFIX;
    if (!prefix) {
      throw new Error("REDIS_KEY_PREFIX is not configured");
    }

    const key = buildRateLimitKey(prefix, policy.id, clientIp);
    await redis.del(key);

    const service = new RedisRateLimitService();
    const input = {
      clientIp,
      policy,
      limit: 1,
    };

    await expect(service.check(input)).resolves.toEqual({
      allowed: true,
      limit: 1,
      remaining: 0,
    });

    const membersBefore = await redis.zRange(key, 0, -1);
    expect(membersBefore).toHaveLength(1);

    await expect(service.check(input)).resolves.toEqual({
      allowed: false,
      limit: 1,
      remaining: 0,
    });
    const membersAfter = await redis.zRange(key, 0, -1);
    expect(membersAfter).toEqual(membersBefore);
  });
});