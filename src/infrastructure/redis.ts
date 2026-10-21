import { env } from "../config/env.js";
import { createClient } from "redis";

const redisUrl = env.redisUrl;

if (!redisUrl) {
  throw new Error("REDIS_URL is not configured");
}

const redis = createClient({ url: redisUrl });

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

export { redis };