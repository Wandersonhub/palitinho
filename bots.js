'use strict';
/**
 * Bots do Palitinho. Usam só informação pública + a própria mão.
 * Estratégia de palpite: distribuição de probabilidade da soma
 * (convolução das mãos dos outros, cada um uniforme entre o que pode levar),
 * somada à própria mão; escolhe o número mais provável ainda livre.
 * A "leitura" tenta adivinhar a mão de quem já palpitou a partir do palpite dele.
 */

const PERSONAS = {
  Calculista: { bluff: 0.05, reader: 0.35, style: 'balanced' },
  Cauteloso: { bluff: 0.1, reader: 0.2, style: 'tight' },
  Blefador: { bluff: 0.35, reader: 0.1, style: 'wild' },
  Louco: { bluff: 0.6, reader: 0, style: 'lona' },
  Novato: { bluff: 0.25, reader: 0, style: 'random' },
};
const PERSONA_NAMES = Object.keys(PERSONAS);

const BOT_NAMES = [
  'Zé Palito', 'Dona Cida', 'Tio Beto', 'Maria', 'Seu Nado', 'Carlão', 'Bia', 'Juninho', 'Tia Nena', 'Dudu',
  'Gaúcho', 'Lu', 'Cabo Silva', 'Vó Nair', 'Rafa', 'Tita', 'Mestre Gil', 'Nanda', 'Pedrão', 'Kátia',
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------- escolha dos palitos ----------
function chooseSticks(game, seat, personaName = 'Novato') {
  const persona = PERSONAS[personaName] || PERSONAS.Novato;
  const opts = game.legalChoices(seat);
  if (!opts.length) return null;
  const s = game.seats[seat].sticks;
  const mid = s / 2 || 1;
  const w = opts.map((n) => {
    switch (persona.style) {
      case 'tight': return 1 + 1.5 * (1 - Math.abs(n - mid) / mid);
      case 'wild': return 1 + 1.5 * (Math.abs(n - mid) / mid);
      case 'lona': return n === 0 ? 3 : 1;
      default: return 1;
    }
  });
  return weightedPick(game.rng, opts, w);
}

// ---------- distribuição da soma ----------
function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

function uniform(min, max) {
  const d = new Array(max + 1).fill(0);
  for (let n = min; n <= max; n++) d[n] = 1 / (max - min + 1);
  return d;
}

/** Retorna array p[v] = prob. de a soma total ser v, dado o que o `seat` sabe. */
function sumDistribution(game, seat, readerWeight = 0) {
  const mp = game.minPick();
  const others = game.order.filter((s) => s !== seat);
  const meanOf = (s) => (mp + game.seats[s].sticks) / 2;
  const totalMean = others.reduce((a, s) => a + meanOf(s), 0);

  // estimativa da mão de quem já palpitou (leitura)
  const est = {};
  if (readerWeight > 0) {
    for (const g of game.guesses) {
      if (g.seat === seat) continue;
      const s = game.seats[g.seat].sticks;
      const othersMean = totalMean - meanOf(g.seat) + (game.choices[seat] ?? meanOf(seat));
      est[g.seat] = Math.max(mp, Math.min(s, Math.round(g.value - othersMean)));
    }
  }

  let dist = [1];
  for (const o of others) {
    const s = game.seats[o].sticks;
    const d = uniform(mp, s);
    if (est[o] !== undefined) {
      for (let n = 0; n < d.length; n++) d[n] *= 1 - readerWeight;
      d[est[o]] += readerWeight;
    }
    dist = convolve(dist, d);
  }
  const mine = game.choices[seat] ?? 0;
  const shifted = new Array(dist.length + mine).fill(0);
  for (let i = 0; i < dist.length; i++) shifted[i + mine] = dist[i];
  return shifted;
}

// ---------- palpite ----------
function chooseGuess(game, seat, personaName = 'Novato') {
  const persona = PERSONAS[personaName] || PERSONAS.Novato;
  const legal = game.legalGuesses();
  if (!legal.length) return null;
  const dist = sumDistribution(game, seat, persona.reader);
  const ranked = legal
    .map((v) => ({ v, p: dist[v] || 0 }))
    .sort((a, b) => b.p - a.p || Math.abs(a.v - 30) - Math.abs(b.v - 30));
  if (game.rng() < persona.bluff) {
    // blefe: escolhe entre os 4 melhores, meio aleatório
    const top = ranked.slice(0, Math.min(4, ranked.length));
    return pick(game.rng, top).v;
  }
  return ranked[0].v;
}

/** Probabilidades para exibir de dica ao jogador humano: { [valor]: p } */
function hintFor(game, seat) {
  const dist = sumDistribution(game, seat, 0);
  const out = {};
  for (const v of game.legalGuesses()) out[v] = Math.round((dist[v] || 0) * 1000) / 1000;
  return out;
}

function randomPersona(rng = Math.random) {
  return pick(rng, PERSONA_NAMES);
}

module.exports = { PERSONAS, PERSONA_NAMES, BOT_NAMES, chooseSticks, chooseGuess, hintFor, randomPersona, sumDistribution };
