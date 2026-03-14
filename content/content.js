// WatchParty — Content Script (Video Sync)
// Injects into OTT pages, hooks into <video> element, syncs playback

(function () {
  'use strict';

  // Prevent double injection
  if (window.__watchPartyInjected) return;
  window.__watchPartyInjected = true;

  let videoEl = null;
  let syncEnabled = false;
  let isRemoteAction = false; // Flag to prevent echo loops
  let roomCode = null;
  let myUserId = null;

  // ===== Debouncing & throttling =====
  let seekDebounceTimer = null;
  let lastSyncSent = 0;
  const SYNC_COOLDOWN_MS = 300; // Min time between outgoing sync events
  const SEEK_DEBOUNCE_MS = 500; // Wait for seek to settle before syncing
  const REMOTE_ACTION_LOCK_MS = 800; // How long to suppress local events after remote action
  const SYNC_THRESHOLD = 1.5; // Only seek if time difference > this (seconds)

  console.log('[WatchParty] Content script loaded on', window.location.hostname);

  // ===== Find the main video element =====

  function findVideoElement() {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    let mainVideo = null;
    let maxArea = 0;

    videos.forEach((v) => {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea) {
        maxArea = area;
        mainVideo = v;
      }
    });

    return mainVideo;
  }

  function waitForVideo(callback, retries = 30) {
    const video = findVideoElement();
    if (video) {
      callback(video);
      return;
    }

    if (retries <= 0) {
      console.log('[WatchParty] No video element found after retries');
      setupVideoObserver(callback);
      return;
    }

    setTimeout(() => waitForVideo(callback, retries - 1), 1000);
  }

  function setupVideoObserver(callback) {
    const observer = new MutationObserver(() => {
      const video = findVideoElement();
      if (video) {
        observer.disconnect();
        callback(video);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ===== Throttled send =====

  function sendSyncEvent(type, data) {
    const now = Date.now();
    if (now - lastSyncSent < SYNC_COOLDOWN_MS) return; // Throttle
    lastSyncSent = now;

    chrome.runtime.sendMessage({
      type,
      ...data,
      timestamp: now, // Include timestamp for latency compensation
    });
  }

  // ===== Hook video events =====

  function hookVideoEvents(video) {
    videoEl = video;
    console.log('[WatchParty] Hooked into video element');

    video.addEventListener('play', () => {
      if (isRemoteAction || !syncEnabled) return;
      sendSyncEvent(MSG.SYNC_PLAY, { currentTime: video.currentTime });
    });

    video.addEventListener('pause', () => {
      if (isRemoteAction || !syncEnabled) return;
      // Ignore pause events during seeking (browsers fire pause before seeked)
      if (video.seeking) return;
      sendSyncEvent(MSG.SYNC_PAUSE, { currentTime: video.currentTime });
    });

    video.addEventListener('seeked', () => {
      if (isRemoteAction || !syncEnabled) return;

      // Debounce seeks — users often scrub rapidly
      clearTimeout(seekDebounceTimer);
      seekDebounceTimer = setTimeout(() => {
        sendSyncEvent(MSG.SYNC_SEEK, { currentTime: video.currentTime });
      }, SEEK_DEBOUNCE_MS);
    });

    video.addEventListener('ratechange', () => {
      if (isRemoteAction || !syncEnabled) return;
      sendSyncEvent(MSG.SYNC_RATE, { playbackRate: video.playbackRate });
    });
  }

  // ===== Apply remote sync actions =====

  function applyRemoteAction(callback) {
    isRemoteAction = true;
    clearTimeout(seekDebounceTimer); // Cancel any pending outgoing seeks
    callback();
    // Lock out local events for a bit to prevent echo loops
    setTimeout(() => { isRemoteAction = false; }, REMOTE_ACTION_LOCK_MS);
  }

  function handleSyncMessage(msg) {
    if (!videoEl || !syncEnabled) return;

    // Estimate one-way latency from timestamp
    const latencyMs = msg.timestamp ? (Date.now() - msg.timestamp) / 2 : 0;
    const latencySec = Math.max(0, Math.min(latencyMs / 1000, 5)); // Cap at 5 sec

    switch (msg.type) {
      case MSG.SYNC_PLAY:
        applyRemoteAction(() => {
          // Compensate for network delay
          const targetTime = msg.currentTime + latencySec;
          if (Math.abs(videoEl.currentTime - targetTime) > SYNC_THRESHOLD) {
            videoEl.currentTime = targetTime;
          }
          videoEl.play().catch(() => {});
        });
        break;

      case MSG.SYNC_PAUSE:
        applyRemoteAction(() => {
          videoEl.pause();
          if (Math.abs(videoEl.currentTime - msg.currentTime) > SYNC_THRESHOLD) {
            videoEl.currentTime = msg.currentTime;
          }
        });
        break;

      case MSG.SYNC_SEEK:
        applyRemoteAction(() => {
          if (Math.abs(videoEl.currentTime - msg.currentTime) > 0.5) {
            videoEl.currentTime = msg.currentTime;
          }
        });
        break;

      case MSG.SYNC_RATE:
        applyRemoteAction(() => {
          videoEl.playbackRate = msg.playbackRate;
        });
        break;
    }
  }

  // ===== Listen for messages from background =====

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case MSG.START_SYNC:
        syncEnabled = true;
        roomCode = message.roomCode;
        myUserId = message.userId;
        console.log('[WatchParty] Sync started for room', roomCode);

        // Find & hook video if not already done
        if (!videoEl) {
          waitForVideo((video) => {
            hookVideoEvents(video);
            if (window.__watchPartyOverlay) {
              window.__watchPartyOverlay.init(myUserId);
            }
          });
        } else {
          if (window.__watchPartyOverlay) {
            window.__watchPartyOverlay.init(myUserId);
          }
        }
        break;

      case MSG.STOP_SYNC:
        syncEnabled = false;
        console.log('[WatchParty] Sync stopped');
        if (window.__watchPartyOverlay) {
          window.__watchPartyOverlay.destroy();
        }
        break;

      case MSG.SYNC_PLAY:
      case MSG.SYNC_PAUSE:
      case MSG.SYNC_SEEK:
      case MSG.SYNC_RATE:
        handleSyncMessage(message);
        break;

      // Forward WebRTC messages to overlay
      case MSG.RTC_OFFER:
      case MSG.RTC_ANSWER:
      case MSG.ICE_CANDIDATE:
      case MSG.PARTICIPANT_JOINED:
      case MSG.PARTICIPANT_LEFT:
        if (window.__watchPartyOverlay) {
          window.__watchPartyOverlay.handleSignaling(message);
        }
        break;
    }
  });

  // ===== Auto-detect video on page load =====
  waitForVideo((video) => {
    hookVideoEvents(video);
    console.log('[WatchParty] Video element ready');
  });

})();
