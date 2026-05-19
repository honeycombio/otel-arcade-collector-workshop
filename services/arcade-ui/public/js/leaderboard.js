// Leaderboard widget logic. Include after nav.js and app.js on any page
// that contains #lb-body, #lb-age, and .lb-tab elements.
(function () {
  var GAME_NAMES = {
    'memory': 'Memory Match', 'typing': 'Typing Speed', 'whackamole': 'Whack-a-Mole',
    'reaction': 'Reaction Timer', 'target-shooter': 'Target Shooter',
    'word-scramble': 'Word Scramble', 'math-sprint': 'Math Sprint',
    'simon-says': 'Simon Says', 'speed-tap': 'Speed Tap',
    'wave-defender': 'Wave Defender', 'bid-wars': 'Bid Wars',
    'hot-cache': 'Hot Cache', 'pixel-sort': 'Pixel Sort',
    'chain-reaction': 'Chain Reaction', 'deadline-dash': 'Deadline Dash',
    'power-surge': 'Power Surge', 'vault-sync': 'Vault Sync',
    'laser-grid': 'Laser Grid', 'pulse': 'Pulse',
  };

  var limit = window.LB_LIMIT || 10;
  var activeGame = '';
  var timer;

  async function load() {
    var qs = '?limit=' + limit + (activeGame ? '&game=' + activeGame : '');
    try {
      var r = await fetch('/api/leaderboard' + qs, {
        headers: { 'x-player-id': window.Arcade ? window.Arcade.getPlayerId() : 'lobby' },
      });
      var rows = await r.json();
      render(Array.isArray(rows) ? rows : []);
      var age = document.getElementById('lb-age');
      if (age) age.textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (_) {
      renderEmpty('leaderboard unavailable');
    }
  }

  function render(rows) {
    var tbody = document.getElementById('lb-body');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">No scores yet — play a game!</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (row, i) {
      var diff = row.difficulty || 'medium';
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td>' + (row.player_name || row.player_id) + '</td>'
        + '<td>' + (GAME_NAMES[row.game] || row.game) + '</td>'
        + '<td>' + row.score + '</td>'
        + '<td><span class="diff-badge diff-badge--' + diff + '">' + diff + '</span></td>'
        + '</tr>';
    }).join('');
  }

  function renderEmpty(msg) {
    var tbody = document.getElementById('lb-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="lb-empty">' + msg + '</td></tr>';
  }

  var sel = document.getElementById('lb-game');
  if (sel) {
    sel.addEventListener('change', function () {
      activeGame = sel.value;
      clearInterval(timer);
      load();
      timer = setInterval(load, 15000);
    });
  }

  load();
  timer = setInterval(load, 15000);
  window.addEventListener('beforeunload', function () { clearInterval(timer); });
})();
