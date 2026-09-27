'use strict';
/**
 * Motor do Jogo do Palitinho (Purrinha).
 * Puro, sem rede e sem timers: o servidor (ou o simulador) chama os métodos
 * e o motor garante as regras. Tudo que é segredo (mãos fechadas) fica aqui
 * dentro; o cliente só recebe o que view(seat) libera.
 *
 * Regras implementadas
 *  - Até 20 lugares. Cada jogador começa com N palitos na mão (2 ou 3).
 *  - Toda rodada: todos escolhem em segredo quantos palitos levam na mão
 *    (0..palitos que ainda tem). 0 = "LONA" (mão vazia).
 *  - RODADA 1: LONA é proibida para todos.
 *  - Em sentido anti-horário, cada um dá um palpite da soma total. Palpite
 *    repetido na mesma rodada é proibido. Quem abre os palpites gira a
 *    cada rodada (evita vantagem de posição).
 *  - Abrem as mãos. No máximo um jogador acerta a soma por rodada.
 *
 *  Os dois estilos são a MESMA estrutura — jogar até sobrar um só, que
 *  é quem perde — mudando apenas quantos acertos livram um jogador:
 *   - "descer": quem acerta desce 1 palito da mão; ao chegar a 0, está
 *     safo e sai da roda. Os que ainda têm palito continuam jogando.
 *   - "notiro": quem acerta já sai da roda na hora (1 acerto = safo).
 *  Em ambos, o jogo continua até sobrar um único jogador na roda: esse
 *  é quem perde a partida (não há "campeão" — o resto só se salvou).
 */

const PHASE = Object.freeze({
  LOBBY: 'lobby',
  CHOOSING: 'choosing',
  GUESSING: 'guessing',
  REVEAL: 'reveal',
  OVER: 'over',
});

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

class Game {
  constructor(opts = {}) {
    this.maxSeats = opts.maxSeats || 20;
    this.startSticks = clamp(opts.startSticks || 3, 2, 3);
    this.mode = opts.mode === 'notiro' ? 'notiro' : 'descer'; // 'descer' = descer palito | 'notiro' = no tiro
    this.gameId = 0;
    this.rng = opts.rng || Math.random;
    this.seats = new Array(this.maxSeats).fill(null);
    this._resetState();
  }

  _resetState() {
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.choices = {}; // seat -> n (segredo até o REVEAL)
    this.guesses = []; // [{seat, value}] na ordem em que foram dados
    this.order = []; // assentos na roda, na ordem de palpite da rodada
    this.turn = 0; // índice em order
    this.starterSeat = null;
    this.startCount = 0; // quantos jogadores começaram a partida (p/ "mesa cheia")
    this.history = [];
    this.lastRecord = null;
    this.loserSeat = null; // quem sobrou por último: perdeu a partida
    this.exitOrder = []; // assentos na ordem em que se salvaram
    this.stamp = 0; // muda a cada transição (o servidor usa p/ agendar timers)
  }

  /** Estilo e palitos só mudam antes de começar. */
  config({ mode, startSticks }) {
    if (this.phase !== PHASE.LOBBY) throw new GameError('EM_JOGO', 'Só dá para mudar o estilo antes de começar.');
    if (mode === 'descer' || mode === 'notiro') this.mode = mode;
    if (startSticks !== undefined) this.startSticks = clamp(parseInt(startSticks, 10) || 3, 2, 3);
    for (const p of this.seats) if (p) p.sticks = this.startSticks;
  }

  // ---------- assentos ----------
  playerCount() {
    return this.seats.filter(Boolean).length;
  }
  activeSeats() {
    const out = [];
    for (let i = 0; i < this.maxSeats; i++) if (this.seats[i]) out.push(i);
    return out;
  }
  /** Quem ainda está na roda (não se salvou ainda). */
  playingSeats() {
    return this.activeSeats().filter((i) => !this.seats[i].out);
  }
  sit(seat, info) {
    if (this.phase !== PHASE.LOBBY) throw new GameError('EM_JOGO', 'A partida já começou. Aguarde a próxima.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.maxSeats) throw new GameError('ASSENTO', 'Assento inválido.');
    if (this.seats[seat]) throw new GameError('OCUPADO', 'Esse lugar já está ocupado.');
    this.seats[seat] = {
      id: info.id,
      name: info.name,
      bot: !!info.bot,
      persona: info.persona || null,
      auto: false,
      connected: info.connected !== false,
      timeouts: 0,
      sticks: this.startSticks,
      out: false, // já se salvou e saiu da roda
      outAt: null,
    };
    return this.seats[seat];
  }
  freeSeat(prefer) {
    if (Number.isInteger(prefer) && prefer >= 0 && prefer < this.maxSeats && !this.seats[prefer]) return prefer;
    // menor assento livre: a mesa é sempre compacta (só existe lugar para quem entrou)
    for (let i = 0; i < this.maxSeats; i++) if (!this.seats[i]) return i;
    return -1;
  }
  /** Sai da mesa. No lobby libera o lugar; em jogo um bot assume a mão. */
  stand(seat) {
    const p = this.seats[seat];
    if (!p) return;
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.OVER) {
      this.seats[seat] = null;
      if (this.phase === PHASE.OVER && this.playerCount() < 2) this.reset();
      return;
    }
    p.bot = true;
    p.persona = p.persona || 'Novato';
    p.connected = true;
  }

  // ---------- fluxo ----------
  start() {
    if (this.phase !== PHASE.LOBBY) throw new GameError('EM_JOGO', 'A partida já começou.');
    if (this.playerCount() < 2) throw new GameError('POUCOS', 'São necessários pelo menos 2 jogadores.');
    for (const p of this.seats) if (p) { p.sticks = this.startSticks; p.auto = false; p.timeouts = 0; p.out = false; p.outAt = null; }
    this.gameId++;
    this.round = 0;
    this.history = [];
    this.exitOrder = [];
    this.loserSeat = null;
    this.lastRecord = null;
    this.startCount = this.playerCount();
    const act = this.activeSeats();
    this.starterSeat = act[Math.floor(this.rng() * act.length)];
    this._beginRound(true);
  }

  reset() {
    const seats = this.seats;
    this._resetState();
    this.seats = seats;
    for (const p of this.seats) if (p) { p.sticks = this.startSticks; p.auto = false; p.timeouts = 0; p.out = false; p.outAt = null; }
  }

  _beginRound(first) {
    this.round++;
    const act = this.playingSeats();
    if (!first) {
      // próximo assento ainda na roda antes do anterior (anti-horário)
      let s = this.starterSeat;
      do { s = (s - 1 + this.maxSeats) % this.maxSeats; } while (!this.seats[s] || this.seats[s].out);
      this.starterSeat = s;
    }
    if (!act.includes(this.starterSeat)) this.starterSeat = act[0];
    // a roda de palpites anda em sentido anti-horário: começa no starterSeat
    // e segue para trás na lista de assentos (maior → menor, com volta).
    const startIdx = act.indexOf(this.starterSeat);
    this.order = act.slice(0, startIdx + 1).reverse().concat(act.slice(startIdx + 1).reverse());
    this.choices = {};
    this.guesses = [];
    this.turn = 0;
    this.phase = PHASE.CHOOSING;
    this.stamp++;
  }

  /** Chamado depois do REVEAL para iniciar a rodada seguinte. */
  nextRound() {
    if (this.phase !== PHASE.REVEAL) throw new GameError('FASE', 'Não é hora de próxima rodada.');
    this._beginRound(false);
  }

  // ---------- escolha de palitos ----------
  /** Menor quantidade permitida: na rodada 1 LONA é proibida. */
  minPick() {
    return this.round === 1 ? 1 : 0;
  }
  legalChoices(seat) {
    const p = this.seats[seat];
    if (!p || p.out || this.phase !== PHASE.CHOOSING || this.choices[seat] !== undefined) return [];
    const out = [];
    for (let n = this.minPick(); n <= p.sticks; n++) out.push(n);
    return out;
  }
  pendingChoosers() {
    if (this.phase !== PHASE.CHOOSING) return [];
    return this.order.filter((s) => this.choices[s] === undefined);
  }
  choose(seat, n) {
    if (this.phase !== PHASE.CHOOSING) throw new GameError('FASE', 'Agora não é hora de escolher os palitos.');
    const p = this.seats[seat];
    if (!p) throw new GameError('ASSENTO', 'Você não está sentado.');
    if (p.out) throw new GameError('SALVO', 'Você já se salvou e saiu da roda.');
    if (this.choices[seat] !== undefined) throw new GameError('JA_ESCOLHEU', 'Você já escolheu.');
    if (!Number.isInteger(n) || n < 0 || n > p.sticks) throw new GameError('VALOR', `Escolha entre 0 e ${p.sticks} palitos.`);
    if (n < this.minPick()) throw new GameError('LONA', 'LONA proibida! Na 1ª rodada todo mundo vai com pelo menos 1 palito.');
    this.choices[seat] = n;
    if (this.pendingChoosers().length === 0) {
      this.phase = PHASE.GUESSING;
      this.turn = 0;
      this.stamp++;
    }
  }

  // ---------- palpites ----------
  bounds() {
    const mp = this.minPick();
    let min = 0, max = 0;
    for (const s of this.order) { min += mp; max += this.seats[s].sticks; }
    return { min, max };
  }
  currentGuesser() {
    return this.phase === PHASE.GUESSING ? this.order[this.turn] : null;
  }
  takenGuesses() {
    return this.guesses.map((g) => g.value);
  }
  legalGuesses() {
    if (this.phase !== PHASE.GUESSING) return [];
    const { min, max } = this.bounds();
    const taken = new Set(this.takenGuesses());
    const out = [];
    for (let v = min; v <= max; v++) if (!taken.has(v)) out.push(v);
    return out;
  }
  guess(seat, value) {
    if (this.phase !== PHASE.GUESSING) throw new GameError('FASE', 'Agora não é hora de palpitar.');
    if (this.currentGuesser() !== seat) throw new GameError('VEZ', 'Não é a sua vez de palpitar.');
    if (!Number.isInteger(value)) throw new GameError('VALOR', 'Palpite inválido.');
    const { min, max } = this.bounds();
    if (value < min || value > max) throw new GameError('FAIXA', `A soma só pode ficar entre ${min} e ${max}.`);
    if (this.takenGuesses().includes(value)) throw new GameError('REPETIDO', 'Esse palpite já foi dado. Escolha outro número.');
    this.guesses.push({ seat, value });
    this.turn++;
    this.stamp++;
    if (this.turn >= this.order.length) return this._resolve();
    return null;
  }

  _resolve() {
    let total = 0;
    for (const s of this.order) total += this.choices[s];
    const hit = this.guesses.find((g) => g.value === total);
    // "Cantou ferrado": acertou de cara, no 1º palpite da rodada, com a mesa
    // ainda cheia (ninguém saiu ainda). É só para o ego — não afeta nada.
    const ferrado = !!(hit && this.guesses[0] && this.guesses[0].seat === hit.seat && this.order.length === this.startCount);
    const rec = {
      round: this.round,
      starterSeat: this.order[0],
      choices: { ...this.choices },
      guesses: this.guesses.map((g) => ({ ...g })),
      total,
      hitSeat: hit ? hit.seat : null,
      ferrado,
      exited: null, // preenchido se alguém se salvar e sair da roda nesta rodada
      lonas: this.order.filter((s) => this.choices[s] === 0),
      finished: false,
    };
    if (hit) {
      const p = this.seats[hit.seat];
      if (this.mode === 'notiro') {
        p.out = true; // 1 acerto já salva
      } else {
        p.sticks--; // descer: precisa zerar os palitos pra se salvar
        if (p.sticks <= 0) p.out = true;
      }
      if (p.out) {
        p.outAt = this.round;
        this.exitOrder.push(hit.seat);
        rec.exited = hit.seat;
        const left = this.playingSeats();
        if (left.length <= 1) {
          rec.finished = true;
          this.loserSeat = left.length ? left[0] : null;
        }
      }
    }
    this.history.push(rec);
    this.lastRecord = rec;
    this.phase = rec.finished ? PHASE.OVER : PHASE.REVEAL;
    this.stamp++;
    return rec;
  }

  /** Resultado da partida por jogador (para o placar). Só faz sentido em OVER. */
  summary() {
    const seats = this.activeSeats();
    const st = {};
    for (const s of seats) st[s] = { hits: 0, rounds: 0, roundLosses: 0, ferrado: 0 };
    for (const r of this.history) {
      for (const s of Object.keys(r.choices).map(Number)) {
        st[s].rounds++;
        if (r.hitSeat === s) { st[s].hits++; if (r.ferrado) st[s].ferrado++; }
        else st[s].roundLosses++;
      }
    }
    return seats.map((i) => {
      const p = this.seats[i];
      return {
        seat: i,
        id: p.id,
        name: p.name,
        bot: p.bot,
        hits: st[i].hits,
        rounds: st[i].rounds,
        roundLosses: st[i].roundLosses,
        ferrado: st[i].ferrado,
        outPos: p.out ? this.exitOrder.indexOf(i) + 1 : null,
        result: i === this.loserSeat ? 'loss' : 'safe', // só existe 1 'loss' por partida
      };
    });
  }

  // ---------- visão pública (nunca vaza mão fechada) ----------
  view(forSeat) {
    const reveal = this.phase === PHASE.REVEAL || this.phase === PHASE.OVER;
    const gmap = {};
    for (const g of this.guesses) gmap[g.seat] = g.value;
    const me = Number.isInteger(forSeat) ? forSeat : null;
    const myTurn = me !== null && this.currentGuesser() === me;
    return {
      phase: this.phase,
      mode: this.mode,
      round: this.round,
      startSticks: this.startSticks,
      maxSeats: this.maxSeats,
      starterSeat: this.phase === PHASE.LOBBY ? null : this.order[0] ?? null,
      turnSeat: this.currentGuesser(),
      order: this.order.slice(),
      bounds: this.phase === PHASE.CHOOSING || this.phase === PHASE.GUESSING ? this.bounds() : null,
      minPick: this.minPick(),
      seats: this.seats.map((p, i) =>
        p
          ? {
              seat: i,
              name: p.name,
              bot: p.bot,
              auto: p.auto,
              connected: p.connected,
              sticks: p.sticks,
              out: p.out,
              outPos: p.out ? this.exitOrder.indexOf(i) + 1 : null,
              chosen: this.choices[i] !== undefined,
              choice: reveal || i === me ? this.choices[i] ?? null : null,
              guess: gmap[i] ?? null,
            }
          : null
      ),
      taken: this.takenGuesses(),
      myChoices: me !== null ? this.legalChoices(me) : [],
      myGuesses: myTurn ? this.legalGuesses() : [],
      record: reveal ? this.lastRecord : null,
      loserSeat: this.loserSeat,
      playing: this.phase === PHASE.LOBBY ? this.playerCount() : this.playingSeats().length,
      history: this.history.slice(-40).map((r) => ({
        round: r.round,
        total: r.total,
        hitSeat: r.hitSeat,
        exited: r.exited,
        ferrado: r.ferrado,
        finished: r.finished,
        lonas: r.lonas,
        choices: r.choices,
        guesses: r.guesses,
      })),
    };
  }
}

module.exports = { Game, GameError, PHASE };
