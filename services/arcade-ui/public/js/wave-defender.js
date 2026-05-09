(async function () {
  const tracksEl    = document.getElementById('tracks');
  const bannerEl    = document.getElementById('banner');
  const resultRow   = document.getElementById('result-row');
  const waveNumEl   = document.getElementById('wave-num');
  const destroyedEl = document.getElementById('destroyed');
  const escapedEl   = document.getElementById('escaped');
  const scoreEl     = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try {
    session = await window.Arcade.startGame('wave-defender');
  } catch (err) {
    bannerEl.textContent = 'Failed to start: ' + err.message;
    return;
  }

  // Wave configurations: each entry is a list of enemy descriptors.
  // Points are weighted by enemy type so the fan-out spans have varied values.
  const WAVES = [
    [
      { type: 'drone', emoji: '👾', points: 10 },
      { type: 'drone', emoji: '👾', points: 10 },
      { type: 'drone', emoji: '👾', points: 10 },
      { type: 'tank',  emoji: '💀', points: 20 },
    ],
    [
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'tank',   emoji: '💀', points: 20 },
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'boss',   emoji: '🤖', points: 30 },
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'tank',   emoji: '💀', points: 20 },
    ],
    [
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'boss',   emoji: '🤖', points: 30 },
      { type: 'tank',   emoji: '💀', points: 20 },
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'boss',   emoji: '🤖', points: 30 },
      { type: 'tank',   emoji: '💀', points: 20 },
      { type: 'drone',  emoji: '👾', points: 10 },
      { type: 'elite',  emoji: '👹', points: 40 },
    ],
  ];

  const WAVE_DURATION_MS = 6000;
  let totalDestroyed = 0;
  let totalEscaped   = 0;
  let totalScore     = 0;

  async function runWave(waveIndex) {
    const waveDefs = WAVES[waveIndex];
    waveNumEl.textContent = waveIndex + 1;
    resultRow.innerHTML   = '';

    bannerEl.textContent = 'Wave ' + (waveIndex + 1) + ' incoming!';
    await delay(900);

    // Build the track
    const track = document.createElement('div');
    track.className = 'wave-track';
    const base = document.createElement('div');
    base.className = 'wave-base';
    base.textContent = '🏰';
    track.appendChild(base);
    tracksEl.innerHTML = '';
    tracksEl.appendChild(track);

    // Place enemies and animate them marching left
    const enemies = waveDefs.map((def, i) => {
      const el = document.createElement('div');
      el.className  = 'wave-enemy';
      el.textContent = def.emoji;
      el.title      = def.type + ' (' + def.points + ' pts)';
      const startPct = 90 - i * 14;
      el.style.right = (100 - startPct) + '%';
      el.dataset.index = i;
      track.appendChild(el);

      let destroyed = false;
      el.addEventListener('click', () => {
        if (destroyed || el.classList.contains('escaped')) return;
        destroyed = true;
        el.classList.add('destroyed');
      });

      return { el, def, get destroyed() { return destroyed; } };
    });

    // Animate march: move enemies left over WAVE_DURATION_MS
    const start    = performance.now();
    let animFrame;
    await new Promise(resolve => {
      function tick(now) {
        const elapsed = now - start;
        const pct     = Math.min(elapsed / WAVE_DURATION_MS, 1);

        enemies.forEach((e, i) => {
          if (e.destroyed) return;
          const initRight  = (100 - (90 - i * 14));
          const targetRight = 92; // approaching the base
          const right = initRight + (targetRight - initRight) * pct;
          e.el.style.right = right + '%';

          if (right >= 92 && !e.destroyed) {
            e.el.classList.add('escaped');
          }
        });

        if (pct < 1) {
          animFrame = requestAnimationFrame(tick);
        } else {
          resolve();
        }
      }
      animFrame = requestAnimationFrame(tick);
    });
    cancelAnimationFrame(animFrame);

    // Collect results
    const waveEnemies = enemies.map(e => ({
      type:      e.def.type,
      points:    e.def.points,
      destroyed: e.destroyed && !e.el.classList.contains('escaped'),
    }));

    bannerEl.textContent = 'Resolving wave…';

    // Fire the fan-out endpoint — this is what creates the parallel child spans
    let wavePoints = 0;
    try {
      const r = await fetch('/api/games/wave-defender/wave', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id:  session.id,
          wave_number: waveIndex + 1,
          enemies:     waveEnemies,
        }),
      });
      const data = await r.json();
      wavePoints = data.wave_points || 0;
    } catch (_) {}

    // Update totals
    const waveDestroyed = waveEnemies.filter(e => e.destroyed).length;
    const waveEscaped   = waveEnemies.filter(e => !e.destroyed).length;
    totalDestroyed += waveDestroyed;
    totalEscaped   += waveEscaped;
    totalScore     += wavePoints;

    destroyedEl.textContent = totalDestroyed;
    escapedEl.textContent   = totalEscaped;
    scoreEl.textContent     = totalScore;

    // Show per-enemy result chips
    waveEnemies.forEach((e, i) => {
      const chip = document.createElement('div');
      chip.className  = 'wave-result-chip ' + (e.destroyed ? 'hit' : 'miss');
      chip.textContent = enemies[i].def.emoji + ' ' + (e.destroyed ? '+' + e.points : 'escaped');
      resultRow.appendChild(chip);
    });

    bannerEl.textContent = 'Wave ' + (waveIndex + 1) + ' done — ' + waveDestroyed + '/' + waveDefs.length + ' destroyed';
    await delay(1800);
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Run all three waves
  for (let i = 0; i < WAVES.length; i++) {
    await runWave(i);
    if (i < WAVES.length - 1) {
      bannerEl.textContent = 'Next wave in 2s…';
      await delay(2000);
    }
  }

  bannerEl.textContent = 'Game over!';
  try {
    await window.Arcade.completeGame('wave-defender', session.id, totalScore);
  } catch (_) {}

  window.Arcade.showGameOver({ title: 'Base Defended! 🏰', stats: [{ label: 'Destroyed', value: totalDestroyed }, { label: 'Escaped', value: totalEscaped }], score: totalScore });
})();
