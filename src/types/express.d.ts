declare global {
  namespace Express {
    interface Request {
      auth?: {
        clientId: string;
      };
    }
  }
}

export {};