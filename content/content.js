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

  console.log('[WatchParty] Content script loaded on', window.location.hostname);

  // ===== Find the main video element =====

  function findVideoElement() {
    // Try to find the largest/main video
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
      // Set up MutationObserver as fallback
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
      sendSyncEvent(MSG.SYNC_PAUSE, { currentTime: video.currentTime });
    });

    video.addEventListener('seeked', () => {
      if (isRemoteAction || !syncEnabled) return;
      sendSyncEvent(MSG.SYNC_SEEK, { currentTime: video.currentTime });
    });

    video.addEventListener('ratechange', () => {
      if (isRemoteAction || !syncEnabled) return;
      sendSyncEvent(MSG.SYNC_RATE, { playbackRate: video.playbackRate });
    });
  }

  function sendSyncEvent(type, data) {
    chrome.runtime.sendMessage({ type, ...data });
  }

  // ===== Apply remote sync actions =====

  function applyRemoteAction(callback) {
    isRemoteAction = true;
    callback();
    // Reset flag after a short delay to ensure event listeners don't catch it
    setTimeout(() => { isRemoteAction = false; }, 500);
  }

  function handleSyncMessage(msg) {
    if (!videoEl || !syncEnabled) return;

    switch (msg.type) {
      case MSG.SYNC_PLAY:
        applyRemoteAction(() => {
          // Seek to the sender's time if difference is significant
          if (Math.abs(videoEl.currentTime - msg.currentTime) > CONFIG.SYNC_THRESHOLD_SECONDS) {
            videoEl.currentTime = msg.currentTime;
          }
          videoEl.play().catch(() => {});
        });
        break;

      case MSG.SYNC_PAUSE:
        applyRemoteAction(() => {
          videoEl.pause();
          if (Math.abs(videoEl.currentTime - msg.currentTime) > CONFIG.SYNC_THRESHOLD_SECONDS) {
            videoEl.currentTime = msg.currentTime;
          }
        });
        break;

      case MSG.SYNC_SEEK:
        applyRemoteAction(() => {
          videoEl.currentTime = msg.currentTime;
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
            // Initialize the overlay
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
