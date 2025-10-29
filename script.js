// Kite Pilot — script.js
// Basic Flappy-like game, local leaderboard saved to localStorage
(() => {
  // ----- Config -----
  const CANVAS_ID = 'gameCanvas';
  const GRAVITY = 0.08;
  const FLAP_STRENGTH = -3;
  const PIPE_SPEED = 1.2;
  const PIPE_GAP = 260; // vertical gap
  const PIPE_INTERVAL = 1400; // ms between pipes
  const BIRD_X = 100; // fixed horizontal position of the kite
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

  // responsive canvas sizing (keeps internal resolution fixed for physics)
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / 480;
    canvas.style.height = `${480 * (rect.width / 480) * (720/480)}px`; // keep aspect
    canvas.width = 480;
    canvas.height = 720;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // assets
  const logo = new Image();
  logo.src = 'assets/kite_logo.png';

  // sound (tiny)
  let muted = true;
  const flapSound = new Audio();
  flapSound.src = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAA...'; // left empty to avoid large base64
  flapSound.volume = 0.25;

  muteBtn.addEventListener('click', () => {
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

  // Bird (kite) class
  class Bird {
    constructor() {
      this.x = BIRD_X;
      this.y = canvas.height / 2;
      this.vel = 0;
      this.width = 56;
      this.height = 42;
      this.rotation = 0;
    }
    flap() {
      this.vel = FLAP_STRENGTH;
      if (!muted) try { flapSound.cloneNode().play(); } catch(e){}
    }
    update() {
      this.vel += GRAVITY;
      this.y += this.vel;
      this.rotation = Math.max(Math.min(this.vel / 12, 0.8), -0.8);
    }
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      // draw kite logo image centered
      const iw = this.width, ih = this.height;
      ctx.drawImage(logo, -iw/2, -ih/2, iw, ih);
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
    update(dt) {
      this.x -= PIPE_SPEED;
    }
    draw(ctx) {
      // top pipe
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--pipe') || '#3ea34a';
      const radius = 8;
      // top rect
      ctx.fillRect(this.x, 0, this.width, this.top);
      // bottom rect
      const bottomY = this.top + PIPE_GAP;
      ctx.fillRect(this.x, bottomY, this.width, canvas.height - bottomY);
      // pipe caps (rounded)
      ctx.fillStyle = shadeColor('#3ea34a', -6);
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

  // utility: small color shade
  function shadeColor(hex, percent) {
    // hex like #RRGGBB
    const num = parseInt(hex.slice(1),16),
      r = (num >> 16) + percent,
      g = ((num >> 8) & 0x00FF) + percent,
      b = (num & 0x0000FF) + percent;
    return '#' + (0x1000000 + (clamp(r,0,255)<<16) + (clamp(g,0,255)<<8) + clamp(b,0,255)).toString(16).slice(1);
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  // Reset game
  function resetGame() {
    bird = new Bird();
    pipes = [];
    lastPipeTime = performance.now();
    score = 0;
    running = true;
    scoreLive.innerText = '0';
    gameOverEl.classList.add('hidden');
  }

  // Spawn pipe
  function spawnPipe() {
    const minTop = 60;
    const maxTop = canvas.height - PIPE_GAP - 120;
    const top = Math.floor(Math.random() * (maxTop - minTop + 1)) + minTop;
    pipes.push(new Pipe(canvas.width + 40, top));
  }

  // Collision detection (AABB vs pipes)
  function checkCollision() {
    const b = bird.bounds();
    // floor / ceiling
    if (b.top < 0 || b.bottom > canvas.height) return true;
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
      // sort desc and keep top 50
      list.sort((a,b)=>b.score - a.score || new Date(b.date) - new Date(a.date));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0,50)));
    } catch(e){ console.warn('save fail', e) }
  }

  function getScores() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch(e){ return [] }
  }

  // show leaderboard
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

  function escapeHtml(t){ return (t+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

  // Game loop
  function loop(t) {
    // spawn pipes on interval
    if (t - lastPipeTime > PIPE_INTERVAL) {
      spawnPipe();
      lastPipeTime = t;
    }

    // update
    bird.update();
    pipes.forEach(p => p.update());
    // remove offscreen pipes
    pipes = pipes.filter(p => p.x + p.width > -40);

    // scoring: mark pipe as passed when bird crosses pipe center
    pipes.forEach(p => {
      if (!p.passed && (p.x + p.width/2) < bird.x) {
        p.passed = true;
        score += 1;
        scoreLive.innerText = score;
      }
    });

    // draw scene
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

  // draw everything
  function drawScene() {
    // background sky / subtle grid
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // subtle data grid lines
    ctx.strokeStyle = 'rgba(31,111,235,0.03)';
    ctx.lineWidth = 1;
    for (let y=0; y<canvas.height; y+=40) {
      ctx.beginPath();
      ctx.moveTo(0,y+0.5);
      ctx.lineTo(canvas.width,y+0.5);
      ctx.stroke();
    }

    // pipes
    pipes.forEach(p => p.draw(ctx));

    // ground / horizon
    ctx.fillStyle = '#eef3f7';
    ctx.fillRect(0, canvas.height - 48, canvas.width, 48);

    // bird draw (kite)
    bird.draw(ctx);
  }

  // handle game over
  function onGameOver() {
    finalScoreEl.innerText = score;
    gameOverEl.classList.remove('hidden');

    // persist score locally
    persistScore(playerName, score);
  }

  // Input handlers
  function flapHandler(e) {
    if (!running) return;
    bird.flap();
  }

  // Start button wiring
  startBtn.addEventListener('click', () => {
    const name = (discordInput.value || '').trim();
    playerName = name ? name : `Player`;
    overlay.classList.add('hidden');
    resetGame();
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
  playAgain.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    gameOverEl.classList.add('hidden');
  });

  // Leaderboard
  viewLeaderboard.addEventListener('click', () => {
    renderLeaderboard();
    leaderModal.classList.remove('hidden');
  });
  showBoard.addEventListener('click', () => {
    renderLeaderboard();
    leaderModal.classList.remove('hidden');
  });
  closeBoard.addEventListener('click', () => {
    leaderModal.classList.add('hidden');
  });
  clearScores.addEventListener('click', () => {
    if (!confirm('Clear all local scores? This cannot be undone on this device.')) return;
    localStorage.removeItem(STORAGE_KEY);
    renderLeaderboard();
  });

  // initial visuals while logo loads
  logo.onload = () => {
    // draw a quick splash in the canvas
    ctx.fillStyle = '#f7f6f2';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.font = '26px Inter, Arial';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.fillText('Kite Pilot — Ready', canvas.width/2, canvas.height/2 - 20);
    ctx.drawImage(logo, canvas.width/2 - 46, canvas.height/2 - 6, 92, 70);
  };

  // small helper for mobile: if user taps overlay on start, show keyboard to enter name
  overlay.addEventListener('pointerdown', (e) => {
    // allow clicking input etc; nothing needed
  });

})();









