// Stronger AI with Iterative Deepening + Transposition Table
import { SIZE, BLACK, WHITE, EMPTY, getLegalMoves, applyMove, isGameOver, countPieces, getFlips } from './othello.js';

export class AIEngine {
  constructor() {
    this.initZobrist();
    this.tt = new Map(); // hash -> { depth, score, flag, move }
    this.maxNodes = 0;
    this.killers = Array.from({ length: 64 }, () => []); // per-depth top killer moves
    this.history = new Int32Array(64); // simple history heuristic by square index
  }

  initZobrist() {
    // 8x8 x 2 pieces
    this.zTable = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => [this.rand64(), this.rand64()]));
    this.zTurn = this.rand64();
  }
  rand64() {
    // Simple 53-bit random number composed twice
    const a = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const b = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    return BigInt(a) ^ (BigInt(b) << 21n);
  }

  // Full recompute (slow). Kept for fallback or verification.
  hash(state, player) {
    let h = 0n;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state[r][c];
        if (v === BLACK) h ^= this.zTable[r][c][0];
        else if (v === WHITE) h ^= this.zTable[r][c][1];
      }
    }
    if (player === BLACK) h ^= this.zTurn;
    return h;
  }

  boardHash(state) {
    let h = 0n;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state[r][c];
        if (v === BLACK) h ^= this.zTable[r][c][0];
        else if (v === WHITE) h ^= this.zTable[r][c][1];
      }
    }
    return h;
  }

  chooseMove(state, player, opts) {
    const { timeMs = 600, maxDepth = 8 } = opts || {};
    const start = performance.now();
    const deadline = start + timeMs;
    this.maxNodes = 0;

    // Reset per-search heuristics
    this.tt.clear();
    this.killers.forEach((arr) => arr.length = 0);
    this.history.fill(0);

    // Work on an internal mutable copy to enable in-place make/unmake
    const work = state.map(row => row.slice());
    let bHash = this.boardHash(work);
    const moves = getLegalMoves(work, player);
    if (moves.length === 0) return null;

    // Opening boost: prefer center if very early
    let ordered = this.orderMoves(state, moves, player, 0);

    // Endgame extension: if few empties remain, allow deeper
    const counts = countPieces(state);
    const total = counts.black + counts.white;
    const empties = SIZE * SIZE - total;
    const targetMaxDepth = empties <= 12 ? Math.max(maxDepth, empties + 2) : maxDepth;

    let bestMove = ordered[0] ?? null;
    let bestScore = -Infinity;
    let pvMove = null;
    let prevScore = 0;

    // Root search with aspiration windows
    const ASP_DELTA = 75; // initial aspiration half-window
    const rootSearch = (depth, a, b) => {
      let alpha = a, beta = b;
      let currentBest = bestMove;
      let currentScore = -Infinity;
      let first = true;
      let rootMoves = ordered;
      // Try principal variation first
      if (pvMove) {
        rootMoves = [pvMove, ...ordered.filter(m => !(m.row === pvMove.row && m.col === pvMove.col))];
      }
      for (const m of rootMoves) {
        if (performance.now() > deadline) break;
        const data = this.makeMove(work, m, player, bHash);
        const childHash = data.hash;
        let score;
        if (first) {
          score = -this.negamax(work, -player, depth - 1, -beta, -alpha, deadline, 1, childHash);
          first = false;
        } else {
          // PVS zero-window first
          score = -this.negamax(work, -player, depth - 1, -alpha - 1, -alpha, deadline, 1, childHash);
          if (score > alpha && score < beta) {
            score = -this.negamax(work, -player, depth - 1, -beta, -alpha, deadline, 1, childHash);
          }
        }
        this.unmakeMove(work, m, player, data);
        if (score > currentScore) {
          currentScore = score;
          currentBest = m;
        }
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return { currentBest, currentScore };
    };

    for (let depth = 2; depth <= targetMaxDepth; depth++) {
      let alpha = -Infinity, beta = Infinity;
      if (depth > 2) {
        alpha = prevScore - ASP_DELTA;
        beta = prevScore + ASP_DELTA;
      }
      let { currentBest, currentScore } = rootSearch(depth, alpha, beta);
      // Aspiration adjust if fail-low/high
      if (performance.now() <= deadline && (currentScore <= alpha || currentScore >= beta)) {
        // re-search with wide window
        ({ currentBest, currentScore } = rootSearch(depth, -Infinity, Infinity));
      }
      if (performance.now() > deadline) break;
      bestMove = currentBest;
      bestScore = currentScore;
      prevScore = currentScore;
      pvMove = currentBest;
      // Recompute ordering using updated history/TT
      ordered = this.orderMoves(work, moves, player, 0);
    }
    return bestMove;
  }

  negamax(state, player, depth, alpha, beta, deadline, ply = 1, boardHash) {
    if (performance.now() > deadline) return this.evaluate(state, player);
    if (depth <= 0 || isGameOver(state)) return this.evaluate(state, player);

    const key = boardHash ^ (player === BLACK ? this.zTurn : 0n);
    const ttEntry = this.tt.get(key);
    const alphaOrig = alpha;
    if (ttEntry && ttEntry.depth >= depth) {
      if (ttEntry.flag === 0) return ttEntry.score; // EXACT
      else if (ttEntry.flag === -1) { // UPPER
        if (ttEntry.score < beta) beta = ttEntry.score;
      } else if (ttEntry.flag === 1) { // LOWER
        if (ttEntry.score > alpha) alpha = ttEntry.score;
      }
      if (alpha >= beta) return ttEntry.score;
    }

    const moves = getLegalMoves(state, player);
    if (moves.length === 0) {
      // pass
      return -this.negamax(state, -player, depth - 1, -beta, -alpha, deadline, ply + 1, boardHash);
    }

    let ordered = this.orderMoves(state, moves, player, ply);
    // TT suggested move first
    if (ttEntry && ttEntry.move) {
      const idx = ordered.findIndex(m => m.row === ttEntry.move.row && m.col === ttEntry.move.col);
      if (idx > 0) {
        const [mv] = ordered.splice(idx, 1);
        ordered.unshift(mv);
      }
    }

    let best = -Infinity;
    let bestMove = ordered[0];
    for (let i = 0; i < ordered.length; i++) {
      if (performance.now() > deadline) break;
      const m = ordered[i];
      const data = this.makeMove(state, m, player, boardHash);
      const childHash = data.hash;
      let score;
      const isCorner = (m.row === 0 || m.row === SIZE - 1) && (m.col === 0 || m.col === SIZE - 1);
      // Late Move Reductions: reduce late, non-corner, non-killer moves
      const killerSet = this.killers[ply] || [];
      const isKiller = killerSet.some(k => k.row === m.row && k.col === m.col);
      const allowLMR = depth >= 3 && i >= 3 && !isCorner && !isKiller;
      const reduce = allowLMR ? 1 : 0;
      if (i === 0) {
        score = -this.negamax(state, -player, depth - 1, -beta, -alpha, deadline, ply + 1, childHash);
      } else {
        // PVS (null-window search) with LMR
        score = -this.negamax(state, -player, depth - 1 - reduce, -alpha - 1, -alpha, deadline, ply + 1, childHash);
        if (reduce || (score > alpha && score < beta)) {
          score = -this.negamax(state, -player, depth - 1, -beta, -alpha, deadline, ply + 1, childHash);
        }
      }
      if (score > best) { best = score; bestMove = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        // record killer + history
        this.noteKiller(m, ply);
        this.noteHistory(m, depth);
        this.unmakeMove(state, m, player, data);
        break;
      }
      this.unmakeMove(state, m, player, data);
    }
    // store to TT
    let flag = 0; // EXACT
    if (best <= alphaOrig) flag = -1; // UPPERBOUND
    else if (best >= beta) flag = 1; // LOWERBOUND
    const prev = this.tt.get(key);
    if (!prev || depth >= prev.depth) {
      this.tt.set(key, { depth, score: best, flag, move: bestMove });
    }
    return best;
  }

  orderMoves(state, moves, player, ply) {
    const corner = (r, c) => (r === 0 && c === 0) || (r === 0 && c === SIZE - 1) || (r === SIZE - 1 && c === 0) || (r === SIZE - 1 && c === SIZE - 1);
    const killers = this.killers[ply] || [];
    return moves
      .map(m => {
        const isCorner = corner(m.row, m.col);
        const flips = this.quickFlipCount(state, m.row, m.col, player);
        const pos = WEIGHTS[m.row][m.col];
        const mvIdx = this.moveIndex(m);
        const hist = this.history[mvIdx] || 0;
        const isKiller = killers.some(k => k.row === m.row && k.col === m.col);
        const score = (isCorner ? 20000 : 0)
          + (isKiller ? 1500 : 0)
          + hist
          + flips * 10
          + pos * 3;
        return { move: m, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(x => x.move);
  }

  quickFlipCount(state, row, col, player) {
    // cheaper than full getFlips; approximate by scanning until own piece
    let count = 0;
    for (const [dr, dc] of DIRS) {
      let r = row + dr, c = col + dc, seen = 0;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
        const v = state[r][c];
        if (v === EMPTY) { seen = 0; break; }
        if (v === player) { count += seen; break; }
        seen++; r += dr; c += dc;
      }
    }
    return count;
  }

  evaluate(state, player) {
    // player-perspective evaluation
    const counts = countPieces(state);
    const total = counts.black + counts.white;
    const sign = player; // black 1, white -1

    const material = sign * (counts.black - counts.white);

    const myMoves = getLegalMoves(state, player).length;
    const oppMoves = getLegalMoves(state, -player).length;
    const mobility = myMoves - oppMoves;

    // corners and adjacency (X/C squares)
    let cornerOwn = 0;
    let xAdj = 0; // X-squares near empty corners
    let cAdj = 0; // C-squares near empty corners
    for (const [cr, cc] of CORNERS) {
      const owner = state[cr][cc];
      if (owner !== EMPTY) {
        cornerOwn += Math.sign(owner) * sign;
      } else {
        const xs = X_SQUARES[`${cr},${cc}`];
        const cs = C_SQUARES[`${cr},${cc}`];
        const xv = state[xs[0]][xs[1]];
        if (xv !== EMPTY) xAdj += Math.sign(xv) * sign;
        for (const [ar, ac] of cs) {
          const v = state[ar][ac];
          if (v !== EMPTY) cAdj += Math.sign(v) * sign;
        }
      }
    }

    // frontier discs (adjacent to empty)
    let myFrontier = 0, oppFrontier = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = state[r][c];
        if (v === EMPTY) continue;
        let nearEmpty = false;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
          if (state[nr][nc] === EMPTY) { nearEmpty = true; break; }
        }
        if (nearEmpty) {
          if (v * sign > 0) myFrontier++; else oppFrontier++;
        }
      }
    }
    const frontier = oppFrontier - myFrontier; // fewer frontier is better

    // weighted positional matrix
    let positional = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        positional += WEIGHTS[r][c] * state[r][c] * sign;
      }
    }

    // edge stability approximation
    const { myStable, oppStable } = this.edgeStability(state, player);
    const stability = myStable - oppStable;

    // parity (endgame)
    const empties = SIZE * SIZE - total;
    const parity = (empties % 2 === 1 ? 1 : -1);

    // phase-dependent weights
    let wMat, wPos, wMob, wCor, wX, wC, wFro, wStb, wPar;
    if (total >= 54) { // endgame
      wMat = 140; wPos = 8; wMob = 2; wCor = 200; wX = 8; wC = 8; wFro = 8; wStb = 40; wPar = 18;
    } else if (total >= 28) { // midgame
      wMat = 10; wPos = 24; wMob = 18; wCor = 150; wX = 22; wC = 14; wFro = 16; wStb = 20; wPar = 6;
    } else { // opening
      wMat = 1; wPos = 30; wMob = 16; wCor = 120; wX = 26; wC = 16; wFro = 14; wStb = 10; wPar = 2;
    }

    return (
      wMat * material +
      wPos * positional +
      wMob * mobility +
      wCor * cornerOwn -
      wX * xAdj -
      wC * cAdj +
      wFro * frontier +
      wStb * stability +
      wPar * parity
    );
  }

  moveIndex(m) { return m.row * SIZE + m.col; }
  noteKiller(m, ply) {
    const arr = this.killers[ply] || (this.killers[ply] = []);
    if (!arr.some(k => k.row === m.row && k.col === m.col)) {
      arr.unshift({ row: m.row, col: m.col });
      if (arr.length > 2) arr.length = 2;
    }
  }
  noteHistory(m, depth) {
    const idx = this.moveIndex(m);
    // quadratic bonus by depth
    this.history[idx] = (this.history[idx] | 0) + depth * depth;
  }

  // In-place make/unmake with incremental Zobrist
  makeMove(state, move, player, boardHash) {
    const { row, col } = move;
    const flips = getFlips(state, row, col, player);
    // place disc
    state[row][col] = player;
    // update hash for placement
    let h = boardHash ^ (player === BLACK ? this.zTable[row][col][0] : this.zTable[row][col][1]);
    // flip discs
    for (let i = 0; i < flips.length; i++) {
      const [r, c] = flips[i];
      const v = state[r][c]; // current before change
      // remove old color, add new color
      if (v === BLACK) {
        h ^= this.zTable[r][c][0];
      } else if (v === WHITE) {
        h ^= this.zTable[r][c][1];
      }
      state[r][c] = player;
      if (player === BLACK) h ^= this.zTable[r][c][0]; else h ^= this.zTable[r][c][1];
    }
    return { flips, hash: h };
  }

  unmakeMove(state, move, player, data) {
    const { row, col } = move;
    const { flips } = data;
    // undo flips back to opponent
    for (let i = 0; i < flips.length; i++) {
      const [r, c] = flips[i];
      state[r][c] = -player;
    }
    // remove placed disc
    state[row][col] = EMPTY;
  }

  // Evaluate a single root move with iterative deepening and time control
  scoreRootMove(state, player, move, opts) {
    const { timeMs = 600, maxDepth = 8 } = opts || {};
    const start = performance.now();
    const deadline = start + timeMs;
    // per-search reset
    this.tt.clear();
    this.killers.forEach(a => a.length = 0);
    this.history.fill(0);

    const work = state.map(row => row.slice());
    let bHash = this.boardHash(work);

    // Endgame extension based on empties
    const counts = countPieces(work);
    const total = counts.black + counts.white;
    const empties = SIZE * SIZE - total;
    const targetMaxDepth = empties <= 12 ? Math.max(maxDepth, empties + 2) : maxDepth;
    let bestScore = -Infinity;

    // aspiration center seeded at 0
    let alphaBase = -Infinity, betaBase = Infinity;
    const ASP_DELTA = 75;

    for (let depth = 2; depth <= targetMaxDepth; depth++) {
      if (performance.now() > deadline) break;
      let alpha = depth > 2 ? Math.max(-Infinity, bestScore - ASP_DELTA) : alphaBase;
      let beta = depth > 2 ? Math.min(Infinity, bestScore + ASP_DELTA) : betaBase;
      const data = this.makeMove(work, move, player, bHash);
      const h = data.hash;
      let score = -this.negamax(work, -player, depth - 1, -beta, -alpha, deadline, 1, h);
      this.unmakeMove(work, move, player, data);
      if (performance.now() <= deadline && (score <= alpha || score >= beta)) {
        const data2 = this.makeMove(work, move, player, bHash);
        score = -this.negamax(work, -player, depth - 1, -Infinity, Infinity, deadline, 1, data2.hash);
        this.unmakeMove(work, move, player, data2);
      }
      if (performance.now() > deadline) break;
      bestScore = score;
    }
    return bestScore;
  }
}

// Constants for evaluation and ordering
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

const CORNERS = [ [0,0], [0, SIZE-1], [SIZE-1,0], [SIZE-1, SIZE-1] ];

const ADJACENTS = {
  '0,0': [[0,1],[1,0],[1,1]],
  [`0,${SIZE-1}`]: [[0,SIZE-2],[1,SIZE-1],[1,SIZE-2]],
  [`${SIZE-1},0`]: [[SIZE-2,0],[SIZE-1,1],[SIZE-2,1]],
  [`${SIZE-1},${SIZE-1}`]: [[SIZE-2,SIZE-1],[SIZE-1,SIZE-2],[SIZE-2,SIZE-2]],
};

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

// X-/C- squares relative to each corner (used when the corner is empty)
const X_SQUARES = {
  '0,0': [1, 1],
  [`0,${SIZE-1}`]: [1, SIZE-2],
  [`${SIZE-1},0`]: [SIZE-2, 1],
  [`${SIZE-1},${SIZE-1}`]: [SIZE-2, SIZE-2],
};
const C_SQUARES = {
  '0,0': [[0,1],[1,0]],
  [`0,${SIZE-1}`]: [[0,SIZE-2],[1,SIZE-1]],
  [`${SIZE-1},0`]: [[SIZE-1,1],[SIZE-2,0]],
  [`${SIZE-1},${SIZE-1}`]: [[SIZE-1,SIZE-2],[SIZE-2,SIZE-1]],
};

// Edge stability approximation helper
AIEngine.prototype.edgeStability = function(state, player) {
  const visited = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  let myStable = 0, oppStable = 0;

  const mark = (r, c, v) => {
    if (visited[r][c]) return;
    visited[r][c] = true;
    if (v === player) myStable++; else if (v === -player) oppStable++;
  };

  const scanRow = (r, from, step) => {
    const start = state[r][from];
    if (start === EMPTY) return;
    for (let c = from; c >= 0 && c < SIZE; c += step) {
      if (state[r][c] !== start) break;
      mark(r, c, start);
    }
  };
  const scanCol = (c, from, step) => {
    const start = state[from][c];
    if (start === EMPTY) return;
    for (let r = from; r >= 0 && r < SIZE; r += step) {
      if (state[r][c] !== start) break;
      mark(r, c, start);
    }
  };

  // top-left corner anchoring top row and left column
  scanRow(0, 0, +1);
  scanCol(0, 0, +1);
  // top-right
  scanRow(0, SIZE - 1, -1);
  scanCol(SIZE - 1, 0, +1); // right column downward from top-right
  // bottom-left
  scanRow(SIZE - 1, 0, +1);
  scanCol(0, SIZE - 1, -1); // left column upward from bottom-left
  // bottom-right
  scanRow(SIZE - 1, SIZE - 1, -1);
  scanCol(SIZE - 1, SIZE - 1, -1); // right column upward from bottom-right

  return { myStable, oppStable };
};
