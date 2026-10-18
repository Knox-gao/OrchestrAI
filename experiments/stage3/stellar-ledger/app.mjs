// 星轨档案馆 · 交互层
// 白名单动效（仅 3 项，均带目的）：①星点渐次点亮（进场建立星等亮度层级）
// ②档案卡滑入（点击聚焦反馈）③焦点呼吸脉冲（当前选中指示）。其余一律不做。
import { STARS, SPECTRAL_COLORS, SPECTRAL_NAMES } from './data.mjs';

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2);
function resize() {
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
addEventListener('resize', resize);

// 巡天状态：平移 + 微缩放
let panX = 0, panY = 0, zoom = 1;
let targetPanX = 0, targetPanY = 0, targetZoom = 1;
let hoverStar = null, focusStar = null;
let activeSpecs = new Set(Object.keys(SPECTRAL_COLORS));
let bootT = reduced ? 1e9 : performance.now(); // 星点渐次点亮的进场时间轴

document.getElementById('count-star').textContent = STARS.length;

// 背景星野（确定性生成，纯装饰暗层，不参与交互）
const bgStars = Array.from({ length: 260 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12345.6789;
  const fa = a - Math.floor(a), fb = b - Math.floor(b), fc = ((a + b) % 1 + 1) % 1;
  return { x: fa * 2000, y: fb * 1400, r: 0.3 + fc * 0.9, o: 0.12 + fc * 0.3 };
});

const magToR = (mag) => Math.max(1.6, 6.2 - mag * 2.1); // 星等→点径（越亮越大）

function starPos(s) {
  return {
    x: (s.x * W * 1.15 - W * 0.075 + panX) * zoom + W * (1 - zoom) / 2,
    y: (s.y * H * 1.15 - H * 0.075 + panY) * zoom + H * (1 - zoom) / 2,
  };
}

function draw(t) {
  panX += (targetPanX - panX) * 0.08;
  panY += (targetPanY - panY) * 0.08;
  zoom += (targetZoom - zoom) * 0.08;

  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  // 星野（随视差轻移）
  const ox = ((panX * 0.25) % 2000 + 2000) % 2000;
  for (const s of bgStars) {
    const x = s.x - ox;
    if (x < -2 || x > W + 2) continue;
    ctx.fillStyle = `rgba(231,225,213,${s.o})`;
    ctx.fillRect(x, (s.y + panY * 0.2) % H, s.r, s.r);
  }

  const elapsed = (t - bootT) / 1000;
  for (const s of STARS) {
    if (!activeSpecs.has(s.spec)) continue;
    const p = starPos(s);
    if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
    const color = SPECTRAL_COLORS[s.spec];
    const r = magToR(s.mag) * zoom;
    const isHover = hoverStar === s, isFocus = focusStar === s;
    // ① 进场：按星等从亮到暗渐次点亮（brightest first）
    const order = (s.mag + 2) / 4.2;
    const lit = reduced ? 1 : Math.min(1, Math.max(0, (elapsed - order * 1.1) / 0.6));
    if (lit <= 0) continue;
    // 光晕
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.2);
    glow.addColorStop(0, color + 'aa');
    glow.addColorStop(1, color + '00');
    ctx.globalAlpha = lit * (isHover || isFocus ? 1 : 0.8);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.2, 0, 6.2832); ctx.fill();
    // 星点
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * (isHover ? 1.25 : 1), 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    // ③ 焦点呼吸（仅选中星，服务定位）
    if (isFocus && !reduced) {
      const pr = r * 2.6 + Math.sin(t / 460) * 2.5;
      ctx.strokeStyle = 'rgba(212,183,132,.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, pr, 0, 6.2832); ctx.stroke();
    }
    // 名称标签（亮星或悬停时）：等宽小字档案标签；星点在右半画布时标签改置左侧，避开密集区重叠
    if (s.mag < 0.8 || isHover || isFocus) {
      ctx.font = '300 10px "IBM Plex Mono", monospace';
      ctx.fillStyle = `rgba(231,225,213,${0.5 + 0.4 * lit})`;
      if (p.x > W * 0.62) {
        ctx.textAlign = 'right';
        ctx.fillText(`${s.n} · ${s.en}`, p.x - r - 8, p.y + 3);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(`${s.n} · ${s.en}`, p.x + r + 8, p.y + 3);
      }
    }
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

/* ---- 交互：拖动巡天 / 悬停 / 点击档案（300ms 内打开） ---- */
let dragging = false, moved = 0, lx = 0, ly = 0;
const pick = (mx, my) => {
  let best = null, bd = 26;
  for (const s of STARS) {
    if (!activeSpecs.has(s.spec)) continue;
    const p = starPos(s);
    const d = Math.hypot(p.x - mx, p.y - my);
    if (d < bd + magToR(s.mag)) { bd = d; best = s; }
  }
  return best;
};
canvas.addEventListener('mousedown', (e) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; canvas.classList.add('grabbing'); });
addEventListener('mousemove', (e) => {
  if (dragging) {
    targetPanX += (e.clientX - lx) * 0.9; targetPanY += (e.clientY - ly) * 0.9;
    moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
  } else {
    hoverStar = pick(e.clientX, e.clientY);
    canvas.style.cursor = hoverStar ? 'pointer' : 'grab';
  }
});
addEventListener('mouseup', () => { dragging = false; canvas.classList.remove('grabbing'); });
canvas.addEventListener('click', (e) => {
  if (moved > 6) return;
  const s = pick(e.clientX, e.clientY);
  if (!s) return;
  focusStar = s;
  const t0 = performance.now(); // 验收条件：300ms 内打开档案
  document.getElementById('c-bayer').textContent = s.bayer + ' · ' + s.mag.toFixed(2) + ' 等';
  document.getElementById('c-name').textContent = s.n;
  document.getElementById('c-en').textContent = s.en;
  document.getElementById('c-mag').textContent = s.mag.toFixed(2);
  document.getElementById('c-dist').textContent = s.dist + ' ly';
  document.getElementById('c-spec').textContent = s.spec + ' 型';
  const sw = document.getElementById('c-swatch');
  sw.style.background = SPECTRAL_COLORS[s.spec];
  sw.style.color = SPECTRAL_COLORS[s.spec];
  document.getElementById('c-specname').textContent = SPECTRAL_NAMES[s.spec];
  document.getElementById('c-note').textContent = s.note;
  card.classList.add('open'); // ② 档案卡滑入（聚焦反馈）
  console.debug('[ledger] 档案打开耗时', Math.round(performance.now() - t0), 'ms（验收线 300ms）');
});
document.getElementById('card-x').addEventListener('click', () => { card.classList.remove('open'); focusStar = null; });
addEventListener('keydown', (e) => { if (e.key === 'Escape') { card.classList.remove('open'); focusStar = null; } });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  targetZoom = Math.max(0.7, Math.min(2.4, targetZoom * (e.deltaY < 0 ? 1.08 : 0.93)));
}, { passive: false });

/* ---- 触屏：单指巡天 + 轻点档案 ---- */
let tX = 0, tY = 0;
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { dragging = true; moved = 0; tX = e.touches[0].clientX; tY = e.touches[0].clientY; } }, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (dragging && e.touches.length === 1) {
    targetPanX += (e.touches[0].clientX - tX) * 0.9; targetPanY += (e.touches[0].clientY - tY) * 0.9;
    moved += Math.abs(e.touches[0].clientX - tX) + Math.abs(e.touches[0].clientY - tY);
    tX = e.touches[0].clientX; tY = e.touches[0].clientY;
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (moved < 8 && e.changedTouches.length) {
    const s = pick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (s) { focusStar = s; canvas.dispatchEvent(new MouseEvent('click', { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY })); }
  }
  dragging = false;
});

/* ---- 光谱过滤 ---- */
const lgNote = document.getElementById('lg-note');
for (const btn of document.querySelectorAll('.lg')) {
  btn.addEventListener('click', () => {
    const sp = btn.dataset.spec;
    if (activeSpecs.has(sp)) activeSpecs.delete(sp); else activeSpecs.add(sp);
    btn.classList.toggle('on', activeSpecs.has(sp));
    const n = activeSpecs.size;
    lgNote.textContent = n === 7 ? '全部显示' : n === 0 ? '（无——至少保留一型）' : `显示 ${n}/7 型`;
    if (n === 0) { activeSpecs.add(sp); btn.classList.add('on'); lgNote.textContent = '显示 1/7 型'; }
    document.getElementById('count-star').textContent = STARS.filter((s) => activeSpecs.has(s.spec)).length;
  });
}
