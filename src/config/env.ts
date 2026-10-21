import "dotenv/config";

// Read on access so test configuration remains isolated.
const env = {
  get port() { return Number(process.env.PORT ?? 3000); },
  get redisUrl() { return process.env.REDIS_URL; },
  get redisKeyPrefix() { return process.env.REDIS_KEY_PREFIX; },
  get demoApiKey() { return process.env.DEMO_API_KEY; },
  get demoClientId() { return process.env.DEMO_CLIENT_ID; },
};

export { env };
