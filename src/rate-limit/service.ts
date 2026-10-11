import type {
  RateLimitDecision,
  RateLimitPolicy,
} from "./types.js";

type RateLimitCheck = {
  clientIp: string;
  policy: RateLimitPolicy;
  limit: number;
  overrideClientId?: string;
};

interface RateLimitService {
  check(input: RateLimitCheck): Promise<RateLimitDecision>;
}

export type { RateLimitCheck, RateLimitService };