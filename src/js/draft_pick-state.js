/**
 * MLBB Companion — Draft Pick State Manager (draft-state.js)
 * Modular Single-Source-of-Truth for Picks, Bans, Spells, Equipment, and Persistence.
 */
(function () {
  'use strict';

  const LS_KEY = 'MLBB_Brave_DraftState';
  const listeners = [];

  const DEFAULT_SPELLS_BY_LANE = [
    'vengeance',    // Slot 0: EXP Lane
    'retribution',  // Slot 1: Jungle
    'flicker',      // Slot 2: Mid Lane
    'inspire',      // Slot 3: Gold Lane
    'flicker'       // Slot 4: Roam
  ];

  const SPELL_META = {
    flicker: { id: 'flicker', name: 'Flicker', icon: '⚡', color: '#38bdf8', cd: '120s' },
    retribution: { id: 'retribution', name: 'Retribution', icon: '🗡️', color: '#f59e0b', cd: '35s' },
    purify: { id: 'purify', name: 'Purify', icon: '🛡️', color: '#34d399', cd: '90s' },
    inspire: { id: 'inspire', name: 'Inspire', icon: '🏹', color: '#facc15', cd: '75s' },
    vengeance: { id: 'vengeance', name: 'Vengeance', icon: '🌀', color: '#fb923c', cd: '75s' },
    execute: { id: 'execute', name: 'Execute', icon: '⚔️', color: '#ef4444', cd: '90s' },
    aegis: { id: 'aegis', name: 'Aegis', icon: '🔰', color: '#60a5fa', cd: '90s' },
    revitalize: { id: 'revitalize', name: 'Revitalize', icon: '🌿', color: '#10b981', cd: '100s' },
    sprint: { id: 'sprint', name: 'Sprint', icon: '👟', color: '#38bdf8', cd: '100s' },
    petrify: { id: 'petrify', name: 'Petrify', icon: '🗿', color: '#a855f7', cd: '90s' },
    flameshot: { id: 'flameshot', name: 'Flameshot', icon: '🔥', color: '#f97316', cd: '50s' },
    arrival: { id: 'arrival', name: 'Arrival', cooldown: '75s', icon: '🚪', color: '#c084fc', cd: '75s' }
  };

  const state = {
    maxBans: 5,
    allyTeam: new Array(5).fill(null),
    enemyTeam: new Array(5).fill(null),
    allyBans: new Array(5).fill(null),
    enemyBans: new Array(5).fill(null),
    allySpells: [...DEFAULT_SPELLS_BY_LANE],
    enemySpells: [...DEFAULT_SPELLS_BY_LANE],
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

  function getSpellsDb() {
    return window.MLBBData?.spells || Object.values(SPELL_META);
  }

  function resolveSpellInfo(spellId) {
    if (!spellId) return null;
    return SPELL_META[spellId] || { id: spellId, name: spellId, icon: '✨', color: '#38bdf8', cd: '75s' };
  }

  function resolveSpellAvatar(spell) {
    if (!spell) return '../assets/img/placeholder.svg';
    const id = typeof spell === 'string' ? spell : spell.id;
    if (id) return `../assets/spells/${id}.png`;
    return '../assets/img/placeholder.svg';
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

    const role = (hero.role || '').toLowerCase();
    let defaultIds = [];

    if (role.includes('marksman')) {
      defaultIds = ['corrosion_scythe', 'demon_hunter_sword', 'golden_staff', 'windtalker', 'wind_of_nature', 'blade_of_despair'];
    } else if (role.includes('mage')) {
      defaultIds = ['demon_shoes', 'lightning_truncheon', 'genius_wand', 'holy_crystal', 'divine_glaive', 'blood_wings'];
    } else if (role.includes('assassin')) {
      defaultIds = ['magic_shoes', 'hunter_strike', 'blade_of_despair', 'endless_battle', 'malefic_roar', 'immortality'];
    } else if (role.includes('tank')) {
      defaultIds = ['tough_boots', 'dominance_ice', 'athenas_shield', 'blade_armor', 'antique_cuirass', 'immortality'];
    } else if (role.includes('support')) {
      defaultIds = ['demon_shoes', 'flask_of_the_oasis', 'fleeting_time', 'dominance_ice', 'athenas_shield', 'immortality'];
    } else {
      defaultIds = ['warrior_boots', 'war_axe', 'brute_force_breastplate', 'hunter_strike', 'malefic_roar', 'immortality'];
    }

    return defaultIds.map(getItem);
  }

  function setBanCount(count) {
    if (![3, 4, 5].includes(count)) return;
    state.maxBans = count;
    state.allyBans = state.allyBans.slice(0, count);
    while (state.allyBans.length < count) state.allyBans.push(null);
    state.enemyBans = state.enemyBans.slice(0, count);
    while (state.enemyBans.length < count) state.enemyBans.push(null);
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

  function selectSpell(spellId, side, slotIndex) {
    if (side === 'ally') {
      state.allySpells[slotIndex] = spellId;
    } else {
      state.enemySpells[slotIndex] = spellId;
    }
    notify();
  }

  function clearSpell(side, slotIndex) {
    const def = DEFAULT_SPELLS_BY_LANE[slotIndex] || 'flicker';
    if (side === 'ally') {
      state.allySpells[slotIndex] = def;
    } else {
      state.enemySpells[slotIndex] = def;
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
    state.allySpells = [...DEFAULT_SPELLS_BY_LANE];
    state.enemySpells = [...DEFAULT_SPELLS_BY_LANE];
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
        allySpells: state.allySpells,
        enemySpells: state.enemySpells,
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
      if (Array.isArray(data.allySpells)) state.allySpells = data.allySpells;
      if (Array.isArray(data.enemySpells)) state.enemySpells = data.enemySpells;

      if (Array.isArray(data.allyEquipments)) {
        state.allyEquipments = data.allyEquipments.map((row) => Array.isArray(row) ? row.map(mapItem) : new Array(6).fill(null));
      }
      if (Array.isArray(data.enemyEquipments)) {
        state.enemyEquipments = data.enemyEquipments.map((row) => Array.isArray(row) ? row.map(mapItem) : new Array(6).fill(null));
      }
    } catch {}
  }

  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function notify() {
    save();
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('[DraftState] Listener error:', err);
      }
    });
  }

  window.DraftState = {
    get: () => state,
    getHeroesDb,
    getItemsDb,
    getSpellsDb,
    resolveSpellInfo,
    resolveSpellAvatar,
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
    selectSpell,
    clearSpell,
    setActiveSelection,
    reset,
    save,
    load,
    subscribe,
    notify
  };
})();
