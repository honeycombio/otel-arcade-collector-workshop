(async function () {
  const tilesEl  = document.getElementById('tiles');
  const statusEl = document.getElementById('status');
  const scoreEl  = document.getElementById('score');
  const timerEl  = document.getElementById('timer');
  const chainsEl = document.getElementById('chains');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('chain-reaction');
  } catch (err) {
    statusEl.textContent = 'Failed to start: ' + err.message;
    return;
  }

  const STEP_NAMES = ['DEPLOY', 'MIGRATE', 'ROUTE', 'SCALE', 'VERIFY', 'COMMIT'];
  // Easy: 60s, Medium: 45s, Hard: 30s
  const GAME_DURATION_MS = difficulty === 'easy' ? 60000 : difficulty === 'hard' ? 30000 : 45000;

  let totalScore   = 0;
  let totalChains  = 0;
  let gameOver     = false;
  let nextExpected = 0;
  let completed    = [];      // indices of completed steps this chain
  let shuffledOrder = [];     // shuffledOrder[displayPosition] = stepIndex
  let processingChain = false;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function shuffle() {
    shuffledOrder = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
  }

  function renderTiles(highlightDone, flashWrong, compensating) {
    tilesEl.innerHTML = '';
    shuffledOrder.forEach((stepIdx) => {
      const div = document.createElement('div');
      const isDone          = completed.includes(stepIdx);
      const isNext          = stepIdx === nextExpected && !isDone;
      const isCompensating  = (compensating || []).includes(stepIdx);

      let cls = 'chain-tile';
      if (isDone)         cls += ' done';
      else if (isCompensating) cls += ' compensating';
      else if (flashWrong === stepIdx) cls += ' wrong-flash';
      else if (isNext)    cls += ' next';

      div.className = cls;
      div.dataset.step = stepIdx;
      div.innerHTML =
        '<span class="chain-step-num">step ' + (stepIdx + 1) + '</span>' +
        '<span class="chain-step-name">' + STEP_NAMES[stepIdx] + '</span>';
      tilesEl.appendChild(div);
    });
  }

  async function fireChain(stepsCompleted, failedAt) {
    processingChain = true;
    try {
      await fetch('/api/games/chain-reaction/execute', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id: session.id,
          steps:      STEP_NAMES,
          failed_at:  failedAt !== undefined ? failedAt : null,
        }),
      });
    } catch (_) {}
    processingChain = false;
  }

  async function runCompensation(completedSteps) {
    const toCompensate = completedSteps.slice().reverse();
    for (const stepIdx of toCompensate) {
      renderTiles(false, undefined, toCompensate.slice(toCompensate.indexOf(stepIdx)));
      await delay(160);
    }
    renderTiles(false, undefined, []);
    await delay(300);
  }

  function startNewChain() {
    nextExpected = 0;
    completed    = [];
    shuffle();
    renderTiles(false, undefined, []);
  }

  // Game timer
  const gameStart = Date.now();
  const timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((GAME_DURATION_MS - (Date.now() - gameStart)) / 1000));
    timerEl.textContent = remaining;
    if (remaining === 0 && !gameOver) {
      gameOver = true;
      clearInterval(timerInterval);
    }
  }, 250);

  startNewChain();
  statusEl.textContent = 'Click tiles in order: Step 1 → Step 6';

  // Tile click handler
  tilesEl.addEventListener('click', async (e) => {
    if (gameOver || processingChain) return;
    const tileEl = e.target.closest('.chain-tile');
    if (!tileEl) return;

    const stepIdx = parseInt(tileEl.dataset.step, 10);
    if (completed.includes(stepIdx)) return;

    if (stepIdx === nextExpected) {
      // Correct step
      completed.push(stepIdx);
      nextExpected++;
      renderTiles(false, undefined, []);

      if (nextExpected === STEP_NAMES.length) {
        // Chain complete!
        statusEl.className  = 'chain-status ok';
        statusEl.textContent = 'Chain complete! +200 pts';
        totalChains++;
        totalScore += 200;
        chainsEl.textContent = totalChains;
        scoreEl.textContent  = totalScore;

        fireChain(completed, undefined); // fire without await — don't block next chain
        await delay(600);
        startNewChain();
        statusEl.className  = 'chain-status';
        statusEl.textContent = 'Click tiles in order: Step 1 → Step 6';
      }
    } else {
      // Wrong step — saga fails, compensate
      totalScore = Math.max(0, totalScore - 20);
      scoreEl.textContent  = totalScore;
      statusEl.className   = 'chain-status error';
      statusEl.textContent = 'Wrong step! Rolling back…';

      renderTiles(false, stepIdx, []);
      await delay(300);

      const failedAt = stepIdx;
      const stepsCompleted = completed.slice();
      await runCompensation(stepsCompleted);

      fireChain(stepsCompleted, failedAt); // fire saga with failed_at

      startNewChain();
      statusEl.className  = 'chain-status';
      statusEl.textContent = 'Chain reset. Try again!';
    }
  });

  // Wait for game end
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (gameOver) { clearInterval(check); resolve(); }
    }, 250);
  });

  clearInterval(timerInterval);
  tilesEl.innerHTML = '';
  statusEl.textContent = 'Time\'s up!';

  try {
    await window.Arcade.completeGame('chain-reaction', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({
    title: 'Chain Reacted! ⚡',
    stats: [{ label: 'Chains', value: totalChains }],
    score: totalScore,
  });
})();
