/**
 * MLBB Companion — Extension Toolbar Popup (popup.js)
 * Clean Header "Browser" Button + 3 Independent Switches
 */
(function () {
  'use strict';

  const popGamePhase = document.getElementById('popGamePhase');
  const popPortLink = document.getElementById('popPortLink');
  const btnOpenBrowser = document.getElementById('btnOpenBrowser');

  const moduleBs = document.getElementById('moduleBs');
  const moduleCv = document.getElementById('moduleCv');
  const moduleServer = document.getElementById('moduleServer');

  const bsInstanceToggle = document.getElementById('bsInstanceToggle');
  const cvAutoSyncToggle = document.getElementById('cvAutoSyncToggle');
  const serverPowerToggle = document.getElementById('serverPowerToggle');

  const bsToggleDesc = document.getElementById('bsToggleDesc');
  const serverToggleDesc = document.getElementById('serverToggleDesc');

  let isStoppingBs = false;
  let isStoppingServer = false;
  let isPolling = false;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  function init() {
    loadCvAutoSyncState();
    pollStatus();
    setInterval(pollStatus, 500);

    if (btnOpenBrowser) {
      btnOpenBrowser.addEventListener('click', () => {
        openPage('src/html/draft_pick.html');
      });
    }

    if (popPortLink) {
      popPortLink.addEventListener('click', (e) => {
        e.preventDefault();
        openPage('http://127.0.0.1:5000/status');
      });
    }

    if (bsInstanceToggle) {
      bsInstanceToggle.addEventListener('change', handleBsToggle);
    }

    if (cvAutoSyncToggle) {
      cvAutoSyncToggle.addEventListener('change', handleCvToggle);
    }

    if (serverPowerToggle) {
      serverPowerToggle.addEventListener('change', handleServerToggle);
    }
  }

  // 1. SWITCH 1: BlueStacks 5 Emulator Instance
  function handleBsToggle() {
    const isBsOn = bsInstanceToggle ? bsInstanceToggle.checked : false;

    if (isBsOn) {
      isStoppingBs = false;
      if (moduleBs) moduleBs.classList.add('is-active');
      if (bsToggleDesc) {
        bsToggleDesc.innerText = 'Launching...';
      }

      const link = document.createElement('a');
      link.href = 'bluestacks://launch?instance=Nougat32&package=com.mobile.legends';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ action: 'TRIGGER_LAUNCH' });
      }
      fetch('http://127.0.0.1:5000/launch').catch(() => {});

      setTimeout(() => {
        pollStatus();
      }, 2000);
    } else {
      isStoppingBs = true;
      if (moduleBs) moduleBs.classList.remove('is-active');
      if (bsToggleDesc) {
        bsToggleDesc.innerText = 'Closing...';
      }

      fetch('http://127.0.0.1:5000/api/close-bluestacks', { method: 'POST' })
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            isStoppingBs = false;
            if (bsToggleDesc) bsToggleDesc.innerText = 'Closed';
          }, 1200);
        });
    }
  }

  // 2. SWITCH 2: Live Computer Vision & Auto-Sync (No subtitle hint)
  function handleCvToggle() {
    const isCvOn = cvAutoSyncToggle ? cvAutoSyncToggle.checked : false;

    if (moduleCv) {
      if (isCvOn) moduleCv.classList.add('is-active');
      else moduleCv.classList.remove('is-active');
    }

    try {
      localStorage.setItem('MLBB_CV_AutoSync', isCvOn ? 'true' : 'false');
    } catch {}

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ MLBB_CV_AutoSync: isCvOn });
    }
  }

  function loadCvAutoSyncState() {
    try {
      const saved = localStorage.getItem('MLBB_CV_AutoSync');
      const isCvOn = saved !== 'false';
      if (cvAutoSyncToggle) {
        cvAutoSyncToggle.checked = isCvOn;
        handleCvToggle();
      }
    } catch {}

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['MLBB_CV_AutoSync'], (res) => {
        if (res && typeof res.MLBB_CV_AutoSync === 'boolean' && cvAutoSyncToggle) {
          cvAutoSyncToggle.checked = res.MLBB_CV_AutoSync;
          handleCvToggle();
        }
      });
    }
  }

  // 3. SWITCH 3: Backend API Server Power
  function handleServerToggle() {
    const isServerOn = serverPowerToggle ? serverPowerToggle.checked : false;

    if (isServerOn) {
      isStoppingServer = false;
      if (moduleServer) moduleServer.classList.add('is-active');
      if (serverToggleDesc) {
        serverToggleDesc.innerHTML = 'Starting Server (Port 5000)...';
      }

      // Trigger native protocol handler to start Python server silently in background
      const link = document.createElement('a');
      link.href = 'mlbb://start-server';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Poll every 800ms for 5 attempts to catch server coming online
      let attempts = 0;
      const pollTimer = setInterval(() => {
        attempts++;
        fetch('http://127.0.0.1:5000/status')
          .then((res) => res.json())
          .then((data) => {
            if (data.status === 'online') {
              clearInterval(pollTimer);
              pollStatus();
            }
          })
          .catch(() => {
            if (attempts >= 6) clearInterval(pollTimer);
          });
      }, 800);
    } else {
      isStoppingServer = true;
      if (moduleServer) moduleServer.classList.remove('is-active');
      if (serverToggleDesc) {
        serverToggleDesc.innerHTML = 'Server Stopped / Offline';
      }
      if (btnOpenBrowser) {
        btnOpenBrowser.className = 'btn-header-browser status-offline';
      }

      fetch('http://127.0.0.1:5000/shutdown', { method: 'POST' })
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            isStoppingServer = false;
          }, 2000);
        });
    }
  }

  function openPage(targetPath) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'OPEN_PAGE', page: targetPath });
    } else {
      window.open(targetPath, '_blank');
    }
  }

  function pollStatus() {
    if (isStoppingServer || isPolling) return;
    isPolling = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    fetch('http://127.0.0.1:5000/status', { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        clearTimeout(timeoutId);
        consecutiveFailures = 0;
        if (isStoppingServer) return;

        // Border Indicator Logic:
        // 1. Green Border: Full system is online (Server online + BlueStacks online + Game running / active phase)
        // 2. Orange Border: Only BlueStacks is open (Server + BlueStacks online, game in standby)
        // 3. Neutral/Subtle Border: Offline / Server Standby
        if (btnOpenBrowser) {
          if (data.status === 'online' && data.bluestacks && (data.gameRunning || (data.gamePhase && data.gamePhase !== 'N/A'))) {
            btnOpenBrowser.className = 'btn-header-browser status-full-online';
          } else if (data.status === 'online' && data.bluestacks) {
            btnOpenBrowser.className = 'btn-header-browser status-bs-only';
          } else {
            btnOpenBrowser.className = 'btn-header-browser status-offline';
          }
        }

        if (moduleServer) moduleServer.classList.add('is-active');
        if (serverPowerToggle && !serverPowerToggle.checked) {
          serverPowerToggle.checked = true;
        }
        if (popPortLink) {
          popPortLink.innerText = data.device || '127.0.0.1:5555';
        }

        if (!isStoppingBs) {
          if (moduleBs) {
            if (data.bluestacks) moduleBs.classList.add('is-active');
            else moduleBs.classList.remove('is-active');
          }
          if (bsInstanceToggle) {
            bsInstanceToggle.checked = !!data.bluestacks;
            if (bsToggleDesc) {
              if (!data.bluestacks) {
                bsToggleDesc.innerText = 'Closed';
              } else if (data.gameRunning || (data.gamePhase && data.gamePhase !== 'N/A' && data.gamePhase !== 'Standby' && data.gamePhase !== 'STANDBY' && data.gamePhase !== 'OFFLINE')) {
                bsToggleDesc.innerText = 'Playing';
              } else {
                bsToggleDesc.innerText = 'Running';
              }
            }
          }
        }

        if (popGamePhase) {
          const nextPhase = (data.gamePhase || 'STANDBY').toUpperCase();
          if (popGamePhase.innerText !== nextPhase) {
            popGamePhase.innerText = nextPhase;
            popGamePhase.classList.remove('phase-pulse');
            void popGamePhase.offsetWidth;
            popGamePhase.classList.add('phase-pulse');
          }
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        consecutiveFailures++;

        // Only transition to Offline if 3 consecutive polls fail (prevents flickering)
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || isStoppingServer) {
          if (btnOpenBrowser) {
            btnOpenBrowser.className = 'btn-header-browser status-offline';
          }
          if (moduleServer) moduleServer.classList.remove('is-active');
          if (moduleBs) moduleBs.classList.remove('is-active');
          if (serverPowerToggle && !isStoppingServer) {
            serverPowerToggle.checked = false;
            if (serverToggleDesc) {
              serverToggleDesc.innerHTML = 'Server Offline (Switch ON to Start)';
            }
          }
          if (bsInstanceToggle) {
            bsInstanceToggle.checked = false;
            if (bsToggleDesc) {
              bsToggleDesc.innerText = 'Closed';
            }
          }
          if (popGamePhase) popGamePhase.innerText = 'OFFLINE';
        }
      })
      .finally(() => {
        isPolling = false;
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
