/**

* MLBB Companion — Background Service Worker
*
* Responsibilities:
* * Single control owner for BlueStacks / Server / CV
* * Handles popup commands
* * Launches native protocol handlers
* * Provides backend status to popup
* * Persists CV preference
*
* IMPORTANT:
* The service worker does NOT capture screenshots.
* Screenshot/CV processing remains entirely inside the Python backend.
  */

'use strict';

const BACKEND_URL = 'http://127.0.0.1:5000';

const STORAGE_KEYS = {
CV_ENABLED: 'MLBB_CV_AutoSync'
};

const PROTOCOLS = {
BLUESTACKS:
'bluestacks://launch?instance=Nougat32&package=com.mobile.legends',

SERVER:
'mlbb://start-server'
};

const CONTROL_STATE = {
OFF: 'OFF',
STARTING: 'STARTING',
RUNNING: 'RUNNING',
STOPPING: 'STOPPING',
ERROR: 'ERROR'
};

let runtimeState = {
bluestacks: CONTROL_STATE.OFF,
server: CONTROL_STATE.OFF,
cv: true,

lastStatus: null,

bluestacksOperationId: 0,
serverOperationId: 0
};

// ============================================================================
// INSTALLATION
// ============================================================================

chrome.runtime.onInstalled.addListener(async () => {
console.log('[MLBB SW] Extension installed.');

const stored = await chrome.storage.local.get([
STORAGE_KEYS.CV_ENABLED
]);

if (typeof stored[STORAGE_KEYS.CV_ENABLED] !== 'boolean') {
await chrome.storage.local.set({
[STORAGE_KEYS.CV_ENABLED]: true
});


runtimeState.cv = true;


} else {
runtimeState.cv = stored[STORAGE_KEYS.CV_ENABLED];
}
});

// ============================================================================
// STARTUP
// ============================================================================

chrome.runtime.onStartup.addListener(async () => {
await loadPersistentState();
});

loadPersistentState();

async function loadPersistentState() {
try {
const stored = await chrome.storage.local.get([
STORAGE_KEYS.CV_ENABLED
]);


if (typeof stored[STORAGE_KEYS.CV_ENABLED] === 'boolean') {
  runtimeState.cv = stored[STORAGE_KEYS.CV_ENABLED];
}


} catch (error) {
console.error('[MLBB SW] Failed to load persistent state:', error);
}
}

// ============================================================================
// MESSAGE ROUTER
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

if (!request || !request.action) {
sendResponse({
success: false,
error: 'Missing action.'
});

return false;
}

handleMessage(request)
.then(sendResponse)
.catch((error) => {
console.error('[MLBB SW] Message error:', error);


  sendResponse({
    success: false,
    error: error?.message || String(error)
  });
});


return true;
});

async function handleMessage(request) {

switch (request.action) {

// ------------------------------------------------------------------------
// BLUE STACKS
// ------------------------------------------------------------------------

case 'SET_BLUESTACKS':
  return await setBlueStacksEnabled(!!request.enabled);


// ------------------------------------------------------------------------
// BACKEND SERVER
// ------------------------------------------------------------------------

case 'SET_SERVER':
  return await setServerEnabled(!!request.enabled);


// ------------------------------------------------------------------------
// COMPUTER VISION
// ------------------------------------------------------------------------

case 'SET_CV':
  return await setCvEnabled(!!request.enabled);


// ------------------------------------------------------------------------
// STATUS
// ------------------------------------------------------------------------

case 'GET_STATUS':
  return await getBackendStatus();


// ------------------------------------------------------------------------
// OPEN EXTENSION PAGE
// ------------------------------------------------------------------------

case 'OPEN_PAGE':
  return await openExtensionPage(
    request.page || 'src/html/draft_pick.html'
  );


// ------------------------------------------------------------------------
// OPEN URL
// ------------------------------------------------------------------------

case 'OPEN_URL':
  return await openUrl(request.url);


// ------------------------------------------------------------------------
// DEBUG
// ------------------------------------------------------------------------

case 'GET_CONTROLLER_STATE':
  return {
    success: true,
    state: runtimeState
  };


default:
  return {
    success: false,
    error: `Unknown action: ${request.action}`
  };

}
}

// ============================================================================
// BLUESTACKS CONTROL
// ============================================================================

async function setBlueStacksEnabled(enabled) {

if (enabled) {


if (runtimeState.bluestacks === CONTROL_STATE.STARTING ||
    runtimeState.bluestacks === CONTROL_STATE.RUNNING) {

  return {
    success: true,
    state: runtimeState.bluestacks,
    message: 'BlueStacks is already running or starting.'
  };
}

runtimeState.bluestacks = CONTROL_STATE.STARTING;

const operationId = ++runtimeState.bluestacksOperationId;

try {

  await launchProtocol(PROTOCOLS.BLUESTACKS);

  /*
   * Give BlueStacks time to initialize.
   * We do NOT assume that opening the protocol means BlueStacks
   * is already running.
   */
  waitForBlueStacks(operationId);

  return {
    success: true,
    state: CONTROL_STATE.STARTING,
    message: 'BlueStacks launch requested.'
  };

} catch (error) {

  runtimeState.bluestacks = CONTROL_STATE.ERROR;

  return {
    success: false,
    state: CONTROL_STATE.ERROR,
    error: error?.message || String(error)
  };
}


} else {

if (runtimeState.bluestacks === CONTROL_STATE.OFF ||
    runtimeState.bluestacks === CONTROL_STATE.STOPPING) {

  return {
    success: true,
    state: runtimeState.bluestacks,
    message: 'BlueStacks is already stopped.'
  };
}

runtimeState.bluestacks = CONTROL_STATE.STOPPING;

const operationId = ++runtimeState.bluestacksOperationId;

try {

  const response = await fetch(
    `${BACKEND_URL}/api/close-bluestacks`,
    {
      method: 'POST'
    }
  );

  if (!response.ok) {
    throw new Error(
      `BlueStacks shutdown returned HTTP ${response.status}`
    );
  }

  waitForBlueStacksStopped(operationId);

  return {
    success: true,
    state: CONTROL_STATE.STOPPING,
    message: 'BlueStacks shutdown requested.'
  };

} catch (error) {

  runtimeState.bluestacks = CONTROL_STATE.ERROR;

  return {
    success: false,
    state: CONTROL_STATE.ERROR,
    error: error?.message || String(error)
  };
}

}
}

// ============================================================================
// SERVER CONTROL
// ============================================================================

async function setServerEnabled(enabled) {

if (enabled) {

if (runtimeState.server === CONTROL_STATE.STARTING ||
    runtimeState.server === CONTROL_STATE.RUNNING) {

  return {
    success: true,
    state: runtimeState.server,
    message: 'Backend server is already running or starting.'
  };
}

runtimeState.server = CONTROL_STATE.STARTING;

const operationId = ++runtimeState.serverOperationId;

try {

  await launchProtocol(PROTOCOLS.SERVER);

  waitForServer(operationId);

  return {
    success: true,
    state: CONTROL_STATE.STARTING,
    message: 'Backend server launch requested.'
  };

} catch (error) {

  runtimeState.server = CONTROL_STATE.ERROR;

  return {
    success: false,
    state: CONTROL_STATE.ERROR,
    error: error?.message || String(error)
  };
}

} else {

if (runtimeState.server === CONTROL_STATE.OFF ||
    runtimeState.server === CONTROL_STATE.STOPPING) {

  return {
    success: true,
    state: runtimeState.server,
    message: 'Backend server is already stopped.'
  };
}

runtimeState.server = CONTROL_STATE.STOPPING;

const operationId = ++runtimeState.serverOperationId;

try {

  const response = await fetch(
    `${BACKEND_URL}/shutdown`,
    {
      method: 'POST'
    }
  );

  /*
   * The backend intentionally terminates itself after responding.
   * HTTP 200 is therefore enough to confirm that shutdown was requested.
   */
  if (!response.ok) {
    throw new Error(
      `Server shutdown returned HTTP ${response.status}`
    );
  }

  runtimeState.server = CONTROL_STATE.STOPPING;

  /*
   * The backend process should disappear shortly.
   * We verify with repeated status checks.
   */
  waitForServerStopped(operationId);

  return {
    success: true,
    state: CONTROL_STATE.STOPPING,
    message: 'Backend shutdown requested.'
  };

} catch (error) {

  /*
   * A connection failure can actually mean the server already stopped.
   * Verify before reporting an error.
   */
  const status = await tryGetBackendStatus();

  if (!status) {

    runtimeState.server = CONTROL_STATE.OFF;

    return {
      success: true,
      state: CONTROL_STATE.OFF,
      message: 'Backend server is offline.'
    };
  }

  runtimeState.server = CONTROL_STATE.ERROR;

  return {
    success: false,
    state: CONTROL_STATE.ERROR,
    error: error?.message || String(error)
  };
}

}
}

// ============================================================================
// CV CONTROL
// ============================================================================

async function setCvEnabled(enabled) {

runtimeState.cv = enabled;

await chrome.storage.local.set({
[STORAGE_KEYS.CV_ENABLED]: enabled
});

console.log(
`[MLBB SW] Computer Vision Auto-Sync: ${enabled ? 'ON' : 'OFF'}`
);

return {
success: true,
state: enabled ? 'ON' : 'OFF',
cvEnabled: enabled
};
}

// ============================================================================
// NATIVE PROTOCOL LAUNCH
// ============================================================================

async function launchProtocol(uri) {

/*

* We intentionally use a NEW background tab.
*
* We do NOT use:
*
* chrome.tabs.update(activeTab, { url: uri })
*
* because that can replace whatever the user is currently viewing.
  */

const tab = await chrome.tabs.create({
url: uri,
active: false
});

/*

* The protocol handler normally hands the URI to Windows.
* We don't rely on the resulting browser tab remaining useful.
*
* Give the OS a moment to process the protocol request, then
* attempt to close the temporary tab.
  */
  if (tab && tab.id) {


setTimeout(() => {



  chrome.tabs.remove(tab.id).catch(() => {});

}, 1500);


}
}

// ============================================================================
// BLUESTACKS STATUS VERIFICATION
// ============================================================================

async function waitForBlueStacks(operationId) {

const MAX_ATTEMPTS = 20;
const INTERVAL_MS = 1000;

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {


if (operationId !== runtimeState.bluestacksOperationId) {
  return;
}

const status = await tryGetBackendStatus();

if (status?.bluestacks) {

  runtimeState.bluestacks = CONTROL_STATE.RUNNING;

  runtimeState.lastStatus = status;

  return;
}

await sleep(INTERVAL_MS);


}

if (operationId === runtimeState.bluestacksOperationId) {


runtimeState.bluestacks = CONTROL_STATE.ERROR;

console.warn(
  '[MLBB SW] BlueStacks did not become available within timeout.'
);


}
}

async function waitForBlueStacksStopped(operationId) {

const MAX_ATTEMPTS = 10;
const INTERVAL_MS = 700;

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {


if (operationId !== runtimeState.bluestacksOperationId) {
  return;
}

const status = await tryGetBackendStatus();

if (!status?.bluestacks) {

  runtimeState.bluestacks = CONTROL_STATE.OFF;

  runtimeState.lastStatus = status || null;

  return;
}

await sleep(INTERVAL_MS);


}

if (operationId === runtimeState.bluestacksOperationId) {


runtimeState.bluestacks = CONTROL_STATE.ERROR;

console.warn(
  '[MLBB SW] BlueStacks did not stop within timeout.'
);


}
}

// ============================================================================
// SERVER STATUS VERIFICATION
// ============================================================================

async function waitForServer(operationId) {

const MAX_ATTEMPTS = 15;
const INTERVAL_MS = 1000;

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {


if (operationId !== runtimeState.serverOperationId) {
  return;
}

const status = await tryGetBackendStatus();

if (status?.status === 'online') {

  runtimeState.server = CONTROL_STATE.RUNNING;
  runtimeState.lastStatus = status;

  return;
}

await sleep(INTERVAL_MS);


}

if (operationId === runtimeState.serverOperationId) {

runtimeState.server = CONTROL_STATE.ERROR;

console.warn(
  '[MLBB SW] Backend server did not become available within timeout.'
);


}
}

async function waitForServerStopped(operationId) {

const MAX_ATTEMPTS = 10;
const INTERVAL_MS = 700;

for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
if (operationId !== runtimeState.serverOperationId) {
  return;
}

const status = await tryGetBackendStatus();

if (!status) {

  runtimeState.server = CONTROL_STATE.OFF;
  runtimeState.lastStatus = null;

  return;
}

await sleep(INTERVAL_MS);

}

if (operationId === runtimeState.serverOperationId) {
/*
 * If we cannot prove shutdown, don't silently claim OFF.
 */
runtimeState.server = CONTROL_STATE.ERROR;

console.warn(
  '[MLBB SW] Backend server did not stop within timeout.'
);

}
}

// ============================================================================
// BACKEND STATUS
// ============================================================================

async function getBackendStatus() {

const status = await tryGetBackendStatus();

if (!status) {
runtimeState.server = CONTROL_STATE.OFF;
runtimeState.bluestacks = CONTROL_STATE.OFF;

return {
  success: true,

  data: {
    status: 'offline',
    bluestacks: false,
    gameRunning: false,
    connected: false,
    gamePhase: 'OFFLINE',
    subPhase: null,
    device: null,
    timestamp: Date.now() / 1000
  },

  controller: {
    server: runtimeState.server,
    bluestacks: runtimeState.bluestacks,
    cv: runtimeState.cv
  }
};

}

runtimeState.server = CONTROL_STATE.RUNNING;
runtimeState.bluestacks =
status.bluestacks
? CONTROL_STATE.RUNNING
: CONTROL_STATE.OFF;

runtimeState.lastStatus = status;

return {
success: true,


data: status,

controller: {
  server: runtimeState.server,
  bluestacks: runtimeState.bluestacks,
  cv: runtimeState.cv
}

};
}

async function tryGetBackendStatus() {

const controller = new AbortController();

const timeout = setTimeout(() => {
controller.abort();
}, 2500);

try {

const response = await fetch(
  `${BACKEND_URL}/status`,
  {
    method: 'GET',
    signal: controller.signal,
    cache: 'no-store'
  }
);

if (!response.ok) {
  return null;
}

return await response.json();

} catch (error) {


return null;


} finally {


clearTimeout(timeout);


}
}

// ============================================================================
// PAGE / URL HELPERS
// ============================================================================

async function openExtensionPage(targetPath) {

const fullUrl = chrome.runtime.getURL(targetPath);

const tabs = await chrome.tabs.query({
currentWindow: true
});

const existingTab = tabs.find(
(tab) =>
tab.url &&
tab.url.includes(targetPath)
);

if (existingTab?.id) {
await chrome.tabs.update(
  existingTab.id,
  {
    active: true
  }
);

return {
  success: true,
  message: 'Existing page activated.'
};

}

await chrome.tabs.create({
url: fullUrl,
active: true
});

return {
success: true,
message: 'Page opened.'
};
}

async function openUrl(url) {

if (!url) {
return {
  success: false,
  error: 'URL is required.'
};

}

await chrome.tabs.create({
url,
active: true
});

return {
success: true
};
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {

return new Promise((resolve) => {
setTimeout(resolve, ms);
});
}