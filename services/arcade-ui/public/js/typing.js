(async function () {
  const PASSAGES = [
    'OpenTelemetry is an observability framework. It provides APIs, libraries, agents, and instrumentation to enable observability in modern software.',
    'A trace tells the story of a request as it flows through a distributed system. Each operation is captured as a span with attributes and timing.',
    'Pipelines transform telemetry. Receivers ingest, processors mutate, exporters ship the data to a backend. The Collector is the swiss army knife.',
  ];
  const PASSAGE = PASSAGES[Math.floor(Math.random() * PASSAGES.length)];

  const passageEl = document.getElementById('passage');
  const inputEl = document.getElementById('input');
  const wpmEl = document.getElementById('wpm');
  const errorsEl = document.getElementById('errors');
  const playerEl = document.getElementById('player');

  playerEl.textContent = window.Arcade.getPlayerId();
  render('');

  let session = null;
  try {
    session = await window.Arcade.startGame('typing');
  } catch (err) {
    passageEl.innerHTML = `<span class="bad">Failed to start: ${err.message}</span>`;
    return;
  }

  let started = null;
  let errors = 0;
  let lastSent = 0;
  let completed = false;

  inputEl.addEventListener('input', () => {
    if (completed) return;
    if (!started) started = performance.now();
    const typed = inputEl.value;
    render(typed);

    const elapsedMin = (performance.now() - started) / 60000;
    const wpm = Math.round((typed.length / 5) / Math.max(elapsedMin, 0.001));
    wpmEl.textContent = isFinite(wpm) ? wpm : 0;

    errors = countErrors(typed);
    errorsEl.textContent = errors;

    // Throttle event sends to once every 8 chars typed.
    if (typed.length - lastSent >= 8) {
      lastSent = typed.length;
      window.Arcade.sendEvent('typing', session.id, 'progress', {
        chars: typed.length,
        wpm,
        errors,
      }).catch(() => {});
    }

    if (typed.length >= PASSAGE.length) finish(wpm);
  });

  function render(typed) {
    let html = '';
    for (let i = 0; i < PASSAGE.length; i++) {
      const ch = PASSAGE[i];
      if (i < typed.length) {
        html += `<span class="${typed[i] === ch ? 'ok' : 'bad'}">${escapeHtml(ch)}</span>`;
      } else if (i === typed.length) {
        html += `<span class="caret">${escapeHtml(ch)}</span>`;
      } else {
        html += `<span class="pend">${escapeHtml(ch)}</span>`;
      }
    }
    passageEl.innerHTML = html;
  }

  function countErrors(typed) {
    let n = 0;
    for (let i = 0; i < typed.length && i < PASSAGE.length; i++) {
      if (typed[i] !== PASSAGE[i]) n += 1;
    }
    return n;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  async function finish(wpm) {
    completed = true;
    inputEl.disabled = true;
    const score = Math.max(0, wpm * 10 - errors * 5);
    try {
      await window.Arcade.completeGame('typing', session.id, score);
    } catch (e) { /* ignore */ }
    window.Arcade.showGameOver({ title: 'Speed Typist! ⌨️', stats: [{ label: 'WPM', value: wpm }, { label: 'Errors', value: errors }], score });
  }
})();
