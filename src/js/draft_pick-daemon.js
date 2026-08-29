/**
 * MLBB Companion — Draft Reactive Daemon (draft-daemon.js)
 * Always-Listening Background Polling Daemon for BlueStacks CV Auto-Sync.
 */
(function () {
  'use strict';

  const engineStatus = document.getElementById('engineStatus');
  let scanInterval = null;
  let daemonFailures = 0;
  let isScanningDraft = false;

  const LANE_TO_INDEX = {
    'EXP Lane': 0,
    'Jungle': 1,
    'Mid Lane': 2,
    'Gold Lane': 3,
    'Roam': 4
  };

  function start() {
    if (scanInterval) return;

    scanInterval = setInterval(() => {
      // 1. Check bridge status
      fetch('http://127.0.0.1:5000/status')
        .then((res) => res.json())
        .then((data) => {
          daemonFailures = 0;
          if (data.status === 'online') {
            const isAutoSync = localStorage.getItem('MLBB_CV_AutoSync') !== 'false';
            const phase = data.gamePhase || 'Standby';

            if (engineStatus) {
              const sub = data.subPhase ? ` (${data.subPhase})` : '';
              engineStatus.textContent = data.bluestacks 
                ? (isAutoSync ? `Live: ${phase}${sub}` : 'Manual Mode') 
                : 'Standby';
              engineStatus.className = data.bluestacks 
                ? (isAutoSync ? 'status-indicator active' : 'status-indicator standby') 
                : 'status-indicator standby';
            }

            // 2. Fetch live scan frame only if BlueStacks is connected, Auto-Sync is ON, and Phase is Draft Pick
            if (data.bluestacks && isAutoSync && !isScanningDraft && (data.gamePhase === 'Draft Pick' || phase === 'Draft Pick')) {
              fetchLiveScanFrame();
            }
          }
        })
        .catch(() => {
          daemonFailures++;
          if (daemonFailures >= 3 && engineStatus) {
            engineStatus.textContent = 'Server Offline';
            engineStatus.className = 'status-indicator standby';
          }
        });
    }, 700);
  }

  function fetchLiveScanFrame() {
    isScanningDraft = true;
    fetch('http://127.0.0.1:5000/cv/draft-scan')
      .then((res) => res.json())
      .then((data) => {
        isScanningDraft = false;
        if (data && data.status === 'active' && data.phase === 'Draft Pick') {
          const heroes = window.DraftState.getHeroesDb();
          const cleanSlug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

          const findHero = (name) => {
            if (!name || name.toLowerCase() === 'empty') return null;
            const target = cleanSlug(name);
            return heroes.find((h) => cleanSlug(h.name) === target || cleanSlug(h.id) === target) || null;
          };

          const newlyLocked = [];
          const st = window.DraftState.get();

          // 1. Sync Ally Picks (Lane-Aware)
          if (Array.isArray(data.blue_slots)) {
            data.blue_slots.slice(0, 5).forEach((name, i) => {
              const found = findHero(name);
              const detectedLane = (data.blue_lanes && data.blue_lanes[i]) ? data.blue_lanes[i] : null;
              const targetIdx = (detectedLane && LANE_TO_INDEX[detectedLane] !== undefined)
                ? LANE_TO_INDEX[detectedLane]
                : i;

              if (found && (!st.allyTeam[targetIdx] || st.allyTeam[targetIdx].id !== found.id)) {
                window.DraftState.selectHero(found.id, 'ally', targetIdx, 'pick');
                newlyLocked.push({ side: 'ally', index: targetIdx });
              }
            });
          }

          // 2. Sync Enemy Picks
          if (Array.isArray(data.red_slots)) {
            data.red_slots.slice(0, 5).forEach((name, i) => {
              const found = findHero(name);
              if (found && (!st.enemyTeam[i] || st.enemyTeam[i].id !== found.id)) {
                window.DraftState.selectHero(found.id, 'enemy', i, 'pick');
                newlyLocked.push({ side: 'enemy', index: i });
              }
            });
          }

          // 3. Sync Ally Bans
          if (Array.isArray(data.blue_bans)) {
            data.blue_bans.slice(0, st.maxBans).forEach((name, i) => {
              const found = findHero(name);
              if (found && (!st.allyBans[i] || st.allyBans[i].id !== found.id)) {
                window.DraftState.selectHero(found.id, 'ally', i, 'ban');
              }
            });
          }

          // 4. Sync Enemy Bans
          if (Array.isArray(data.red_bans)) {
            data.red_bans.slice(0, st.maxBans).forEach((name, i) => {
              const found = findHero(name);
              if (found && (!st.enemyBans[i] || st.enemyBans[i].id !== found.id)) {
                window.DraftState.selectHero(found.id, 'enemy', i, 'ban');
              }
            });
          }

          // 5. Trigger lock animations
          newlyLocked.forEach((item) => {
            if (window.DraftBoardUI?.animateSlotLock) {
              window.DraftBoardUI.animateSlotLock(item.side, item.index);
            }
          });
        }
      })
      .catch(() => {
        isScanningDraft = false;
      });
  }

  function stop() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
  }

  window.DraftDaemon = {
    start,
    stop
  };
})();
