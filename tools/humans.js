'use strict';
// Mesa só de humanos (4 jogadores, sem bots): cada um ganha um lugar e a partida roda até o fim.
process.env.PORT = '0'; process.env.FAST = '1';
const WebSocket = require('ws');
const { server } = require('../server');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };
server.on('listening', async () => {
  const url = `ws://localhost:${server.address().port}`;
  const mk = (name) => new Promise((res) => {
    const ws = new WebSocket(url); const c = { ws, name, st: null };
    ws.on('open', () => res(c));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw); if (m.t !== 'state') return; c.st = m;
      const s = m.s; if (m.mySeat === null) return;
      const key = s.phase + s.round + s.taken.length;
      if (c.sent === key) return; // uma jogada por vez (não estoura o limite de mensagens)
      if (s.phase === 'choosing' && s.myChoices.length) { c.sent = key; ws.send(JSON.stringify({ t: 'choose', n: s.myChoices[0] })); }
      if (s.phase === 'guessing' && s.myGuesses.length) { c.sent = key; ws.send(JSON.stringify({ t: 'guess', v: s.myGuesses[0] })); }
    });
  });
  const N = parseInt(process.argv[2] || '4', 10);
  const MODE = process.argv[3] === 'notiro' ? 'notiro' : 'descer';
  const cs = []; for (let i = 0; i < N; i++) cs.push(await mk('J' + (i + 1)));
  cs[0].ws.send(JSON.stringify({ t: 'join', create: true, name: 'J1' }));
  await wait(150);
  const code = cs[0].st.room;
  for (let i = 1; i < N; i++) cs[i].ws.send(JSON.stringify({ t: 'join', room: code, name: 'J' + (i + 1) }));
  await wait(150);
  for (const c of cs) c.ws.send(JSON.stringify({ t: 'sit', name: c.name }));
  await wait(200);
  const seats = cs[0].st.s.seats.map((p, i) => (p ? i : null)).filter((x) => x !== null);
  if (seats.length !== N || seats.join() !== [...Array(N).keys()].join()) fail('lugares não ficaram compactos: ' + seats);
  console.log(`ok  ${N} humanos, ${N} lugares (${seats.join(',')}), nenhum bot`);
  cs[0].ws.send(JSON.stringify({ t: 'config', mode: MODE }));
  await wait(100);
  if (cs[0].st.s.mode !== MODE) fail('estilo não mudou');
  cs[0].ws.send(JSON.stringify({ t: 'start' }));
  const t0 = Date.now();
  while (cs[0].st.s.phase !== 'over') { if (Date.now() - t0 > 60000) fail('não terminou: fase ' + cs[0].st.s.phase + ' rodada ' + cs[0].st.s.round + ' vez ' + cs[0].st.s.turnSeat + ' sticks ' + cs[0].st.s.seats.filter(Boolean).map((p) => p.sticks).join(',')); await wait(200); }
  const s = cs[0].st.s;
  if (s.seats.some((p) => p && p.bot)) fail('apareceu bot');
  const outs = s.seats.filter((p) => p && p.out).length;
  if (outs !== N - 1 || s.loserSeat === null) fail(`[${MODE}] inválido: saíram ${outs} de ${N}, perdedor ${s.loserSeat}`);
  console.log(`ok  [${MODE}] terminou na rodada ${s.round}; se salvaram ${outs}; perdeu: ${s.seats[s.loserSeat].name}`);
  // placar acumulado
  await wait(200);
  const sc = cs[0].st.scores;
  if (!sc || sc.length !== N) fail('placar sem todos os jogadores');
  const lastPlaces = sc.reduce((a, r) => a + r.lastPlace, 0);
  if (lastPlaces !== 1) fail('deveria haver exatamente 1 "vez que foi o último" registrada, achei ' + lastPlaces);
  const trophies = cs[0].st.trophies;
  console.log('ok  placar:', sc.map((r) => `${r.name} Err${r.roundLosses}/Últ${r.lastPlace}/🔥${r.ferrado}`).join(' | '), '| Purrinha:', trophies.purrinha.length, 'Rei:', trophies.rei.length);
  // segunda partida acumula
  cs[0].ws.send(JSON.stringify({ t: 'again' }));
  const t1 = Date.now();
  while (cs[0].st.s.phase !== 'over' || cs[0].st.scores[0].games < 2) { if (Date.now() - t1 > 60000) fail('2ª partida não terminou'); await wait(200); }
  console.log('ok  2ª partida somou no placar (jogos por jogador:', cs[0].st.scores.map((r) => r.games).join(','), ')');
  process.exit(0);
});
