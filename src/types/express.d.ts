import type { AuthenticatedClient } from "../auth/types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedClient;
    }
  }
}

export {};