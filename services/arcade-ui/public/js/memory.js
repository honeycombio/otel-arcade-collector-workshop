(async function () {
  const SYMBOLS = ['🎯', '🚀', '⭐', '🎲', '🍕', '🐙', '🌵', '🎷'];
  const PAIRS = [...SYMBOLS, ...SYMBOLS].sort(() => Math.random() - 0.5);

  const grid = document.getElementById('grid');
  const flipsEl = document.getElementById('flips');
  const matchesEl = document.getElementById('matches');
  const playerEl = document.getElementById('player');

  playerEl.textContent = window.Arcade.getPlayerId();

  let session = null;
  try {
    session = await window.Arcade.startGame('memory');
  } catch (err) {
    grid.innerHTML = `<div style="color:#ff5d76;padding:14px">Failed to start: ${err.message}</div>`;
    return;
  }

  const cells = PAIRS.map((sym, i) => {
    const el = document.createElement('div');
    el.className = 'memory-cell';
    el.dataset.symbol = sym;
    el.dataset.index = i;
    el.textContent = '?';
    el.addEventListener('click', () => onFlip(el));
    grid.appendChild(el);
    return el;
  });

  let flipped = [];
  let matched = 0;
  let flips = 0;
  let lock = false;
  let completed = false;

  function onFlip(el) {
    if (lock || completed) return;
    if (el.classList.contains('flipped') || el.classList.contains('matched')) return;
    el.textContent = el.dataset.symbol;
    el.classList.add('flipped');
    flipped.push(el);
    flips += 1;
    flipsEl.textContent = flips;

    window.Arcade.sendEvent('memory', session.id, 'flip', {
      index: parseInt(el.dataset.index, 10),
      symbol: el.dataset.symbol,
      flips,
    }).catch(() => {});

    if (flipped.length === 2) {
      lock = true;
      const [a, b] = flipped;
      if (a.dataset.symbol === b.dataset.symbol) {
        a.classList.add('matched');
        b.classList.add('matched');
        matched += 1;
        matchesEl.textContent = matched;
        flipped = [];
        lock = false;
        if (matched === SYMBOLS.length) finish();
      } else {
        setTimeout(() => {
          a.classList.remove('flipped');
          b.classList.remove('flipped');
          a.textContent = '?';
          b.textContent = '?';
          flipped = [];
          lock = false;
        }, 700);
      }
    }
  }

  async function finish() {
    completed = true;
    const score = Math.max(10, 200 - flips * 5);
    try {
      await window.Arcade.completeGame('memory', session.id, score);
    } catch (e) { /* ignore */ }
    window.Arcade.showGameOver({ title: 'All Matched! 🧠', stats: [{ label: 'Flips', value: flips }], score });
  }
})();
