(async function () {
  const QUESTIONS = 10, TIME_LIMIT = 60;

  const eqEl       = document.getElementById('equation');
  const answerEl   = document.getElementById('answer');
  const progressEl = document.getElementById('progress');
  const qNumEl     = document.getElementById('q-num');
  const scoreEl    = document.getElementById('score');
  const timeEl     = document.getElementById('time');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try { session = await window.Arcade.startGame('math-sprint'); }
  catch (e) { eqEl.textContent = e.message; return; }

  let qIdx = 0, score = 0, timeLeft = TIME_LIMIT, current = null, done = false;
  let tick = setInterval(() => {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) finish();
  }, 1000);

  // Render 10 progress dots
  for (var i = 0; i < QUESTIONS; i++) {
    var d = document.createElement('span');
    d.className = 'math-dot';
    progressEl.appendChild(d);
  }

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function generateQuestion() {
    var ops = ['+', '-', '×'];
    var op = ops[Math.floor(Math.random() * ops.length)];
    var a, b, answer;
    if (op === '+') { a = randInt(2, 50); b = randInt(2, 50); answer = a + b; }
    else if (op === '-') { a = randInt(10, 60); b = randInt(2, a); answer = a - b; }
    else { a = randInt(2, 12); b = randInt(2, 12); answer = a * b; }
    // DELIBERATE smell: equation string as span name (mirrors raw SQL smell)
    var text = a + ' ' + op + ' ' + b + ' = ?';
    return { text, answer, a, b, op };
  }

  function nextQuestion() {
    if (qIdx >= QUESTIONS || done) return finish();
    current = generateQuestion();
    eqEl.textContent = current.text;
    qNumEl.textContent = qIdx + 1;
    answerEl.value = '';
    answerEl.focus();
  }

  answerEl.addEventListener('keydown', async function (e) {
    if (e.key !== 'Enter') return;
    if (!current || done) return;
    var given = parseInt(answerEl.value.trim(), 10);
    var correct = given === current.answer;

    // DELIBERATE: span name = equation string — raw data as span name
    await window.Arcade.sendEvent('math-sprint', session.id, current.text, {
      answer_given:   given,
      answer_correct: current.answer,
      is_correct:     correct,
      operand_a:      current.a,
      operand_b:      current.b,
      operation:      current.op,
      question_index: qIdx,
    });

    var dots = progressEl.querySelectorAll('.math-dot');
    if (dots[qIdx]) dots[qIdx].classList.add(correct ? 'ok' : 'bad');

    if (correct) score += 10;
    scoreEl.textContent = score;
    qIdx++;
    if (qIdx >= QUESTIONS) finish();
    else nextQuestion();
  });

  async function finish() {
    if (done) return;
    done = true;
    clearInterval(tick);
    eqEl.textContent = '—';
    answerEl.disabled = true;
    try { await window.Arcade.completeGame('math-sprint', session.id, score); } catch (_) {}
    window.Arcade.showGameOver({ title: 'Time\'s Up! 🔢', stats: [{ label: 'Correct', value: score / 10 + ' / ' + QUESTIONS }], score });
  }

  nextQuestion();
})();
