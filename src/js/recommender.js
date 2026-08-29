/**
 * MLBB Draft Picker — Esports Strategy & Counter Engine (recommender.js)
 * Computes win-probability, situational item counters, lane-specific counter-picks,
 * ally synergies, threat composition matrix, and real-time macro advice.
 */
(function () {
  'use strict';

  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === 'string' ? v : '');

  const ROLE_WEIGHTS = Object.freeze({
    Tank: { durability: 35, ccScore: 25, objective: 20 },
    Fighter: { durability: 22, ccScore: 15, objective: 20 },
    Mage: { magic: 1, ccScore: 20, scaling: 15 },
    Marksman: { phys: 1, scaling: 35, objective: 30 },
    Assassin: { scaling: 12, objective: 20 },
    Support: { durability: 15, ccScore: 22 },
  });

  const SPECIALTY_WEIGHTS = Object.freeze({
    'Crowd Control': { ccScore: 18 },
    'Burst': { scaling: 12 },
    'Sustain': { durability: 18 },
    'Shield Absorption': { durability: 18 },
    'Initiator': { ccScore: 15 },
    'Guard': { durability: 15 },
    'Finisher': { scaling: 10 },
  });

  const FIRST_PICK_HEROES = Object.freeze([
    'chou', 'fredrinn', 'valentina', 'mathilda', 'beatrix', 'joy', 'floryn', 'hilda', 'guinevere', 'ling'
  ]);

  // Wombo-Combo & Team Synergy Database
  const ALLY_SYNERGIES = Object.freeze({
    odette: {
      pairs: ['johnson', 'tigreal', 'atlas', 'carmilla'],
      bonus: 4,
      reason: 'Devastating AoE Crowd Control + Swan Song Ultimate wombo-combo.'
    },
    johnson: {
      pairs: ['odette', 'kadita', 'vale', 'cecilion'],
      bonus: 4,
      reason: 'Rapid Inbound crash dive delivers instant high-burst follow-up.'
    },
    guinevere: {
      pairs: ['tigreal', 'atlas', 'minotaur', 'gatotkaca'],
      bonus: 3,
      reason: 'Mass airborne sets guarantee 100% hit rate on Violet Requiem.'
    },
    cecilion: {
      pairs: ['carmilla'],
      bonus: 5,
      reason: 'Moonlit Waltz special skill grants massive bonus shield and burst dive.'
    },
    carmilla: {
      pairs: ['cecilion', 'vexana', 'luo_yi'],
      bonus: 4,
      reason: 'Curse of Blood chains all enemies to share 100% incoming damage & CC.'
    },
    ling: {
      pairs: ['angela', 'floryn', 'diggie'],
      bonus: 3,
      reason: 'Global healing & CC immunity shields Ling during deep backline dives.'
    },
    fanny: {
      pairs: ['angela', 'floryn'],
      bonus: 3,
      reason: 'Heartguard gives Fanny untargetable shielding and move speed during cable dives.'
    }
  });

  // Dedicated Tactical Counter Rules
  const SPECIAL_HERO_RULES = Object.freeze({
    baxia: {
      matchFn: (enemy) => arr(enemy.specialty).includes('Heal') || arr(enemy.specialty).includes('Sustain') || ['esmeralda', 'uranus', 'estes', 'yu_zhong', 'floryn', 'ruby', 'alucard'].includes(enemy.id),
      bonus: 5,
      reason: 'Baxia passive natively cuts enemy healing & shield regen by 50%.'
    },
    khufra: {
      matchFn: (enemy) => arr(enemy.specialty).includes('Extreme Mobility') || arr(enemy.specialty).includes('Mobility') || ['wanwan', 'fanny', 'ling', 'lancelot', 'benedetta', 'joy', 'chou'].includes(enemy.id),
      bonus: 5,
      reasonFn: (enemy) => `Bouncing Ball knocks down and blocks ${enemy.name}'s blink skills.`
    },
    minsitthar: {
      matchFn: (enemy) => arr(enemy.specialty).includes('Extreme Mobility') || ['wanwan', 'fanny', 'ling', 'lancelot', 'harith', 'joy'].includes(enemy.id),
      bonus: 5,
      reasonFn: (enemy) => `King's Calling arena silences all dash/blink skills of ${enemy.name}.`
    },
    diggie: {
      matchFn: (enemy) => arr(enemy.specialty).includes('Crowd Control') || ['tigreal', 'atlas', 'khufra', 'minotaur', 'guinevere', 'zetian', 'gatotkaca'].includes(enemy.id),
      bonus: 5,
      reason: 'Time Journey Ultimate cleanses all incoming team CC sets.'
    },
    lolita: {
      matchFn: (enemy) => ['chang_e', 'miya', 'layla', 'hanabi', 'gusion', 'cyclops', 'natan', 'lesley'].includes(enemy.id),
      bonus: 4,
      reasonFn: (enemy) => `Guardian's Bulwark shield completely blocks & reflects ${enemy.name}'s ranged projectiles.`
    },
    valir: {
      matchFn: (enemy) => ['hilda', 'belerick', 'uranus', 'esmeralda', 'yu_zhong', 'barats', 'akai'].includes(enemy.id),
      bonus: 4,
      reasonFn: (enemy) => `Continuous fire knockbacks & slows completely kite ${enemy.name}.`
    },
    franco: {
      matchFn: (enemy) => ['fanny', 'ling', 'joy', 'hayabusa', 'nolan'].includes(enemy.id),
      bonus: 4,
      reasonFn: (enemy) => `Bloody Beast Suppression locks down ${enemy.name} through all CC immunities.`
    },
    kaja: {
      matchFn: (enemy) => ['fanny', 'ling', 'joy', 'hayabusa', 'lancelot'].includes(enemy.id),
      bonus: 4,
      reasonFn: (enemy) => `Divine Judgment Suppression pulls and neutralizes ${enemy.name}.`
    }
  });

  const LANE_MAP = Object.freeze({
    'Marksman': 'Gold Lane',
    'Mage': 'Mid Lane',
    'Assassin': 'Jungle',
    'Tank': 'Roam',
    'Support': 'Roam',
    'Fighter': 'EXP Lane'
  });

  function resolveAvatar(hero) {
    if (!hero) return '../assets/img/placeholder.svg';
    if (hero.id) return `../assets/heroes/${hero.id}.png`;
    return hero.avatar || '../assets/img/placeholder.svg';
  }

  function resolveItemAvatar(item) {
    if (!item) return '../assets/img/placeholder.svg';
    if (item.id) return `../assets/items/${item.id}.png`;
    return item.avatar || '../assets/img/placeholder.svg';
  }

  function computeTeamMetrics(heroes) {
    const m = { phys: 0, magic: 0, trueDmg: 0, durability: 0, ccScore: 0, scaling: 0, objective: 0 };

    heroes.forEach((h) => {
      if (!h) return;
      if (h.damageType === 'Physical') m.phys++;
      else if (h.damageType === 'Magic') m.magic++;
      else if (h.damageType === 'True') m.trueDmg++;
      else { m.phys += 0.5; m.magic += 0.5; }

      const role = str(h.role);
      for (const [roleKey, weights] of Object.entries(ROLE_WEIGHTS)) {
        if (role.includes(roleKey)) {
          for (const [metric, value] of Object.entries(weights)) {
            m[metric] += value;
          }
        }
      }

      for (const spec of arr(h.specialty)) {
        const weights = SPECIALTY_WEIGHTS[spec];
        if (weights) {
          for (const [metric, value] of Object.entries(weights)) {
            m[metric] += value;
          }
        }
      }
    });

    const totalDmg = Math.max(1, m.phys + m.magic + m.trueDmg);
    return {
      physPercent: Math.round((m.phys / totalDmg) * 100),
      magicPercent: Math.round((m.magic / totalDmg) * 100),
      durability: Math.min(100, Math.round(m.durability)),
      ccScore: Math.min(100, Math.round(m.ccScore)),
      scaling: Math.min(100, Math.round(m.scaling)),
      objective: Math.min(100, Math.round(m.objective)),
    };
  }

  function updateWinProbability(allies, enemies) {
    const allyVal = document.getElementById('ally-win-prob-text');
    const enemyVal = document.getElementById('enemy-win-prob-text');
    const fillBar = document.getElementById('win-prob-bar-fill');
    const summary = document.getElementById('win-prob-explanation');

    if (!allyVal || !enemyVal || !fillBar) return;

    let allyScore = 50;
    let enemyScore = 50;
    const allyMetrics = computeTeamMetrics(allies);
    const enemyMetrics = computeTeamMetrics(enemies);

    enemies.forEach((enemy) => {
      allies.forEach((ally) => {
        if (arr(enemy.counteredBy).some((c) => c.heroId === ally.id)) allyScore += 4;
        if (arr(ally.counteredBy).some((c) => c.heroId === enemy.id)) enemyScore += 4;
      });
    });

    if (allyMetrics.durability > enemyMetrics.durability) allyScore += 3;
    if (enemyMetrics.durability > allyMetrics.durability) enemyScore += 3;
    if (allyMetrics.ccScore > enemyMetrics.ccScore) allyScore += 3;
    if (enemyMetrics.ccScore > allyMetrics.ccScore) enemyScore += 3;

    allyScore = Math.max(25, Math.min(75, allyScore));
    enemyScore = Math.max(25, Math.min(75, enemyScore));

    const total = allyScore + enemyScore;
    const allyPercent = Math.round((allyScore / total) * 100);
    const enemyPercent = 100 - allyPercent;

    allyVal.innerText = `${allyPercent}%`;
    enemyVal.innerText = `${enemyPercent}%`;
    fillBar.style.width = `${allyPercent}%`;

    const durEl = document.getElementById('durabilityVal');
    const ccEl = document.getElementById('ccVal');
    const dmgEl = document.getElementById('dmgSplitVal');
    if (durEl) durEl.innerText = `${allyMetrics.durability}`;
    if (ccEl) ccEl.innerText = `${allyMetrics.ccScore}`;
    if (dmgEl) dmgEl.innerText = `${allyMetrics.physPercent}% / ${allyMetrics.magicPercent}%`;

    if (summary) {
      if (allies.length === 0 && enemies.length === 0) {
        summary.innerText = 'Draft is balanced. BlueStacks CV auto-synchronizes locked picks and bans in real time.';
      } else if (allyPercent > 53) {
        summary.innerHTML = `<span class="esports-status-badge badge--ally">BLUE ALLY ADVANTAGE (${allyPercent}%)</span> <span class="esports-stat-dim">DEF: ${allyMetrics.durability} // CC: ${allyMetrics.ccScore} // OBJ: ${allyMetrics.objective}</span>`;
      } else if (enemyPercent > 53) {
        summary.innerHTML = `<span class="esports-status-badge badge--enemy">RED ENEMY ADVANTAGE (${enemyPercent}%)</span> <span class="esports-stat-dim">DEF: ${enemyMetrics.durability} // CC: ${enemyMetrics.ccScore} // OBJ: ${enemyMetrics.objective}</span>`;
      } else {
        summary.innerHTML = `<span class="esports-status-badge badge--even">BALANCED CONTEST (50:50)</span> <span class="esports-stat-dim">DEF: ${allyMetrics.durability} // CC: ${allyMetrics.ccScore} // OBJ: ${allyMetrics.objective}</span>`;
      }
    }
  }

  function scoreHero(hero, activeAllies, activeEnemies) {
    let score = 0;
    const reasons = [];
    const targets = [];

    // Already drafted check
    if (activeAllies.some((h) => h.id === hero.id) || activeEnemies.some((h) => h.id === hero.id)) {
      return { hero, score: -999, reasons: [], targets: [] };
    }

    // 1. Direct Enemy Counter Matching
    activeEnemies.forEach((enemy) => {
      const isCounteredByMe = arr(enemy.counteredBy).find((c) => c.heroId === hero.id);
      if (isCounteredByMe) {
        score += 6;
        reasons.push(`Counters <strong>${enemy.name}</strong>: ${isCounteredByMe.reason}`);
        targets.push(enemy.name);
      }

      const isCounteredByEnemy = arr(hero.counteredBy).find((c) => c.heroId === enemy.id);
      if (isCounteredByEnemy) score -= 3;

      // Rule-based special counters
      const rule = SPECIAL_HERO_RULES[hero.id];
      if (rule && rule.matchFn(enemy) && !targets.includes(enemy.name)) {
        score += rule.bonus;
        reasons.push(rule.reasonFn ? rule.reasonFn(enemy) : rule.reason);
        targets.push(enemy.name);
      }
    });

    // 2. Ally Synergies & Wombo-Combos
    activeAllies.forEach((ally) => {
      const syn = ALLY_SYNERGIES[hero.id];
      if (syn && syn.pairs.includes(ally.id)) {
        score += syn.bonus;
        reasons.push(`Synergy with <strong>${ally.name}</strong>: ${syn.reason}`);
      }

      const allySyn = ALLY_SYNERGIES[ally.id];
      if (allySyn && allySyn.pairs.includes(hero.id)) {
        score += allySyn.bonus;
        reasons.push(`Synergy with <strong>${ally.name}</strong>: ${allySyn.reason}`);
      }
    });

    // 3. Composition Balance & Missing Role Needs
    const existingRoles = activeAllies.map((h) => str(h.role));
    const hRole = str(hero.role);

    if (!existingRoles.some((r) => r.includes('Tank') || r.includes('Support')) && (hRole.includes('Tank') || hRole.includes('Support'))) {
      score += 4;
      reasons.push('Provides critical <strong>Frontline / Roamer</strong>.');
    }
    if (!existingRoles.some((r) => r.includes('Marksman')) && hRole.includes('Marksman')) {
      score += 3;
      reasons.push('Fills primary <strong>Gold Lane Physical Carry</strong>.');
    }
    if (!existingRoles.some((r) => r.includes('Mage')) && hRole.includes('Mage')) {
      score += 3;
      reasons.push('Fills primary <strong>Mid Lane Magic Damage & Waveclear</strong>.');
    }
    if (!existingRoles.some((r) => r.includes('Assassin') || r.includes('Fighter')) && (hRole.includes('Assassin') || hRole.includes('Fighter'))) {
      score += 2;
      reasons.push('Fills <strong>Jungler / Objective Finisher</strong>.');
    }

    // 4. S-Tier Blind First Pick
    if (activeEnemies.length === 0 && activeAllies.length === 0 && FIRST_PICK_HEROES.includes(hero.id)) {
      score += 5;
      reasons.push('S-Tier Versatile First Pick.');
    }

    const assignedLane = LANE_MAP[hero.role] || 'Flex';

    return { hero, score, reasons, targets, lane: assignedLane };
  }

  function analyzeThreats(enemies) {
    let magicCount = 0, physCount = 0;
    let shieldRegen = false, highMobility = false, highBurst = false, massCC = false, lateScaling = false;

    enemies.forEach((hero) => {
      if (hero.damageType === 'Magic' || hero.damageType === 'Hybrid') magicCount++;
      if (hero.damageType === 'Physical' || hero.damageType === 'Hybrid') physCount++;

      const specs = arr(hero.specialty);
      if (specs.includes('Sustain') || specs.includes('Shield Absorption') || specs.includes('Heal') || ['esmeralda', 'estes', 'uranus', 'yu_zhong', 'floryn', 'ruby'].includes(hero.id)) {
        shieldRegen = true;
      }
      if (specs.includes('Extreme Mobility') || specs.includes('Mobility') || ['fanny', 'ling', 'wanwan', 'joy', 'lancelot'].includes(hero.id)) {
        highMobility = true;
      }
      if (specs.includes('Burst') || ['saber', 'eudora', 'kadita', 'gusion', 'lesley', 'vale'].includes(hero.id)) {
        highBurst = true;
      }
      if (specs.includes('Crowd Control') || ['tigreal', 'atlas', 'minotaur', 'khufra', 'zetian'].includes(hero.id)) {
        massCC = true;
      }
      if (['layla', 'cecilion', 'lesley', 'claude', 'natan', 'aldous'].includes(hero.id)) {
        lateScaling = true;
      }
    });

    const threats = [];
    if (shieldRegen) {
      threats.push({
        text: 'Heavy Regen & Shields Detected — Rush Dominance Ice / Sea Halberd / Glowing Wand.',
        tag: 'ANTI-HEAL REQUIRED'
      });
    }
    if (highMobility) {
      threats.push({
        text: 'High Mobility Dash Threat — Lock Khufra / Minsitthar / Franco suppression.',
        tag: 'DASH LOCKOUT'
      });
    }
    if (massCC) {
      threats.push({
        text: 'Mass Teamfight AoE CC Danger — Draft Diggie / Purify spell to prevent wipeouts.',
        tag: 'CLEANSE REQUIRED'
      });
    }
    if (highBurst) {
      threats.push({
        text: 'High Single-Target Burst Danger — Build Immortality / Wind of Nature / Athena.',
        tag: 'BURST SHIELD'
      });
    }
    if (physCount >= 3) {
      threats.push({
        text: 'Heavy Physical Damage Threat (3+ Physicals) — Prioritize Antique Cuirass & Blade Armor.',
        tag: 'PHYSICAL ARMOR'
      });
    }
    if (magicCount >= 3) {
      threats.push({
        text: 'Heavy Magic Burst Threat (3+ Mages) — Prioritize Athena\'s Shield & Radiant Armor.',
        tag: 'MAGIC RESIST'
      });
    }
    if (lateScaling) {
      threats.push({
        text: 'Late-Game Hypercarry Enemy — Push aggressive early-game tempo before minute 12.',
        tag: 'EARLY TEMPO'
      });
    }

    return threats.length > 0 ? threats : [{ text: 'Balanced enemy composition without extreme biases.', tag: 'BALANCED' }];
  }

  function getDynamicItemRecommendations(activeEnemies, itemsDb) {
    if (!itemsDb || itemsDb.length === 0) return [];

    const itemMap = new Map();
    itemsDb.forEach((it) => itemMap.set(it.id, it));

    const scoredItems = new Map();

    const addItemScore = (itemId, score, reason) => {
      const it = itemMap.get(itemId);
      if (!it) return;
      const current = scoredItems.get(itemId) || { item: it, score: 0, reasons: [] };
      current.score += score;
      if (!current.reasons.includes(reason)) current.reasons.push(reason);
      scoredItems.set(itemId, current);
    };

    activeEnemies.forEach((enemy) => {
      // 1. Direct Item Counters defined in database
      arr(enemy.itemCounters).forEach((ic) => {
        addItemScore(ic.itemId, 4, `Counters ${enemy.name}: ${ic.reason}`);
      });

      // 2. Archetype Item Counters
      if (['esmeralda', 'estes', 'uranus', 'yu_zhong', 'floryn', 'ruby', 'alucard', 'carmilla'].includes(enemy.id)) {
        addItemScore('dominance_ice', 5, `Cuts ${enemy.name}'s regen & attack speed by 50%`);
        addItemScore('sea_halberd', 4, `Physical anti-heal & extra damage vs high HP`);
        addItemScore('glowing_wand', 4, `Magic burn applies 50% anti-heal`);
      }

      if (['layla', 'miya', 'moskov', 'bruno', 'irithel', 'claude'].includes(enemy.id)) {
        addItemScore('blade_armor', 4, `Reflects ${enemy.name}'s basic attack critical damage`);
        addItemScore('wind_of_nature', 5, `2s complete physical immunity against Marksman basic attacks`);
      }

      if (['saber', 'ling', 'lancelot', 'fanny', 'lapu_lapu', 'yin'].includes(enemy.id)) {
        addItemScore('antique_cuirass', 5, `Reduces ${enemy.name}'s physical skill burst by up to 24%`);
      }

      if (['eudora', 'aurora', 'kadita', 'kagura', 'cecilion', 'vexana', 'zetian', 'lunox', 'gord'].includes(enemy.id)) {
        addItemScore('athena_shield', 5, `Absorbs ${enemy.name}'s burst magic damage by 25% for 3s`);
      }

      if (['chang_e', 'valir', 'kimmy', 'zhask', 'yve'].includes(enemy.id)) {
        addItemScore('radiant_armor', 5, `Continuous magic reduction against ${enemy.name}'s multi-hit damage`);
      }
    });

    // Always include Immortality as high utility fallback
    addItemScore('immortality', 2, 'Second chance revive for late-game teamfights');

    return Array.from(scoredItems.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  function calculateSuggestions(params) {
    const { allyTeam, enemyTeam, heroesDb, itemsDb } = params;
    const activeEnemies = (enemyTeam || []).filter((h) => h !== null);
    const activeAllies = (allyTeam || []).filter((h) => h !== null);

    // 1. Update Win Probability & Team Composition Metrics
    updateWinProbability(activeAllies, activeEnemies);

    // 2. Render Threat Analysis
    const threatList = document.getElementById('enemy-threat-list');
    if (threatList) {
      if (activeEnemies.length === 0) {
        threatList.innerHTML = '<span class="text-placeholder">Waiting for enemy hero picks...</span>';
      } else {
        const threats = analyzeThreats(activeEnemies);
        threatList.innerHTML = threats.map((t) => `
          <div class="threat-tag">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
              <strong style="color:#f87171;font-size:9.5px;letter-spacing:0.5px;">// ${t.tag}</strong>
            </div>
            <span>${t.text}</span>
          </div>
        `).join('');
      }
    }

    // 3. Render Tactical Counter-Pick Recommendations
    const recHeroGrid = document.getElementById('recommended-heroes-grid');
    if (recHeroGrid) {
      if (activeAllies.length >= 5) {
        recHeroGrid.innerHTML = '<div class="rec-complete">Ally Team Complete (5/5) — All Lanes Locked.</div>';
      } else {
        const topPicks = (heroesDb || [])
          .map((h) => scoreHero(h, activeAllies, activeEnemies))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6);

        if (topPicks.length === 0) {
          recHeroGrid.innerHTML = '<div class="text-placeholder">Lock enemy heroes or pick first hero to activate suggestions.</div>';
        } else {
          recHeroGrid.innerHTML = topPicks.map((s) => `
            <div class="rec-hero-card" data-hero-id="${s.hero.id}" title="Click to Pick ${s.hero.name}">
              <img src="${resolveAvatar(s.hero)}" alt="${s.hero.name}" class="rec-avatar">
              <div class="rec-info">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                  <span class="rec-name">${s.hero.name}</span>
                  <span class="rec-score-pill">+${s.score}</span>
                </div>
                <div style="display:flex;align-items:center;gap:5px;margin-top:1px;">
                  <span class="rec-role">${s.hero.role}</span>
                  <span style="font-size:9px;color:#cbd5e1;background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">${s.lane}</span>
                </div>
                ${s.reasons[0] ? `<span class="rec-reason">${s.reasons[0]}</span>` : ''}
              </div>
            </div>
          `).join('');

          // Bind Quick-Pick Click Event to Recommended Hero Cards
          recHeroGrid.querySelectorAll('.rec-hero-card').forEach((card) => {
            card.addEventListener('click', () => {
              const hid = card.getAttribute('data-hero-id');
              if (!hid || !window.DraftState) return;
              const st = window.DraftState.get();
              const nextSlot = st.allyTeam.findIndex((h) => h === null);
              if (nextSlot !== -1) {
                window.DraftState.selectHero(hid, 'ally', nextSlot, 'pick');
                if (window.DraftBoardUI?.animateSlotLock) {
                  window.DraftBoardUI.animateSlotLock('ally', nextSlot);
                }
              }
            });
          });
        }
      }
    }

    // 4. Render Dynamic Situational Counter-Equipment
    const recItemGrid = document.getElementById('recommended-items-grid');
    if (recItemGrid) {
      const topItems = getDynamicItemRecommendations(activeEnemies, itemsDb);

      if (topItems.length === 0) {
        recItemGrid.innerHTML = '<span class="text-placeholder">Lock enemy heroes to see dynamic item counters.</span>';
      } else {
        recItemGrid.innerHTML = topItems.map((entry) => `
          <div class="rec-item-badge" title="${entry.item.name}\n${entry.reasons.join('\n')}">
            <img src="${resolveItemAvatar(entry.item)}" alt="${entry.item.name}" class="rec-item-img">
            <span>${entry.item.name}</span>
          </div>
        `).join('');
      }
    }
  }

  window.MLBBRecommender = {
    calculateSuggestions,
    computeTeamMetrics,
    updateWinProbability,
    scoreHero
  };
})();
