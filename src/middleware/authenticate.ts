import "dotenv/config";
import type { NextFunction, Request, Response } from "express";

function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const authorization = request.header("authorization");
  const providedKey = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  const expectedKey = process.env.DEMO_API_KEY;
  const clientId = process.env.DEMO_CLIENT_ID;

  if (providedKey && expectedKey && clientId && providedKey === expectedKey) {
    request.auth = { clientId };
  }

  next();
}

function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!request.auth) {
    response.status(401).json({
      error: "authentication_required",
      message: "A valid API key is required for this endpoint.",
    });

    return;
  }

  next();
}

export { authenticate, requireAuthentication };