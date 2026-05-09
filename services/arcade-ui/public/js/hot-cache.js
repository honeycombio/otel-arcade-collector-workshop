(async function () {
  const quizEl   = document.getElementById('quiz-area');
  const qNumEl   = document.getElementById('q-num');
  const correctEl = document.getElementById('correct');
  const scoreEl  = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try {
    session = await window.Arcade.startGame('hot-cache');
  } catch (err) {
    quizEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  // OTel-themed questions — the answers reinforce workshop concepts.
  // Odd-indexed questions (0, 2, 4, 6) are presented as "cold" (❄️ cache miss).
  // Even-indexed questions (1, 3, 5, 7) are presented as "hot" (🔥 cache hit).
  // The server honours this split: question IDs starting with "hot_" are pre-warmed.
  const QUESTIONS = [
    {
      id:      'cold_ottl',
      text:    'What does OTTL stand for?',
      options: ['OpenTelemetry Transformation Language', 'OTel Telemetry Layer', 'OpenTelemetry Trace Link', 'OTel Task Language'],
      correct: 0,
    },
    {
      id:      'hot_grpc_port',
      text:    'What is the standard OTLP/gRPC port?',
      options: ['4318', '4317', '8888', '9411'],
      correct: 1,
    },
    {
      id:      'cold_filter',
      text:    'Which Collector processor drops specific spans?',
      options: ['batch', 'memory_limiter', 'transform', 'filter'],
      correct: 3,
    },
    {
      id:      'hot_service',
      text:    'Which config section wires receivers → processors → exporters?',
      options: ['receivers', 'processors', 'service.pipelines', 'exporters'],
      correct: 2,
    },
    {
      id:      'cold_context',
      text:    'Which OTTL context modifies individual span attributes?',
      options: ['resource', 'scope', 'datapoint', 'span'],
      correct: 3,
    },
    {
      id:      'hot_batch',
      text:    'The batch processor primarily improves what?',
      options: ['Security', 'Export throughput', 'Span naming', 'Memory usage'],
      correct: 1,
    },
    {
      id:      'cold_replace',
      text:    'Which OTTL function replaces a span name by regex pattern?',
      options: ['set()', 'delete_key()', 'replace_pattern()', 'truncate_all()'],
      correct: 2,
    },
    {
      id:      'hot_memory',
      text:    'What does memory_limiter protect against?',
      options: ['High cardinality', 'OOM crashes', 'Duplicate spans', 'Slow exporters'],
      correct: 1,
    },
  ];

  const pips = Array(QUESTIONS.length).fill('');
  let totalCorrect = 0;
  let totalScore   = 0;

  function renderPips(currentIndex) {
    return '<div class="cache-progress">' +
      pips.map((state, i) =>
        '<div class="cache-pip ' +
          (i < currentIndex ? state : i === currentIndex ? 'current' : '') +
        '"></div>'
      ).join('') +
    '</div>';
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  for (let qi = 0; qi < QUESTIONS.length; qi++) {
    const q    = QUESTIONS[qi];
    const isHot = q.id.startsWith('hot_');
    qNumEl.textContent = qi + 1;

    quizEl.innerHTML =
      renderPips(qi) +
      '<div class="cache-badge ' + (isHot ? 'hot' : 'cold') + '">' +
        (isHot ? '🔥 Hot — cached result' : '❄️ Cold — cache miss') +
      '</div>' +
      '<div class="cache-question">' + q.text + '</div>' +
      '<div class="cache-options">' +
        q.options.map((opt, i) =>
          '<button class="cache-option" data-idx="' + i + '">' + opt + '</button>'
        ).join('') +
      '</div>' +
      '<div class="cache-feedback" id="feedback"></div>';

    const buttons  = Array.from(quizEl.querySelectorAll('.cache-option'));
    const feedback = document.getElementById('feedback');

    const startMs = Date.now();

    await new Promise(resolve => {
      buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
          const chosen    = parseInt(btn.dataset.idx, 10);
          const isCorrect = chosen === q.correct;
          const responseMs = Date.now() - startMs;

          // Disable all buttons immediately
          buttons.forEach(b => b.disabled = true);
          btn.classList.add(isCorrect ? 'correct' : 'wrong');
          if (!isCorrect) buttons[q.correct].classList.add('correct');

          feedback.className = 'cache-feedback ' + (isCorrect ? 'ok' : 'bad');
          feedback.textContent = isCorrect
            ? (isHot ? '✓ Correct — answered from cache' : '✓ Correct — answer looked up and cached')
            : '✗ Incorrect — ' + q.options[q.correct];

          pips[qi] = isCorrect ? 'done' : 'wrong';
          if (isCorrect) {
            totalCorrect++;
            const speedBonus = Math.max(0, Math.round((5000 - responseMs) / 100));
            totalScore += 100 + speedBonus + (isHot ? 0 : 20); // bonus for cold (harder)
          }
          correctEl.textContent = totalCorrect;
          scoreEl.textContent   = totalScore;

          // Send to the hot-cache answer endpoint (creates the branching span)
          fetch('/api/games/hot-cache/answer', {
            method:  'POST',
            headers: {
              'content-type': 'application/json',
              'x-player-id':   window.Arcade.getPlayerId(),
              'x-player-name': window.Arcade.getPlayerName(),
            },
            body: JSON.stringify({
              session_id:  session.id,
              question_id: q.id,
              is_correct:  isCorrect,
              response_ms: responseMs,
            }),
          }).catch(() => {});

          await delay(1600);
          resolve();
        });
      });
    });
  }

  // Final pip render
  quizEl.innerHTML = renderPips(QUESTIONS.length) +
    '<div style="font-size:18px;color:var(--accent2);margin-top:20px">Quiz complete!</div>';

  try {
    await window.Arcade.completeGame('hot-cache', session.id, totalScore);
  } catch (_) {}

  window.Arcade.showGameOver({ title: 'Cache Cleared! 🔥', stats: [{ label: 'Correct', value: totalCorrect + ' / 8' }], score: totalScore });
})();
