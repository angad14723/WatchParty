// WatchParty — Signaling Server
// Manages rooms, relays playback sync events, and WebRTC signaling

const http = require('http');
const WebSocket = require('ws');
const { MSG, generateRoomCode } = require('../shared/constants');

const PORT = process.env.PORT || 3000;

// Room storage: { roomCode: { participants: Map<userId, ws> } }
const rooms = new Map();

// Reverse lookup: ws → { userId, roomCode }
const clients = new Map();

// ===== HTTP server (needed for Render health checks) =====
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      clients: clients.size,
      uptime: process.uptime(),
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>WatchParty Server</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0d0f1a;color:#f0f0f5">
          <h1 style="background:linear-gradient(135deg,#7c4dff,#00e5c3);-webkit-background-clip:text;-webkit-text-fill-color:transparent">
            🎬 WatchParty Server
          </h1>
          <p style="color:#9295b3">Signaling server is running.</p>
          <p style="color:#00e5c3">Active rooms: ${rooms.size} | Connected clients: ${clients.size}</p>
        </body>
      </html>
    `);
  }
});

// ===== WebSocket server attached to HTTP =====
const wss = new WebSocket.Server({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`\n  🎬 WatchParty Signaling Server`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Listening on port ${PORT}`);
  console.log(`  Ready for connections...\n`);
});

wss.on('connection', (ws) => {
  console.log('[Server] New client connected');

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('[Server] Invalid JSON:', data);
      return;
    }

    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
    handleDisconnect(ws);
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case MSG.CREATE_ROOM:
      createRoom(ws, msg);
      break;

    case MSG.JOIN_ROOM:
      joinRoom(ws, msg);
      break;

    case MSG.LEAVE_ROOM:
      leaveRoom(ws, msg);
      break;

    // Playback sync — broadcast to others in room
    case MSG.SYNC_PLAY:
    case MSG.SYNC_PAUSE:
    case MSG.SYNC_SEEK:
    case MSG.SYNC_RATE:
      broadcastToRoom(ws, msg);
      break;

    // WebRTC signaling — forward to specific peer
    case MSG.RTC_OFFER:
    case MSG.RTC_ANSWER:
    case MSG.ICE_CANDIDATE:
      forwardToPeer(ws, msg);
      break;

    default:
      console.log('[Server] Unknown message type:', msg.type);
  }
}

// ===== Room Management =====

function createRoom(ws, msg) {
  const userId = msg.userId;
  let roomCode;

  // Generate unique room code
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  const room = {
    participants: new Map(),
    host: userId,
    createdAt: Date.now(),
  };

  room.participants.set(userId, ws);
  rooms.set(roomCode, room);
  clients.set(ws, { userId, roomCode });

  console.log(`[Server] Room ${roomCode} created by ${userId}`);

  send(ws, {
    type: MSG.ROOM_CREATED,
    roomCode,
    userId,
    participants: [userId],
  });
}

function joinRoom(ws, msg) {
  const { userId, roomCode } = msg;

  if (!rooms.has(roomCode)) {
    send(ws, { type: MSG.ROOM_ERROR, error: 'Room not found' });
    return;
  }

  const room = rooms.get(roomCode);

  // Leave any existing room first
  const existingClient = clients.get(ws);
  if (existingClient && existingClient.roomCode !== roomCode) {
    leaveRoom(ws, { userId: existingClient.userId, roomCode: existingClient.roomCode });
  }

  room.participants.set(userId, ws);
  clients.set(ws, { userId, roomCode });

  const participantIds = Array.from(room.participants.keys());

  console.log(`[Server] ${userId} joined room ${roomCode} (${participantIds.length} participants)`);

  // Send confirmation to the joining user
  send(ws, {
    type: MSG.ROOM_JOINED,
    roomCode,
    userId,
    participants: participantIds,
  });

  // Notify others
  broadcastToOthers(ws, roomCode, {
    type: MSG.PARTICIPANT_JOINED,
    userId,
  });
}

function leaveRoom(ws, msg) {
  const { userId, roomCode } = msg;

  if (!roomCode || !rooms.has(roomCode)) return;

  const room = rooms.get(roomCode);
  room.participants.delete(userId);
  clients.delete(ws);

  console.log(`[Server] ${userId} left room ${roomCode}`);

  // Notify others
  broadcastToOthers(ws, roomCode, {
    type: MSG.PARTICIPANT_LEFT,
    userId,
  });

  // Clean up empty rooms
  if (room.participants.size === 0) {
    rooms.delete(roomCode);
    console.log(`[Server] Room ${roomCode} deleted (empty)`);
  }
}

function handleDisconnect(ws) {
  const clientInfo = clients.get(ws);
  if (clientInfo) {
    leaveRoom(ws, clientInfo);
  }
  console.log('[Server] Client disconnected');
}

// ===== Message Routing =====

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToRoom(senderWs, msg) {
  const clientInfo = clients.get(senderWs);
  if (!clientInfo) return;

  const room = rooms.get(clientInfo.roomCode);
  if (!room) return;

  room.participants.forEach((ws, peerId) => {
    if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
      send(ws, { ...msg, fromUserId: clientInfo.userId });
    }
  });
}

function broadcastToOthers(senderWs, roomCode, msg) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.participants.forEach((ws, peerId) => {
    if (ws !== senderWs) {
      send(ws, msg);
    }
  });
}

function forwardToPeer(senderWs, msg) {
  const clientInfo = clients.get(senderWs);
  if (!clientInfo) return;

  const { targetUserId } = msg;
  const room = rooms.get(clientInfo.roomCode);
  if (!room) return;

  const targetWs = room.participants.get(targetUserId);
  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    send(targetWs, { ...msg, fromUserId: clientInfo.userId });
  }
}

// ===== Periodic cleanup of stale rooms =====
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    // Remove rooms older than 12 hours
    if (now - room.createdAt > 12 * 60 * 60 * 1000) {
      rooms.delete(code);
      console.log(`[Server] Cleaned up stale room ${code}`);
    }
  });
}, 60 * 60 * 1000); // Check every hour
