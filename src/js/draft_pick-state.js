/**
 * MLBB Companion — Draft Pick State Manager (draft-state.js)
 * Modular Single-Source-of-Truth for Picks, Bans, Equipment, and Persistence.
 */
(function () {
  'use strict';

  const LS_KEY = 'MLBB_Brave_DraftState';
  const listeners = [];

  const state = {
    maxBans: 5,
    allyTeam: new Array(5).fill(null),
    enemyTeam: new Array(5).fill(null),
    allyBans: new Array(5).fill(null),
    enemyBans: new Array(5).fill(null),
    allyEquipments: Array.from({ length: 5 }, () => new Array(6).fill(null)),
    enemyEquipments: Array.from({ length: 5 }, () => new Array(6).fill(null)),
    activeSelection: { side: null, index: null, type: null, equipIndex: null }
  };

  function getHeroesDb() {
    return window.MLBBData?.heroes || [];
  }

  function getItemsDb() {
    return window.MLBBData?.items || [];
  }

  function resolveHeroAvatar(hero) {
    if (!hero) return '../assets/img/placeholder.svg';
    if (hero.id) return `../assets/heroes/${hero.id}.png`;
    return hero.avatar || '../assets/img/placeholder.svg';
  }

  function resolveItemAvatar(item) {
    if (!item) return '../assets/img/placeholder.svg';
    if (item.id) return `../assets/items/${item.id}.png`;
    return item.avatar || '../assets/img/placeholder.svg';
  }

  function resolveRectAvatar(hero) {
    if (!hero) return '';
    return `../assets/rect/${hero.id}.png`;
  }

  function getDefaultHeroBuild(hero) {
    if (!hero) return [null, null, null, null, null, null];
    const items = getItemsDb();
    const getItem = (id) => items.find((it) => it.id === id) || { id, name: id.replace(/_/g, ' ') };

    const r = (hero.role || '').toLowerCase();
    let buildIds = [];
    if (r.includes('marksman')) {
      buildIds = ['swift_boots', 'corrosion_scythe', 'demon_hunter_sword', 'golden_staff', 'wind_of_nature', 'blade_of_despair'];
    } else if (r.includes('mage')) {
      buildIds = ['arcane_boots', 'genius_wand', 'lightning_truncheon', 'holy_crystal', 'divine_glaive', 'blood_wings'];
    } else if (r.includes('assassin')) {
      buildIds = ['magic_shoes', 'blade_of_the_heptaseas', 'hunter_strike', 'malefic_roar', 'endless_battle', 'immortality'];
    } else if (r.includes('fighter')) {
      buildIds = ['warrior_boots', 'war_axe', 'brute_force_breastplate', 'endless_battle', 'athena_shield', 'immortality'];
    } else if (r.includes('tank')) {
      buildIds = ['tough_boots', 'dominance_ice', 'athena_shield', 'antique_cuirass', 'blade_armor', 'immortality'];
    } else if (r.includes('support')) {
      buildIds = ['magic_shoes', 'flaskoftheoasis', 'dominance_ice', 'oracle', 'athena_shield', 'immortality'];
    } else {
      buildIds = ['warrior_boots', 'endless_battle', 'blade_of_despair', 'athena_shield', 'antique_cuirass', 'immortality'];
    }
    return buildIds.map(getItem);
  }

  function notify() {
    save();
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { console.error('DraftState listener error:', e); }
    });
  }

  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function setBanCount(count) {
    state.maxBans = count;
    while (state.allyBans.length < state.maxBans) state.allyBans.push(null);
    while (state.allyBans.length > state.maxBans) state.allyBans.pop();
    while (state.enemyBans.length < state.maxBans) state.enemyBans.push(null);
    while (state.enemyBans.length > state.maxBans) state.enemyBans.pop();
    notify();
  }

  function selectHero(heroId, side, index, type) {
    const heroes = getHeroesDb();
    const hero = heroes.find((h) => h.id === heroId);
    if (!hero) return;

    if (type === 'ban') {
      if (side === 'ally') state.allyBans[index] = hero;
      else state.enemyBans[index] = hero;
    } else {
      if (side === 'ally') {
        state.allyTeam[index] = hero;
        if (state.allyEquipments[index].every((x) => x === null)) {
          state.allyEquipments[index] = getDefaultHeroBuild(hero);
        }
      } else {
        state.enemyTeam[index] = hero;
        if (state.enemyEquipments[index].every((x) => x === null)) {
          state.enemyEquipments[index] = getDefaultHeroBuild(hero);
        }
      }
    }
    notify();
  }

  function selectRecommendedHero(heroId) {
    const heroes = getHeroesDb();
    const hero = heroes.find((h) => h.id === heroId);
    if (!hero) return;

    const emptyIdx = state.allyTeam.findIndex((h) => h === null);
    if (emptyIdx !== -1) {
      state.allyTeam[emptyIdx] = hero;
      if (state.allyEquipments[emptyIdx].every((x) => x === null)) {
        state.allyEquipments[emptyIdx] = getDefaultHeroBuild(hero);
      }
      notify();
    }
  }

  function clearPick(side, index) {
    if (side === 'ally') {
      state.allyTeam[index] = null;
      state.allyEquipments[index] = new Array(6).fill(null);
    } else {
      state.enemyTeam[index] = null;
      state.enemyEquipments[index] = new Array(6).fill(null);
    }
    notify();
  }

  function clearBan(side, index) {
    if (side === 'ally') state.allyBans[index] = null;
    else state.enemyBans[index] = null;
    notify();
  }

  function selectEquipment(itemId, side, slotIndex, equipIndex) {
    const items = getItemsDb();
    const item = items.find((it) => it.id === itemId);
    if (!item) return;

    if (side === 'ally') {
      if (!state.allyEquipments[slotIndex]) state.allyEquipments[slotIndex] = new Array(6).fill(null);
      state.allyEquipments[slotIndex][equipIndex] = item;
    } else {
      if (!state.enemyEquipments[slotIndex]) state.enemyEquipments[slotIndex] = new Array(6).fill(null);
      state.enemyEquipments[slotIndex][equipIndex] = item;
    }
    notify();
  }

  function clearEquipment(side, slotIndex, equipIndex) {
    if (side === 'ally') {
      if (state.allyEquipments[slotIndex]) state.allyEquipments[slotIndex][equipIndex] = null;
    } else {
      if (state.enemyEquipments[slotIndex]) state.enemyEquipments[slotIndex][equipIndex] = null;
    }
    notify();
  }

  function setActiveSelection(sel) {
    state.activeSelection = sel || { side: null, index: null, type: null, equipIndex: null };
  }

  function reset() {
    state.allyTeam = new Array(5).fill(null);
    state.enemyTeam = new Array(5).fill(null);
    state.allyBans = new Array(state.maxBans).fill(null);
    state.enemyBans = new Array(state.maxBans).fill(null);
    state.allyEquipments = Array.from({ length: 5 }, () => new Array(6).fill(null));
    state.enemyEquipments = Array.from({ length: 5 }, () => new Array(6).fill(null));
    state.activeSelection = { side: null, index: null, type: null, equipIndex: null };
    notify();
  }

  function save() {
    try {
      const data = {
        maxBans: state.maxBans,
        allyTeam: state.allyTeam.map((h) => h?.id || null),
        enemyTeam: state.enemyTeam.map((h) => h?.id || null),
        allyBans: state.allyBans.map((h) => h?.id || null),
        enemyBans: state.enemyBans.map((h) => h?.id || null),
        allyEquipments: state.allyEquipments.map((row) => row.map((it) => it?.id || null)),
        enemyEquipments: state.enemyEquipments.map((row) => row.map((it) => it?.id || null)),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const heroes = getHeroesDb();
      const items = getItemsDb();
      const mapHero = (id) => heroes.find((h) => h.id === id) || null;
      const mapItem = (id) => items.find((it) => it.id === id) || (id ? { id, name: id.replace(/_/g, ' ') } : null);

      if (data.maxBans) state.maxBans = data.maxBans;
      if (Array.isArray(data.allyTeam)) state.allyTeam = data.allyTeam.map(mapHero);
      if (Array.isArray(data.enemyTeam)) state.enemyTeam = data.enemyTeam.map(mapHero);
      if (Array.isArray(data.allyBans)) state.allyBans = data.allyBans.map(mapHero);
      if (Array.isArray(data.enemyBans)) state.enemyBans = data.enemyBans.map(mapHero);

      if (Array.isArray(data.allyEquipments)) {
        state.allyEquipments = data.allyEquipments.map((row) => Array.isArray(row) ? row.map(mapItem) : new Array(6).fill(null));
      }
      if (Array.isArray(data.enemyEquipments)) {
        state.enemyEquipments = data.enemyEquipments.map((row) => Array.isArray(row) ? row.map(mapItem) : new Array(6).fill(null));
      }
    } catch {}
  }

  window.DraftState = {
    get: () => state,
    getHeroesDb,
    getItemsDb,
    resolveHeroAvatar,
    resolveItemAvatar,
    resolveRectAvatar,
    getDefaultHeroBuild,
    setBanCount,
    selectHero,
    selectRecommendedHero,
    clearPick,
    clearBan,
    selectEquipment,
    clearEquipment,
    setActiveSelection,
    reset,
    save,
    load,
    subscribe,
    notify
  };
})();
