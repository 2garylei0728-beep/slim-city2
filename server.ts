import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  applyClientAction,
  assignPlayerRole,
  createInitialCityState,
  createSimPlayer,
  stepCitySimulation,
  stepSimPlayers,
} from './src/sim/economy';
import type { CityState, ClientAction } from './src/sim/types';
import { applyAiDirectorBundleToState } from './src/sim/aiDirector';
import { AiDirectorError, generateMacauDynamicContent } from './src/server/geminiDirector';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface RoomSession {
  state: CityState;
  clients: Map<WebSocket, string>; // ws -> playerId
  lastSimAt: number;
  lastStepAt: number;
  aiInFlight: boolean;
}

const rooms = new Map<string, RoomSession>();

function getOrCreateRoom(roomId: string): RoomSession {
  const cleanId = roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'macau-main';
  let room = rooms.get(cleanId);
  if (!room) {
    room = {
      state: createInitialCityState(cleanId),
      clients: new Map(),
      lastSimAt: Date.now(),
      lastStepAt: Date.now(),
      aiInFlight: false,
    };
    rooms.set(cleanId, room);
  }
  return room;
}

function broadcastRoom(room: RoomSession, payload: unknown): void {
  const msg = JSON.stringify(payload);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.entries()).map(([id, r]) => ({
      id,
      players: Object.keys(r.state.players).length,
      population: r.state.stats.population,
      day: r.state.stats.day,
    }));
    res.json({ rooms: list });
  });

  app.post('/api/ai/director', async (req, res) => {
    const body = (req.body || {}) as {
      roomId?: string;
      playerId?: string;
      theme?: string;
      includeEvent?: boolean;
    };
    const room = getOrCreateRoom(String(body.roomId || 'macau-main'));
    const player = body.playerId ? room.state.players[String(body.playerId)] : undefined;
    if (player && player.role !== 'mayor') {
      res.status(403).json({
        ok: false,
        error: '僅限「市長角色」呼叫 AI 城市導演生成城市動態元素',
      });
      return;
    }
    if (room.aiInFlight) {
      res.status(429).json({
        ok: false,
        error: 'AI 城市導演正在生成上一組動態實景，請稍候再試',
      });
      return;
    }

    room.aiInFlight = true;
    try {
      const bundle = await generateMacauDynamicContent(
        room.state,
        typeof body.theme === 'string' ? body.theme : undefined,
        body.includeEvent !== false,
      );
      const applied = applyAiDirectorBundleToState(room.state, bundle);
      broadcastRoom(room, { type: 'state', state: room.state });
      res.json({
        ok: true,
        headline: room.state.aiDirectorHeadline,
        element: applied.element,
        quest: applied.quest,
        eventApplied: applied.eventApplied,
      });
    } catch (err) {
      const status = err instanceof AiDirectorError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'AI 城市導演發生未預期錯誤';
      res.status(status).json({ ok: false, error: message });
    } finally {
      room.aiInFlight = false;
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let currentRoom: RoomSession | null = null;
    let currentPlayerId: string | null = null;

    ws.on('message', (raw) => {
      let action: ClientAction;
      try {
        action = JSON.parse(raw.toString()) as ClientAction;
      } catch {
        return;
      }

      if (action.type === 'join') {
        const room = getOrCreateRoom(action.roomId);
        // Remove from previous room if switching
        if (currentRoom && currentRoom !== room && currentPlayerId) {
          currentRoom.clients.delete(ws);
          delete currentRoom.state.players[currentPlayerId];
          broadcastRoom(currentRoom, { type: 'state', state: currentRoom.state });
        }

        currentRoom = room;
        currentPlayerId = action.playerId;
        room.clients.set(ws, action.playerId);

        const requestedRole = action.role || 'mayor';
        const { role: assignedRole, notice } = assignPlayerRole(
          room.state,
          action.playerId,
          requestedRole,
        );

        if (!room.state.players[action.playerId]) {
          room.state.players[action.playerId] = createSimPlayer(
            action.playerId,
            action.name,
            action.color,
            assignedRole,
          );
          room.state.chat.push({
            id: `sys_${Date.now()}_${Math.random()}`,
            senderId: 'system',
            senderName: '市政廣播',
            senderColor: '#34d399',
            text: `${room.state.players[action.playerId].name} 以「${assignedRole === 'mayor' ? '🏛️ 市長角色' : '🧑 市民角色'}」加入了澳門天際線`,
            timestamp: Date.now(),
            kind: 'system',
          });
          if (room.state.chat.length > 40) room.state.chat.shift();
        } else {
          room.state.players[action.playerId].name = action.name.trim().slice(0, 18) || '澳門市民';
          room.state.players[action.playerId].color = action.color;
          room.state.players[action.playerId].role = assignedRole;
          room.state.players[action.playerId].autonomy = assignedRole === 'citizen';
          room.state.players[action.playerId].lastActiveAt = Date.now();
        }

        ws.send(JSON.stringify({ type: 'init', playerId: action.playerId, state: room.state }));
        if (notice) {
          ws.send(JSON.stringify({ type: 'error', message: notice }));
        }
        broadcastRoom(room, { type: 'state', state: room.state });
        return;
      }

      if (!currentRoom || !currentPlayerId) return;

      if (action.type === 'reset_city') {
        const oldPlayers = { ...currentRoom.state.players };
        currentRoom.state = createInitialCityState(currentRoom.state.roomId);
        currentRoom.state.players = oldPlayers;
        broadcastRoom(currentRoom, { type: 'state', state: currentRoom.state });
        return;
      }

      const result = applyClientAction(currentRoom.state, currentPlayerId, action);
      if (!result.ok && result.error) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
        return;
      }

      // Broadcast lightweight state update on actions
      if (action.type === 'cursor') {
        broadcastRoom(currentRoom, {
          type: 'cursor',
          playerId: currentPlayerId,
          pos: action.pos,
        });
      } else {
        broadcastRoom(currentRoom, { type: 'state', state: currentRoom.state });
      }
    });

    ws.on('close', () => {
      if (currentRoom && currentPlayerId) {
        currentRoom.clients.delete(ws);
        // Only delete player if no other socket holds the same playerId
        const stillConnected = Array.from(currentRoom.clients.values()).includes(currentPlayerId);
        if (!stillConnected) {
          const leftName = currentRoom.state.players[currentPlayerId]?.name;
          delete currentRoom.state.players[currentPlayerId];
          if (leftName) {
            currentRoom.state.chat.push({
              id: `sys_left_${Date.now()}`,
              senderId: 'system',
              senderName: '市政廣播',
              senderColor: '#94a3b8',
              text: `${leftName} 已離開城市房間`,
              timestamp: Date.now(),
              kind: 'system',
            });
            if (currentRoom.state.chat.length > 40) currentRoom.state.chat.shift();
          }
        }
        broadcastRoom(currentRoom, { type: 'state', state: currentRoom.state });
      }
    });
  });

  // Authoritative simulation tick loop (250ms cadence)
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.clients.size === 0) continue;

      const dt = Math.min(0.5, (now - room.lastStepAt) / 1000);
      room.lastStepAt = now;

      let dirty = false;
      if (Object.keys(room.state.players).length > 0) {
        stepSimPlayers(room.state, dt);
        dirty = true;
      }

      const speedIntervalMs =
        room.state.simSpeed === 3
          ? 700
          : room.state.simSpeed === 2
            ? 1250
            : room.state.simSpeed === 1
              ? 2200
              : Infinity;

      if (now - room.lastSimAt >= speedIntervalMs) {
        room.lastSimAt = now;
        stepCitySimulation(room.state);
        dirty = true;

        if (
          room.state.aiAutoDirector &&
          !room.aiInFlight &&
          process.env.GEMINI_API_KEY?.trim() &&
          room.state.dynamicElements.length < 2 &&
          room.state.stats.tick > 0 &&
          room.state.stats.tick % 16 === 0
        ) {
          room.aiInFlight = true;
          generateMacauDynamicContent(room.state, undefined, !room.state.activeEvent)
            .then((bundle) => {
              applyAiDirectorBundleToState(room.state, bundle);
              broadcastRoom(room, { type: 'state', state: room.state });
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              broadcastRoom(room, { type: 'error', message: msg });
              room.state.aiAutoDirector = false;
            })
            .finally(() => {
              room.aiInFlight = false;
            });
        }
      }

      if (dirty) {
        broadcastRoom(room, { type: 'state', state: room.state });
      }
    }
  }, 250);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vitePromise = createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Macau Slim City] Server listening on http://0.0.0.0:${PORT}`);
    });

    // Warm Vite server right after binding port 3000
    vitePromise.catch((err) => {
      console.error('[Macau Slim City] Vite middleware init error:', err);
    });

    const shutdown = async () => {
      try {
        const vite = await vitePromise.catch(() => null);
        await vite?.close();
      } finally {
        wss.close();
        server.close(() => process.exit(0));
      }
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Macau Slim City] Server listening on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
