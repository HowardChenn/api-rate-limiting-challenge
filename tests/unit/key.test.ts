import { describe, it, expect } from "vitest";
import { buildRateLimitKey, buildRateLimitOverrideKey } from "../../src/rate-limit/key.js";

describe("buildRateLimitKey", () => {
  it("combines the prefix, policy, and client IP", () => {
    const prefix = "rl:test";
    const policyId = "default";
    const clientIp = "203.0.113.50";
    const result = buildRateLimitKey(prefix, policyId, clientIp);
    expect(result).toBe("rl:test:default:203.0.113.50");
  });
});

describe("buildRateLimitOverrideKey", () => {
  it("combines the prefix and override client ID", () => {
    const prefix = "rl:test";
    const overrideClientId = "client-123";
    const result = buildRateLimitOverrideKey(prefix, overrideClientId);
    expect(result).toBe("rl:test:override:client-123");
  });
});