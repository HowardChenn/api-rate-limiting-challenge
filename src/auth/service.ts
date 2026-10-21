import { env } from "../config/env.js";
import type { AuthenticatedClient } from "./types.js";

function authenticateApiKey(authorization: string | undefined): AuthenticatedClient | undefined {
  const providedKey = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  const expectedKey = env.demoApiKey;
  const clientId = env.demoClientId;

  if (providedKey && expectedKey && clientId && providedKey === expectedKey) {
    return { clientId };
  }

  return undefined;
}

export { authenticateApiKey };
