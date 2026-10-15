import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  authenticate,
  requireAuthentication,
} from "../../src/middleware/authenticate.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authenticate", () => {
  it.each([
    {
      name: "valid key",
      header: "Bearer test-key",
      expectedAuth: { clientId: "client-123" },
    },
    {
      name: "incorrect key",
      header: "Bearer wrong-key",
      expectedAuth: undefined,
    },
    {
      name: "missing header",
      header: undefined,
      expectedAuth: undefined,
    },
    {
      name: "unsupported authentication scheme",
      header: "Basic test-key",
      expectedAuth: undefined,
    },
    {
      name: "empty bearer token",
      header: "Bearer ",
      expectedAuth: undefined,
    },
  ])("$name", ({ header, expectedAuth }) => {
    // Arrange
    vi.stubEnv("DEMO_API_KEY", "test-key");
    vi.stubEnv("DEMO_CLIENT_ID", "client-123");

    const request = {
      header: vi.fn().mockReturnValue(header),
    } as unknown as Request;

    // authenticate currently does not use the response.
    const response = {} as Response;
    const next = vi.fn();

    // Act
    authenticate(request, response, next);

    // Assert
    expect(request.header).toHaveBeenCalledWith("authorization");
    expect(request.auth).toEqual(expectedAuth);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(["DEMO_API_KEY", "DEMO_CLIENT_ID"])(
    "leaves the request anonymous when %s is missing",
    (variable) => {
      vi.stubEnv("DEMO_API_KEY", "test-key");
      vi.stubEnv("DEMO_CLIENT_ID", "client-123");
      vi.stubEnv(variable, undefined);

      const request = {
        header: vi.fn().mockReturnValue("Bearer test-key"),
      } as unknown as Request;
      const next = vi.fn();

      authenticate(request, {} as Response, next);

      expect(request.auth).toBeUndefined();
      expect(next).toHaveBeenCalledExactlyOnceWith();
    },
  );
});

describe("requireAuthentication", () => {
  it("continues when the request is authenticated", () => {
    const request = {
      auth: { clientId: "client-123" },
    } as Request;

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAuthentication(request, response, next);

    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it("returns 401 without continuing when authentication is missing", () => {
    const request = {} as Request;
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    requireAuthentication(request, response, next);

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      error: "authentication_required",
      message: "A valid API key is required for this endpoint.",
    });
    expect(next).not.toHaveBeenCalled();
  });
});