import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.js";
import { redis } from "../../src/infrastructure/redis.js";

describe("HTTP rate limiting", () => {
  let prefix: string;
  beforeAll(async () => {
    if (!redis.isOpen) {
      await redis.connect();
    }
  });

  beforeEach(() => {
    prefix = `rl:test:http:${randomUUID()}`;
    vi.stubEnv("REDIS_KEY_PREFIX", prefix);
    vi.stubEnv("DEMO_API_KEY", "test-api-key");
    vi.stubEnv("DEMO_CLIENT_ID", "test-client");
  });

  afterEach(async () => {
    try {
      const keys = await redis.keys(`${prefix}:*`);

      if (keys.length > 0) {
        await redis.del(keys);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  afterAll(async () => {
    if (redis.isOpen) {
      await redis.quit();
    }
  });

  // anonymous requests GET /api/products (NO API KEY PROVIDED)
  it("allows 100 anonymous products requests and rejects the next", async () => {
    for (let count = 0; count < 100; count++) {
      const response = await request(app).get("/api/products");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        products: [],
        authenticated: false,
      });
    }

    const blockedResponse = await request(app).get("/api/products");

    expect(blockedResponse.status).toBe(429);
  });

  // authenticated requests GET /api/products
  it("allows 200 authenticated products requests and rejects the next", async () => {
    for (let count = 0; count < 200; count++) {
      const response = await request(app).get("/api/products")
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        products: [],
        authenticated: true,
      });
    }

    const blockedResponse = await request(app).get("/api/products")
      .set("Authorization", "Bearer test-api-key");

    expect(blockedResponse.status).toBe(429);
  });

  // anonymous requests POST /api/login
  it("allows 10 anonymous login requests and rejects the next", async () => {
    for (let count = 0; count < 10; count++) {
      const response = await request(app).post("/api/login");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: "Login endpoint placeholder",
      });
    }

    const blockedResponse = await request(app).post("/api/login");

    expect(blockedResponse.status).toBe(429);
  });

  // authenticated requests POST /api/login
  it("allows 20 authenticated login requests and rejects the next", async () => {
    for (let count = 0; count < 20; count++) {
      const response = await request(app).post("/api/login")
        .set("Authorization", "Bearer test-api-key");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: "Login endpoint placeholder",
      });
    }

    const blockedResponse = await request(app).post("/api/login")
      .set("Authorization", "Bearer test-api-key");

    expect(blockedResponse.status).toBe(429);
  });

  // failed auth GET /api/products - wrong api key
  it("treats an invalid API key as anonymous for products requests", async () => {
    for (let count = 0; count < 100; count++) {
      const response = await request(app).get("/api/products")
        .set("Authorization", "Bearer wrong-api-key");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        products: [],
        authenticated: false,
      });
    }

    const blockedResponse = await request(app).get("/api/products")
      .set("Authorization", "Bearer wrong-api-key");

    expect(blockedResponse.status).toBe(429);
  });

  // authenticated requests GET /api/account
  it("allows authenticated requests to access the account", async () => {
    const response = await request(app).get("/api/account")
      .set("Authorization", "Bearer test-api-key");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      clientId: "test-client",
    });
  });

  // failed auth GET /api/account - wrong api key 
  it("rejects account access with an invalid API key", async () => {
    const response = await request(app).get("/api/account")
      .set("Authorization", "Bearer wrong-api-key");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "authentication_required",
      message: "A valid API key is required for this endpoint.",
    });
  });

  // failed auth GET /api/account - missing key 
  it("rejects account access without an API key", async () => {
    const response = await request(app).get("/api/account");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "authentication_required",
      message: "A valid API key is required for this endpoint.",
    });
  });

  // rate limit response format 
  it("returns the expected JSON body when rate limited", async () => {
    for (let count = 0; count < 10; count++) {
      const response = await request(app).post("/api/login");

      expect(response.status).toBe(200);
    }

    const response = await request(app).post("/api/login");

    expect(response.status).toBe(429);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({
      error: "rate_limit_exceeded",
      message: "Too many requests. Please try again later.",
    });
  });

  // override 
});