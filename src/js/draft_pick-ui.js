/**
 * MLBB Companion — Draft Pick Board UI Renderer (draft-ui.js)
 * Modular controller for Ban Slots, Pick Tabs, Equipment Slots, and Board Events.
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
    { name: 'EXP Lane', short: 'EXP', class: 'lane--exp' },
    { name: 'Jungle', short: 'JNG', class: 'lane--jungle' },
    { name: 'Mid Lane', short: 'MID', class: 'lane--mid' },
    { name: 'Gold Lane', short: 'GLD', class: 'lane--gold' },
    { name: 'Roam', short: 'ROM', class: 'lane--roam' }
  ];

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

    // Ban slots delegation
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

    // Pick & Equipment slots delegation
    [allySlotsContainer, enemySlotsContainer].forEach((container) => {
      if (!container) return;
      container.addEventListener('click', (e) => {
        // 1. Equipment Clear Cross Click
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

        // 3. Hero Clear Button Click
        const clearBtn = e.target.closest('.btn-slot-clear');
        if (clearBtn) {
          e.stopPropagation();
          const side = clearBtn.getAttribute('data-side');
          const index = parseInt(clearBtn.getAttribute('data-index'), 10);
          window.DraftState.clearPick(side, index);
          return;
        }

        // 4. Hero Slot Card Click -> Open Hero Picker
        const slot = e.target.closest('.hero-slot-card');
        if (!slot) return;
        const side = slot.getAttribute('data-side');
        const index = parseInt(slot.getAttribute('data-index'), 10);
        window.DraftModal.openHeroPicker(side, index, 'pick');
      });

      container.addEventListener('contextmenu', (e) => {
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
          ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}" class="ban-slot-img">` : '<span style="color:var(--text-muted);font-size:14px;">+</span>'}
        </div>
      `;
    }).join('');

    enemyBansContainer.innerHTML = st.enemyBans.map((h, i) => {
      const isSel = (sel.side === 'enemy' && sel.index === i && sel.type === 'ban');
      return `
        <div class="ban-slot-circle ${h ? 'occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="enemy" data-index="${i}" data-type="ban"
             title="${h ? 'Banned: ' + h.name + ' (Right-click to remove)' : 'Click to Ban Hero'}">
          ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}" class="ban-slot-img">` : '<span style="color:var(--text-muted);font-size:14px;">+</span>'}
        </div>
      `;
    }).join('');
  }

  function renderSlots() {
    if (!allySlotsContainer || !enemySlotsContainer) return;
    const st = window.DraftState.get();
    const sel = st.activeSelection;

    allySlotsContainer.innerHTML = st.allyTeam.map((h, i) => {
      const lane = LANE_CONFIGS[i] || { name: 'Lane', short: 'LANE', class: 'lane--exp' };
      const roleCls = h ? getRoleClass(h.role) : '';
      const equips = st.allyEquipments[i] || [];
      const isSel = (sel.side === 'ally' && sel.index === i);

      return `
        <div class="hero-slot-card slot--ally ${h ? 'slot-occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="ally" data-index="${i}" data-type="pick"
             title="${h ? h.name + ' (' + h.role + ') — Right-click to remove' : 'Click to Pick ' + lane.name}">
          <div class="hero-slot-portrait-box hero-slot-portrait-box--round">
            ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}">` : '<span class="empty-plus">+</span>'}
            ${h ? `<button class="btn-slot-clear" data-side="ally" data-index="${i}" title="Remove ${h.name}">✕</button>` : ''}
          </div>
          <div class="hero-slot-info">
            <span class="hero-slot-name">${h ? h.name : lane.name}</span>
            <div class="hero-slot-role">
              ${h ? `<span class="role-badge-tag ${roleCls}">${h.role}</span>` : `<span style="color:#64748b;">Slot ${i + 1}</span>`}
            </div>
          </div>
          <div class="hero-equip-slots-bar" data-side="ally" data-slot-index="${i}">
            ${[0, 1, 2, 3, 4, 5].map((eqIdx) => {
              const it = equips[eqIdx];
              return `
                <div class="equip-slot-box ${it ? 'occupied' : ''}" 
                     data-side="ally" data-slot-index="${i}" data-equip-index="${eqIdx}"
                     title="${it ? it.name + ' (Click to change / Right-click to clear)' : 'Slot ' + (eqIdx + 1) + ' Equipment'}">
                  ${it ? `<img src="${window.DraftState.resolveItemAvatar(it)}" alt="${it.name}">` : '<span class="equip-empty-dot"></span>'}
                  ${it ? `<button class="btn-equip-clear" data-side="ally" data-slot-index="${i}" data-equip-index="${eqIdx}" title="Remove Item">✕</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    enemySlotsContainer.innerHTML = st.enemyTeam.map((h, i) => {
      const lane = LANE_CONFIGS[i] || { name: 'Lane', short: 'LANE', class: 'lane--exp' };
      const roleCls = h ? getRoleClass(h.role) : '';
      const equips = st.enemyEquipments[i] || [];
      const isSel = (sel.side === 'enemy' && sel.index === i);

      return `
        <div class="hero-slot-card slot--enemy ${h ? 'slot-occupied' : ''} ${isSel ? 'is-selected' : ''}" 
             data-side="enemy" data-index="${i}" data-type="pick"
             title="${h ? h.name + ' (' + h.role + ') — Right-click to remove' : 'Click to Pick Enemy ' + lane.name}">
          <div class="hero-equip-slots-bar" data-side="enemy" data-slot-index="${i}">
            ${[0, 1, 2, 3, 4, 5].map((eqIdx) => {
              const it = equips[eqIdx];
              return `
                <div class="equip-slot-box ${it ? 'occupied' : ''}" 
                     data-side="enemy" data-slot-index="${i}" data-equip-index="${eqIdx}"
                     title="${it ? it.name + ' (Click to change / Right-click to clear)' : 'Slot ' + (eqIdx + 1) + ' Equipment'}">
                  ${it ? `<img src="${window.DraftState.resolveItemAvatar(it)}" alt="${it.name}">` : '<span class="equip-empty-dot"></span>'}
                  ${it ? `<button class="btn-equip-clear" data-side="enemy" data-slot-index="${i}" data-equip-index="${eqIdx}" title="Remove Item">✕</button>` : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div class="hero-slot-info hero-slot-info--enemy">
            <span class="hero-slot-name">${h ? h.name : lane.name}</span>
            <div class="hero-slot-role hero-slot-role--enemy">
              ${h ? `<span class="role-badge-tag ${roleCls}">${h.role}</span>` : `<span style="color:#64748b;">Slot ${i + 1}</span>`}
            </div>
          </div>
          <div class="hero-slot-portrait-box hero-slot-portrait-box--round">
            ${h ? `<img src="${window.DraftState.resolveHeroAvatar(h)}" alt="${h.name}">` : '<span class="empty-plus">+</span>'}
            ${h ? `<button class="btn-slot-clear" data-side="enemy" data-index="${i}" title="Remove ${h.name}">✕</button>` : ''}
          </div>
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
