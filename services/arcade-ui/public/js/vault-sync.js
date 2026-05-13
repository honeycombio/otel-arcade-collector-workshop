(async function () {
  const vaultAreaEl = document.getElementById('vault-area');
  const roundNumEl  = document.getElementById('round-num');
  const committedEl = document.getElementById('committed');
  const scoreEl     = document.getElementById('score');
  document.getElementById('player').textContent = window.Arcade.getPlayerId();

  const difficulty = await window.Arcade.chooseDifficulty();

  let session = null;
  try {
    session = await window.Arcade.startGame('vault-sync');
  } catch (err) {
    vaultAreaEl.innerHTML = '<div style="color:#ff5d76;padding:14px">Failed to start: ' + err.message + '</div>';
    return;
  }

  // Easy = 3 rounds, Medium = 5, Hard = 7
  const ROUNDS = difficulty === 'easy' ? 3 : difficulty === 'hard' ? 7 : 5;

  const VAULTS = [
    { id: 'vault_A', name: 'Alpha', emoji: '🏦' },
    { id: 'vault_B', name: 'Beta',  emoji: '🔐' },
    { id: 'vault_C', name: 'Gamma', emoji: '💰' },
  ];

  // Pre-schedule mole vaults: every 3rd round gets one
  const molePlan = Array.from({ length: ROUNDS }, (_, i) =>
    (i % 3 === 2) ? VAULTS[Math.floor(Math.random() * VAULTS.length)].id : null
  );

  let totalScore = 0, totalCommitted = 0;

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function vaultDoors(states) {
    return VAULTS.map(v => {
      const state = (states && states[v.id]) || 'idle';
      return '<div class="vault-door ' + state + '" id="vdoor-' + v.id + '">' +
        '<span class="vault-door-icon">' + v.emoji + '</span>' +
        '<div class="vault-door-name">' + v.name + '</div>' +
        '<div class="vault-door-state">' + state.replace('-', ' ') + '</div>' +
        '</div>';
    }).join('');
  }

  for (let i = 0; i < ROUNDS; i++) {
    const moleVaultId = molePlan[i];
    roundNumEl.textContent = i + 1;

    const states = {};
    VAULTS.forEach(v => { states[v.id] = 'idle'; });

    vaultAreaEl.innerHTML =
      '<div class="vault-round">' +
        '<div class="vault-doors" id="vdoors">' + vaultDoors(states) + '</div>' +
        '<button class="vault-prepare-btn" id="prepare-btn">⚡ PREPARE HEIST</button>' +
        '<div class="vault-result" id="vresult"></div>' +
      '</div>';

    await new Promise(resolve => {
      document.getElementById('prepare-btn').addEventListener('click', resolve, { once: true });
    });

    document.getElementById('prepare-btn').disabled = true;
    VAULTS.forEach(v => { states[v.id] = 'preparing'; });
    document.getElementById('vdoors').innerHTML = vaultDoors(states);

    let result = { committed: false, failed_vault: null };
    try {
      const resp = await fetch('/api/games/vault-sync/transaction', {
        method:  'POST',
        headers: {
          'content-type':  'application/json',
          'x-player-id':   window.Arcade.getPlayerId(),
          'x-player-name': window.Arcade.getPlayerName(),
        },
        body: JSON.stringify({
          session_id: session.id,
          vault_ids:  VAULTS.map(v => v.id),
          abort_vault: moleVaultId,
        }),
      });
      result = await resp.json();
    } catch (_) {}

    const resultEl = document.getElementById('vresult');
    if (result.committed) {
      VAULTS.forEach(v => { states[v.id] = 'committed'; });
      totalCommitted++;
      totalScore += 200;
      committedEl.textContent = totalCommitted;
      scoreEl.textContent     = totalScore;
      resultEl.className  = 'vault-result ok';
      resultEl.textContent = '✓ All vaults committed! +200 pts';
    } else {
      VAULTS.forEach(v => {
        states[v.id] = (v.id === result.failed_vault) ? 'failed' : 'rolling-back';
      });
      resultEl.className  = 'vault-result bad';
      resultEl.textContent = '✗ ' + (result.failed_vault || 'vault') + ' refused — transaction aborted';
    }
    document.getElementById('vdoors').innerHTML = vaultDoors(states);

    await delay(i < ROUNDS - 1 ? 2200 : 1200);
  }

  vaultAreaEl.innerHTML = '<div style="font-size:15px;color:var(--accent2);padding:14px">All rounds complete!</div>';

  try {
    await window.Arcade.completeGame('vault-sync', session.id, totalScore, difficulty);
  } catch (_) {}

  window.Arcade.showGameOver({
    title: 'Heist Complete! 🏦',
    stats: [{ label: 'Committed', value: totalCommitted + ' / ' + ROUNDS }],
    score: totalScore,
  });
})();
