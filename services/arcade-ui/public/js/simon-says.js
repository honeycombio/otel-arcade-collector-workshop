(async function () {
  const COLORS    = ['red', 'green', 'blue', 'yellow'];
  const START_LEN = 3, MAX_ROUNDS = 10;
  const FLASH_MS = 500, GAP_MS = 200;

  const roundEl  = document.getElementById('round');
  const seqEl    = document.getElementById('seq-len');
  const statusEl = document.getElementById('status');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const btns = {};
  COLORS.forEach(c => { btns[c] = document.querySelector('[data-color="' + c + '"]'); });

  let session = null;
  try { session = await window.Arcade.startGame('simon-says'); }
  catch (e) { statusEl.textContent = e.message; return; }

  let sequence = [], playerPos = 0, round = 0, playerTurn = false, done = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function flash(color, ms) {
    btns[color].classList.add('flash');
    return sleep(ms).then(() => btns[color].classList.remove('flash'));
  }

  async function playSequence() {
    playerTurn = false;
    Object.values(btns).forEach(b => b.classList.remove('active-player'));
    statusEl.textContent = 'Watch…';
    await sleep(600);
    for (var i = 0; i < sequence.length; i++) {
      await flash(sequence[i], FLASH_MS);
      await sleep(GAP_MS);
    }
    statusEl.textContent = 'Your turn!';
    playerTurn = true;
    playerPos = 0;
    Object.values(btns).forEach(b => b.classList.add('active-player'));

    // Server event for the sequence shown
    window.Arcade.sendEvent('simon-says', session.id, 'sequence_shown', {
      sequence_length: sequence.length,
      sequence_colors: sequence.join(','),  // DELIBERATE: full sequence as attribute value
      round: round,
    }).catch(() => {});
  }

  async function nextRound() {
    round++;
    const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    if (sequence.length < START_LEN + round - 1) {
      // build up to start length first
      while (sequence.length < START_LEN) sequence.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
    } else {
      sequence.push(newColor);
    }
    roundEl.textContent = round;
    seqEl.textContent = sequence.length;
    await playSequence();
  }

  window.playerPress = async function (color) {
    if (!playerTurn || done) return;
    await flash(color, 150);
    const expected = sequence[playerPos];
    const correct  = color === expected;

    window.Arcade.sendEvent('simon-says', session.id, 'player_input', {
      color_pressed:   color,
      color_expected:  expected,
      sequence_pos:    playerPos,
      correct:         correct,
      round:           round,
    }).catch(() => {});

    if (!correct) {
      playerTurn = false;
      statusEl.textContent = '✗ Wrong! Expected: ' + expected;
      Object.values(btns).forEach(b => b.classList.remove('active-player'));
      await finish(false);
      return;
    }

    playerPos++;
    if (playerPos >= sequence.length) {
      // Completed the round
      playerTurn = false;
      Object.values(btns).forEach(b => b.classList.remove('active-player'));
      if (round >= MAX_ROUNDS) {
        await finish(true);
      } else {
        statusEl.textContent = '✓ Round ' + round + ' complete!';
        await sleep(800);
        await nextRound();
      }
    }
  };

  async function finish(won) {
    done = true;
    const score = (round - 1) * 100 + playerPos * 10;
    statusEl.textContent = won ? '🎉 You won!' : '✗ Game over — reached round ' + round;
    try { await window.Arcade.completeGame('simon-says', session.id, score); } catch (_) {}
    window.Arcade.showGameOver({ title: won ? 'Perfect! 🎉' : 'Game Over', stats: [{ label: 'Round Reached', value: round }], score });
  }

  await nextRound();
})();
