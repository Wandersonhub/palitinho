'use strict';
/**
 * Teste ponta a ponta pelo WebSocket: 3 humanos + bots até 20 lugares.
 * Confere: LONA barrada na rodada 1, palpite repetido barrado, nenhuma mão
 * fechada vaza para outros jogadores, e a partida termina com um vencedor.
 */
process.env.PORT = '0';
process.env.FAST = '1';
const WebSocket = require('ws');
const { server } = require('../server');

const fail = (m) => { console.error('FALHOU:', m); process.exit(1); };
const ok = (m) => console.log('ok  ' + m);

server.on('listening', () => {
  const port = server.address().port;
  const url = `ws://localhost:${port}`;

  const mk = (name) =>
    new Promise((res) => {
      const ws = new WebSocket(url);
      const c = { ws, name, state: null, errors: [], token: null, leaks: 0, sawLonaBlock: false, sawRepeatBlock: false, lonaTried: false, repTried: false };
      ws.on('open', () => res(c));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.t === 'welcome') c.token = m.token;
        if (m.t === 'error') c.errors.push(m);
        if (m.t === 'state') { c.state = m; check(c, m); react(c, m); }
      });
    });

  function check(c, m) {
    const s = m.s;
    if (s.phase === 'choosing' || s.phase === 'guessing') {
      // só a própria mão pode aparecer
      s.seats.forEach((p, i) => { if (p && i !== m.mySeat && p.choice !== null) c.leaks++; });
      if (s.record) c.leaks++;
    }
  }

  function react(c, m) {
    const s = m.s;
    if (m.mySeat === null) return;
    if (s.phase === 'choosing' && s.myChoices.length) {
      if (s.round === 1 && !c.lonaTried) { c.lonaTried = true; c.ws.send(JSON.stringify({ t: 'choose', n: 0 })); }
      c.ws.send(JSON.stringify({ t: 'choose', n: s.myChoices[s.myChoices.length - 1] }));
    }
    if (s.phase === 'guessing' && s.myGuesses.length) {
      if (s.taken.length && !c.repTried) { c.repTried = true; c.ws.send(JSON.stringify({ t: 'guess', v: s.taken[0] })); }
      c.ws.send(JSON.stringify({ t: 'guess', v: s.myGuesses[Math.floor(s.myGuesses.length / 2)] }));
    }
  }

  (async () => {
    const [a, b, d] = await Promise.all([mk('Ana'), mk('Beto'), mk('Dani')]);
    // "notiro" pra rodar rápido com 20 jogadores (1 acerto já salva); "descer" já
    // é testado à parte, com menos gente, em tools/humans.js e tools/sim.js.
    a.ws.send(JSON.stringify({ t: 'join', create: true, name: 'Ana', sticks: 2, mode: 'notiro' }));
    await wait(200);
    const code = a.state.room;
    b.ws.send(JSON.stringify({ t: 'join', room: code, name: 'Beto' }));
    d.ws.send(JSON.stringify({ t: 'join', room: code, name: 'Dani' }));
    await wait(200);
    for (const c of [a, b, d]) c.ws.send(JSON.stringify({ t: 'sit', name: c.name }));
    await wait(200);
    a.ws.send(JSON.stringify({ t: 'fillBots', count: 20 }));
    await wait(200);
    if (a.state.s.seats.filter(Boolean).length !== 20) fail('mesa não ficou com 20 jogadores');
    ok('mesa com 20 jogadores (3 humanos + 17 bots)');

    b.ws.send(JSON.stringify({ t: 'start' })); // não-dono
    await wait(150);
    if (!b.errors.some((e) => e.code === 'HOST')) fail('não-dono conseguiu iniciar');
    ok('só o dono da mesa inicia');

    a.ws.send(JSON.stringify({ t: 'start' }));
    const t0 = Date.now();
    while (a.state.s.phase !== 'over') {
      if (Date.now() - t0 > 240000) fail('partida não terminou a tempo (fase ' + a.state.s.phase + ')');
      await wait(200);
    }
    const s = a.state.s;
    ok(`partida terminou na rodada ${s.round}, perdeu: ${s.seats[s.loserSeat].name}`);

    for (const c of [a, b, d]) {
      if (c.leaks) fail(`${c.name} viu mão fechada de outro jogador (${c.leaks}x)`);
    }
    ok('nenhuma mão fechada vazou antes da revelação');
    if (!a.errors.some((e) => e.code === 'LONA')) fail('LONA não foi barrada na rodada 1');
    ok('LONA barrada na 1ª rodada pelo servidor');
    if (!(a.errors.concat(b.errors, d.errors)).some((e) => e.code === 'REPETIDO' || e.code === 'VEZ')) fail('palpite repetido/fora de vez não foi barrado');
    ok('palpite repetido ou fora de vez barrado');

    const first = s.history[0];
    if (!Object.values(first.choices).every((n) => n >= 1)) fail('rodada 1 com LONA no histórico');
    ok('histórico confirma: rodada 1 sem nenhuma LONA');

    // demo
    const v = await mk('Vera');
    v.ws.send(JSON.stringify({ t: 'join', demo: true, name: 'Vera' }));
    await wait(5000);
    const ds = v.state.s;
    if (ds.seats.filter(Boolean).length !== 20 || ds.phase === 'lobby') fail('demo não iniciou (fase ' + ds.phase + ')');
    ok('sala demo com 20 bots iniciou sozinha (fase: ' + ds.phase + ', rodada ' + ds.round + ')');
    console.log('\nTudo certo.');
    process.exit(0);
  })().catch((e) => fail(e.stack || e));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
