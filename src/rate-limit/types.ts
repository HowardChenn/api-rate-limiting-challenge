type RateLimitPolicy = {
  id: string;
  windowMs: number;
  limits: {
    unauthenticated: number;
    authenticated: number;
  };
};

type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
};

type RateLimitCheck = {
  clientIp: string;
  policy: RateLimitPolicy;
  limit: number;
  overrideClientId?: string;
};

interface RateLimitService {
  check(input: RateLimitCheck): Promise<RateLimitDecision>;
}

export type { RateLimitDecision, RateLimitPolicy, RateLimitCheck, RateLimitService };
