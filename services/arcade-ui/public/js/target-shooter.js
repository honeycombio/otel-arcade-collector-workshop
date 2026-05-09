(async function () {
  const difficulty = await window.Arcade.chooseDifficulty();

  const COLS = 5, ROWS = 4;
  // Easy: 40s, Medium: 30s, Hard: 20s
  const DURATION = difficulty === 'easy' ? 40 : difficulty === 'hard' ? 20 : 30;
  // Easy: 1800ms between targets, Medium: 1200ms, Hard: 700ms
  const TARGET_INTERVAL_MS = difficulty === 'easy' ? 1800 : difficulty === 'hard' ? 700 : 1200;
  const field   = document.getElementById('field');
  const hitsEl  = document.getElementById('hits');
  const missEl  = document.getElementById('misses');
  const timeEl  = document.getElementById('time');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try { session = await window.Arcade.startGame('target-shooter'); }
  catch (e) { field.innerHTML = '<p style="color:#ff5d76">' + e.message + '</p>'; return; }

  // Build grid
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const c = document.createElement('div');
    c.className = 'target-cell';
    c.dataset.index = i;
    c.textContent = '○';
    c.addEventListener('click', () => onCellClick(i));
    field.appendChild(c);
    cells.push(c);
  }

  let hits = 0, misses = 0, activeIdx = -1, done = false;
  let timeLeft = DURATION;

  function litNext() {
    if (done) return;
    if (activeIdx >= 0) cells[activeIdx].className = 'target-cell';
    activeIdx = Math.floor(Math.random() * cells.length);
    cells[activeIdx].className = 'target-cell lit';
    cells[activeIdx].textContent = '●';
  }

  function onCellClick(idx) {
    if (done) return;
    const col = idx % COLS, row = Math.floor(idx / COLS);
    const isHit = idx === activeIdx;
    const startNs = window.BrowserTracer.nowNs();

    if (isHit) {
      hits++;
      hitsEl.textContent = hits;
      cells[idx].className = 'target-cell hit';
      cells[idx].textContent = '✓';
      activeIdx = -1;
      setTimeout(litNext, 300);
    } else {
      misses++;
      missEl.textContent = misses;
      cells[idx].className = 'target-cell miss';
      setTimeout(() => { if (!done) cells[idx].className = 'target-cell'; cells[idx].textContent = '○'; }, 300);
    }

    const endNs = window.BrowserTracer.nowNs();
    // BROWSER SPAN — coordinates captured at click time in the browser
    window.BrowserTracer.record('browser.target.click', {
      'target.col':        col,
      'target.row':        row,
      'target.index':      idx,
      'click.hit':         isHit,
      'active.index':      activeIdx,
      'game.session.id':   session.id,
    }, startNs, endNs);

    window.Arcade.sendEvent('target-shooter', session.id, isHit ? 'hit' : 'miss', {
      col, row, index: idx,
    }).catch(() => {});
  }

  litNext();
  const moleTimer  = setInterval(litNext, TARGET_INTERVAL_MS);
  const tickTimer  = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) finish();
  }, 1000);

  async function finish() {
    done = true;
    clearInterval(moleTimer);
    clearInterval(tickTimer);
    if (activeIdx >= 0) cells[activeIdx].className = 'target-cell';
    const score = hits * 10 - misses * 3;
    try { await window.Arcade.completeGame('target-shooter', session.id, Math.max(0, score), difficulty); } catch (_) {}
    window.Arcade.showGameOver({ title: 'Shots Fired! 🎯', stats: [{ label: 'Hits', value: hits }, { label: 'Misses', value: misses }], score: Math.max(0, score) });
  }
})();
