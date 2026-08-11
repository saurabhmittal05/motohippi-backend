try {
  process.loadEnvFile();
} catch {
  // .env file is optional in production containers (Railway, EC2, Render)
}

import http from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initDatabase } from "./lib/db/init.js";
import { initWebSocketServer } from "./services/ws.service.js";

const port = Number(process.env["PORT"] ?? 3000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

const server = http.createServer(app);

// Attach real-time WebSocket server (/ws)
initWebSocketServer(server);

server.listen(port, "0.0.0.0", () => {
  logger.info({ port, host: "0.0.0.0" }, "MotoHippi API server & WebSocket listening");
  initDatabase().catch((err) => {
    logger.error({ err }, "Database auto-init failed");
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — not crashing");
});
