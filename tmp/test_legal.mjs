import { createInitialBoard, getLegalMoves, applyMove, BLACK } from '../src/othello.js';
import { AIEngine as BitAI } from '../src/ai.bitboard.js';

function movesFromBB(black, white, player) {
  // replicate legalMovesBB
  const FULL = 0xFFFFFFFFFFFFFFFFn;
  const A_FILE = 0x0101010101010101n;
  const H_FILE = 0x8080808080808080n;
  const NOT_A = FULL ^ A_FILE;
  const NOT_H = FULL ^ H_FILE;
  const RANK8 = 0xFF00000000000000n;
  const NOT_RANK8 = FULL ^ RANK8;
  const shiftE = (bb) => (bb & NOT_H) << 1n;
  const shiftW = (bb) => (bb & NOT_A) >> 1n;
  const shiftN = (bb) => bb >> 8n;
  const shiftS = (bb) => (bb & NOT_RANK8) << 8n;
  const shiftNE = (bb) => (bb & NOT_H) >> 7n;
  const shiftNW = (bb) => (bb & NOT_A) >> 9n;
  const shiftSE = (bb) => (bb & NOT_H) << 9n;
  const shiftSW = (bb) => (bb & NOT_A) << 7n;
  const DIRS = [shiftE, shiftW, shiftN, shiftS, shiftNE, shiftNW, shiftSE, shiftSW];
  const P = player === BLACK ? black : white;
  const O = player === BLACK ? white : black;
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

function coordsForMoves(bb) {
  const list = [];
  let mset = bb;
  while (mset) {
    const m = mset & -mset; mset ^= m;
    const i = Number(BigInt.asUintN(64, (function log2BigInt(v){ let i=0n; let x=v; while (x>1n){ x >>=1n; i++; } return i; })(m)));
    const r = Math.floor(i/8); const c = i%8;
    list.push([r,c]);
  }
  list.sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  return list;
}

function testMany() {
  const eng = new BitAI();
  let board = createInitialBoard();
  let player = BLACK;
  for (let step=0; step<200; step++){
    const moves1 = getLegalMoves(board, player).map(m => [m.row, m.col]).sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
    const bb = eng.packBoard(board);
    const movesBB = coordsForMoves(movesFromBB(bb.black, bb.white, player));
    const s1 = JSON.stringify(moves1); const s2 = JSON.stringify(movesBB);
    if (s1 !== s2) {
      console.log('Mismatch at step', step, 'player', player);
      console.log('grid', moves1);
      console.log('bb  ', movesBB);
      return;
    }
    // advance
    if (moves1.length === 0) {
      const opp = getLegalMoves(board, -player);
      if (opp.length === 0) break; player*=-1; continue;
    }
    const m = getLegalMoves(board, player)[0];
    board = applyMove(board, m, player);
    player*=-1;
  }
  console.log('Legal moves match for a random playout.');
}

testMany();

