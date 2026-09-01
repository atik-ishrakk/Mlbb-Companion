/**

* MLBB Companion — Popup Controller
*
* IMPORTANT:
* This file is UI ONLY.
*
* All actual system operations are delegated to service_worker.js.
  */

(function () {

  'use strict';

  // ===========================================================================
  // DOM
  // ===========================================================================

  const popGamePhase =
    document.getElementById('popGamePhase');

  const popPortLink =
    document.getElementById('popPortLink');

  const btnOpenBrowser =
    document.getElementById('btnOpenBrowser');

  const moduleBs =
    document.getElementById('moduleBs');

  const moduleCv =
    document.getElementById('moduleCv');

  const moduleServer =
    document.getElementById('moduleServer');

  const bsInstanceToggle =
    document.getElementById('bsInstanceToggle');

  const cvAutoSyncToggle =
    document.getElementById('cvAutoSyncToggle');

  const serverPowerToggle =
    document.getElementById('serverPowerToggle');

  const bsToggleDesc =
    document.getElementById('bsToggleDesc');

  const serverToggleDesc =
    document.getElementById('serverToggleDesc');

  // ===========================================================================
  // STATE
  // ===========================================================================

  let polling = false;

  let consecutiveFailures = 0;

  const MAX_FAILURES = 3;

  let lastPhase = null;

  let busy = {
    bluestacks: false,
    server: false,
    cv: false
  };

  // ===========================================================================
  // INIT
  // ===========================================================================

  document.addEventListener(
    'DOMContentLoaded',
    init
  );

  async function init() {

    ```
setupEvents();

await loadCvPreference();

await pollStatus();

/*
 * 1.2 seconds is enough for a popup.
 *
 * The previous implementation used 500ms.
 * That produced unnecessary HTTP traffic.
 */
setInterval(
  pollStatus,
  1200
);
```

  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  function setupEvents() {

    ```
if (btnOpenBrowser) {

  btnOpenBrowser.addEventListener(
    'click',
    () => {

      sendMessage({
        action: 'OPEN_PAGE',
        page: 'src/html/draft_pick.html'
      });

    }
  );
}


if (popPortLink) {

  popPortLink.addEventListener(
    'click',
    (event) => {

      event.preventDefault();

      sendMessage({
        action: 'OPEN_URL',
        url: 'http://127.0.0.1:5000/status'
      });

    }
  );
}


if (bsInstanceToggle) {

  bsInstanceToggle.addEventListener(
    'change',
    () => {

      const enabled =
        bsInstanceToggle.checked;

      setBusy(
        'bluestacks',
        true
      );

      updateBlueStacksVisualState(
        enabled
          ? 'STARTING'
          : 'STOPPING'
      );

      sendMessage({
        action: 'SET_BLUESTACKS',
        enabled
      }).then(() => {

        /*
         * Do not immediately force the switch to ON/OFF.
         *
         * pollStatus() will confirm the real process state.
         */

      }).finally(() => {

        setBusy(
          'bluestacks',
          false
        );

      });
    }
  );
}


if (cvAutoSyncToggle) {

  cvAutoSyncToggle.addEventListener(
    'change',
    () => {

      const enabled =
        cvAutoSyncToggle.checked;

      setBusy(
        'cv',
        true
      );

      updateCvVisualState(enabled);

      sendMessage({
        action: 'SET_CV',
        enabled
      }).finally(() => {

        setBusy(
          'cv',
          false
        );

      });
    }
  );
}


if (serverPowerToggle) {

  serverPowerToggle.addEventListener(
    'change',
    () => {

      const enabled =
        serverPowerToggle.checked;

      setBusy(
        'server',
        true
      );

      updateServerVisualState(
        enabled
          ? 'STARTING'
          : 'STOPPING'
      );

      sendMessage({
        action: 'SET_SERVER',
        enabled
      }).finally(() => {

        setBusy(
          'server',
          false
        );

      });
    }
  );
}
```

  }

  // ===========================================================================
  // CV PREFERENCE
  // ===========================================================================

  async function loadCvPreference() {

    ```
try {

  const result =
    await chrome.storage.local.get(
      ['MLBB_CV_AutoSync']
    );

  const enabled =
    typeof result.MLBB_CV_AutoSync === 'boolean'
      ? result.MLBB_CV_AutoSync
      : true;

  if (cvAutoSyncToggle) {

    cvAutoSyncToggle.checked =
      enabled;
  }

  updateCvVisualState(enabled);

} catch (error) {

  console.error(
    '[MLBB Popup] Failed to load CV preference:',
    error
  );

}
```

  }

  // ===========================================================================
  // STATUS POLLING
  // ===========================================================================

  async function pollStatus() {

    ```
if (polling) {
  return;
}

polling = true;

try {

  const response =
    await sendMessage({
      action: 'GET_STATUS'
    });

  if (!response?.success) {
    throw new Error(
      response?.error ||
      'Status request failed.'
    );
  }

  consecutiveFailures = 0;

  applyStatus(
    response.data,
    response.controller
  );

} catch (error) {

  consecutiveFailures++;

  if (
    consecutiveFailures >=
    MAX_FAILURES
  ) {

    applyOfflineState();
  }

} finally {

  polling = false;
}
```

  }

  // ===========================================================================
  // APPLY BACKEND STATUS
  // ===========================================================================

  function applyStatus(
    data,
    controller
  ) {

    ```
if (!data) {
  return;
}


// -------------------------------------------------------------------------
// SERVER
// -------------------------------------------------------------------------

const serverOnline =
  data.status === 'online';

if (serverPowerToggle) {

  serverPowerToggle.checked =
    serverOnline;
}


if (serverOnline) {

  updateServerVisualState(
    'RUNNING'
  );

} else {

  updateServerVisualState(
    'OFF'
  );
}


// -------------------------------------------------------------------------
// BLUESTACKS
// -------------------------------------------------------------------------

const bsOnline =
  !!data.bluestacks;


if (bsInstanceToggle) {

  bsInstanceToggle.checked =
    bsOnline;
}


if (bsOnline) {

  updateBlueStacksVisualState(
    data.gameRunning ||
    isActiveGamePhase(data.gamePhase)
      ? 'PLAYING'
      : 'RUNNING'
  );

} else {

  updateBlueStacksVisualState(
    'OFF'
  );
}


// -------------------------------------------------------------------------
// CV
// -------------------------------------------------------------------------

if (
  controller &&
  typeof controller.cv === 'boolean'
) {

  if (cvAutoSyncToggle) {

    /*
     * Only update the checkbox if the
     * user isn't currently manipulating it.
     */
    if (!busy.cv) {

      cvAutoSyncToggle.checked =
        controller.cv;
    }

    updateCvVisualState(
      controller.cv
    );
  }
}


// -------------------------------------------------------------------------
// PHASE
// -------------------------------------------------------------------------

updatePhase(
  data.gamePhase
);


// -------------------------------------------------------------------------
// DEVICE
// -------------------------------------------------------------------------

if (popPortLink) {

  popPortLink.innerText =
    data.device ||
    '127.0.0.1:5555';
}


// -------------------------------------------------------------------------
// BROWSER BUTTON
// -------------------------------------------------------------------------

updateBrowserStatus(
  data
);
```

  }

  // ===========================================================================
  // OFFLINE
  // ===========================================================================

  function applyOfflineState() {

    ```
if (serverPowerToggle) {

  serverPowerToggle.checked =
    false;
}

if (bsInstanceToggle) {

  bsInstanceToggle.checked =
    false;
}


updateServerVisualState(
  'OFF'
);

updateBlueStacksVisualState(
  'OFF'
);


if (btnOpenBrowser) {

  btnOpenBrowser.className =
    'btn-header-browser status-offline';
}


if (popGamePhase) {

  popGamePhase.innerText =
    'OFFLINE';
}


if (serverToggleDesc) {

  serverToggleDesc.innerText =
    'Server Offline (Switch ON to Start)';
}


if (bsToggleDesc) {

  bsToggleDesc.innerText =
    'Closed';
}
```

  }

  // ===========================================================================
  // BLUE STACKS VISUAL STATE
  // ===========================================================================

  function updateBlueStacksVisualState(
    state
  ) {

    ```
if (!moduleBs) {
  return;
}


switch (state) {

  case 'STARTING':

    moduleBs.classList.add(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Launching...';
    }

    break;


  case 'RUNNING':

    moduleBs.classList.add(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Running';
    }

    break;


  case 'PLAYING':

    moduleBs.classList.add(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Playing';
    }

    break;


  case 'STOPPING':

    moduleBs.classList.remove(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Closing...';
    }

    break;


  case 'ERROR':

    moduleBs.classList.remove(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Error';
    }

    break;


  case 'OFF':
  default:

    moduleBs.classList.remove(
      'is-active'
    );

    if (bsToggleDesc) {

      bsToggleDesc.innerText =
        'Closed';
    }

    break;
}
```

  }

  // ===========================================================================
  // SERVER VISUAL STATE
  // ===========================================================================

  function updateServerVisualState(
    state
  ) {

    ```
if (!moduleServer) {
  return;
}


switch (state) {

  case 'STARTING':

    moduleServer.classList.add(
      'is-active'
    );

    if (serverToggleDesc) {

      serverToggleDesc.innerText =
        'Starting Server (Port 5000)...';
    }

    break;


  case 'RUNNING':

    moduleServer.classList.add(
      'is-active'
    );

    if (serverToggleDesc) {

      serverToggleDesc.innerHTML =
        'Bridge: <a id="popPortLink" class="bridge-link" href="http://127.0.0.1:5000/status" target="_blank">127.0.0.1:5000</a>';
    }

    break;


  case 'STOPPING':

    moduleServer.classList.remove(
      'is-active'
    );

    if (serverToggleDesc) {

      serverToggleDesc.innerText =
        'Stopping Server...';
    }

    break;


  case 'ERROR':

    moduleServer.classList.remove(
      'is-active'
    );

    if (serverToggleDesc) {

      serverToggleDesc.innerText =
        'Server Error';
    }

    break;


  case 'OFF':
  default:

    moduleServer.classList.remove(
      'is-active'
    );

    if (serverToggleDesc) {

      serverToggleDesc.innerText =
        'Server Offline (Switch ON to Start)';
    }

    break;
}
```

  }

  // ===========================================================================
  // CV VISUAL STATE
  // ===========================================================================

  function updateCvVisualState(
    enabled
  ) {

    ```
if (!moduleCv) {
  return;
}

if (enabled) {

  moduleCv.classList.add(
    'is-active'
  );

} else {

  moduleCv.classList.remove(
    'is-active'
  );
}
```

  }

  // ===========================================================================
  // GAME PHASE
  // ===========================================================================

  function updatePhase(
    phase
  ) {

    ```
const nextPhase =
  String(
    phase || 'STANDBY'
  ).toUpperCase();


if (!popGamePhase) {
  return;
}


if (
  lastPhase !== null &&
  lastPhase !== nextPhase
) {

  popGamePhase.classList.remove(
    'phase-pulse'
  );

  void popGamePhase.offsetWidth;

  popGamePhase.classList.add(
    'phase-pulse'
  );
}


popGamePhase.innerText =
  nextPhase;

lastPhase =
  nextPhase;
```

  }

  // ===========================================================================
  // BROWSER STATUS
  // ===========================================================================

  function updateBrowserStatus(
    data
  ) {

    ```
if (!btnOpenBrowser) {
  return;
}


const serverOnline =
  data.status === 'online';

const bsOnline =
  !!data.bluestacks;

const gameRunning =
  !!data.gameRunning ||
  isActiveGamePhase(
    data.gamePhase
  );


if (
  serverOnline &&
  bsOnline &&
  gameRunning
) {

  btnOpenBrowser.className =
    'btn-header-browser status-full-online';

} else if (
  serverOnline &&
  bsOnline
) {

  btnOpenBrowser.className =
    'btn-header-browser status-bs-only';

} else {

  btnOpenBrowser.className =
    'btn-header-browser status-offline';
}
```

  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function isActiveGamePhase(
    phase
  ) {

    ```
if (!phase) {
  return false;
}

const normalized =
  String(phase)
    .trim()
    .toLowerCase();


return ![
  'n/a',
  'standby',
  'unknown',
  'offline',
  'off',
  ''
].includes(normalized);
```

  }

  function setBusy(
    module,
    value
  ) {

    ```
busy[module] =
  value;
```

  }

  function sendMessage(
    message
  ) {

    ```
return new Promise(
  (resolve, reject) => {

    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {

      reject(
        new Error(
          'Chrome runtime messaging is unavailable.'
        )
      );

      return;
    }


    chrome.runtime.sendMessage(
      message,
      (response) => {

        if (
          chrome.runtime.lastError
        ) {

          reject(
            new Error(
              chrome.runtime.lastError.message
            )
          );

          return;
        }


        resolve(
          response
        );
      }
    );
  }
);
```

  }

})();
