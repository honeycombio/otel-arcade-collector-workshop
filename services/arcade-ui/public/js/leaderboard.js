// Leaderboard widget logic. Include after nav.js and app.js on any page
// that contains #lb-body, #lb-age, and .lb-tab elements.
(function () {
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
      tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">No scores yet — play a game!</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (row, i) {
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td>' + (row.player_name || row.player_id) + '</td>'
        + '<td>' + row.game + '</td>'
        + '<td>' + row.score + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderEmpty(msg) {
    var tbody = document.getElementById('lb-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="lb-empty">' + msg + '</td></tr>';
  }

  document.querySelectorAll('.lb-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.lb-tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeGame = btn.dataset.game;
      clearInterval(timer);
      load();
      timer = setInterval(load, 15000);
    });
  });

  load();
  timer = setInterval(load, 15000);
})();
