/**
 * MLBB Companion — Manual Checker Lab (checker.js)
 * Handles image upload, live frame capture, draggable panel splitter resizer,
 * smooth animated settings dropdown accordion, mouse wheel zoom (min 100%),
 * 10-ban single row display, vertical pick cards with lane matcher,
 * and 20-slot text-only telemetry table.
 */
(function () {
  'use strict';

  let currentImage = null;
  let currentAnalysis = null;
  let zoomScale = 1.0;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  // Calibration dimensions state (strictly initialized to Draft Pick Template Fixed Slots Coordination.txt)
  const defaultDims = {
    allyPicks: [
      { x: 0, y: 125, w: 210, h: 132 },
      { x: 0, y: 298, w: 210, h: 132 },
      { x: 0, y: 470, w: 210, h: 132 },
      { x: 0, y: 642, w: 210, h: 132 },
      { x: 0, y: 814, w: 210, h: 132 }
    ],
    enemyPicks: [
      { x: 1710, y: 125, w: 210, h: 132 },
      { x: 1710, y: 298, w: 210, h: 132 },
      { x: 1710, y: 470, w: 210, h: 132 },
      { x: 1710, y: 642, w: 210, h: 132 },
      { x: 1710, y: 814, w: 210, h: 132 }
    ],
    allyBans: [
      { x: 30, y: 6, size: 80 },
      { x: 140, y: 6, size: 80 },
      { x: 250, y: 6, size: 80 },
      { x: 360, y: 6, size: 80 },
      { x: 470, y: 6, size: 80 }
    ],
    enemyBans: [
      { x: 1370, y: 6, size: 80 },
      { x: 1480, y: 6, size: 80 },
      { x: 1590, y: 6, size: 80 },
      { x: 1700, y: 6, size: 80 },
      { x: 1810, y: 6, size: 80 }
    ],
    flags: [
      { x: 6, y: 128, size: 46 },
      { x: 6, y: 301, size: 46 },
      { x: 6, y: 473, size: 46 },
      { x: 6, y: 645, size: 46 },
      { x: 6, y: 817, size: 46 }
    ],
    lanes: [
      { x: 5, y: 178, size: 50 },
      { x: 5, y: 351, size: 50 },
      { x: 5, y: 523, size: 50 },
      { x: 5, y: 695, size: 50 },
      { x: 5, y: 867, size: 50 }
    ],
    spells: [
      { x: 194, y: 127, w: 54, h: 55 },
      { x: 194, y: 300, w: 54, h: 55 },
      { x: 194, y: 472, w: 54, h: 55 },
      { x: 194, y: 644, w: 54, h: 55 },
      { x: 194, y: 816, w: 54, h: 55 }
    ],
    // Legacy drawer compatibility values
    allyBanX: 30,
    allyBanStep: 110,
    enemyBanX: 1370,
    enemyBanStep: 110,
    banY: 6,
    banSize: 80,
    allyPickX: 0,
    enemyPickX: 1710,
    pickW: 210,
    pickH: 132,
    pickYs: [125, 298, 470, 642, 814],
    flagX: 6,
    flagY: 3,
    flagSize: 46,
    laneX: 5,
    laneY: 53,
    laneSize: 50,
    spellX: 194,
    spellY: 2,
    spellW: 54,
    spellH: 55
  };

  function ensureDimsStructure(dims) {
    if (!dims || typeof dims !== 'object') dims = JSON.parse(JSON.stringify(defaultDims));

    // 1. Ally Picks
    if (!Array.isArray(dims.allyPicks) || dims.allyPicks.length !== 5) {
      const ax = typeof dims.allyPickX === 'number' ? dims.allyPickX : 0;
      const pw = typeof dims.pickW === 'number' ? dims.pickW : 210;
      const ph = typeof dims.pickH === 'number' ? dims.pickH : 132;
      const ys = Array.isArray(dims.pickYs) && dims.pickYs.length === 5 ? dims.pickYs : [125, 298, 470, 642, 814];
      dims.allyPicks = ys.map((y) => ({ x: ax, y, w: pw, h: ph }));
    }

    // 2. Enemy Picks
    if (!Array.isArray(dims.enemyPicks) || dims.enemyPicks.length !== 5) {
      const ex = typeof dims.enemyPickX === 'number' ? dims.enemyPickX : 1710;
      const pw = typeof dims.pickW === 'number' ? dims.pickW : 210;
      const ph = typeof dims.pickH === 'number' ? dims.pickH : 132;
      const ys = Array.isArray(dims.pickYs) && dims.pickYs.length === 5 ? dims.pickYs : [125, 298, 470, 642, 814];
      dims.enemyPicks = ys.map((y) => ({ x: ex, y, w: pw, h: ph }));
    }

    // 3. Ally Bans
    if (!Array.isArray(dims.allyBans) || dims.allyBans.length !== 5) {
      const abx = typeof dims.allyBanX === 'number' ? dims.allyBanX : 30;
      const step = typeof dims.allyBanStep === 'number' ? dims.allyBanStep : 110;
      const by = typeof dims.banY === 'number' ? dims.banY : 6;
      const bsz = typeof dims.banSize === 'number' ? dims.banSize : 80;
      dims.allyBans = [0, 1, 2, 3, 4].map((i) => ({ x: abx + i * step, y: by, size: bsz }));
    }

    // 4. Enemy Bans
    if (!Array.isArray(dims.enemyBans) || dims.enemyBans.length !== 5) {
      const ebx = typeof dims.enemyBanX === 'number' ? dims.enemyBanX : 1370;
      const step = typeof dims.enemyBanStep === 'number' ? dims.enemyBanStep : 110;
      const by = typeof dims.banY === 'number' ? dims.banY : 6;
      const bsz = typeof dims.banSize === 'number' ? dims.banSize : 80;
      dims.enemyBans = [0, 1, 2, 3, 4].map((i) => ({ x: ebx + i * step, y: by, size: bsz }));
    }

    // 5. Flags
    if (!Array.isArray(dims.flags) || dims.flags.length !== 5) {
      const fx = typeof dims.flagX === 'number' ? dims.flagX : 6;
      const fy = typeof dims.flagY === 'number' ? dims.flagY : 3;
      const fsz = typeof dims.flagSize === 'number' ? dims.flagSize : 46;
      dims.flags = dims.allyPicks.map((p) => ({ x: p.x + fx, y: p.y + fy, size: fsz }));
    }

    // 6. Lanes
    if (!Array.isArray(dims.lanes) || dims.lanes.length !== 5) {
      const lx = typeof dims.laneX === 'number' ? dims.laneX : 5;
      const ly = typeof dims.laneY === 'number' ? dims.laneY : 53;
      const lsz = typeof dims.laneSize === 'number' ? dims.laneSize : 50;
      dims.lanes = dims.allyPicks.map((p) => ({ x: p.x + lx, y: p.y + ly, size: lsz }));
    }

    // 7. Spells
    if (!Array.isArray(dims.spells) || dims.spells.length !== 5) {
      const sx = typeof dims.spellX === 'number' ? dims.spellX : 194;
      const sy = typeof dims.spellY === 'number' ? dims.spellY : 2;
      const sw = typeof dims.spellW === 'number' ? dims.spellW : 54;
      const sh = typeof dims.spellH === 'number' ? dims.spellH : 55;
      dims.spells = dims.allyPicks.map((p) => ({ x: p.x + sx, y: p.y + sy, w: sw, h: sh }));
    }

    return dims;
  }

  let currentDims = ensureDimsStructure(JSON.parse(JSON.stringify(defaultDims)));

  // DOM Elements
  const checkerGridLayout = document.getElementById('checkerGridLayout');
  const leftPanel = document.getElementById('leftPanel');
  const panelResizerSplitter = document.getElementById('panelResizerSplitter');
  const dropzoneBox = document.getElementById('dropzoneBox');
  const canvasContainer = document.getElementById('canvasContainer');
  const imageFileInput = document.getElementById('imageFileInput');
  const btnCaptureLive = document.getElementById('btnCaptureLive');
  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const settingsDropdownPanel = document.getElementById('settingsDropdownPanel');
  const previewCanvas = document.getElementById('previewCanvas');
  const canvasPlaceholder = document.getElementById('canvasPlaceholder');
  const chkShowROIs = document.getElementById('chkShowROIs');
  const chkShowSubElements = document.getElementById('chkShowSubElements');

  // Settings Elements
  const dimSubTabs = document.querySelectorAll('.dim-tab');
  const dimTabPanes = document.querySelectorAll('.dim-tab-pane');
  const btnSaveDimensions = document.getElementById('btnSaveDimensions');
  const btnExportJson = document.getElementById('btnExportJson');
  const btnResetDimensions = document.getElementById('btnResetDimensions');
  const dimStatusMsg = document.getElementById('dimStatusMsg');

  const dimAllyBanX = document.getElementById('dimAllyBanX');
  const dimAllyBanStep = document.getElementById('dimAllyBanStep');
  const dimEnemyBanX = document.getElementById('dimEnemyBanX');
  const dimEnemyBanStep = document.getElementById('dimEnemyBanStep');
  const dimBanY = document.getElementById('dimBanY');
  const dimBanSize = document.getElementById('dimBanSize');

  const dimAllyPickX = document.getElementById('dimAllyPickX');
  const dimEnemyPickX = document.getElementById('dimEnemyPickX');
  const dimPickW = document.getElementById('dimPickW');
  const dimPickH = document.getElementById('dimPickH');
  const dimPickY0 = document.getElementById('dimPickY0');
  const dimPickY1 = document.getElementById('dimPickY1');
  const dimPickY2 = document.getElementById('dimPickY2');
  const dimPickY3 = document.getElementById('dimPickY3');
  const dimPickY4 = document.getElementById('dimPickY4');

  const dimFlagX = document.getElementById('dimFlagX');
  const dimFlagY = document.getElementById('dimFlagY');
  const dimFlagSize = document.getElementById('dimFlagSize');
  const dimLaneX = document.getElementById('dimLaneX');
  const dimLaneY = document.getElementById('dimLaneY');
  const dimLaneSize = document.getElementById('dimLaneSize');
  const dimSpellX = document.getElementById('dimSpellX');
  const dimSpellY = document.getElementById('dimSpellY');
  const dimSpellW = document.getElementById('dimSpellW');
  const dimSpellH = document.getElementById('dimSpellH');

  // Result Elements
  const detectedPhaseName = document.getElementById('detectedPhaseName');
  const detectedPhaseConfidence = document.getElementById('detectedPhaseConfidence');
  const detectedPhaseDetails = document.getElementById('detectedPhaseDetails');

  const detectedTenBansRow = document.getElementById('detectedTenBansRow');
  const detectedTenPicksRow = document.getElementById('detectedTenPicksRow');

  const telemetryFpsBadge = document.getElementById('telemetryFpsBadge');
  const latencyBarExtraction = document.getElementById('latencyBarExtraction');
  const latencyBarBan = document.getElementById('latencyBarBan');
  const latencyBarPick = document.getElementById('latencyBarPick');
  const timingExtraction = document.getElementById('timingExtraction');
  const timingBan = document.getElementById('timingBan');
  const timingPick = document.getElementById('timingPick');
  const timingTotal = document.getElementById('timingTotal');
  const telemetryTableBody = document.getElementById('telemetryTableBody');
  const telemetryJsonBox = document.getElementById('telemetryJsonBox');
  const btnCopyJson = document.getElementById('btnCopyJson');
  const filterTabs = document.querySelectorAll('.filter-tab');

  let activeTableFilter = 'all';

  // Edit Mode State for Triple-Click Slot Border Modification
  let activeEditSlot = null;
  let editDragMode = null; // 'move', 'nw', 'ne', 'se', 'sw', 'n', 's', 'w', 'e'
  let dragStartMouse = { x: 0, y: 0 };
  let dragStartDims = null;
  let lastClickTimes = [];

  // Grouping Modes State
  let isUngrouped = false;
  let groupModes = {
    ally_picks: true,
    enemy_picks: true,
    bans: true,
    flags: false,
    lanes: false,
    spells: false
  };

  const slotEditBanner = document.getElementById('slotEditBanner');
  const slotEditBannerText = document.getElementById('slotEditBannerText');
  const btnDoneEditingSlot = document.getElementById('btnDoneEditingSlot');
  const btnCancelEditingSlot = document.getElementById('btnCancelEditingSlot');

  const slotContextMenu = document.getElementById('slotContextMenu');
  const ctxChkAllGroup = document.getElementById('ctxChkAllGroup');
  const ctxChkUngroup = document.getElementById('ctxChkUngroup');
  const ctxChkAlly = document.getElementById('ctxChkAlly');
  const ctxChkEnemy = document.getElementById('ctxChkEnemy');
  const ctxChkBans = document.getElementById('ctxChkBans');
  const ctxChkFlags = document.getElementById('ctxChkFlags');
  const ctxChkLanes = document.getElementById('ctxChkLanes');
  const ctxChkSpells = document.getElementById('ctxChkSpells');
  const ctxAlignLeft = document.getElementById('ctxAlignLeft');
  const ctxDistributeVertically = document.getElementById('ctxDistributeVertically');
  const ctxAlignOfficialSpec = document.getElementById('ctxAlignOfficialSpec');
  const ctxResetSingleSlot = document.getElementById('ctxResetSingleSlot');
  const ctxSaveDimensionsQuick = document.getElementById('ctxSaveDimensionsQuick');

  function init() {
    bindEvents();
    bindFilterTabs();
    bindSettingsDropdown();
    bindPanelSplitter();
    bindSlotEditControls();
    bindContextMenu();
    loadServerRois();
    renderPlaceholderDisplays();
  }

  function getCanvasCoords(clientX, clientY) {
    if (!previewCanvas) return { x: 0, y: 0 };
    const rect = previewCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) * (1920 / rect.width),
      y: (clientY - rect.top) * (1080 / rect.height)
    };
  }

  function getAllSlotRects() {
    ensureDimsStructure(currentDims);
    const slots = [];

    // 1. Ally Bans (0..4)
    for (let i = 0; i < 5; i++) {
      const b = currentDims.allyBans[i];
      slots.push({
        id: `ally_ban_${i}`,
        type: 'ally_ban',
        index: i,
        name: `Ally Ban ${i + 1}`,
        tab: 'bans',
        inputFocus: 'dimAllyBanX',
        x: b.x,
        y: b.y,
        w: b.size,
        h: b.size,
        isCircular: true
      });
    }

    // 2. Enemy Bans (0..4)
    for (let i = 0; i < 5; i++) {
      const b = currentDims.enemyBans[i];
      slots.push({
        id: `enemy_ban_${i}`,
        type: 'enemy_ban',
        index: i,
        name: `Enemy Ban ${i + 1}`,
        tab: 'bans',
        inputFocus: 'dimEnemyBanX',
        x: b.x,
        y: b.y,
        w: b.size,
        h: b.size,
        isCircular: true
      });
    }

    // 3. Ally Picks (0..4)
    for (let i = 0; i < 5; i++) {
      const p = currentDims.allyPicks[i];
      slots.push({
        id: `ally_pick_${i}`,
        type: 'ally_pick',
        index: i,
        name: `Ally Pick ${i + 1}`,
        tab: 'picks',
        inputFocus: `dimPickY${i}`,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        isCircular: false
      });
    }

    // 4. Enemy Picks (0..4)
    for (let i = 0; i < 5; i++) {
      const p = currentDims.enemyPicks[i];
      slots.push({
        id: `enemy_pick_${i}`,
        type: 'enemy_pick',
        index: i,
        name: `Enemy Pick ${i + 1}`,
        tab: 'picks',
        inputFocus: `dimPickY${i}`,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        isCircular: false
      });
    }

    // 5. Sub-Elements if enabled (100% Independent Flag, Lane, Spell Coordinates)
    if (chkShowSubElements && chkShowSubElements.checked) {
      for (let i = 0; i < 5; i++) {
        const fl = currentDims.flags[i];
        slots.push({
          id: `flag_${i}`,
          type: 'flag',
          index: i,
          name: `Pick ${i + 1} Flag`,
          tab: 'subelements',
          inputFocus: 'dimFlagX',
          x: fl.x,
          y: fl.y,
          w: fl.size,
          h: fl.size,
          isCircular: true
        });

        const ln = currentDims.lanes[i];
        slots.push({
          id: `lane_${i}`,
          type: 'lane',
          index: i,
          name: `Pick ${i + 1} Lane`,
          tab: 'subelements',
          inputFocus: 'dimLaneX',
          x: ln.x,
          y: ln.y,
          w: ln.size,
          h: ln.size,
          isCircular: false
        });

        const sp = currentDims.spells[i];
        slots.push({
          id: `spell_${i}`,
          type: 'spell',
          index: i,
          name: `Pick ${i + 1} Spell`,
          tab: 'subelements',
          inputFocus: 'dimSpellX',
          x: sp.x,
          y: sp.y,
          w: sp.w,
          h: sp.h,
          isCircular: false
        });
      }
    }

    return slots;
  }

  function getSlotAt(cx, cy, tolerance = 12) {
    const slots = getAllSlotRects();
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (cx >= s.x - tolerance && cx <= s.x + s.w + tolerance &&
          cy >= s.y - tolerance && cy <= s.y + s.h + tolerance) {
        return s;
      }
    }
    return null;
  }

  function getResizeHandles(s) {
    return {
      nw: { x: s.x, y: s.y, cursor: 'nwse-resize' },
      ne: { x: s.x + s.w, y: s.y, cursor: 'nesw-resize' },
      se: { x: s.x + s.w, y: s.y + s.h, cursor: 'nwse-resize' },
      sw: { x: s.x, y: s.y + s.h, cursor: 'nesw-resize' },
      n:  { x: s.x + s.w / 2, y: s.y, cursor: 'ns-resize' },
      s:  { x: s.x + s.w / 2, y: s.y + s.h, cursor: 'ns-resize' },
      w:  { x: s.x, y: s.y + s.h / 2, cursor: 'ew-resize' },
      e:  { x: s.x + s.w, y: s.y + s.h / 2, cursor: 'ew-resize' }
    };
  }

  function getHandleAt(cx, cy, s, tolerance = 18) {
    if (!s) return null;
    const handles = getResizeHandles(s);
    for (const [key, pos] of Object.entries(handles)) {
      if (Math.abs(cx - pos.x) <= tolerance && Math.abs(cy - pos.y) <= tolerance) {
        return { key, cursor: pos.cursor };
      }
    }
    return null;
  }

  function selectSlotForEdit(slot) {
    activeEditSlot = slot;
    if (slotEditBanner) {
      slotEditBanner.style.display = 'flex';
      if (slotEditBannerText) {
        slotEditBannerText.innerHTML = `✏️ <strong>Editing ${slot.name}</strong>: Drag border to move, corner handles to resize. Right-click for Group/Align.`;
      }
    }

    // Automatically open Settings panel and activate matching tab
    if (settingsDropdownPanel) {
      settingsDropdownPanel.classList.add('open');
      if (btnOpenSettings) btnOpenSettings.classList.add('active');

      if (slot.tab) {
        dimSubTabs.forEach((t) => t.classList.remove('active'));
        dimTabPanes.forEach((p) => p.classList.remove('active'));
        const activeTabBtn = document.querySelector(`.dim-tab[data-tab="${slot.tab}"]`);
        if (activeTabBtn) activeTabBtn.classList.add('active');
        const pane = document.getElementById(`pane${slot.tab.charAt(0).toUpperCase() + slot.tab.slice(1)}`);
        if (pane) pane.classList.add('active');
      }

      // Highlight input
      if (slot.inputFocus) {
        const inp = document.getElementById(slot.inputFocus);
        if (inp) {
          inp.classList.add('input-highlight-pulse');
          setTimeout(() => inp.classList.remove('input-highlight-pulse'), 2500);
        }
      }
    }

    drawCanvas();
  }

  function deselectSlotForEdit() {
    if (activeEditSlot) {
      saveDimensionsToServer();
    }
    activeEditSlot = null;
    editDragMode = null;
    if (slotEditBanner) slotEditBanner.style.display = 'none';
    if (slotContextMenu) slotContextMenu.style.display = 'none';
    if (canvasContainer) canvasContainer.style.cursor = 'default';
    drawCanvas();
  }

  function bindSlotEditControls() {
    if (btnDoneEditingSlot) {
      btnDoneEditingSlot.addEventListener('click', (e) => {
        e.stopPropagation();
        deselectSlotForEdit();
      });
    }

    if (btnCancelEditingSlot) {
      btnCancelEditingSlot.addEventListener('click', (e) => {
        e.stopPropagation();
        deselectSlotForEdit();
      });
    }

    window.addEventListener('keydown', (e) => {
      // 1. Enter or Escape to finish editing
      if (activeEditSlot && (e.key === 'Escape' || e.key === 'Enter')) {
        deselectSlotForEdit();
        return;
      }

      // 2. Arrow keys to nudge active slot (1px precision, or 10px with Shift)
      if (activeEditSlot && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag === 'input' || activeTag === 'textarea') return;

        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowUp') dy = -step;
        else if (e.key === 'ArrowDown') dy = step;

        const s = activeEditSlot;
        const idx = s.index;

        // Calculate clamped delta from bounds
        let actualDx = dx;
        let actualDy = dy;
        if (s.type === 'ally_pick') {
          const cur = currentDims.allyPicks[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.w, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.h, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'enemy_pick') {
          const cur = currentDims.enemyPicks[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.w, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.h, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'ally_ban') {
          const cur = currentDims.allyBans[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.size, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.size, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'enemy_ban') {
          const cur = currentDims.enemyBans[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.size, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.size, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'flag') {
          const cur = currentDims.flags[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.size, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.size, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'lane') {
          const cur = currentDims.lanes[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.size, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.size, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        } else if (s.type === 'spell') {
          const cur = currentDims.spells[idx];
          const targetX = Math.max(0, Math.min(1920 - cur.w, cur.x + dx));
          const targetY = Math.max(0, Math.min(1080 - cur.h, cur.y + dy));
          actualDx = targetX - cur.x;
          actualDy = targetY - cur.y;
        }

        if (isUngrouped) {
          if (s.type === 'ally_pick') {
            currentDims.allyPicks[idx].x += actualDx;
            currentDims.allyPicks[idx].y += actualDy;
          } else if (s.type === 'enemy_pick') {
            currentDims.enemyPicks[idx].x += actualDx;
            currentDims.enemyPicks[idx].y += actualDy;
          } else if (s.type === 'ally_ban') {
            currentDims.allyBans[idx].x += actualDx;
            currentDims.allyBans[idx].y += actualDy;
          } else if (s.type === 'enemy_ban') {
            currentDims.enemyBans[idx].x += actualDx;
            currentDims.enemyBans[idx].y += actualDy;
          } else if (s.type === 'flag') {
            currentDims.flags[idx].x += actualDx;
            currentDims.flags[idx].y += actualDy;
          } else if (s.type === 'lane') {
            currentDims.lanes[idx].x += actualDx;
            currentDims.lanes[idx].y += actualDy;
          } else if (s.type === 'spell') {
            currentDims.spells[idx].x += actualDx;
            currentDims.spells[idx].y += actualDy;
          }
        } else {
          // A. ALLY PICKS
          if (groupModes.ally_picks) {
            for (let i = 0; i < 5; i++) {
              currentDims.allyPicks[i].x = Math.max(0, Math.min(1920 - currentDims.allyPicks[i].w, currentDims.allyPicks[i].x + actualDx));
              currentDims.allyPicks[i].y = Math.max(0, Math.min(1080 - currentDims.allyPicks[i].h, currentDims.allyPicks[i].y + actualDy));
            }
          } else if (s.type === 'ally_pick') {
            currentDims.allyPicks[idx].x += actualDx;
            currentDims.allyPicks[idx].y += actualDy;
          }

          // B. ENEMY PICKS
          if (groupModes.enemy_picks) {
            for (let i = 0; i < 5; i++) {
              currentDims.enemyPicks[i].x = Math.max(0, Math.min(1920 - currentDims.enemyPicks[i].w, currentDims.enemyPicks[i].x + actualDx));
              currentDims.enemyPicks[i].y = Math.max(0, Math.min(1080 - currentDims.enemyPicks[i].h, currentDims.enemyPicks[i].y + actualDy));
            }
          } else if (s.type === 'enemy_pick') {
            currentDims.enemyPicks[idx].x += actualDx;
            currentDims.enemyPicks[idx].y += actualDy;
          }

          // C. BANS (ALLY & ENEMY)
          if (groupModes.bans) {
            for (let i = 0; i < 5; i++) {
              currentDims.allyBans[i].x = Math.max(0, Math.min(1920 - currentDims.allyBans[i].size, currentDims.allyBans[i].x + actualDx));
              currentDims.allyBans[i].y = Math.max(0, Math.min(1080 - currentDims.allyBans[i].size, currentDims.allyBans[i].y + actualDy));
              currentDims.enemyBans[i].x = Math.max(0, Math.min(1920 - currentDims.enemyBans[i].size, currentDims.enemyBans[i].x + actualDx));
              currentDims.enemyBans[i].y = Math.max(0, Math.min(1080 - currentDims.enemyBans[i].size, currentDims.enemyBans[i].y + actualDy));
            }
          } else if (s.type === 'ally_ban') {
            currentDims.allyBans[idx].x += actualDx;
            currentDims.allyBans[idx].y += actualDy;
          } else if (s.type === 'enemy_ban') {
            currentDims.enemyBans[idx].x += actualDx;
            currentDims.enemyBans[idx].y += actualDy;
          }

          // D. FLAGS
          if (groupModes.flags) {
            for (let i = 0; i < 5; i++) {
              currentDims.flags[i].x = Math.max(0, Math.min(1920 - currentDims.flags[i].size, currentDims.flags[i].x + actualDx));
              currentDims.flags[i].y = Math.max(0, Math.min(1080 - currentDims.flags[i].size, currentDims.flags[i].y + actualDy));
            }
          } else if (s.type === 'flag') {
            currentDims.flags[idx].x += actualDx;
            currentDims.flags[idx].y += actualDy;
          }

          // E. LANES
          if (groupModes.lanes) {
            for (let i = 0; i < 5; i++) {
              currentDims.lanes[i].x = Math.max(0, Math.min(1920 - currentDims.lanes[i].size, currentDims.lanes[i].x + actualDx));
              currentDims.lanes[i].y = Math.max(0, Math.min(1080 - currentDims.lanes[i].size, currentDims.lanes[i].y + actualDy));
            }
          } else if (s.type === 'lane') {
            currentDims.lanes[idx].x += actualDx;
            currentDims.lanes[idx].y += actualDy;
          }

          // F. SPELLS
          if (groupModes.spells) {
            for (let i = 0; i < 5; i++) {
              currentDims.spells[i].x = Math.max(0, Math.min(1920 - currentDims.spells[i].w, currentDims.spells[i].x + actualDx));
              currentDims.spells[i].y = Math.max(0, Math.min(1080 - currentDims.spells[i].h, currentDims.spells[i].y + actualDy));
            }
          } else if (s.type === 'spell') {
            currentDims.spells[idx].x += actualDx;
            currentDims.spells[idx].y += actualDy;
          }
        }

        updateInputsFromState();
        drawCanvas();

        if (slotEditBannerText) {
          const curSlot = getAllSlotRects().find((sl) => sl.id === activeEditSlot.id) || activeEditSlot;
          slotEditBannerText.innerHTML = `✏️ <strong>${curSlot.name}</strong>: ${Math.round(curSlot.w)}×${Math.round(curSlot.h)}px (X: ${Math.round(curSlot.x)}, Y: ${Math.round(curSlot.y)})`;
        }
        localStorage.setItem('mlbb_saved_dims', JSON.stringify(currentDims));
      }
    });
  }

  function bindContextMenu() {
    if (!canvasContainer || !slotContextMenu) return;

    canvasContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const coords = getCanvasCoords(e.clientX, e.clientY);
      const hit = getSlotAt(coords.x, coords.y);
      if (hit) {
        selectSlotForEdit(hit);
      }

      syncGroupCheckboxUI();

      // Clamp context menu positioning within window
      const menuWidth = 190;
      const menuHeight = 420;
      let left = e.clientX;
      let top = e.clientY;
      if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
      if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 10;

      slotContextMenu.style.left = `${left}px`;
      slotContextMenu.style.top = `${top}px`;
      slotContextMenu.style.display = 'flex';
    });

    // Layer only disappears when clicking on areas OUTSIDE of the context menu
    slotContextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    slotContextMenu.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('pointerdown', (e) => {
      if (slotContextMenu && slotContextMenu.style.display !== 'none' && !slotContextMenu.contains(e.target)) {
        slotContextMenu.style.display = 'none';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && slotContextMenu) {
        slotContextMenu.style.display = 'none';
      }
    });

    function syncGroupCheckboxUI() {
      if (ctxChkAllGroup) ctxChkAllGroup.checked = !isUngrouped;
      if (ctxChkUngroup) ctxChkUngroup.checked = isUngrouped;
      if (ctxChkAlly) ctxChkAlly.checked = groupModes.ally_picks;
      if (ctxChkEnemy) ctxChkEnemy.checked = groupModes.enemy_picks;
      if (ctxChkBans) ctxChkBans.checked = groupModes.bans;
      if (ctxChkFlags) ctxChkFlags.checked = groupModes.flags;
      if (ctxChkLanes) ctxChkLanes.checked = groupModes.lanes;
      if (ctxChkSpells) ctxChkSpells.checked = groupModes.spells;
    }

    // 0. Checkbox: Master Group Mode Toggle
    if (ctxChkAllGroup) {
      ctxChkAllGroup.addEventListener('change', () => {
        if (ctxChkAllGroup.checked) {
          isUngrouped = false;
          showToast('☑ Group Mode Enabled');
        } else {
          isUngrouped = true;
          showToast('🔓 Ungrouped: Slots move independently');
        }
        syncGroupCheckboxUI();
      });
    }

    // 0.1 Checkbox: Master Ungroup Mode Toggle
    if (ctxChkUngroup) {
      ctxChkUngroup.addEventListener('change', () => {
        if (ctxChkUngroup.checked) {
          isUngrouped = true;
          showToast('🔓 Ungrouped: Slots move independently');
        } else {
          isUngrouped = false;
          showToast('☑ Group Mode Enabled');
        }
        syncGroupCheckboxUI();
      });
    }

    // 1. Checkbox: Ally
    if (ctxChkAlly) {
      ctxChkAlly.addEventListener('change', () => {
        groupModes.ally_picks = ctxChkAlly.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.ally_picks ? '☑ Grouped Ally Picks' : '☐ Ungrouped Ally Picks');
      });
    }

    // 2. Checkbox: Enemy
    if (ctxChkEnemy) {
      ctxChkEnemy.addEventListener('change', () => {
        groupModes.enemy_picks = ctxChkEnemy.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.enemy_picks ? '☑ Grouped Enemy Picks' : '☐ Ungrouped Enemy Picks');
      });
    }

    // 3. Checkbox: Bans
    if (ctxChkBans) {
      ctxChkBans.addEventListener('change', () => {
        groupModes.bans = ctxChkBans.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.bans ? '☑ Grouped Bans' : '☐ Ungrouped Bans');
      });
    }

    // 4. Checkbox: Flags
    if (ctxChkFlags) {
      ctxChkFlags.addEventListener('change', () => {
        groupModes.flags = ctxChkFlags.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.flags ? '☑ Flags Grouped with Pick' : '☐ Flags Move Independently');
      });
    }

    // 5. Checkbox: Lanes
    if (ctxChkLanes) {
      ctxChkLanes.addEventListener('change', () => {
        groupModes.lanes = ctxChkLanes.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.lanes ? '☑ Lanes Grouped with Pick' : '☐ Lanes Move Independently');
      });
    }

    // 6. Checkbox: Spells
    if (ctxChkSpells) {
      ctxChkSpells.addEventListener('change', () => {
        groupModes.spells = ctxChkSpells.checked;
        isUngrouped = false;
        syncGroupCheckboxUI();
        showToast(groupModes.spells ? '☑ Spells Grouped with Pick' : '☐ Spells Move Independently');
      });
    }

    // 8. Button: Align Left
    if (ctxAlignLeft) {
      ctxAlignLeft.addEventListener('click', () => {
        if (activeEditSlot) {
          const s = activeEditSlot;
          const idx = s.index;
          if (s.type === 'ally_pick') {
            const snapX = Math.round(currentDims.allyPicks[idx].x / 10) * 10;
            if (groupModes.ally_picks) {
              for (let i = 0; i < 5; i++) currentDims.allyPicks[i].x = snapX;
            } else {
              currentDims.allyPicks[idx].x = snapX;
            }
          } else if (s.type === 'enemy_pick') {
            const snapX = Math.round(currentDims.enemyPicks[idx].x / 10) * 10;
            if (groupModes.enemy_picks) {
              for (let i = 0; i < 5; i++) currentDims.enemyPicks[i].x = snapX;
            } else {
              currentDims.enemyPicks[idx].x = snapX;
            }
          }
        }
        updateInputsFromState();
        drawCanvas();
        showToast('📐 Aligned Column Left');
      });
    }

    // 9. Button: Distribute Vertically
    if (ctxDistributeVertically) {
      ctxDistributeVertically.addEventListener('click', () => {
        const isEnemy = activeEditSlot && activeEditSlot.type === 'enemy_pick';
        const arr = isEnemy ? currentDims.enemyPicks : currentDims.allyPicks;
        const startY = arr[0].y;
        const step = 172; // standard MLBB vertical spacing
        for (let i = 0; i < 5; i++) {
          arr[i].y = Math.min(1080 - arr[i].h, startY + i * step);
        }
        updateInputsFromState();
        drawCanvas();
        showToast('↕️ Distributed Vertically (172px Step)');
      });
    }

    // 10. Button: Default (Align to Official Spec)
    if (ctxAlignOfficialSpec) {
      ctxAlignOfficialSpec.addEventListener('click', () => {
        currentDims = ensureDimsStructure(JSON.parse(JSON.stringify(defaultDims)));
        updateInputsFromState();
        drawCanvas();
        showToast('🎯 Aligned to Default Spec');
      });
    }

    // 11. Button: Reset Single Slot
    if (ctxResetSingleSlot) {
      ctxResetSingleSlot.addEventListener('click', () => {
        if (activeEditSlot) {
          const s = activeEditSlot;
          const idx = s.index;
          if (s.type === 'ally_pick') {
            currentDims.allyPicks[idx] = JSON.parse(JSON.stringify(defaultDims.allyPicks[idx]));
          } else if (s.type === 'enemy_pick') {
            currentDims.enemyPicks[idx] = JSON.parse(JSON.stringify(defaultDims.enemyPicks[idx]));
          } else if (s.type === 'ally_ban') {
            currentDims.allyBans[idx] = JSON.parse(JSON.stringify(defaultDims.allyBans[idx]));
          } else if (s.type === 'enemy_ban') {
            currentDims.enemyBans[idx] = JSON.parse(JSON.stringify(defaultDims.enemyBans[idx]));
          } else if (s.type === 'flag') {
            currentDims.flags[idx] = JSON.parse(JSON.stringify(defaultDims.flags[idx]));
          } else if (s.type === 'lane') {
            currentDims.lanes[idx] = JSON.parse(JSON.stringify(defaultDims.lanes[idx]));
          } else if (s.type === 'spell') {
            currentDims.spells[idx] = JSON.parse(JSON.stringify(defaultDims.spells[idx]));
          }
          updateInputsFromState();
          drawCanvas();
          showToast(`🔄 Reset ${s.name} to Default`);
        }
      });
    }

    // 10. Button: Save
    if (ctxSaveDimensionsQuick) {
      ctxSaveDimensionsQuick.addEventListener('click', () => {
        saveDimensionsToServer();
      });
    }
  }

  function showToast(msg) {
    if (slotEditBanner) {
      slotEditBanner.style.display = 'flex';
      if (slotEditBannerText) slotEditBannerText.innerHTML = msg;
      setTimeout(() => {
        if (!activeEditSlot && slotEditBanner) slotEditBanner.style.display = 'none';
      }, 3500);
    }
  }

  function bindEvents() {
    // 1. Drag and drop files from desktop
    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzoneBox.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzoneBox.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzoneBox.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzoneBox.classList.remove('dragover');
      });
    });

    dropzoneBox.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files[0]) {
        processFile(files[0]);
      }
    });

    if (imageFileInput) {
      imageFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          processFile(e.target.files[0]);
        }
      });
    }

    if (btnCaptureLive) {
      btnCaptureLive.addEventListener('click', captureLiveFrame);
    }

    if (chkShowROIs) {
      chkShowROIs.addEventListener('change', drawCanvas);
    }

    if (chkShowSubElements) {
      chkShowSubElements.addEventListener('change', drawCanvas);
    }

    // 2. Pan, Zoom & Interactive Slot Editing on Canvas
    if (canvasContainer) {
      canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button === 2) return; // Right click handled by contextmenu
        if (!currentImage) return;

        const now = Date.now();
        lastClickTimes.push(now);
        if (lastClickTimes.length > 3) lastClickTimes.shift();

        const coords = getCanvasCoords(e.clientX, e.clientY);

        // Triple Click Detection (e.detail === 3 or 3 clicks in 550ms)
        const isTripleClick = (e.detail === 3) || (lastClickTimes.length === 3 && (lastClickTimes[2] - lastClickTimes[0] < 550));

        if (isTripleClick) {
          const hit = getSlotAt(coords.x, coords.y);
          if (hit) {
            selectSlotForEdit(hit);
            return;
          }
        }

        // If a slot is actively being edited, check handle or slot drag
        if (activeEditSlot) {
          const slots = getAllSlotRects();
          const currentSlotRect = slots.find((s) => s.id === activeEditSlot.id) || activeEditSlot;
          const handle = getHandleAt(coords.x, coords.y, currentSlotRect);

          if (handle) {
            editDragMode = handle.key;
            dragStartMouse = { x: coords.x, y: coords.y };
            dragStartDims = JSON.parse(JSON.stringify(currentDims));
            return;
          } else if (coords.x >= currentSlotRect.x && coords.x <= currentSlotRect.x + currentSlotRect.w &&
                     coords.y >= currentSlotRect.y && coords.y <= currentSlotRect.y + currentSlotRect.h) {
            editDragMode = 'move';
            dragStartMouse = { x: coords.x, y: coords.y };
            dragStartDims = JSON.parse(JSON.stringify(currentDims));
            return;
          }
        }

        // Normal Canvas Drag Pan
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
        canvasContainer.classList.add('grabbing');
      });

      window.addEventListener('mousemove', (e) => {
        const coords = getCanvasCoords(e.clientX, e.clientY);

        // 1. Handle Active Slot Editing Drag / Resize with Strict 1920x1080 Boundary Clamping
        if (activeEditSlot && editDragMode && dragStartDims) {
          const dx = Math.round(coords.x - dragStartMouse.x);
          const dy = Math.round(coords.y - dragStartMouse.y);
          const s = activeEditSlot;

          if (editDragMode === 'move') {
            const idx = s.index;
            let actualDx = dx;
            let actualDy = dy;

            // 1. Calculate delta from the directly dragged element
            if (s.type === 'ally_pick') {
              const startP = dragStartDims.allyPicks[idx];
              const targetX = Math.max(0, Math.min(1920 - startP.w, startP.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startP.h, startP.y + dy));
              actualDx = targetX - startP.x;
              actualDy = targetY - startP.y;
            } else if (s.type === 'enemy_pick') {
              const startP = dragStartDims.enemyPicks[idx];
              const targetX = Math.max(0, Math.min(1920 - startP.w, startP.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startP.h, startP.y + dy));
              actualDx = targetX - startP.x;
              actualDy = targetY - startP.y;
            } else if (s.type === 'ally_ban') {
              const startB = dragStartDims.allyBans[idx];
              const targetX = Math.max(0, Math.min(1920 - startB.size, startB.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startB.size, startB.y + dy));
              actualDx = targetX - startB.x;
              actualDy = targetY - startB.y;
            } else if (s.type === 'enemy_ban') {
              const startB = dragStartDims.enemyBans[idx];
              const targetX = Math.max(0, Math.min(1920 - startB.size, startB.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startB.size, startB.y + dy));
              actualDx = targetX - startB.x;
              actualDy = targetY - startB.y;
            } else if (s.type === 'flag') {
              const startF = dragStartDims.flags[idx];
              const targetX = Math.max(0, Math.min(1920 - startF.size, startF.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startF.size, startF.y + dy));
              actualDx = targetX - startF.x;
              actualDy = targetY - startF.y;
            } else if (s.type === 'lane') {
              const startL = dragStartDims.lanes[idx];
              const targetX = Math.max(0, Math.min(1920 - startL.size, startL.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startL.size, startL.y + dy));
              actualDx = targetX - startL.x;
              actualDy = targetY - startL.y;
            } else if (s.type === 'spell') {
              const startS = dragStartDims.spells[idx];
              const targetX = Math.max(0, Math.min(1920 - startS.w, startS.x + dx));
              const targetY = Math.max(0, Math.min(1080 - startS.h, startS.y + dy));
              actualDx = targetX - startS.x;
              actualDy = targetY - startS.y;
            }

            // 2. Apply movement: Single independent move if isUngrouped, otherwise group move
            if (isUngrouped) {
              if (s.type === 'ally_pick') {
                const sp = dragStartDims.allyPicks[idx];
                currentDims.allyPicks[idx].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                currentDims.allyPicks[idx].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
              } else if (s.type === 'enemy_pick') {
                const sp = dragStartDims.enemyPicks[idx];
                currentDims.enemyPicks[idx].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                currentDims.enemyPicks[idx].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
              } else if (s.type === 'ally_ban') {
                const sb = dragStartDims.allyBans[idx];
                currentDims.allyBans[idx].x = Math.max(0, Math.min(1920 - sb.size, sb.x + actualDx));
                currentDims.allyBans[idx].y = Math.max(0, Math.min(1080 - sb.size, sb.y + actualDy));
              } else if (s.type === 'enemy_ban') {
                const eb = dragStartDims.enemyBans[idx];
                currentDims.enemyBans[idx].x = Math.max(0, Math.min(1920 - eb.size, eb.x + actualDx));
                currentDims.enemyBans[idx].y = Math.max(0, Math.min(1080 - eb.size, eb.y + actualDy));
              } else if (s.type === 'flag') {
                const sf = dragStartDims.flags[idx];
                currentDims.flags[idx].x = Math.max(0, Math.min(1920 - sf.size, sf.x + actualDx));
                currentDims.flags[idx].y = Math.max(0, Math.min(1080 - sf.size, sf.y + actualDy));
              } else if (s.type === 'lane') {
                const sl = dragStartDims.lanes[idx];
                currentDims.lanes[idx].x = Math.max(0, Math.min(1920 - sl.size, sl.x + actualDx));
                currentDims.lanes[idx].y = Math.max(0, Math.min(1080 - sl.size, sl.y + actualDy));
              } else if (s.type === 'spell') {
                const ss = dragStartDims.spells[idx];
                currentDims.spells[idx].x = Math.max(0, Math.min(1920 - ss.w, ss.x + actualDx));
                currentDims.spells[idx].y = Math.max(0, Math.min(1080 - ss.h, ss.y + actualDy));
              }
            } else {
              // A. ALLY PICKS
              if (groupModes.ally_picks) {
                for (let i = 0; i < 5; i++) {
                  const sp = dragStartDims.allyPicks[i];
                  currentDims.allyPicks[i].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                  currentDims.allyPicks[i].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
                }
              } else if (s.type === 'ally_pick') {
                const sp = dragStartDims.allyPicks[idx];
                currentDims.allyPicks[idx].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                currentDims.allyPicks[idx].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
              }

              // B. ENEMY PICKS
              if (groupModes.enemy_picks) {
                for (let i = 0; i < 5; i++) {
                  const sp = dragStartDims.enemyPicks[i];
                  currentDims.enemyPicks[i].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                  currentDims.enemyPicks[i].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
                }
              } else if (s.type === 'enemy_pick') {
                const sp = dragStartDims.enemyPicks[idx];
                currentDims.enemyPicks[idx].x = Math.max(0, Math.min(1920 - sp.w, sp.x + actualDx));
                currentDims.enemyPicks[idx].y = Math.max(0, Math.min(1080 - sp.h, sp.y + actualDy));
              }

              // C. BANS (ALLY & ENEMY)
              if (groupModes.bans) {
                for (let i = 0; i < 5; i++) {
                  const sb = dragStartDims.allyBans[i];
                  currentDims.allyBans[i].x = Math.max(0, Math.min(1920 - sb.size, sb.x + actualDx));
                  currentDims.allyBans[i].y = Math.max(0, Math.min(1080 - sb.size, sb.y + actualDy));
                  const eb = dragStartDims.enemyBans[i];
                  currentDims.enemyBans[i].x = Math.max(0, Math.min(1920 - eb.size, eb.x + actualDx));
                  currentDims.enemyBans[i].y = Math.max(0, Math.min(1080 - eb.size, eb.y + actualDy));
                }
              } else if (s.type === 'ally_ban') {
                const sb = dragStartDims.allyBans[idx];
                currentDims.allyBans[idx].x = Math.max(0, Math.min(1920 - sb.size, sb.x + actualDx));
                currentDims.allyBans[idx].y = Math.max(0, Math.min(1080 - sb.size, sb.y + actualDy));
              } else if (s.type === 'enemy_ban') {
                const eb = dragStartDims.enemyBans[idx];
                currentDims.enemyBans[idx].x = Math.max(0, Math.min(1920 - eb.size, eb.x + actualDx));
                currentDims.enemyBans[idx].y = Math.max(0, Math.min(1080 - eb.size, eb.y + actualDy));
              }

              // D. FLAGS (SUB-ELEMENT)
              if (groupModes.flags) {
                for (let i = 0; i < 5; i++) {
                  const sf = dragStartDims.flags[i];
                  currentDims.flags[i].x = Math.max(0, Math.min(1920 - sf.size, sf.x + actualDx));
                  currentDims.flags[i].y = Math.max(0, Math.min(1080 - sf.size, sf.y + actualDy));
                }
              } else if (s.type === 'flag') {
                const sf = dragStartDims.flags[idx];
                currentDims.flags[idx].x = Math.max(0, Math.min(1920 - sf.size, sf.x + actualDx));
                currentDims.flags[idx].y = Math.max(0, Math.min(1080 - sf.size, sf.y + actualDy));
              }

              // E. LANES (SUB-ELEMENT)
              if (groupModes.lanes) {
                for (let i = 0; i < 5; i++) {
                  const sl = dragStartDims.lanes[i];
                  currentDims.lanes[i].x = Math.max(0, Math.min(1920 - sl.size, sl.x + actualDx));
                  currentDims.lanes[i].y = Math.max(0, Math.min(1080 - sl.size, sl.y + actualDy));
                }
              } else if (s.type === 'lane') {
                const sl = dragStartDims.lanes[idx];
                currentDims.lanes[idx].x = Math.max(0, Math.min(1920 - sl.size, sl.x + actualDx));
                currentDims.lanes[idx].y = Math.max(0, Math.min(1080 - sl.size, sl.y + actualDy));
              }

              // F. SPELLS (SUB-ELEMENT)
              if (groupModes.spells) {
                for (let i = 0; i < 5; i++) {
                  const ss = dragStartDims.spells[i];
                  currentDims.spells[i].x = Math.max(0, Math.min(1920 - ss.w, ss.x + actualDx));
                  currentDims.spells[i].y = Math.max(0, Math.min(1080 - ss.h, ss.y + actualDy));
                }
              } else if (s.type === 'spell') {
                const ss = dragStartDims.spells[idx];
                currentDims.spells[idx].x = Math.max(0, Math.min(1920 - ss.w, ss.x + actualDx));
                currentDims.spells[idx].y = Math.max(0, Math.min(1080 - ss.h, ss.y + actualDy));
              }
            }
          } else {
            // Resize Modes (nw, ne, se, sw, n, s, w, e)
            const idx = s.index;
            if (isUngrouped) {
              if (s.type === 'ally_pick') {
                const sp = dragStartDims.allyPicks[idx];
                if (editDragMode.includes('e')) currentDims.allyPicks[idx].w = Math.max(40, Math.min(600, sp.w + dx));
                if (editDragMode.includes('s')) currentDims.allyPicks[idx].h = Math.max(40, Math.min(400, sp.h + dy));
                if (editDragMode.includes('w')) {
                  const newW = Math.max(40, sp.w - dx);
                  currentDims.allyPicks[idx].x = Math.max(0, sp.x + (sp.w - newW));
                  currentDims.allyPicks[idx].w = newW;
                }
                if (editDragMode.includes('n')) {
                  const newH = Math.max(40, sp.h - dy);
                  currentDims.allyPicks[idx].y = Math.max(0, sp.y + (sp.h - newH));
                  currentDims.allyPicks[idx].h = newH;
                }
              } else if (s.type === 'enemy_pick') {
                const sp = dragStartDims.enemyPicks[idx];
                if (editDragMode.includes('e')) currentDims.enemyPicks[idx].w = Math.max(40, Math.min(600, sp.w + dx));
                if (editDragMode.includes('s')) currentDims.enemyPicks[idx].h = Math.max(40, Math.min(400, sp.h + dy));
                if (editDragMode.includes('w')) {
                  const newW = Math.max(40, sp.w - dx);
                  currentDims.enemyPicks[idx].x = Math.max(0, sp.x + (sp.w - newW));
                  currentDims.enemyPicks[idx].w = newW;
                }
                if (editDragMode.includes('n')) {
                  const newH = Math.max(40, sp.h - dy);
                  currentDims.enemyPicks[idx].y = Math.max(0, sp.y + (sp.h - newH));
                  currentDims.enemyPicks[idx].h = newH;
                }
              } else if (s.type === 'ally_ban') {
                const delta = Math.max(dx, dy);
                currentDims.allyBans[idx].size = Math.max(30, Math.min(200, dragStartDims.allyBans[idx].size + delta));
              } else if (s.type === 'enemy_ban') {
                const delta = Math.max(dx, dy);
                currentDims.enemyBans[idx].size = Math.max(30, Math.min(200, dragStartDims.enemyBans[idx].size + delta));
              } else if (s.type === 'flag') {
                currentDims.flags[idx].size = Math.max(15, Math.min(150, dragStartDims.flags[idx].size + dx));
              } else if (s.type === 'lane') {
                currentDims.lanes[idx].size = Math.max(15, Math.min(150, dragStartDims.lanes[idx].size + dx));
              } else if (s.type === 'spell') {
                if (editDragMode.includes('e')) currentDims.spells[idx].w = Math.max(15, dragStartDims.spells[idx].w + dx);
                if (editDragMode.includes('s')) currentDims.spells[idx].h = Math.max(15, dragStartDims.spells[idx].h + dy);
              }
            } else {
              if (s.type === 'ally_pick') {
                const count = groupModes.ally_picks ? 5 : 1;
                const startIdx = groupModes.ally_picks ? 0 : idx;
                for (let i = startIdx; i < startIdx + count; i++) {
                  const sp = dragStartDims.allyPicks[i];
                  if (editDragMode.includes('e')) currentDims.allyPicks[i].w = Math.max(40, Math.min(600, sp.w + dx));
                  if (editDragMode.includes('s')) currentDims.allyPicks[i].h = Math.max(40, Math.min(400, sp.h + dy));
                  if (editDragMode.includes('w')) {
                    const newW = Math.max(40, sp.w - dx);
                    currentDims.allyPicks[i].x = Math.max(0, sp.x + (sp.w - newW));
                    currentDims.allyPicks[i].w = newW;
                  }
                  if (editDragMode.includes('n')) {
                    const newH = Math.max(40, sp.h - dy);
                    currentDims.allyPicks[i].y = Math.max(0, sp.y + (sp.h - newH));
                    currentDims.allyPicks[i].h = newH;
                  }
                }
              } else if (s.type === 'enemy_pick') {
                const count = groupModes.enemy_picks ? 5 : 1;
                const startIdx = groupModes.enemy_picks ? 0 : idx;
                for (let i = startIdx; i < startIdx + count; i++) {
                  const sp = dragStartDims.enemyPicks[i];
                  if (editDragMode.includes('e')) currentDims.enemyPicks[i].w = Math.max(40, Math.min(600, sp.w + dx));
                  if (editDragMode.includes('s')) currentDims.enemyPicks[i].h = Math.max(40, Math.min(400, sp.h + dy));
                  if (editDragMode.includes('w')) {
                    const newW = Math.max(40, sp.w - dx);
                    currentDims.enemyPicks[i].x = Math.max(0, sp.x + (sp.w - newW));
                    currentDims.enemyPicks[i].w = newW;
                  }
                  if (editDragMode.includes('n')) {
                    const newH = Math.max(40, sp.h - dy);
                    currentDims.enemyPicks[i].y = Math.max(0, sp.y + (sp.h - newH));
                    currentDims.enemyPicks[i].h = newH;
                  }
                }
              } else if (s.type === 'ally_ban' || s.type === 'enemy_ban') {
                const delta = Math.max(dx, dy);
                if (groupModes.bans) {
                  for (let i = 0; i < 5; i++) {
                    currentDims.allyBans[i].size = Math.max(30, Math.min(200, dragStartDims.allyBans[i].size + delta));
                    currentDims.enemyBans[i].size = Math.max(30, Math.min(200, dragStartDims.enemyBans[i].size + delta));
                  }
                } else if (s.type === 'ally_ban') {
                  currentDims.allyBans[idx].size = Math.max(30, Math.min(200, dragStartDims.allyBans[idx].size + delta));
                } else {
                  currentDims.enemyBans[idx].size = Math.max(30, Math.min(200, dragStartDims.enemyBans[idx].size + delta));
                }
              } else if (s.type === 'flag') {
                const count = groupModes.flags ? 5 : 1;
                const startIdx = groupModes.flags ? 0 : idx;
                for (let i = startIdx; i < startIdx + count; i++) {
                  currentDims.flags[i].size = Math.max(15, Math.min(150, dragStartDims.flags[i].size + dx));
                }
              } else if (s.type === 'lane') {
                const count = groupModes.lanes ? 5 : 1;
                const startIdx = groupModes.lanes ? 0 : idx;
                for (let i = startIdx; i < startIdx + count; i++) {
                  currentDims.lanes[i].size = Math.max(15, Math.min(150, dragStartDims.lanes[i].size + dx));
                }
              } else if (s.type === 'spell') {
                const count = groupModes.spells ? 5 : 1;
                const startIdx = groupModes.spells ? 0 : idx;
                for (let i = startIdx; i < startIdx + count; i++) {
                  if (editDragMode.includes('e')) currentDims.spells[i].w = Math.max(15, dragStartDims.spells[i].w + dx);
                  if (editDragMode.includes('s')) currentDims.spells[i].h = Math.max(15, dragStartDims.spells[i].h + dy);
                }
              }
            }
          }

          updateInputsFromState();
          drawCanvas();

          if (slotEditBannerText) {
            const curSlot = getAllSlotRects().find((sl) => sl.id === activeEditSlot.id) || activeEditSlot;
            slotEditBannerText.innerHTML = `✏️ <strong>${curSlot.name}</strong>: ${Math.round(curSlot.w)}×${Math.round(curSlot.h)}px (X: ${Math.round(curSlot.x)}, Y: ${Math.round(curSlot.y)})`;
          }
          return;
        }

        // 2. Cursor Hover Feedback in Edit Mode
        if (activeEditSlot && canvasContainer) {
          const slots = getAllSlotRects();
          const curSlot = slots.find((s) => s.id === activeEditSlot.id);
          if (curSlot) {
            const handle = getHandleAt(coords.x, coords.y, curSlot);
            if (handle) {
              canvasContainer.style.cursor = handle.cursor;
              return;
            } else if (coords.x >= curSlot.x && coords.x <= curSlot.x + curSlot.w &&
                       coords.y >= curSlot.y && coords.y <= curSlot.y + curSlot.h) {
              canvasContainer.style.cursor = 'move';
              return;
            }
          }
          canvasContainer.style.cursor = 'default';
        }

        // 3. Normal Canvas Pan
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        applyCanvasTransform();
      });

      window.addEventListener('mouseup', () => {
        if (editDragMode) {
          editDragMode = null;
        }
        isDragging = false;
        if (canvasContainer && !activeEditSlot) canvasContainer.classList.remove('grabbing');
      });

      // Mouse Wheel Zoom centered at mouse position (Min zoom 1.0, Max zoom 5.0)
      canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
        const oldZoom = zoomScale;
        const newZoom = Math.min(Math.max(1.0, zoomScale * zoomFactor), 5.0);

        if (newZoom === oldZoom) return;

        // Pivot around mouse position so image point under cursor stays stationary
        panX = mouseX - (mouseX - panX) * (newZoom / oldZoom);
        panY = mouseY - (mouseY - panY) * (newZoom / oldZoom);

        zoomScale = newZoom;

        if (zoomScale <= 1.0) {
          zoomScale = 1.0;
          panX = 0;
          panY = 0;
        }

        applyCanvasTransform();
      });
    }

    // Copy JSON
    if (btnCopyJson) {
      btnCopyJson.addEventListener('click', () => {
        if (currentAnalysis) {
          navigator.clipboard.writeText(JSON.stringify(currentAnalysis, null, 2))
            .then(() => {
              btnCopyJson.innerText = '✓ Copied!';
              setTimeout(() => { btnCopyJson.innerText = '📋 Copy JSON'; }, 1800);
            });
        }
      });
    }
  }

  // Draggable Panel Resizer Splitter
  function bindPanelSplitter() {
    if (!panelResizerSplitter || !leftPanel || !checkerGridLayout) return;

    let isResizing = false;

    panelResizerSplitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      panelResizerSplitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const containerRect = checkerGridLayout.getBoundingClientRect();
      const clientX = e.clientX;
      const offsetX = clientX - containerRect.left;
      const totalWidth = containerRect.width;

      if (totalWidth > 0) {
        let pct = (offsetX / totalWidth) * 100;
        // Clamp between 30% and 75%
        pct = Math.max(30, Math.min(75, pct));
        leftPanel.style.flex = `0 0 ${pct}%`;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        panelResizerSplitter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // Settings Animated Dropdown
  function bindSettingsDropdown() {
    if (btnOpenSettings && settingsDropdownPanel) {
      btnOpenSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = settingsDropdownPanel.classList.contains('open');
        if (isOpen) {
          settingsDropdownPanel.classList.remove('open');
          btnOpenSettings.classList.remove('active');
        } else {
          settingsDropdownPanel.classList.add('open');
          btnOpenSettings.classList.add('active');
        }
      });

      // Close dropdown if clicked outside
      document.addEventListener('click', (e) => {
        if (!settingsDropdownPanel.contains(e.target) && !btnOpenSettings.contains(e.target)) {
          settingsDropdownPanel.classList.remove('open');
          btnOpenSettings.classList.remove('active');
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && settingsDropdownPanel.classList.contains('open')) {
          settingsDropdownPanel.classList.remove('open');
          btnOpenSettings.classList.remove('active');
        }
      });
    }

    dimSubTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        dimSubTabs.forEach((t) => t.classList.remove('active'));
        dimTabPanes.forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        const pane = document.getElementById(`pane${target.charAt(0).toUpperCase() + target.slice(1)}`);
        if (pane) pane.classList.add('active');
      });
    });

    const allInputs = [
      dimAllyBanX, dimAllyBanStep, dimEnemyBanX, dimEnemyBanStep, dimBanY, dimBanSize,
      dimAllyPickX, dimEnemyPickX, dimPickW, dimPickH,
      dimPickY0, dimPickY1, dimPickY2, dimPickY3, dimPickY4,
      dimFlagX, dimFlagY, dimFlagSize, dimLaneX, dimLaneY, dimLaneSize,
      dimSpellX, dimSpellY, dimSpellW, dimSpellH
    ];

    allInputs.forEach((inp) => {
      if (inp) {
        inp.addEventListener('input', readInputsAndRedraw);
      }
    });

    if (btnSaveDimensions) {
      btnSaveDimensions.addEventListener('click', saveDimensionsToServer);
    }

    if (btnExportJson) {
      btnExportJson.addEventListener('click', exportDimensionsJson);
    }

    if (btnResetDimensions) {
      btnResetDimensions.addEventListener('click', resetDimensionsToDefaults);
    }
  }

  function readInputsAndRedraw() {
    ensureDimsStructure(currentDims);

    const abx = parseInt(dimAllyBanX?.value || 30, 10);
    const astep = parseInt(dimAllyBanStep?.value || 110, 10);
    const ebx = parseInt(dimEnemyBanX?.value || 1370, 10);
    const estep = parseInt(dimEnemyBanStep?.value || 110, 10);
    const by = parseInt(dimBanY?.value || 6, 10);
    const bsz = parseInt(dimBanSize?.value || 80, 10);

    for (let i = 0; i < 5; i++) {
      currentDims.allyBans[i] = { x: abx + i * astep, y: by, size: bsz };
      currentDims.enemyBans[i] = { x: ebx + i * estep, y: by, size: bsz };
    }

    const apx = parseInt(dimAllyPickX?.value || 0, 10);
    const epx = parseInt(dimEnemyPickX?.value || 1710, 10);
    const pw = parseInt(dimPickW?.value || 210, 10);
    const ph = parseInt(dimPickH?.value || 132, 10);

    const ys = [
      parseInt(dimPickY0?.value || 125, 10),
      parseInt(dimPickY1?.value || 298, 10),
      parseInt(dimPickY2?.value || 470, 10),
      parseInt(dimPickY3?.value || 642, 10),
      parseInt(dimPickY4?.value || 814, 10)
    ];

    for (let i = 0; i < 5; i++) {
      currentDims.allyPicks[i] = { x: apx, y: ys[i], w: pw, h: ph };
      currentDims.enemyPicks[i] = { x: epx, y: ys[i], w: pw, h: ph };
    }

    const fx = parseInt(dimFlagX?.value || 6, 10);
    const fy = parseInt(dimFlagY?.value || 3, 10);
    const fsz = parseInt(dimFlagSize?.value || 46, 10);

    const lx = parseInt(dimLaneX?.value || 5, 10);
    const ly = parseInt(dimLaneY?.value || 53, 10);
    const lsz = parseInt(dimLaneSize?.value || 50, 10);

    const sx = parseInt(dimSpellX?.value || 194, 10);
    const sy = parseInt(dimSpellY?.value || 2, 10);
    const sw = parseInt(dimSpellW?.value || 54, 10);
    const sh = parseInt(dimSpellH?.value || 55, 10);

    for (let i = 0; i < 5; i++) {
      currentDims.flags[i] = { x: currentDims.allyPicks[i].x + fx, y: currentDims.allyPicks[i].y + fy, size: fsz };
      currentDims.lanes[i] = { x: currentDims.allyPicks[i].x + lx, y: currentDims.allyPicks[i].y + ly, size: lsz };
      currentDims.spells[i] = { x: currentDims.allyPicks[i].x + sx, y: currentDims.allyPicks[i].y + sy, w: sw, h: sh };
    }

    drawCanvas();
  }

  function updateInputsFromState() {
    ensureDimsStructure(currentDims);

    if (dimAllyBanX) dimAllyBanX.value = currentDims.allyBans[0].x;
    if (dimAllyBanStep) dimAllyBanStep.value = currentDims.allyBans[1].x - currentDims.allyBans[0].x;
    if (dimEnemyBanX) dimEnemyBanX.value = currentDims.enemyBans[0].x;
    if (dimEnemyBanStep) dimEnemyBanStep.value = currentDims.enemyBans[1].x - currentDims.enemyBans[0].x;
    if (dimBanY) dimBanY.value = currentDims.allyBans[0].y;
    if (dimBanSize) dimBanSize.value = currentDims.allyBans[0].size;

    if (dimAllyPickX) dimAllyPickX.value = currentDims.allyPicks[0].x;
    if (dimEnemyPickX) dimEnemyPickX.value = currentDims.enemyPicks[0].x;
    if (dimPickW) dimPickW.value = currentDims.allyPicks[0].w;
    if (dimPickH) dimPickH.value = currentDims.allyPicks[0].h;

    if (dimPickY0) dimPickY0.value = currentDims.allyPicks[0].y;
    if (dimPickY1) dimPickY1.value = currentDims.allyPicks[1].y;
    if (dimPickY2) dimPickY2.value = currentDims.allyPicks[2].y;
    if (dimPickY3) dimPickY3.value = currentDims.allyPicks[3].y;
    if (dimPickY4) dimPickY4.value = currentDims.allyPicks[4].y;

    if (dimFlagX) dimFlagX.value = currentDims.flags[0].x - currentDims.allyPicks[0].x;
    if (dimFlagY) dimFlagY.value = currentDims.flags[0].y - currentDims.allyPicks[0].y;
    if (dimFlagSize) dimFlagSize.value = currentDims.flags[0].size;

    if (dimLaneX) dimLaneX.value = currentDims.lanes[0].x - currentDims.allyPicks[0].x;
    if (dimLaneY) dimLaneY.value = currentDims.lanes[0].y - currentDims.allyPicks[0].y;
    if (dimLaneSize) dimLaneSize.value = currentDims.lanes[0].size;

    if (dimSpellX) dimSpellX.value = currentDims.spells[0].x - currentDims.allyPicks[0].x;
    if (dimSpellY) dimSpellY.value = currentDims.spells[0].y - currentDims.allyPicks[0].y;
    if (dimSpellW) dimSpellW.value = currentDims.spells[0].w;
    if (dimSpellH) dimSpellH.value = currentDims.spells[0].h;
  }

  function constructNormalizedRois() {
    ensureDimsStructure(currentDims);
    const rois = {};

    for (let i = 0; i < 5; i++) {
      const b = currentDims.allyBans[i];
      rois[`ally_ban_${i}`] = [b.x / 1920, b.y / 1080, b.size / 1920, b.size / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const b = currentDims.enemyBans[i];
      rois[`enemy_ban_${i}`] = [b.x / 1920, b.y / 1080, b.size / 1920, b.size / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const p = currentDims.allyPicks[i];
      rois[`ally_pick_${i}`] = [p.x / 1920, p.y / 1080, p.w / 1920, p.h / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const p = currentDims.enemyPicks[i];
      rois[`enemy_pick_${i}`] = [p.x / 1920, p.y / 1080, p.w / 1920, p.h / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const fl = currentDims.flags[i];
      rois[`flag_${i}`] = [fl.x / 1920, fl.y / 1080, fl.size / 1920, fl.size / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const ln = currentDims.lanes[i];
      rois[`lane_${i}`] = [ln.x / 1920, ln.y / 1080, ln.size / 1920, ln.size / 1080];
    }
    for (let i = 0; i < 5; i++) {
      const sp = currentDims.spells[i];
      rois[`spell_${i}`] = [sp.x / 1920, sp.y / 1080, sp.w / 1920, sp.h / 1080];
    }

    return rois;
  }

  function saveDimensionsToServer() {
    if (dimStatusMsg) dimStatusMsg.innerText = 'Saving to engine...';
    ensureDimsStructure(currentDims);
    const rois = constructNormalizedRois();
    localStorage.setItem('mlbb_saved_dims', JSON.stringify(currentDims));

    fetch('http://127.0.0.1:5000/api/save_rois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rois, raw_pixel_spec: currentDims })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (dimStatusMsg) dimStatusMsg.innerText = '✓ Saved & Applied to Checker!';
          setTimeout(() => { if (dimStatusMsg) dimStatusMsg.innerText = ''; }, 3000);
          showToast('💾 Saved Dimensions & Applied to Checker!');
          if (currentImage && previewCanvas) {
            analyzeBase64Frame(previewCanvas.toDataURL('image/png'));
          }
        } else {
          if (dimStatusMsg) dimStatusMsg.innerText = `Error: ${data.error || 'Failed'}`;
        }
      })
      .catch(() => {
        if (dimStatusMsg) dimStatusMsg.innerText = '✓ Saved locally (Engine offline)';
        showToast('💾 Saved Dimensions Locally');
        setTimeout(() => { if (dimStatusMsg) dimStatusMsg.innerText = ''; }, 3000);
      });
  }

  function exportDimensionsJson() {
    ensureDimsStructure(currentDims);
    const payload = {
      version: "2.0",
      thresholds: {
        pick_threshold: 0.18,
        ban_threshold: 0.18,
        item_threshold: 0.50,
        empty_slot_std: 12.0
      },
      raw_pixel_spec: currentDims,
      rois: constructNormalizedRois()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rois_config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function resetDimensionsToDefaults() {
    currentDims = ensureDimsStructure(JSON.parse(JSON.stringify(defaultDims)));
    localStorage.removeItem('mlbb_saved_dims');
    updateInputsFromState();
    drawCanvas();
    if (dimStatusMsg) dimStatusMsg.innerText = '✓ Reset to official default spec!';
    setTimeout(() => { if (dimStatusMsg) dimStatusMsg.innerText = ''; }, 2500);
    showToast('🔄 Reset all slot dimensions to default!');

    // Sync reset to engine & re-analyze
    fetch('http://127.0.0.1:5000/api/reset_rois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
      .then((res) => res.json())
      .then(() => {
        if (currentImage && previewCanvas) {
          analyzeBase64Frame(previewCanvas.toDataURL('image/png'));
        }
      })
      .catch(() => {});
  }

  function loadServerRois() {
    // 1. Check localStorage first for instant restore
    try {
      const saved = localStorage.getItem('mlbb_saved_dims');
      if (saved) {
        currentDims = ensureDimsStructure(JSON.parse(saved));
        updateInputsFromState();
        drawCanvas();
      }
    } catch (e) {}

    // 2. Fetch latest active configuration from backend
    fetch('http://127.0.0.1:5000/api/get_rois')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (data.raw_pixel_spec && Object.keys(data.raw_pixel_spec).length > 0) {
            currentDims = ensureDimsStructure(data.raw_pixel_spec);
          } else if (data.rois) {
            const r = data.rois;
            ensureDimsStructure(currentDims);

            for (let i = 0; i < 5; i++) {
              if (r[`ally_ban_${i}`]) {
                const b = r[`ally_ban_${i}`];
                currentDims.allyBans[i] = { x: Math.round(b[0] * 1920), y: Math.round(b[1] * 1080), size: Math.round(b[2] * 1920) };
              }
              if (r[`enemy_ban_${i}`]) {
                const b = r[`enemy_ban_${i}`];
                currentDims.enemyBans[i] = { x: Math.round(b[0] * 1920), y: Math.round(b[1] * 1080), size: Math.round(b[2] * 1920) };
              }
              if (r[`ally_pick_${i}`]) {
                const p = r[`ally_pick_${i}`];
                currentDims.allyPicks[i] = { x: Math.round(p[0] * 1920), y: Math.round(p[1] * 1080), w: Math.round(p[2] * 1920), h: Math.round(p[3] * 1080) };
              }
              if (r[`enemy_pick_${i}`]) {
                const p = r[`enemy_pick_${i}`];
                currentDims.enemyPicks[i] = { x: Math.round(p[0] * 1920), y: Math.round(p[1] * 1080), w: Math.round(p[2] * 1920), h: Math.round(p[3] * 1080) };
              }
              if (r[`flag_${i}`]) {
                const f = r[`flag_${i}`];
                currentDims.flags[i] = { x: Math.round(f[0] * 1920), y: Math.round(f[1] * 1080), size: Math.round(f[2] * 1920) };
              }
              if (r[`lane_${i}`]) {
                const l = r[`lane_${i}`];
                currentDims.lanes[i] = { x: Math.round(l[0] * 1920), y: Math.round(l[1] * 1080), size: Math.round(l[2] * 1920) };
              }
              if (r[`spell_${i}`]) {
                const s = r[`spell_${i}`];
                currentDims.spells[i] = { x: Math.round(s[0] * 1920), y: Math.round(s[1] * 1080), w: Math.round(s[2] * 1920), h: Math.round(s[3] * 1080) };
              }
            }
          }

          localStorage.setItem('mlbb_saved_dims', JSON.stringify(currentDims));
          updateInputsFromState();
          drawCanvas();
        }
      })
      .catch(() => {});
  }

  function bindFilterTabs() {
    filterTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        filterTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        activeTableFilter = tab.getAttribute('data-filter') || 'all';
        if (currentAnalysis) {
          renderTelemetryTable(currentAnalysis);
        }
      });
    });
  }

  function applyCanvasTransform() {
    if (previewCanvas) {
      previewCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    }
  }

  function processFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (.png, .jpg, .jpeg, .webp)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        zoomScale = 1.0;
        panX = 0;
        panY = 0;
        applyCanvasTransform();
        if (canvasPlaceholder) canvasPlaceholder.style.display = 'none';
        drawCanvas();
        analyzeBase64Frame(e.target.result);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function drawCanvas() {
    if (!currentImage || !previewCanvas) return;

    const ctx = previewCanvas.getContext('2d');
    previewCanvas.width = 1920;
    previewCanvas.height = 1080;

    ctx.clearRect(0, 0, 1920, 1080);
    ctx.drawImage(currentImage, 0, 0, 1920, 1080);

    ensureDimsStructure(currentDims);

    // 1. Draw Hero Slots (Bans & Picks)
    if (chkShowROIs && chkShowROIs.checked) {
      ctx.lineWidth = 2;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';

      // Ally Bans (1-5)
      ctx.strokeStyle = '#0ea5e9';
      ctx.fillStyle = '#0ea5e9';
      for (let i = 0; i < 5; i++) {
        const b = currentDims.allyBans[i];
        ctx.strokeRect(b.x, b.y, b.size, b.size);
        ctx.fillText(`Ally Ban ${i + 1}`, b.x + 4, b.y + 16);
      }

      // Enemy Bans (6-10)
      ctx.strokeStyle = '#ef4444';
      ctx.fillStyle = '#ef4444';
      for (let i = 0; i < 5; i++) {
        const b = currentDims.enemyBans[i];
        ctx.strokeRect(b.x, b.y, b.size, b.size);
        ctx.fillText(`Enemy Ban ${i + 1}`, b.x + 4, b.y + 16);
      }

      // Ally Picks (1-5)
      ctx.strokeStyle = '#38bdf8';
      ctx.fillStyle = '#38bdf8';
      for (let i = 0; i < 5; i++) {
        const p = currentDims.allyPicks[i];
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillText(`Ally Pick ${i + 1}`, p.x + 10, p.y + 20);
      }

      // Enemy Picks (6-10)
      ctx.strokeStyle = '#f87171';
      ctx.fillStyle = '#f87171';
      for (let i = 0; i < 5; i++) {
        const p = currentDims.enemyPicks[i];
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillText(`Enemy Pick ${i + 1}`, p.x + 10, p.y + 20);
      }
    }

    // 2. Draw Sub-Elements (Flag, Lane, Spell on Ally slots)
    if (chkShowSubElements && chkShowSubElements.checked) {
      ctx.lineWidth = 1.5;
      ctx.font = '10px "JetBrains Mono", monospace';

      for (let i = 0; i < 5; i++) {
        // Flag
        const fl = currentDims.flags[i];
        ctx.strokeStyle = '#10b981';
        ctx.fillStyle = '#10b981';
        ctx.strokeRect(fl.x, fl.y, fl.size, fl.size);
        ctx.fillText(`Flag`, fl.x + 4, fl.y + 22);

        // Lane
        const ln = currentDims.lanes[i];
        ctx.strokeStyle = '#a855f7';
        ctx.fillStyle = '#a855f7';
        ctx.strokeRect(ln.x, ln.y, ln.size, ln.size);
        ctx.fillText(`Lane`, ln.x + 4, ln.y + 26);

        // Battle Spell
        const sp = currentDims.spells[i];
        ctx.strokeStyle = '#f59e0b';
        ctx.fillStyle = '#f59e0b';
        ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);
        ctx.fillText(`Spell`, sp.x + 4, sp.y + 26);
      }
    }

    // 3. Highlight Actively Edited Slot (Triple-Click Selection)
    if (activeEditSlot) {
      const slots = getAllSlotRects();
      const s = slots.find((sl) => sl.id === activeEditSlot.id) || activeEditSlot;

      ctx.save();
      // Glowing Golden Dashed Outline
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 14;
      ctx.strokeRect(s.x, s.y, s.w, s.h);

      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // 8 Interactive Resize Handles
      const handles = getResizeHandles(s);
      const hSz = 10;
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#02040a';
      ctx.lineWidth = 2;

      for (const pos of Object.values(handles)) {
        ctx.fillRect(pos.x - hSz / 2, pos.y - hSz / 2, hSz, hSz);
        ctx.strokeRect(pos.x - hSz / 2, pos.y - hSz / 2, hSz, hSz);
      }

      // Slot Name & Dimension Badge Header
      const tagText = `✏️ ${s.name} (${Math.round(s.w)}×${Math.round(s.h)} at X:${Math.round(s.x)}, Y:${Math.round(s.y)})`;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(tagText).width;
      const tagY = Math.max(16, s.y - 8);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fillRect(s.x, tagY - 14, textWidth + 14, 20);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x, tagY - 14, textWidth + 14, 20);

      ctx.fillStyle = '#fbbf24';
      ctx.fillText(tagText, s.x + 6, tagY);
      ctx.restore();
    }
  }

  function analyzeBase64Frame(base64Data) {
    if (detectedPhaseName) detectedPhaseName.innerText = 'Analyzing Visual Anchors...';
    if (telemetryJsonBox) telemetryJsonBox.innerText = '// Processing computer vision multi-feature tensor banks...';

    fetch('http://127.0.0.1:5000/api/analyze_frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: base64Data }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          currentAnalysis = data;
          renderAnalysisResults(data);
        } else {
          if (detectedPhaseName) detectedPhaseName.innerText = 'Analysis Error';
          if (telemetryJsonBox) telemetryJsonBox.innerText = `Error: ${data.error || 'Unknown error'}`;
        }
      })
      .catch((err) => {
        if (detectedPhaseName) detectedPhaseName.innerText = 'Backend Offline';
        if (telemetryJsonBox) telemetryJsonBox.innerText = `Fetch Error: ${err.message}`;
      });
  }

  function captureLiveFrame() {
    if (detectedPhaseName) detectedPhaseName.innerText = 'Capturing Live Frame...';

    fetch('http://127.0.0.1:5000/api/analyze_frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          currentAnalysis = data;
          renderAnalysisResults(data);
        }
      })
      .catch(() => {
        alert('Failed to capture live frame. Make sure backend is running on port 5000.');
      });
  }

  function resolveAvatar(heroName, shape = 'round') {
    if (!heroName || heroName === 'Empty' || heroName === 'none' || heroName.startsWith('question')) {
      return '../assets/img/logo.png';
    }
    const clean = heroName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (shape === 'rect') {
      return `../assets/rect/${clean}.png`;
    }
    return `../assets/heroes/${clean}.png`;
  }

  function resolveLaneIcon(laneName) {
    if (!laneName) return '../assets/lanes/exp.png';
    const l = laneName.toLowerCase();
    if (l.includes('exp')) return '../assets/lanes/exp.png';
    if (l.includes('gold')) return '../assets/lanes/gold.png';
    if (l.includes('jungle')) return '../assets/lanes/jungle.png';
    if (l.includes('mid')) return '../assets/lanes/mid.png';
    if (l.includes('roam')) return '../assets/lanes/roam.png';
    return '../assets/lanes/exp.png';
  }

  function renderPlaceholderDisplays() {
    if (detectedTenBansRow) {
      const banHtml = [];
      for (let i = 0; i < 10; i++) {
        const isAlly = i < 5;
        banHtml.push(`
          <div class="ban-slot-card ${isAlly ? 'ally' : 'enemy'}">
            <div class="ban-slot-circle-wrap">
              <span class="empty-plus">+</span>
            </div>
            <span class="ban-slot-name" style="color: var(--text-muted);">EMPTY</span>
            <span class="ban-slot-conf empty">--</span>
          </div>
        `);
      }
      detectedTenBansRow.innerHTML = banHtml.join('');
    }

    if (detectedTenPicksRow) {
      const pickHtml = [];
      const defaultLanes = ['EXP Lane', 'Jungle', 'Mid Lane', 'Gold Lane', 'Roam'];
      for (let i = 0; i < 10; i++) {
        const isAlly = i < 5;
        const laneTagHtml = isAlly ? `<span class="pick-slot-lane-badge">${defaultLanes[i]}</span>` : '';
        pickHtml.push(`
          <div class="pick-slot-card ${isAlly ? 'ally' : 'enemy'}">
            <div class="pick-slot-circle-wrap">
              <span class="empty-plus">+</span>
            </div>
            <span class="pick-slot-name" style="color: var(--text-muted);">EMPTY</span>
            ${laneTagHtml}
            <span class="pick-slot-conf empty">--</span>
          </div>
        `);
      }
      detectedTenPicksRow.innerHTML = pickHtml.join('');
    }
  }

  function renderAnalysisResults(data) {
    if (detectedPhaseName) detectedPhaseName.innerText = data.phase || 'N/A';
    if (detectedPhaseConfidence) detectedPhaseConfidence.innerText = `${Math.round((data.confidence || 0) * 100)}% Match`;
    if (detectedPhaseDetails) detectedPhaseDetails.innerText = data.details || `NCC=${((data.confidence || 0) * 0.98).toFixed(3)}`;

    const rawBans = data.bans || [];
    const rawPicks = data.picks || [];

    // --- 1. RENDER 10 BAN SLOTS IN 1 SINGLE ROW (CLEAN HERO ICONS) ---
    if (detectedTenBansRow) {
      const banCards = [];
      for (let i = 0; i < 10; i++) {
        const isAlly = i < 5;
        const slotNum = i + 1;
        const b = rawBans[i] || { hero: null, confidence: 0.0 };
        const isMatched = !!b.hero;
        const heroName = isMatched ? b.hero.toUpperCase() : 'EMPTY';
        const confVal = Math.round((b.confidence || 0) * 100);
        const avatarSrc = resolveAvatar(b.hero, 'round');

        const iconHtml = isMatched
          ? `<img src="${avatarSrc}" alt="${heroName}" onerror="this.src='../assets/img/placeholder.svg'">`
          : `<span class="empty-plus">+</span>`;

        banCards.push(`
          <div class="ban-slot-card ${isAlly ? 'ally' : 'enemy'}" title="${isAlly ? 'Ally' : 'Enemy'} Ban ${slotNum}: ${heroName} (${confVal}%)">
            <div class="ban-slot-circle-wrap ${isMatched ? 'occupied' : ''}">
              ${iconHtml}
            </div>
            <span class="ban-slot-name" style="${isMatched ? (isAlly ? 'color: #38bdf8;' : 'color: #f87171;') : 'color: var(--text-muted);'}">${heroName}</span>
            <span class="ban-slot-conf ${isMatched ? 'locked' : 'empty'}">${isMatched ? confVal + '%' : '--'}</span>
          </div>
        `);
      }
      detectedTenBansRow.innerHTML = banCards.join('');
    }

    // --- 2. RENDER 10 PICK SLOTS IN 1 SINGLE ROW (CLEAN HERO ICONS & ALLY LANES) ---
    if (detectedTenPicksRow) {
      const pickCards = [];
      const defaultLanes = ['EXP Lane', 'Jungle', 'Mid Lane', 'Gold Lane', 'Roam'];
      for (let i = 0; i < 10; i++) {
        const isAlly = i < 5;
        const slotNum = i + 1;
        const p = rawPicks[i] || { hero: null, confidence: 0.0 };
        const isMatched = !!p.hero;
        const heroName = isMatched ? p.hero.toUpperCase() : 'EMPTY';
        const confVal = Math.round((p.confidence || 0) * 100);
        const avatarSrc = resolveAvatar(p.hero, 'round');

        const iconHtml = isMatched
          ? `<img src="${avatarSrc}" alt="${heroName}" onerror="this.src='../assets/img/placeholder.svg'">`
          : `<span class="empty-plus">+</span>`;

        // Lane name inside ally pick heroes only
        let laneTagHtml = '';
        if (isAlly) {
          const laneName = p.lane || defaultLanes[i];
          laneTagHtml = `<span class="pick-slot-lane-badge" title="Lane: ${laneName}">${laneName}</span>`;
        }

        pickCards.push(`
          <div class="pick-slot-card ${isAlly ? 'ally' : 'enemy'}" title="${isAlly ? 'Ally' : 'Enemy'} Pick ${isAlly ? slotNum : (slotNum - 5)}: ${heroName} (${confVal}%) ${isAlly ? '• Lane: ' + (p.lane || defaultLanes[i]) : ''}">
            <div class="pick-slot-circle-wrap ${isMatched ? ('occupied ' + (isAlly ? 'ally' : 'enemy')) : ''}">
              ${iconHtml}
            </div>
            <span class="pick-slot-name" style="${isMatched ? (isAlly ? 'color: #38bdf8;' : 'color: #f87171;') : 'color: var(--text-muted);'}">${heroName}</span>
            ${laneTagHtml}
            <span class="pick-slot-conf ${isMatched ? 'locked' : 'empty'}">${isMatched ? confVal + '%' : '--'}</span>
          </div>
        `);
      }
      detectedTenPicksRow.innerHTML = pickCards.join('');
    }

    // --- 4. TIMINGS & LATENCY BAR CHART ---
    const t = data.pipeline_timings_ms || data.timings || {};
    const extMs = t.extraction_ms || 0;
    const banMs = t.ban_inference_ms || 0;
    const pickMs = t.pick_inference_ms || (t.ally_pick_ms || 0) + (t.enemy_pick_ms || 0);
    const totalMs = t.total_ms || (extMs + banMs + pickMs) || 0.1;

    if (timingExtraction) timingExtraction.innerText = `${extMs.toFixed(1)}ms`;
    if (timingBan) timingBan.innerText = `${banMs.toFixed(1)}ms`;
    if (timingPick) timingPick.innerText = `${pickMs.toFixed(1)}ms`;
    if (timingTotal) timingTotal.innerText = `${totalMs.toFixed(1)}ms`;

    const extPct = Math.max(5, Math.min(80, (extMs / totalMs) * 100));
    const banPct = Math.max(5, Math.min(80, (banMs / totalMs) * 100));
    const pickPct = Math.max(5, Math.min(80, (pickMs / totalMs) * 100));

    if (latencyBarExtraction) {
      latencyBarExtraction.style.width = `${extPct}%`;
      latencyBarExtraction.title = `Extraction: ${extMs.toFixed(1)}ms (${Math.round(extPct)}%)`;
    }
    if (latencyBarBan) {
      latencyBarBan.style.width = `${banPct}%`;
      latencyBarBan.title = `Ban Multi-Feature: ${banMs.toFixed(1)}ms (${Math.round(banPct)}%)`;
    }
    if (latencyBarPick) {
      latencyBarPick.style.width = `${pickPct}%`;
      latencyBarPick.title = `Pick Multi-Feature: ${pickMs.toFixed(1)}ms (${Math.round(pickPct)}%)`;
    }

    if (telemetryFpsBadge) {
      const fps = totalMs > 0 ? Math.round(1000 / totalMs) : 60;
      telemetryFpsBadge.innerText = `~${fps} FPS (${totalMs.toFixed(1)}ms)`;
    }

    // --- 5. RENDER 20-SLOT TEXT-ONLY TELEMETRY TABLE ---
    renderTelemetryTable(data);

    // --- 6. RAW JSON TELEMETRY ---
    if (telemetryJsonBox) {
      telemetryJsonBox.innerText = JSON.stringify(data, null, 2);
    }
  }

  function renderTelemetryTable(data) {
    if (!telemetryTableBody) return;

    const rawBans = data.bans || [];
    const rawPicks = data.picks || [];

    const allSlots = [];

    // 10 Bans
    for (let i = 0; i < 10; i++) {
      const b = rawBans[i] || {};
      const side = i < 5 ? 'ally' : 'enemy';
      const slotNum = i + 1;
      allSlots.push({
        globalIdx: i + 1,
        type: 'Ban',
        side,
        slotKey: `${side === 'ally' ? '🔵' : '🔴'} Ban ${slotNum}`,
        hero: b.hero || null,
        confidence: b.confidence || 0,
        candidates: b.top_k_candidates || [],
        rejectionReason: b.rejection_reason || null
      });
    }

    // 10 Picks
    for (let i = 0; i < 10; i++) {
      const p = rawPicks[i] || {};
      const side = i < 5 ? 'ally' : 'enemy';
      const slotNum = i < 5 ? (i + 1) : (i - 4);
      allSlots.push({
        globalIdx: 10 + i + 1,
        type: 'Pick',
        side,
        slotKey: `${side === 'ally' ? '🔵' : '🔴'} Pick ${slotNum}`,
        hero: p.hero || null,
        confidence: p.confidence || 0,
        candidates: p.top_k_candidates || [],
        rejectionReason: p.rejection_reason || null
      });
    }

    // Filter slots based on active tab
    const filtered = allSlots.filter((slot) => {
      if (activeTableFilter === 'bans') return slot.type === 'Ban';
      if (activeTableFilter === 'picks') return slot.type === 'Pick';
      if (activeTableFilter === 'matched') return slot.hero !== null && slot.confidence > 0;
      return true;
    });

    if (filtered.length === 0) {
      telemetryTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 18px 0;">
            No slots matched filter '${activeTableFilter}'.
          </td>
        </tr>
      `;
      return;
    }

    const rowsHtml = filtered.map((s) => {
      const rowClass = s.side === 'ally' ? 'ally-row' : 'enemy-row';
      const keyClass = s.side === 'ally' ? 'ally' : 'enemy';

      const cands = s.candidates || [];

      // Choice 1 (Text + Score %)
      const c1 = cands[0] || { hero: s.hero || 'none', score: s.confidence || 0 };
      const h1Name = c1.hero ? c1.hero.toUpperCase() : 'EMPTY';
      const h1Score = Math.round(c1.score * 100);

      // Choice 2 (Text + Score % + Margin)
      let choice2Html = '<span style="color: var(--text-muted); font-size: 10px;">--</span>';
      if (cands.length > 1 && cands[1].hero) {
        const c2 = cands[1];
        const h2Name = c2.hero.toUpperCase();
        const h2Score = Math.round(c2.score * 100);
        const margin1 = Math.round((c1.score - c2.score) * 100);
        choice2Html = `
          <span class="table-candidate-text">
            <span class="c-name">${h2Name}</span>
            <span class="c-pct rank2">${h2Score}%</span>
            <span style="font-size: 8.5px; color: var(--text-muted);">(-${margin1}%)</span>
          </span>
        `;
      }

      // Choice 3 (Text + Score %)
      let choice3Html = '<span style="color: var(--text-muted); font-size: 10px;">--</span>';
      if (cands.length > 2 && cands[2].hero) {
        const c3 = cands[2];
        const h3Name = c3.hero.toUpperCase();
        const h3Score = Math.round(c3.score * 100);
        choice3Html = `
          <span class="table-candidate-text">
            <span class="c-name">${h3Name}</span>
            <span class="c-pct rank3">${h3Score}%</span>
          </span>
        `;
      }

      // Status pill
      let statusHtml = '';
      if (s.hero) {
        statusHtml = `<span class="table-status-pill locked">● LOCKED</span>`;
      } else if (s.rejectionReason) {
        const shortRej = s.rejectionReason.replace(/_/g, ' ');
        statusHtml = `<span class="table-status-pill gated" title="${s.rejectionReason}">▲ ${shortRej}</span>`;
      } else {
        statusHtml = `<span class="table-status-pill standby">○ STANDBY</span>`;
      }

      return `
        <tr class="${rowClass}">
          <td class="table-slot-idx">${s.globalIdx}</td>
          <td>
            <span class="table-slot-key ${keyClass}">${s.slotKey}</span>
          </td>
          <td>
            <span class="table-candidate-text">
              <span class="c-name" style="${s.hero ? (s.side === 'ally' ? 'color: #38bdf8;' : 'color: #f87171;') : 'color: var(--text-muted);'}">${s.hero ? h1Name : 'None / Empty'}</span>
              <span class="c-pct rank1">${s.hero ? h1Score + '%' : '--'}</span>
            </span>
          </td>
          <td>${choice2Html}</td>
          <td>${choice3Html}</td>
          <td style="text-align: right;">${statusHtml}</td>
        </tr>
      `;
    });

    telemetryTableBody.innerHTML = rowsHtml.join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
