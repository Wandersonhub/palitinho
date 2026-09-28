'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let ws = null;
  let token = ls.get('pp_token') || '';
  let roomCode = '';
  let inRoom = false;
  let S = null; // último estado do servidor
  let clockOffset = 0;
  let timerTotal = 1;
  let lastDeadline = null;
  let bannerHidden = false;
  let retry = null;

  const MODES = {
    descer: { name: 'Descer palito', desc: 'Quem acerta desce 1 palito. Ao zerar, está salvo e sai da roda. Continua até sobrar um só: esse perde. Ótimo para poucos jogadores.' },
    notiro: { name: 'No tiro', desc: 'Quem acerta já sai da roda, salvo. Continua até sobrar um só: esse perde. Ótimo para muitos jogadores, rodadas bem rápidas.' },
  };

  // ---------- avatar escolhido na entrada ----------
  const AVATAR_PRESETS = Array.from({ length: 10 }, (_, i) => 'ava-' + i);

  // ---------- avatares (SVG gerado a partir do nome) ----------
  const SKIN = ['#f3d2b3', '#e0ac82', '#c68863', '#8d5a3b', '#5e3a26'];
  const HAIR = ['#1b1b1b', '#3b2417', '#6b4423', '#b5651d', '#d9b26a', '#8a8a8a', '#a3221f'];
  const SHIRT = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#34495e', '#d35400', '#c2185b', '#5d6d7e'];
  const BG = ['#f6e7c1', '#d8ecd9', '#d6e4f5', '#f3d5d5', '#e6dcf2', '#f8e0c8'];
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const avatarCache = {};
  function avatarSVG(seed) {
    if (avatarCache[seed]) return avatarCache[seed];
    const h = hash(seed);
    const skin = SKIN[h % 5], hair = HAIR[(h >>> 3) % 7], shirt = SHIRT[(h >>> 6) % 10], bg = BG[(h >>> 9) % 6];
    const style = (h >>> 12) % 5, glasses = ((h >>> 15) % 4) === 0, smile = (h >>> 17) % 3;
    let back = '', front = '';
    if (style === 1) back = `<rect x="28" y="36" width="44" height="42" rx="14" fill="${hair}"/>`; // cabelo longo
    if (style === 0 || style === 1 || style === 2) front += `<path d="M30 44 Q29 19 50 19 Q71 19 70 44 Q62 31 50 32 Q38 31 30 44Z" fill="${hair}"/>`;
    if (style === 2) front += `<circle cx="50" cy="15" r="8" fill="${hair}"/>`; // coque
    if (style === 3) front += `<path d="M29 40 Q31 17 50 17 Q69 17 71 40Z" fill="${shirt}"/><path d="M26 40 H80 V45 H26Z" fill="${shirt}" opacity=".85"/>`; // boné
    const mouth = smile === 0 ? '<path d="M43 56 Q50 62 57 56" stroke="#5b2a1e" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
      : smile === 1 ? '<path d="M44 57 Q50 60 56 57" stroke="#5b2a1e" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
      : '<ellipse cx="50" cy="57" rx="4.5" ry="3.2" fill="#7a2a1f"/>';
    const gl = glasses ? '<g fill="none" stroke="#222" stroke-width="2"><circle cx="42" cy="47" r="6.5"/><circle cx="58" cy="47" r="6.5"/><path d="M48.5 47H51.5"/></g>' : '';
    const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${bg}"/>${back}
      <path d="M8 100 Q10 74 50 72 Q90 74 92 100Z" fill="${shirt}"/><rect x="43" y="60" width="14" height="14" rx="5" fill="${skin}"/>
      <ellipse cx="50" cy="44" rx="19" ry="22" fill="${skin}"/><ellipse cx="31.5" cy="46" rx="3.2" ry="5" fill="${skin}"/><ellipse cx="68.5" cy="46" rx="3.2" ry="5" fill="${skin}"/>
      ${front}<circle cx="42" cy="47" r="2.3" fill="#231a16"/><circle cx="58" cy="47" r="2.3" fill="#231a16"/>${gl}${mouth}</svg>`;
    return (avatarCache[seed] = svg);
  }

  // ---------- rede ----------
  function connect(then) {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (then) then(); return; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);
    ws.onopen = () => { if (then) then(); };
    ws.onmessage = (ev) => onMsg(JSON.parse(ev.data));
    ws.onclose = () => {
      ws = null;
      if (inRoom) {
        toast('Conexão perdida. Reconectando…');
        clearTimeout(retry);
        retry = setTimeout(() => connect(() => send({ t: 'join', room: roomCode, token, name: nameVal() })), 1500);
      }
    };
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  const nameVal = () => ($('nameInput').value || ls.get('pp_name') || '').trim();

  function onMsg(m) {
    if (m.t === 'welcome') {
      token = m.token; ls.set('pp_token', token);
      roomCode = m.room; inRoom = true;
      history.replaceState(null, '', '#' + roomCode);
      $('home').hidden = true; $('game').hidden = false;
      $('roomCode').textContent = roomCode;
      return;
    }
    if (m.t === 'error') {
      if (!inRoom) { $('homeErr').textContent = m.msg; }
      else if (m.code === 'SALA') goHome(m.msg);
      else toast(m.msg);
      return;
    }
    if (m.t === 'state') {
      clockOffset = m.now - Date.now();
      if (m.deadline !== lastDeadline) {
        lastDeadline = m.deadline;
        timerTotal = m.deadline ? Math.max(1000, m.deadline - m.now) : 1;
      }
      if (S && S.s.phase === 'over' && m.s.phase !== 'over') bannerHidden = false;
      S = m;
      render();
      return;
    }
    if (m.t === 'sessionEnded') {
      $('ceremonyBody').innerHTML = ceremonyHTML(m.scoreboard);
      $('ceremonyDlg').showModal();
      return;
    }
  }

  function goHome(msg) {
    inRoom = false; S = null; roomCode = '';
    history.replaceState(null, '', location.pathname);
    $('game').hidden = true; $('home').hidden = false;
    $('homeErr').textContent = msg || '';
  }

  // ---------- home ----------
  function enter(payload) {
    const name = nameVal();
    if (!name) { $('homeErr').textContent = 'Informe seu nome.'; $('nameInput').focus(); return; }
    ls.set('pp_name', name);
    $('homeErr').textContent = '';
    connect(() => send({ t: 'join', token, name, ...payload }));
  }
  $('btnCreate').onclick = () => enter({ create: true });
  $('btnJoin').onclick = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeErr').textContent = 'O código tem 4 letras.'; return; }
    enter({ room: code });
  };
  $('btnDemo').onclick = () => { if (!nameVal()) $('nameInput').value = 'Espectador'; enter({ demo: true }); };
  $('btnRules').onclick = () => $('rulesDlg').showModal();
  $('btnRules2').onclick = () => $('rulesDlg').showModal();
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('codeInput').value ? $('btnJoin') : $('btnCreate')).click(); });
  $('btnLeave').onclick = () => { send({ t: 'leave' }); goHome(); };
  $('btnCopy').onclick = async () => {
    const url = location.origin + '/#' + roomCode;
    try { await navigator.clipboard.writeText(url); toast('Link copiado: ' + url, true); } catch { toast(url, true); }
  };
  $('btnLog').onclick = () => { $('logPanel').hidden = !$('logPanel').hidden; };
  $('btnLogClose').onclick = () => { $('logPanel').hidden = true; };
  $('btnScore').onclick = openScore;

  $('nameInput').value = ls.get('pp_name') || '';
  const h0 = location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z]{4}$/.test(h0)) { $('codeInput').value = h0; }

  // ---------- seleção de avatar ----------
  let chosenAvatar = ls.get('pp_avatar') || AVATAR_PRESETS[0];
  if (!AVATAR_PRESETS.includes(chosenAvatar)) chosenAvatar = AVATAR_PRESETS[0];
  function renderAvatarPick() {
    const box = $('avatarPick');
    if (!box) return;
    box.innerHTML = AVATAR_PRESETS.map((seed) =>
      `<button type="button" class="avatar-opt ${seed === chosenAvatar ? 'sel' : ''}" data-avatar="${seed}">${avatarSVG(seed)}</button>`
    ).join('');
  }
  renderAvatarPick();
  $('avatarPick') && $('avatarPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (!b) return;
    chosenAvatar = b.dataset.avatar;
    ls.set('pp_avatar', chosenAvatar);
    renderAvatarPick();
  });

  let toastT;
  function toast(msg, ok) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false; t.style.background = ok ? '#2a6b46' : '';
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- mesa ----------
  const N = 20;
  const seatEls = [];
  const table = $('table');
  for (let i = 0; i < N; i++) {
    const el = document.createElement('div');
    el.className = 'seat gone';
    el.dataset.seat = i;
    table.appendChild(el);
    seatEls.push(el);
  }
  table.addEventListener('click', (e) => {
    const el = e.target.closest('.seat');
    if (!el || !S) return;
    const i = +el.dataset.seat;
    const p = S.s.seats[i];
    if (p && p.bot && S.isHost && S.s.phase === 'lobby') send({ t: 'removeBot', seat: i });
  });

  // A mesa só tem lugar para quem está sentado: os jogadores ficam
  // igualmente espaçados em volta (3 jogadores = mesa de 3, 20 = mesa de 20).
  function seatGeom(rank, myRank, n) {
    const deg = 90 + ((rank - myRank + n) % n) * (360 / n);
    const ang = (deg * Math.PI) / 180;
    const few = n <= 8;
    const rx = few ? (window.innerWidth < 560 ? 35 : 40.5) : 43.5;
    const ry = few ? 39.5 : 42;
    return { x: 50 + rx * Math.cos(ang), y: 50 + ry * Math.sin(ang), cx: Math.cos(ang), cy: Math.sin(ang), rot: deg - 90 };
  }

  function render() {
    const s = S.s;
    const me = S.mySeat;
    const rec = s.record;
    const showHands = s.phase === 'reveal' || s.phase === 'over';
    const notiro = s.mode === 'notiro';
    const seated = [];
    s.seats.forEach((p, i) => { if (p) seated.push(i); });
    const n = seated.length || 1;
    const myRank = me === null ? 0 : Math.max(0, seated.indexOf(me));
    table.classList.toggle('few', n <= 8);
    table.classList.toggle('mid', n > 8 && n <= 12);
    table.classList.toggle('notiro', notiro);

    $('roundLabel').textContent = s.phase === 'lobby' ? 'Lobby' : `Rodada ${s.round}`;
    $('roomCode').textContent = S.room;
    $('modeChip').textContent = MODES[s.mode].name + (notiro && s.phase !== 'lobby' && s.phase !== 'over' ? ` · na roda ${s.playing}` : '');
    const T = S.trophies || { reiSeats: [], purrinhaSeats: [] };

    for (let i = 0; i < N; i++) {
      const el = seatEls[i];
      const p = s.seats[i];
      if (!p) { el.className = 'seat gone'; el.innerHTML = ''; continue; }
      const g = seatGeom(seated.indexOf(i), myRank, n);
      el.style.left = g.x + '%';
      el.style.top = g.y + '%';
      el.style.setProperty('--cx', g.cx.toFixed(3));
      el.style.setProperty('--cy', g.cy.toFixed(3));
      el.style.setProperty('--rot', g.rot.toFixed(1));
      const cls = ['seat', i % 3 === 0 ? 'chair-red' : 'chair-yellow'];
      if (i === me) cls.push('me');
      if (s.turnSeat === i) cls.push('turn');
      if (p.out) cls.push('saved');
      const hitNow = showHands && rec && rec.hitSeat === i;
      if (hitNow) cls.push('winner');
      if (s.phase === 'over' && s.loserSeat === i) cls.push('loser');
      if (s.phase === 'choosing' && !p.chosen && !p.out) cls.push('thinking');
      const k = s.order.indexOf(i);
      const tags = [
        S.hostSeat === i && !S.demo ? '<span title="Dono da mesa">★</span>' : '',
        T.reiSeats.includes(i) ? '<span title="Troféu Palito de Ouro">🏆</span>' : '',
        T.purrinhaSeats.includes(i) ? '<span title="Troféu Serasa">📛</span>' : '',
        p.bot ? '<span title="Bot">🤖</span>' : p.auto ? '<span title="Piloto automático">💤</span>' : '',
        !p.bot && !p.connected ? '<span title="Desconectado">⚡</span>' : '',
      ].join('');
      let hand = '';
      if (p.choice !== null && (showHands || i === me) && k >= 0) {
        hand = p.choice === 0 ? `<div class="hand lona" style="--k:${k}">LONA</div>` : `<div class="hand" style="--k:${k}">${p.choice}</div>`;
      } else if (p.chosen && !p.out) {
        hand = '<div class="fist">✊</div>';
      }
      const badge = p.guess !== null ? `<div class="badge guess">${p.guess}</div>` : '';
      let sticks = '';
      if (!notiro) for (let j = 0; j < s.startSticks; j++) sticks += `<i class="${j < p.sticks ? '' : 'off'}"></i>`;
      const minus = hitNow ? `<div class="float-minus">${notiro ? 'SALVO!' : '−1 palito'}</div>` : '';
      const savedTag = p.out ? `<div class="saved-tag">SALVO ${p.outPos}º</div>` : '';
      el.className = cls.join(' ');
      el.innerHTML = `<div class="chair"><i class="cush"></i><i class="back"></i></div>${badge}
        <div class="avatar">${avatarSVG(p.avatar || (p.name + '|' + i))}<div class="tags">${tags}</div>${hand}${minus}</div>
        <div class="plate">${esc(p.name)}</div>${savedTag}<div class="sticks">${sticks}</div>`;
    }

    renderCenter();
    renderControls();
    renderLog();
    renderBanner();
  }

  function nameOf(i) { return S.s.seats[i] ? esc(S.s.seats[i].name) : '?'; }

  function renderCenter() {
    const s = S.s;
    const notiro = s.mode === 'notiro';
    const main = $('statusMain'), sub = $('statusSub'), tb = $('totalBox');
    tb.hidden = true;
    const count = s.seats.filter(Boolean).length;
    if (s.phase === 'lobby') {
      main.textContent = S.demo ? 'Demonstração começando…' : 'Aguardando jogadores';
      sub.textContent = `${count} na mesa (até ${s.maxSeats}) · ${MODES[s.mode].name}`;
    } else if (s.phase === 'choosing') {
      const ready = s.seats.filter((p) => p && p.chosen).length;
      main.textContent = 'Escolham seus palitos';
      sub.textContent = (s.minPick === 1 ? 'Rodada 1: LONA proibida · ' : '') + `${ready}/${s.playing} prontos`;
    } else if (s.phase === 'guessing') {
      main.innerHTML = `Vez de ${nameOf(s.turnSeat)}`;
      sub.textContent = `Soma entre ${s.bounds.min} e ${s.bounds.max} · palpite ${s.taken.length + 1}/${s.order.length}`;
    } else {
      const r = s.record;
      tb.hidden = false; $('totalNum').textContent = r.total;
      $('totalBox').style.animation = 'none'; void $('totalBox').offsetWidth; $('totalBox').style.animation = '';
      const ferradoTag = r.ferrado ? ' 🔥 cantou ferrado!' : '';
      main.innerHTML = r.hitSeat === null ? 'Ninguém acertou' : `${nameOf(r.hitSeat)} acertou!${ferradoTag}`;
      let base;
      if (r.hitSeat === null) base = 'Ninguém desce palito';
      else if (r.exited !== null) base = 'Se salvou! Sai da roda';
      else base = notiro ? 'Desce 1 palito' : `Desce 1 palito (ficou com ${S.s.seats[r.hitSeat].sticks})`;
      sub.textContent = base + (r.lonas.length ? ` · LONA: ${r.lonas.map((x) => S.s.seats[x].name).join(', ')}` : '');
    }
  }

  // barra de tempo
  const timerEl = $('timer'), bar = $('timerBar');
  function tick() {
    if (S && S.deadline && (S.s.phase === 'choosing' || S.s.phase === 'guessing')) {
      const left = S.deadline - (Date.now() + clockOffset);
      const f = Math.max(0, Math.min(1, left / timerTotal));
      timerEl.hidden = false;
      bar.style.transform = `scaleX(${f})`;
      timerEl.classList.toggle('low', left < 5000);
    } else timerEl.hidden = true;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- controles ----------
  function sticksIcon(n) { return `<div class="mini-sticks">${'<i style="height:16px"></i>'.repeat(n)}</div>`; }

  function modePicker(s) {
    const host = S.isHost && !S.demo;
    const card = (m) => `<button class="mode ${s.mode === m ? 'on' : ''}" data-act="mode" data-m="${m}" ${host ? '' : 'disabled'}>
        <b>${MODES[m].name}</b><span>${MODES[m].desc}</span></button>`;
    const timers = host
      ? `<div class="host-row small-row timer-cfg">
          <label class="inline">Tempo pra escolher os palitos (segundos)
            <input type="number" id="cfgTimeChoose" min="5" max="60" value="${S.timeChoose ?? 20}">
          </label>
          <label class="inline">Tempo pra palpitar (segundos)
            <input type="number" id="cfgTimeGuess" min="5" max="45" value="${S.timeGuess ?? 15}">
          </label>
          <button class="btn mini" data-act="saveTimers">Salvar tempos</button>
        </div>
        <div class="host-row small-row">
          <label class="inline chk"><input type="checkbox" id="cfgAutoPilot" ${S.autoPilot ? 'checked' : ''}> Piloto automático persistente (2 vezes sem jogar)</label>
        </div>`
      : `<p class="small">Tempo: ${S.timeChoose ?? 20}s pra escolher · ${S.timeGuess ?? 15}s pra palpitar</p>`;
    return `<div class="modes">${card('descer')}${card('notiro')}</div>${timers}`;
  }

  function renderControls() {
    const s = S.s, me = S.mySeat, c = $('controls');
    const seated = me !== null;
    const mine = seated ? s.seats[me] : null;
    const count = s.seats.filter(Boolean).length;
    let html = '';

    if (S.demo) {
      html = `<div class="ctl"><h3>Modo demonstração · ${MODES[s.mode].name}</h3><p>20 bots jogando entre si (a cada partida troca o estilo). Você está só assistindo.</p></div>`;
    } else if (s.phase === 'lobby') {
      const host = S.isHost ? `<div class="host-row">
          <button class="btn gold" data-act="start" ${count < 2 ? 'disabled' : ''}>Iniciar com ${count} jogador${count === 1 ? '' : 'es'}</button>
        </div>
        <div class="host-row small-row">
          <span class="small">Opcional:</span>
          <button class="btn mini" data-act="addBot">+ Bot</button>
          <button class="btn mini" data-act="fill">Completar com bots até 20</button>
        </div>` : `<p>Aguardando o dono da mesa iniciar…</p>`;
      html = `<div class="ctl"><h3>Mesa ${esc(S.room)} · ${count} na mesa (máx. ${s.maxSeats})</h3>
        ${modePicker(s)}
        <p>${seated ? 'Você está sentado.' : 'Entre na mesa para jogar.'} Cada amigo que entrar ganha um lugar. Mande o link (botão no topo).${count < 2 ? ' Mínimo 2 jogadores.' : ''}</p>
        ${seated ? '' : '<button class="btn gold" data-act="sit">Sentar na mesa</button>'}
        ${host}</div>`;
    } else if (!seated) {
      html = `<div class="ctl"><h3>Você está assistindo</h3><p>Quando a partida acabar você pode sentar na próxima.</p></div>`;
    } else if (mine.out && s.phase !== 'over') {
      html = `<div class="ctl"><h3>Você está salvo! (${mine.outPos}º a sair)</h3><p>Agora é torcer para não ser o último a sobrar. Ainda na roda: ${s.playing}.</p></div>`;
    } else if (s.phase === 'choosing') {
      if (s.myChoices.length) {
        html = `<div class="ctl"><h3>Quantos palitos você leva na mão?</h3><div class="picks">${
          Array.from({ length: mine.sticks + 1 }, (_, n) => {
            const ok = s.myChoices.includes(n);
            return `<button class="pick ${n === 0 ? 'lona' : ''}" data-act="choose" data-n="${n}" ${ok ? '' : 'disabled'}>${n === 0 ? '✋' : sticksIcon(n)}<span>${n}</span><small>${n === 0 ? (s.minPick ? 'LONA proibida' : 'LONA') : 'palito' + (n > 1 ? 's' : '')}</small></button>`;
          }).join('')
        }</div>${s.minPick ? '<p>Na 1ª rodada ninguém pode ir de LONA (mão vazia).</p>' : ''}</div>`;
      } else {
        html = `<div class="ctl"><h3>Você foi com ${mine.choice} palito${mine.choice === 1 ? '' : 's'}${mine.choice === 0 ? ' (LONA!)' : ''}</h3><p>Esperando os outros escolherem…</p></div>`;
      }
    } else if (s.phase === 'guessing') {
      if (s.myGuesses.length) {
        const hint = S.hint || {};
        const best = Object.entries(hint).sort((a, b) => b[1] - a[1])[0];
        const maxP = best ? best[1] || 1 : 1;
        const cells = [];
        for (let v = s.bounds.min; v <= s.bounds.max; v++) {
          const ok = s.myGuesses.includes(v);
          const p = hint[v] || 0;
          cells.push(`<button class="num ${best && +best[0] === v ? 'best' : ''}" data-act="guess" data-v="${v}" style="--p:${(p / maxP).toFixed(2)}" ${ok ? '' : 'disabled'}><span>${v}</span></button>`);
        }
        html = `<div class="ctl"><h3>Sua vez: qual a soma dos palitos?</h3>
          <p>Você está com ${mine.choice}. A barra dourada mostra a chance de cada número. Riscados já foram ditos.</p>
          <div class="grid">${cells.join('')}</div></div>`;
      } else {
        const g = mine.guess !== null ? `Seu palpite: <b>${mine.guess}</b>. ` : '';
        html = `<div class="ctl"><h3>Palpites em andamento</h3><p>${g}Aguardando ${s.turnSeat !== null ? nameOf(s.turnSeat) : ''}…</p></div>`;
      }
    } else if (s.phase === 'reveal') {
      html = `<div class="ctl"><h3>Rodada ${s.round} revelada</h3><p>A próxima começa já já…</p></div>`;
    } else {
      html = `<div class="ctl"><h3>Fim de partida</h3></div>`;
    }
    if (seated && mine && mine.auto) {
      html += `<div class="ctl"><button class="btn gold" data-act="back">Voltei! Tirar do piloto automático</button></div>`;
    }
    if (c.dataset.sig !== html) { c.innerHTML = html; c.dataset.sig = html; }
  }

  $('controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'choose') send({ t: 'choose', n: +b.dataset.n });
    else if (a === 'guess') send({ t: 'guess', v: +b.dataset.v });
    else if (a === 'sit') send({ t: 'sit', name: nameVal(), avatar: chosenAvatar });
    else if (a === 'addBot') send({ t: 'addBot' });
    else if (a === 'fill') send({ t: 'fillBots', count: 20 });
    else if (a === 'start') send({ t: 'start' });
    else if (a === 'back') send({ t: 'back' });
    else if (a === 'mode') send({ t: 'config', mode: b.dataset.m });
    else if (a === 'saveTimers') {
      const tc = +($('cfgTimeChoose') ? $('cfgTimeChoose').value : 20);
      const tg = +($('cfgTimeGuess') ? $('cfgTimeGuess').value : 15);
      send({ t: 'config', timeChoose: tc, timeGuess: tg });
    }
  });
  $('controls').addEventListener('change', (e) => {
    if (e.target.id === 'cfgAutoPilot') send({ t: 'config', autoPilot: e.target.checked });
  });

  // ---------- histórico ----------
  function renderLog() {
    const s = S.s;
    const list = $('logList');
    if (!s.history.length) { list.innerHTML = '<p class="small" style="padding:6px">Nenhuma rodada ainda.</p>'; return; }
    const nm = (i) => (s.seats[i] ? esc(s.seats[i].name) : '?');
    list.innerHTML = s.history.slice().reverse().map((r) => {
      let win;
      const fg = r.ferrado ? ' 🔥' : '';
      if (r.hitSeat === null) win = '<span class="none">ninguém acertou</span>';
      else if (r.exited !== null) win = `<span class="win">${nm(r.hitSeat)} se salvou${fg}</span>` + (r.finished && s.loserSeat !== null ? ` · <b>${nm(s.loserSeat)} sobrou e perdeu 📛</b>` : '');
      else win = `<span class="win">${nm(r.hitSeat)} desceu 1 palito${fg}</span>`;
      const ch = Object.entries(r.choices).map(([k, v]) => `${nm(+k)} ${v === 0 ? 'LONA' : v}`).join(' · ');
      const gs = r.guesses.map((g) => `${nm(g.seat)} ${g.value}`).join(' · ');
      return `<div class="rec"><div>Rodada ${r.round} · soma <b class="tot">${r.total}</b></div><div>${win}</div>
        <details><summary>Mãos e palpites</summary><div><b>Mãos:</b> ${ch}</div><div><b>Palpites:</b> ${gs}</div></details></div>`;
    }).join('');
  }

  // ---------- placar ----------
  function scoreHTML() {
    const rows = (S && S.scores) || [];
    const T = (S && S.trophies) || { rei: [], purrinha: [] };
    if (!rows.length) return '<p class="small">Nenhuma partida terminada ainda. O placar começa quando acabar a primeira.</p>';
    const by = (ids, key) => rows.filter((r) => ids.includes(r.id)).map((r) => `<b>${esc(r.name)}</b>`).join(', ') + ` (${rows.find((r) => ids.includes(r.id))[key]} erro${rows.find((r) => ids.includes(r.id))[key] === 1 ? '' : 's'} de rodada)`;
    const top = `<div class="trophies">
      <div class="troph"><span>🏆</span><div><small>TROFÉU PALITO DE OURO · quem menos erra rodada</small><div>${T.rei.length ? by(T.rei, 'roundLosses') : '<i>ainda ninguém</i>'}</div></div></div>
      <div class="troph"><span>📛</span><div><small>TROFÉU SERASA · quem mais erra rodada, o nome mais sujo da mesa</small><div>${T.purrinha.length ? by(T.purrinha, 'roundLosses') : '<i>ainda ninguém</i>'}</div></div></div></div>`;
    const body = rows.map((r) => `<tr><td class="nm">${T.rei.includes(r.id) ? '🏆 ' : ''}${T.purrinha.includes(r.id) ? '📛 ' : ''}${esc(r.name)}${r.bot ? ' 🤖' : ''}</td>
      <td>${r.games}</td><td>${r.rounds}</td><td>${r.hits}</td><td class="lose">${r.roundLosses}</td><td>${r.lastPlace}</td><td class="first">${r.ferrado || 0}</td></tr>`).join('');
    return `${top}<div class="tbl-wrap"><table class="score"><thead><tr><th>Jogador</th><th title="Partidas jogadas">P</th><th title="Rodadas jogadas nesta mesa">Rod</th><th title="Vezes que acertou a soma">Ac</th><th title="Rodadas em que não acertou">Err</th><th title="Vezes que foi o último a sobrar (perdeu a partida)">Últ</th><th title="Cantou ferrado: o primeiro a palpitar na rodada já acertou a soma em cima. Não vale nada, é só orgulho.">🔥</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="small">Quem erra menos rodadas é o melhor da mesa (Troféu Palito de Ouro); quem erra mais tem o nome mais sujo (Troféu Serasa). "Nome limpo" é não ter ficado por último em nenhuma partida ainda — não importa se a pessoa se salvou em 1º, 2º ou 3º, o que importa é nunca ter sido a última. Enquanto alguém segue limpo, o resto da mesa corre atrás pra sujar o nome dele também, só na brincadeira — e isso vale a sessão toda, que às vezes passa de 80 partidas em volta da mesa. P partidas · Rod rodadas · Ac acertos · Err erros de rodada · Últ vezes que sobrou por último · 🔥 cantou ferrado (orgulho, não conta pra nada).</p>`;
  }
  function openScore() {
    $('scoreBody').innerHTML = scoreHTML();
    renderEndVoteBox();
    $('btnResetScore').hidden = !(S && S.isHost && !S.demo);
    $('scoreDlg').showModal();
  }
  $('btnResetScore').onclick = () => { send({ t: 'resetScores' }); $('scoreDlg').close(); };

  // ---------- votação de encerramento por consenso ----------
  function renderEndVoteBox() {
    const box = $('endVoteBox');
    if (!box) return;
    if (!S || S.demo || S.mySeat === null) { box.innerHTML = ''; return; }
    const ev = S.endVotes || { count: 0, needed: 0, mine: false, voterNames: [] };
    box.innerHTML = `<hr>
      <p class="small">${ev.count} de ${ev.needed} jogador${ev.needed === 1 ? '' : 'es'} confirmaram encerrar a sessão por hoje.${ev.voterNames.length ? ' (' + ev.voterNames.map(esc).join(', ') + ')' : ''}</p>
      <button class="btn ${ev.mine ? 'gold' : ''} mini" data-act="endVote">${ev.mine ? 'Cancelar: quero continuar' : 'Quero parar por hoje'}</button>`;
  }
  $('endVoteBox').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="endVote"]')) send({ t: 'endVote' });
  });

  function ceremonyHTML(sb) {
    const rows = sb.rows || [];
    if (!rows.length) return '<p class="small">Ninguém completou uma rodada ainda.</p>';
    const by = (ids) => rows.filter((r) => ids.includes(r.id)).map((r) => `<b>${esc(r.name)}</b>`).join(', ') || '<i>ninguém</i>';
    return `<div class="trophies">
      <div class="troph"><span>🏆</span><div><small>TROFÉU PALITO DE OURO</small><div>${by(sb.rei)}</div></div></div>
      <div class="troph"><span>📛</span><div><small>TROFÉU SERASA</small><div>${by(sb.purrinha)}</div></div></div></div>`;
  }

  // ---------- fim de partida ----------
  function renderBanner() {
    const s = S.s, b = $('banner');
    if ($('scoreDlg').open) { $('scoreBody').innerHTML = scoreHTML(); renderEndVoteBox(); }
    if (s.phase !== 'over' || bannerHidden) { b.hidden = true; return; }
    let title, sub;
    const l = s.loserSeat;
    title = `📛 ${l === S.mySeat ? 'Você sobrou e perdeu!' : nameOf(l) + ' sobrou e perdeu!'}`;
    const order = s.seats.filter((p) => p && p.out).sort((a, b2) => a.outPos - b2.outPos).map((p) => `${p.outPos}º ${esc(p.name)}`).join(' · ');
    sub = `Foi o único que não se salvou, em ${s.round} rodadas.` + (order ? `<br><span class="small">Salvos: ${order}</span>` : '');
    b.hidden = false;
    b.innerHTML = `<h2>${title}</h2><p>${sub}</p>
      <div class="host-row">
        ${S.isHost && !S.demo ? '<button class="btn gold" id="bAgain">Nova partida</button>' : (S.demo ? '<p class="small">Nova partida começa sozinha…</p>' : '<p class="small">Aguardando o dono da mesa.</p>')}
        <button class="btn" id="bScore">Placar</button>
        <button class="btn" id="bView">Ver a mesa</button>
      </div>`;
    const again = $('bAgain'); if (again) again.onclick = () => send({ t: 'again' });
    $('bScore').onclick = openScore;
    $('bView').onclick = () => { bannerHidden = true; b.hidden = true; };
  }

  // ---------- auto-reconexão ao recarregar ----------
  const savedRoom = ls.get('pp_room');
  window.addEventListener('beforeunload', () => { if (inRoom) ls.set('pp_room', roomCode); else ls.del('pp_room'); });
  if (savedRoom && token && /^[A-Z]{4}$/.test(savedRoom) && nameVal()) {
    connect(() => send({ t: 'join', room: savedRoom, token, name: nameVal() }));
  }
  setInterval(() => send({ t: 'ping' }), 25000);
})();
