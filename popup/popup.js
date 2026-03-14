// WatchParty Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const screenMain = document.getElementById('screen-main');
  const screenParty = document.getElementById('screen-party');
  const btnCreate = document.getElementById('btn-create');
  const btnJoin = document.getElementById('btn-join');
  const inputCode = document.getElementById('input-code');
  const displayCode = document.getElementById('display-code');
  const btnCopy = document.getElementById('btn-copy');
  const btnSync = document.getElementById('btn-sync');
  const btnLeave = document.getElementById('btn-leave');
  const participantList = document.getElementById('participant-list');
  const connectionBar = document.getElementById('connection-status');
  const connText = document.getElementById('conn-text');

  let currentRoom = null;
  let isSyncing = false;
  let myId = null;

  // ===== Communication with background service worker =====

  function sendMessage(msg) {
    chrome.runtime.sendMessage(msg);
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    handleServerMessage(message);
  });

  function handleServerMessage(msg) {
    switch (msg.type) {
      case MSG.ROOM_CREATED:
        currentRoom = msg.roomCode;
        myId = msg.userId;
        showPartyScreen(msg.roomCode);
        updateParticipants(msg.participants || []);
        break;

      case MSG.ROOM_JOINED:
        currentRoom = msg.roomCode;
        myId = msg.userId;
        showPartyScreen(msg.roomCode);
        updateParticipants(msg.participants || []);
        break;

      case MSG.ROOM_ERROR:
        showError(msg.error || 'Something went wrong');
        break;

      case MSG.PARTICIPANT_JOINED:
        addParticipant(msg.userId);
        break;

      case MSG.PARTICIPANT_LEFT:
        removeParticipant(msg.userId);
        break;

      case MSG.PARTICIPANT_LIST:
        updateParticipants(msg.participants || []);
        break;

      case MSG.STATE_UPDATE:
        updateConnectionStatus(msg.connected);
        if (msg.roomCode) {
          currentRoom = msg.roomCode;
          myId = msg.userId;
          showPartyScreen(msg.roomCode);
          if (msg.participants) updateParticipants(msg.participants);
        }
        break;
    }
  }

  // ===== Get current state on popup open =====

  sendMessage({ type: MSG.GET_STATE });

  // ===== UI Actions =====

  btnCreate.addEventListener('click', () => {
    btnCreate.disabled = true;
    btnCreate.textContent = 'Creating...';
    sendMessage({ type: MSG.CREATE_ROOM });

    // Re-enable after timeout
    setTimeout(() => {
      btnCreate.disabled = false;
      btnCreate.innerHTML = '<span class="btn-icon">🎬</span>Create Party';
    }, 3000);
  });

  btnJoin.addEventListener('click', () => {
    const code = inputCode.value.trim().toUpperCase();
    if (code.length !== CONFIG.ROOM_CODE_LENGTH) {
      inputCode.style.borderColor = 'var(--danger)';
      setTimeout(() => { inputCode.style.borderColor = ''; }, 1500);
      return;
    }
    sendMessage({ type: MSG.JOIN_ROOM, roomCode: code });
  });

  inputCode.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') btnJoin.click();
    inputCode.value = inputCode.value.toUpperCase();
  });

  btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom).then(() => {
      btnCopy.textContent = '✅';
      setTimeout(() => { btnCopy.textContent = '📋'; }, 1500);
    });
  });

  btnSync.addEventListener('click', () => {
    isSyncing = !isSyncing;
    if (isSyncing) {
      sendMessage({ type: MSG.START_SYNC });
      btnSync.innerHTML = '<span class="btn-icon">⏸️</span>Stop Sync';
      btnSync.classList.add('syncing');
    } else {
      sendMessage({ type: MSG.STOP_SYNC });
      btnSync.innerHTML = '<span class="btn-icon">🔄</span>Start Sync';
      btnSync.classList.remove('syncing');
    }
  });

  btnLeave.addEventListener('click', () => {
    sendMessage({ type: MSG.LEAVE_ROOM });
    currentRoom = null;
    isSyncing = false;
    showMainScreen();
  });

  // ===== Screen Management =====

  function showMainScreen() {
    screenMain.classList.add('active');
    screenParty.classList.remove('active');
    inputCode.value = '';
  }

  function showPartyScreen(code) {
    screenMain.classList.remove('active');
    screenParty.classList.add('active');
    displayCode.textContent = code;
  }

  function showError(message) {
    // Flash the input red briefly
    inputCode.style.borderColor = 'var(--danger)';
    inputCode.value = '';
    inputCode.placeholder = message;
    setTimeout(() => {
      inputCode.style.borderColor = '';
      inputCode.placeholder = 'Enter room code';
    }, 2500);
  }

  // ===== Participants =====

  function updateParticipants(list) {
    participantList.innerHTML = '';
    list.forEach(p => {
      addParticipantElement(p);
    });
  }

  function addParticipant(userId) {
    // Avoid duplicates
    if (document.querySelector(`[data-user-id="${userId}"]`)) return;
    addParticipantElement(userId);
  }

  function addParticipantElement(userId) {
    const li = document.createElement('li');
    li.setAttribute('data-user-id', userId);
    if (userId === myId) li.classList.add('you');

    const initial = userId.charAt(0).toUpperCase();
    li.innerHTML = `
      <div class="avatar">${initial}</div>
      <span class="name">User ${userId.slice(-4)}</span>
    `;
    participantList.appendChild(li);
  }

  function removeParticipant(userId) {
    const el = document.querySelector(`[data-user-id="${userId}"]`);
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-10px)';
      setTimeout(() => el.remove(), 300);
    }
  }

  // ===== Connection Status =====

  function updateConnectionStatus(connected) {
    connectionBar.className = 'connection-bar ' + (connected ? 'connected' : 'disconnected');
    connText.textContent = connected ? 'Connected to server' : 'Connecting...';
  }

  // Initial status
  updateConnectionStatus(false);
});
