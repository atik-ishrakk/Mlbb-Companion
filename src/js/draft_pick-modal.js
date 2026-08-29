/**
 * MLBB Companion — Full-Page Modal Controller (draft-modal.js)
 * Modular controller for Hero and Equipment selection layers.
 */
(function () {
  'use strict';

  let modalSide = 'ally';
  let modalIndex = 0;
  let modalType = 'pick';
  let modalActiveRole = 'All';

  let modalEquipSlotIndex = 0;
  let modalEquipIndex = 0;
  let modalActiveItemCategory = 'All';

  // DOM Elements
  const heroSelectModal = document.getElementById('heroSelectModal');
  const btnCloseHeroModal = document.getElementById('btnCloseHeroModal');
  const heroSearchInput = document.getElementById('heroSearchInput');
  const modalHeroTitle = document.getElementById('modalHeroTitle');
  const modalHeroGrid = document.getElementById('modalHeroGrid');
  const roleFilterBar = document.getElementById('roleFilterBar');

  const itemSelectModal = document.getElementById('itemSelectModal');
  const btnCloseItemModal = document.getElementById('btnCloseItemModal');
  const itemSearchInput = document.getElementById('itemSearchInput');
  const modalItemTitle = document.getElementById('modalItemTitle');
  const modalItemGrid = document.getElementById('modalItemGrid');
  const itemCategoryFilterBar = document.getElementById('itemCategoryFilterBar');

  const LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];

  function init() {
    bindEvents();
  }

  function bindEvents() {
    // Hero modal events
    if (btnCloseHeroModal) {
      btnCloseHeroModal.addEventListener('click', closeHeroPicker);
    }
    if (heroSelectModal) {
      heroSelectModal.addEventListener('click', (e) => {
        if (e.target === heroSelectModal) closeHeroPicker();
      });
    }
    if (heroSearchInput) {
      heroSearchInput.addEventListener('input', renderHeroes);
    }
    if (roleFilterBar) {
      roleFilterBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        roleFilterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        modalActiveRole = btn.getAttribute('data-role') || 'All';
        renderHeroes();
      });
    }
    if (modalHeroGrid) {
      modalHeroGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.grid-hero-card');
        if (!card || card.classList.contains('disabled')) return;
        const heroId = card.getAttribute('data-hero-id');
        if (heroId) {
          window.DraftState.selectHero(heroId, modalSide, modalIndex, modalType);
          closeHeroPicker();
        }
      });
    }

    // Item modal events
    if (btnCloseItemModal) {
      btnCloseItemModal.addEventListener('click', closeItemPicker);
    }
    if (itemSelectModal) {
      itemSelectModal.addEventListener('click', (e) => {
        if (e.target === itemSelectModal) closeItemPicker();
      });
    }
    if (itemSearchInput) {
      itemSearchInput.addEventListener('input', renderItems);
    }
    if (itemCategoryFilterBar) {
      itemCategoryFilterBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        itemCategoryFilterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        modalActiveItemCategory = btn.getAttribute('data-category') || 'All';
        renderItems();
      });
    }
    if (modalItemGrid) {
      modalItemGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.grid-item-card');
        if (!card) return;
        const itemId = card.getAttribute('data-item-id');
        if (itemId) {
          window.DraftState.selectEquipment(itemId, modalSide, modalEquipSlotIndex, modalEquipIndex);
          closeItemPicker();
        }
      });
    }

    // Keyboard ESC listener
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeHeroPicker();
        closeItemPicker();
      }
    });
  }

  function openHeroPicker(side, index, type) {
    modalSide = side;
    modalIndex = index;
    modalType = type;
    window.DraftState.setActiveSelection({ side, index, type, equipIndex: null });
    window.DraftState.notify();

    if (heroSearchInput) heroSearchInput.value = '';

    if (modalHeroTitle) {
      const lane = LANES[index] || `Slot ${index + 1}`;
      modalHeroTitle.innerHTML = type === 'ban' 
        ? `<span class="hud-prefix">//</span> BAN HERO [${side.toUpperCase()}]`
        : `<span class="hud-prefix">//</span> SELECT ${lane.toUpperCase()} HERO [${side.toUpperCase()}]`;
    }

    renderHeroes();
    if (heroSelectModal) {
      heroSelectModal.classList.remove('hidden');
      if (heroSearchInput) heroSearchInput.focus();
    }
  }

  function closeHeroPicker() {
    window.DraftState.setActiveSelection(null);
    window.DraftState.notify();
    if (heroSelectModal) heroSelectModal.classList.add('hidden');
  }

  function renderHeroes() {
    if (!modalHeroGrid) return;
    const heroes = window.DraftState.getHeroesDb();
    const q = (heroSearchInput?.value || '').toLowerCase().trim();
    const st = window.DraftState.get();

    const unavailableIds = [...st.allyTeam, ...st.enemyTeam, ...st.allyBans, ...st.enemyBans]
      .filter((h) => h !== null)
      .map((h) => h.id);

    const filtered = heroes.filter((h) => {
      if (!h) return false;
      const matchQuery = !q || h.name.toLowerCase().includes(q) || h.id.toLowerCase().includes(q);
      const matchRole = modalActiveRole === 'All' || h.role.toLowerCase().includes(modalActiveRole.toLowerCase());
      return matchQuery && matchRole;
    });

    modalHeroGrid.innerHTML = filtered.map((h) => {
      const isTaken = unavailableIds.includes(h.id);
      return `
        <div class="grid-hero-card ${isTaken ? 'disabled' : ''}" data-hero-id="${h.id}" title="${h.name} (${h.role})">
          <img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}" class="grid-hero-avatar">
          <span class="grid-hero-name">${h.name}</span>
        </div>
      `;
    }).join('');
  }

  function openItemPicker(side, slotIndex, equipIndex) {
    modalSide = side;
    modalEquipSlotIndex = slotIndex;
    modalEquipIndex = equipIndex;
    window.DraftState.setActiveSelection({ side, index: slotIndex, type: 'item', equipIndex });
    window.DraftState.notify();

    if (itemSearchInput) itemSearchInput.value = '';

    if (modalItemTitle) {
      const st = window.DraftState.get();
      const hero = (side === 'ally' ? st.allyTeam : st.enemyTeam)[slotIndex];
      const heroName = hero ? hero.name : `Slot ${slotIndex + 1}`;
      modalItemTitle.innerHTML = `<span class="hud-prefix">//</span> SELECT ITEM ${equipIndex + 1} FOR ${heroName.toUpperCase()} [${side.toUpperCase()}]`;
    }

    renderItems();
    if (itemSelectModal) {
      itemSelectModal.classList.remove('hidden');
      if (itemSearchInput) itemSearchInput.focus();
    }
  }

  function closeItemPicker() {
    window.DraftState.setActiveSelection(null);
    window.DraftState.notify();
    if (itemSelectModal) itemSelectModal.classList.add('hidden');
  }

  function renderItems() {
    if (!modalItemGrid) return;
    const items = window.DraftState.getItemsDb();
    const q = (itemSearchInput?.value || '').toLowerCase().trim();
    const st = window.DraftState.get();
    const currentEquip = (modalSide === 'ally' ? st.allyEquipments : st.enemyEquipments)?.[modalEquipSlotIndex]?.[modalEquipIndex];

    const filtered = items.filter((it) => {
      if (!it || !it.name) return false;
      const cat = (it.category || it.type || '').toLowerCase();
      const matchQuery = !q || it.name.toLowerCase().includes(q) || (it.stats && it.stats.toLowerCase().includes(q));
      
      let matchCat = (modalActiveItemCategory === 'All');
      if (!matchCat) {
        const filterLower = modalActiveItemCategory.toLowerCase();
        if (filterLower === 'attack') matchCat = cat.includes('attack') || cat.includes('physical');
        else if (filterLower === 'magic') matchCat = cat.includes('magic');
        else if (filterLower === 'defense') matchCat = cat.includes('defense');
        else if (filterLower === 'movement') matchCat = cat.includes('movement');
        else if (filterLower === 'roam') matchCat = cat.includes('roam') || it.name.toLowerCase().includes('retribution') || it.name.toLowerCase().includes('conceal') || it.name.toLowerCase().includes('favor');
      }
      return matchQuery && matchCat;
    });

    modalItemGrid.innerHTML = filtered.map((it) => {
      const isCurrent = currentEquip && currentEquip.id === it.id;
      return `
        <div class="grid-item-card ${isCurrent ? 'is-selected' : ''}" data-item-id="${it.id}" title="${it.name}\n${it.stats || it.description || ''}">
          <img src="${window.DraftState.resolveItemAvatar(it)}" alt="${it.name}" class="grid-item-avatar">
          <div class="grid-item-info">
            <span class="grid-item-name">${it.name}</span>
            <span class="grid-item-category">${it.category || it.type || 'Equipment'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  window.DraftModal = {
    init,
    openHeroPicker,
    closeHeroPicker,
    openItemPicker,
    closeItemPicker,
    renderHeroes,
    renderItems
  };
})();
