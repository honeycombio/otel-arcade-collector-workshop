(async function () {
  const bucketsEl = document.getElementById('buckets');
  const statusEl  = document.getElementById('status');
  const scoreEl   = document.getElementById('score');
  const roundEl   = document.getElementById('round');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('pixel-sort');
  } catch (err) {
    statusEl.textContent = 'Failed to start: ' + err.message;
    return;
  }

  const SECTORS = [
    { color: 'red',    sector: 'Alpha', icon: '🔴', rowCount: 4096 },
    { color: 'blue',   sector: 'Beta',  icon: '🔵', rowCount: 6144 },
    { color: 'green',  sector: 'Gamma', icon: '🟢', rowCount: 3072 },
    { color: 'yellow', sector: 'Delta', icon: '🟡', rowCount: 5120 },
  ];

  // Easy: 3 rounds, Medium: 5, Hard: 8
  const ROUNDS = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 8 : 5;
  // Easy: 2200ms window, Medium: 1400ms, Hard: 900ms
  const CLICK_WINDOW_MS = difficulty === 'easy' ? 2200 : difficulty === 'hard' ? 900 : 1400;
  let totalScore = 0;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function renderBuckets(states) {
    bucketsEl.innerHTML = '';
    SECTORS.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'sort-bucket ' + (states[i] || 'waiting');
      div.innerHTML =
        '<span class="sort-bucket-icon">' + s.icon + '</span>' +
        '<div class="sort-bucket-label">' + s.sector + '</div>' +
        '<div class="sort-bucket-size">' + (s.rowCount / 1024).toFixed(0) + 'K rows</div>';
      bucketsEl.appendChild(div);
    });
  }

  for (let round = 0; round < ROUNDS; round++) {
    roundEl.textContent = round + 1;
    statusEl.className  = 'sort-status';

    // Shuffle activation order each round
    const activationOrder = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const states = ['waiting', 'waiting', 'waiting', 'waiting'];
    renderBuckets(states);
    statusEl.textContent = 'Get ready…';

    await delay(700);
    statusEl.textContent = 'Click each sector when it activates!';

    let roundScore = 0;
    const clickTimes = [];

    for (let ai = 0; ai < 4; ai++) {
      const idx = activationOrder[ai];
      await delay(300 + Math.random() * 900); // stagger activations

      states[idx] = 'active';
      renderBuckets(states);

      const activatedAt = Date.now();

      await new Promise(resolve => {
        const btn = bucketsEl.children[idx];
        function onClick() {
          const reactionMs = Date.now() - activatedAt;
          clickTimes.push(reactionMs);
          const pts = Math.max(0, Math.round((CLICK_WINDOW_MS - reactionMs) / 10));
          roundScore += pts;
          states[idx] = 'pending';
          renderBuckets(states);
          resolve();
        }
        btn.addEventListener('click', onClick, { once: true });
      });
    }

    // All 4 clicked — fire the scatter-gather sort
    statusEl.textContent = 'Sorting…';
    renderBuckets(['pending', 'pending', 'pending', 'pending']);

    try {
      await fetch('/api/games/pixel-sort/sort', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id: session.id,
          sectors: SECTORS.map(s => ({ color: s.color, sector: s.sector, row_count: s.rowCount })),
        }),
      });
    } catch (_) {}

    renderBuckets(['done', 'done', 'done', 'done']);
    totalScore += roundScore;
    scoreEl.textContent = totalScore;

    statusEl.className  = 'sort-status ok';
    statusEl.textContent = 'Merge complete! +' + roundScore + ' pts';
    await delay(1400);
  }

  statusEl.textContent = 'All sorts complete!';

  try {
    await window.Arcade.completeGame('pixel-sort', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({
    title: 'Sorted! 🟢',
    stats: [{ label: 'Rounds', value: ROUNDS }],
    score: totalScore,
  });
})();
