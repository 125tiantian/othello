// Worker: evaluate a single root move using Bitboard AIEngine
import { AIEngine } from './ai.bitboard.js';
import { SIZE } from './othello.js';

let engine = null;
let sharedTT = null;

self.onmessage = (e) => {
  const { cmd, payload } = e.data || {};
  try {
    if (cmd === 'init') {
      engine = new AIEngine();
      if (payload && payload.shared) {
        sharedTT = payload.shared;
        try { engine.setSharedTT(sharedTT); } catch {}
      }
      self.postMessage({ ok: true, cmd: 'init' });
      return;
    }
    if (cmd === 'searchRoot') {
      if (!engine) engine = new AIEngine();
      const { state, player, move, opts } = payload;
      const score = engine.scoreRootMove(state, player, move, opts);
      self.postMessage({ ok: true, cmd: 'searchRoot', result: { move, score } });
      return;
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.stack || err) });
  }
};
