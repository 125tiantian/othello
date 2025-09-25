(function(){
  'use strict';

  // ========= Core Othello Logic =========
  const SIZE = 8;
  const BLACK = 1;
  const WHITE = -1;
  const EMPTY = 0;

  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  function createInitialBoard() {
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    const mid = SIZE / 2;
    grid[mid - 1][mid - 1] = WHITE;
    grid[mid][mid] = WHITE;
    grid[mid - 1][mid] = BLACK;
    grid[mid][mid - 1] = BLACK;
    return grid;
  }

  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

  function getFlips(state, row, col, player) {
    if (state[row][col] !== EMPTY) return [];
    const flips = [];
    for (const [dr, dc] of DIRS) {
      const path = [];
      let r = row + dr, c = col + dc;
      while (inBounds(r, c)) {
        const v = state[r][c];
        if (v === EMPTY) break;
        if (v === player) { if (path.length) flips.push(...path); break; }
        path.push([r, c]);
        r += dr; c += dc;
      }
    }
    return flips;
  }

  function getLegalMoves(state, player) {
    const moves = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (state[r][c] !== EMPTY) continue;
        if (getFlips(state, r, c, player).length) moves.push({ row: r, col: c });
      }
    }
    return moves;
  }

  function applyMove(state, move, player) {
    const next = state.map(row => row.slice());
    const flips = getFlips(next, move.row, move.col, player);
    next[move.row][move.col] = player;
    for (const [r, c] of flips) next[r][c] = player;
    return next;
  }

  function countPieces(state) {
    let black = 0, white = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (state[r][c] === BLACK) black++;
        else if (state[r][c] === WHITE) white++;
      }
    }
    return { black, white };
  }

  function isGameOver(state) {
    return getLegalMoves(state, BLACK).length === 0 && getLegalMoves(state, WHITE).length === 0;
  }

  function coordsToLabel(row, col) {
    const letters = 'ABCDEFGH';
    return letters[col] + (row + 1);
  }

  // ========= AI Engine (ID + PVS + TT) =========
  const WEIGHTS = [
    [120, -20,  20,  5,  5,  20, -20, 120],
    [-20, -40, -5, -5, -5,  -5, -40, -20],
    [ 20,  -5, 15,  3,  3,  15,  -5,  20],
    [  5,  -5,  3,  2,  2,   3,  -5,   5],
    [  5,  -5,  3,  2,  2,   3,  -5,   5],
    [ 20,  -5, 15,  3,  3,  15,  -5,  20],
    [-20, -40, -5, -5, -5,  -5, -40, -20],
    [120, -20, 20,  5,  5,  20, -20, 120],
  ];
  const CORNERS = [[0,0],[0,SIZE-1],[SIZE-1,0],[SIZE-1,SIZE-1]];
  const ADJACENTS = {
    '0,0': [[0,1],[1,0],[1,1]],
    ['0,'+(SIZE-1)]: [[0,SIZE-2],[1,SIZE-1],[1,SIZE-2]],
    [(SIZE-1)+',0']: [[SIZE-2,0],[SIZE-1,1],[SIZE-2,1]],
    [(SIZE-1)+','+(SIZE-1)]: [[SIZE-2,SIZE-1],[SIZE-1,SIZE-2],[SIZE-2,SIZE-2]],
  };

  function rand64() {
    const a = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const b = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    return BigInt(a) ^ (BigInt(b) << 21n);
  }

  function AIEngine(){ this.initZobrist(); this.tt = new Map(); this.maxNodes = 0; }
  AIEngine.prototype.initZobrist = function(){
    this.zTable = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => [rand64(), rand64()]));
    this.zTurn = rand64();
  };
  AIEngine.prototype.hash = function(state, player){
    let h = 0n;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const v = state[r][c];
      if (v === BLACK) h ^= this.zTable[r][c][0];
      else if (v === WHITE) h ^= this.zTable[r][c][1];
    }
    if (player === BLACK) h ^= this.zTurn;
    return h;
  };
  AIEngine.prototype.orderMoves = function(state, moves, player){
    const corner = (r,c)=> (r===0&&c===0)||(r===0&&c===SIZE-1)||(r===SIZE-1&&c===0)||(r===SIZE-1&&c===SIZE-1);
    return moves.map(m => {
      const isC = corner(m.row, m.col);
      const flips = quickFlipCount(state, m.row, m.col, player);
      const pos = WEIGHTS[m.row][m.col];
      return { move: m, score: (isC?10000:0) + flips*15 + pos };
    }).sort((a,b)=>b.score-a.score).map(x=>x.move);
  };
  function quickFlipCount(state,row,col,player){
    let count = 0;
    for (const [dr,dc] of DIRS) {
      let r=row+dr, c=col+dc, seen=0;
      while (r>=0&&r<SIZE&&c>=0&&c<SIZE) {
        const v = state[r][c];
        if (v===EMPTY) { seen=0; break; }
        if (v===player) { count+=seen; break; }
        seen++; r+=dr; c+=dc;
      }
    }
    return count;
  }
  AIEngine.prototype.evaluate = function(state, player){
    const counts = countPieces(state); const total = counts.black+counts.white; const sign = player;
    const material = sign * (counts.black - counts.white);
    const myMoves = getLegalMoves(state, player).length; const oppMoves = getLegalMoves(state, -player).length; const mobility = myMoves - oppMoves;
    let cornerOwn=0, adjPenalty=0; for (const [cr,cc] of CORNERS) {
      const owner = state[cr][cc];
      if (owner !== EMPTY) cornerOwn += Math.sign(owner) * sign;
      else {
        const adj = ADJACENTS[cr+','+cc];
        for (const [ar,ac] of adj) { const v = state[ar][ac]; if (v !== EMPTY) adjPenalty += Math.sign(v) * sign; }
      }
    }
    let myFrontier=0, oppFrontier=0;
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) {
      const v = state[r][c]; if (v===EMPTY) continue;
      let near=false; for (const [dr,dc] of DIRS) {
        const nr=r+dr, nc=c+dc; if(nr<0||nr>=SIZE||nc<0||nc>=SIZE) continue; if (state[nr][nc]===EMPTY) { near=true; break; }
      }
      if (near) { if (v*sign>0) myFrontier++; else oppFrontier++; }
    }
    const frontier = oppFrontier - myFrontier;
    let positional = 0; for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) positional += WEIGHTS[r][c]*state[r][c]*sign;
    let wMat,wPos,wMob,wCor,wAdj,wFro;
    if (total>=54) { wMat=120; wPos=10; wMob=2; wCor=180; wAdj=20; wFro=10; }
    else if (total>=28) { wMat=12; wPos=22; wMob=18; wCor=140; wAdj=25; wFro=18; }
    else { wMat=1; wPos=28; wMob=14; wCor=110; wAdj=30; wFro=16; }
    return wMat*material + wPos*positional + wMob*mobility + wCor*cornerOwn - wAdj*adjPenalty + wFro*frontier;
  };
  AIEngine.prototype.negamax = function(state, player, depth, alpha, beta, deadline){
    if (performance.now() > deadline) return this.evaluate(state, player);
    if (depth <= 0 || isGameOver(state)) return this.evaluate(state, player);
    const key = this.hash(state, player); const ttE = this.tt.get(key); const alphaOrig = alpha;
    if (ttE && ttE.depth >= depth) {
      if (ttE.flag === 0) return ttE.score;
      else if (ttE.flag === -1) { if (ttE.score < beta) beta = ttE.score; }
      else if (ttE.flag === 1) { if (ttE.score > alpha) alpha = ttE.score; }
      if (alpha >= beta) return ttE.score;
    }
    const moves = getLegalMoves(state, player);
    if (!moves.length) return -this.negamax(state, -player, depth-1, -beta, -alpha, deadline);
    let ordered = this.orderMoves(state, moves, player);
    if (ttE && ttE.move) { const idx = ordered.findIndex(m=>m.row===ttE.move.row && m.col===ttE.move.col); if (idx>0){ const mv=ordered.splice(idx,1)[0]; ordered.unshift(mv); } }
    let best = -Infinity, bestMove = ordered[0];
    for (let i=0;i<ordered.length;i++) {
      if (performance.now() > deadline) break;
      const m = ordered[i]; const child = applyMove(state, m, player);
      let score;
      if (i===0) score = -this.negamax(child, -player, depth-1, -beta, -alpha, deadline);
      else {
        score = -this.negamax(child, -player, depth-1, -alpha-1, -alpha, deadline);
        if (score > alpha && score < beta) score = -this.negamax(child, -player, depth-1, -beta, -alpha, deadline);
      }
      if (score > best) { best = score; bestMove = m; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    let flag = 0; if (best <= alphaOrig) flag = -1; else if (best >= beta) flag = 1; this.tt.set(key, { depth, score: best, flag, move: bestMove });
    return best;
  };
  AIEngine.prototype.chooseMove = function(state, player, opts){
    const timeMs = (opts&&opts.timeMs)||600; const maxDepth=(opts&&opts.maxDepth)||8; const start=performance.now(), deadline=start+timeMs; this.maxNodes=0; this.tt.clear();
    const moves = getLegalMoves(state, player); if (!moves.length) return null; let ordered = this.orderMoves(state, moves, player);
    let bestMove = null, bestScore = -Infinity, pvMove = null, alpha=-Infinity, beta=Infinity;
    for (let depth=2; depth<=maxDepth; depth++) {
      let currentBest=bestMove, currentScore=-Infinity; if (pvMove) { ordered=[pvMove, ...ordered.filter(m=>!(m.row===pvMove.row && m.col===pvMove.col))]; }
      alpha=-Infinity; beta=Infinity;
      for (const m of ordered) {
        if (performance.now() > deadline) break;
        const child = applyMove(state, m, player);
        const score = -this.negamax(child, -player, depth-1, -beta, -alpha, deadline);
        if (score > currentScore) { currentScore = score; currentBest = m; }
        if (score > alpha) alpha = score;
      }
      if (performance.now() > deadline) break;
      bestMove = currentBest; bestScore = currentScore; pvMove = currentBest;
    }
    return bestMove;
  };

  // ========= UI =========
  // 柔和音效（基于 WebAudio 合成，强调高级质感）
  function SoundFX(){
    this.ctx=null; this.enabled=true; this.volume=0.55;
    this._chainReady=false; this._bus=null; this._master=null; this._comp=null; this._softLP=null; this._revSend=null; this._revL=null; this._revR=null;
    this._last={place:0,flips:0}; this._gap={place:0.05,flips:0.08};
  }
  SoundFX.prototype.ensure = function(){
    if(!this.enabled) return null;
    if(!this.ctx){ var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null; this.ctx=new AC(); }
    if(this.ctx.state==='suspended'){ try{ this.ctx.resume(); }catch(e){} }
    if(!this._chainReady) this._setupChain();
    return this.ctx;
  };
  SoundFX.prototype._setupChain = function(){
    var ctx=this.ctx;
    this._bus=ctx.createGain(); this._bus.gain.value=1.0;
    this._softLP=ctx.createBiquadFilter(); this._softLP.type='lowpass'; this._softLP.frequency.value=5600; this._softLP.Q.value=0.707;
    this._comp=ctx.createDynamicsCompressor();
    try{ this._comp.threshold.value=-20; this._comp.knee.value=12; this._comp.ratio.value=2.5; this._comp.attack.value=0.008; this._comp.release.value=0.16; }catch(e){}
    this._master=ctx.createGain(); this._master.gain.value=Math.max(0, Math.min(1, this.volume));
    this._revSend=ctx.createGain(); this._revSend.gain.value=0.05;
    var revLP=ctx.createBiquadFilter(); revLP.type='lowpass'; revLP.frequency.value=3400; revLP.Q.value=0.7;
    this._revL=ctx.createDelay(0.5); this._revR=ctx.createDelay(0.5); this._revL.delayTime.value=0.045; this._revR.delayTime.value=0.065;
    var revGL=ctx.createGain(); revGL.gain.value=0.18; var revGR=ctx.createGain(); revGR.gain.value=0.18;
    var panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    var panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if(panL) panL.pan.value=-0.25; if(panR) panR.pan.value=0.25;

    this._bus.connect(this._softLP).connect(this._comp).connect(this._master).connect(ctx.destination);
    this._revSend.connect(revLP);
    revLP.connect(this._revL).connect(revGL);
    revLP.connect(this._revR).connect(revGR);
    if(panL && panR){ revGL.connect(panL).connect(this._master); revGR.connect(panR).connect(this._master); }
    else { revGL.connect(this._master); revGR.connect(this._master); }
    this._chainReady=true;
  };
  SoundFX.prototype.env = function(g,t0,a,d,s,r,peak){ a=a||0.005; d=d||0.06; s=s||0.0; r=r||0.10; peak=peak||0.05; var now=t0; var vol=Math.max(0, Math.min(1, this.volume)); var pk=Math.max(0.0001, peak*vol); g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(pk, now+a); g.gain.setTargetAtTime(pk*Math.max(0,s), now+a, Math.max(0.005, d*0.6)); g.gain.setTargetAtTime(0.0001, now+a+d, Math.max(0.02, r*0.8)); };
  SoundFX.prototype.setVolume = function(v){ this.volume=Math.max(0, Math.min(1, v)); if(this._master) this._master.gain.value=this.volume; };
  SoundFX.prototype._route = function(gainNode, pan){ if(!gainNode) return; var ctx=this.ctx; if(ctx.createStereoPanner){ var p=ctx.createStereoPanner(); p.pan.value=pan||0; gainNode.connect(p).connect(this._bus); } else { gainNode.connect(this._bus); } };
  SoundFX.prototype._sendReverb = function(node, level){ if(!this._revSend) return; var g=this.ctx.createGain(); g.gain.value=level||0.1; node.connect(g).connect(this._revSend); };
  SoundFX.prototype._noise = function(duration){ var ctx=this.ctx; var dur=(duration||0.12); var len=Math.max(1, Math.floor(dur*ctx.sampleRate)); var buf=ctx.createBuffer(1, len, ctx.sampleRate); var ch=buf.getChannelData(0); for(var i=0;i<len;i++) ch[i]=Math.random()*2-1; var src=ctx.createBufferSource(); src.buffer=buf; return src; };
  SoundFX.prototype.place = function(){
    var ctx=this.ensure(); if(!ctx) return; var t=ctx.currentTime; if((t-this._last.place)<this._gap.place) return; this._last.place=t; var rnd=function(min,max){ return min+Math.random()*(max-min); };
    var pan=rnd(-0.08,0.08);
    // crisp tap
    var tap=this._noise(0.05); var hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=600; hp.Q.value=0.7; var bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=2100; bp.Q.value=2.4; var gt=ctx.createGain(); this.env(gt,t,0.0012,0.026,0.0,0.045,0.025); tap.connect(hp).connect(bp).connect(gt); this._route(gt, pan); this._sendReverb(gt, 0.03); tap.start(t); tap.stop(t+0.045);
    // wood-ish body
    var body=ctx.createOscillator(); body.type='triangle'; var fb=rnd(420,460); body.frequency.setValueAtTime(fb, t); body.frequency.exponentialRampToValueAtTime(fb*0.9, t+0.12); var gb=ctx.createGain(); this.env(gb, t+0.001, 0.005, 0.08, 0.0, 0.12, 0.04); var lpb=ctx.createBiquadFilter(); lpb.type='lowpass'; lpb.frequency.value=3200; lpb.Q.value=0.8; body.connect(gb).connect(lpb); this._route(lpb, pan*0.7); this._sendReverb(gb, 0.05); body.start(t); body.stop(t+0.18);
    // shimmer
    var shimmer=ctx.createOscillator(); shimmer.type='sine'; var fs=rnd(900,1040); shimmer.frequency.setValueAtTime(fs, t+0.003); shimmer.frequency.exponentialRampToValueAtTime(fs*0.85, t+0.09); var gs=ctx.createGain(); this.env(gs, t+0.002, 0.003, 0.05, 0.0, 0.07, 0.014); shimmer.connect(gs); this._route(gs, pan*0.5); this._sendReverb(gs, 0.02); shimmer.start(t); shimmer.stop(t+0.12);
  };
  SoundFX.prototype.flips = function(count, durationSec){ count=count||1; var ctx=this.ensure(); if(!ctx) return; var t=ctx.currentTime; if((t-this._last.flips)<this._gap.flips) return; this._last.flips=t; var rnd=function(min,max){ return min+Math.random()*(max-min); }; var pan=rnd(-0.10,0.10); var dur=Math.min(0.45, Math.max(0.12, durationSec || (0.12 + Math.min(0.3, (count-1)*0.04)))); var n=this._noise(dur); var hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=250; hp.Q.value=0.7; var bp=ctx.createBiquadFilter(); bp.type='bandpass'; var f0=1100+rnd(-60,60); var f1=1750+rnd(-80,80); bp.frequency.setValueAtTime(f0,t); bp.frequency.linearRampToValueAtTime(f1, t+Math.min(0.11, dur*0.7)); bp.Q.value=5.0; var g=ctx.createGain(); this.env(g, t, 0.002, Math.min(0.09, dur*0.6), 0.0, Math.max(0.08, dur*0.5), 0.024); n.connect(hp).connect(bp).connect(g); this._route(g, pan); this._sendReverb(g, 0.06); n.start(t); n.stop(t+dur); };
  function OthelloApp() {
    this.boardEl = document.getElementById('board');
    this.turnEl = document.getElementById('turn');
    this.scoreEl = document.getElementById('score');
    this.msgEl = document.getElementById('msg');
    this.modeSel = document.getElementById('mode');
    this.strengthSel = document.getElementById('strength');
    this.threadsSel = document.getElementById('threads');
    this.showHintsChk = document.getElementById('showHints');
    this.showCoordsChk = document.getElementById('showCoords');
    this.sndEnableChk = document.getElementById('sndEnable');
    this.sndVolume = document.getElementById('sndVolume');
    this.moveListEl = document.getElementById('move-list');
    this.undoBtn = document.getElementById('undo');
    this.resetBtn = document.getElementById('reset');
    this.pauseBtn = document.getElementById('pause');
    this.showHints = true;
    this.showCoords = true;
    this.ai = new AIEngine(); this.snd = new SoundFX(); this.history=[]; this.lastMove=null; this.board=createInitialBoard(); this.currentPlayer=BLACK; this.prevCounts=null;
    this.onCellClick = this.onCellClick.bind(this); this.bind(); this.render();
  }
  OthelloApp.prototype.bind = function(){
    this.resetBtn && this.resetBtn.addEventListener('click', ()=>this.reset());
    this.undoBtn && this.undoBtn.addEventListener('click', ()=>this.undo());
    this.modeSel && this.modeSel.addEventListener('change', ()=>{ this.maybeTriggerAI(); this.updatePauseButton(); });
    this.strengthSel && this.strengthSel.addEventListener('change', ()=>{ this.maybeTriggerAI(); });

    if (this.showHintsChk) {
      this.showHints = !!this.showHintsChk.checked;
      this.showHintsChk.addEventListener('change', ()=>{ this.showHints = !!this.showHintsChk.checked; this.render(); window.requestFit && window.requestFit(); });
    }
    if (this.showCoordsChk) {
      this.showCoords = !!this.showCoordsChk.checked;
      this.showCoordsChk.addEventListener('change', ()=>{
        var board = document.getElementById('board');
        if (board) board.classList.toggle('show-coords', !!this.showCoordsChk.checked);
        this.showCoords = !!this.showCoordsChk.checked;
        window.requestFit && window.requestFit();
      });
    }

    if (this.pauseBtn) {
      this.pauseBtn.addEventListener('click', ()=>{
        if (this.modeSel && this.modeSel.value !== 'aa') return;
        this.paused = !this.paused;
        this.updatePauseButton();
        if (!this.paused) this.maybeTriggerAI(); else { this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); }
      });
    }

    if (this.sndEnableChk) {
      this.snd.enabled = !!this.sndEnableChk.checked;
      this.sndEnableChk.addEventListener('change', ()=>{ this.snd.enabled = !!this.sndEnableChk.checked; });
    }
    if (this.sndVolume) {
      var v = Math.max(0, Math.min(100, Number(this.sndVolume.value)||55));
      this.snd.setVolume(v/100);
      this.sndVolume.addEventListener('input', ()=>{
        var vv = Math.max(0, Math.min(100, Number(this.sndVolume.value)||55));
        this.snd.setVolume(vv/100);
      });
    }

    // 键盘快捷键: U=悔棋, R=重开, H=提示, C=坐标
    window.addEventListener('keydown', (e)=>{
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.key==='u'||e.key==='U') { e.preventDefault(); this.undo(); }
      else if (e.key==='r'||e.key==='R') { e.preventDefault(); this.reset(); }
      else if (e.key==='h'||e.key==='H') { e.preventDefault(); this.showHintsChk && this.showHintsChk.click(); }
      else if (e.key==='c'||e.key==='C') { e.preventDefault(); this.showCoordsChk && this.showCoordsChk.click(); }
    });

    // 右键棋盘格子：自定义坐标气泡
    if (this.boardEl) {
      this.boardEl.addEventListener('contextmenu', (e)=>{
        const cell = (e.target && e.target.closest) ? e.target.closest('.cell') : null;
        if (!cell) return; // 非棋盘区域，保留系统菜单
        e.preventDefault();
        const r = Number(cell.dataset.row), c = Number(cell.dataset.col);
        this.showCoordPopup && this.showCoordPopup(r, c);
      });
    }
    document.addEventListener('mousedown', (e)=>{
      if (!this.coordPopupEl || !this.coordPopupEl.classList || !this.coordPopupEl.classList.contains('show')) return;
      if (e.target===this.coordPopupEl || (this.coordPopupEl.contains && this.coordPopupEl.contains(e.target))) return;
      this.hideCoordPopup && this.hideCoordPopup();
    });
    window.addEventListener('keydown', (e)=>{ if (e.key==='Escape') { this.hideCoordPopup && this.hideCoordPopup(); } });

    this.updatePauseButton();
  };
  OthelloApp.prototype.reset = function(){ this.board=createInitialBoard(); this.currentPlayer=BLACK; this.history=[]; this.lastMove=null; if(this.moveListEl) this.moveListEl.innerHTML=''; this.render(); this.maybeTriggerAI(); window.requestFit && window.requestFit(); };
  OthelloApp.prototype.undo = function(){ if(!this.history.length) return; const prev=this.history.pop(); this.board=prev.board; this.currentPlayer=prev.player; this.lastMove=prev.lastMove||null; this.render(); if(this.moveListEl && this.moveListEl.lastElementChild) { this.moveListEl.removeChild(this.moveListEl.lastElementChild); } window.requestFit && window.requestFit(); };
  OthelloApp.prototype.isAIPlaying = function(color){ const mode=this.modeSel.value; if(mode==='aa') return true; if(mode==='hb') return color===WHITE; if(mode==='bh') return color===BLACK; return false; };
  OthelloApp.prototype.strengthPreset = function(){ const v=this.strengthSel.value; if(v==='fast') return {timeMs:200,maxDepth:6}; if(v==='balanced') return {timeMs:600,maxDepth:8}; if(v==='strong') return {timeMs:1200,maxDepth:10}; if(v==='ultra') return {timeMs:2000,maxDepth:12}; return {timeMs:600,maxDepth:8}; };
  OthelloApp.prototype.onCellClick = function(ev){ const cell=ev.currentTarget; const r=Number(cell.dataset.row), c=Number(cell.dataset.col); if(this.isAIPlaying(this.currentPlayer)) return; const flips=getFlips(this.board,r,c,this.currentPlayer); if(!flips.length) return; const sideText = (this.currentPlayer===BLACK?'黑':'白'); this.pushHistory(); this.board[r][c]=this.currentPlayer; for(const [fr,fc] of flips) this.board[fr][fc]=this.currentPlayer; this.lastMove={row:r,col:c}; const placed={row:r,col:c}; const flipList=flips.slice(); this.currentPlayer*=-1; this.render(); this.appendMoveToList && this.appendMoveToList(sideText, {row:r,col:c}); setTimeout(()=>this.animateMove(placed, flipList),0); this.maybeTriggerAI(); };
  OthelloApp.prototype.pushHistory = function(){ this.history.push({board:this.board.map(row=>row.slice()), player:this.currentPlayer, lastMove:this.lastMove?{row:this.lastMove.row,col:this.lastMove.col}:null}); if(this.history.length>200) this.history.shift(); };
  OthelloApp.prototype.maybeTriggerAI = function(){
    // Pause in AI vs AI
    if(this.modeSel.value==='aa' && this.paused) return;
    // Game over? stop.
    const legal=getLegalMoves(this.board,this.currentPlayer);
    if(isGameOver(this.board)) return;
    // Handle no-legal-move for both human and AI turns
    if(!legal.length){
      this.msgEl.textContent='无棋可下，自动轮空';
      this.currentPlayer*=-1;
      this.render();
      // If it becomes AI's turn, keep going automatically
      if(this.isAIPlaying(this.currentPlayer)) setTimeout(()=>this.maybeTriggerAI(),10);
      return;
    }
    // If it's not AI's turn, nothing else to do
    if(!this.isAIPlaying(this.currentPlayer)) return;
    const opts=this.strengthPreset();
    const me=this.currentPlayer;
    this.turnEl.textContent='AI 思考中… ('+(me===BLACK?'黑':'白')+'方)';
    this.turnEl.classList.add('thinking'); this.msgEl.textContent=''; this.msgEl.classList.add('thinking');
    setTimeout(()=>{ if(this.modeSel.value==='aa' && this.paused){ this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); return; } const move=this.ai.chooseMove(this.board,me,opts); if(move){ this.lastMove={row:move.row, col:move.col}; this.render(); this.msgEl.textContent='AI 计划落子：'+coordsToLabel(move.row, move.col); setTimeout(()=>{ if(this.modeSel.value==='aa' && this.paused){ this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); return; } const flips=getFlips(this.board,move.row,move.col,me); this.pushHistory(); this.board[move.row][move.col]=me; for(const [fr,fc] of flips) this.board[fr][fc]=me; this.msgEl.textContent='AI 落子：'+coordsToLabel(move.row, move.col); const placed={row:move.row,col:move.col}; const flipList=flips.slice(); const sideText=(me===BLACK?'黑':'白'); this.currentPlayer*=-1; this.render(); this.appendMoveToList && this.appendMoveToList(sideText, {row:move.row, col:move.col}); setTimeout(()=>this.animateMove(placed, flipList),0); setTimeout(()=>this.maybeTriggerAI(),10); },180); return; } this.currentPlayer*=-1; this.render(); setTimeout(()=>this.maybeTriggerAI(),10); },50);
  };
  OthelloApp.prototype.updatePauseButton = function(){ var aa = this.modeSel.value==='aa'; if (!this.pauseBtn) return; this.pauseBtn.style.display = aa ? '' : 'none'; this.pauseBtn.textContent = this.paused ? '继续' : '暂停'; };
  OthelloApp.prototype.getCellEl = function(r,c){ return this.boardEl.querySelector('.cell[data-row="' + r + '"][data-col="' + c + '"]'); };
  OthelloApp.prototype.animateMove = function(move, flips){ const placeCell=this.getCellEl(move.row, move.col); if(placeCell){ const disc=placeCell.querySelector('.disc'); if(disc){ disc.classList.remove('place'); disc.style.animation='none'; requestAnimationFrame(()=>{ disc.style.removeProperty('animation'); disc.classList.add('place'); }); } } this.snd && this.snd.place(); if(flips && flips.length){ const entries = flips.map((f,idx)=>{ const cell=this.getCellEl(f[0], f[1]); if(!cell) return null; const disc=cell.querySelector('.disc'); if(!disc) return null; disc.style.setProperty('--flip-delay', (idx*80)+'ms'); return {disc, idx}; }).filter(Boolean); requestAnimationFrame(()=>{ entries.forEach(({disc})=>{ disc.classList.remove('colorflip'); disc.style.animation='none'; }); requestAnimationFrame(()=>{ entries.forEach(({disc})=>{ disc.style.removeProperty('animation'); disc.classList.add('colorflip'); }); var totalMs=Math.max(120, (entries.length-1)*80 + 140); this.snd && this.snd.flips(entries.length, totalMs/1000); }); }); } this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); };

  OthelloApp.prototype.render = function(){
    this.boardEl.innerHTML = '';
    const legal = getLegalMoves(this.board, this.currentPlayer);
    for (let r=0; r<SIZE; r++) {
      for (let c=0; c<SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r; cell.dataset.col = c;
        cell.dataset.rowlabel = String(r+1);
        cell.dataset.collabel = 'ABCDEFGH'[c];
        // Remove native browser tooltip on hover by not setting title
        const v = this.board[r][c];
        if (v !== EMPTY) {
          const disc = document.createElement('div');
          disc.className = 'disc ' + (v===BLACK ? 'black' : 'white');
          cell.appendChild(disc);
        } else if (this.showHints && legal.some(m => m.row===r && m.col===c)) {
          cell.classList.add('hint');
          var dot=document.createElement('span'); dot.className='hint-dot'; cell.appendChild(dot);
        }
        if (this.lastMove && this.lastMove.row===r && this.lastMove.col===c) cell.classList.add('last-move');
        cell.addEventListener('click', this.onCellClick);
        this.boardEl.appendChild(cell);
      }
    }
    const counts = countPieces(this.board);
    const playerText = this.currentPlayer===BLACK ? '黑棋' : '白棋';
    if (this.turnEl) this.turnEl.textContent = '当前轮到：' + playerText;
    if (this.scoreEl) this.scoreEl.textContent = '黑棋 ' + counts.black + ' : ' + counts.white + ' 白棋';
    var sbEl=document.getElementById('score-black'); var swEl=document.getElementById('score-white');
    if (sbEl) sbEl.textContent = String(counts.black);
    if (swEl) swEl.textContent = String(counts.white);
    var total = counts.black + counts.white; var blackPct = total ? Math.round((counts.black/total)*100) : 50; var whitePct = 100 - blackPct;
    var sb=document.getElementById('scorebar'); if (sb){ var b=sb.querySelector('.black'); var w=sb.querySelector('.white'); if(b&&w){ b.style.flexBasis = blackPct+'%'; w.style.flexBasis = whitePct+'%'; } if(!this.prevCounts || this.prevCounts.black!==counts.black || this.prevCounts.white!==counts.white){ sb.classList.remove('pulse'); void sb.offsetWidth; sb.classList.add('pulse'); setTimeout(function(){ sb.classList && sb.classList.remove('pulse'); }, 480); } }
    this.prevCounts = counts;
    if (isGameOver(this.board)) {
      const winner = counts.black===counts.white ? '平局' : (counts.black>counts.white ? '黑棋胜' : '白棋胜');
      this.turnEl.textContent = '对局结束：' + winner;
      this.msgEl.textContent = '结束总子数：' + (counts.black + counts.white);
      var go=document.getElementById('gameover'); if(go){
        var t=go.querySelector('.go-title'); if(t) t.textContent='对局结束：' + winner;
        var s=go.querySelector('.go-sub'); if(s) s.textContent='黑 ' + counts.black + ' : ' + counts.white + ' 白 · 总子数 ' + (counts.black+counts.white);
        var btn=document.getElementById('go-reset'); if(btn && !btn._bound){ btn._bound=true; btn.addEventListener('click', ()=>this.reset()); }
        go.hidden=false;
      }
    } else { var go2=document.getElementById('gameover'); if(go2) go2.hidden=true; }
  };

  OthelloApp.prototype.appendMoveToList = function(sideText, move){
    if (!this.moveListEl) return; var li=document.createElement('li'); li.textContent = sideText + '：' + coordsToLabel(move.row, move.col); this.moveListEl.appendChild(li); this.moveListEl.scrollTop=this.moveListEl.scrollHeight; window.requestFit && window.requestFit();
  };

  // Right-click coordinate popup helpers (file:// build)
  OthelloApp.prototype.ensureCoordPopup = function(){
    if (this.coordPopupEl) return this.coordPopupEl;
    const el = document.createElement('div');
    el.className = 'coord-popup';
    el.setAttribute('role','dialog');
    el.setAttribute('aria-label','坐标');
    el.style.position='fixed'; el.style.left='0px'; el.style.top='0px';
    document.body.appendChild(el);
    this.coordPopupEl = el; return el;
  };
  OthelloApp.prototype.showCoordPopup = function(r,c,clientX,clientY){
    const el = this.ensureCoordPopup();
    const label = coordsToLabel(r,c);
    el.innerHTML = '<div class="coord-title">坐标</div><div class="coord-value">' + label + '</div>';
    el.classList.add('show');
    const pad=8, gap=10; // viewport padding and cell gap
    const cell = this.getCellEl(r,c);
    let anchorX = clientX||0, anchorTop = clientY||0;
    if (cell && cell.getBoundingClientRect) {
      const cr = cell.getBoundingClientRect();
      anchorX = cr.left + cr.width/2;
      anchorTop = cr.top;
    }
    // place to measure
    el.style.left = Math.max(pad, anchorX) + 'px';
    el.style.top = Math.max(pad, anchorTop) + 'px';
    const pr = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.round(anchorX - pr.width/2);
    let top = Math.round(anchorTop - pr.height - gap);
    if (top < pad) top = Math.min(vh - pr.height - pad, (cell ? (cell.getBoundingClientRect().bottom + gap) : (anchorTop + gap)));
    if (left < pad) left = pad;
    if (left + pr.width + pad > vw) left = Math.max(pad, vw - pr.width - pad);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  };
  OthelloApp.prototype.hideCoordPopup = function(){ if (this.coordPopupEl) this.coordPopupEl.classList.remove('show'); };

  // ========= Bootstrap =========
  (function(){
    function boot(){ if (window.__OTHELLO_BOOTSTRAPPED__) return; window.__OTHELLO_BOOTSTRAPPED__=true; try { new OthelloApp(); } catch(e){ console.error(e); } }
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', boot);
    } else {
      // DOM 已就绪（例如通过动态插入脚本），直接启动
      boot();
    }
  })();
})();
