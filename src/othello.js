// Core Othello/Reversi logic
export const SIZE = 8;
export const BLACK = 1;
export const WHITE = -1;
export const EMPTY = 0;

export const directions = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function createInitialBoard() {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
  const mid = SIZE / 2;
  grid[mid - 1][mid - 1] = WHITE;
  grid[mid][mid] = WHITE;
  grid[mid - 1][mid] = BLACK;
  grid[mid][mid - 1] = BLACK;
  return grid;
}

export function cloneBoard(state) {
  return state.map(row => row.slice());
}

export function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function getFlips(state, row, col, player) {
  if (state[row][col] !== EMPTY) return [];
  const flips = [];
  for (const [dr, dc] of directions) {
    const path = [];
    let r = row + dr, c = col + dc;
    while (inBounds(r, c)) {
      const v = state[r][c];
      if (v === EMPTY) break;
      if (v === player) {
        if (path.length) flips.push(...path);
        break;
      }
      path.push([r, c]);
      r += dr; c += dc;
    }
  }
  return flips;
}

export function getLegalMoves(state, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state[r][c] !== EMPTY) continue;
      if (getFlips(state, r, c, player).length) moves.push({ row: r, col: c });
    }
  }
  return moves;
}

export function applyMove(state, move, player) {
  const next = cloneBoard(state);
  const flips = getFlips(next, move.row, move.col, player);
  next[move.row][move.col] = player;
  for (const [r, c] of flips) next[r][c] = player;
  return next;
}

export function countPieces(state) {
  let black = 0, white = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state[r][c] === BLACK) black++;
      else if (state[r][c] === WHITE) white++;
    }
  }
  return { black, white };
}

export function isGameOver(state) {
  return getLegalMoves(state, BLACK).length === 0 && getLegalMoves(state, WHITE).length === 0;
}

export function coordsToLabel(row, col) {
  const letters = 'ABCDEFGH';
  return `${letters[col]}${row + 1}`;
}
