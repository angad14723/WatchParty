// WatchParty — Video Chat Overlay (WebRTC)
// Renders a floating draggable panel with webcam feeds

(function () {
  'use strict';

  const peers = {}; // { peerId: { pc, stream, videoEl } }
  let localStream = null;
  let myUserId = null;
  let overlayContainer = null;
  let isMinimized = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  // ===== Create Overlay UI =====

  function createOverlay() {
    if (overlayContainer) return;

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'watchparty-overlay';
    overlayContainer.innerHTML = `
      <div class="wp-overlay-header" id="wp-drag-handle">
        <div class="wp-overlay-title">
          <span class="wp-logo">🎬</span>
          <span>WatchParty</span>
        </div>
        <div class="wp-overlay-controls">
          <button id="wp-btn-cam" class="wp-ctrl-btn" title="Toggle Camera">📹</button>
          <button id="wp-btn-mic" class="wp-ctrl-btn" title="Toggle Mic">🎤</button>
          <button id="wp-btn-minimize" class="wp-ctrl-btn" title="Minimize">➖</button>
        </div>
      </div>
      <div class="wp-video-grid" id="wp-video-grid">
        <div class="wp-video-tile wp-local" id="wp-local-tile">
          <video id="wp-local-video" autoplay muted playsinline></video>
          <span class="wp-video-label">You</span>
        </div>
      </div>
      <div class="wp-status-bar" id="wp-status-bar">
        <span class="wp-sync-indicator">🔄 Syncing</span>
      </div>
    `;

    document.body.appendChild(overlayContainer);
    setupDrag();
    setupControls();
  }

  // ===== Drag Functionality =====

  function setupDrag() {
    const handle = document.getElementById('wp-drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      const rect = overlayContainer.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      overlayContainer.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      overlayContainer.style.left = x + 'px';
      overlayContainer.style.top = y + 'px';
      overlayContainer.style.right = 'auto';
      overlayContainer.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      overlayContainer.style.transition = '';
    });
  }

  // ===== Controls =====

  function setupControls() {
    const btnCam = document.getElementById('wp-btn-cam');
    const btnMic = document.getElementById('wp-btn-mic');
    const btnMinimize = document.getElementById('wp-btn-minimize');

    btnCam.addEventListener('click', () => {
      if (!localStream) return;
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        btnCam.textContent = videoTrack.enabled ? '📹' : '🚫';
        btnCam.classList.toggle('wp-off', !videoTrack.enabled);
      }
    });

    btnMic.addEventListener('click', () => {
      if (!localStream) return;
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        btnMic.textContent = audioTrack.enabled ? '🎤' : '🔇';
        btnMic.classList.toggle('wp-off', !audioTrack.enabled);
      }
    });

    btnMinimize.addEventListener('click', () => {
      isMinimized = !isMinimized;
      const grid = document.getElementById('wp-video-grid');
      const statusBar = document.getElementById('wp-status-bar');
      if (grid) grid.style.display = isMinimized ? 'none' : 'grid';
      if (statusBar) statusBar.style.display = isMinimized ? 'none' : 'flex';
      btnMinimize.textContent = isMinimized ? '🔼' : '➖';
      overlayContainer.classList.toggle('wp-minimized', isMinimized);
    });
  }

  // ===== WebRTC =====

  async function getLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 240, height: 180, frameRate: 15 },
        audio: true,
      });
      const localVideo = document.getElementById('wp-local-video');
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
      return localStream;
    } catch (err) {
      console.error('[WatchParty] Failed to get media:', err);
      // Try audio only
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        return localStream;
      } catch (e) {
        console.error('[WatchParty] No media available:', e);
        return null;
      }
    }
  }

  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: CONFIG.STUN_SERVERS,
    });

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('[WatchParty] Received remote track from', peerId);
      let peerData = peers[peerId];
      if (!peerData) return;
      peerData.stream = event.streams[0];
      addRemoteVideoTile(peerId, event.streams[0]);
    };

    // Send ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        chrome.runtime.sendMessage({
          type: MSG.ICE_CANDIDATE,
          targetUserId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WatchParty] ICE state for ${peerId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        removePeer(peerId);
      }
    };

    peers[peerId] = { pc, stream: null, videoEl: null };
    return pc;
  }

  async function createOffer(peerId) {
    const stream = await getLocalStream();
    const pc = createPeerConnection(peerId);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      chrome.runtime.sendMessage({
        type: MSG.RTC_OFFER,
        targetUserId: peerId,
        sdp: pc.localDescription.toJSON(),
      });
    } catch (err) {
      console.error('[WatchParty] Failed to create offer:', err);
    }
  }

  async function handleOffer(peerId, sdp) {
    const stream = await getLocalStream();
    let pc;

    if (peers[peerId]) {
      pc = peers[peerId].pc;
    } else {
      pc = createPeerConnection(peerId);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      chrome.runtime.sendMessage({
        type: MSG.RTC_ANSWER,
        targetUserId: peerId,
        sdp: pc.localDescription.toJSON(),
      });
    } catch (err) {
      console.error('[WatchParty] Failed to handle offer:', err);
    }
  }

  async function handleAnswer(peerId, sdp) {
    if (!peers[peerId]) return;
    try {
      await peers[peerId].pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error('[WatchParty] Failed to handle answer:', err);
    }
  }

  async function handleIceCandidate(peerId, candidate) {
    if (!peers[peerId]) return;
    try {
      await peers[peerId].pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WatchParty] Failed to add ICE candidate:', err);
    }
  }

  // ===== Video Tiles =====

  function addRemoteVideoTile(peerId, stream) {
    const grid = document.getElementById('wp-video-grid');
    if (!grid) return;

    // Remove existing tile for this peer
    const existing = document.getElementById(`wp-tile-${peerId}`);
    if (existing) existing.remove();

    const tile = document.createElement('div');
    tile.className = 'wp-video-tile wp-remote';
    tile.id = `wp-tile-${peerId}`;
    tile.innerHTML = `
      <video autoplay playsinline></video>
      <span class="wp-video-label">User ${peerId.slice(-4)}</span>
    `;

    const video = tile.querySelector('video');
    video.srcObject = stream;
    grid.appendChild(tile);

    if (peers[peerId]) {
      peers[peerId].videoEl = video;
    }

    updateGridLayout();
  }

  function removeRemoteVideoTile(peerId) {
    const tile = document.getElementById(`wp-tile-${peerId}`);
    if (tile) {
      tile.style.animation = 'wp-fadeOut 0.3s ease';
      setTimeout(() => {
        tile.remove();
        updateGridLayout();
      }, 300);
    }
  }

  function updateGridLayout() {
    const grid = document.getElementById('wp-video-grid');
    if (!grid) return;
    const count = grid.children.length;
    if (count <= 2) {
      grid.style.gridTemplateColumns = count === 1 ? '1fr' : '1fr 1fr';
    } else if (count <= 4) {
      grid.style.gridTemplateColumns = '1fr 1fr';
    } else {
      grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    }
  }

  // ===== Peer Management =====

  function removePeer(peerId) {
    if (peers[peerId]) {
      peers[peerId].pc.close();
      delete peers[peerId];
    }
    removeRemoteVideoTile(peerId);
  }

  // ===== Public API (used by content.js) =====

  window.__watchPartyOverlay = {
    init: async function (userId) {
      myUserId = userId;
      createOverlay();
      await getLocalStream();
      console.log('[WatchParty] Overlay initialized for user', userId);
    },

    destroy: function () {
      // Close all peer connections
      Object.keys(peers).forEach((peerId) => {
        peers[peerId].pc.close();
        delete peers[peerId];
      });

      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }

      // Remove overlay
      if (overlayContainer) {
        overlayContainer.remove();
        overlayContainer = null;
      }
    },

    handleSignaling: function (msg) {
      switch (msg.type) {
        case MSG.PARTICIPANT_JOINED:
          // New participant → send them an offer
          if (msg.userId !== myUserId) {
            createOffer(msg.userId);
          }
          break;

        case MSG.PARTICIPANT_LEFT:
          removePeer(msg.userId);
          break;

        case MSG.RTC_OFFER:
          if (msg.fromUserId && msg.fromUserId !== myUserId) {
            handleOffer(msg.fromUserId, msg.sdp);
          }
          break;

        case MSG.RTC_ANSWER:
          if (msg.fromUserId && msg.fromUserId !== myUserId) {
            handleAnswer(msg.fromUserId, msg.sdp);
          }
          break;

        case MSG.ICE_CANDIDATE:
          if (msg.fromUserId && msg.fromUserId !== myUserId) {
            handleIceCandidate(msg.fromUserId, msg.candidate);
          }
          break;
      }
    },
  };
})();
