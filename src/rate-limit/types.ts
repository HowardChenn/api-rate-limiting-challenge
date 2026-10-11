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

export type { RateLimitDecision, RateLimitPolicy };