// WatchParty — Shared Constants
// Used by popup, background, content scripts, and server

const MSG = {
  // Room management
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  ROOM_ERROR: 'room_error',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
  PARTICIPANT_LIST: 'participant_list',

  // Playback sync
  SYNC_PLAY: 'sync_play',
  SYNC_PAUSE: 'sync_pause',
  SYNC_SEEK: 'sync_seek',
  SYNC_RATE: 'sync_rate',
  SYNC_STATE: 'sync_state',

  // WebRTC signaling
  RTC_OFFER: 'rtc_offer',
  RTC_ANSWER: 'rtc_answer',
  ICE_CANDIDATE: 'ice_candidate',

  // Internal chrome message passing
  GET_STATE: 'get_state',
  STATE_UPDATE: 'state_update',
  START_SYNC: 'start_sync',
  STOP_SYNC: 'stop_sync',
};

const CONFIG = {
  SERVER_URL: 'ws://localhost:3000',
  STUN_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  ROOM_CODE_LENGTH: 6,
  SYNC_THRESHOLD_SECONDS: 2, // Only sync seek if difference > this
};

// Generate a random room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  let code = '';
  for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// For Node.js (server)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MSG, CONFIG, generateRoomCode };
}
