// Shared client helpers for all three games.
// All telemetry actually originates server-side; the client just talks to /api/games/*.

(function () {
  function shortId() {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function getPlayerId() {
    let id = sessionStorage.getItem('arcade.player_id');
    if (!id) {
      id = `u_${shortId()}`;
      sessionStorage.setItem('arcade.player_id', id);
    }
    return id;
  }

  function getPlayerName() {
    return localStorage.getItem('arcade.player_name') || '';
  }

  function getPlayerAvatar() {
    return localStorage.getItem('arcade.player_avatar') || '';
  }

  function setPlayerName(name) {
    if (name && name.trim()) localStorage.setItem('arcade.player_name', name.trim());
  }

  async function api(method, url, body) {
    const opts = {
      method,
      headers: {
        'content-type': 'application/json',
        'x-player-id': getPlayerId(),
        'x-player-name': getPlayerName(),
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${method} ${url} → ${r.status}: ${t.slice(0, 200)}`);
    }
    return r.json();
  }

  // ── Game-over celebration overlay ─────────────────────────────
  // options: { title?: string, stats: [{label, value}], score: number }
  function showGameOver(options) {
    var title  = options.title  || 'Game Over';
    var stats  = options.stats  || [];
    var score  = options.score  != null ? options.score : null;

    // Confetti
    var COLORS = ['#5dffea','#ff5dcd','#ffd95d','#6dd17a','#ff5d76','#a78bfa'];
    for (var i = 0; i < 28; i++) {
      var piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left     = (Math.random() * 100) + 'vw';
      piece.style.background = COLORS[i % COLORS.length];
      piece.style.animationDuration  = (1.8 + Math.random() * 1.6) + 's';
      piece.style.animationDelay     = (Math.random() * 0.7) + 's';
      piece.style.width  = (7 + Math.random() * 6) + 'px';
      piece.style.height = (7 + Math.random() * 6) + 'px';
      document.body.appendChild(piece);
      piece.addEventListener('animationend', function () { this.remove(); });
    }

    // Build stat rows (score always last, styled differently)
    var statRows = stats.map(function (s) {
      return '<div class="game-over-stat">'
        + '<span class="game-over-stat-label">' + s.label + '</span>'
        + '<span class="game-over-stat-value">'  + s.value  + '</span>'
        + '</div>';
    }).join('');

    if (score != null) {
      statRows += '<div class="game-over-stat is-score">'
        + '<span class="game-over-stat-label">Score</span>'
        + '<span class="game-over-stat-value">' + score + '</span>'
        + '</div>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML =
      '<div class="game-over-card">'
      + '<div class="game-over-title">' + title + '</div>'
      + '<div class="game-over-stats">' + statRows + '</div>'
      + '<div class="game-over-actions">'
      + '<button class="game-over-btn primary"  onclick="location.reload()">Play Again</button>'
      + '<button class="game-over-btn secondary" onclick="location.href=\'/\'">Lobby</button>'
      + '</div></div>';

    document.body.appendChild(overlay);
  }

  window.Arcade = {
    getPlayerId,
    getPlayerName,
    getPlayerAvatar,
    setPlayerName,
    showGameOver,
    startGame(game) {
      return api('POST', `/api/games/${game}/start`, {});
    },
    sendEvent(game, sessionId, type, data) {
      return api('POST', `/api/games/${game}/events`, {
        session_id: sessionId,
        type,
        data: data || {},
      });
    },
    completeGame(game, sessionId, clientScore) {
      return api('POST', `/api/games/${game}/complete`, {
        session_id: sessionId,
        client_score: clientScore,
      });
    },
  };
})();
