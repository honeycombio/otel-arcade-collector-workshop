(async function () {
  const deployAreaEl = document.getElementById('deploy-area');
  const roundNumEl   = document.getElementById('round-num');
  const canaryPctEl  = document.getElementById('canary-pct');
  const scoreEl      = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('canary-deploy');
  } catch (err) {
    deployAreaEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  // Starting canary % and per-round increment by difficulty
  // Easy:   start 10%, increment 10% per round
  // Medium: start 20%, increment 20% per round
  // Hard:   start 30%, increment 25% per round
  const startPct = difficulty === 'easy' ? 10 : difficulty === 'hard' ? 30 : 20;
  const stepPct  = difficulty === 'easy' ? 10 : difficulty === 'hard' ? 25 : 20;
  const ROUNDS   = 4;
  const BATCH    = 8;

  let totalScore = 0;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  for (let round = 0; round < ROUNDS; round++) {
    const canaryPct = Math.min(100, startPct + round * stepPct);
    roundNumEl.textContent = round + 1;
    canaryPctEl.textContent = canaryPct;

    deployAreaEl.innerHTML =
      '<div class="canary-round">' +
        '<div class="canary-split-bar">' +
          '<div class="canary-split-v1" style="width:' + (100 - canaryPct) + '%">v1 ' + (100 - canaryPct) + '%</div>' +
          '<div class="canary-split-v2" style="width:' + canaryPct + '%">v2 ' + canaryPct + '%</div>' +
        '</div>' +
        '<button class="canary-deploy-btn" id="deploy-btn">⚡ DEPLOY BATCH (' + BATCH + ' requests)</button>' +
        '<div class="canary-results" id="results-area"><span style="color:var(--muted);font-size:13px">Waiting for batch…</span></div>' +
        '<div class="canary-round-score" id="round-score"></div>' +
      '</div>';

    await new Promise(resolve => {
      document.getElementById('deploy-btn').addEventListener('click', resolve, { once: true });
    });

    const btn = document.getElementById('deploy-btn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const resultsEl    = document.getElementById('results-area');
    const roundScoreEl = document.getElementById('round-score');
    resultsEl.innerHTML = '';

    // Fire all 8 requests in parallel
    const promises = Array.from({ length: BATCH }, (_, i) => {
      return fetch('/api/games/canary-deploy/request', {
        method:  'POST',
        headers: {
          'content-type':  'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id:  session.id,
          request_id:  'req_r' + round + '_' + i,
          canary_pct:  canaryPct,
        }),
      }).then(r => r.json()).catch(() => ({ ok: false, version: 'v1', service_ok: false }));
    });

    const results = await Promise.all(promises);

    // Render individual request chips
    resultsEl.innerHTML = results.map(r => {
      const cls = r.version === 'v2'
        ? (r.service_ok ? 'chip chip--v2-ok' : 'chip chip--v2-err')
        : 'chip chip--v1';
      const label = r.version === 'v2' ? (r.service_ok ? 'v2 ✓' : 'v2 ✗') : 'v1 ✓';
      return '<span class="' + cls + '">' + label + '</span>';
    }).join('');

    // Tally score
    let roundScore = 0;
    results.forEach(r => {
      if (r.version === 'v1') roundScore += 10;
      else if (r.service_ok) roundScore += 30;
      else roundScore -= 10;
    });
    totalScore += Math.max(0, roundScore);
    scoreEl.textContent = totalScore;

    const v2Count = results.filter(r => r.version === 'v2').length;
    const v2Errs  = results.filter(r => r.version === 'v2' && !r.service_ok).length;
    roundScoreEl.className = 'canary-round-score' + (roundScore >= 0 ? ' ok' : ' bad');
    roundScoreEl.textContent = (roundScore >= 0 ? '+' : '') + roundScore + ' pts  |  ' +
      v2Count + ' canary (' + v2Errs + ' errors)';

    await delay(round < ROUNDS - 1 ? 2000 : 1000);
  }

  deployAreaEl.innerHTML = '<div style="font-size:15px;color:var(--accent2);padding:14px">Rollout complete!</div>';

  try {
    await window.Arcade.completeGame('canary-deploy', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({
    title: 'Rollout Complete! 🚀',
    stats: [{ label: 'Final canary %', value: Math.min(100, startPct + (ROUNDS - 1) * stepPct) + '%' }],
    score: totalScore,
  });
})();
