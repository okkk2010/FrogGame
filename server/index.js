import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = resolve(__dirname, "../dist");
const httpServer = createServer(app);

// WebSocket server
const isProd = process.env.NODE_ENV === "production";
const clientOrigin = process.env.CLIENT_ORIGIN;
const wss = new WebSocketServer({ server: httpServer });
const corsOptions = clientOrigin ? { origin: clientOrigin } : { origin: true };
app.use(cors(corsOptions));

// In-memory player state
const players = new Map(); // id -> { x, y, stage, color, nickname, hp, score }
const palette = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x5dade2, 0xa569bd, 0xf5b7b1, 0x48c9b0, 0xf8c471];
let colorIndex = 0;

// MySQL setup (optional: only if env vars provided)
const dbConfig =
  process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME
    ? {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT || 3306)
      }
    : null;

let pool = null;

const initDb = async () => {
  if (!dbConfig) {
    console.log("MySQL config not provided; score persistence disabled");
    return;
  }
    
  pool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 5, namedPlaceholders: true });
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS scores (
      nickname VARCHAR(64) PRIMARY KEY,
      best_score INT NOT NULL DEFAULT 0
    );`
  );
  console.log("MySQL connected; score persistence enabled");
};

const recordHighScore = async (nickname, score) => {
  if (!pool || typeof score !== "number" || Number.isNaN(score)) return;
  const safeNickname = String(nickname || "Player").slice(0, 64);
  try {
    await pool.execute(
      "INSERT INTO scores (nickname, best_score) VALUES (?, ?) ON DUPLICATE KEY UPDATE best_score = GREATEST(best_score, VALUES(best_score))",
      [safeNickname, score]
    );
  } catch (error) {
    console.warn("Failed to record score", error);
  }
};

const getOverallRank = async (score) => {
  if (!pool || typeof score !== "number" || Number.isNaN(score)) return null;
  try {
    const [rows] = await pool.execute("SELECT COUNT(*) AS higher FROM scores WHERE best_score > ?", [score]);
    const higher = Number(rows?.[0]?.higher ?? 0);
    return higher + 1;
  } catch (error) {
    console.warn("Failed to compute overall rank", error);
    return null;
  }
};

const randomSpawn = () => ({
  x: Math.random() * 480 + 80,
  y: Math.random() * 320 + 80
});

initDb().catch((error) => {
  console.warn("MySQL init failed; score persistence disabled", error);
});

// High score API
app.get("/api/highscores", async (req, res) => {
  if (!pool) {
    res.json([]);
    return;
  }
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.floor(rawLimit)) : 10;
  try {
    // Inline the limit after sanitization to avoid binding issues with LIMIT placeholders
    const [rows] = await pool.query(
      `SELECT nickname, best_score AS score FROM scores ORDER BY best_score DESC LIMIT ${limit}`
    );
    console.log("Fetched highscores", rows);
    res.json(rows);
  } catch (error) {
    console.warn("Failed to fetch highscores", error);
    res.status(500).json({ error: "failed to fetch highscores" });
  }
});

const broadcast = (message, excludeId) => {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (excludeId && client.clientId === excludeId) continue;
    client.send(payload);
  }
};

const toSnapshot = () => {
  const snapshot = {};
  for (const [id, state] of players.entries()) {
    snapshot[id] = state;
  }
  return snapshot;
};

wss.on("connection", (socket, request) => {
  if (clientOrigin && isProd && request.headers.origin && request.headers.origin !== clientOrigin) {
    socket.close(1008, "origin not allowed");
    return;
  }

  const clientId = randomUUID();
  socket.clientId = clientId;

  socket.send(
    JSON.stringify({
      type: "players:sync",
      payload: { selfId: clientId, players: toSnapshot() }
    })
  );

  socket.on("message", (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch (error) {
      console.warn("Failed to parse message", error);
      return;
    }

    switch (parsed?.type) {
      case "player:join": {
        const color = palette[colorIndex++ % palette.length];
        const state = {
          x: Number(parsed.payload?.x ?? 240),
          y: Number(parsed.payload?.y ?? 320),
          stage: parsed.payload?.stage === "frog" ? "frog" : "tadpole",
          color,
          hp: 5,
          score: 0,
          nickname: String(parsed.payload?.nickname || "Player")
        };
        players.set(clientId, state);
        // Send own state back to the client
        socket.send(
          JSON.stringify({
            type: "player:updated",
            payload: { id: clientId, x: state.x, y: state.y, stage: state.stage, hp: state.hp, score: state.score, color: state.color }
          })
        );
        broadcast({ type: "player:joined", payload: { id: clientId, ...state } }, clientId);
        break;
      }
      case "food:eat": {
        const player = players.get(clientId);
        if (!player) return;
        const nextScore = (player.score ?? 0) + 10;
        const nextStage = nextScore >= 50 ? "frog" : player.stage;
        const updated = { ...player, score: nextScore, stage: nextStage };
        players.set(clientId, updated);
        broadcast({
          type: "player:updated",
          payload: {
            id: clientId,
            x: updated.x,
            y: updated.y,
            stage: updated.stage,
            hp: updated.hp ?? 5,
            score: updated.score ?? 0,
            color: updated.color
          }
        });
        break;
      }
      case "player:update": {
        const prev = players.get(clientId);
        if (!prev) return;
        const next = {
          ...prev,
          x: typeof parsed.payload?.x === "number" ? parsed.payload.x : prev.x,
          y: typeof parsed.payload?.y === "number" ? parsed.payload.y : prev.y,
          stage:
            parsed.payload?.stage === "frog" ? "frog" : parsed.payload?.stage === "tadpole" ? "tadpole" : prev.stage
        };
        players.set(clientId, next);
        broadcast(
          {
            type: "player:updated",
            payload: {
              id: clientId,
              x: next.x,
              y: next.y,
              stage: next.stage,
              hp: next.hp ?? 5,
              score: next.score ?? 0,
              color: next.color
            }
          },
          clientId
        );
        break;
      }
      case "player:hit": {
        const targetId = parsed.payload?.targetId;
        if (!targetId || typeof targetId !== "string") return;
        const target = players.get(targetId);
        if (!target) return;
        const prevHp = target.hp ?? 5;
        const nextHp = Math.max(0, prevHp - 1);
        const died = nextHp === 0 && prevHp > 0;
        const nextStage = died ? "tadpole" : target.stage;
        const deathScore = target.score ?? 0;
        const currentScores = Array.from(players.entries())
          .map(([id, playerState]) => (id === targetId ? deathScore : playerState.score ?? 0))
          .filter((value) => Number.isFinite(value));
        const updated = {
          ...target,
          hp: died ? 0 : nextHp,
          stage: nextStage,
          score: died ? 0 : target.score ?? 0
        };
        players.set(targetId, updated);
        broadcast({
          type: "player:updated",
          payload: {
            id: targetId,
            x: updated.x,
            y: updated.y,
            stage: updated.stage,
            hp: updated.hp,
            score: updated.score ?? 0,
            color: updated.color
          }
        });

        // Increment attacker score only on kill
        if (died) {
          recordHighScore(target.nickname, deathScore);
          const sortedScores = currentScores.slice().sort((a, b) => b - a);
          const mapRank = sortedScores.findIndex((value) => value <= deathScore) + 1 || 1;
          getOverallRank(deathScore).then((overallRank) => {
            try {
              const victimSocket = Array.from(wss.clients).find(
                (client) => client.readyState === WebSocket.OPEN && client.clientId === targetId
              );
              if (victimSocket) {
                victimSocket.send(
                  JSON.stringify({
                    type: "player:died",
                    payload: { score: deathScore, mapRank, overallRank }
                  })
                );
              }
            } catch (error) {
              console.warn("Failed to send death summary", error);
            }
          });

          const attacker = players.get(clientId);
          if (attacker) {
            const nextScore = (attacker.score ?? 0) + 50;
            const updatedAttacker = { ...attacker, score: nextScore };
            players.set(clientId, updatedAttacker);
            broadcast({
              type: "player:updated",
              payload: {
                id: clientId,
                x: updatedAttacker.x,
                y: updatedAttacker.y,
                stage: updatedAttacker.stage,
                hp: updatedAttacker.hp ?? 5,
                score: updatedAttacker.score ?? 0,
                color: updatedAttacker.color
              }
            });
          }
        }
        break;
      }
      case "player:attack": {
        broadcast({ type: "player:attack", payload: { id: clientId, heading: parsed.payload?.heading } }, clientId);
        break;
      }
      case "player:respawn": {
        const prev = players.get(clientId);
        const spawn = {
          x:
            typeof parsed.payload?.x === "number" && Number.isFinite(parsed.payload.x)
              ? parsed.payload.x
              : randomSpawn().x,
          y:
            typeof parsed.payload?.y === "number" && Number.isFinite(parsed.payload.y)
              ? parsed.payload.y
              : randomSpawn().y
        };
        const next = {
          ...(prev || {}),
          x: spawn.x,
          y: spawn.y,
          hp: 5,
          stage: "tadpole",
          score: 0,
          color: prev?.color ?? palette[colorIndex++ % palette.length],
          nickname: prev?.nickname ?? "Player"
        };
        players.set(clientId, next);
        broadcast({
          type: "player:updated",
          payload: {
            id: clientId,
            x: next.x,
            y: next.y,
            stage: next.stage,
            hp: next.hp,
            score: next.score ?? 0,
            color: next.color
          }
        });
        break;
      }
      default:
        break;
    }
  });

  socket.on("close", () => {
    if (players.has(clientId)) {
      players.delete(clientId);
      broadcast({ type: "player:left", payload: { id: clientId } }, clientId);
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
