(async function () {
  const orderAreaEl  = document.getElementById('order-area');
  const orderNumEl   = document.getElementById('order-num');
  const fulfilledEl  = document.getElementById('fulfilled');
  const scoreEl      = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('deadline-dash');
  } catch (err) {
    orderAreaEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  // Deadline multiplier: Easy 2.5×, Medium 1×, Hard 0.55×
  const deadlineMult = difficulty === 'easy' ? 2.5 : difficulty === 'hard' ? 0.55 : 1.0;

  const BASE_ORDERS = [
    { id: 'ord_1', name: 'Server Rack',    emoji: '🖥️',  deadlineMs: 2200, reward: 120 },
    { id: 'ord_2', name: 'SSD Batch',      emoji: '💾',  deadlineMs: 900,  reward: 380 },
    { id: 'ord_3', name: 'Network Switch', emoji: '🔀',  deadlineMs: 3000, reward: 80  },
    { id: 'ord_4', name: 'GPU Cluster',    emoji: '⚡',  deadlineMs: 1400, reward: 220 },
    { id: 'ord_5', name: 'Flash Array',    emoji: '💡',  deadlineMs: 700,  reward: 500 },
  ];
  const ORDERS = BASE_ORDERS.map(o => ({ ...o, deadlineMs: Math.round(o.deadlineMs * deadlineMult) }));

  const STEP_LABELS = ['inventory_check', 'payment_charge', 'shipment_book'];

  let totalScore    = 0;
  let totalFulfilled = 0;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  for (let i = 0; i < ORDERS.length; i++) {
    const order = ORDERS[i];
    orderNumEl.textContent = i + 1;

    // Render order card
    orderAreaEl.innerHTML =
      '<div class="dash-order">' +
        '<div class="dash-order-header">' +
          '<span class="dash-order-name">' + order.emoji + ' ' + order.name + '</span>' +
          '<span class="dash-order-reward">+' + order.reward + '</span>' +
        '</div>' +
        '<div class="dash-deadline-bar"><div class="dash-deadline-fill" id="dfill" style="width:100%"></div></div>' +
        '<div class="dash-steps" id="dsteps">' +
          STEP_LABELS.map(l => '<div class="dash-step"><div class="dash-step-dot"></div><span class="dash-step-label">' + l.replace(/_/g, ' ') + '</span></div>').join('') +
        '</div>' +
        '<button class="dash-accept-btn" id="daccept">ACCEPT</button>' +
        '<div class="dash-result" id="dresult"></div>' +
      '</div>';

    const fillEl   = document.getElementById('dfill');
    const stepsEl  = document.getElementById('dsteps');
    const acceptEl = document.getElementById('daccept');
    const resultEl = document.getElementById('dresult');

    // Run countdown animation while waiting for accept
    const acceptDeadline = Date.now() + order.deadlineMs;
    let accepted = false;
    let animFrameId;

    function animCountdown() {
      const remaining = acceptDeadline - Date.now();
      const pct = Math.max(0, remaining / order.deadlineMs) * 100;
      fillEl.style.width = pct + '%';
      if (pct < 30) fillEl.classList.add('urgent');
      if (remaining > 0 && !accepted) {
        animFrameId = requestAnimationFrame(animCountdown);
      } else if (remaining <= 0 && !accepted) {
        acceptEl.disabled = true;
        resultEl.className  = 'dash-result bad';
        resultEl.textContent = 'Order expired — skipped';
        fillEl.style.width = '0%';
      }
    }
    animFrameId = requestAnimationFrame(animCountdown);

    // Wait for accept click or expiry
    const clicked = await new Promise(resolve => {
      acceptEl.addEventListener('click', () => { accepted = true; resolve(true); }, { once: true });
      const expCheck = setInterval(() => {
        if (Date.now() >= acceptDeadline && !accepted) { clearInterval(expCheck); resolve(false); }
      }, 50);
    });
    cancelAnimationFrame(animFrameId);

    if (!clicked) {
      await delay(900);
      continue;
    }

    acceptEl.disabled = true;

    // Show steps as running while waiting for server
    const stepEls = stepsEl.querySelectorAll('.dash-step');
    stepEls.forEach(el => el.classList.add('running'));

    // Restart countdown from "accept" moment (server sees same deadline_ms)
    const acceptedAt   = Date.now();
    const remainingMs  = acceptDeadline - acceptedAt;

    // Animate remaining time during server call
    const serverStart = Date.now();
    function animDuring() {
      const r = remainingMs - (Date.now() - serverStart);
      const pct = Math.max(0, r / order.deadlineMs) * 100;
      fillEl.style.width = pct + '%';
      if (pct < 30) fillEl.classList.add('urgent');
      if (r > 0) animFrameId = requestAnimationFrame(animDuring);
    }
    animFrameId = requestAnimationFrame(animDuring);

    let result = null;
    try {
      const resp = await fetch('/api/games/deadline-dash/order', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id:  session.id,
          order_id:    order.id,
          deadline_ms: order.deadlineMs,
        }),
      });
      result = await resp.json();
    } catch (_) {}
    cancelAnimationFrame(animFrameId);

    // Show step results
    const stepResults = (result && result.steps) || [];
    stepEls.forEach((el, idx) => {
      el.classList.remove('running');
      const status = stepResults[idx] && stepResults[idx].status;
      el.classList.add(status === 'timeout' ? 'timeout' : 'ok');
    });

    if (result && result.fulfilled) {
      totalFulfilled++;
      totalScore += order.reward;
      fulfilledEl.textContent = totalFulfilled;
      scoreEl.textContent     = totalScore;
      fillEl.style.width      = '100%';
      fillEl.classList.remove('urgent');
      resultEl.className  = 'dash-result ok';
      resultEl.textContent = 'Fulfilled! +' + order.reward + ' pts';
    } else {
      fillEl.style.width = '0%';
      resultEl.className  = 'dash-result bad';
      resultEl.textContent = 'Deadline exceeded — no points';
    }

    await delay(1800);
  }

  orderAreaEl.innerHTML = '<div style="font-size:15px;color:var(--accent2);padding:14px">All orders processed!</div>';

  try {
    await window.Arcade.completeGame('deadline-dash', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({
    title: 'Deliveries Done! 📦',
    stats: [{ label: 'Fulfilled', value: totalFulfilled + ' / ' + ORDERS.length }],
    score: totalScore,
  });
})();
