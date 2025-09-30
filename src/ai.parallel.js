// Parallel AI using a pool of Web Workers for root split, with optional shared TT
import { getLegalMoves, BLACK, getFlips } from './othello.js';

export class AIEngine {
  constructor() {
    this.poolSize = Math.min(navigator.hardwareConcurrency || 4, 8);
    this.workers = [];
    this.idle = [];
    this.tasks = new Map();
    this.shared = null; // { size, keys, scores, depths, flags }
    this.fallbackEngine = null; // single-thread fallback when Worker not available
    // track whether threads are auto-managed or user-fixed
    this._autoThreading = true;
  }

  ensureWorkers() {
    const target = this.poolSize;
    // shrink if needed
    while (this.workers.length > target) {
      const w = this.workers.pop();
      try { w.terminate(); } catch {}
    }
    // grow if needed
    while (this.workers.length < target) {
      let w;
      try {
        w = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        // Worker not available (e.g., file://). Enable fallback.
        this.workers.length = 0;
        this.idle.length = 0;
        break;
      }
      this.workers.push(w);
      this.idle.push(w);
      w.onmessage = (e) => this.onWorkerMsg(w, e);
      w.postMessage({ cmd: 'init', payload: { shared: this.shared } });
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.tasks.clear();
  }

  onWorkerMsg(worker, e) {
    const msg = e.data || {};
    if (msg.cmd === 'init') return; // ignore init ack
    const task = this.tasks.get(worker);
    if (!task) return;
    this.tasks.delete(worker);
    this.idle.push(worker);
    if (msg.ok && msg.cmd === 'searchRoot') {
      task.resolve(msg.result);
    } else {
      task.reject(new Error(msg.error || 'Worker error'));
    }
  }

  runTask(worker, payload) {
    return new Promise((resolve, reject) => {
      this.tasks.set(worker, { resolve, reject });
      worker.postMessage({ cmd: 'searchRoot', payload });
    });
  }

  setThreads(n) {
    if (typeof n === 'number' && n > 0) {
      this.poolSize = Math.max(1, Math.min(32, Math.floor(n)));
      this._autoThreading = false;
    } else {
      this.poolSize = Math.min(navigator.hardwareConcurrency || 4, 8);
      this._autoThreading = true;
    }
    // Recreate shared TT to match new pool if needed
    this.prepareSharedTT();
    this.ensureWorkers();
  }

  prepareSharedTT() {
    // Create a shared transposition table if available
    try {
      const coi = (typeof crossOriginIsolated !== 'undefined') ? crossOriginIsolated : false;
      if (typeof SharedArrayBuffer === 'undefined' || !coi) {
        this.shared = null;
        return;
      }
      const SIZE = 1 << 18; // 262,144 entries
      const keys = new Uint32Array(new SharedArrayBuffer(SIZE * 4));
      const scores = new Int32Array(new SharedArrayBuffer(SIZE * 4));
      const depths = new Int8Array(new SharedArrayBuffer(SIZE));
      const flags = new Int8Array(new SharedArrayBuffer(SIZE));
      // moves array reserved for future use
      this.shared = { size: SIZE, keys, scores, depths, flags };
    } catch {
      this.shared = null;
    }
  }

  async chooseMove(state, player, opts) {
    const { timeMs = 600, maxDepth = 8 } = opts || {};
    const start = performance.now();
    const deadline = start + timeMs;

    const moves = getLegalMoves(state, player);
    if (moves.length === 0) return null;

    // Prepare shared TT once per choose
    if (!this.shared) this.prepareSharedTT();

    // If single-thread is requested or too few moves, fallback to first worker
    if (this.workers.length === 0) {
      // Fallback single-threaded: dynamically import bitboard engine
      if (!this.fallbackEngine) {
        const mod = await import('./ai.bitboard.js');
        this.fallbackEngine = new mod.AIEngine();
      }
      let best = null, bestScore = -Infinity;
      const perMove = Math.max(20, Math.floor(timeMs / moves.length));
      for (const m of moves) {
        const s = this.fallbackEngine.scoreRootMove(state, player, m, { timeMs: perMove, maxDepth });
        if (s > bestScore) { bestScore = s; best = m; }
      }
      return best || moves[0];
    }
    if ((navigator.hardwareConcurrency || 1) <= 1 || moves.length === 1) {
      // Lazily spin up one worker and use it
      this.poolSize = 1;
      this.ensureWorkers();
      const res = await this.runTask(this.idle.pop(), { state, player, move: moves[0], opts: { timeMs, maxDepth } });
      return res.move;
    }

    if (this._autoThreading) {
      this.poolSize = Math.min(Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) * 0.75)), 8);
    }
    this.ensureWorkers();

    // Schedule root moves across the pool; each task uses the full remaining time
    const tasks = [];
    let best = null;
    let bestScore = -Infinity;

    const enqueue = async (move) => {
      const now = performance.now();
      if (now >= deadline) return;
      const worker = this.idle.pop();
      if (!worker) {
        // wait for a worker to free then try again
        await new Promise(r => setTimeout(r, 1));
        return enqueue(move);
      }
      const budget = Math.max(30, Math.floor(deadline - now));
      const p = this.runTask(worker, { state, player, move, opts: { timeMs: budget, maxDepth } })
        .then(res => {
          if (res && typeof res.score === 'number') {
            if (res.score > bestScore) {
              bestScore = res.score;
              best = res.move;
            }
          }
        })
        .catch(() => {})
        .finally(() => {});
      tasks.push(p);
    };

    // simple ordering: corners first
    const corners = moves.filter(m => (m.row === 0 || m.row === 7) && (m.col === 0 || m.col === 7));
    const rest = moves.filter(m => !corners.includes(m));
    const restScored = rest.map(m => {
        const flips = getFlips(state, m.row, m.col, player);
        const v = flips.filter(f => f[1] === m.col).length; // vertical flips
        const h = flips.filter(f => f[0] === m.row).length; // horizontal flips
        const d = flips.length - v - h; // diagonal
        const isEdge = (m.row === 0 || m.row === 7 || m.col === 0 || m.col === 7) ? 1 : 0;
        // Lightweight ordering only
        const score = (
          v*12 + h*10 + d*2 + flips.length*3 + isEdge*24
        );
        return { m, s: score };
      })
      .sort((a,b) => b.s - a.s)
      .map(x => x.m);
    const ordered = corners.concat(restScored);

    for (const m of ordered) await enqueue(m);

    // Wait until time is up or all tasks resolved
    const waitLeft = Math.max(0, deadline - performance.now());
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise(r => setTimeout(r, waitLeft))
    ]);

    // Best fallback
    return best || moves[0];
  }
}
