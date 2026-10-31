'use strict';

/* 贪吃蛇 · Snake
 * 纯前端 Canvas 实现，无任何依赖。
 */
(function () {
  /* ---------------- 常量 ---------------- */
  const GRID = 20;             // 20 x 20 格
  const BASE_STEP = 155;       // 初始每步耗时（ms）
  const MIN_STEP = 65;         // 最快速度
  const STEP_DECREMENT = 9;    // 每升一级减少的毫秒
  const EAT_PER_LEVEL = 4;     // 每吃 4 个升一级
  const BONUS_LIFE = 7000;     // 金色奖励存在时间（ms）
  const BEST_KEY = 'snake.best.v1';
  const SOUND_KEY = 'snake.sound.v1';

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const primaryBtn = document.getElementById('primaryBtn');
  const soundBtn = document.getElementById('soundBtn');
  const wrapBtn = document.getElementById('wrapBtn');
  const dpadButtons = document.querySelectorAll('[data-dir]');

  /* ---------------- 状态 ---------------- */
  const view = { size: 600, cell: 30 };
  let audio = null;

  const game = {
    snake: [],
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    bonus: null,
    score: 0,
    eaten: 0,
    level: 1,
    stepMs: BASE_STEP,
    phase: 'idle',        // idle | running | paused | over
    acc: 0,
    lastStepTime: 0,
    lastFrame: 0,
    particles: [],
    wrap: false,
    sound: true,
    popAt: -9999,
    best: 0,
  };

  const DIR = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  /* ---------------- 工具 ---------------- */
  function storageGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* 隐私模式下忽略 */
    }
  }

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function starPath(cx, cy, outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function centerOf(cellX, cellY) {
    const c = view.cell;
    return { x: (cellX + 0.5) * c, y: (cellY + 0.5) * c };
  }

  /* ---------------- 音效 ---------------- */
  function ensureAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        audio = new AC();
      } catch (e) {
        return;
      }
    }
    if (audio.state === 'suspended') audio.resume();
  }

  function beep(freq, duration, type, volume) {
    if (!game.sound) return;
    ensureAudio();
    if (!audio) return;
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume || 0.045, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function arpeggio(freqs) {
    freqs.forEach(function (f, i) {
      setTimeout(function () {
        beep(f, 0.1, 'triangle', 0.04);
      }, i * 80);
    });
  }

  /* ---------------- 布局 ---------------- */
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(160, Math.round(rect.width || 600));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    view.size = size;
    view.cell = size / GRID;
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (game.phase !== 'running') draw(performance.now(), 0);
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    scoreEl.textContent = String(game.score);
    bestEl.textContent = String(game.best);
    levelEl.textContent = String(game.level);
  }

  /* ---------------- 游戏逻辑 ---------------- */
  function resetGame() {
    game.snake = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
    ];
    game.dir = { x: 1, y: 0 };
    game.queue = [];
    game.score = 0;
    game.eaten = 0;
    game.level = 1;
    game.stepMs = BASE_STEP;
    game.acc = 0;
    game.lastStepTime = 0;
    game.particles = [];
    game.bonus = null;
    game.popAt = -9999;
    game.food = spawnFood();
    updateHud();
  }

  function occupiedCells() {
    const set = new Set();
    game.snake.forEach(function (s) { set.add(s.x + ',' + s.y); });
    if (game.bonus) set.add(game.bonus.x + ',' + game.bonus.y);
    return set;
  }

  function randomFreeCell() {
    const taken = occupiedCells();
    const free = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!taken.has(x + ',' + y)) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  function spawnFood() {
    return randomFreeCell();
  }

  function spawnBonus() {
    const cell = randomFreeCell();
    if (!cell) return;
    game.bonus = {
      x: cell.x,
      y: cell.y,
      expiresAt: performance.now() + BONUS_LIFE,
    };
    beep(880, 0.09, 'triangle', 0.04);
  }

  function spawnParticles(cellX, cellY, color, count) {
    const p = centerOf(cellX, cellY);
    const size = view.cell;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = size * (0.6 + Math.random() * 1.8);
      game.particles.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 420 + Math.random() * 260,
        max: 680,
        size: size * (0.05 + Math.random() * 0.07),
        color: color,
      });
    }
  }

  function eatFood() {
    game.eaten += 1;
    game.score += 10 + (game.level - 1) * 2;
    game.popAt = performance.now();
    spawnParticles(game.snake[0].x, game.snake[0].y, '#ff5b86', 12);
    beep(520, 0.07, 'square', 0.035);

    const nextLevel = 1 + Math.floor(game.eaten / EAT_PER_LEVEL);
    if (nextLevel !== game.level) {
      game.level = nextLevel;
      game.stepMs = Math.max(MIN_STEP, BASE_STEP - (game.level - 1) * STEP_DECREMENT);
      arpeggio([660, 880]);
    }

    game.food = spawnFood();
    if (game.eaten % 4 === 0 && !game.bonus) spawnBonus();
    updateHud();
  }

  function eatBonus() {
    game.score += 50;
    spawnParticles(game.bonus.x, game.bonus.y, '#ffd166', 18);
    game.bonus = null;
    arpeggio([784, 988, 1319]);
    updateHud();
    game.popAt = performance.now();
  }

  function queueDir(dir) {
    const last = game.queue.length ? game.queue[game.queue.length - 1] : game.dir;
    // 不能原地掉头
    if (dir.x === -last.x && dir.y === -last.y) return;
    if (dir.x === last.x && dir.y === last.y) return;
    if (game.queue.length >= 3) return;
    game.queue.push(dir);
  }

  function step() {
    while (game.queue.length) {
      const next = game.queue.shift();
      if (next.x === -game.dir.x && next.y === -game.dir.y) continue;
      if (next.x === game.dir.x && next.y === game.dir.y) continue;
      game.dir = next;
      break;
    }

    const head = game.snake[0];
    let nx = head.x + game.dir.x;
    let ny = head.y + game.dir.y;

    if (game.wrap) {
      nx = (nx + GRID) % GRID;
      ny = (ny + GRID) % GRID;
    } else if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) {
      return endGame();
    }

    const willGrow = !!(game.food && nx === game.food.x && ny === game.food.y);
    const body = willGrow ? game.snake : game.snake.slice(0, -1);
    for (let i = 0; i < body.length; i++) {
      if (body[i].x === nx && body[i].y === ny) return endGame();
    }

    game.snake.unshift({ x: nx, y: ny });
    if (willGrow) {
      eatFood();
    } else {
      game.snake.pop();
    }

    if (game.bonus && nx === game.bonus.x && ny === game.bonus.y) eatBonus();
  }

  function startGame() {
    resetGame();
    game.phase = 'running';
    game.lastStepTime = 0;
    game.lastFrame = 0;
    overlay.classList.add('is-hidden');
    ensureAudio();
    beep(440, 0.08, 'triangle', 0.03);
  }

  function pauseGame() {
    if (game.phase !== 'running') return;
    game.phase = 'paused';
    beep(330, 0.06, 'sine', 0.03);
    showOverlay('已暂停', '按空格继续，或点击下方按钮', '继续游戏');
  }

  function resumeGame() {
    if (game.phase !== 'paused') return;
    game.phase = 'running';
    game.lastStepTime = 0;
    overlay.classList.add('is-hidden');
    beep(440, 0.06, 'sine', 0.03);
  }

  function endGame() {
    if (game.phase === 'over') return;
    game.phase = 'over';
    game.acc = 0;
    if (game.score > game.best) {
      game.best = game.score;
      storageSet(BEST_KEY, game.best);
    }
    updateHud();
    beep(320, 0.16, 'sawtooth', 0.045);
    setTimeout(function () { beep(190, 0.26, 'sawtooth', 0.045); }, 130);
    showOverlay('游戏结束', '得分 ' + game.score + ' · 最高 ' + game.best, '再来一局');
  }

  function showOverlay(title, text, buttonLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    primaryBtn.textContent = buttonLabel;
    overlay.classList.remove('is-hidden');
  }

  function handlePrimary() {
    if (game.phase === 'idle' || game.phase === 'over') {
      startGame();
    } else if (game.phase === 'paused') {
      resumeGame();
    } else {
      pauseGame();
    }
  }

  /* ---------------- 渲染 ---------------- */
  function draw(now, t) {
    const size = view.size;
    const c = view.cell;
    ctx.clearRect(0, 0, size, size);

    // 背景
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#0b1428');
    bg.addColorStop(1, '#08171a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // 网格
    ctx.strokeStyle = 'rgba(122, 255, 214, 0.055)';
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      const p = Math.round(i * c) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    if (game.food) drawFood(game.food, now);
    if (game.bonus) drawBonus(game.bonus, now);

    // 蛇身：从尾到头绘制
    const n = game.snake.length;
    for (let i = n - 1; i >= 1; i--) drawSegment(game.snake[i], i / Math.max(1, n - 1));
    if (n) drawHead(now, t);

    // 粒子
    ctx.save();
    for (let i = 0; i < game.particles.length; i++) {
      const p = game.particles[i];
      const alpha = Math.max(0, p.life / p.max);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.45 + alpha * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 边框内发光
    ctx.strokeStyle = 'rgba(122, 255, 214, 0.10)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  function drawFood(food, now) {
    const c = view.cell;
    const p = centerOf(food.x, food.y);
    const pulse = 0.92 + Math.sin(now / 210) * 0.09;
    const r = c * 0.3 * pulse;

    ctx.save();
    ctx.shadowColor = 'rgba(255, 77, 126, 0.9)';
    ctx.shadowBlur = 18;
    const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.15, p.x, p.y, r);
    g.addColorStop(0, '#ffd0dd');
    g.addColorStop(0.45, '#ff5b86');
    g.addColorStop(1, '#c4144d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 小叶子
    ctx.fillStyle = '#3ddc97';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.28, p.y - r * 0.95, r * 0.34, r * 0.15, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBonus(bonus, now) {
    const c = view.cell;
    const p = centerOf(bonus.x, bonus.y);
    const remain = clamp((bonus.expiresAt - now) / BONUS_LIFE, 0, 1);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(now / 900);
    ctx.shadowColor = 'rgba(255, 209, 102, 0.9)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffd166';
    starPath(0, 0, c * 0.34, c * 0.15, 5);
    ctx.fill();
    ctx.restore();

    // 倒计时圆环
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.72)';
    ctx.lineWidth = Math.max(1.5, c * 0.055);
    ctx.arc(p.x, p.y, c * 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
    ctx.stroke();
  }

  function drawSegment(seg, k) {
    const c = view.cell;
    const p = centerOf(seg.x, seg.y);
    const inset = c * 0.08;
    const light = 64 - 26 * k;

    ctx.fillStyle = 'hsl(158 78% ' + light.toFixed(1) + '%)';
    const r = c * 0.28;
    roundRect(p.x - c / 2 + inset, p.y - c / 2 + inset, c - inset * 2, c - inset * 2, r);
    ctx.fill();
  }

  function drawHead(now, t) {
    const c = view.cell;
    const head = game.snake[0];
    const lead = 0.16 * (t || 0);
    const p = centerOf(head.x, head.y);
    let hx = p.x + game.dir.x * c * lead;
    let hy = p.y + game.dir.y * c * lead;
    hx = clamp(hx, c * 0.42, view.size - c * 0.42);
    hy = clamp(hy, c * 0.42, view.size - c * 0.42);

    const pop = Math.max(0, 1 - (now - game.popAt) / 180);
    const inset = c * 0.05 - pop * c * 0.02;

    ctx.save();
    ctx.shadowColor = 'rgba(150, 255, 220, 0.95)';
    ctx.shadowBlur = 18 + pop * 16;
    ctx.fillStyle = '#a9ffdb';
    roundRect(hx - c / 2 + inset, hy - c / 2 + inset, c - inset * 2, c - inset * 2, c * 0.32);
    ctx.fill();
    ctx.restore();

    // 眼睛
    const ex = game.dir.x;
    const ey = game.dir.y;
    const px = -ey;
    const py = ex;
    const eyeR = c * 0.105;
    const pupilR = c * 0.052;

    for (let side = -1; side <= 1; side += 2) {
      const x = hx + ex * c * 0.17 + px * c * 0.19 * side;
      const y = hy + ey * c * 0.17 + py * c * 0.19 * side;
      ctx.fillStyle = '#f2fffb';
      ctx.beginPath();
      ctx.arc(x, y, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#08251c';
      ctx.beginPath();
      ctx.arc(x + ex * c * 0.035, y + ey * c * 0.035, pupilR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------------- 主循环 ---------------- */
  function loop(now) {
    requestAnimationFrame(loop);

    const dt = game.lastFrame ? Math.min(now - game.lastFrame, 100) : 16;
    game.lastFrame = now;

    if (game.phase === 'running') {
      if (!game.lastStepTime) game.lastStepTime = now;
      const elapsed = Math.min(now - game.lastStepTime, 250);
      game.lastStepTime = now;
      game.acc += elapsed;

      let guard = 0;
      while (game.acc >= game.stepMs && game.phase === 'running' && guard < 6) {
        game.acc -= game.stepMs;
        guard += 1;
        step();
      }

      if (game.phase !== 'running') game.acc = 0;

      if (game.bonus && now > game.bonus.expiresAt) {
        game.bonus = null;
        beep(240, 0.08, 'sine', 0.025);
      }
    } else {
      game.acc = 0;
    }

    // 粒子
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) game.particles.splice(i, 1);
    }

    const t = game.phase === 'running' ? clamp(game.acc / game.stepMs, 0, 1) : 0;
    draw(now, t);
  }

  /* ---------------- 输入 ---------------- */
  const KEY_DIRS = {
    arrowup: DIR.up,
    w: DIR.up,
    arrowdown: DIR.down,
    s: DIR.down,
    arrowleft: DIR.left,
    a: DIR.left,
    arrowright: DIR.right,
    d: DIR.right,
  };

  document.addEventListener('keydown', function (event) {
    const key = String(event.key || '').toLowerCase();

    if (key === ' ' || key === 'spacebar' || key === 'space') {
      event.preventDefault();
      handlePrimary();
      return;
    }

    if (key === 'r') {
      event.preventDefault();
      startGame();
      return;
    }

    if (key === 'p') {
      event.preventDefault();
      if (game.phase === 'running') pauseGame();
      else if (game.phase === 'paused') resumeGame();
      return;
    }

    const dir = KEY_DIRS[key];
    if (dir) {
      event.preventDefault();
      ensureAudio();
      if (game.phase === 'idle' || game.phase === 'over') startGame();
      if (game.phase === 'running') queueDir(dir);
    }
  });

  primaryBtn.addEventListener('click', handlePrimary);

  soundBtn.addEventListener('click', function () {
    game.sound = !game.sound;
    soundBtn.textContent = game.sound ? '🔊 音效' : '🔇 静音';
    soundBtn.setAttribute('aria-pressed', String(game.sound));
    storageSet(SOUND_KEY, game.sound ? 1 : 0);
  });

  wrapBtn.addEventListener('click', function () {
    game.wrap = !game.wrap;
    wrapBtn.textContent = game.wrap ? '🌀 穿墙：开' : '🧱 穿墙：关';
    wrapBtn.setAttribute('aria-pressed', String(game.wrap));
    beep(600, 0.05, 'sine', 0.025);
  });

  // 触屏：滑动 + 方向键
  let pointerStart = null;
  canvas.addEventListener('pointerdown', function (event) {
    pointerStart = { x: event.clientX, y: event.clientY };
    ensureAudio();
  });

  canvas.addEventListener('pointerup', function (event) {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;

    const dir = Math.abs(dx) > Math.abs(dy)
      ? { x: dx > 0 ? 1 : -1, y: 0 }
      : { x: 0, y: dy > 0 ? 1 : -1 };

    if (game.phase === 'idle' || game.phase === 'over') startGame();
    if (game.phase === 'running') queueDir(dir);
  });

  canvas.addEventListener('pointercancel', function () {
    pointerStart = null;
  });

  dpadButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const dir = DIR[btn.getAttribute('data-dir')];
      if (!dir) return;
      ensureAudio();
      if (game.phase === 'idle' || game.phase === 'over') startGame();
      if (game.phase === 'running') queueDir(dir);
    });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.phase === 'running') pauseGame();
  });

  window.addEventListener('blur', function () {
    if (game.phase === 'running') pauseGame();
  });

  window.addEventListener('resize', fitCanvas);
  if (window.ResizeObserver) {
    new ResizeObserver(fitCanvas).observe(canvas);
  }

  /* ---------------- 初始化 ---------------- */
  game.best = Number(storageGet(BEST_KEY, 0)) || 0;
  game.sound = Number(storageGet(SOUND_KEY, 1)) === 1;
  soundBtn.textContent = game.sound ? '🔊 音效' : '🔇 静音';
  soundBtn.setAttribute('aria-pressed', String(game.sound));
  wrapBtn.textContent = '🧱 穿墙：关';

  resetGame();
  fitCanvas();
  requestAnimationFrame(loop);
})();
