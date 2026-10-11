import "dotenv/config";
import { app } from "./app.js";
import { redis } from "./config/redis.js";

const port = Number(process.env.PORT ?? 3000);

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