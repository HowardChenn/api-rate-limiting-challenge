import express from "express";
import { authenticate, requireAuthentication } from "./middleware/authenticate.js";
import { rateLimit } from "./middleware/rate-limit.js";
const app = express();

app.use(authenticate);
app.use(rateLimit);

app.get("/api/products", (request, response) => {
  response.status(200).json({
    products: [],
    authenticated: Boolean(request.auth),
  });
});

app.get("/api/account", requireAuthentication, (request, response) => {
  response.status(200).json({
    clientId: request.auth?.clientId,
  });
});

app.post("/api/login", (_request, response) => {
  response.status(200).json({
    message: "Login endpoint placeholder",
  });
});

export { app };