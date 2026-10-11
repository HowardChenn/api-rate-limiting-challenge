import { redis } from "../config/redis.js";
import { buildRateLimitKey, buildRateLimitOverrideKey } from "./key.js";
import type { RateLimitCheck, RateLimitService } from "./service.js";
import type { RateLimitDecision } from "./types.js";
import { randomUUID } from "node:crypto";

const slidingWindowLogScript = `
  local key = KEYS[1]
  local overrideKey = KEYS[2]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local requestId = ARGV[4]
  local windowStart = now - windowMs
  local overrideEligible = tonumber(ARGV[5]) == 1

  local effectiveLimit = limit
  if overrideEligible then
    local override_limit = tonumber(redis.call("GET", overrideKey)) or 0
    if override_limit > limit and override_limit <= 1000 and override_limit == math.floor(override_limit) then
      effectiveLimit = override_limit
    end
  end

  redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)

  local requestCount = redis.call("ZCARD", key)

  if requestCount >= effectiveLimit then
    return { 0, requestCount, effectiveLimit }
  end

  redis.call("ZADD", key, now, requestId)
  redis.call("PEXPIRE", key, windowMs)

  return { 1, requestCount + 1, effectiveLimit }
`;

class RedisRateLimitService implements RateLimitService {
    async check(input: RateLimitCheck): Promise<RateLimitDecision> {
        const prefix = process.env.REDIS_KEY_PREFIX;

        if (!prefix) {
            throw new Error("REDIS_KEY_PREFIX is not configured");
        }

        const key1 = buildRateLimitKey(
            prefix,
            input.policy.id,
            input.clientIp,
        );
        
        const key2 = buildRateLimitOverrideKey(
            prefix,
            input.overrideClientId ?? "",
        );

        const result = await redis.eval(slidingWindowLogScript, {
            keys: [key1, key2],
            arguments: [
                Date.now().toString(),
                input.policy.windowMs.toString(),
                input.limit.toString(),
                randomUUID(),
                input.policy.id === "default" && input.overrideClientId ? "1" : "0"
            ],
        });

        const [allowedFlag, requestCount, effectiveLimit] = result as [number, number, number];

        return {
            allowed: allowedFlag === 1,
            limit: effectiveLimit,
            remaining: Math.max(effectiveLimit - requestCount, 0),
        };
    }
}

export { RedisRateLimitService };
