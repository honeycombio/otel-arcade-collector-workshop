(async function () {
  const subStatusEl = document.getElementById('sub-status');
  const eventsEl    = document.getElementById('events-area');
  const eventNumEl  = document.getElementById('event-num');
  const scoreEl     = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('pulse');
  } catch (err) {
    eventsEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  const SUBSCRIBERS = [
    { name: 'metrics', icon: '📊', label: 'Metrics' },
    { name: 'audit',   icon: '📋', label: 'Audit'   },
    { name: 'notify',  icon: '🔔', label: 'Notify'  },
    { name: 'cache',   icon: '⚡', label: 'Cache'   },
  ];

  // 8 events total: 2 of each type
  const EVENT_TYPES = [
    { type: 'config_change', emoji: '⚙️',  label: 'Config Change' },
    { type: 'score_update',  emoji: '🏆', label: 'Score Update'  },
    { type: 'player_join',   emoji: '👤', label: 'Player Join'   },
    { type: 'game_end',      emoji: '🎮', label: 'Game End'      },
  ];

  // Shuffle: 2 of each, randomised order
  const eventQueue = [...EVENT_TYPES, ...EVENT_TYPES]
    .sort(() => Math.random() - 0.5);

  let totalScore = 0, eventsPublished = 0;
  let busy = false;

  function renderSubStatus(states) {
    // states: { name: 'idle'|'processing'|'ok'|'failed' }
    subStatusEl.innerHTML = SUBSCRIBERS.map(s => {
      const state = (states && states[s.name]) || 'idle';
      return '<div class="pulse-sub-card ' + state + '">' +
        '<span class="pulse-sub-icon">' + s.icon + '</span>' +
        '<span class="pulse-sub-label">' + s.label + '</span>' +
        '<span class="pulse-sub-state">' + state + '</span>' +
        '</div>';
    }).join('');
  }

  function renderEvents() {
    eventsEl.innerHTML = eventQueue.map((ev, i) => {
      const consumed = i < eventsPublished;
      const current  = i === eventsPublished && !busy;
      return '<div class="pulse-event' + (consumed ? ' consumed' : '') + (current ? ' ready' : '') + '" data-idx="' + i + '">' +
        '<span class="pulse-event-icon">' + ev.emoji + '</span>' +
        '<span class="pulse-event-label">' + ev.label + '</span>' +
      '</div>';
    }).join('');
  }

  const subStates = {};
  SUBSCRIBERS.forEach(s => { subStates[s.name] = 'idle'; });
  renderSubStatus(subStates);
  renderEvents();

  eventsEl.addEventListener('click', async (e) => {
    if (busy) return;
    const card = e.target.closest('[data-idx]');
    if (!card) return;
    const idx = parseInt(card.dataset.idx, 10);
    if (idx !== eventsPublished) return; // must click current event

    busy = true;
    const ev = eventQueue[idx];
    const eventId = 'evt_' + Date.now() + '_' + idx;

    // Set all subs to processing
    SUBSCRIBERS.forEach(s => { subStates[s.name] = 'processing'; });
    renderSubStatus(subStates);

    let results = [];
    try {
      const resp = await fetch('/api/games/pulse/publish', {
        method:  'POST',
        headers: {
          'content-type':  'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({ session_id: session.id, event_id: eventId, event_type: ev.type }),
      });
      const data = await resp.json();
      results = data.results || [];
    } catch (_) {
      results = SUBSCRIBERS.map(s => ({ name: s.name, ok: false }));
    }

    // Update subscriber states and score
    let roundScore = 0;
    results.forEach(r => {
      subStates[r.name] = r.ok ? 'ok' : 'failed';
      roundScore += r.ok ? 10 : -5;
    });
    totalScore += Math.max(0, roundScore);
    eventsPublished++;
    eventNumEl.textContent = eventsPublished;
    scoreEl.textContent    = totalScore;

    renderSubStatus(subStates);
    renderEvents();

    // Brief pause so player can see the result, then reset subs to idle
    await new Promise(r => setTimeout(r, 1200));
    SUBSCRIBERS.forEach(s => { subStates[s.name] = 'idle'; });
    renderSubStatus(subStates);

    busy = false;

    if (eventsPublished >= eventQueue.length) {
      endGame();
    } else {
      renderEvents();
    }
  });

  async function endGame() {
    eventsEl.innerHTML = '<div style="font-size:15px;color:var(--accent2);padding:14px">All events published!</div>';
    try {
      await window.Arcade.completeGame('pulse', session.id, totalScore, difficulty);
    } catch (_) {}
    window.Arcade.showGameOver({
      title: 'Signal Complete! 📡',
      stats: [{ label: 'Events published', value: eventsPublished }],
      score: totalScore,
    });
  }
})();
