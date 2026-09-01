/**
 * MLBB Companion — Full-Page Modal Controller (draft-modal.js)
 * Modular controller for Hero, Spell, and Equipment selection layers.
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

  let modalSpellSlotIndex = 0;
  let modalActiveSpellCategory = 'All';

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

  const spellSelectModal = document.getElementById('spellSelectModal');
  const btnCloseSpellModal = document.getElementById('btnCloseSpellModal');
  const spellSearchInput = document.getElementById('spellSearchInput');
  const modalSpellTitle = document.getElementById('modalSpellTitle');
  const modalSpellGrid = document.getElementById('modalSpellGrid');
  const spellCategoryFilterBar = document.getElementById('spellCategoryFilterBar');

  const LANES = ['EXP Lane', 'Jungle', 'Mid Lane', 'Gold Lane', 'Roam'];

  function init() {
    bindEvents();
  }

  function bindEvents() {
    // 1. Hero modal events
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

    // 2. Item modal events
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

    // 3. Spell modal events
    if (btnCloseSpellModal) {
      btnCloseSpellModal.addEventListener('click', closeSpellPicker);
    }
    if (spellSelectModal) {
      spellSelectModal.addEventListener('click', (e) => {
        if (e.target === spellSelectModal) closeSpellPicker();
      });
    }
    if (spellSearchInput) {
      spellSearchInput.addEventListener('input', renderSpells);
    }
    if (spellCategoryFilterBar) {
      spellCategoryFilterBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        spellCategoryFilterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        modalActiveSpellCategory = btn.getAttribute('data-category') || 'All';
        renderSpells();
      });
    }
    if (modalSpellGrid) {
      modalSpellGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.grid-spell-card');
        if (!card) return;
        const spellId = card.getAttribute('data-spell-id');
        if (spellId) {
          window.DraftState.selectSpell(spellId, modalSide, modalSpellSlotIndex);
          closeSpellPicker();
        }
      });
    }

    // Keyboard ESC listener
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeHeroPicker();
        closeItemPicker();
        closeSpellPicker();
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
    modalActiveRole = 'All';
    if (roleFilterBar) {
      roleFilterBar.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-role') === 'All');
      });
    }

    if (modalHeroTitle) {
      const isBan = type === 'ban';
      const sideName = side === 'ally' ? 'BLUE ALLY' : 'RED ENEMY';
      const laneName = LANES[index] || `Slot ${index + 1}`;
      const colorCls = side === 'ally' ? 'text-cyan' : 'text-red';
      modalHeroTitle.className = `modal-title-text ${colorCls}`;
      modalHeroTitle.innerHTML = `<span class="hud-prefix">//</span> SELECT HERO ${isBan ? `BAN #${index + 1}` : `PICK: ${laneName.toUpperCase()}`} [${sideName}]`;
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

    const pickedIds = new Set([
      ...st.allyTeam.filter(Boolean).map((h) => h.id),
      ...st.enemyTeam.filter(Boolean).map((h) => h.id),
      ...st.allyBans.filter(Boolean).map((h) => h.id),
      ...st.enemyBans.filter(Boolean).map((h) => h.id)
    ]);

    const currentHero = (modalType === 'ban')
      ? (modalSide === 'ally' ? st.allyBans[modalIndex] : st.enemyBans[modalIndex])
      : (modalSide === 'ally' ? st.allyTeam[modalIndex] : st.enemyTeam[modalIndex]);

    const filtered = heroes.filter((h) => {
      if (!h || !h.name) return false;
      const matchQuery = !q || h.name.toLowerCase().includes(q) || (h.role && h.role.toLowerCase().includes(q));
      const matchRole = (modalActiveRole === 'All') || (h.role && h.role.toLowerCase().includes(modalActiveRole.toLowerCase()));
      return matchQuery && matchRole;
    });

    modalHeroGrid.innerHTML = filtered.map((h) => {
      const isCurrent = currentHero && currentHero.id === h.id;
      const isTaken = pickedIds.has(h.id) && !isCurrent;
      const avatarSrc = window.DraftState.resolveHeroAvatar(h);

      return `
        <div class="grid-hero-card ${isTaken ? 'disabled' : ''} ${isCurrent ? 'is-selected' : ''}" 
             data-hero-id="${h.id}" title="${h.name} (${h.role})">
          <img src="${avatarSrc}" alt="${h.name}" class="grid-hero-avatar" loading="lazy">
          <span class="grid-hero-name">${h.name}</span>
          <span class="grid-hero-role">${h.role}</span>
        </div>
      `;
    }).join('');
  }

  function openItemPicker(side, slotIndex, equipIndex) {
    modalSide = side;
    modalEquipSlotIndex = slotIndex;
    modalEquipIndex = equipIndex;
    window.DraftState.setActiveSelection({ side, index: slotIndex, type: 'pick', equipIndex });
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

  function openSpellPicker(side, slotIndex) {
    modalSide = side;
    modalSpellSlotIndex = slotIndex;

    if (spellSearchInput) spellSearchInput.value = '';
    modalActiveSpellCategory = 'All';
    if (spellCategoryFilterBar) {
      spellCategoryFilterBar.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-category') === 'All');
      });
    }

    if (modalSpellTitle) {
      const st = window.DraftState.get();
      const hero = (side === 'ally' ? st.allyTeam : st.enemyTeam)[slotIndex];
      const heroName = hero ? hero.name : LANES[slotIndex] || `Slot ${slotIndex + 1}`;
      const sideName = side === 'ally' ? 'BLUE ALLY' : 'RED ENEMY';
      const colorCls = side === 'ally' ? 'text-cyan' : 'text-red';
      modalSpellTitle.className = `modal-title-text ${colorCls}`;
      modalSpellTitle.innerHTML = `<span class="hud-prefix">//</span> SELECT BATTLE SPELL FOR ${heroName.toUpperCase()} [${sideName}]`;
    }

    renderSpells();
    if (spellSelectModal) {
      spellSelectModal.classList.remove('hidden');
      if (spellSearchInput) spellSearchInput.focus();
    }
  }

  function closeSpellPicker() {
    if (spellSelectModal) spellSelectModal.classList.add('hidden');
  }

  function renderSpells() {
    if (!modalSpellGrid) return;
    const spells = window.DraftState.getSpellsDb();
    const q = (spellSearchInput?.value || '').toLowerCase().trim();
    const st = window.DraftState.get();
    const currentSpell = (modalSide === 'ally' ? st.allySpells : st.enemySpells)?.[modalSpellSlotIndex];

    const filtered = spells.filter((sp) => {
      if (!sp || !sp.name) return false;
      if (modalActiveSpellCategory !== 'All') {
        const cat = (sp.category || '').toLowerCase();
        if (cat !== modalActiveSpellCategory.toLowerCase()) return false;
      }
      if (q) {
        const text = `${sp.name} ${sp.tag || ''} ${sp.category || ''} ${sp.cooldown || ''} ${sp.description || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      modalSpellGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: #64748b; font-family: var(--font-mono, monospace); font-size: 13px;">
          NO BATTLE SPELLS FOUND MATCHING "${q.toUpperCase()}"
        </div>
      `;
      return;
    }

    modalSpellGrid.innerHTML = filtered.map((sp) => {
      const isCurrent = currentSpell === sp.id;
      const spellColor = sp.color || '#38bdf8';
      return `
        <div class="grid-spell-card ${isCurrent ? 'is-selected' : ''}" 
             data-spell-id="${sp.id}" 
             title="${sp.name} (${sp.cooldown || '90s'})\n${sp.description || ''}">
          <div class="grid-spell-avatar" style="border-color: ${spellColor}; box-shadow: 0 0 12px ${spellColor}40;">
            <img src="${window.DraftState.resolveSpellAvatar(sp)}" alt="${sp.name}" class="grid-spell-avatar-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';">
            <span class="grid-spell-icon" style="display:none; color: ${spellColor};">${sp.icon || '⚡'}</span>
          </div>
          <div class="grid-spell-info">
            <span class="grid-spell-name">${sp.name}</span>
            <div class="grid-spell-meta-row">
              <span class="grid-spell-tag">${sp.tag || sp.category || 'Spell'}</span>
              <span class="grid-spell-cd">${sp.cooldown || sp.cd || '90s'}</span>
            </div>
            <span class="grid-spell-desc">${sp.description || ''}</span>
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
    openSpellPicker,
    closeSpellPicker,
    renderHeroes,
    renderItems,
    renderSpells
  };
})();
