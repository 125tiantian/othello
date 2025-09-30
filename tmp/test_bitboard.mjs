import { AIEngine as BitAI } from '../src/ai.bitboard.js';
import { createInitialBoard, getLegalMoves, getFlips, applyMove, BLACK, WHITE } from '../src/othello.js';

function toBB(state){
  const eng = new BitAI();
  return eng.packBoard(state);
}

function fromBB(black, white){
  const grid = Array.from({length:8}, ()=>Array(8).fill(0));
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const m = 1n << BigInt(r*8+c);
      if (black & m) grid[r][c] = BLACK; else if (white & m) grid[r][c] = WHITE;
    }
  }
  return grid;
}

function moveOK(){
  const eng = new BitAI();
  let state = createInitialBoard();
  let player = BLACK;
  for(let step=0; step<200; step++){
    const moves = getLegalMoves(state, player);
    if(moves.length===0){
      const opp = getLegalMoves(state, -player);
      if (opp.length===0) break; player*=-1; continue;
    }
    const bb = eng.packBoard(state);
    // pick a random move
    const m = moves[Math.floor(Math.random()*moves.length)];
    // bitboard apply
    const P = player===BLACK?bb.black:bb.white;
    const O = player===BLACK?bb.white:bb.black;
    const moveBit = 1n << BigInt(m.row*8+m.col);
    const { P: P2, O: O2 } = (function(){
      // inline applyMoveBB logic
      const flipsForMoveBB = (P,O,moveBit)=>{
        let flips = 0n;
        const FULL=0xFFFFFFFFFFFFFFFFn; const A_FILE=0x0101010101010101n; const H_FILE=0x8080808080808080n; const NOT_A=(FULL^A_FILE); const NOT_H=(FULL^H_FILE); const RANK1=0x00000000000000FFn; const RANK8=0xFF00000000000000n; const NOT_RANK8=(FULL^RANK8);
        const shiftE=bb=> (bb & NOT_H) << 1n; const shiftW=bb=> (bb & NOT_A) >> 1n; const shiftN=bb=> bb >> 8n; const shiftS=bb=> (bb & NOT_RANK8) << 8n; const shiftNE=bb=> (bb & NOT_H) >> 7n; const shiftNW=bb=> (bb & NOT_A) >> 9n; const shiftSE=bb=> (bb & NOT_H) << 9n; const shiftSW=bb=> (bb & NOT_A) << 7n; const DIRS=[shiftE,shiftW,shiftN,shiftS,shiftNE,shiftNW,shiftSE,shiftSW];
        for(const shift of DIRS){
          let x = 0n; let t = shift(moveBit) & O; let i=0; while(i<6 && t){ x|=t; t = shift(t) & O; i++; }
          if ((shift(x) & P) !== 0n) flips |= x;
        }
        return flips;
      };
      let flips = flipsForMoveBB(P,O,moveBit);
      let nP = P ^ flips; let nO = O ^ flips; nP |= moveBit; return { P:nP, O:nO };
    })();
    const nb = player===BLACK?P2:O2; const nw = player===BLACK?O2:P2;
    const nextState = applyMove(state, m, player);
    const afterBB = fromBB(nb,nw);
    // compare
    const same = JSON.stringify(afterBB) === JSON.stringify(nextState);
    if(!same){
      console.log('Mismatch at step', step, 'move', m, 'player', player);
      console.log(afterBB);
      console.log(nextState);
      return;
    }
    state = nextState;
    player*=-1;
  }
  console.log('Bitboard apply matches basic logic for random playout.');
}

moveOK();

