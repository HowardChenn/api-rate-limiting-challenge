import { authenticateApiKey } from "./service.js";
import type { NextFunction, Request, Response } from "express";

function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  request.auth = authenticateApiKey(request.header("authorization"));

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
