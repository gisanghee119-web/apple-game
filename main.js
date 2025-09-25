const COLS = 10; // x
const ROWS = 10; // y
const BOARD_PADDING = 20;

const board = document.getElementById('board');
const dragBox = document.getElementById('dragBox');
const fxCanvas = document.getElementById('fxCanvas');
const scoreEl = document.getElementById('score');
const scoreDigits = document.getElementById('scoreDigits');
const bestScoreDigits = document.getElementById('bestScoreDigits');
const timeDigits = document.getElementById('timeDigits');
const statusText = document.getElementById('statusText');
const modal = document.getElementById('gameOver');
const finalScoreEl = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');
const introModal = document.getElementById('introModal');
const practiceBtn = document.getElementById('practiceBtn');
const startBtn = document.getElementById('startBtn');
const introBtn = document.getElementById('introBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const hintBtn = document.getElementById('hintBtn');
const toggleBgmBtn = document.getElementById('toggleBgm');
const toggleSfxBtn = document.getElementById('toggleSfx');

const bgm = document.getElementById('bgm');
const sfxSuccess = document.getElementById('sfxSuccess');
const sfxWarn = document.getElementById('sfxWarn');
const sfxGameOver = document.getElementById('sfxGameOver');
const bgm2 = document.getElementById('bgm2');
const bgm3 = document.getElementById('bgm3');

let grid = []; // 2D array of cells
let score = 0;
let bestScore = 0;
let timer = 120;
let timerId = null;
let isPractice = false;
let currentMode = null;
let isPaused = false;
let bgmEnabled = true;
let sfxEnabled = true;

// selection state
let isDragging = false;
let dragStart = {x:0, y:0};
let dragRect = {x:0,y:0,w:0,h:0};
let selectedSet = new Set();

// canvas for effects
const ctx = fxCanvas.getContext('2d');
let particles = [];
// WebAudio fallback
let audioCtx = null;
let bgmTimer = null; // synth bgm timer
let hasUserInteracted = false;
let bgmRotateTimer = null; // rotate between audio bgms
let currentBgmIndex = 0;
let bgmList = [];
let bgmVolume = 0.5;
let lastScoreMs = 0;
let comboCount = 0;

function init() {
  mountGrid();
  attachInput();
  // Start on intro modal
  openIntro();
  // load best score
  try { bestScore = Number(localStorage.getItem('bestScore')) || 0; } catch(_) { bestScore = 0; }
  renderDigits(bestScoreDigits, bestScore);
}

function mountGrid() {
  const gridEl = document.createElement('div');
  gridEl.className = 'grid';
  board.appendChild(gridEl);
  grid = [];
  for (let r=0; r<ROWS; r++) {
    const row = [];
    for (let c=0; c<COLS; c++) {
      const value = Math.floor(Math.random()*9)+1;
      const cell = { r, c, value, removed:false, el:null };
      const el = document.createElement('div');
      el.className = 'apple';
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      el.textContent = String(value);
      cell.el = el;
      gridEl.appendChild(el);
      row.push(cell);
    }
    grid.push(row);
  }
  resizeCanvas();
}

function attachInput() {
  board.addEventListener('mousedown', (e)=>{
    if (modal && !modal.classList.contains('hidden')) return;
    if (isPaused) return;
    isDragging = true;
    const {x, y} = getLocalMouse(e);
    dragStart = {x, y};
    updateDragRect(x, y);
    dragBox.classList.remove('hidden');
    statusText.textContent = '상태: 선택 중';
  });

  board.addEventListener('mousemove', (e)=>{
    if (!isDragging) return;
    const {x, y} = getLocalMouse(e);
    updateDragRect(x, y);
    updateSelection();
  });

  window.addEventListener('mouseup', ()=>{
    if (!isDragging) return;
    isDragging = false;
    dragBox.classList.add('hidden');
    applySelection();
    clearSelection();
    statusText.textContent = '상태: playing';
  });

  restartBtn.addEventListener('click', ()=>{ openIntro(); });
  if (practiceBtn) practiceBtn.addEventListener('click', ()=>{ startGame('practice'); });
  if (startBtn) startBtn.addEventListener('click', ()=>{ startGame('main'); });
  if (introBtn) introBtn.addEventListener('click', openIntro);
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  if (resetBtn) resetBtn.addEventListener('click', ()=> resetGame());
  if (hintBtn) hintBtn.addEventListener('click', showHintOnce);
  if (toggleBgmBtn) toggleBgmBtn.addEventListener('click', ()=>{
    bgmEnabled = !bgmEnabled;
    toggleBgmBtn.setAttribute('aria-pressed', String(bgmEnabled));
    toggleBgmBtn.textContent = bgmEnabled ? 'BGM 켜짐' : 'BGM 꺼짐';
    if (bgmEnabled) ensureAudio(); else stopSynthBgm();
  });
  if (toggleSfxBtn) toggleSfxBtn.addEventListener('click', ()=>{
    sfxEnabled = !sfxEnabled;
    toggleSfxBtn.setAttribute('aria-pressed', String(sfxEnabled));
    toggleSfxBtn.textContent = sfxEnabled ? '효과음 켜짐' : '효과음 꺼짐';
  });

  const timeInput = document.getElementById('timeInput');
  const applyTimeBtn = document.getElementById('applyTimeBtn');
  const bgmVolInput = document.getElementById('bgmVol');
  if (applyTimeBtn && timeInput) applyTimeBtn.addEventListener('click', ()=>{
    const val = Math.max(10, Math.min(600, Number(timeInput.value)||120));
    if (!isPractice){
      timer = val; renderDigits(timeDigits, timer);
    }
  });
  if (bgmVolInput){
    bgmVolInput.value = String(bgmVolume);
    bgmVolInput.addEventListener('input', ()=>{
      bgmVolume = Number(bgmVolInput.value);
      applyBgmVolume();
    });
  }

  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(tickFX);
}

function startGame(mode='main'){
  // prepare state
  isPractice = (mode === 'practice');
  isPaused = false;
  score = 0; renderDigits(scoreDigits, 0);
  clearInterval(timerId);
  // If mode changed, remount a fresh grid
  if (currentMode !== mode){
    const oldGridEl = board.querySelector('.grid');
    if (oldGridEl) oldGridEl.remove();
    particles = [];
    mountGrid();
  }
  currentMode = mode;
  if (isPractice){
    timer = Infinity;
    renderDigits(timeDigits, 0);
    statusText.textContent = '상태: 연습 중';
  } else {
    timer = 120; renderDigits(timeDigits, timer);
    statusText.textContent = '상태: playing';
    if (bgmEnabled) ensureAudio();
    timerId = setInterval(()=>{
      if (isPaused) return;
      timer -= 1;
      renderDigits(timeDigits, Math.max(0,timer));
      if (timer <= 10 && timer > 0) playWarn();
      if (timer <= 0) {
        clearInterval(timerId);
        gameOver();
      }
    }, 1000);
  }
  closeIntro();
}

function resetGame(){
  // clear board
  const oldGridEl = board.querySelector('.grid');
  if (oldGridEl) oldGridEl.remove();
  particles = [];
  modal.classList.add('hidden');
  mountGrid();
  startGame(isPractice ? 'practice' : 'main');
}

function gameOver(){
  finalScoreEl.textContent = String(score);
  modal.classList.remove('hidden');
  stopSynthBgm();
  playGameOver();
  statusText.textContent = '상태: 게임 오버';
  updateBestScore(true);
}

function getLocalMouse(e){
  const rect = board.getBoundingClientRect();
  return { x: e.clientX - rect.left + board.scrollLeft, y: e.clientY - rect.top + board.scrollTop };
}

function updateDragRect(x, y){
  const left = Math.min(dragStart.x, x);
  const top = Math.min(dragStart.y, y);
  const width = Math.abs(x - dragStart.x);
  const height = Math.abs(y - dragStart.y);
  dragRect = {x:left, y:top, w:width, h:height};
  dragBox.style.left = left + 'px';
  dragBox.style.top = top + 'px';
  dragBox.style.width = width + 'px';
  dragBox.style.height = height + 'px';
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh){
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function updateSelection(){
  selectedSet.clear();
  for (const row of grid){
    for (const cell of row){
      if (cell.removed) continue;
      const rect = cell.el.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const cx = rect.left - boardRect.left + board.scrollLeft;
      const cy = rect.top - boardRect.top + board.scrollTop;
      const overlap = rectsOverlap(dragRect.x, dragRect.y, dragRect.w, dragRect.h, cx, cy, rect.width, rect.height);
      if (overlap){
        selectedSet.add(cell);
        cell.el.classList.add('selected');
      } else {
        cell.el.classList.remove('selected');
      }
    }
  }
}

function applySelection(){
  const arr = Array.from(selectedSet);
  const sum = arr.reduce((acc,c)=>acc + c.value, 0);
  if (sum === 10 && arr.length > 0){
    // remove and score
    for (const c of arr){
      c.removed = true;
      c.el.classList.remove('selected');
      c.el.classList.add('hidden');
    }
    const nowMs = Date.now();
    // combo: if scoring happens within 2.5s window, increase combo
    comboCount = (nowMs - lastScoreMs <= 2500) ? comboCount + 1 : 1;
    lastScoreMs = nowMs;
    score += arr.length * comboCount;
    renderDigits(scoreDigits, score);
    updateBestScore();
    playSuccess();
    spawnImpact(arr);
    showComboPopup(arr);
  } else {
    // clear visual selection
    for (const c of arr){ c.el.classList.remove('selected'); }
  }
}

function clearSelection(){
  selectedSet.clear();
}

// Effects
function resizeCanvas(){
  fxCanvas.width = Math.max(board.clientWidth, board.scrollWidth);
  fxCanvas.height = Math.max(board.clientHeight, board.scrollHeight);
}

function spawnImpact(cells){
  // Emit particles around average position
  const pts = cells.map(c=>{
    const rect = c.el.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    const x = rect.left - b.left + board.scrollLeft + rect.width/2;
    const y = rect.top - b.top + board.scrollTop + rect.height/2;
    return {x,y};
  });
  const avg = pts.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0});
  avg.x/=pts.length; avg.y/=pts.length;
  const colors = ['#fff176','#ffd54f','#ffca28','#ffb300','#ff7043'];
  for (let i=0;i<60;i++){
    const ang = Math.random()*Math.PI*2;
    const spd = 2 + Math.random()*4;
    particles.push({
      x:avg.x, y:avg.y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd - 1,
      life: 40 + Math.random()*20, age:0, size:2+Math.random()*3,
      color: colors[Math.floor(Math.random()*colors.length)]
    });
  }
}

function tickFX(){
  ctx.clearRect(0,0,fxCanvas.width, fxCanvas.height);
  particles = particles.filter(p=>p.age < p.life);
  for (const p of particles){
    p.age++;
    p.vy += 0.08; // gravity
    p.x += p.vx;
    p.y += p.vy;
    const alpha = 1 - p.age / p.life;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(tickFX);
}

// Kick off
window.addEventListener('DOMContentLoaded', init);

// ---------- Audio helpers ----------
function ensureAudio(){
  // autoplay policy: wait first interaction
  if (!hasUserInteracted){
    const resume = ()=>{
      hasUserInteracted = true;
      if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      try { audioCtx.resume(); } catch(_){}
      if (bgmEnabled){ startBgmRotation(); }
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
    };
    document.addEventListener('pointerdown', resume, {once:true});
    document.addEventListener('keydown', resume, {once:true});
  } else {
    if (bgmEnabled){ startBgmRotation(); }
  }
}

function playSuccess(){
  if (!sfxEnabled) return;
  try { sfxSuccess.currentTime = 0; sfxSuccess.play().catch(()=>{ successSynth(); }); }
  catch(_) { successSynth(); }
}

function playWarn(){
  if (!sfxEnabled) return;
  try { sfxWarn.currentTime = 0; sfxWarn.play().catch(()=>{ warnSynth(); }); }
  catch(_) { warnSynth(); }
}

function playGameOver(){
  if (!sfxEnabled) return;
  if (sfxGameOver){
    try { sfxGameOver.currentTime = 0; sfxGameOver.play().catch(()=>{ warnSynth(); }); }
    catch(_) { warnSynth(); }
  } else { warnSynth(); }
}

function startSynthBgm(){
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  stopSynthBgm();
  const notes = [262, 330, 392, 523, 392, 330]; // simple C major arpeggio
  let i = 0;
  bgmTimer = setInterval(()=>{
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = notes[i % notes.length];
    gain.gain.value = 0.02 + bgmVolume * 0.12; // volume mapped
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
    i++;
  }, 220);
}

function stopSynthBgm(){
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  try { bgm.pause(); } catch(_){ }
  try { bgm2.pause(); } catch(_){ }
  try { bgm3.pause(); } catch(_){ }
  if (bgmRotateTimer){ clearInterval(bgmRotateTimer); bgmRotateTimer = null; }
}

function successSynth(){
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.4, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

function warnSynth(){
  if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(220, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.36);
}

// ----- UI helpers -----
function openIntro(){
  clearInterval(timerId);
  stopSynthBgm();
  try { bgm.currentTime = 0; } catch(_){ }
  modal.classList.add('hidden');
  if (introModal) introModal.classList.remove('hidden');
  statusText.textContent = '상태: 준비';
}

function closeIntro(){
  if (introModal) introModal.classList.add('hidden');
}

function togglePause(){
  if (isPractice) return; // practice has no timer
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? '재개' : '일시정지';
  statusText.textContent = isPaused ? '상태: 일시정지' : '상태: playing';
}

// ----- Digit rendering -----
const DIGIT_PATHS = [
  'M4 6 h16 v28 h-16 z', // 0 (rounded rect look via stroke)
];

function renderDigits(container, value){
  if (!container) return;
  container.innerHTML = '';
  const str = String(value);
  for (const ch of str){
    const n = Number.isFinite(+ch) ? +ch : 0;
    container.appendChild(makeDigit(n));
  }
}

function updateBestScore(force){
  if (force || score > bestScore){
    bestScore = Math.max(bestScore, score);
    renderDigits(bestScoreDigits, bestScore);
    try { localStorage.setItem('bestScore', String(bestScore)); } catch(_){ }
  }
}

function showHintOnce(){
  if (isPaused || (modal && !modal.classList.contains('hidden'))) return;
  const set = findAnyValidTenSet();
  if (!set) return;
  for (const cell of set){ cell.el.classList.add('hint'); }
  setTimeout(()=>{ for (const cell of set){ cell.el.classList.remove('hint'); } }, 900);
}

function findAnyValidTenSet(){
  // Try pairs first (fast)
  const available = [];
  for (const row of grid){ for (const cell of row){ if (!cell.removed) available.push(cell); } }
  const byVal = new Map();
  for (const c of available){
    if (!byVal.has(c.value)) byVal.set(c.value, []);
    byVal.get(c.value).push(c);
  }
  for (const c of available){
    const need = 10 - c.value;
    const list = byVal.get(need) || [];
    for (const other of list){ if (other !== c) return [c, other]; }
  }
  // Try small combinations up to 4 items to keep it quick
  const n = Math.min(available.length, 20);
  for (let i=0;i<n;i++){
    for (let j=i+1;j<n;j++){
      for (let k=j+1;k<n;k++){
        const s = available[i].value + available[j].value + available[k].value;
        if (s === 10) return [available[i],available[j],available[k]];
        for (let l=k+1;l<n;l++){
          if (s + available[l].value === 10) return [available[i],available[j],available[k],available[l]];
        }
      }
    }
  }
  return null;
}

function makeDigit(n){
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 36');
  svg.innerHTML = getDigitSVG(n);
  const wrap = document.createElement('div');
  wrap.className = 'digit';
  wrap.appendChild(svg);
  return wrap;
}

function getDigitSVG(n){
  // 7-seg style digits with rounded segments
  const color = '#1f4e2f';
  const on = color;
  const off = 'rgba(0,0,0,.08)';
  // segments: a,b,c,d,e,f,g
  const seg = (id, active)=>`<rect rx="3" ry="3" x="${id[0]}" y="${id[1]}" width="${id[2]}" height="${id[3]}" fill="${active?on:off}"/>`;
  const a=[4,2,16,4], b=[18,4,4,12], c=[18,20,4,12], d=[4,32,16,4], e=[2,20,4,12], f=[2,4,4,12], g=[4,17,16,4];
  const map = {
    0:[1,1,1,1,1,1,0],
    1:[0,1,1,0,0,0,0],
    2:[1,1,0,1,1,0,1],
    3:[1,1,1,1,0,0,1],
    4:[0,1,1,0,0,1,1],
    5:[1,0,1,1,0,1,1],
    6:[1,0,1,1,1,1,1],
    7:[1,1,1,0,0,0,0],
    8:[1,1,1,1,1,1,1],
    9:[1,1,1,1,0,1,1]
  }[n] || [0,0,0,0,0,0,0];
  return `
    <g>
      ${seg(a,map[0])}
      ${seg(b,map[1])}
      ${seg(c,map[2])}
      ${seg(d,map[3])}
      ${seg(e,map[4])}
      ${seg(f,map[5])}
      ${seg(g,map[6])}
    </g>`;
}


// ----- BGM rotation & volume -----
function startBgmRotation(){
  stopSynthBgm();
  bgmList = [bgm, bgm2, bgm3].filter(a=>!!a);
  const tryPlay = (audio)=> new Promise(res=>{ try{ audio.volume = bgmVolume; audio.currentTime = 0; audio.play().then(()=>res(true)).catch(()=>res(false)); } catch(_){ res(false); } });
  const playIndex = async (idx)=>{
    for (const a of bgmList){ try{ a.pause(); }catch(_){}}
    const ok = await tryPlay(bgmList[idx]);
    if (!ok){ startSynthBgm(); } else { if (bgmTimer){ clearInterval(bgmTimer); bgmTimer=null; } }
    currentBgmIndex = idx;
  };
  playIndex(0);
  if (bgmRotateTimer) clearInterval(bgmRotateTimer);
  bgmRotateTimer = setInterval(()=>{
    currentBgmIndex = (currentBgmIndex + 1) % bgmList.length;
    playIndex(currentBgmIndex);
  }, 45000);
}

function applyBgmVolume(){
  try{ bgm.volume = bgmVolume; }catch(_){ }
  try{ bgm2.volume = bgmVolume; }catch(_){ }
  try{ bgm3.volume = bgmVolume; }catch(_){ }
}

// ----- Combo popup -----
function showComboPopup(cells){
  if (!cells.length) return;
  const rect = cells[0].el.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  const x = rect.left - b.left + board.scrollLeft + rect.width/2;
  const y = rect.top - b.top + board.scrollTop;
  const el = document.createElement('div');
  el.className = 'combo-pop';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.textContent = `${comboCount}콤보!`;
  board.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 900);
}
