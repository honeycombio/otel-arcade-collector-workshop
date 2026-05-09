(async function () {
  const grid = document.getElementById('grid');
  const hitsEl = document.getElementById('hits');
  const missesEl = document.getElementById('misses');
  const timeEl = document.getElementById('time');
  const playerEl = document.getElementById('player');

  playerEl.textContent = window.Arcade.getPlayerId();

  let session = null;
  try {
    session = await window.Arcade.startGame('whackamole');
  } catch (err) {
    grid.innerHTML = `<div style="color:#ff5d76;padding:14px">Failed to start: ${err.message}</div>`;
    return;
  }

  const cells = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'whack-cell';
    cell.innerHTML = '<div class="mole">🐹</div>';
    cell.dataset.index = i;
    cell.addEventListener('click', () => onClick(cell));
    grid.appendChild(cell);
    cells.push(cell);
  }

  let hits = 0;
  let misses = 0;
  let timeLeft = 30;
  let activeIndex = -1;
  let completed = false;

  function onClick(cell) {
    if (completed) return;
    const idx = parseInt(cell.dataset.index, 10);
    if (idx === activeIndex) {
      hits += 1;
      hitsEl.textContent = hits;
      cell.classList.add('hit');
      cell.classList.remove('up');
      activeIndex = -1;
      window.Arcade.sendEvent('whackamole', session.id, 'hit', { cell: idx }).catch(() => {});
      setTimeout(() => cell.classList.remove('hit'), 200);
    } else {
      misses += 1;
      missesEl.textContent = misses;
      window.Arcade.sendEvent('whackamole', session.id, 'miss', { cell: idx }).catch(() => {});
    }
  }

  const moleTimer = setInterval(() => {
    if (completed) return;
    if (activeIndex >= 0) {
      cells[activeIndex].classList.remove('up');
    }
    activeIndex = Math.floor(Math.random() * 9);
    cells[activeIndex].classList.add('up');
  }, 900);

  const tickTimer = setInterval(() => {
    timeLeft -= 1;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) finish();
  }, 1000);

  async function finish() {
    completed = true;
    clearInterval(moleTimer);
    clearInterval(tickTimer);
    if (activeIndex >= 0) cells[activeIndex].classList.remove('up');
    const accuracy = hits + misses > 0 ? hits / (hits + misses) : 0;
    const score = Math.max(0, hits * 10 - misses * 2);
    try {
      await window.Arcade.completeGame('whackamole', session.id, score);
    } catch (e) { /* ignore */ }
    window.Arcade.showGameOver({ title: 'Round Up! 🐹', stats: [{ label: 'Hits', value: hits }, { label: 'Accuracy', value: (accuracy * 100).toFixed(0) + '%' }], score });
  }
})();
