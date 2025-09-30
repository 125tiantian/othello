import { SIZE, BLACK, WHITE, EMPTY, createInitialBoard, getLegalMoves, getFlips, applyMove, countPieces, isGameOver, coordsToLabel } from './othello.js';
import { AIEngine } from './ai.parallel.js';

export class OthelloApp {
  constructor() {
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
    this.undoBtn = document.getElementById('undo');
    this.resetBtn = document.getElementById('reset');
    this.pauseBtn = document.getElementById('pause');
    this.focusBtn = document.getElementById('focus');
    this.settingsBtn = document.getElementById('settings');
    this.scrimEl = document.getElementById('overlay-scrim');
    this.closeSettingsBtn = document.getElementById('close-settings');
    this.themeBtn = document.getElementById('theme');

    this.ai = new AIEngine();
    this.snd = new SoundFX();
    this.history = [];
    this.lastMove = null; // {row,col}
    this.moveListEl = document.getElementById('move-list');
    this.showHints = true;
    this.showCoords = true;
    this.prevCounts = null;
    this.coordPopupEl = null;
    // 手机长按坐标弹出状态
    this._lp = { timer: 0, x: 0, y: 0, cell: null, fired: false };
    this._suppressClickUntil = 0;
    // AI 搜索令牌：用于在悔棋/模式切换等情况下取消旧的 AI 结果提交
    this._aiToken = 0;

    this.board = createInitialBoard();
    this.currentPlayer = BLACK; // black starts

    // bind handlers
    this.onCellClick = this.onCellClick.bind(this);
    this.bind();
    this.render();
    if (window.requestFit) window.requestFit();
    // 恢复主题
    const savedTheme = (localStorage.getItem('theme') || 'default');
    const appEl = document.querySelector('.app');
    if (savedTheme === 'wood') appEl.classList.add('theme-wood');
    if (this.themeBtn) this.themeBtn.textContent = appEl.classList.contains('theme-wood') ? '浅色简约' : '浅色木纹';
    // 恢复专注模式
    if (localStorage.getItem('focus-mode') === '1') {
      appEl.classList.add('focus-mode');
      if (this.focusBtn) this.focusBtn.textContent = '退出专注';
    }

    // 初始化移动端设置按钮显示逻辑（CSS 已控制显示/隐藏，这里仅保证可用）
    this.setupMobileSettings();
  }

  bind() {
    this.resetBtn.addEventListener('click', () => this.reset());
    this.undoBtn.addEventListener('click', () => this.undo());
    this.modeSel.addEventListener('change', () => {
      this.maybeTriggerAI();
    });
    this.strengthSel.addEventListener('change', () => {
      this.maybeTriggerAI();
    });
    this.showHintsChk.addEventListener('change', () => {
      this.showHints = !!this.showHintsChk.checked;
      this.render();
      if (window.requestFit) window.requestFit();
    });
    this.showCoordsChk.addEventListener('change', () => {
      this.showCoords = !!this.showCoordsChk.checked;
      const board = document.getElementById('board');
      board.classList.toggle('show-coords', this.showCoords);
      if (window.requestFit) window.requestFit();
    });
    this.threadsSel.addEventListener('change', () => {
      const v = this.threadsSel.value;
      if (v === 'auto') {
        this.ai.setThreads && this.ai.setThreads(null);
      } else if (v === 'max') {
        this.ai.setThreads && this.ai.setThreads(navigator.hardwareConcurrency || 8);
      } else {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) this.ai.setThreads && this.ai.setThreads(n);
      }
      this.maybeTriggerAI();
    });

    // 美化下拉：保留原生 select 做数据与回退，界面使用自定义浮层
    this.enhanceFancySelect(this.modeSel, [
      { value: 'hh', label: '人类 vs 人类' },
      { value: 'hb', label: '人类(黑) vs AI(白)' },
      { value: 'bh', label: 'AI(黑) vs 人类(白)' },
      { value: 'aa', label: 'AI vs AI', badge: '演示' },
    ]);
    this.enhanceFancySelect(this.strengthSel, [
      { value: 'fast', label: '快' },
      { value: 'balanced', label: '平衡' },
      { value: 'strong', label: '强' },
      { value: 'ultra', label: '特强' },
    ]);
    this.enhanceFancySelect(this.threadsSel, [
      { value: 'auto', label: '自动' },
      { value: '2', label: '2' },
      { value: '4', label: '4' },
      { value: '8', label: '8' },
      { value: 'max', label: '全部' },
    ]);
    if (this.sndEnableChk) {
      this.snd.enabled = !!this.sndEnableChk.checked;
      this.sndEnableChk.addEventListener('change', () => {
        this.snd.enabled = !!this.sndEnableChk.checked;
      });
    }
    if (this.sndVolume) {
      const v = Math.max(0, Math.min(100, Number(this.sndVolume.value)||55));
      this.snd.setVolume(v/100);
      this.sndVolume.addEventListener('input', () => {
        const vv = Math.max(0, Math.min(100, Number(this.sndVolume.value)||55));
        this.snd.setVolume(vv/100);
      });
    }
    this.modeSel.addEventListener('change', () => this.updatePauseButton());
    this.pauseBtn.addEventListener('click', () => {
      if (this.modeSel.value !== 'aa') return;
      this.paused = !this.paused;
      this.updatePauseButton();
      if (!this.paused) {
        // resume
        this.maybeTriggerAI();
      } else {
        // pause: clear thinking indicator
        this.turnEl.classList.remove('thinking');
        this.msgEl.classList.remove('thinking');
      }
    });

    // 专注对局按钮/快捷键
    if (this.focusBtn) {
      this.focusBtn.addEventListener('click', () => this.toggleFocusMode());
    }
    // 设置按钮：打开移动端抽屉
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => this.openSettings());
    }
    if (this.scrimEl) {
      this.scrimEl.addEventListener('click', () => this.closeSettings());
    }
    if (this.closeSettingsBtn) {
      this.closeSettingsBtn.addEventListener('click', () => this.closeSettings());
    }
    // 主题切换
    if (this.themeBtn) {
      this.themeBtn.addEventListener('click', () => {
        const app = document.querySelector('.app');
        app.classList.toggle('theme-wood');
        const cur = app.classList.contains('theme-wood') ? 'wood' : 'default';
        localStorage.setItem('theme', cur);
        this.themeBtn.textContent = app.classList.contains('theme-wood') ? '浅色简约' : '浅色木纹';
        if (window.requestFit) window.requestFit();
      });
    }

    // 键盘快捷键: U=悔棋, R=重开, H=提示, C=坐标
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); this.undo(); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.reset(); }
      else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); this.showHintsChk.click(); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); this.showCoordsChk.click(); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.toggleFocusMode(); }
    });

    // 右键棋盘单元格：弹出自定义坐标气泡
    this.boardEl.addEventListener('contextmenu', (e) => {
      const cell = (e.target && e.target.closest) ? e.target.closest('.cell') : null;
      if (!cell) return; // 非棋盘格子，保留浏览器菜单
      e.preventDefault();
      const r = Number(cell.dataset.row);
      const c = Number(cell.dataset.col);
      this.showCoordPopup(r, c);
    });

    // 点击空白或按 ESC 关闭气泡
    document.addEventListener('mousedown', (e) => {
      if (!this.coordPopupEl || !this.coordPopupEl.classList.contains('show')) return;
      if (e.target === this.coordPopupEl || (this.coordPopupEl.contains && this.coordPopupEl.contains(e.target))) return;
      this.hideCoordPopup();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideCoordPopup();
    });

    // 手机：长按 500ms 显示坐标气泡；松手关闭；移动超阈值取消
    const pressMs = 500, moveTol = 10; // px
    const getCellFromTouch = (tgt) => (tgt && tgt.closest) ? tgt.closest('.cell') : null;
    this.boardEl.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      const cell = getCellFromTouch(e.target);
      if (!cell) return;
      this._lp.cell = cell;
      this._lp.x = t.clientX; this._lp.y = t.clientY; this._lp.fired = false;
      if (this._lp.timer) clearTimeout(this._lp.timer);
      this._lp.timer = setTimeout(() => {
        if (!this._lp.cell) return;
        const r = Number(this._lp.cell.dataset.row);
        const c = Number(this._lp.cell.dataset.col);
        this.showCoordPopup(r, c, this._lp.x, this._lp.y);
        this._lp.fired = true;
        // 抑制接下来的点击，避免误落子
        this._suppressClickUntil = Date.now() + 600;
      }, pressMs);
    }, { passive: true });
    this.boardEl.addEventListener('touchmove', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      const dx = t.clientX - this._lp.x;
      const dy = t.clientY - this._lp.y;
      if (Math.hypot(dx, dy) > moveTol) {
        if (this._lp.timer) { clearTimeout(this._lp.timer); this._lp.timer = 0; }
        if (this._lp.fired) this.hideCoordPopup();
      }
    }, { passive: true });
    const endPress = () => {
      if (this._lp.timer) { clearTimeout(this._lp.timer); this._lp.timer = 0; }
      if (this._lp.fired) this.hideCoordPopup();
      this._lp.cell = null; this._lp.fired = false;
    };
    this.boardEl.addEventListener('touchend', () => endPress(), { passive: true });
    this.boardEl.addEventListener('touchcancel', () => endPress(), { passive: true });
  }

  // 创建自定义下拉并与原生 select 同步
  enhanceFancySelect(selectEl, items){
    if (!selectEl || selectEl._enhanced) return;
    selectEl._enhanced = true;
    selectEl.classList.add('enhanced-native');
    const wrap = document.createElement('div');
    wrap.className = 'fancy-select';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fs-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'fs-panel';
    panel.setAttribute('role', 'listbox');

    const current = () => items.find(i=>i.value===selectEl.value) || items[0];
    const setBtnText = () => { btn.textContent = (current().label || ''); };
    const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded','false'); };
    const open = () => { wrap.classList.add('open'); btn.setAttribute('aria-expanded','true'); };
    const toggle = () => { if (wrap.classList.contains('open')) close(); else open(); };

    const renderOptions = ()=>{
      panel.innerHTML='';
      items.forEach(it=>{
        const opt = document.createElement('div');
        opt.className = 'fs-option';
        opt.setAttribute('role','option');
        opt.setAttribute('data-value', it.value);
        opt.setAttribute('aria-selected', String(selectEl.value===it.value));
        opt.textContent = it.label;
        if (it.badge){ const b=document.createElement('span'); b.className='fs-badge'; b.textContent=it.badge; opt.appendChild(b); }
        opt.addEventListener('click', ()=>{
          if (selectEl.value !== it.value) {
            selectEl.value = it.value;
            const evt = new Event('change', { bubbles: true });
            selectEl.dispatchEvent(evt);
          }
          setBtnText(); renderOptions(); close();
        });
        panel.appendChild(opt);
      });
    };

    setBtnText();
    renderOptions();
    btn.addEventListener('click', toggle);
    document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) close(); });
    selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);
    wrap.appendChild(btn); wrap.appendChild(panel);
  }

  ensureCoordPopup() {
    if (this.coordPopupEl) return this.coordPopupEl;
    const el = document.createElement('div');
    el.className = 'coord-popup';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '坐标');
    el.style.position = 'fixed';
    el.style.left = '0px';
    el.style.top = '0px';
    document.body.appendChild(el);
    this.coordPopupEl = el;
    return el;
  }

  showCoordPopup(r, c, clientX, clientY) {
    const el = this.ensureCoordPopup();
    const label = coordsToLabel(r, c);
    el.innerHTML = `<div class="coord-title">坐标</div><div class="coord-value">${label}</div>`;
    el.classList.add('show');

    // 以格子为锚点，定位在格子上方（必要时自动下方/左右修正）
    const pad = 8;      // 视口边距
    const gap = 10;     // 与格子间距
    const cell = this.getCellEl(r, c);
    // 默认使用格子锚定；若无格子元素，回退到鼠标坐标（兼容旧签名）
    let anchorX = clientX || 0;
    let anchorTop = clientY || 0;
    if (cell && cell.getBoundingClientRect) {
      const cr = cell.getBoundingClientRect();
      anchorX = cr.left + cr.width / 2;
      anchorTop = cr.top; // 顶边
    }
    // 初次放置以便测量
    el.style.left = Math.max(pad, anchorX) + 'px';
    el.style.top = Math.max(pad, anchorTop) + 'px';
    const pr = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.round(anchorX - pr.width / 2);
    let top = Math.round(anchorTop - pr.height - gap);
    // 若上方放不下，则放到格子下方
    if (top < pad) top = Math.min(vh - pr.height - pad, (cell ? (cell.getBoundingClientRect().bottom + gap) : (anchorTop + gap)));
    // 左右边界修正
    if (left < pad) left = pad;
    if (left + pr.width + pad > vw) left = Math.max(pad, vw - pr.width - pad);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  hideCoordPopup() {
    if (this.coordPopupEl) this.coordPopupEl.classList.remove('show');
  }

  reset() {
    this.board = createInitialBoard();
    this.currentPlayer = BLACK;
    this.history = [];
    this.lastMove = null;
    if (this.moveListEl) this.moveListEl.innerHTML = '';
    this.render();
    this.maybeTriggerAI();
    if (window.requestFit) window.requestFit();
  }

  undo() {
    if (this.history.length === 0) return;

    // 取消任何未完成的 AI 思考提交
    this._aiToken++;
    this.turnEl.classList.remove('thinking');
    this.msgEl.classList.remove('thinking');

    const mode = this.modeSel.value;
    const humanColor = (mode === 'hb') ? BLACK : (mode === 'bh') ? WHITE : null;

    if (humanColor == null) {
      // 人 vs 人 或 AI vs AI：维持原单步悔棋
      const prev = this.history.pop();
      this.board = prev.board;
      this.currentPlayer = prev.player;
      this.lastMove = prev.lastMove ?? null;
      this.render();
      if (this.moveListEl && this.moveListEl.lastElementChild) {
        this.moveListEl.removeChild(this.moveListEl.lastElementChild);
      }
      if (window.requestFit) window.requestFit();
      return;
    }

    // 人机模式：一直撤到“人类上一步之前”的局面
    // pushHistory() 在每次落子前入栈，元素 prev.player == 当手落子方
    // 因此我们循环弹出：若最后一步是 AI，则先撤 AI；直到撤到一次“人类落子”为止
    while (this.history.length > 0) {
      const prev = this.history.pop();
      const mover = prev.player; // 刚被撤销的那步是谁下的

      this.board = prev.board;
      this.currentPlayer = prev.player;
      this.lastMove = prev.lastMove ?? null;

      if (mover === humanColor) {
        // 棋谱列表仅记录人类步，撤到人类步时移除一行
        if (this.moveListEl && this.moveListEl.lastElementChild) {
          this.moveListEl.removeChild(this.moveListEl.lastElementChild);
        }
        break; // 到达“人类上一步之前”的局面
      }
      // mover 为 AI，继续再撤一手
    }

    this.render();
    if (window.requestFit) window.requestFit();
  }

  isAIPlaying(color) {
    const mode = this.modeSel.value; // 'hh', 'hb', 'bh', 'aa'
    if (mode === 'aa') return true;
    if (mode === 'hb') return color === WHITE;
    if (mode === 'bh') return color === BLACK;
    return false;
  }

  strengthPreset() {
    const v = this.strengthSel.value;
    switch (v) {
      case 'fast': return { timeMs: 200, maxDepth: 6 };
      case 'balanced': return { timeMs: 600, maxDepth: 8 };
      case 'strong': return { timeMs: 1200, maxDepth: 10 };
      case 'ultra': return { timeMs: 2000, maxDepth: 12 };
      default: return { timeMs: 600, maxDepth: 8 };
    }
  }

  onCellClick(ev) {
    if (isGameOver(this.board)) return; // 禁止在对局结束后继续落子（回顾模式下允许看盘不落子）
    if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) {
      ev.preventDefault && ev.preventDefault();
      return;
    }
    const cell = ev.currentTarget;
    const r = Number(cell.dataset.row);
    const c = Number(cell.dataset.col);

    if (this.isAIPlaying(this.currentPlayer)) return; // player's turn only

    const flips = getFlips(this.board, r, c, this.currentPlayer);
    if (!flips.length) return;

    this.pushHistory();
    this.board[r][c] = this.currentPlayer;
    for (const [fr, fc] of flips) this.board[fr][fc] = this.currentPlayer;
    this.lastMove = { row: r, col: c };
    const placed = { row: r, col: c };
    const flipList = flips.slice();
    const sideText = this.currentPlayer === BLACK ? '黑' : '白';
    this.currentPlayer *= -1;
    this.render();
    this.appendMoveToList(sideText, { row: r, col: c });
    // run animations after paint
    setTimeout(() => this.animateMove(placed, flipList), 0);
    this.maybeTriggerAI();
  }

  pushHistory() {
    this.history.push({
      board: this.board.map(row => row.slice()),
      player: this.currentPlayer,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
    });
    if (this.history.length > 200) this.history.shift();
  }

  maybeTriggerAI() {
    // Pause applies to AI vs AI mode
    if (this.modeSel.value === 'aa' && this.paused) return;
    // If game over, stop.
    if (isGameOver(this.board)) return;

    // First handle "no legal move" for whoever's turn (human or AI)
    const legal = getLegalMoves(this.board, this.currentPlayer);
    if (legal.length === 0) {
      // auto-pass turn
      this.msgEl.textContent = '无棋可下，自动轮空';
      this.currentPlayer *= -1;
      this.render();
      // If it becomes AI's turn next, continue to let AI move
      if (this.isAIPlaying(this.currentPlayer)) {
        setTimeout(() => this.maybeTriggerAI(), 10);
      }
      return;
    }

    // If it's not AI's turn, nothing further to do
    if (!this.isAIPlaying(this.currentPlayer)) return;

    const opts = this.strengthPreset();
    const me = this.currentPlayer;
    this.turnEl.textContent = `AI 思考中… (${me === BLACK ? '黑' : '白'}方)`;
    this.turnEl.classList.add('thinking');
    this.msgEl.textContent = '';
    this.msgEl.classList.add('thinking');

    // compute on next tick to allow UI to update
    setTimeout(() => {
      if (this.modeSel.value === 'aa' && this.paused) { this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); return; }
      // 记录此轮思考令牌；若之后令牌变化（悔棋/模式切换等），则丢弃结果
      const token = ++this._aiToken;
      Promise.resolve(this.ai.chooseMove(this.board, me, opts))
        .then(move => {
          if (this._aiToken !== token) return; // 结果已过期
          if (!move) {
            // 无路可走
            this.currentPlayer *= -1;
            this.render();
            setTimeout(() => this.maybeTriggerAI(), 10);
            return;
          }
          if (this._aiToken !== token) return; // 结果已过期
          if (this.modeSel.value === 'aa' && this.paused) { this.turnEl.classList.remove('thinking'); this.msgEl.classList.remove('thinking'); return; }
          // 直接落子（不做预高亮，避免闪烁）
          const flips = getFlips(this.board, move.row, move.col, me);
          this.pushHistory();
          this.board[move.row][move.col] = me;
          for (const [fr, fc] of flips) this.board[fr][fc] = me;
          this.lastMove = { row: move.row, col: move.col };
          this.msgEl.textContent = `AI 落子：${coordsToLabel(move.row, move.col)}`;
          const placed = { row: move.row, col: move.col };
          const flipList = flips.slice();
          this.currentPlayer *= -1;
          this.render();
          setTimeout(() => this.animateMove(placed, flipList), 0);
          setTimeout(() => this.maybeTriggerAI(), 10);
        })
        .catch(err => {
          console.error('AI move failed', err);
          this.turnEl.classList.remove('thinking');
          this.msgEl.classList.remove('thinking');
          this.msgEl.textContent = 'AI 计算遇到问题';
        });
    }, 50);
  }

  getCellEl(r, c) {
    return this.boardEl.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  }

  animateMove(move, flips) {
    const placeCell = this.getCellEl(move.row, move.col);
    if (placeCell) {
      const disc = placeCell.querySelector('.disc');
      if (disc) {
        // restart place animation in a batched way for smoothness
        disc.classList.remove('place');
        disc.style.animation = 'none';
        requestAnimationFrame(() => {
          disc.style.removeProperty('animation');
          disc.classList.add('place');
    });

    // 回顾模式（dock）下：悬停棋盘展开胜利卡
    this.boardEl.addEventListener('mouseenter', () => {
      const go = document.getElementById('gameover');
      if (go && go.classList.contains('docked')) go.classList.add('reveal');
    });
    this.boardEl.addEventListener('mouseleave', () => {
      const go = document.getElementById('gameover');
      if (go && go.classList.contains('docked')) go.classList.remove('reveal');
    });
  }
    }
    // 始终播放统一的“木板落子”音效
    this.snd && this.snd.place();
    // stagger flip animations for affected discs with CSS delays (fewer timers)
    if (flips && flips.length) {
      const entries = flips.map((f, idx) => {
        const cell = this.getCellEl(f[0], f[1]);
        if (!cell) return null;
        const disc = cell.querySelector('.disc');
        if (!disc) return null;
        // 稍微放慢分段延时，翻子波次更柔和
        disc.style.setProperty('--flip-delay', `${idx * 80}ms`);
        return { disc, idx };
      }).filter(Boolean);

      // Reset animations in one frame, then trigger in next
      requestAnimationFrame(() => {
        // 旧的 3D 翻转已移除；这里切换为颜色渐变动画 colorflip
        entries.forEach(({ disc }) => { disc.classList.remove('colorflip'); disc.style.animation = 'none'; });
        requestAnimationFrame(() => {
          entries.forEach(({ disc, idx }) => {
            disc.style.removeProperty('animation');
            disc.classList.add('colorflip');
          });
          // 不再叠加“刷”声，保持单一木板声
        });
      });
    }
    // clear thinking spinner if any
    this.turnEl.classList.remove('thinking');
    this.msgEl.classList.remove('thinking');
  }

  updatePauseButton() {
    const aa = this.modeSel.value === 'aa';
    this.pauseBtn.style.display = aa ? '' : 'none';
    this.pauseBtn.textContent = this.paused ? '继续' : '暂停';
  }

  toggleFocusMode() {
    const app = document.querySelector('.app');
    const wrap = document.querySelector('.board-wrap');
    if (!app || !wrap) return;
    // FLIP：先测量，再切换，再从差值过渡
    const first = wrap.getBoundingClientRect();
    // 暂停自适应，避免动画进行中多次测量导致尺寸抖动
    window.__suppressFit = true;
    app.classList.toggle('focus-mode');
    const last = wrap.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width ? first.width / last.width : 1;
    const sy = first.height ? first.height / last.height : 1;
    wrap.style.willChange = 'transform';
    wrap.style.transformOrigin = 'top left';
    wrap.style.transition = 'none';
    wrap.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    // 强制回流，确保初始状态生效（避免“闪现”）
    void wrap.offsetWidth;
    requestAnimationFrame(()=>{
      wrap.style.transition = 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)';
      wrap.style.transform = 'none';
      const clear = ()=>{
        wrap.style.transition = '';
        wrap.style.transform = '';
        wrap.style.willChange = '';
        wrap.removeEventListener('transitionend', clear);
        // 动画结束后恢复自适应并重新计算
        window.__suppressFit = false;
        if (window.requestFit) window.requestFit();
      };
      wrap.addEventListener('transitionend', clear);
    });
    if (this.focusBtn) this.focusBtn.textContent = app.classList.contains('focus-mode') ? '退出专注' : '专注对局';
    localStorage.setItem('focus-mode', app.classList.contains('focus-mode') ? '1' : '0');
  }

  // —— 胜利卡 Dock/Undock ——
  _dockVictory(go) {
    const card = go && go.querySelector('.go-card');
    if (!go || !card) return;
    const first = card.getBoundingClientRect();
    go.classList.add('docked');
    if (window.requestFit) window.requestFit();
    const last = card.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width ? first.width / last.width : 1;
    const sy = first.height ? first.height / last.height : 1;
    card.style.willChange = 'transform';
    card.style.transformOrigin = 'top center';
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    void card.offsetWidth;
    requestAnimationFrame(() => {
      card.style.transition = 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)';
      card.style.transform = 'none';
      const clear = () => {
        card.style.transition = '';
        card.style.transform = '';
        card.style.willChange = '';
        card.removeEventListener('transitionend', clear);
      };
      card.addEventListener('transitionend', clear);
    });
    // 小提示：仅显示一次
    if (!localStorage.getItem('go-dock-hint')) {
      const hint = document.createElement('div');
      hint.className = 'go-hint';
      hint.textContent = '将鼠标移到上方细小区域可展开胜利卡';
      go.appendChild(hint);
      setTimeout(() => { hint.remove(); }, 2200);
      localStorage.setItem('go-dock-hint', '1');
    }
  }
  _undockVictory(go) {
    const card = go && go.querySelector('.go-card');
    if (!go || !card) return;
    // FLIP 回来
    const first = card.getBoundingClientRect();
    go.classList.remove('docked');
    go.classList.remove('reveal');
    if (window.requestFit) window.requestFit();
    const last = card.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width ? first.width / last.width : 1;
    const sy = first.height ? first.height / last.height : 1;
    card.style.willChange = 'transform';
    card.style.transformOrigin = 'top center';
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    void card.offsetWidth;
    requestAnimationFrame(() => {
      card.style.transition = 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)';
      card.style.transform = 'none';
      const clear = () => {
        card.style.transition = '';
        card.style.transform = '';
        card.style.willChange = '';
        card.removeEventListener('transitionend', clear);
      };
      card.addEventListener('transitionend', clear);
    });
  }
  toggleVictoryDock() {
    const go = document.getElementById('gameover');
    const btn = document.getElementById('go-review');
    if (!go) return;
    if (!go.classList.contains('docked')) {
      this._dockVictory(go);
      if (btn) btn.textContent = '展开胜利卡';
    } else {
      this._undockVictory(go);
      if (btn) btn.textContent = '回顾棋局';
    }
    if (window.requestFit) window.requestFit();
  }

  setupMobileSettings() {
    // 小屏用抽屉呈现设置，初始关闭
    this.closeSettings();
    // 视口变化时自动关闭，避免布局切换卡住
    window.addEventListener('resize', () => this.closeSettings());
  }

  openSettings() {
    const app = document.querySelector('.app');
    if (!app) return;
    app.classList.add('settings-open');
    if (this.scrimEl) this.scrimEl.hidden = false;
    if (window.requestFit) window.requestFit();
  }

  closeSettings() {
    const app = document.querySelector('.app');
    if (!app) return;
    app.classList.remove('settings-open');
    if (this.scrimEl) this.scrimEl.hidden = true;
    if (window.requestFit) window.requestFit();
  }

  render() {
    this.boardEl.innerHTML = '';
    const legalMoves = getLegalMoves(this.board, this.currentPlayer);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r; cell.dataset.col = c;
        cell.dataset.rowlabel = String(r + 1);
        cell.dataset.collabel = 'ABCDEFGH'[c];
        // 移除浏览器原生的 title 提示，避免 hover 弹出坐标气泡
        if (cell.hasAttribute('title')) cell.removeAttribute('title');
        cell.title = '';

        const v = this.board[r][c];
        if (v !== EMPTY) {
          const disc = document.createElement('div');
          disc.className = `disc ${v === BLACK ? 'black' : 'white'}`;
          cell.appendChild(disc);
        } else if (this.showHints && legalMoves.some(m => m.row === r && m.col === c)) {
          cell.classList.add('hint');
          const dot = document.createElement('span');
          dot.className = 'hint-dot';
          cell.appendChild(dot);
        }

        if (this.lastMove && this.lastMove.row === r && this.lastMove.col === c) {
          cell.classList.add('last-move');
        }

        cell.addEventListener('click', this.onCellClick);
        this.boardEl.appendChild(cell);
      }
    }

    // status
    const counts = countPieces(this.board);
    const playerText = this.currentPlayer === BLACK ? '黑棋' : '白棋';
    if (this.turnEl) this.turnEl.textContent = `当前轮到：${playerText}`;
    if (this.scoreEl) this.scoreEl.textContent = `黑棋 ${counts.black} : ${counts.white} 白棋`;
    // 同步侧栏与移动端顶部计分板
    const sbIds = ['score-black', 'm-score-black'];
    const swIds = ['score-white', 'm-score-white'];
    for (const id of sbIds) { const el = document.getElementById(id); if (el) el.textContent = String(counts.black); }
    for (const id of swIds) { const el = document.getElementById(id); if (el) el.textContent = String(counts.white); }
    const total = counts.black + counts.white;
    const blackPct = total ? Math.round((counts.black / total) * 100) : 50;
    const whitePct = 100 - blackPct;
    const sBars = ['scorebar', 'm-scorebar'].map(id => document.getElementById(id)).filter(Boolean);
    for (const sb of sBars) {
      const b = sb.querySelector('.black');
      const w = sb.querySelector('.white');
      if (b && w) { b.style.flexBasis = `${blackPct}%`; w.style.flexBasis = `${whitePct}%`; }
      if (!this.prevCounts || this.prevCounts.black !== counts.black || this.prevCounts.white !== counts.white) {
        sb.classList.remove('pulse'); void sb.offsetWidth; sb.classList.add('pulse'); setTimeout(() => sb.classList.remove('pulse'), 460);
      }
    }
    // 同步当前轮到/消息到移动端面板
    const mTurn = document.getElementById('m-turn'); if (mTurn) mTurn.textContent = `当前轮到：${playerText}`;
    const mMsg = document.getElementById('m-msg'); if (mMsg) mMsg.textContent = this.msgEl ? this.msgEl.textContent : '';
    this.prevCounts = counts;

    // end game
    if (isGameOver(this.board)) {
      const winText = counts.black === counts.white ? '平局' : counts.black > counts.white ? '黑棋胜' : '白棋胜';
      this.turnEl.textContent = `对局结束：${winText}`;
      const total = counts.black + counts.white;
      this.msgEl.textContent = `结束总子数：${total}`;
      const go = document.getElementById('gameover');
      if (go) {
        // 结果文案
        go.querySelector('.go-title').textContent = `对局结束：${winText}`;
        go.querySelector('.go-sub').textContent = `黑 ${counts.black} : ${counts.white} 白 · 总子数 ${total}`;
        // 绑定按钮
        const btnReset = document.getElementById('go-reset');
        if (btnReset && !btnReset._bound) { btnReset._bound = true; btnReset.addEventListener('click', ()=>{ go.classList.remove('peek'); this.reset(); }); }
        const btnReview = document.getElementById('go-review');
        if (btnReview && !btnReview._bound) {
          btnReview._bound = true;
          btnReview.addEventListener('click', () => this.toggleVictoryDock());
        }

        // 清理上一局效果元素
        const eff = go.querySelector('.go-effects');
        if (eff) eff.innerHTML = '';

        // 人机对战：胜利/失败特效
        go.classList.remove('win','lose');
        const mode = this.modeSel.value; // hb:人黑, bh:人白
        let humanColor = null;
        if (mode === 'hb') humanColor = BLACK;
        else if (mode === 'bh') humanColor = WHITE;
        const winnerColor = (counts.black === counts.white) ? 0 : (counts.black > counts.white ? BLACK : WHITE);
        if (humanColor !== null && winnerColor !== 0) {
          if (winnerColor === humanColor) {
            go.classList.add('win');
            // 生成少量彩纸
            if (eff) {
              const wrap = document.createElement('div');
              wrap.className = 'confetti';
              const N = 28;
              for (let i=0; i<N; i++) {
                const s = document.createElement('span');
                const x = Math.round(Math.random()*100);
                const hue = Math.round(180 + Math.random()*160);
                const delay = Math.round(Math.random()*400);
                const dur = 1200 + Math.round(Math.random()*900);
                const rot = Math.round(Math.random()*360) + 'deg';
                const size = (6 + Math.round(Math.random()*8)) + 'px';
                s.style.setProperty('--x', x+'%');
                s.style.setProperty('--h', String(hue));
                s.style.setProperty('--delay', delay+'ms');
                s.style.setProperty('--dur', dur+'ms');
                s.style.setProperty('--rot', rot);
                s.style.setProperty('--size', size);
                wrap.appendChild(s);
              }
              eff.appendChild(wrap);
            }
          } else {
            go.classList.add('lose');
          }
        }

        // 初始为非回顾态
        go.classList.remove('docked','reveal');
        if (btnReview) btnReview.textContent = '回顾棋局';
        go.hidden = false;
      }
    } else {
      const go = document.getElementById('gameover');
      if (go) {
        go.hidden = true;
        go.classList.remove('docked','reveal','win','lose');
      }
    }

    if (window.requestFit) window.requestFit();
  }

  appendMoveToList(sideText, move) {
    if (!this.moveListEl) return;
    const li = document.createElement('li');
    li.textContent = `${sideText}：${coordsToLabel(move.row, move.col)}`;
    this.moveListEl.appendChild(li);
    // 保持视图在底部，且请求重新排版以确保一屏显示
    this.moveListEl.scrollTop = this.moveListEl.scrollHeight;
    if (window.requestFit) window.requestFit();
  }
}

// 柔和音效：无需资源文件，基于 WebAudio 合成
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.55;
    this._chainReady = false;
    this._bus = null;       // sources -> bus
    this._master = null;    // volume
    this._comp = null;      // gentle compressor
    this._softLP = null;    // soften highs
    this._revSend = null;   // aux send
    this._revL = null; this._revR = null; // simple early reflections
    // rate limiting
    this._last = { place: 0, flips: 0 };
    this._gap = { place: 0.05, flips: 0.08 };
  }
  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      try { this.ctx.resume(); } catch {}
    }
    if (!this._chainReady) this._setupChain();
    return this.ctx;
  }
  _setupChain() {
    const ctx = this.ctx;
    // main bus
    this._bus = ctx.createGain();
    this._bus.gain.value = 1.0;
    // soften highs a touch
    this._softLP = ctx.createBiquadFilter();
    this._softLP.type = 'lowpass';
    this._softLP.frequency.value = 5600;
    this._softLP.Q.value = 0.707;
    // gentle compressor as a safety/feel good glue
    this._comp = ctx.createDynamicsCompressor();
    try {
      this._comp.threshold.value = -20;
      this._comp.knee.value = 12;
      this._comp.ratio.value = 2.5;
      this._comp.attack.value = 0.008;
      this._comp.release.value = 0.16;
    } catch {}
    // master volume
    this._master = ctx.createGain();
    this._master.gain.value = Math.max(0, Math.min(1, this.volume));
    // aux reverb send (very light early reflections, no heavy tail)
    this._revSend = ctx.createGain();
    this._revSend.gain.value = 0.05;
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 3400;
    revLP.Q.value = 0.7;
    this._revL = ctx.createDelay(0.5);
    this._revR = ctx.createDelay(0.5);
    this._revL.delayTime.value = 0.045;
    this._revR.delayTime.value = 0.065;
    const revGL = ctx.createGain(); revGL.gain.value = 0.18;
    const revGR = ctx.createGain(); revGR.gain.value = 0.18;
    const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panL) panL.pan.value = -0.25;
    if (panR) panR.pan.value =  0.25;

    // wire main chain
    this._bus.connect(this._softLP).connect(this._comp).connect(this._master).connect(ctx.destination);
    // wire reverb aux (sum into master directly for a gentle, uncompressed tail)
    this._revSend.connect(revLP);
    revLP.connect(this._revL).connect(revGL);
    revLP.connect(this._revR).connect(revGR);
    if (panL && panR) {
      revGL.connect(panL).connect(this._master);
      revGR.connect(panR).connect(this._master);
    } else {
      revGL.connect(this._master);
      revGR.connect(this._master);
    }

    this._chainReady = true;
  }
  // smooth amplitude envelope
  env(g, t0, a=0.005, d=0.06, s=0.0, r=0.10, peak=0.05) {
    const now = t0;
    g.gain.cancelScheduledValues(now);
    const vol = Math.max(0, Math.min(1, this.volume));
    const pk = Math.max(0.0001, (peak||0.05) * vol);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(pk, now + a);
    // decay with soft curve
    g.gain.setTargetAtTime(pk * Math.max(0, s), now + a, Math.max(0.005, d*0.6));
    g.gain.setTargetAtTime(0.0001, now + a + d, Math.max(0.02, r*0.8));
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this._master) this._master.gain.value = this.volume;
  }
  // small helper: route a node (via gain) to bus with optional subtle pan
  _route(gainNode, pan=0) {
    if (!gainNode) return;
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gainNode.connect(p).connect(this._bus);
    } else {
      gainNode.connect(this._bus);
    }
  }
  // aux reverb send per-source with a level
  _sendReverb(node, level=0.1) {
    if (!this._revSend) return;
    const g = this.ctx.createGain();
    g.gain.value = level;
    node.connect(g).connect(this._revSend);
  }
  // short noise buffer (mono)
  _noise(duration=0.12) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(duration * ctx.sampleRate));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
  // soft, premium-feel place: crisp tap + woody body + subtle shimmer
  place() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if ((t - this._last.place) < this._gap.place) return;
    this._last.place = t;
    const rnd = (min, max) => min + Math.random() * (max - min);
    // subtle random panning for width
    const pan = rnd(-0.08, 0.08);

    // 1) crisp tap (highpassed + bandpassed noise)
    const tap = this._noise(0.05);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; hp.Q.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 2.4;
    const gt = ctx.createGain();
    this.env(gt, t, 0.0012, 0.026, 0.0, 0.045, 0.025);
    tap.connect(hp).connect(bp).connect(gt);
    this._route(gt, pan);
    this._sendReverb(gt, 0.03);
    tap.start(t); tap.stop(t + 0.045);

    // 2) wood-ish body (triangle gently detuned)
    const body = ctx.createOscillator(); body.type = 'triangle';
    const fb = rnd(420, 460);
    body.frequency.setValueAtTime(fb, t);
    body.frequency.exponentialRampToValueAtTime(fb * 0.9, t + 0.12);
    const gb = ctx.createGain();
    this.env(gb, t + 0.001, 0.005, 0.08, 0.0, 0.12, 0.04);
    const lpb = ctx.createBiquadFilter(); lpb.type = 'lowpass'; lpb.frequency.value = 3200; lpb.Q.value = 0.8;
    body.connect(gb).connect(lpb);
    this._route(lpb, pan * 0.7);
    this._sendReverb(gb, 0.05);
    body.start(t); body.stop(t + 0.18);

    // 3) subtle shimmer (sine flick for premium sheen)
    const shimmer = ctx.createOscillator(); shimmer.type = 'sine';
    const fs = rnd(900, 1040);
    shimmer.frequency.setValueAtTime(fs, t + 0.003);
    shimmer.frequency.exponentialRampToValueAtTime(fs * 0.85, t + 0.09);
    const gs = ctx.createGain();
    this.env(gs, t + 0.002, 0.003, 0.05, 0.0, 0.07, 0.014);
    shimmer.connect(gs);
    this._route(gs, pan * 0.5);
    this._sendReverb(gs, 0.02);
    shimmer.start(t); shimmer.stop(t + 0.12);
  }
  // flips group: one cohesive, soft swish scaled by count
  flips(count=1, durationSec=null) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    if ((t - this._last.flips) < this._gap.flips) return; // rate limit
    this._last.flips = t;
    const rnd = (min, max) => min + Math.random() * (max - min);
    const pan = rnd(-0.10, 0.10);
    const dur = Math.min(0.45, Math.max(0.12, durationSec || (0.12 + Math.min(0.3, (count-1) * 0.04))));

    // airy but controlled swish
    const n = this._noise(dur);
    const hp = ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=250; hp.Q.value=0.7;
    const bp = ctx.createBiquadFilter(); bp.type='bandpass';
    const f0 = 1100 + rnd(-60, 60);
    const f1 = 1750 + rnd(-80, 80);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + Math.min(0.11, dur*0.7));
    bp.Q.value = 5.0;
    const g = ctx.createGain();
    this.env(g, t, 0.002, Math.min(0.09, dur*0.6), 0.0, Math.max(0.08, dur*0.5), 0.024);
    n.connect(hp).connect(bp).connect(g);
    this._route(g, pan);
    this._sendReverb(g, 0.06);
    n.start(t); n.stop(t + dur);
  }
}
