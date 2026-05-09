(async function () {
  const auctionEl  = document.getElementById('auction-area');
  const roundNumEl = document.getElementById('round-num');
  const itemsWonEl = document.getElementById('items-won');
  const scoreEl    = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('bid-wars');
  } catch (err) {
    auctionEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  const ALL_ITEMS = [
    { id: 'item_traces',  emoji: '📡', name: 'Rare Trace Artifact',   basePrice: 80  },
    { id: 'item_metrics', emoji: '📊', name: 'Metric Heirloom',        basePrice: 120 },
    { id: 'item_logs',    emoji: '📜', name: 'Ancient Log Fragment',   basePrice: 160 },
    { id: 'item_spans',   emoji: '🔗', name: 'Golden Span Token',      basePrice: 200 },
    { id: 'item_ottl',    emoji: '⚗️', name: 'OTTL Formula Blueprint', basePrice: 250 },
  ];

  // Easy: 2 items, Medium: 3, Hard: all 5
  const ITEMS = difficulty === 'easy' ? ALL_ITEMS.slice(0, 2)
              : difficulty === 'hard'  ? ALL_ITEMS
              : ALL_ITEMS.slice(0, 3);

  // Easy: 18s per round, Medium: 12s, Hard: 8s (more time pressure)
  const ROUND_SECONDS = difficulty === 'easy' ? 18 : difficulty === 'hard' ? 8 : 12;
  let totalScore = 0;
  let itemsWon   = 0;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function runRound(item, roundIndex) {
    roundNumEl.textContent = roundIndex + 1;

    let price       = item.basePrice;
    let timeLeft    = ROUND_SECONDS;
    let bidding     = false;
    let roundOver   = false;

    // Build the auction card UI
    auctionEl.innerHTML = `
      <div class="bid-item-card">
        <span class="bid-item-emoji">${item.emoji}</span>
        <div class="bid-item-name">${item.name}</div>
        <div class="bid-item-price" id="price">$${price}</div>
        <div class="bid-timer-bar"><div class="bid-timer-fill" id="timer-fill" style="width:100%"></div></div>
        <button class="bid-btn" id="bid-btn">Place Bid — $<span id="btn-price">${price}</span></button>
      </div>
      <div class="bid-history" id="bid-history"></div>
    `;

    const priceEl    = document.getElementById('price');
    const timerFill  = document.getElementById('timer-fill');
    const bidBtn     = document.getElementById('bid-btn');
    const btnPrice   = document.getElementById('btn-price');
    const historyEl  = document.getElementById('bid-history');

    function addHistoryRow(cls, label) {
      const row = document.createElement('div');
      row.className = 'bid-attempt-row ' + cls;
      row.innerHTML = '<div class="bid-dot"></div><span class="bid-label">' + label + '</span>';
      historyEl.prepend(row);
    }

    bidBtn.addEventListener('click', async () => {
      if (bidding || roundOver) return;
      bidding = true;
      bidBtn.disabled = true;

      const bidAmount    = price;
      const timeRemaining = timeLeft;

      try {
        const r = await fetch('/api/games/bid-wars/bid', {
          method:  'POST',
          headers: {
            'content-type': 'application/json',
            'x-player-id':   window.Arcade.getPlayerId(),
            'x-player-name': window.Arcade.getPlayerName(),
          },
          body: JSON.stringify({
            session_id:     session.id,
            item_id:        item.id,
            bid_amount:     bidAmount,
            time_remaining: timeRemaining,
          }),
        });
        const data = await r.json();

        if (data.success) {
          addHistoryRow('ok', '✓ Bid won — $' + bidAmount + ' (' + data.attempts + ' attempt' + (data.attempts > 1 ? 's' : '') + ')');
          roundOver = true;
          itemsWon++;
          totalScore += bidAmount;
          itemsWonEl.textContent = itemsWon;
          scoreEl.textContent    = totalScore;
          bidBtn.textContent     = 'Lot secured!';
        } else {
          addHistoryRow('err', '✗ Contention — bid lost after ' + data.attempts + ' attempts');
          bidBtn.disabled = false;
        }
      } catch (_) {
        addHistoryRow('err', '✗ Network error');
        bidBtn.disabled = false;
      }

      bidding = false;
    });

    // Countdown + price drift
    await new Promise(resolve => {
      const ticker = setInterval(() => {
        if (roundOver) { clearInterval(ticker); resolve(); return; }
        timeLeft--;
        const pct = timeLeft / ROUND_SECONDS;
        timerFill.style.width = (pct * 100) + '%';
        if (pct < 0.35) timerFill.classList.add('urgent');

        // Price creeps up as time runs out (competitive pressure)
        if (timeLeft % 3 === 0 && timeLeft > 0) {
          price += Math.floor(Math.random() * 8) + 3;
          priceEl.textContent = '$' + price;
          btnPrice.textContent = price;
          bidBtn.querySelector && (bidBtn.textContent = 'Place Bid — $' + price);
        }

        if (timeLeft <= 0) { clearInterval(ticker); resolve(); }
      }, 1000);
    });

    if (!roundOver) {
      addHistoryRow('err', '✗ Auction ended — lot unsold');
      bidBtn.disabled = true;
    }
    await delay(1400);
  }

  for (let i = 0; i < ITEMS.length; i++) {
    await runRound(ITEMS[i], i);
  }

  auctionEl.innerHTML = '<div style="color:var(--accent2);padding:14px;font-size:14px">Auction complete.</div>';
  try {
    await window.Arcade.completeGame('bid-wars', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({ title: 'Auction Closed! 🏺', stats: [{ label: 'Items Won', value: itemsWon + ' / ' + ITEMS.length }], score: totalScore });
})();
