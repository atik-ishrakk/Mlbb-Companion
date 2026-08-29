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
  }

  document.addEventListener('DOMContentLoaded', init);
})();
