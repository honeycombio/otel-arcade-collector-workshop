(async function () {
  const difficulty = await window.Arcade.chooseDifficulty();

  // Easy: 3 trials, Medium: 5, Hard: 8
  const TRIALS = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 8 : 5;
  const circle  = document.getElementById('circle');
  const result  = document.getElementById('result');
  const history = document.getElementById('history');
  const roundEl = document.getElementById('round');
  const avgEl   = document.getElementById('avg');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try { session = await window.Arcade.startGame('reaction'); }
  catch (e) { result.textContent = 'Failed to start: ' + e.message; return; }

  let trial = 0;
  let times = [];
  let timer = null;
  let greenAt = null;
  let phase = 'idle'; // idle | waiting | ready | done

  circle.addEventListener('click', onCircleClick);

  function onCircleClick() {
    if (phase === 'idle') startTrial();
    else if (phase === 'waiting') tooEarly();
    else if (phase === 'ready') recordHit();
  }

  function startTrial() {
    if (trial >= TRIALS) return;
    phase = 'waiting';
    circle.className = 'reaction-circle wait';
    circle.textContent = 'Wait…';
    result.textContent = '';
    const delay = 1000 + Math.random() * 2500;
    timer = setTimeout(showGreen, delay);
  }

  function tooEarly() {
    clearTimeout(timer);
    phase = 'idle';
    circle.className = 'reaction-circle';
    circle.textContent = 'Too early! Click to retry';
    result.textContent = '';
    // Send browser span for the false start
    const now = window.BrowserTracer.nowNs();
    window.BrowserTracer.record('browser.reaction.too_early', {
      'trial.number': trial + 1,
      'game.session.id': session.id,
    }, now, now);
    // Server event
    window.Arcade.sendEvent('reaction', session.id, 'too_early', { trial: trial + 1 }).catch(() => {});
  }

  function showGreen() {
    phase = 'ready';
    greenAt = window.BrowserTracer.nowNs();
    circle.className = 'reaction-circle ready';
    circle.textContent = 'CLICK!';
  }

  async function recordHit() {
    const clickAt = window.BrowserTracer.nowNs();
    const reactionMs = Number(BigInt(clickAt) - BigInt(greenAt)) / 1e6;
    phase = 'idle';

    circle.className = 'reaction-circle done';
    circle.textContent = 'Click to continue';
    result.textContent = reactionMs.toFixed(0) + ' ms';
    times.push(reactionMs);

    // BROWSER SPAN — precise timing measured in browser
    window.BrowserTracer.record('browser.reaction.hit', {
      'reaction.time_ms':  Math.round(reactionMs),
      'trial.number':      trial + 1,
      'game.session.id':   session.id,
      'reaction.category': reactionMs < 200 ? 'fast' : reactionMs < 350 ? 'average' : 'slow',
    }, greenAt, clickAt);

    // Server event
    window.Arcade.sendEvent('reaction', session.id, 'trial', {
      trial: trial + 1,
      reaction_ms: Math.round(reactionMs),
    }).catch(() => {});

    addChip(reactionMs);
    trial++;
    roundEl.textContent = trial;
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    avgEl.textContent = avg.toFixed(0);

    if (trial >= TRIALS) await finish(avg);
  }

  function addChip(ms) {
    const chip = document.createElement('span');
    chip.className = 'reaction-chip' + (ms < 250 ? ' fast' : ms > 400 ? ' bad' : '');
    chip.textContent = Math.round(ms) + 'ms';
    history.appendChild(chip);
  }

  async function finish(avgMs) {
    circle.className = 'reaction-circle';
    circle.textContent = 'Done!';
    const score = Math.max(0, Math.round(1000 - avgMs));
    try { await window.Arcade.completeGame('reaction', session.id, score, difficulty); } catch (_) {}
    window.Arcade.showGameOver({ title: 'Fast Reflexes! ⚡', stats: [{ label: 'Avg Reaction', value: avgMs.toFixed(0) + ' ms' }], score });
  }
})();
