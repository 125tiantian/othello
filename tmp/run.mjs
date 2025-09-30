import { AIEngine as BitAI } from '../src/ai.bitboard.js';
import { createInitialBoard, BLACK, WHITE, getLegalMoves, applyMove } from '../src/othello.js';

function fillNearEndgame() {
  // Create a random but valid near-endgame position by playing random legal moves
  let board = createInitialBoard();
  let player = BLACK;
  let movesPlayed = 0;
  while (true) {
    const moves = getLegalMoves(board, player);
    if (moves.length === 0) {
      const oppMoves = getLegalMoves(board, -player);
      if (oppMoves.length === 0) break;
      player = -player; // pass
      continue;
    }
    // stop when <= 12 empties
    let empty = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === 0) empty++;
    if (empty <= 12) break;
    // play a random move to advance
    const m = moves[Math.floor(Math.random() * moves.length)];
    board = applyMove(board, m, player);
    player = -player;
    if (++movesPlayed > 200) break;
  }
  return { board, player };
}

const { board, player } = fillNearEndgame();
const ai = new BitAI();
const opts = { timeMs: 1000, maxDepth: 10 };
const legal = getLegalMoves(board, player);
console.log('empties<=12?', legal.length, 'moves');
try {
  const move = ai.scoreRootMove(board, player, legal[0], opts);
  console.log('scored OK:', move);
} catch (e) {
  console.error('Error scoring move:', e);
}

