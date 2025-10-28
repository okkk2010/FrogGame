import express from "express";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as IOServer } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = resolve(__dirname, "../dist");
const httpServer = createServer(app);

// Socket.IO server
const isProd = process.env.NODE_ENV === "production";
const clientOrigin = process.env.CLIENT_ORIGIN;
const io = new IOServer(
  httpServer,
  clientOrigin || !isProd
    ? {
        cors: {
          // In dev: allow any origin. In prod: use CLIENT_ORIGIN if provided.
          origin: clientOrigin || true
        }
      }
    : undefined
);

// In-memory player state
const players = new Map(); // id -> { x, y, stage, color, nickname }
const palette = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x5dade2, 0xa569bd, 0xf5b7b1, 0x48c9b0, 0xf8c471];
let colorIndex = 0;

io.on("connection", (socket) => {
  // Send current players to the newly connected client
  const snapshot = {};
  for (const [id, state] of players.entries()) {
    snapshot[id] = state;
  }
  socket.emit("players:sync", snapshot);

  socket.on("player:join", (payload) => {
    const color = palette[colorIndex++ % palette.length];
    const state = {
      x: Number(payload?.x ?? 240),
      y: Number(payload?.y ?? 320),
      stage: payload?.stage === "frog" ? "frog" : "tadpole",
      color,
      nickname: String(payload?.nickname || "Player")
    };
    players.set(socket.id, state);
    socket.broadcast.emit("player:joined", { id: socket.id, ...state });
  });

  socket.on("player:update", (payload) => {
    const prev = players.get(socket.id);
    if (!prev) return;
    const next = {
      ...prev,
      x: typeof payload?.x === "number" ? payload.x : prev.x,
      y: typeof payload?.y === "number" ? payload.y : prev.y,
      stage: payload?.stage === "frog" ? "frog" : payload?.stage === "tadpole" ? "tadpole" : prev.stage
    };
    players.set(socket.id, next);
    socket.broadcast.volatile.emit("player:updated", { id: socket.id, x: next.x, y: next.y, stage: next.stage });
  });

  socket.on("disconnect", () => {
    if (players.has(socket.id)) {
      players.delete(socket.id);
      socket.broadcast.emit("player:left", { id: socket.id });
    }
  });
});

// Static hosting for built client
app.use(express.static(distDir));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("*", (_req, res) => {
  res.sendFile(resolve(distDir, "index.html"), (error) => {
    if (error) {
      res.status(200).send("Build artifacts are missing. Run npm run build and try again.");
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Server ready on http://localhost:${port}`);
});
