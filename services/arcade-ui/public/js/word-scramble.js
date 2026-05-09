(async function () {
  const WORDS = [
    'PIPELINE', 'RECEIVER', 'EXPORTER', 'PROCESSOR',
    'METRIC',   'TRACING',  'SAMPLER',  'BAGGAGE',
  ];
  const MAX_ATTEMPTS = 3;

  const scrambledEl = document.getElementById('scrambled');
  const guessEl     = document.getElementById('guess');
  const feedbackEl  = document.getElementById('feedback');
  const dotsEl      = document.getElementById('dots');
  const wordNumEl   = document.getElementById('word-num');
  const scoreEl     = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try { session = await window.Arcade.startGame('word-scramble'); }
  catch (e) { scrambledEl.textContent = e.message; return; }

  let wordIdx = 0, totalScore = 0, attempts = 0;

  function scramble(word) {
    var a = word.split('');
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    // If the scramble happens to equal the original word, scramble again
    return a.join('') === word ? scramble(word) : a.join('');
  }

  function renderDots() {
    dotsEl.innerHTML = '';
    for (var i = 0; i < MAX_ATTEMPTS; i++) {
      var d = document.createElement('span');
      d.className = 'attempt-dot';
      dotsEl.appendChild(d);
    }
  }

  function markDot(idx, state) {
    var dots = dotsEl.querySelectorAll('.attempt-dot');
    if (dots[idx]) dots[idx].classList.add(state);
  }

  function nextWord() {
    if (wordIdx >= WORDS.length) return finish();
    attempts = 0;
    guessEl.value = '';
    feedbackEl.textContent = '';
    feedbackEl.className = 'scramble-feedback';
    wordNumEl.textContent = wordIdx + 1;
    scrambledEl.textContent = scramble(WORDS[wordIdx]);
    renderDots();
    guessEl.focus();
  }

  window.submitGuess = async function () {
    var guess = guessEl.value.trim().toUpperCase();
    if (!guess) return;
    var word = WORDS[wordIdx];
    var correct = guess === word;
    attempts++;
    markDot(attempts - 1, correct ? 'ok' : 'used');

    // DELIBERATE: word.scrambled reveals the answer in the attribute — good PII exercise
    await window.Arcade.sendEvent('word-scramble', session.id, 'guess', {
      word_scrambled: scrambledEl.textContent,
      word_answer:    word,                    // DELIBERATE: exposes the answer
      word_guess:     guess,
      attempt_number: attempts,
      correct:        correct,
    });

    if (correct) {
      feedbackEl.textContent = '✓ Correct!';
      feedbackEl.className = 'scramble-feedback ok';
      totalScore += Math.max(10, 30 - (attempts - 1) * 10);
      scoreEl.textContent = totalScore;
      wordIdx++;
      setTimeout(nextWord, 800);
    } else if (attempts >= MAX_ATTEMPTS) {
      feedbackEl.textContent = '✗ The word was: ' + word;
      feedbackEl.className = 'scramble-feedback bad';
      wordIdx++;
      setTimeout(nextWord, 1200);
    } else {
      feedbackEl.textContent = '✗ Try again (' + (MAX_ATTEMPTS - attempts) + ' left)';
      feedbackEl.className = 'scramble-feedback bad';
      guessEl.value = '';
      guessEl.focus();
    }
  };

  guessEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') window.submitGuess();
  });

  async function finish() {
    scrambledEl.textContent = '🎉';
    feedbackEl.textContent = 'All done!';
    try { await window.Arcade.completeGame('word-scramble', session.id, totalScore); } catch (_) {}
    window.Arcade.showGameOver({ title: 'Unscrambled! 🔤', score: totalScore });
  }

  nextWord();
})();
