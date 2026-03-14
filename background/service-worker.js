// WatchParty — Background Service Worker
// Manages WebSocket connection to signaling server and relays messages

// ===== Inlined constants (importScripts not supported in MV3 service workers) =====
const MSG = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  ROOM_ERROR: 'room_error',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
  PARTICIPANT_LIST: 'participant_list',
  SYNC_PLAY: 'sync_play',
  SYNC_PAUSE: 'sync_pause',
  SYNC_SEEK: 'sync_seek',
  SYNC_RATE: 'sync_rate',
  SYNC_STATE: 'sync_state',
  RTC_OFFER: 'rtc_offer',
  RTC_ANSWER: 'rtc_answer',
  ICE_CANDIDATE: 'ice_candidate',
  GET_STATE: 'get_state',
  STATE_UPDATE: 'state_update',
  START_SYNC: 'start_sync',
  STOP_SYNC: 'stop_sync',
};

const CONFIG = {
  SERVER_URL: 'wss://watchparty-e88y.onrender.com',
  STUN_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  ROOM_CODE_LENGTH: 6,
  SYNC_THRESHOLD_SECONDS: 2,
};

let ws = null;
let isConnected = false;
let currentRoom = null;
let userId = null;
let participants = [];
let reconnectTimer = null;
let syncActive = false;
let activeTabId = null;

// ===== Generate a unique user ID =====
function getOrCreateUserId() {
  return new Promise((resolve) => {
    chrome.storage.local.get('watchparty_user_id', (data) => {
      if (data.watchparty_user_id) {
        resolve(data.watchparty_user_id);
      } else {
        const id = 'u_' + Math.random().toString(36).substring(2, 10);
        chrome.storage.local.set({ watchparty_user_id: id });
        resolve(id);
      }
    });
  });
}

// ===== WebSocket Connection =====

async function connectToServer() {
  userId = await getOrCreateUserId();

  // Already connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  // Connection in progress — wait for it
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(checkInterval);
          resolve();
        } else if (!ws || ws.readyState === WebSocket.CLOSED) {
          clearInterval(checkInterval);
          resolve(); // Don't block forever
        }
      }, 100);
    });
  }

  return new Promise((resolve) => {
    try {
      ws = new WebSocket(CONFIG.SERVER_URL);

      ws.onopen = () => {
        console.log('[WatchParty] Connected to signaling server');
        isConnected = true;
        clearTimeout(reconnectTimer);
        broadcastState();
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerMessage(msg);
        } catch (e) {
          console.error('[WatchParty] Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[WatchParty] Disconnected from server');
        isConnected = false;
        ws = null;
        broadcastState();
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('[WatchParty] WebSocket error:', err);
        isConnected = false;
        ws = null;
        broadcastState();
        resolve(); // Resolve so we don't hang
      };
    } catch (e) {
      console.error('[WatchParty] Failed to connect:', e);
      scheduleReconnect();
      resolve();
    }
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    console.log('[WatchParty] Attempting reconnect...');
    connectToServer();
  }, 3000);
}

function sendToServer(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ===== Handle messages from server =====

function handleServerMessage(msg) {
  switch (msg.type) {
    case MSG.ROOM_CREATED:
      currentRoom = msg.roomCode;
      participants = msg.participants || [userId];
      broadcastToPopup({ type: MSG.ROOM_CREATED, roomCode: currentRoom, userId, participants });
      break;

    case MSG.ROOM_JOINED:
      currentRoom = msg.roomCode;
      participants = msg.participants || [];
      broadcastToPopup({ type: MSG.ROOM_JOINED, roomCode: currentRoom, userId, participants });
      break;

    case MSG.ROOM_ERROR:
      broadcastToPopup({ type: MSG.ROOM_ERROR, error: msg.error });
      break;

    case MSG.PARTICIPANT_JOINED:
      if (!participants.includes(msg.userId)) {
        participants.push(msg.userId);
      }
      broadcastToPopup({ type: MSG.PARTICIPANT_JOINED, userId: msg.userId });
      // Forward to content script for WebRTC
      sendToContentScript({ type: MSG.PARTICIPANT_JOINED, userId: msg.userId });
      break;

    case MSG.PARTICIPANT_LEFT:
      participants = participants.filter(p => p !== msg.userId);
      broadcastToPopup({ type: MSG.PARTICIPANT_LEFT, userId: msg.userId });
      sendToContentScript({ type: MSG.PARTICIPANT_LEFT, userId: msg.userId });
      break;

    case MSG.PARTICIPANT_LIST:
      participants = msg.participants || [];
      broadcastToPopup({ type: MSG.PARTICIPANT_LIST, participants });
      break;

    // Playback sync — forward to content script
    case MSG.SYNC_PLAY:
    case MSG.SYNC_PAUSE:
    case MSG.SYNC_SEEK:
    case MSG.SYNC_RATE:
      if (syncActive) {
        sendToContentScript(msg);
      }
      break;

    // WebRTC signaling — forward to content script
    case MSG.RTC_OFFER:
    case MSG.RTC_ANSWER:
    case MSG.ICE_CANDIDATE:
      sendToContentScript(msg);
      break;
  }
}

// ===== Handle messages from popup & content scripts =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case MSG.GET_STATE:
      sendResponse({
        type: MSG.STATE_UPDATE,
        connected: isConnected,
        roomCode: currentRoom,
        userId: userId,
        participants: participants,
        syncing: syncActive,
      });
      // Also send asynchronously for popup
      broadcastState();
      break;

    case MSG.CREATE_ROOM:
      connectToServer().then(() => {
        sendToServer({ type: MSG.CREATE_ROOM, userId });
      });
      break;

    case MSG.JOIN_ROOM:
      connectToServer().then(() => {
        sendToServer({ type: MSG.JOIN_ROOM, userId, roomCode: message.roomCode });
      });
      break;

    case MSG.LEAVE_ROOM:
      sendToServer({ type: MSG.LEAVE_ROOM, userId, roomCode: currentRoom });
      currentRoom = null;
      participants = [];
      syncActive = false;
      break;

    case MSG.START_SYNC:
      syncActive = true;
      // Find the active tab with OTT content
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          activeTabId = tabs[0].id;
          sendToContentScript({ type: MSG.START_SYNC, roomCode: currentRoom, userId });
        }
      });
      break;

    case MSG.STOP_SYNC:
      syncActive = false;
      sendToContentScript({ type: MSG.STOP_SYNC });
      break;

    // Sync events from content script → server
    case MSG.SYNC_PLAY:
    case MSG.SYNC_PAUSE:
    case MSG.SYNC_SEEK:
    case MSG.SYNC_RATE:
      if (syncActive && currentRoom) {
        sendToServer({ ...message, userId, roomCode: currentRoom });
      }
      break;

    // WebRTC signaling from content script → server
    case MSG.RTC_OFFER:
    case MSG.RTC_ANSWER:
    case MSG.ICE_CANDIDATE:
      if (currentRoom) {
        sendToServer({ ...message, userId, roomCode: currentRoom });
      }
      break;
  }
  return true; // Keep the message channel open
});

// ===== Broadcast helpers =====

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup might not be open
  });
}

function sendToContentScript(msg) {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {});
  } else {
    // Try the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        activeTabId = tabs[0].id;
        chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
      }
    });
  }
}

function broadcastState() {
  broadcastToPopup({
    type: MSG.STATE_UPDATE,
    connected: isConnected,
    roomCode: currentRoom,
    userId: userId,
    participants: participants,
    syncing: syncActive,
  });
}

// ===== Initialize =====
connectToServer();
