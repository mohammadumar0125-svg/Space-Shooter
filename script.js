/* Starfall – a dependency-free space shooter.
 * Sections: config · storage · audio · input · state · spawning · update · draw · UI · loop
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const W = 480;              // logical game width
  const H = 720;              // logical game height
  const START_LIVES = 3;
  const MAX_LIVES = 3;
  const KILLS_PER_LEVEL = 10;
  const INVULN_TIME = 2;      // seconds of protection after being hit

  const ENEMY_TYPES = {
    scout:   { r: 16, hp: 1, speed: 110, amp: 0,  score: 10, color: '#ff5470' },
    zigzag:  { r: 15, hp: 1, speed: 120, amp: 70, score: 20, color: '#ffb347' },
    tank:    { r: 24, hp: 4, speed: 70,  amp: 18, score: 50, color: '#b388ff' },
    shooter: { r: 18, hp: 2, speed: 80,  amp: 30, score: 35, color: '#5ce1e6', shoots: true },
  };

  // ---------------------------------------------------------------- helpers
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- storage
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* storage unavailable */ }
    },
  };
  const KEY_BEST = 'starfall.best';
  const KEY_MUTED = 'starfall.muted';

  let best = parseInt(store.get(KEY_BEST, '0'), 10) || 0;

  // ---------------------------------------------------------------- audio
  const Sound = {
    ctx: null,
    muted: store.get(KEY_MUTED, '0') === '1',

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { return; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    tone({ freq, end = freq, dur = 0.15, type = 'square', vol = 0.08, delay = 0 }) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    noise({ dur = 0.3, vol = 0.15, cutoff = 1200, delay = 0 }) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      src.buffer = buf;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, t);
      filter.frequency.exponentialRampToValueAtTime(100, t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.start(t);
    },

    shoot()     { this.tone({ freq: 900, end: 300, dur: 0.09, type: 'square', vol: 0.04 }); },
    enemyShoot(){ this.tone({ freq: 300, end: 140, dur: 0.14, type: 'sawtooth', vol: 0.04 }); },
    hitEnemy()  { this.tone({ freq: 220, end: 160, dur: 0.06, type: 'triangle', vol: 0.07 }); },
    explode()   { this.noise({ dur: 0.3, vol: 0.14, cutoff: 1800 }); this.tone({ freq: 140, end: 40, dur: 0.25, type: 'sawtooth', vol: 0.06 }); },
    playerHit() { this.noise({ dur: 0.5, vol: 0.25, cutoff: 2500 }); this.tone({ freq: 200, end: 50, dur: 0.4, type: 'sawtooth', vol: 0.12 }); },
    levelUp()   { [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.14, type: 'square', vol: 0.06, delay: i * 0.09 })); },
    gameOver()  { [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, end: f * 0.97, dur: 0.3, type: 'triangle', vol: 0.12, delay: i * 0.22 })); },
    start()     { [330, 440, 660].forEach((f, i) => this.tone({ freq: f, dur: 0.1, type: 'square', vol: 0.05, delay: i * 0.07 })); },
  };

  // ---------------------------------------------------------------- canvas
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // ---------------------------------------------------------------- input
  const keys = Object.create(null);
  const touch = { left: false, right: false, fire: false, dragX: null };

  const GAME_KEYS = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyP', 'KeyM', 'Escape', 'Enter',
  ]);

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    Sound.unlock();
    keys[e.code] = true;
    if (e.repeat) return;

    if (e.code === 'KeyM') return toggleMute();

    if (state === 'menu' && (e.code === 'Enter' || e.code === 'Space')) return startGame();
    if (state === 'over' && (e.code === 'Enter' || e.code === 'Space') && performance.now() - overAt > 700) return startGame();

    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
    } else if (e.code === 'Enter' && state === 'paused') {
      resumeGame();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'playing') pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') pauseGame();
  });

  // On-screen buttons (hold to act)
  function bindHold(id, prop) {
    const el = $(id);
    const on = (e) => {
      e.preventDefault();
      Sound.unlock();
      touch[prop] = true;
      el.classList.add('active');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    };
    const off = (e) => {
      e.preventDefault();
      touch[prop] = false;
      el.classList.remove('active');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindHold('ctrl-left', 'left');
  bindHold('ctrl-right', 'right');
  bindHold('ctrl-fire', 'fire');

  // Drag on the play area to steer the ship (touch / pen only)
  function dragToX(e) {
    const rect = canvas.getBoundingClientRect();
    touch.dragX = ((e.clientX - rect.left) / rect.width) * W;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    Sound.unlock();
    dragToX(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && touch.dragX !== null) dragToX(e);
  });
  const endDrag = () => { touch.dragX = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- game state
  let state = 'menu';          // 'menu' | 'playing' | 'paused' | 'over'
  let overAt = 0;
  let last = 0;

  let player, bullets, enemyBullets, enemies, particles, stars;
  let score, level, lives, kills, spawnTimer, time, shake, shotsFired, shotsHit;
  let runStartBest = best;     // best score when the current run began
  let newBestThisRun = false;  // true once the current run beats runStartBest

  function makeStars() {
    stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({ x: rand(0, W), y: rand(0, H), s: rand(0.6, 2.2), v: rand(15, 70) });
    }
  }
  makeStars();

  function resetGame() {
    player = { x: W / 2, y: H - 70, r: 14, speed: 340, cooldown: 0, invuln: 0 };
    bullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    score = 0;
    level = 1;
    lives = START_LIVES;
    kills = 0;
    spawnTimer = 0.8;
    time = 0;
    shake = 0;
    shotsFired = 0;
    shotsHit = 0;
    runStartBest = best;
    newBestThisRun = false;
    updateHud();
  }

  // ---------------------------------------------------------------- difficulty
  const enemySpeedBoost = () => level * 9;
  const spawnInterval = () => Math.max(0.3, 1.1 - level * 0.07);
  const shooterCooldown = () => Math.max(0.9, 2.3 - level * 0.12);
  const enemyBulletSpeed = () => Math.min(360, 190 + level * 10);

  // ---------------------------------------------------------------- spawning
  function spawnEnemy() {
    const pool = ['scout', 'scout', 'scout'];
    if (level >= 2) pool.push('zigzag', 'zigzag');
    if (level >= 3) pool.push('tank');
    if (level >= 4) pool.push('shooter', 'shooter');
    if (level >= 7) pool.push('tank', 'shooter');
    const type = pool[Math.floor(Math.random() * pool.length)];
    const def = ENEMY_TYPES[type];
    const x = rand(def.r + 14, W - def.r - 14);
    enemies.push({
      type, def,
      x, baseX: x, y: -def.r,
      r: def.r, hp: def.hp, maxHp: def.hp,
      speed: (def.speed + enemySpeedBoost()) * rand(0.9, 1.1),
      t: rand(0, 6),
      fire: rand(0.8, 1.8),
      flash: 0,
    });
  }

  function spawnParticles(x, y, color, count, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(40, 220) * power;
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.3, 0.8), max: 0.8, size: rand(1.5, 4), color,
      });
    }
  }

  function shoot() {
    const twin = level >= 4;
    const offsets = twin ? [-9, 9] : [0];
    for (const dx of offsets) {
      bullets.push({ x: player.x + dx, y: player.y - 22, vy: -640, r: 4 });
    }
    shotsFired += offsets.length;
    player.cooldown = twin ? 0.2 : 0.24;
    Sound.shoot();
  }

  function enemyShoot(e) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const v = enemyBulletSpeed();
    enemyBullets.push({ x: e.x, y: e.y + e.r, vx: (dx / d) * v, vy: (dy / d) * v, r: 5 });
    Sound.enemyShoot();
  }

  // ---------------------------------------------------------------- damage handling
  function hitPlayer() {
    if (player.invuln > 0 || state !== 'playing') return;
    lives--;
    player.invuln = INVULN_TIME;
    shake = 0.4;
    spawnParticles(player.x, player.y, '#ffd23f', 26, 1.2);
    spawnParticles(player.x, player.y, '#ff5470', 16, 1);
    Sound.playerHit();
    updateHud();
    if (lives <= 0) endGame();
  }

  function killEnemy(e) {
    score += e.def.score;
    kills++;
    spawnParticles(e.x, e.y, e.def.color, 16);
    spawnParticles(e.x, e.y, '#ffffff', 6, 0.6);
    Sound.explode();

    const newLevel = 1 + Math.floor(kills / KILLS_PER_LEVEL);
    if (newLevel > level) {
      level = newLevel;
      showBanner('LEVEL ' + level);
      Sound.levelUp();
    }
    if (score > best) {
      best = score;
      store.set(KEY_BEST, best);
      newBestThisRun = best > runStartBest;
    }
    updateHud();
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    time += dt;

    // --- player movement
    let dir = 0;
    if (keys.ArrowLeft || keys.KeyA || touch.left) dir -= 1;
    if (keys.ArrowRight || keys.KeyD || touch.right) dir += 1;

    if (dir !== 0) {
      player.x += dir * player.speed * dt;
    } else if (touch.dragX !== null) {
      const diff = touch.dragX - player.x;
      const step = player.speed * 1.6 * dt;
      player.x += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
    }
    player.x = clamp(player.x, player.r + 6, W - player.r - 6);

    // --- shooting
    player.cooldown -= dt;
    player.invuln = Math.max(0, player.invuln - dt);
    if ((keys.Space || keys.ArrowUp || keys.KeyW || touch.fire) && player.cooldown <= 0) shoot();

    // --- spawning (higher levels occasionally spawn pairs)
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      if (level >= 5 && Math.random() < Math.min(0.5, (level - 4) * 0.08)) spawnEnemy();
      spawnTimer = spawnInterval() * rand(0.7, 1.3);
    }

    // --- bullets
    for (const b of bullets) b.y += b.vy * dt;
    bullets = bullets.filter((b) => b.y > -20);

    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter((b) => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);

    // --- enemies
    for (const e of enemies) {
      e.t += dt;
      e.y += e.speed * dt;
      e.x = clamp(e.baseX + Math.sin(e.t * 2.2) * e.def.amp, e.r, W - e.r);
      e.flash = Math.max(0, e.flash - dt);
      if (e.def.shoots && e.y > 20 && e.y < H * 0.6) {
        e.fire -= dt;
        if (e.fire <= 0) { enemyShoot(e); e.fire = shooterCooldown() * rand(0.8, 1.2); }
      }
    }

    // --- player bullets vs enemies
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        const rr = b.r + e.r;
        if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 < rr * rr) {
          b.y = -100; // mark for removal
          e.hp--;
          e.flash = 0.08;
          shotsHit++;
          if (e.hp <= 0) killEnemy(e);
          else { Sound.hitEnemy(); spawnParticles(b.x, b.y, '#ffffff', 3, 0.4); }
          break;
        }
      }
    }
    enemies = enemies.filter((e) => e.hp > 0);

    // --- enemies / enemy bullets vs player
    for (const e of enemies) {
      const rr = e.r + player.r - 2;
      if ((e.x - player.x) ** 2 + (e.y - player.y) ** 2 < rr * rr && player.invuln <= 0) {
        e.hp = 0;
        spawnParticles(e.x, e.y, e.def.color, 14);
        hitPlayer();
      }
    }
    for (const b of enemyBullets) {
      const rr = b.r + player.r - 3;
      if ((b.x - player.x) ** 2 + (b.y - player.y) ** 2 < rr * rr && player.invuln <= 0) {
        b.y = H + 100;
        hitPlayer();
      }
    }
    enemies = enemies.filter((e) => e.hp > 0 && e.y < H + 40);

    // --- particles, stars, shake
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.vx *= 0.98; p.vy *= 0.98; }
    particles = particles.filter((p) => p.life > 0);
    shake = Math.max(0, shake - dt);
  }

  function updateStars(dt) {
    const boost = 1 + (state === 'playing' ? level * 0.08 : 0);
    for (const s of stars) {
      s.y += s.v * boost * dt;
      if (s.y > H) { s.y = -2; s.x = rand(0, W); }
    }
  }

  // ---------------------------------------------------------------- drawing
  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    const { x, y } = player;
    ctx.save();
    ctx.translate(x, y);

    // engine flame
    const flame = 10 + Math.random() * 8;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-6, 14); ctx.lineTo(0, 14 + flame); ctx.lineTo(6, 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.moveTo(-3, 14); ctx.lineTo(0, 14 + flame * 0.6); ctx.lineTo(3, 14);
    ctx.closePath(); ctx.fill();

    // wings
    ctx.fillStyle = '#3a48b8';
    ctx.beginPath();
    ctx.moveTo(-8, 0); ctx.lineTo(-24, 18); ctx.lineTo(-24, 8); ctx.lineTo(-12, -8);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(24, 18); ctx.lineTo(24, 8); ctx.lineTo(12, -8);
    ctx.closePath(); ctx.fill();

    // hull
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath();
    ctx.moveTo(0, -24); ctx.lineTo(10, 10); ctx.lineTo(6, 16); ctx.lineTo(-6, 16); ctx.lineTo(-10, 10);
    ctx.closePath(); ctx.fill();

    // cockpit
    ctx.fillStyle = '#5ce1e6';
    ctx.beginPath();
    ctx.ellipse(0, -2, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    const c = e.flash > 0 ? '#ffffff' : e.def.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = c;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;

    switch (e.type) {
      case 'scout': // downward arrowhead
        ctx.beginPath();
        ctx.moveTo(0, e.r); ctx.lineTo(e.r, -e.r * 0.8); ctx.lineTo(0, -e.r * 0.3); ctx.lineTo(-e.r, -e.r * 0.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'zigzag': // diamond
        ctx.beginPath();
        ctx.moveTo(0, e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, -e.r); ctx.lineTo(-e.r, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'tank': { // chunky hexagon with hp pips
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        for (let i = 0; i < e.hp; i++) ctx.fillRect(-e.r * 0.6 + i * 7, -3, 5, 6);
        break;
      }
      case 'shooter': // round pod with cannon
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-3, 0, 6, e.r + 4);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath(); ctx.arc(0, -2, 4, 0, Math.PI * 2); ctx.fill();
        break;
    }
    if (e.type !== 'tank' && e.type !== 'shooter') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(0, -1, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);

    // background
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#080c2b');
    g.addColorStop(1, '#15205e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + s.s / 4;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.s, s.s * (1 + s.v / 80));
    }
    ctx.globalAlpha = 1;

    if (state === 'menu') return;

    ctx.save();
    if (shake > 0) ctx.translate(rand(-1, 1) * shake * 16, rand(-1, 1) * shake * 16);

    // player bullets
    ctx.fillStyle = '#ffd23f';
    for (const b of bullets) {
      ctx.fillRect(b.x - 2, b.y - 9, 4, 16);
    }
    // enemy bullets
    for (const b of enemyBullets) {
      ctx.fillStyle = 'rgba(255, 84, 112, 0.35)';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff5470';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }

    enemies.forEach(drawEnemy);
    if (state !== 'over') drawPlayer();

    // particles
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------- UI
  const el = {
    hud: $('hud'), score: $('hud-score'), best: $('hud-best'), level: $('hud-level'), lives: $('hud-lives'),
    mute: $('btn-mute'), pause: $('btn-pause'), banner: $('banner'),
    start: $('screen-start'), pauseScreen: $('screen-pause'), over: $('screen-over'),
    startBest: $('start-best'), overScore: $('over-score'), overBest: $('over-best'),
    newBest: $('over-new-best'), overStats: $('over-stats'),
  };

  function updateHud() {
    el.score.textContent = score || 0;
    el.best.textContent = best;
    el.level.textContent = level || 1;
    el.lives.textContent = lives > 0 ? '♥'.repeat(Math.min(lives, MAX_LIVES)) : '–';
    el.startBest.textContent = best;
  }

  function showBanner(text) {
    el.banner.textContent = text;
    el.banner.classList.remove('show');
    void el.banner.offsetWidth; // restart animation
    el.banner.classList.add('show');
  }

  function renderMute() {
    el.mute.textContent = Sound.muted ? '🔇' : '🔊';
    el.mute.setAttribute('aria-pressed', String(Sound.muted));
  }
  function toggleMute() {
    Sound.muted = !Sound.muted;
    store.set(KEY_MUTED, Sound.muted ? '1' : '0');
    renderMute();
    Sound.unlock();
    if (!Sound.muted) Sound.hitEnemy();
  }

  function show(node) { node.classList.remove('hidden'); }
  function hide(node) { node.classList.add('hidden'); }

  // ---------------------------------------------------------------- flow
  function startGame() {
    Sound.unlock();
    resetGame();
    state = 'playing';
    hide(el.start); hide(el.over); hide(el.pauseScreen);
    show(el.hud);
    Sound.start();
    showBanner('LEVEL 1');
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    show(el.pauseScreen);
    touch.left = touch.right = touch.fire = false;
    touch.dragX = null;
    document.querySelectorAll('.ctrl.active').forEach((n) => n.classList.remove('active'));
  }
  function resumeGame() {
    if (state !== 'paused') return;
    state = 'playing';
    hide(el.pauseScreen);
    last = performance.now();
  }

  function endGame() {
    state = 'over';
    overAt = performance.now();
    const isNewBest = newBestThisRun && score > 0;
    el.overScore.textContent = score;
    el.overBest.textContent = best;
    const accuracy = shotsFired ? Math.round((shotsHit / shotsFired) * 100) : 0;
    el.overStats.textContent = 'Level ' + level + ' · ' + kills + ' enemies · ' + accuracy + '% accuracy';
    el.newBest.classList.toggle('hidden', !isNewBest);
    Sound.gameOver();
    show(el.over);
    touch.left = touch.right = touch.fire = false;
    touch.dragX = null;
  }

  $('btn-start').addEventListener('click', startGame);
  $('btn-restart').addEventListener('click', startGame);
  $('btn-resume').addEventListener('click', resumeGame);
  el.pause.addEventListener('click', () => {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  });
  el.mute.addEventListener('click', toggleMute);
  el.mute.addEventListener('pointerdown', () => Sound.unlock());

  // ---------------------------------------------------------------- main loop
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    if (state === 'playing') {
      update(dt);
    } else if (state === 'over') {
      // let explosions and stars keep moving behind the game-over screen
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      for (const e of enemies) e.y += e.speed * dt;
    }
    if (state !== 'paused') updateStars(dt);

    draw();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  resetGame();
  state = 'menu';
  renderMute();
  updateHud();
  hide(el.hud);
  resize();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
