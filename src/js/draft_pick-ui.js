/**
 * MLBB Companion — Draft Pick Board UI Renderer (draft-ui.js)
 * Modular controller for Ban Slots, Pick Tabs, Battle Spells, Equipment Slots, and Board Events.
 */
(function () {
  'use strict';

  const resetDraftBtn = document.getElementById('resetDraftBtn');
  const allyBansContainer = document.getElementById('allyBansContainer');
  const enemyBansContainer = document.getElementById('enemyBansContainer');
  const allySlotsContainer = document.getElementById('allySlotsContainer');
  const enemySlotsContainer = document.getElementById('enemySlotsContainer');
  const rankSelector = document.getElementById('rankSelector');
  const recHeroGrid = document.getElementById('recommended-heroes-grid');

  const LANE_CONFIGS = [
    { name: 'EXP', key: 'exp', color: '#fb923c' },
    { name: 'Jungle', key: 'jungle', color: '#34d399' },
    { name: 'Mid', key: 'mid', color: '#c084fc' },
    { name: 'Gold', key: 'gold', color: '#facc15' },
    { name: 'Roam', key: 'roam', color: '#38bdf8' }
  ];
  const CANCEL_REVEAL_DELAY_MS = 420;
  const cancelRevealTimers = new WeakMap();

  function getRoleClass(role) {
    if (!role) return '';
    const r = role.toLowerCase();
    if (r.includes('tank')) return 'role--tank';
    if (r.includes('fighter')) return 'role--fighter';
    if (r.includes('assassin')) return 'role--assassin';
    if (r.includes('mage')) return 'role--mage';
    if (r.includes('marksman')) return 'role--marksman';
    if (r.includes('support')) return 'role--support';
    return '';
  }

  function clearCancelReveal(action) {
    const timer = cancelRevealTimers.get(action);
    if (timer) {
      window.clearTimeout(timer);
      cancelRevealTimers.delete(action);
    }
    action.classList.remove('is-cancel-ready');
  }

  function armCancelReveal(action) {
    if (action.classList.contains('is-cancel-ready') || cancelRevealTimers.has(action)) return;
    cancelRevealTimers.set(action, window.setTimeout(() => {
      cancelRevealTimers.delete(action);
      action.classList.add('is-cancel-ready');
    }, CANCEL_REVEAL_DELAY_MS));
  }

  function init() {
    bindEvents();
    render();
  }

  function bindEvents() {
    if (resetDraftBtn) {
      resetDraftBtn.addEventListener('click', () => {
        window.DraftState.reset();
      });
    }

    if (rankSelector) {
      rankSelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.rank-btn');
        if (!btn) return;
        rankSelector.querySelectorAll('.rank-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const count = parseInt(btn.getAttribute('data-bans'), 10);
        window.DraftState.setBanCount(count);
        updateBanLabels(count);
      });
    }

    // Ban slots delegation (No red marks/slashes)
    [allyBansContainer, enemyBansContainer].forEach((container) => {
      if (!container) return;
      container.addEventListener('click', (e) => {
        const slot = e.target.closest('.ban-slot-circle');
        if (!slot) return;
        const side = slot.getAttribute('data-side');
        const index = parseInt(slot.getAttribute('data-index'), 10);
        window.DraftModal.openHeroPicker(side, index, 'ban');
      });

      container.addEventListener('contextmenu', (e) => {
        const slot = e.target.closest('.ban-slot-circle');
        if (!slot) return;
        e.preventDefault();
        const side = slot.getAttribute('data-side');
        const index = parseInt(slot.getAttribute('data-index'), 10);
        window.DraftState.clearBan(side, index);
      });
    });

    // Pick, Spell, and Equipment slots delegation
    [allySlotsContainer, enemySlotsContainer].forEach((container) => {
      if (!container) return;

      container.addEventListener('pointermove', (e) => {
        const action = e.target.closest('.hero-slot-portrait-action');
        const readyAction = container.querySelector('.hero-slot-portrait-action.is-cancel-ready');
        if (readyAction && readyAction !== action) clearCancelReveal(readyAction);
        if (!action || !action.querySelector('.btn-slot-clear')) return;

        // The dismiss control is deliberate: linger in the portrait's top-right corner.
        if (e.target.closest('.btn-slot-clear')) return;
        const bounds = action.getBoundingClientRect();
        const isTopRightHotspot =
          e.clientX >= bounds.left + bounds.width * 0.54 &&
          e.clientX <= bounds.right + 8 &&
          e.clientY >= bounds.top - 8 &&
          e.clientY <= bounds.top + bounds.height * 0.46;

        if (isTopRightHotspot) armCancelReveal(action);
        else clearCancelReveal(action);
      });

      container.addEventListener('pointerout', (e) => {
        const action = e.target.closest('.hero-slot-portrait-action');
        if (action && !action.contains(e.relatedTarget)) clearCancelReveal(action);
      });

      container.addEventListener('click', (e) => {
        // 1. Equipment Clear Button Click
        const equipClearBtn = e.target.closest('.btn-equip-clear');
        if (equipClearBtn) {
          e.stopPropagation();
          const side = equipClearBtn.getAttribute('data-side');
          const sIdx = parseInt(equipClearBtn.getAttribute('data-slot-index'), 10);
          const eqIdx = parseInt(equipClearBtn.getAttribute('data-equip-index'), 10);
          window.DraftState.clearEquipment(side, sIdx, eqIdx);
          return;
        }

        // 2. Equipment Slot Click -> Open Item Picker
        const equipBox = e.target.closest('.equip-slot-box');
        if (equipBox) {
          e.stopPropagation();
          const side = equipBox.getAttribute('data-side');
          const sIdx = parseInt(equipBox.getAttribute('data-slot-index'), 10);
          const eqIdx = parseInt(equipBox.getAttribute('data-equip-index'), 10);
          window.DraftModal.openItemPicker(side, sIdx, eqIdx);
          return;
        }

        // 3. Battle Spell Slot Click -> Open Spell Picker
        const spellBox = e.target.closest('.spell-slot-box');
        if (spellBox) {
          e.stopPropagation();
          const side = spellBox.getAttribute('data-side');
          const sIdx = parseInt(spellBox.getAttribute('data-slot-index'), 10);
          window.DraftModal.openSpellPicker(side, sIdx);
          return;
        }

        // 4. Hero Clear Button Click
        const clearBtn = e.target.closest('.btn-slot-clear');
        if (clearBtn) {
          e.stopPropagation();
          const side = clearBtn.getAttribute('data-side');
          const index = parseInt(clearBtn.getAttribute('data-index'), 10);
          window.DraftState.clearPick(side, index);
          return;
        }

        // 5. Hero Portrait Area Click ONLY -> Open Hero Picker Modal
        const portraitBox = e.target.closest('.hero-slot-portrait-action, .hero-slot-portrait-box, .empty-plus');
        if (portraitBox) {
          e.stopPropagation();
          const card = portraitBox.closest('.hero-slot-card');
          if (!card) return;
          const side = card.getAttribute('data-side');
          const index = parseInt(card.getAttribute('data-index'), 10);
          window.DraftModal.openHeroPicker(side, index, 'pick');
          return;
        }

        // 6. Hero Slot Card Click (Outside portrait/equip/spell) -> Set Active Tab Selection / Highlight
        const slot = e.target.closest('.hero-slot-card');
        if (slot) {
          const side = slot.getAttribute('data-side');
          const index = parseInt(slot.getAttribute('data-index'), 10);
          window.DraftState.setActiveSelection({ side, index, type: 'pick', equipIndex: null });
          window.DraftState.notify();
          return;
        }
      });

      container.addEventListener('contextmenu', (e) => {
        // Equipment Right-Click Clear
        const equipBox = e.target.closest('.equip-slot-box');
        if (equipBox) {
          e.preventDefault();
          e.stopPropagation();
          const side = equipBox.getAttribute('data-side');
          const sIdx = parseInt(equipBox.getAttribute('data-slot-index'), 10);
          const eqIdx = parseInt(equipBox.getAttribute('data-equip-index'), 10);
          window.DraftState.clearEquipment(side, sIdx, eqIdx);
          return;
        }

        // Spell Right-Click Reset
        const spellBox = e.target.closest('.spell-slot-box');
        if (spellBox) {
          e.preventDefault();
          e.stopPropagation();
          const side = spellBox.getAttribute('data-side');
          const sIdx = parseInt(spellBox.getAttribute('data-slot-index'), 10);
          window.DraftState.clearSpell(side, sIdx);
          return;
        }

        // Hero Slot Right-Click Clear
        const slot = e.target.closest('.hero-slot-card');
        if (!slot) return;
        e.preventDefault();
        const side = slot.getAttribute('data-side');
        const index = parseInt(slot.getAttribute('data-index'), 10);
        window.DraftState.clearPick(side, index);
      });
    });

    if (recHeroGrid) {
      recHeroGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.rec-hero-card');
        if (!card) return;
        const heroId = card.getAttribute('data-hero-id');
        if (heroId) window.DraftState.selectRecommendedHero(heroId);
      });
    }
  }

  function updateBanLabels(count) {
    const aLbl = document.getElementById('allyBanCountLabel');
    const eLbl = document.getElementById('enemyBanCountLabel');
    if (aLbl) aLbl.innerText = `${count} Bans`;
    if (eLbl) eLbl.innerText = `${count} Bans`;
  }

  function renderBans() {
    if (!allyBansContainer || !enemyBansContainer) return;
    const st = window.DraftState.get();
    const sel = st.activeSelection;

    allyBansContainer.innerHTML = st.allyBans.map((h, i) => {
      const isSel = (sel.side === 'ally' && sel.index === i && sel.type === 'ban');
      return `
        <div class="ban-slot-circle ${h ? 'occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="ally" data-index="${i}" data-type="ban"
             title="${h ? 'Banned: ' + h.name + ' (Right-click to remove)' : 'Click to Ban Hero'}">
          ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}" class="ban-slot-img">` : '<span class="ban-empty-plus">+</span>'}
        </div>
      `;
    }).join('');

    enemyBansContainer.innerHTML = st.enemyBans.map((h, i) => {
      const isSel = (sel.side === 'enemy' && sel.index === i && sel.type === 'ban');
      return `
        <div class="ban-slot-circle ban-slot-circle--enemy ${h ? 'occupied' : ''} ${isSel ? 'is-selected' : ''}"
             data-side="enemy" data-index="${i}" data-type="ban"
             title="${h ? 'Banned: ' + h.name + ' (Right-click to remove)' : 'Click to Ban Hero'}">
          ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}" class="ban-slot-img">` : '<span class="ban-empty-plus">+</span>'}
        </div>
      `;
    }).join('');
  }

  function renderSlots() {
    if (!allySlotsContainer || !enemySlotsContainer) return;
    const st = window.DraftState.get();
    const sel = st.activeSelection;

    // Render Blue Ally Pick Cards (Left Aligned)
    allySlotsContainer.innerHTML = st.allyTeam.map((h, i) => {
      const lane = LANE_CONFIGS[i] || { name: 'Role', key: 'exp' };
      const roleCls = h ? getRoleClass(h.role) : '';
      const spellId = st.allySpells[i] || 'flicker';
      const spell = window.DraftState.resolveSpellInfo(spellId);
      const equips = st.allyEquipments[i] || [];
      const isSel = (sel.side === 'ally' && sel.index === i);

      return `
        <div class="hero-slot-card slot--ally ${h ? 'slot-occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="ally" data-index="${i}" data-type="pick"
             title="${h ? h.name + ' (' + h.role + ') — Right-click to remove' : 'Click to Pick ' + lane.name}">
          <span class="hero-slot-lane-top-tag lane-slot-box lane-slot-box--${lane.key}" title="${lane.name} role">
            <span class="lane-slot-label">${lane.name}</span>
          </span>

          <div class="hero-slot-left-group">
            <div class="hero-slot-portrait-action">
              <div class="hero-slot-portrait-box hero-slot-portrait-box--round">
                ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}">` : '<span class="empty-plus">+</span>'}
              </div>
              ${h ? `<button class="btn-slot-clear" data-side="ally" data-index="${i}" title="Remove ${h.name}">✕</button>` : ''}
            </div>

            <div class="hero-slot-info">
              <span class="hero-slot-name">${h ? h.name : 'Select Hero'}</span>
              <div class="hero-slot-role">
                ${isSel ? `<span class="my-hero-tag">MY HERO</span>` : ''}
                ${h ? `<span class="role-badge-tag ${roleCls}">${h.role}</span>` : `<span class="slot-number-tag">SLOT ${i + 1}</span>`}
              </div>
            </div>
          </div>

          <div class="hero-equip-slots-bar" data-side="ally" data-slot-index="${i}">
            ${[0, 1, 2, 3, 4, 5].map((eqIdx) => {
              const it = equips[eqIdx];
              return `
                <div class="equip-slot-box ${it ? 'occupied' : ''}" 
                     data-side="ally" data-slot-index="${i}" data-equip-index="${eqIdx}"
                     title="${it ? it.name + ' (Click to change / Right-click to clear)' : 'Item Slot ' + (eqIdx + 1)}">
                  ${it ? `<img src="${window.DraftState.resolveItemAvatar(it)}" alt="${it.name}">` : '<span class="equip-empty-dot"></span>'}
                  ${it ? `<button class="btn-equip-clear" data-side="ally" data-slot-index="${i}" data-equip-index="${eqIdx}" title="Remove Item">✕</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <button type="button" class="spell-slot-box hero-spell-button"
                  data-side="ally" data-slot-index="${i}"
                  title="Battle spell: ${spell.name} (CD: ${spell.cooldown || spell.cd || '90s'}) · Click to change">
            <img src="${window.DraftState.resolveSpellAvatar(spellId)}" alt="${spell.name}" class="spell-slot-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';">
            <span class="spell-icon-glyph" style="display:none; color:${spell.color || '#38bdf8'};">${spell.icon || '⚡'}</span>
          </button>
        </div>
      `;
    }).join('');

    // Render Red Enemy Pick Cards (Left Aligned matching Ally side)
    enemySlotsContainer.innerHTML = st.enemyTeam.map((h, i) => {
      const lane = LANE_CONFIGS[i] || { name: 'Role', key: 'exp' };
      const roleCls = h ? getRoleClass(h.role) : '';
      const spellId = st.enemySpells[i] || 'flicker';
      const spell = window.DraftState.resolveSpellInfo(spellId);
      const equips = st.enemyEquipments[i] || [];
      const isSel = (sel.side === 'enemy' && sel.index === i);

      return `
        <div class="hero-slot-card slot--enemy ${h ? 'slot-occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="enemy" data-index="${i}" data-type="pick"
             title="${h ? h.name + ' (' + h.role + ') — Right-click to remove' : 'Click to Pick Enemy ' + lane.name}">
          <span class="hero-slot-lane-top-tag lane-slot-box lane-slot-box--${lane.key}" title="${lane.name} role">
            <span class="lane-slot-label">${lane.name}</span>
          </span>

          <div class="hero-slot-left-group">
            <div class="hero-slot-portrait-action">
              <div class="hero-slot-portrait-box hero-slot-portrait-box--round">
                ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}">` : '<span class="empty-plus">+</span>'}
              </div>
              ${h ? `<button class="btn-slot-clear" data-side="enemy" data-index="${i}" title="Remove ${h.name}">✕</button>` : ''}
            </div>

            <div class="hero-slot-info">
              <span class="hero-slot-name">${h ? h.name : 'Select Hero'}</span>
              <div class="hero-slot-role">
                ${isSel ? `<span class="target-hero-tag">TARGET</span>` : ''}
                ${h ? `<span class="role-badge-tag ${roleCls}">${h.role}</span>` : `<span class="slot-number-tag">SLOT ${i + 1}</span>`}
              </div>
            </div>
          </div>

          <div class="hero-equip-slots-bar" data-side="enemy" data-slot-index="${i}">
            ${[0, 1, 2, 3, 4, 5].map((eqIdx) => {
              const it = equips[eqIdx];
              return `
                <div class="equip-slot-box ${it ? 'occupied' : ''}" 
                     data-side="enemy" data-slot-index="${i}" data-equip-index="${eqIdx}"
                     title="${it ? it.name + ' (Click to change / Right-click to clear)' : 'Item Slot ' + (eqIdx + 1)}">
                  ${it ? `<img src="${window.DraftState.resolveItemAvatar(it)}" alt="${it.name}">` : '<span class="equip-empty-dot"></span>'}
                  ${it ? `<button class="btn-equip-clear" data-side="enemy" data-slot-index="${i}" data-equip-index="${eqIdx}" title="Remove Item">✕</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <button type="button" class="spell-slot-box hero-spell-button"
                  data-side="enemy" data-slot-index="${i}"
                  title="Battle spell: ${spell.name} (CD: ${spell.cooldown || spell.cd || '90s'}) · Click to change">
            <img src="${window.DraftState.resolveSpellAvatar(spellId)}" alt="${spell.name}" class="spell-slot-img" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';">
            <span class="spell-icon-glyph" style="display:none; color:${spell.color || '#38bdf8'};">${spell.icon || '⚡'}</span>
          </button>
        </div>
      `;
    }).join('');
  }

  function animateSlotLock(side, index) {
    const container = side === 'ally' ? allySlotsContainer : enemySlotsContainer;
    const card = container?.querySelector(`[data-index="${index}"]`);
    if (card) {
      card.classList.add('slot-just-locked');
      setTimeout(() => card.classList.remove('slot-just-locked'), 800);
    }
  }

  function render() {
    renderBans();
    renderSlots();
  }

  window.DraftBoardUI = {
    init,
    render,
    renderBans,
    renderSlots,
    animateSlotLock
  };
})();
