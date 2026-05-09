(async function () {
  const DURATION = 10, BURST_MS = 500;

  const tapBtn  = document.getElementById('tap-btn');
  const tapsEl  = document.getElementById('taps');
  const timeEl  = document.getElementById('time');
  const rateEl  = document.getElementById('rate');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  let session = null;
  try { session = await window.Arcade.startGame('speed-tap'); }
  catch (e) { tapBtn.textContent = e.message; return; }

  let totalTaps = 0, burstTaps = 0, timeLeft = DURATION, started = false, done = false;
  let tickTimer = null, burstTimer = null;

  async function sendBurst() {
    if (burstTaps === 0) return;
    const rate = burstTaps / (BURST_MS / 1000);
    await window.Arcade.sendEvent('speed-tap', session.id, 'tap_burst', {
      taps_in_window:  burstTaps,
      cumulative_taps: totalTaps,
      rate_per_sec:    Math.round(rate * 10) / 10,
      window_ms:       BURST_MS,
      time_remaining:  timeLeft,
    });
    rateEl.textContent = Math.round(rate) + ' taps/s';
    burstTaps = 0;
  }

  window.onTap = function () {
    if (done) return;
    if (!started) {
      started = true;
      tapBtn.textContent = 'TAP!';
      tickTimer  = setInterval(tick, 1000);
      burstTimer = setInterval(sendBurst, BURST_MS);
    }
    totalTaps++;
    burstTaps++;
    tapsEl.textContent = totalTaps;
  };

  function tick() {
    timeLeft--;
    timeEl.textContent = timeLeft;
    if (timeLeft <= 0) finish();
  }

  async function finish() {
    if (done) return;
    done = true;
    clearInterval(tickTimer);
    clearInterval(burstTimer);
    await sendBurst(); // flush last burst
    tapBtn.disabled = true;
    tapBtn.textContent = '—';
    const rate = totalTaps / DURATION;
    rateEl.textContent = 'Final: ' + rate.toFixed(1) + ' taps/s';
    try { await window.Arcade.completeGame('speed-tap', session.id, totalTaps); } catch (_) {}
    window.Arcade.showGameOver({ title: 'Tap Machine! 👆', stats: [{ label: 'Total Taps', value: totalTaps }, { label: 'Rate', value: rate.toFixed(1) + '/s' }], score: totalTaps });
  }
})();
