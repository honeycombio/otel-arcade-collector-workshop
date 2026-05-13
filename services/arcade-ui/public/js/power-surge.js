(async function () {
  const nodesEl  = document.getElementById('nodes');
  const statusEl = document.getElementById('status');
  const timerEl  = document.getElementById('timer');
  const hitsEl   = document.getElementById('hits');
  const scoreEl  = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('power-surge');
  } catch (err) {
    nodesEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  // Easy = 90s, Medium = 60s, Hard = 45s
  const GAME_MS = difficulty === 'easy' ? 90000 : difficulty === 'hard' ? 45000 : 60000;

  const NODE_DEFS = [
    { id: 'node_alpha', label: 'Alpha', emoji: '⚡' },
    { id: 'node_beta',  label: 'Beta',  emoji: '🔋' },
    { id: 'node_gamma', label: 'Gamma', emoji: '💡' },
    { id: 'node_delta', label: 'Delta', emoji: '🔌' },
  ];

  // Client-side state (advisory; server is authoritative on each click)
  const cs = {};
  NODE_DEFS.forEach(n => { cs[n.id] = { state: 'closed', openedAt: null, locked: false }; });

  let score = 0, hits = 0, gameOver = false;

  function renderNodes() {
    nodesEl.innerHTML = NODE_DEFS.map(n => {
      const s = cs[n.id];
      return '<div class="surge-node ' + s.state + (s.locked ? ' pinging' : '') + '" data-node-id="' + n.id + '">' +
        '<span class="surge-node-icon">' + n.emoji + '</span>' +
        '<span class="surge-node-label">' + n.label + '</span>' +
        '<span class="surge-node-state">' + s.state.replace('-', '‑') + '</span>' +
        '</div>';
    }).join('');
  }

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = 'surge-status' + (cls ? ' ' + cls : '');
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'surge-status'; }, 2000);
  }

  renderNodes();

  nodesEl.addEventListener('click', async (e) => {
    if (gameOver) return;
    const nodeEl = e.target.closest('[data-node-id]');
    if (!nodeEl) return;
    const nodeId = nodeEl.dataset.nodeId;
    const s = cs[nodeId];
    if (s.locked) return;
    s.locked = true;
    renderNodes();

    try {
      const resp = await fetch('/api/games/power-surge/circuit', {
        method:  'POST',
        headers: {
          'content-type':  'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({ session_id: session.id, node_id: nodeId, client_state: s.state }),
      });
      const data = await resp.json();

      // Sync client state from server truth
      s.state = data.circuit_state;
      if (s.state === 'open') s.openedAt = Date.now();
      else s.openedAt = null;

      if (data.probe_success === true) {
        score += 15; hits++;
        scoreEl.textContent = score; hitsEl.textContent = hits;
        setStatus('+15 — probe succeeded, circuit closed', 'ok');
      } else if (data.probe_success === null && data.circuit_state === 'closed') {
        score += 20; hits++;
        scoreEl.textContent = score; hitsEl.textContent = hits;
        setStatus('+20 — power flowing!', 'ok');
      } else if (data.probe_success === false) {
        setStatus('Probe failed — circuit re-opened', 'warn');
      } else {
        setStatus('Circuit OPEN — request rejected', 'bad');
      }
    } catch (_) {}

    s.locked = false;
    renderNodes();
  });

  // Random circuit tripping: 5% chance/sec per closed node
  const cycleInterval = setInterval(() => {
    if (gameOver) return;
    NODE_DEFS.forEach(n => {
      const s = cs[n.id];
      if (s.locked) return;
      if (s.state === 'closed' && Math.random() < 0.05) {
        s.state = 'open';
        s.openedAt = Date.now();
      }
      // Client-side HALF-OPEN indicator after 3 s (mirrors server transition)
      if (s.state === 'open' && s.openedAt && Date.now() - s.openedAt >= 3000) {
        s.state = 'half-open';
      }
    });
    renderNodes();
  }, 1000);

  const gameStart = Date.now();
  const timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((GAME_MS - (Date.now() - gameStart)) / 1000));
    timerEl.textContent = remaining;
    if (remaining === 0 && !gameOver) {
      gameOver = true;
      clearInterval(timerInterval);
      clearInterval(cycleInterval);
      endGame();
    }
  }, 250);

  async function endGame() {
    try {
      await window.Arcade.completeGame('power-surge', session.id, score, difficulty);
    } catch (_) {}
    window.Arcade.showGameOver({
      title: 'Grid Secured! ⚡',
      stats: [{ label: 'Circuits hit', value: hits }],
      score,
    });
  }
})();
