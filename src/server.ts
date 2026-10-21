import { env } from "./config/env.js";
import { app } from "./app.js";
import { redis } from "./infrastructure/redis.js";

const port = env.port;

try {
  await redis.connect();

  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
    console.log("Connected to Redis");
  });
} catch (error) {
  console.error("Unable to start the API:", error);
  process.exit(1);
}