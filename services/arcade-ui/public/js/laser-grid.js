(async function () {
  const fieldEl      = document.getElementById('field');
  const timerEl      = document.getElementById('timer');
  const hitsEl       = document.getElementById('hits');
  const scoreEl      = document.getElementById('score');
  const tokenFillEl  = document.getElementById('token-fill');
  const tokenLabelEl = document.getElementById('token-label');
  const statusEl     = document.getElementById('laser-status');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('laser-grid');
  } catch (err) {
    fieldEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  const GAME_MS  = 60000;
  // Asteroid fall duration: Easy 5 s, Medium 3.5 s, Hard 2.5 s
  const FALL_MS  = difficulty === 'easy' ? 5000 : difficulty === 'hard' ? 2500 : 3500;
  // Spawn interval: Easy 2 s, Medium 1.2 s, Hard 0.8 s
  const SPAWN_MS = difficulty === 'easy' ? 2000 : difficulty === 'hard' ? 800  : 1200;

  const EMOJIS = ['☄️', '🪨', '👾', '💀'];
  let score = 0, hits = 0, gameOver = false;
  let statusTimeout = null;

  function updateMeter(tokens) {
    const shown = Math.max(0, tokens);
    const pct = Math.min(100, (shown / 10) * 100);
    tokenFillEl.style.width = pct + '%';
    tokenFillEl.className = 'laser-meter-fill' +
      (shown < 3 ? ' warn' : '') +
      (shown <= 0 ? ' depleted' : '');
    tokenLabelEl.textContent = 'tokens: ' + shown.toFixed(1);
  }

  function setStatus(msg, cls) {
    clearTimeout(statusTimeout);
    statusEl.textContent = msg;
    statusEl.className = 'laser-status-flash' + (cls ? ' ' + cls : '');
    statusTimeout = setTimeout(() => { statusEl.textContent = ''; }, 1500);
  }

  function spawnAsteroid() {
    if (gameOver) return;
    const el = document.createElement('div');
    el.className = 'laser-asteroid';
    el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    el.style.left = (5 + Math.random() * 85) + '%';
    el.style.top  = '-50px';
    el.dataset.targetId = 'ast_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    fieldEl.appendChild(el);

    let animId;
    const start = performance.now();
    const fieldH = fieldEl.clientHeight || 400;

    function fall(now) {
      const pct = (now - start) / FALL_MS;
      el.style.top = Math.round(pct * (fieldH + 80) - 50) + 'px';
      if (pct < 1 && !el.dataset.shot && !gameOver) {
        animId = requestAnimationFrame(fall);
      } else if (!el.dataset.shot) {
        el.remove();
      }
    }
    animId = requestAnimationFrame(fall);

    el.addEventListener('click', async () => {
      if (el.dataset.shot) return;
      el.dataset.shot = '1';
      cancelAnimationFrame(animId);

      let data = null;
      try {
        const resp = await fetch('/api/games/laser-grid/shot', {
          method:  'POST',
          headers: {
            'content-type':  'application/json',
            'x-player-id':   window.Arcade.getPlayerId(),
            'x-player-name': window.Arcade.getPlayerName(),
          },
          body: JSON.stringify({ session_id: session.id, target_id: el.dataset.targetId }),
        });
        data = await resp.json();
      } catch (_) {}

      if (!data) { el.remove(); return; }

      updateMeter(data.tokens_remaining);

      if (data.outcome === 'permitted') {
        score += 20; hits++;
        el.textContent = '💥';
        setTimeout(() => el.remove(), 300);
        setStatus('+20', 'ok');
      } else if (data.outcome === 'throttled') {
        score += 5; hits++;
        el.style.opacity = '0.4';
        setTimeout(() => el.remove(), data.wait_ms + 300);
        setStatus('throttled +5 (backoff ' + data.wait_ms + 'ms)', 'warn');
      } else {
        el.style.opacity = '0.2';
        setTimeout(() => el.remove(), 300);
        setStatus('rate limit exceeded — rejected!', 'bad');
      }
      scoreEl.textContent = score;
      hitsEl.textContent  = hits;
    });
  }

  const spawnInterval = setInterval(spawnAsteroid, SPAWN_MS);

  const gameStart = Date.now();
  const timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((GAME_MS - (Date.now() - gameStart)) / 1000));
    timerEl.textContent = remaining;
    if (remaining === 0 && !gameOver) {
      gameOver = true;
      clearInterval(timerInterval);
      clearInterval(spawnInterval);
      endGame();
    }
  }, 250);

  async function endGame() {
    fieldEl.innerHTML = '';
    try {
      await window.Arcade.completeGame('laser-grid', session.id, score, difficulty);
    } catch (_) {}
    window.Arcade.showGameOver({
      title: 'Grid Cleared! 🚀',
      stats: [{ label: 'Shots hit', value: hits }],
      score,
    });
  }
})();
