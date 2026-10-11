import type { RateLimitPolicy } from "./types.js";

const oneHourMs = 60 * 60 * 1000;

const rateLimitPolicies = {
  default: {
    id: "default",
    windowMs: oneHourMs,
    limits: {
      unauthenticated: 100,
      authenticated: 200,
    },
  },
  login: {
    id: "login",
    windowMs: oneHourMs,
    limits: {
      unauthenticated: 10,
      authenticated: 20,
    },
  },
} satisfies Record<string, RateLimitPolicy>;

export { rateLimitPolicies };