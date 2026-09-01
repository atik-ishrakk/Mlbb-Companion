/**
 * MLBB Companion — 5v5 Live Draft Pick Master Controller (draft_pick.js)
 * Clean, decoupled main orchestrator coordinating State, UI, Modals, and Daemon.
 */
(function () {
  'use strict';

  function triggerRecommendations() {
    if (window.MLBBRecommender?.calculateSuggestions) {
      const st = window.DraftState.get();
      window.MLBBRecommender.calculateSuggestions({
        allyTeam: st.allyTeam,
        enemyTeam: st.enemyTeam,
        heroesDb: window.DraftState.getHeroesDb(),
        itemsDb: window.DraftState.getItemsDb(),
      });
    }
  }

  function setupDraftResizer() {
    const workspace = document.querySelector('.draft-workspace-grid');
    const panel = document.querySelector('.draft-board-container');
    const handle = document.getElementById('draftResizeHandle');
    if (!workspace || !panel || !handle) return;

    const storageKey = 'MLBB_DraftPanelSize';
    const minWidth = 560;
    const minHeight = 430;
    const minStrategyWidth = 320;
    let drag = null;

    const isDesktopLayout = () => window.matchMedia('(min-width: 1241px)').matches;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    function applySize(width, height) {
      if (!isDesktopLayout()) return;
      const maxWidth = Math.max(minWidth, workspace.clientWidth - minStrategyWidth - 16);
      const availableHeight = window.innerHeight - workspace.getBoundingClientRect().top - 16;
      const maxHeight = Math.max(minHeight, availableHeight);
      const safeWidth = clamp(width, minWidth, maxWidth);
      const safeHeight = clamp(height, minHeight, maxHeight);

      workspace.style.gridTemplateColumns = `${safeWidth}px minmax(${minStrategyWidth}px, 1fr)`;
      panel.style.height = `${safeHeight}px`;
      panel.style.alignSelf = 'start';
      return { width: safeWidth, height: safeHeight };
    }

    function restoreSize() {
      if (!isDesktopLayout()) {
        workspace.style.removeProperty('grid-template-columns');
        panel.style.removeProperty('height');
        panel.style.removeProperty('align-self');
        return;
      }
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (Number.isFinite(saved?.width) && Number.isFinite(saved?.height)) {
          applySize(saved.width, saved.height);
        }
      } catch {}
    }

    handle.addEventListener('pointerdown', (event) => {
      if (!isDesktopLayout() || event.button !== 0) return;
      event.preventDefault();
      const bounds = panel.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: bounds.width,
        height: bounds.height
      };
      panel.classList.add('is-resizing');
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      applySize(drag.width + event.clientX - drag.startX, drag.height + event.clientY - drag.startY);
    });

    function finishResize(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (event.type === 'pointercancel') {
        panel.classList.remove('is-resizing');
        drag = null;
        return;
      }
      const size = applySize(drag.width + event.clientX - drag.startX, drag.height + event.clientY - drag.startY);
      if (size) localStorage.setItem(storageKey, JSON.stringify(size));
      panel.classList.remove('is-resizing');
      drag = null;
    }

    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    window.addEventListener('resize', restoreSize);
    restoreSize();
  }

  function init() {
    // 1. Initialize State and Load Saved Draft
    window.DraftState.load();

    // 2. Initialize Board UI
    window.DraftBoardUI.init();

    // 3. Initialize Full-Page Modals
    window.DraftModal.init();

    // 4. Subscribe to State Changes for Reactive Re-renders & Strategy Computation
    window.DraftState.subscribe(() => {
      window.DraftBoardUI.render();
      triggerRecommendations();
    });

    // 5. Initial recommendations calculation
    triggerRecommendations();

    // 6. Start Always-Listening Reactive Daemon
    window.DraftDaemon.start();

    // 7. Enable deliberate, corner-only desktop resizing for the draft board.
    setupDraftResizer();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
