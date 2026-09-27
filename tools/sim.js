'use strict';
/**
 * Simulador: joga N partidas com bots, confere as regras a cada jogada
 * e mostra estatísticas. Uso: node tools/sim.js [partidas=500] [jogadores=20] [descer|notiro]
 */
const { Game, PHASE, GameError } = require('../engine');
const { chooseSticks, chooseGuess, PERSONA_NAMES, BOT_NAMES } = require('../bots');

const GAMES = parseInt(process.argv[2] || '500', 10);
const PLAYERS = parseInt(process.argv[3] || '20', 10);
const MODE = process.argv[4] === 'notiro' ? 'notiro' : 'descer';

function assert(cond, msg) {
  if (!cond) throw new Error('INVARIANTE QUEBRADA: ' + msg);
}

function playGame(seed) {
  // rng determinístico (mulberry32) para reproduzir bugs
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = new Game({ rng, mode: MODE });
  for (let i = 0; i < PLAYERS; i++) {
    g.sit(i, { id: 'b' + i, name: BOT_NAMES[i % BOT_NAMES.length], bot: true, persona: PERSONA_NAMES[Math.floor(rng() * PERSONA_NAMES.length)] });
  }
  g.start();

  const stat = { rounds: 0, hits: 0, ferrados: 0, lonasR1Blocked: 0, lonasLater: 0, posHit: [], posN: [] };
  let safety = 0;
  while (g.phase !== PHASE.OVER) {
    assert(++safety < 20000, 'partida infinita');
    if (g.phase === PHASE.CHOOSING) {
      // LONA na rodada 1 tem que ser rejeitada para todos
      if (g.round === 1) {
        for (const s of g.order) {
          let rejected = false;
          try { g.choose(s, 0); } catch (e) { rejected = e instanceof GameError && e.code === 'LONA'; }
          assert(rejected, 'LONA aceita na rodada 1 (assento ' + s + ')');
          stat.lonasR1Blocked++;
        }
      }
      for (const s of g.order) g.choose(s, chooseSticks(g, s, g.seats[s].persona));
      assert(g.phase === PHASE.GUESSING, 'não passou para palpites');
    }
    if (g.phase === PHASE.GUESSING) {
      const seen = new Set();
      while (g.phase === PHASE.GUESSING) {
        const s = g.currentGuesser();
        const v = chooseGuess(g, s, g.seats[s].persona);
        assert(v !== null, 'sem palpite legal para o assento ' + s);
        assert(!seen.has(v), 'palpite repetido ' + v);
        // palpite repetido deve ser recusado
        if (seen.size) {
          let rejected = false;
          try { g.guess(s, [...seen][0]); } catch (e) { rejected = e.code === 'REPETIDO'; }
          assert(rejected, 'repetido aceito');
        }
        seen.add(v);
        const pos = g.turn;
        const rec = g.guess(s, v);
        stat.posN[pos] = (stat.posN[pos] || 0) + 1;
        if (rec) {
          const sum = Object.values(rec.choices).reduce((x, y) => x + y, 0);
          assert(sum === rec.total, 'soma errada');
          const winners = rec.guesses.filter((x) => x.value === rec.total);
          assert(winners.length <= 1, 'mais de um acerto na rodada');
          assert((winners.length === 1) === (rec.hitSeat !== null), 'acerto inconsistente');
          if (rec.round === 1) assert(Object.values(rec.choices).every((n) => n >= 1), 'LONA na rodada 1');
          else stat.lonasLater += rec.lonas.length;
          if (rec.hitSeat !== null) {
            stat.hits++;
            if (rec.ferrado) stat.ferrados++;
            const gi = rec.guesses.findIndex((x) => x.seat === rec.hitSeat);
            stat.posHit[gi] = (stat.posHit[gi] || 0) + 1;
          }
          stat.rounds++;
        }
      }
    }
    if (g.phase === PHASE.REVEAL) g.nextRound();
  }

  // ---- invariantes do modelo unificado (descer e notiro têm a mesma forma) ----
  assert(g.loserSeat !== null, 'ninguém perdeu');
  const active = g.seats.filter(Boolean);
  const outs = active.filter((p) => p.out).length;
  assert(outs === PLAYERS - 1, 'saíram ' + outs + ' de ' + PLAYERS + ' (só o perdedor deveria continuar dentro)');
  assert(!g.seats[g.loserSeat].out, 'o perdedor não pode estar marcado como salvo');
  assert(g.exitOrder.length === PLAYERS - 1 && new Set(g.exitOrder).size === PLAYERS - 1, 'ordem de saída inconsistente');
  assert(!g.exitOrder.includes(g.loserSeat), 'perdedor apareceu na ordem de saída');
  if (MODE === 'notiro') {
    assert(active.every((p) => p.sticks === g.startSticks), 'no tiro não deveria mexer nos palitos');
  } else {
    assert(active.filter((p) => p.out).every((p) => p.sticks === 0), 'descer: quem saiu deveria estar com 0 palitos');
    assert(g.seats[g.loserSeat].sticks > 0, 'descer: o perdedor deveria ainda ter algum palito');
  }
  stat.loserPersona = g.seats[g.loserSeat].persona;

  const sm = g.summary();
  assert(sm.filter((x) => x.result === 'loss').length === 1, 'devia haver exatamente 1 perdedor');
  assert(sm.filter((x) => x.result === 'safe').length === PLAYERS - 1, 'todo o resto devia estar safo');
  const totalLosses = sm.reduce((a, x) => a + x.roundLosses, 0);
  const totalHits = sm.reduce((a, x) => a + x.hits, 0);
  assert(totalHits === stat.hits, 'acertos do resumo batendo com a simulação');
  assert(totalLosses === sm.reduce((a, x) => a + x.rounds, 0) - totalHits, 'perdas de rodada inconsistentes');
  stat.personas = active.map((p) => p.persona);
  return stat;
}

const t0 = Date.now();
const agg = { rounds: [], hits: 0, ferrados: 0, allRounds: 0, lonasR1: 0, lonasLater: 0, posHit: [], posN: [], lose: {}, seen: {} };
for (let i = 0; i < GAMES; i++) {
  const s = playGame(1000 + i);
  agg.rounds.push(s.rounds);
  agg.hits += s.hits;
  agg.ferrados += s.ferrados;
  agg.allRounds += s.rounds;
  agg.lonasR1 += s.lonasR1Blocked;
  agg.lonasLater += s.lonasLater;
  s.posHit.forEach((v, k) => (agg.posHit[k] = (agg.posHit[k] || 0) + v));
  s.posN.forEach((v, k) => (agg.posN[k] = (agg.posN[k] || 0) + v));
  agg.lose[s.loserPersona] = (agg.lose[s.loserPersona] || 0) + 1;
  for (const p of s.personas) agg.seen[p] = (agg.seen[p] || 0) + 1;
}
agg.rounds.sort((a, b) => a - b);
const q = (p) => agg.rounds[Math.min(agg.rounds.length - 1, Math.floor(agg.rounds.length * p))];
const avg = agg.rounds.reduce((a, b) => a + b, 0) / agg.rounds.length;

console.log(`\n[${MODE}] ${GAMES} partidas com ${PLAYERS} jogadores em ${Date.now() - t0} ms. Todas as invariantes passaram.\n`);
console.log(`Rodadas por partida: média ${avg.toFixed(1)} | mediana ${q(0.5)} | p10 ${q(0.1)} | p90 ${q(0.9)} | máx ${agg.rounds[agg.rounds.length - 1]}`);
console.log(`Rodadas com alguém acertando a soma: ${((agg.hits / agg.allRounds) * 100).toFixed(1)}% (cantaram ferrado em ${((agg.ferrados / agg.allRounds) * 100).toFixed(1)}% das rodadas)`);
console.log(`LONA rejeitada na rodada 1: ${agg.lonasR1} tentativas (100% barradas). LONAs depois da rodada 1: ${agg.lonasLater}`);
console.log('\nTaxa de acerto por ordem de palpite (1º a palpitar ... último):');
console.log(agg.posN.map((n, k) => `${String(k + 1).padStart(2)}º ${(((agg.posHit[k] || 0) / n) * 100).toFixed(1)}%`).join('  '));
console.log('\nQuem PERDEU a partida (sobrou por último) por personalidade (esperado = proporção de cadeiras):');
const seatsTotal = Object.values(agg.seen).reduce((a, b) => a + b, 0);
for (const name of PERSONA_NAMES) {
  const share = agg.seen[name] / seatsTotal;
  const loses = agg.lose[name] || 0;
  console.log(`${name.padEnd(11)} perdeu ${String(loses).padStart(4)} (${((loses / GAMES) * 100).toFixed(1)}%)  esperado ${(share * 100).toFixed(1)}%`);
}
