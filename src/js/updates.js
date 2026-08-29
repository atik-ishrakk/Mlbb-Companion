/**
 * MLBB Companion — Updates & Patch Notes Controller (updates.js)
 * Manages version switching, patch searching, hero/item buff/nerf tags, and sync logs.
 */
(function () {
  'use strict';

  let activeIndex = 0;

  const versionListPane = document.getElementById('versionListPane');
  const activeVersionTitle = document.getElementById('activeVersionTitle');
  const activeVersionSummary = document.getElementById('activeVersionSummary');
  const heroChangesContainer = document.getElementById('heroChangesContainer');
  const itemChangesContainer = document.getElementById('itemChangesContainer');
  const patchSearchInput = document.getElementById('patchSearchInput');
  const telemetryConsole = document.getElementById('telemetryConsole');

  function getPatchNotes() {
    return window.PATCH_NOTES || [];
  }

  function init() {
    renderVersionList();
    renderVersionDetails(0);
    bindEvents();
    checkTelemetryStream();
    setInterval(checkTelemetryStream, 3000);
  }

  function bindEvents() {
    if (patchSearchInput) {
      patchSearchInput.addEventListener('input', handleSearch);
    }

    if (versionListPane) {
      versionListPane.addEventListener('click', (e) => {
        const item = e.target.closest('.version-item-card');
        if (!item) return;
        const idx = parseInt(item.getAttribute('data-version-index'), 10);
        if (!isNaN(idx)) selectVersion(idx);
      });
    }

    document.querySelectorAll('.patch-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.patch-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const filterType = btn.getAttribute('data-type') || 'all';
        applyFilter(filterType);
      });
    });
  }

  function renderVersionList() {
    if (!versionListPane) return;
    const patches = getPatchNotes();

    versionListPane.innerHTML = patches.map((p, i) => `
      <div class="version-item-card ${i === activeIndex ? 'active' : ''}" data-version-index="${i}">
        <div class="version-tag">${p.version}</div>
        <div class="version-date">${p.date} ${p.current ? '• (Current)' : ''}</div>
      </div>
    `).join('');
  }

  function selectVersion(index) {
    activeIndex = index;
    renderVersionList();
    renderVersionDetails(index);
  }

  function renderVersionDetails(index) {
    const patches = getPatchNotes();
    const patch = patches[index] || patches[0];
    if (!patch) return;

    if (activeVersionTitle) activeVersionTitle.innerText = `Patch ${patch.version} (${patch.date})`;
    if (activeVersionSummary) activeVersionSummary.innerText = patch.summary || 'Balance changes and system updates.';

    if (heroChangesContainer) {
      heroChangesContainer.innerHTML = (patch.heroChanges || []).map((h) => `
        <div class="patch-change-card" data-change-type="${h.type}">
          <div class="change-header">
            <span class="change-name">${h.name}</span>
            <span class="diff-badge ${h.type}">${(h.type || 'adjust').toUpperCase()}</span>
          </div>
          <div class="change-desc">${h.change}</div>
        </div>
      `).join('');
    }

    if (itemChangesContainer) {
      itemChangesContainer.innerHTML = (patch.itemChanges || []).map((it) => `
        <div class="patch-change-card" data-change-type="${it.type}">
          <div class="change-header">
            <span class="change-name">${it.name}</span>
            <span class="diff-badge ${it.type}">${(it.type || 'adjust').toUpperCase()}</span>
          </div>
          <div class="change-desc">${it.change}</div>
        </div>
      `).join('');
    }
  }

  function applyFilter(filterType) {
    document.querySelectorAll('.patch-change-card').forEach((card) => {
      const type = card.getAttribute('data-change-type');
      if (filterType === 'all' || type === filterType) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  function handleSearch() {
    const q = (patchSearchInput?.value || '').toLowerCase().trim();
    if (!q) {
      renderVersionDetails(activeIndex);
      return;
    }

    const patches = getPatchNotes();
    const matchedHeroes = [];
    const matchedItems = [];

    patches.forEach((p) => {
      (p.heroChanges || []).forEach((h) => {
        if (h.name.toLowerCase().includes(q) || h.change.toLowerCase().includes(q)) {
          matchedHeroes.push({ ...h, patchVersion: p.version });
        }
      });
      (p.itemChanges || []).forEach((it) => {
        if (it.name.toLowerCase().includes(q) || it.change.toLowerCase().includes(q)) {
          matchedItems.push({ ...it, patchVersion: p.version });
        }
      });
    });

    if (activeVersionTitle) activeVersionTitle.innerText = `Search Results for "${q}"`;
    if (activeVersionSummary) activeVersionSummary.innerText = `Found ${matchedHeroes.length} hero and ${matchedItems.length} item matching changes.`;

    if (heroChangesContainer) {
      heroChangesContainer.innerHTML = matchedHeroes.length > 0
        ? matchedHeroes.map((h) => `
            <div class="patch-change-card">
              <div class="change-header">
                <span class="change-name">${h.name} <small style="color: var(--text-muted); font-size: 10px;">(${h.patchVersion})</small></span>
                <span class="diff-badge ${h.type || 'adjust'}">${(h.type || 'adjust').toUpperCase()}</span>
              </div>
              <div class="change-desc">${h.change}</div>
            </div>
          `).join('')
        : '<div style="color: var(--text-muted); font-size: 11px;">No matching hero changes.</div>';
    }

    if (itemChangesContainer) {
      itemChangesContainer.innerHTML = matchedItems.length > 0
        ? matchedItems.map((it) => `
            <div class="patch-change-card">
              <div class="change-header">
                <span class="change-name">${it.name} <small style="color: var(--text-muted); font-size: 10px;">(${it.patchVersion})</small></span>
                <span class="diff-badge ${it.type || 'adjust'}">${(it.type || 'adjust').toUpperCase()}</span>
              </div>
              <div class="change-desc">${it.change}</div>
            </div>
          `).join('')
        : '<div style="color: var(--text-muted); font-size: 11px;">No matching item changes.</div>';
    }
  }

  function checkTelemetryStream() {
    fetch('http://127.0.0.1:5000/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'online' && telemetryConsole && data.gamePhase) {
          telemetryConsole.innerHTML += `<br>[TELEMETRY] Game Phase: ${data.gamePhase} | Device: ${data.device}`;
          telemetryConsole.scrollTop = telemetryConsole.scrollHeight;
        }
      })
      .catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();
