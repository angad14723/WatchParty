# WatchParty

Watch movies together with friends! A Chrome extension that synchronizes OTT playback and includes built-in video chat.

## Features

- 🎬 **Synchronized Playback** — Play, pause, seek stays in sync across all participants
- 📹 **Built-in Video Chat** — WebRTC-powered camera/mic overlay right on the movie page
- 🏠 **Room System** — Create or join with a 6-character room code
- 🌐 **Multi-Platform** — Works on YouTube, Netflix, Prime Video, Hotstar, JioC cinema, Zee5, SonyLIV, and more

## Quick Start

### 1. Start the Signaling Server

```bash
cd server
npm install
npm start
```

The server will start on `ws://localhost:3000`.

### 2. Load the Chrome Extension

1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `WatchParty` project folder (the root, not the `server` folder)

### 3. Start a Watch Party

1. Navigate to any supported OTT platform (YouTube, Netflix, etc.)
2. Click the WatchParty extension icon in your toolbar
3. Click **Create Party** to get a room code
4. Share the code with friends
5. Friends click **Join** and enter the code
6. Click **Start Sync** — playback is now synchronized!

## Architecture

```
WatchParty/
├── manifest.json              # Chrome extension config (Manifest V3)
├── icons/                     # Extension icons
├── popup/                     # Extension popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── background/                # Service worker (WebSocket client)
│   └── service-worker.js
├── content/                   # Injected into OTT pages
│   ├── content.js             # Video sync logic
│   ├── content.css            # Overlay styles
│   └── overlay.js             # WebRTC video chat
├── shared/                    # Shared constants
│   └── constants.js
└── server/                    # Signaling server
    ├── server.js
    └── package.json
```

## How It Works

1. **Popup** → Create/join a room via the extension icon
2. **Background Worker** → Maintains a WebSocket connection to the signaling server
3. **Content Script** → Detects the `<video>` element on OTT pages, hooks play/pause/seek events
4. **Overlay** → Renders a draggable video chat panel using WebRTC
5. **Server** → Relays sync events and WebRTC signaling between peers

## Supported Platforms

YouTube, Netflix, Amazon Prime Video, Disney+ Hotstar, JioCinema, Zee5, SonyLIV, Voot

## Tech Stack

- Chrome Manifest V3
- Vanilla JavaScript
- WebSocket (ws library)
- WebRTC (browser-native)
- Google STUN servers (free)
