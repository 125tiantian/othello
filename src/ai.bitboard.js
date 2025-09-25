// Bitboard-based Othello AI with parallel-friendly features
import { SIZE, BLACK, WHITE, EMPTY } from './othello.js';

// Bit mapping: bit i = row*8 + col, row 0=top, col 0=left. LSB = A1? Here index 0 = (0,0).
const FULL = 0xFFFFFFFFFFFFFFFFn;
const A_FILE = 0x0101010101010101n;
const H_FILE = 0x8080808080808080n;
const NOT_A = FULL ^ A_FILE;
const NOT_H = FULL ^ H_FILE;

const RANK1 = 0x00000000000000FFn;
const RANK8 = 0xFF00000000000000n;
const NOT_RANK1 = FULL ^ RANK1;
const NOT_RANK8 = FULL ^ RANK8;

const CORNER_MASK = 0x8100000000000081n; // (0,0),(0,7),(7,0),(7,7)

function bit(row, col) { return 1n << BigInt(row * 8 + col); }

function popcnt(x) {
  // Kernighan's algorithm for 64-bit BigInt
  let c = 0;
  while (x) { x &= x - 1n; c++; }
  return c;
}

function shiftE(bb) { return (bb & NOT_H) << 1n; }
function shiftW(bb) { return (bb & NOT_A) >> 1n; }
function shiftN(bb) { return bb >> 8n; }
function shiftS(bb) { return (bb & NOT_RANK8) << 8n; }
function shiftNE(bb) { return (bb & NOT_H) >> 7n; }
function shiftNW(bb) { return (bb & NOT_A) >> 9n; }
function shiftSE(bb) { return (bb & NOT_A) << 9n; }
function shiftSW(bb) { return (bb & NOT_H) << 7n; }

const DIRS = [shiftE, shiftW, shiftN, shiftS, shiftNE, shiftNW, shiftSE, shiftSW];

function legalMovesBB(P, O) {
  const empty = ~(P | O) & FULL;
  let moves = 0n;
  for (const shift of DIRS) {
    let t = shift(P) & O;
    t |= shift(t) & O;
    t |= shift(t) & O;
    t |= shift(t) & O;
    t |= shift(t) & O;
    t |= shift(t) & O;
    moves |= shift(t) & empty;
  }
  return moves;
}

function flipsForMoveBB(P, O, moveBit) {
  let flips = 0n;
  for (const shift of DIRS) {
    let x = 0n;
    let t = shift(moveBit) & O;
    for (let i = 0; i < 6 && t; i++) {
      x |= t;
      t = shift(t) & O;
    }
    if ((shift(x) & P) !== 0n) flips |= x;
  }
  return flips;
}

function flipsForMoveByDirBB(P, O, moveBit) {
  // Return array of 8 BigInt masks of flips per direction in DIRS order
  const res = new Array(8).fill(0n);
  for (let d = 0; d < DIRS.length; d++) {
    const shift = DIRS[d];
    let x = 0n;
    let t = shift(moveBit) & O;
    for (let i = 0; i < 6 && t; i++) {
      x |= t;
      t = shift(t) & O;
    }
    if ((shift(x) & P) !== 0n) res[d] = x; // bracketed, real flips
  }
  return res;
}

function flipCountsByDir(P, O, moveBit) {
  // Returns counts per 8 directions in DIRS order and aggregated axis sums
  const counts = new Int8Array(8);
  for (let d = 0; d < DIRS.length; d++) {
    const shift = DIRS[d];
    let x = 0n;
    let t = shift(moveBit) & O;
    for (let i = 0; i < 6 && t; i++) {
      x |= t;
      t = shift(t) & O;
    }
    if ((shift(x) & P) !== 0n) {
      counts[d] = popcnt(x);
    }
  }
  const vertical = counts[2] + counts[3]; // N + S
  const horizontal = counts[0] + counts[1]; // E + W
  const diag1 = counts[4] + counts[7]; // NE + SW
  const diag2 = counts[5] + counts[6]; // NW + SE
  const total = vertical + horizontal + diag1 + diag2;
  const maxLine = Math.max(vertical, horizontal, diag1, diag2);
  return { counts, vertical, horizontal, diag1, diag2, total, maxLine };
}

function applyMoveBB(P, O, moveBit) {
  const flips = flipsForMoveBB(P, O, moveBit);
  P ^= flips;
  O ^= flips;
  P |= moveBit;
  return { P, O };
}

function coordsToBit(row, col) { return 1n << BigInt(row * 8 + col); }
function bitToCoords(b) { const i = Number(BigInt.asUintN(64, log2BigInt(b))); return [Math.floor(i / 8), i % 8]; }

function log2BigInt(v) {
  // Return index of set bit (assuming single-bit)
  let i = 0n;
  let x = v;
  while (x > 1n) { x >>= 1n; i++; }
  return i;
}

function parityEmpties(P, O) {
  const empties = 64 - popcnt(P | O);
  return (empties & 1) ? 1 : -1;
}

function nb4(bb) { // 4-neighborhood
  return (shiftN(bb) | shiftS(bb) | shiftE(bb) | shiftW(bb)) & FULL;
}

function regionParityScore(empty) {
  // Approximate empty-region parity: count odd-sized 4-neighborhood components
  let remaining = empty & FULL;
  let odd = 0, even = 0;
  while (remaining) {
    let frontier = remaining & -remaining; // lsb as seed
    let comp = 0n;
    while (frontier) {
      comp |= frontier;
      const exp = nb4(frontier) & remaining;
      frontier = exp & ~comp;
    }
    const cnt = popcnt(comp);
    if (cnt & 1) odd++; else even++;
    remaining &= ~comp;
  }
  return odd - even; // favor odd regions
}

function key32(black, white, player) {
  // Simple 32-bit hash fold
  const k = (black ^ (white << 1n) ^ BigInt(player === BLACK ? 0x9e3779b9 : 0x85ebca6b)) & 0xFFFFFFFFn;
  let x = Number(k);
  x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b);
  x ^= x >>> 16;
  return x >>> 0;
}

export class AIEngine {
  constructor() {
    this.tt = new Map(); // fallback TT when SAB not available
    this.shared = null; // { size, keys:Uint32Array, scores:Int32Array, depths:Int8Array, flags:Int8Array, moves:Int8Array }
    this.killers = Array.from({ length: 64 }, () => []); // killer moves per ply (store bit index)
    this.history = new Int32Array(64); // history heuristic by square index
  }

  setSharedTT(shared) {
    // shared: { size, keys, scores, depths, flags, moves }
    this.shared = shared && shared.size && shared.keys ? shared : null;
  }

  // Pack from 2D array board to bitboards
  packBoard(state) {
    let black = 0n, white = 0n;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = state[r][c];
        const m = 1n << BigInt(r * 8 + c);
        if (v === BLACK) black |= m; else if (v === WHITE) white |= m;
      }
    }
    return { black, white };
  }

  // Transposition table operations (shared or local)
  ttProbe(black, white, player, depth, alpha, beta) {
    if (!this.shared) {
      const k = `${black}_${white}_${player}`;
      const e = this.tt.get(k);
      if (!e || e.depth < depth) return null;
      if (e.flag === 0) return e.score;
      if (e.flag < 0) { if (e.score < beta) beta = e.score; }
      else { if (e.score > alpha) alpha = e.score; }
      if (alpha >= beta) return e.score;
      return null;
    }
    const { size, keys, scores, depths, flags } = this.shared;
    const k32 = key32(black, white, player);
    const idx = k32 & (size - 1);
    if (keys[idx] !== k32) return null;
    const d = depths[idx] | 0;
    if (d < depth) return null;
    const f = flags[idx] | 0;
    const s = scores[idx] | 0;
    if (f === 0) return s;
    if (f < 0) { if (s < beta) beta = s; } else { if (s > alpha) alpha = s; }
    if (alpha >= beta) return s;
    return null;
  }

  ttStore(black, white, player, depth, score, flag) {
    if (!this.shared) {
      const k = `${black}_${white}_${player}`;
      const prev = this.tt.get(k);
      if (!prev || prev.depth <= depth) this.tt.set(k, { depth, score, flag });
      return;
    }
    const { size, keys, scores, depths, flags } = this.shared;
    const k32 = key32(black, white, player);
    const idx = k32 & (size - 1);
    if (depths[idx] <= depth) {
      keys[idx] = k32;
      scores[idx] = score | 0;
      depths[idx] = depth | 0;
      flags[idx] = flag | 0;
    }
  }

  // Public API: score a single root move under time/depth budget
  scoreRootMove(state, player, move, opts) {
    const { timeMs = 600, maxDepth = 8 } = opts || {};
    const start = performance.now();
    const deadline = start + timeMs;
    this.tt.clear();
    // reset per-root heuristics
    this.killers.forEach(a => a.length = 0);
    this.history.fill(0);

    const { black, white } = this.packBoard(state);
    const P0 = player === BLACK ? black : white;
    const O0 = player === BLACK ? white : black;
    const moveBit = coordsToBit(move.row, move.col);
    if (((legalMovesBB(P0, O0)) & moveBit) === 0n) return -Infinity; // illegal fallback
    const after = applyMoveBB(P0, O0, moveBit);
    let b1 = player === BLACK ? after.P : after.O;
    let w1 = player === BLACK ? after.O : after.P;
    const meAfter = player === BLACK ? b1 : w1;

    // Tactical pre-analysis for this root move
    const tac = flipCountsByDir(P0, O0, moveBit);
    const flipsByDir = flipsForMoveByDirBB(P0, O0, moveBit);
    const myFlipsMask = flipsForMoveBB(P0, O0, moveBit);
    const vertMask = (flipsByDir[2] | flipsByDir[3]); // N+S
    const horiMask = (flipsByDir[0] | flipsByDir[1]); // E+W
    const diagMask = (flipsByDir[4] | flipsByDir[5] | flipsByDir[6] | flipsByDir[7]);
    const isEdgeMove = (move.row === 0 || move.row === 7 || move.col === 0 || move.col === 7);
    const tacticalBonus = (() => {
      let bonus = 0;
      const emptiesNow = 64 - popcnt(b1 | w1);

      // Reward long directional flips and edge pressure
      if (tac.maxLine >= 6) bonus += 360 + 80 * (tac.maxLine - 6);
      if (tac.vertical >= 6) bonus += 260;
      if (tac.vertical >= 7) bonus += 420;
      if (tac.horizontal >= 6) bonus += 180;
      if (tac.horizontal >= 7) bonus += 280;
      if (isEdgeMove && tac.maxLine >= 5) bonus += 140;
      // Generally value HV over diagonals (safer shape)
      const hvTotal = tac.vertical + tac.horizontal;
      if (emptiesNow <= 16) bonus += hvTotal * 18; else if (emptiesNow <= 32) bonus += hvTotal * 14; else bonus += hvTotal * 10;

      // One-ply net flip heuristic (SEE-like):
      // my immediate flips minus opponent's best immediate reply flips.
      // Encourages "big, safe" captures even in midgame.
      const oppP = (-player === BLACK) ? b1 : w1;
      const oppO = (-player === BLACK) ? w1 : b1;
      const oppMoves = legalMovesBB(oppP, oppO);
      const oppPBefore = (-player === BLACK) ? black : white;
      const oppOBefore = (-player === BLACK) ? white : black;
      const oppMovesBefore = legalMovesBB(oppPBefore, oppOBefore);
      let maxOppFlips = 0;
      let unionOppFlips = 0n;
      let oppCornerAfter = 0n;
      let tmp = oppMoves;
      while (tmp) {
        const m2 = tmp & -tmp; tmp ^= m2;
        if ((m2 & CORNER_MASK) !== 0n) oppCornerAfter |= m2;
        const f2 = flipsForMoveBB(oppP, oppO, m2);
        unionOppFlips |= f2;
        const c2 = popcnt(f2);
        if (c2 > maxOppFlips) maxOppFlips = c2;
      }
      const oppMobCnt = popcnt(oppMoves);
      const net = tac.total - maxOppFlips;
      if (emptiesNow <= 16) bonus += tac.total * 10 + net * 14; // late: emphasize both raw and net
      else if (emptiesNow <= 32) bonus += net * 10; // midgame: prefer high net flips
      else bonus += net * 6; // opening: still consider, but lighter

      // Penalize giving opponent lots of immediate mobility
      if (emptiesNow <= 16) bonus -= oppMobCnt * 18;
      else if (emptiesNow <= 32) bonus -= oppMobCnt * 12;
      else bonus -= oppMobCnt * 6;

      // Strong boost for "flip a lot but hard to be flipped back immediately"
      if (tac.total >= 8 && maxOppFlips <= 2) {
        bonus += 320 + (tac.total - 8) * 44;
      }

      // Penalize only if THIS move newly enables corners
      const oppCornerBefore = oppMovesBefore & CORNER_MASK;
      const cornerNew = popcnt(oppCornerAfter & ~oppCornerBefore);
      if (cornerNew > 0) {
        bonus -= (emptiesNow >= 20 ? 500 : 360) * cornerNew;
      }

      // Reward protected axis flips (cannot be immediately recaptured in 1-ply)
      const edgesMask = RANK1 | RANK8 | A_FILE | H_FILE;
      const hvMask = vertMask | horiMask;
      const safeHV = hvMask & ~unionOppFlips; // ours after move that opp cannot flip back immediately
      const safeDiag = diagMask & ~unionOppFlips;
      const safeEdgeHV = safeHV & edgesMask;
      const cntSafeHV = popcnt(safeHV);
      const cntSafeEdgeHV = popcnt(safeEdgeHV);
      const cntSafeDiag = popcnt(safeDiag);
      // Additional reward for flipping discs located on edges (even if not strictly safe)
      const edgeHV = (hvMask) & edgesMask;
      const cntEdgeHV = popcnt(edgeHV);
      if (emptiesNow <= 16) {
        bonus += cntSafeHV * 50 + cntSafeDiag * 12 + cntSafeEdgeHV * 80 + cntEdgeHV * 18;
      } else if (emptiesNow <= 32) {
        bonus += cntSafeHV * 38 + cntSafeDiag * 8 + cntSafeEdgeHV * 68 + cntEdgeHV * 14;
      } else {
        bonus += cntSafeHV * 30 + cntSafeDiag * 6 + cntSafeEdgeHV * 56 + cntEdgeHV * 12;
      }

      // Full line completion (entire row or column becomes ours)
      const rowMask = 0xFFn << BigInt(move.row * 8);
      const colMask = (A_FILE << BigInt(move.col));
      const fullRow = (meAfter & rowMask) === rowMask;
      const fullCol = (meAfter & colMask) === colMask;
      // Very strong preference for capturing entire column/row
      if (fullCol) bonus += 3800; // entire column captured
      if (fullRow) bonus += 2600; // entire row captured

      // Almost-full column/row (7 of 8 and no gap inside)
      const myAfterBoard = meAfter;
      const colCount = popcnt(myAfterBoard & colMask);
      const rowCount = popcnt(myAfterBoard & rowMask);
      if (!fullCol && colCount === 7) bonus += 900; // very strong preference to complete soon
      if (!fullRow && rowCount === 7) bonus += 650;

      // Edge move that harvests a lot vertically: amplify further
      if (isEdgeMove && tac.vertical >= 5) bonus += 220 + (tac.vertical - 5) * 140;

      // Edge anchored long run (from a corner along row/col)
      const topCorner = bit(0, move.col), bottomCorner = bit(7, move.col);
      const leftCorner = bit(move.row, 0), rightCorner = bit(move.row, 7);
      // contiguous from top corner along column
      if (meAfter & topCorner) {
        let run = 0; let m = topCorner;
        while (m && (meAfter & m)) { run++; m <<= 8n; }
        if (run >= 6) bonus += 200 + 40 * (run - 5);
      }
      if (meAfter & bottomCorner) {
        let run = 0; let m = bottomCorner;
        while (m && (meAfter & m)) { run++; m >>= 8n; }
        if (run >= 6) bonus += 200 + 40 * (run - 5);
      }
      if (meAfter & leftCorner) {
        let run = 0; let m = leftCorner;
        while (m && (meAfter & m)) { run++; m = shiftE(m); }
        if (run >= 6) bonus += 160 + 30 * (run - 5);
      }
      if (meAfter & rightCorner) {
        let run = 0; let m = rightCorner;
        while (m && (meAfter & m)) { run++; m = shiftW(m); }
        if (run >= 6) bonus += 160 + 30 * (run - 5);
      }
      return bonus;
    })();

    // Depth extension for large line flips
    // Extensions: deepen search when tactical volatility is high
    const oppP = (-player === BLACK) ? b1 : w1;
    const oppO = (-player === BLACK) ? w1 : b1;
    const oppMoves = legalMovesBB(oppP, oppO);
    const oppCornerSoon = (oppMoves & CORNER_MASK) !== 0n;
    const ext =
      (tac.maxLine >= 6 ? 1 : 0) +
      // column fully ours after move
      ((meAfter & (A_FILE << BigInt(move.col))) === (A_FILE << BigInt(move.col)) ? 1 : 0) +
      // push search a bit deeper for massive flips
      (tac.total >= 10 ? 1 : 0) +
      // extend if we just played a corner or we might be giving one away next
      (((move.row === 0 || move.row === 7) && (move.col === 0 || move.col === 7)) ? 1 : 0) +
      (oppCornerSoon ? 1 : 0);

    // Iterative deepening with aspiration
    let bestScore = -Infinity;
    let alphaBase = -Infinity, betaBase = Infinity;
    const ASP = 75;
    for (let depth = 2; depth <= maxDepth; depth++) {
      if (performance.now() > deadline) break;
      const empties = 64 - popcnt(b1 | w1);
      let alpha = depth > 2 ? Math.max(-Infinity, bestScore - ASP) : alphaBase;
      let beta = depth > 2 ? Math.min(Infinity, bestScore + ASP) : betaBase;
      let s = -this.search(b1, w1, -player, depth - 1 + ext, -beta, -alpha, deadline, 1);
      if (performance.now() <= deadline && (s <= alpha || s >= beta)) {
        s = -this.search(b1, w1, -player, depth - 1 + ext, -Infinity, Infinity, deadline, 1);
      }
      if (performance.now() > deadline) break;
      bestScore = s;
      // Endgame exact solve if close
      if (empties <= 12) {
        const exact = -this.solveExact(b1, w1, -player, deadline);
        if (performance.now() <= deadline) bestScore = exact * 200; // scale to be decisive
        break;
      }
    }
    return bestScore + tacticalBonus;
  }

  // Principal search (negamax). alpha/beta are in heuristic score domain.
  search(black, white, player, depth, alpha, beta, deadline, ply = 1) {
    if (performance.now() > deadline) return this.evaluate(black, white, player);
    const empties = 64 - popcnt(black | white);
    if (empties === 0) return this.finalScore(black, white, player) * 200;
    if (depth <= 0) return this.evaluate(black, white, player);

    const probe = this.ttProbe(black, white, player, depth, alpha, beta);
    if (probe !== null) return probe;

    const P = player === BLACK ? black : white;
    const O = player === BLACK ? white : black;
    let moves = legalMovesBB(P, O);
    if (!moves) {
      // pass
      const s = -this.search(black, white, -player, depth - 1, -beta, -alpha, deadline, ply + 1);
      this.ttStore(black, white, player, depth, s, 0);
      return s;
    }

    // Heuristic ordering: corners first, then prefer vertical/horizontal heavy flips and edges
    const ordered = [];
    let mset = moves;
    while (mset) {
      const m = mset & -mset; mset ^= m;
      const [row, col] = bitToCoords(m);
      const isCorner = (row === 0 || row === 7) && (col === 0 || col === 7);
      let score = isCorner ? 1000000 : 0;
      if (!isCorner) {
        const dir = flipCountsByDir(P, O, m);
        const isEdge = (row === 0 || row === 7 || col === 0 || col === 7) ? 1 : 0;
        // Prefer vertical (column) flips especially when playing on edges
        score += dir.vertical * 48 + dir.horizontal * 38 + dir.total * 8 + isEdge * 40 + dir.maxLine * 22;
        if (dir.vertical >= 6) score += 400;
        if (dir.vertical >= 7) score += 700;
        if (isEdge && dir.vertical >= 5) score += 260;
      }
      // history + killer bonuses
      const idx = Number(log2BigInt(m));
      score += (this.history[idx] | 0);
      const killers = this.killers[ply] || [];
      if (killers.includes(idx)) score += 1200;
      ordered.push({ m, score });
    }
    ordered.sort((a,b) => b.score - a.score);

    let best = -Infinity;
    let flag = -1; // upper bound until proven
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i].m;
      const child = applyMoveBB(P, O, m);
      const nb = player === BLACK ? child.P : child.O;
      const nw = player === BLACK ? child.O : child.P;
      const [row, col] = bitToCoords(m);
      const isCorner = (row === 0 || row === 7) && (col === 0 || col === 7);
      // Late Move Reductions: reduce depth on late, non-corner, weak flips
      const dir = isCorner ? null : flipCountsByDir(P, O, m);
      const vh = isCorner ? 8 : (dir.vertical + dir.horizontal);
      const allowLMR = depth >= 3 && i >= 3 && !isCorner && vh < 5;
      let reduce = allowLMR ? 1 : 0;

      // Depth extensions: playing a corner or allowing one immediately
      const oppMovesChild = legalMovesBB(player === BLACK ? nw : nb, player === BLACK ? nb : nw);
      const oppCornerSoon = (oppMovesChild & CORNER_MASK) !== 0n;
      let ext = 0;
      if (isCorner) ext++;
      if (oppCornerSoon) ext++;
      let score;
      if (i === 0) {
        score = -this.search(nb, nw, -player, depth - 1 + ext, -beta, -alpha, deadline, ply + 1);
      } else {
        // PVS null-window first, with LMR
        score = -this.search(nb, nw, -player, depth - 1 - reduce + ext, -alpha - 1, -alpha, deadline, ply + 1);
        if (reduce || ext || (score > alpha && score < beta)) {
          score = -this.search(nb, nw, -player, depth - 1 + ext, -beta, -alpha, deadline, ply + 1);
        }
      }
      if (score > best) best = score;
      if (best > alpha) { alpha = best; flag = 0; }
      if (alpha >= beta) {
        // record killer + history
        const idx = Number(log2BigInt(m));
        const arr = this.killers[ply] || (this.killers[ply] = []);
        if (!arr.includes(idx)) { arr.unshift(idx); if (arr.length > 2) arr.length = 2; }
        this.history[idx] = (this.history[idx] | 0) + depth * depth;
        flag = 1; break;
      }
    }
    this.ttStore(black, white, player, depth, best, flag);
    return best;
  }

  // Exact endgame solver: returns final disc diff from current player's perspective
  solveExact(black, white, player, deadline) {
    if (performance.now() > deadline) return this.finalScore(black, white, player);
    const empties = 64 - popcnt(black | white);
    if (empties === 0) return this.finalScore(black, white, player);
    const P = player === BLACK ? black : white;
    const O = player === BLACK ? white : black;
    const moves = legalMovesBB(P, O);
    if (!moves) return -this.solveExact(black, white, -player, deadline);
    let best = -Infinity;
    let mset = moves;
    while (mset) {
      const m = mset & -mset; mset ^= m;
      const child = applyMoveBB(P, O, m);
      const nb = player === BLACK ? child.P : child.O;
      const nw = player === BLACK ? child.O : child.P;
      const s = -this.solveExact(nb, nw, -player, deadline);
      if (s > best) best = s;
    }
    return best;
  }

  finalScore(black, white, player) {
    const b = popcnt(black), w = popcnt(white);
    return (player === BLACK ? (b - w) : (w - b));
  }

  evaluate(black, white, player) {
    const total = popcnt(black | white);
    const sign = player === BLACK ? 1 : -1;

    // material
    const mat = (popcnt(black) - popcnt(white)) * sign;

    // mobility
    const myMoves = popcnt(legalMovesBB(player === BLACK ? black : white, player === BLACK ? white : black));
    const oppMoves = popcnt(legalMovesBB(player === BLACK ? white : black, player === BLACK ? black : white));
    const mob = myMoves - oppMoves;

    // corners & X/C adjacency
    let cornerOwn = 0, xAdj = 0, cAdj = 0;
    const corners = [bit(0,0), bit(0,7), bit(7,0), bit(7,7)];
    const xs = [bit(1,1), bit(1,6), bit(6,1), bit(6,6)];
    const cs = [ [bit(0,1), bit(1,0)], [bit(0,6), bit(1,7)], [bit(6,0), bit(7,1)], [bit(7,6), bit(6,7)] ];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const ownerBlack = (black & c) !== 0n;
      const ownerWhite = (white & c) !== 0n;
      if (ownerBlack || ownerWhite) {
        const s = ownerBlack ? 1 : -1;
        cornerOwn += s * sign;
      } else {
        const xv = (black & xs[i]) ? 1 : (white & xs[i]) ? -1 : 0;
        if (xv) xAdj += xv * sign;
        for (const cc of cs[i]) {
          const cv = (black & cc) ? 1 : (white & cc) ? -1 : 0;
          if (cv) cAdj += cv * sign;
        }
      }
    }

    // frontier: discs adjacent to empty
    const empty = ~(black | white) & FULL;
    const neigh = (
      shiftE(empty) | shiftW(empty) | shiftN(empty) | shiftS(empty) |
      shiftNE(empty) | shiftNW(empty) | shiftSE(empty) | shiftSW(empty)
    );
    const myFront = popcnt((player === BLACK ? black : white) & neigh);
    const oppFront = popcnt((player === BLACK ? white : black) & neigh);
    const frontier = oppFront - myFront;

    // positional weights
    let positional = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const m = 1n << BigInt(r * 8 + c);
        const v = (black & m) ? 1 : (white & m) ? -1 : 0;
        if (v !== 0) positional += WEIGHTS[r][c] * v * sign;
      }
    }

    // edge stability approximation: count same-color runs from corners along edges
    const { myStable, oppStable } = this.edgeStabilityBB(black, white, player);
    const stability = myStable - oppStable;

    const par = parityEmpties(black, white);
    // region parity (only mid-late to save time)
    let reg = 0;
    if (total >= 32) {
      const empty = ~(black | white) & FULL;
      reg = regionParityScore(empty) * sign;
    }

    // full lines (rows/cols entirely ours)
    const myBoard = player === BLACK ? black : white;
    const oppBoard = player === BLACK ? white : black;
    let myFull = 0, oppFull = 0;
    for (let r = 0; r < 8; r++) {
      const rowMask = 0xFFn << BigInt(r * 8);
      if ((myBoard & rowMask) === rowMask) myFull++;
      if ((oppBoard & rowMask) === rowMask) oppFull++;
    }
    for (let c = 0; c < 8; c++) {
      const colMask = A_FILE << BigInt(c);
      if ((myBoard & colMask) === colMask) myFull++;
      if ((oppBoard & colMask) === colMask) oppFull++;
    }
    const fullLines = myFull - oppFull;

    // phase weights
    let wMat, wPos, wMob, wCor, wX, wC, wFro, wStb, wPar, wFull, wReg, wEdge, wRun;
    if (total >= 54) { // endgame
      wMat = 140; wPos = 8; wMob = 2; wCor = 200; wX = 8; wC = 8; wFro = 8; wStb = 40; wPar = 18; wFull = 200; wReg = 30; wEdge = 10; wRun = 10;
    } else if (total >= 28) { // midgame
      wMat = 10; wPos = 24; wMob = 18; wCor = 150; wX = 22; wC = 14; wFro = 16; wStb = 20; wPar = 6; wFull = 120; wReg = 20; wEdge = 8; wRun = 12;
    } else { // opening
      wMat = 1; wPos = 30; wMob = 16; wCor = 120; wX = 26; wC = 16; wFro = 14; wStb = 10; wPar = 2; wFull = 80; wReg = 8; wEdge = 6; wRun = 10;
    }

    // edge occupancy
    const edgesMask = RANK1 | RANK8 | A_FILE | H_FILE;
    const myEdge = popcnt((player === BLACK ? black : white) & edgesMask);
    const oppEdge = popcnt((player === BLACK ? white : black) & edgesMask);
    const edgeDiff = myEdge - oppEdge;

    // longest horizontal/vertical runs (bias vs diagonal over-valuation)
    const myBoard = player === BLACK ? black : white;
    const oppBoard = player === BLACK ? white : black;
    const longestRun = (bb, isVertical) => {
      let best = 0;
      if (!isVertical) {
        for (let r = 0; r < 8; r++) {
          const row = Number((bb >> BigInt(r * 8)) & 0xFFn);
          let cur = 0, maxr = 0;
          for (let i = 0; i < 8; i++) { cur = (row & (1 << i)) ? cur + 1 : 0; if (cur > maxr) maxr = cur; }
          if (maxr > best) best = maxr;
        }
      } else {
        for (let c = 0; c < 8; c++) {
          // build 8-bit column mask
          let col = 0;
          for (let r = 0; r < 8; r++) { const bit = 1n << BigInt(r * 8 + c); if (bb & bit) col |= (1 << r); }
          let cur = 0, maxc = 0;
          for (let i = 0; i < 8; i++) { cur = (col & (1 << i)) ? cur + 1 : 0; if (cur > maxc) maxc = cur; }
          if (maxc > best) best = maxc;
        }
      }
      return best;
    };
    const myRun = Math.max(longestRun(myBoard, false), longestRun(myBoard, true));
    const oppRun = Math.max(longestRun(oppBoard, false), longestRun(oppBoard, true));
    const runDiff = myRun - oppRun;

    return (
      wMat * mat + wPos * positional + wMob * mob + wCor * cornerOwn - wX * xAdj - wC * cAdj +
      wFro * frontier + wStb * stability + wPar * par + wFull * fullLines + wReg * reg + wEdge * edgeDiff + wRun * runDiff
    );
  }

  edgeStabilityBB(black, white, player) {
    // Count contiguous stable runs from corners along edges
    let my = 0, opp = 0;
    const lines = [
      // top row
      { start: bit(0,0), step: shiftE },
      { start: bit(0,7), step: shiftW },
      // bottom row
      { start: bit(7,0), step: shiftE },
      { start: bit(7,7), step: shiftW },
      // left col
      { start: bit(0,0), step: shiftS },
      { start: bit(7,0), step: shiftN },
      // right col
      { start: bit(0,7), step: shiftS },
      { start: bit(7,7), step: shiftN },
    ];
    for (const L of lines) {
      const s = L.start;
      const owner = (black & s) ? BLACK : (white & s) ? WHITE : EMPTY;
      if (owner === EMPTY) continue;
      let cur = s;
      while (cur) {
        const v = (black & cur) ? BLACK : (white & cur) ? WHITE : EMPTY;
        if (v !== owner) break;
        if (v === player) my++; else opp++;
        cur = L.step(cur);
      }
    }
    return { myStable: my, oppStable: opp };
  }
}

export const WEIGHTS = [
  [120, -20,  20,  5,  5,  20, -20, 120],
  [-20, -40, -5, -5, -5,  -5, -40, -20],
  [ 20,  -5, 15,  3,  3,  15,  -5,  20],
  [  5,  -5,  3,  2,  2,   3,  -5,   5],
  [  5,  -5,  3,  2,  2,   3,  -5,   5],
  [ 20,  -5, 15,  3,  3,  15,  -5,  20],
  [-20, -40, -5, -5, -5,  -5, -40, -20],
  [120, -20, 20,  5,  5,  20, -20, 120],
];
