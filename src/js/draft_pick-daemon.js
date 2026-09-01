/**

* MLBB Companion — Draft Reactive Daemon
*
* Responsibilities:
* * Monitor backend status
* * Respect CV Auto-Sync preference
* * Scan only while:
*
* ```
    Server ONLINE
  ```
* ```
    +
  ```
* ```
    BlueStacks RUNNING
  ```
* ```
    +
  ```
* ```
    CV Auto-Sync ON
  ```
* ```
    +
  ```
* ```
    Draft Pick ACTIVE
  ```
*
* Captured images are NEVER stored in localStorage/chrome.storage.
* They remain in the Python/OpenCV pipeline memory.
  */

(function () {

  'use strict';

  // ===========================================================================
  // DOM
  // ===========================================================================

  const engineStatus =
    document.getElementById('engineStatus');

  // ===========================================================================
  // STATE
  // ===========================================================================

  let scanInterval = null;

  let statusInterval = null;

  let daemonFailures = 0;

  let isScanningDraft = false;

  let isRunning = false;

  let latestStatus = null;

  let cvEnabled = true;

  const STATUS_INTERVAL_MS = 1200;

  const SCAN_INTERVAL_MS = 700;

  const MAX_FAILURES = 3;

  // LANE MAP
  const LANE_TO_INDEX = {
    'EXP Lane': 0,
    'Jungle': 1,
    'Mid Lane': 2,
    'Gold Lane': 3,
    'Roam': 4
  };

  // ===========================================================================
  // START
  // ===========================================================================

  async function start() {


    if (isRunning) {
      return;
    }

    isRunning = true;


    await loadCvPreference();


    await updateStatus();


    statusInterval =
      setInterval(
        updateStatus,
        STATUS_INTERVAL_MS
      );


    scanInterval =
      setInterval(
        scanLoop,
        SCAN_INTERVAL_MS
      );


    updateEngineStatus();


  }

  // ===========================================================================
  // STOP
  // ===========================================================================

  function stop() {
    isRunning = false;


    if (statusInterval) {

      clearInterval(
        statusInterval
      );

      statusInterval = null;
    }


    if (scanInterval) {

      clearInterval(
        scanInterval
      );

      scanInterval = null;
    }


    isScanningDraft = false;

    latestStatus = null;

    updateEngineStatus();


  }

  // ===========================================================================
  // CV STORAGE
  // ===========================================================================

  async function loadCvPreference() {
    try {

      const result =
        await chrome.storage.local.get(
          ['MLBB_CV_AutoSync']
        );


      if (
        typeof result.MLBB_CV_AutoSync ===
        'boolean'
      ) {

        cvEnabled =
          result.MLBB_CV_AutoSync;

      } else {

        cvEnabled = true;
      }


    } catch (error) {

      console.error(
        '[DraftDaemon] Failed to read CV preference:',
        error
      );

      cvEnabled = true;
    }


  }

  // ===========================================================================
  // STORAGE CHANGE LISTENER
  // ===========================================================================

  chrome.storage.onChanged.addListener(
    (changes, areaName) => {
      if (
        areaName !== 'local'
      ) {
        return;
      }


      if (
        changes.MLBB_CV_AutoSync
      ) {

        cvEnabled =
          changes.MLBB_CV_AutoSync.newValue !== false;


        updateEngineStatus();
      }
    }

  );

  // ===========================================================================
  // STATUS
  // ===========================================================================

  async function updateStatus() {
    try {

      const response =
        await fetch(
          'http://127.0.0.1:5000/status',
          {
            cache: 'no-store'
          }
        );


      if (!response.ok) {

        throw new Error(
          `HTTP ${response.status}`
        );
      }


      const data =
        await response.json();


      daemonFailures = 0;

      latestStatus = data;


      updateEngineStatus();


    } catch (error) {

      daemonFailures++;


      if (
        daemonFailures >=
        MAX_FAILURES
      ) {

        latestStatus = null;

        updateEngineStatus();
      }
    }

  }

  // ===========================================================================
  // SCAN LOOP
  // ===========================================================================

  async function scanLoop() {
    /*
     * Don't even request /cv/draft-scan unless
     * all prerequisites are satisfied.
     */

    if (
      !latestStatus ||
      latestStatus.status !== 'online' ||
      !latestStatus.bluestacks ||
      !cvEnabled ||
      isScanningDraft
    ) {

      return;
    }


    const phase =
      latestStatus.gamePhase ||
      'Standby';


    if (
      phase !== 'Draft Pick'
    ) {

      return;
    }


    await fetchLiveScanFrame();

  }

  // ===========================================================================
  // LIVE CV SCAN
  // ===========================================================================

  async function fetchLiveScanFrame() {
    if (isScanningDraft) {
      return;
    }


    isScanningDraft = true;


    try {

      const response =
        await fetch(
          'http://127.0.0.1:5000/cv/draft-scan',
          {
            cache: 'no-store'
          }
        );


      if (!response.ok) {

        throw new Error(
          `CV scan HTTP ${response.status}`
        );
      }


      const data =
        await response.json();


      if (
        data &&
        data.status === 'active' &&
        data.phase === 'Draft Pick'
      ) {

        syncDraftState(
          data
        );
      }


    } catch (error) {

      /*
       * A single CV scan failure must NOT
       * terminate the daemon.
       */

      console.warn(
        '[DraftDaemon] CV scan failed:',
        error
      );

    } finally {

      isScanningDraft = false;
    }

  }

  // ===========================================================================
  // DRAFT STATE SYNCHRONIZATION
  // ===========================================================================

  function syncDraftState(
    data
  ) {

    if (
      !window.DraftState
    ) {

      return;
    }


    const heroes =
      window.DraftState.getHeroesDb();


    const cleanSlug = (
      value
    ) => {

      return (
        value || ''
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ''
        );
    };


    const findHero = (
      name
    ) => {

      if (
        !name ||
        name.toLowerCase() === 'empty'
      ) {

        return null;
      }


      const target =
        cleanSlug(name);


      return heroes.find(
        (hero) => {

          return (
            cleanSlug(hero.name) ===
            target ||

            cleanSlug(hero.id) ===
            target
          );
        }
      ) || null;
    };


    const newlyLocked = [];

    const state =
      window.DraftState.get();


    // -------------------------------------------------------------------------
    // ALLY PICKS
    // -------------------------------------------------------------------------

    if (
      Array.isArray(
        data.blue_slots
      )
    ) {

      data.blue_slots
        .slice(0, 5)
        .forEach(
          (
            name,
            i
          ) => {

            const found =
              findHero(name);


            const detectedLane =
              data.blue_lanes &&
                data.blue_lanes[i]
                ? data.blue_lanes[i]
                : null;


            const targetIndex =
              detectedLane &&
                LANE_TO_INDEX[
                detectedLane
                ] !== undefined

                ? LANE_TO_INDEX[
                detectedLane
                ]

                : i;


            if (
              found &&
              (
                !state.allyTeam[
                targetIndex
                ] ||

                state.allyTeam[
                  targetIndex
                ].id !== found.id
              )
            ) {

              window.DraftState.selectHero(
                found.id,
                'ally',
                targetIndex,
                'pick'
              );


              newlyLocked.push({
                side: 'ally',
                index: targetIndex
              });
            }
          }
        );
    }


    // -------------------------------------------------------------------------
    // ENEMY PICKS
    // -------------------------------------------------------------------------

    if (
      Array.isArray(
        data.red_slots
      )
    ) {

      data.red_slots
        .slice(0, 5)
        .forEach(
          (
            name,
            i
          ) => {

            const found =
              findHero(name);


            if (
              found &&
              (
                !state.enemyTeam[i] ||

                state.enemyTeam[i].id !==
                found.id
              )
            ) {

              window.DraftState.selectHero(
                found.id,
                'enemy',
                i,
                'pick'
              );


              newlyLocked.push({
                side: 'enemy',
                index: i
              });
            }
          }
        );
    }


    // -------------------------------------------------------------------------
    // ALLY BANS
    // -------------------------------------------------------------------------

    if (
      Array.isArray(
        data.blue_bans
      )
    ) {

      data.blue_bans
        .slice(
          0,
          state.maxBans
        )
        .forEach(
          (
            name,
            i
          ) => {

            const found =
              findHero(name);


            if (
              found &&
              (
                !state.allyBans[i] ||

                state.allyBans[i].id !==
                found.id
              )
            ) {

              window.DraftState.selectHero(
                found.id,
                'ally',
                i,
                'ban'
              );
            }
          }
        );
    }


    // -------------------------------------------------------------------------
    // ENEMY BANS
    // -------------------------------------------------------------------------

    if (
      Array.isArray(
        data.red_bans
      )
    ) {

      data.red_bans
        .slice(
          0,
          state.maxBans
        )
        .forEach(
          (
            name,
            i
          ) => {

            const found =
              findHero(name);


            if (
              found &&
              (
                !state.enemyBans[i] ||

                state.enemyBans[i].id !==
                found.id
              )
            ) {

              window.DraftState.selectHero(
                found.id,
                'enemy',
                i,
                'ban'
              );
            }
          }
        );
    }


    // -------------------------------------------------------------------------
    // ANIMATIONS
    // -------------------------------------------------------------------------

    newlyLocked.forEach(
      (item) => {

        if (
          window.DraftBoardUI &&
          typeof window.DraftBoardUI.animateSlotLock ===
          'function'
        ) {

          window.DraftBoardUI.animateSlotLock(
            item.side,
            item.index
          );
        }
      }
    );


  }

  // ===========================================================================
  // ENGINE STATUS
  // ===========================================================================

  function updateEngineStatus() {
    if (!engineStatus) {
      return;
    }


    if (!latestStatus) {

      engineStatus.textContent =
        'Server Offline';

      engineStatus.className =
        'status-indicator standby';

      return;
    }


    if (
      latestStatus.status !==
      'online'
    ) {

      engineStatus.textContent =
        'Server Offline';

      engineStatus.className =
        'status-indicator standby';

      return;
    }


    if (
      !latestStatus.bluestacks
    ) {

      engineStatus.textContent =
        'Standby';

      engineStatus.className =
        'status-indicator standby';

      return;
    }


    if (!cvEnabled) {

      engineStatus.textContent =
        'Manual Mode';

      engineStatus.className =
        'status-indicator standby';

      return;
    }


    const phase =
      latestStatus.gamePhase ||
      'Standby';


    const sub =
      latestStatus.subPhase
        ? ` (${latestStatus.subPhase})`
        : '';


    engineStatus.textContent =
      `Live: ${phase}${sub}`;

    engineStatus.className =
      'status-indicator active';

  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  window.DraftDaemon = {
    start,
    stop
  };
})();
