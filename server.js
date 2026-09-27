'use strict';
/**
 * Servidor do Palitinho: HTTP estático + WebSocket.
 * O servidor é a única fonte da verdade: mãos fechadas nunca saem daqui
 * antes da revelação, e todo tempo (prazo de jogada) é controlado aqui.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError, PHASE } = require('./engine');
const bots = require('./bots');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');

const T = {
  choose: 20000, // prazo para escolher palitos
  guess: 15000, // prazo para palpitar
  reveal: 7500, // tempo da revelação
  away: 6000, // desconectado: assume o piloto automático depois disso
  over: 15000, // demo: reinicia sozinha
  ...(process.env.FAST ? { reveal: 400, over: 400 } : {}),
};

const rand = (a, b) => a + Math.random() * (b - a);
const uid = () => crypto.randomBytes(12).toString('hex');
const isAuto = (p) => p.bot || p.auto;

// ---------------------------------------------------------------- Sala
class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.demo = !!opts.demo;
    this.game = new Game({ startSticks: opts.startSticks || 3, mode: opts.mode });
    this.scores = new Map(); // placar da mesa (vale enquanto a sala existir)
    this.scoredGame = 0;
    this.clients = new Set(); // conexões
    this.hostToken = opts.hostToken || null;
    this.timer = null;
    this.botTimers = new Set();
    this.scheduledStamp = -1;
    this.deadline = null;
    this.lastActivity = Date.now();
  }

  // ----- helpers
  seatOf(token) {
    return this.game.seats.findIndex((p) => p && p.id === token);
  }
  humansConnected() {
    return [...this.clients].filter((c) => c.ws.readyState === 1);
  }
  ensureHost() {
    if (this.demo) return;
    const alive = this.humansConnected();
    if (!alive.length) return;
    if (!alive.some((c) => c.token === this.hostToken)) this.hostToken = alive[0].token;
  }
  hostSeat() {
    return this.seatOf(this.hostToken);
  }

  // ----- placar
  // Não é jogo de quem ganha mais: quem se salva não "vence", só escapou.
  // O que conta de verdade é quanto cada um erra rodada após rodada — quem
  // erra menos é o Rei do Palito, quem mais erra é o Purrinha da mesa.
  tally() {
    const g = this.game;
    if (g.phase !== PHASE.OVER || this.scoredGame === g.gameId) return;
    this.scoredGame = g.gameId;
    for (const r of g.summary()) {
      const e = this.scores.get(r.id) || { id: r.id, name: r.name, bot: r.bot, games: 0, rounds: 0, hits: 0, roundLosses: 0, ferrado: 0, lastPlace: 0 };
      e.name = r.name; e.bot = r.bot;
      e.games++; e.rounds += r.rounds; e.hits += r.hits; e.roundLosses += r.roundLosses; e.ferrado += r.ferrado;
      if (r.result === 'loss') e.lastPlace++;
      this.scores.set(r.id, e);
    }
  }
  scoreboard() {
    const rows = [...this.scores.values()].filter((r) => r.rounds > 0);
    const pick = (key, dir) => {
      if (!rows.length) return [];
      const val = dir === 'min' ? Math.min(...rows.map((r) => r[key])) : Math.max(...rows.map((r) => r[key]));
      return rows.filter((r) => r[key] === val).map((r) => r.id);
    };
    const rei = pick('roundLosses', 'min'); // Rei do Palito: quem menos erra rodada
    const purrinha = pick('roundLosses', 'max'); // Purrinha da mesa: quem mais erra rodada
    rows.sort((a, b) => a.roundLosses - b.roundLosses || b.rounds - a.rounds || a.name.localeCompare(b.name));
    const seatsOf = (ids) => this.game.seats.map((p, i) => (p && ids.includes(p.id) ? i : -1)).filter((i) => i >= 0);
    return { rows, rei, purrinha, reiSeats: seatsOf(rei), purrinhaSeats: seatsOf(purrinha) };
  }

  // ----- envio
  broadcast() {
    this.ensureHost();
    for (const c of this.clients) this.sendState(c);
  }
  sendState(c) {
    if (c.ws.readyState !== 1) return;
    const seat = this.seatOf(c.token);
    const g = this.game;
    const me = seat >= 0 ? seat : null;
    const view = g.view(me);
    let hint = null;
    if (me !== null && view.myGuesses.length) hint = bots.hintFor(g, me);
    const sb = this.scoreboard();
    const payload = {
      t: 'state',
      scores: sb.rows,
      trophies: { rei: sb.rei, purrinha: sb.purrinha, reiSeats: sb.reiSeats, purrinhaSeats: sb.purrinhaSeats },
      room: this.code,
      demo: this.demo,
      now: Date.now(),
      deadline: this.deadline,
      isHost: c.token === this.hostToken,
      hostSeat: this.hostSeat(),
      mySeat: me,
      hint,
      s: view,
    };
    c.ws.send(JSON.stringify(payload));
  }

  // ----- agenda (só quando muda de fase/turno)
  afterChange() {
    this.lastActivity = Date.now();
    this.tally();
    if (this.game.stamp !== this.scheduledStamp) this.schedule();
    this.broadcast();
  }

  clearTimers() {
    clearTimeout(this.timer);
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers.clear();
    this.deadline = null;
  }

  later(ms, fn) {
    const stamp = this.game.stamp;
    const t = setTimeout(() => {
      this.botTimers.delete(t);
      if (this.game.stamp !== stamp) return;
      try { fn(); } catch (e) { if (!(e instanceof GameError)) console.error(e); }
      this.afterChange();
    }, ms);
    this.botTimers.add(t);
    return t;
  }

  schedule() {
    const g = this.game;
    this.clearTimers();
    this.scheduledStamp = g.stamp;
    const fast = this.demo || !!process.env.FAST || [...g.seats].every((p) => !p || p.bot);

    if (g.phase === PHASE.LOBBY) {
      if (this.demo && g.playerCount() >= 2) this.later(3000, () => g.start());
      return;
    }

    if (g.phase === PHASE.CHOOSING) {
      let humanPending = false;
      for (const s of g.pendingChoosers()) {
        const p = g.seats[s];
        if (isAuto(p)) {
          this.later(fast ? rand(300, 1500) : rand(700, 2800), () => g.choose(s, bots.chooseSticks(g, s, p.persona || 'Novato')));
        } else {
          humanPending = true;
        }
      }
      if (humanPending) {
        const anyOffline = g.pendingChoosers().some((s) => !g.seats[s].bot && !g.seats[s].connected);
        const wait = anyOffline ? Math.min(T.choose, T.away) : T.choose;
        this.deadline = Date.now() + T.choose;
        this.later(wait, () => this.forceChoose());
      }
      return;
    }

    if (g.phase === PHASE.GUESSING) {
      const s = g.currentGuesser();
      const p = g.seats[s];
      if (isAuto(p)) {
        this.later(fast ? rand(250, 650) : rand(600, 1500), () => g.guess(s, bots.chooseGuess(g, s, p.persona || 'Novato')));
      } else {
        this.deadline = Date.now() + T.guess;
        const wait = p.connected ? T.guess : Math.min(T.guess, T.away);
        this.later(wait, () => {
          p.timeouts++;
          if (p.timeouts >= 2) p.auto = true; // dois timeouts seguidos: piloto automático
          g.guess(s, bots.chooseGuess(g, s, p.persona || 'Novato'));
        });
      }
      return;
    }

    if (g.phase === PHASE.REVEAL) {
      this.later(T.reveal, () => g.nextRound());
      return;
    }

    if (g.phase === PHASE.OVER) {
      if (this.demo) this.later(T.over, () => { g.reset(); g.config({ mode: g.mode === 'notiro' ? 'descer' : 'notiro' }); g.start(); });
      return;
    }
  }

  forceChoose() {
    const g = this.game;
    for (const s of g.pendingChoosers()) {
      const p = g.seats[s];
      if (!isAuto(p)) { p.timeouts++; if (p.timeouts >= 2) p.auto = true; }
      g.choose(s, bots.chooseSticks(g, s, p.persona || 'Novato'));
    }
  }

  // ----- ações de jogadores
  act(c, msg) {
    const g = this.game;
    const seat = this.seatOf(c.token);
    const isHost = c.token === this.hostToken;
    switch (msg.t) {
      case 'sit': {
        if (seat >= 0) throw new GameError('JA_SENTADO', 'Você já está sentado.');
        const name = cleanName(msg.name || c.name);
        if (!name) throw new GameError('NOME', 'Informe seu nome.');
        c.name = name;
        const target = g.freeSeat(Number.isInteger(msg.seat) ? msg.seat : undefined);
        if (target < 0) throw new GameError('CHEIA', 'Mesa cheia.');
        if (Number.isInteger(msg.seat) && msg.seat >= 0 && g.seats[msg.seat]) throw new GameError('OCUPADO', 'Esse lugar já está ocupado.');
        g.sit(target, { id: c.token, name });
        break;
      }
      case 'stand': {
        if (seat < 0) return;
        g.stand(seat);
        break;
      }
      case 'fillBots': {
        needHost(isHost, this.demo);
        const want = Math.min(g.maxSeats, Math.max(2, parseInt(msg.count || g.maxSeats, 10)));
        addBots(g, want - g.playerCount());
        break;
      }
      case 'addBot': {
        needHost(isHost, this.demo);
        addBots(g, 1, Number.isInteger(msg.seat) ? msg.seat : undefined);
        break;
      }
      case 'removeBot': {
        needHost(isHost, this.demo);
        const p = g.seats[msg.seat];
        if (p && p.bot && g.phase === PHASE.LOBBY) g.seats[msg.seat] = null;
        break;
      }
      case 'config': {
        needHost(isHost, this.demo);
        g.config({ mode: msg.mode, startSticks: msg.sticks });
        break;
      }
      case 'resetScores': {
        needHost(isHost, this.demo);
        this.scores.clear();
        break;
      }
      case 'start': {
        needHost(isHost, this.demo);
        g.start();
        break;
      }
      case 'again': {
        needHost(isHost, this.demo);
        if (g.phase !== PHASE.OVER) throw new GameError('FASE', 'A partida ainda não terminou.');
        g.reset();
        g.start();
        break;
      }
      case 'choose': {
        if (seat < 0) throw new GameError('ASSENTO', 'Você não está sentado.');
        g.choose(seat, msg.n);
        markActive(g.seats[seat]);
        break;
      }
      case 'guess': {
        if (seat < 0) throw new GameError('ASSENTO', 'Você não está sentado.');
        g.guess(seat, msg.v);
        markActive(g.seats[seat]);
        break;
      }
      case 'back': { // "voltei" depois do piloto automático
        if (seat >= 0) markActive(g.seats[seat]);
        break;
      }
      default:
        throw new GameError('MSG', 'Mensagem desconhecida.');
    }
    this.afterChange();
  }
}

function markActive(p) {
  if (!p || p.bot) return;
  p.timeouts = 0;
  p.auto = false;
}
function needHost(isHost, demo) {
  if (!isHost || demo) throw new GameError('HOST', 'Só quem criou a mesa pode fazer isso.');
}
function addBots(g, n, preferSeat) {
  const used = new Set(g.seats.filter(Boolean).map((p) => p.name));
  const pool = bots.BOT_NAMES.filter((x) => !used.has(x));
  for (let i = 0; i < n; i++) {
    const seat = g.freeSeat(i === 0 ? preferSeat : undefined);
    if (seat < 0) return;
    const name = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : 'Bot ' + (seat + 1);
    g.sit(seat, { id: 'bot-' + uid(), name, bot: true, persona: bots.randomPersona() });
  }
}
function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
}

// ---------------------------------------------------------------- Salas
const rooms = new Map();
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.humansConnected().length === 0 && Date.now() - r.lastActivity > 10 * 60 * 1000) {
      r.clearTimers();
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.end('ok'); return; }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server, maxPayload: 2048 });

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  const conn = { ws, token: null, name: '', room: null, hits: 0, windowStart: Date.now() };

  ws.on('message', (raw) => {
    // limite simples de mensagens por segundo
    const now = Date.now();
    if (now - conn.windowStart > 1000) { conn.windowStart = now; conn.hits = 0; }
    if (++conn.hits > 20) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    try {
      if (msg.t === 'ping') { send(ws, { t: 'pong' }); return; }
      if (msg.t === 'join') return join(conn, msg);
      if (!conn.room) throw new GameError('SALA', 'Entre em uma mesa primeiro.');
      if (msg.t === 'leave') return leave(conn, true);
      conn.room.act(conn, msg);
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: 'error', code: e.code, msg: e.message });
      else { console.error(e); send(ws, { t: 'error', code: 'INTERNO', msg: 'Erro interno.' }); }
    }
  });

  ws.on('close', () => leave(conn, false));
  ws.on('error', () => {});
});

function join(conn, msg) {
  if (conn.room) leave(conn, true);
  let room;
  const wanted = String(msg.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const token = /^[a-f0-9]{24}$/.test(msg.token || '') ? msg.token : uid();

  if (msg.demo) {
    room = new Room(newCode(), { demo: true, startSticks: 3, mode: 'notiro' });
    rooms.set(room.code, room);
    addBots(room.game, room.game.maxSeats);
  } else if (msg.create) {
    room = new Room(newCode(), { hostToken: token, startSticks: [2, 3].includes(msg.sticks) ? msg.sticks : 3, mode: msg.mode });
    rooms.set(room.code, room);
  } else {
    room = rooms.get(wanted);
    if (!room) throw new GameError('SALA', 'Mesa não encontrada. Confira o código.');
  }

  conn.token = token;
  conn.name = cleanName(msg.name);
  conn.room = room;
  // se o mesmo token já estava aqui (reconexão / aba nova), derruba a conexão antiga
  for (const c of room.clients) {
    if (c.token === token && c !== conn) {
      room.clients.delete(c);
      try { c.ws.close(); } catch {}
    }
  }
  room.clients.add(conn);
  const seat = room.seatOf(token);
  if (seat >= 0) {
    const p = room.game.seats[seat];
    p.connected = true;
    markActive(p);
  }
  send(conn.ws, { t: 'welcome', token, room: room.code, demo: room.demo });
  // uma sala em modo "demo" só começa a rodar quando o primeiro espectador chega
  if (room.game.stamp !== room.scheduledStamp || room.scheduledStamp === -1) room.schedule();
  room.afterChange();
}

function leave(conn, explicit) {
  const room = conn.room;
  if (!room) return;
  const seat = room.seatOf(conn.token);
  if (explicit) {
    room.clients.delete(conn);
    conn.room = null;
    if (seat >= 0) room.game.stand(seat);
  } else if (seat >= 0) {
    const p = room.game.seats[seat];
    // só marca como desconectado se não houver outra conexão do mesmo token
    const other = [...room.clients].some((c) => c !== conn && c.token === conn.token && c.ws.readyState === 1);
    if (!other) p.connected = false;
    if (room.game.phase === PHASE.LOBBY && !other) {
      // no lobby, quem sai libera o lugar depois de um tempo curto (permite recarregar a página)
      setTimeout(() => {
        const s2 = room.seatOf(conn.token);
        const stillAway = ![...room.clients].some((c) => c.token === conn.token && c.ws.readyState === 1);
        if (s2 >= 0 && stillAway && room.game.phase === PHASE.LOBBY) { room.game.stand(s2); room.afterChange(); }
      }, 15000).unref();
    }
  }
  if (!explicit) room.clients.delete(conn);
  room.afterChange();
}

server.listen(PORT, () => console.log(`Palitinho no ar: http://localhost:${PORT}`));

module.exports = { server, wss, rooms, T };
