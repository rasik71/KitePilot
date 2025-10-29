
// Kite Pilot — script.js (fixed: framerate-independent, universal Flappy feel)
(() => {
  // ----- Config (baseline units tuned for 60 FPS) -----
  const CANVAS_ID = 'gameCanvas';
  const BASE_GRAVITY = 0.50;        // per 60fps
  const BASE_FLAP_STRENGTH = -4;  // per 60fps
  const BASE_PIPE_SPEED = 1.5;      // pixels per 60fps tick
  const PIPE_GAP = 130;             // vertical gap (internal pixels)
  const PIPE_INTERVAL = 2000;       // ms between pipes
  const BIRD_X = 140;                // fixed horizontal position (internal coords)
  const STORAGE_KEY = 'kitepilot_scores_v1';

  // ----- DOM -----
  const canvas = document.getElementById(CANVAS_ID);
  const ctx = canvas.getContext('2d', { alpha: false });
  const startBtn = document.getElementById('startBtn');
  const overlay = document.getElementById('overlay');
  const discordInput = document.getElementById('discordName');
  const scoreLive = document.getElementById('scoreLive');
  const gameOverEl = document.getElementById('gameOver');
  const finalScoreEl = document.getElementById('finalScore');
  const playAgain = document.getElementById('playAgain');
  const muteBtn = document.getElementById('muteBtn');
  const viewLeaderboard = document.getElementById('viewLeaderboard');
  const leaderModal = document.getElementById('leaderModal');
  const leaderList = document.getElementById('leaderList');
  const showBoard = document.getElementById('showBoard');
  const closeBoard = document.getElementById('closeBoard');
  const clearScores = document.getElementById('clearScores');

  // Keep an internal fixed resolution for predictable physics
  const INTERNAL_W = 480;
  const INTERNAL_H = 720;

  function resizeCanvas() {
    // keep internal resolution fixed, scale canvas visually to fit parent width
    canvas.width = INTERNAL_W;
    canvas.height = INTERNAL_H;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    // optional: adjust image smoothing for crisp pixel-like rendering
    ctx.imageSmoothingEnabled = true;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // assets
  const logo = new Image();
  logo.src = 'assets/kite_logo.png';

  // sound (tiny)
  let muted = true;
  const flapSound = new Audio();
  flapSound.src = ''; // provide a small sound file if you want
  flapSound.volume = 0.25;

  muteBtn && muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });

  // Game state
  let bird = null;
  let pipes = [];
  let lastPipeTime = 0;
  let running = false;
  let score = 0;
  let loopId = null;
  let playerName = 'Player';
  let lastFrameTime = 0;

  // Utility
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function shadeColor(hex, percent) {
    const num = parseInt(hex.slice(1),16),
      r = (num >> 16) + percent,
      g = ((num >> 8) & 0x00FF) + percent,
      b = (num & 0x0000FF) + percent;
    return '#' + (0x1000000 + (clamp(r,0,255)<<16) + (clamp(g,0,255)<<8) + clamp(b,0,255)).toString(16).slice(1);
  }
  function escapeHtml(t){ return (t+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

  // Bird (kite) class
  class Bird {
    constructor() {
      this.x = BIRD_X;
      this.y = INTERNAL_H / 2;
      this.vel = 0;
      this.width = 56;
      this.height = 42;
      this.rotation = 0;
    }
    flap() {
      this.vel = BASE_FLAP_STRENGTH;
      if (!muted && flapSound.src) try { flapSound.cloneNode().play(); } catch(e){}
    }
    update(delta) {
      // delta is normalized to 60 FPS ticks (1 = 1 frame at 60fps)
      this.vel += BASE_GRAVITY * delta;
      this.y += this.vel * delta;
      this.rotation = Math.max(Math.min(this.vel / 12, 0.8), -0.8);
    }
    draw(ctx) {
      ctx.save();
      // draw at internal coords
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      const iw = this.width, ih = this.height;
      if (logo.complete && logo.naturalWidth) {
        ctx.drawImage(logo, -iw/2, -ih/2, iw, ih);
      } else {
        // fallback placeholder
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(-iw/2, -ih/2, iw, ih);
      }
      ctx.restore();
    }
    bounds() {
      return {
        left: this.x - this.width/2,
        right: this.x + this.width/2,
        top: this.y - this.height/2,
        bottom: this.y + this.height/2
      };
    }
  }

  // Pipe class
  class Pipe {
    constructor(x, topHeight) {
      this.x = x;
      this.top = topHeight;
      this.width = 68;
      this.passed = false;
    }
    update(delta) {
      this.x -= BASE_PIPE_SPEED * delta;
    }
    draw(ctx) {
      const pipeColor = getComputedStyle(document.documentElement).getPropertyValue('--pipe') || '#3ea34a';
      ctx.fillStyle = pipeColor;
      ctx.fillRect(this.x, 0, this.width, this.top);
      const bottomY = this.top + PIPE_GAP;
      ctx.fillRect(this.x, bottomY, this.width, INTERNAL_H - bottomY);
      // caps
      ctx.fillStyle = shadeColor(pipeColor, -6);
      ctx.fillRect(this.x - 6, this.top - 12, this.width + 12, 12);
      ctx.fillRect(this.x - 6, bottomY, this.width + 12, 12);
    }
    bounds() {
      return {
        left: this.x,
        right: this.x + this.width,
        topBottomGapTop: this.top,
        topBottomGapBottom: this.top + PIPE_GAP
      };
    }
  }

  // Reset game
  function resetGame(startTime) {
    bird = new Bird();
    pipes = [];
    lastPipeTime = startTime;
    score = 0;
    running = true;
    scoreLive && (scoreLive.innerText = '0');
    gameOverEl && gameOverEl.classList.add('hidden');
  }

  // Spawn pipe
  function spawnPipe() {
    const minTop = 60;
    const maxTop = INTERNAL_H - PIPE_GAP - 120;
    const top = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
    pipes.push(new Pipe(INTERNAL_W + 40, top));
  }

  // Collision detection (AABB vs pipes)
  function checkCollision() {
    const b = bird.bounds();
    // floor / ceiling
    if (b.top < 0 || b.bottom > INTERNAL_H) return true;
    for (const p of pipes) {
      const pb = p.bounds();
      // if bird horizontally overlaps pipe
      if (b.right > pb.left && b.left < pb.right) {
        // if bird is not within gap
        if (b.top < pb.topBottomGapTop || b.bottom > pb.topBottomGapBottom) {
          return true;
        }
      }
    }
    return false;
  }

  // Save score to localStorage
  function persistScore(name, pts) {
    try {
      const now = new Date().toISOString();
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      list.push({name: name, score: pts, date: now});
      list.sort((a,b)=>b.score - a.score || new Date(b.date) - new Date(a.date));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0,50)));
    } catch(e){ console.warn('save fail', e) }
  }

  function getScores() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch(e){ return [] }
  }

  function renderLeaderboard() {
    const list = getScores();
    leaderList.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.textContent = 'No scores yet — play and set the first high score!';
      leaderList.appendChild(li);
      return;
    }
    list.slice(0,10).forEach((s, idx) => {
      const li = document.createElement('li');
      const date = new Date(s.date);
      li.innerHTML = `<strong>#${idx+1} — ${escapeHtml(s.name)}</strong> <span style="float:right">${s.score}</span><br><small class="muted">${date.toLocaleString()}</small>`;
      leaderList.appendChild(li);
    });
  }

  // Draw everything (internal coords)
  function drawScene() {
    // background
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0,0,INTERNAL_W,INTERNAL_H);

    // subtle grid
    ctx.strokeStyle = 'rgba(31,111,235,0.03)';
    ctx.lineWidth = 1;
    for (let y=0; y<INTERNAL_H; y+=40) {
      ctx.beginPath();
      ctx.moveTo(0,y+0.5);
      ctx.lineTo(INTERNAL_W,y+0.5);
      ctx.stroke();
    }

    // pipes
    pipes.forEach(p => p.draw(ctx));

    // ground / horizon
    ctx.fillStyle = '#eef3f7';
    ctx.fillRect(0, INTERNAL_H - 48, INTERNAL_W, 48);

    // bird draw (kite)
    bird.draw(ctx);
  }

  // Game over
  function onGameOver() {
    finalScoreEl && (finalScoreEl.innerText = score);
    gameOverEl && gameOverEl.classList.remove('hidden');
    persistScore(playerName, score);
  }

  // game loop (timestamp in ms from rAF)
  function loop(t) {
    if (!lastFrameTime) lastFrameTime = t;
    // delta normalized to 60fps ticks: 1.0 means one 60fps frame
    const rawDeltaMs = t - lastFrameTime;
    const delta = rawDeltaMs / (1000 / 60);
    lastFrameTime = t;

    // spawn pipes on interval
    if (t - lastPipeTime >= PIPE_INTERVAL) {
      spawnPipe();
      lastPipeTime = t;
    }

    // update
    bird.update(delta);
    pipes.forEach(p => p.update(delta));
    // remove offscreen pipes
    pipes = pipes.filter(p => p.x + p.width > -40);

    // scoring: mark pipe as passed when bird crosses pipe center
    pipes.forEach(p => {
      if (!p.passed && (p.x + p.width/2) < bird.x) {
        p.passed = true;
        score += 1;
        scoreLive && (scoreLive.innerText = score);
      }
    });

    // draw
    drawScene();

    // collision?
    if (checkCollision()) {
      running = false;
      cancelAnimationFrame(loopId);
      onGameOver();
      return;
    }

    // continue
    loopId = requestAnimationFrame(loop);
  }

  // Input handlers
  function flapHandler() {
    if (!running) return;
    bird.flap();
  }

  // Start button wiring
  startBtn && startBtn.addEventListener('click', () => {
    const name = (discordInput.value || '').trim();
    playerName = name ? name : `Player`;
    overlay && overlay.classList.add('hidden');
    // reset timers and start loop
    lastFrameTime = 0;
    resetGame(performance.now());
    loopId = requestAnimationFrame(loop);
  });

  // click/tap for full canvas
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!running) return;
    flapHandler();
  }, {passive:false});

  // space for desktop
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!running) return;
      flapHandler();
    }
  });

  // Play again
  playAgain && playAgain.addEventListener('click', () => {
    overlay && overlay.classList.remove('hidden');
    gameOverEl && gameOverEl.classList.add('hidden');
  });

  // Leaderboard
  viewLeaderboard && viewLeaderboard.addEventListener('click', () => {
    renderLeaderboard();
    leaderModal && leaderModal.classList.remove('hidden');
  });
  showBoard && showBoard.addEventListener('click', () => {
    renderLeaderboard();
    leaderModal && leaderModal.classList.remove('hidden');
  });
  closeBoard && closeBoard.addEventListener('click', () => {
    leaderModal && leaderModal.classList.add('hidden');
  });
  clearScores && clearScores.addEventListener('click', () => {
    if (!confirm('Clear all local scores? This cannot be undone on this device.')) return;
    localStorage.removeItem(STORAGE_KEY);
    renderLeaderboard();
  });

  // initial visuals while logo loads
  logo.onload = () => {
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0,0,INTERNAL_W,INTERNAL_H);
    ctx.font = '26px Inter, Arial';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.fillText('Kite Pilot — Ready', INTERNAL_W/2, INTERNAL_H/2 - 20);
    ctx.drawImage(logo, INTERNAL_W/2 - 46, INTERNAL_H/2 - 6, 92, 70);
  };

  // initial leaderboard render (if UI asks)
  renderLeaderboard();

})();


















