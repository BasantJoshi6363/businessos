import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./env.js";
import { router } from "./routes.js";
import { errorHandler } from "./middleware.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(router);

  app.use((_req, res) =>
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } })
  );
  app.use(errorHandler);
  return app;
}
