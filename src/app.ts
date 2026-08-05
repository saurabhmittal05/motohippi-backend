import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// Allow origins from FRONTEND_URL env var (comma-separated list supported)
const rawOrigins = process.env.FRONTEND_URL ?? "";
const allowedOrigins = rawOrigins
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const cleanOrigin = origin.replace(/\/$/, "");
    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.includes("*") ||
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith("motohippi.com") ||
      cleanOrigin.endsWith(".vercel.app")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization",
      );
    }
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── HTTP logging ──────────────────────────────────────────────────────────────
// app.use(
//   pinoHttp({
//     logger,
//     serializers: {
//       req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
//       res(res) { return { statusCode: res.statusCode }; },
//     },
//   })
// );

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(err, "Unhandled route error");
  res
    .status(500)
    .json({
      error: "Internal server error",
      message: err?.message || String(err),
    });
});

export default app;
