/**
 * 动效引擎（零依赖）：
 *   subtle = 进场淡入(reveal) + 卡片 3D 微倾(tilt)
 *   full   = + 全屏粒子场(鼠标避让) + 光标拖尾 + 点击涟漪
 * 无障碍：prefers-reduced-motion 时整体禁用；隐藏标签页暂停 canvas。
 */

/** 从一句话识别动效级别 */
export function detectFx(sentence) {
  const s = String(sentence ?? '').toLowerCase();
  if (/粒子|动效|特效|炫|酷|闪闪|交互感|赛博/.test(s)) return 'full';
  if (/安静|禅|极简|静音|无动效|纯净/.test(s)) return 'off';
  return null; // 未指定
}

export function fxLevelOf(spec, paramLevel) {
  if (paramLevel && ['off', 'subtle', 'full'].includes(paramLevel)) return paramLevel;
  return spec?.fxLevel ?? 'subtle';
}

/** 注入到 </body> 前的配置与脚本标签 */
export function fxBoot(spec, level, accent) {
  if (level === 'off') return '';
  return `\n<script>window.ORCH_FX = { level: ${JSON.stringify(level)}, accent: ${JSON.stringify(accent)} };</script>
<script type="module" src="./fx.js"></script>`;
}

/** fx.js 源码（生成到每个启用动效的工作区） */
export function fxSource() {
  return `// OrchestrAI 动效引擎（零依赖，自动随风格强调色）
(() => {
  const cfg = window.ORCH_FX ?? { level: 'subtle', accent: '#00f5d4' };
  if (cfg.level === 'off') return;
  // 无障碍：系统"减少动效"时熔断；用户显式 ?fx=force 强制开启（自主选择优先）
  const forceFx = /[?&]fx=force/.test(location.search);
  if (!forceFx && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const style = document.createElement('style');
  style.textContent = [
    '.fx-wait { opacity: 0; transform: translateY(16px) scale(.98); }',
    '.fx-in { opacity: 1; transform: none; transition: opacity .55s cubic-bezier(.2,.7,.3,1), transform .55s cubic-bezier(.2,.7,.3,1); }',
    '.fx-tilt { transition: transform .18s ease, border-color .18s ease; will-change: transform; }',
  ].join('\\n');
  document.head.appendChild(style);

  /* ---- 进场淡入 ---- */
  const revealEls = [...document.querySelectorAll('.card, .ph, .ev')];
  revealEls.forEach((el) => el.classList.add('fx-wait'));
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { en.target.classList.add('fx-in'); io.unobserve(en.target); }
    }
  }, { threshold: 0.12 });
  revealEls.forEach((el) => io.observe(el));

  /* ---- 卡片 3D 微倾 ---- */
  const TILT_MAX = 5;
  for (const el of document.querySelectorAll('.card, .ph')) {
    el.classList.add('fx-tilt');
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = \`perspective(600px) rotateX(\${(-py * TILT_MAX).toFixed(2)}deg) rotateY(\${(px * TILT_MAX).toFixed(2)}deg) translateY(-2px)\`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  }

  if (cfg.level !== 'full') return;

  /* ---- 全屏 canvas：粒子避让 + 拖尾 + 涟漪 ---- */
  const canvas = document.createElement('canvas');
  canvas.id = 'fx-layer';
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const mouse = { x: -9999, y: -9999 };
  addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

  const N = Math.min(90, Math.max(36, Math.round(W * H / 16000)));
  const particles = Array.from({ length: N }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
    r: 1 + Math.random() * 2.2,
  }));
  const trail = [];
  const ripples = [];
  addEventListener('click', (e) => ripples.push({ x: e.clientX, y: e.clientY, r: 4, a: 0.6 }));

  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) loop(); });

  const AVOID_R = 110;
  function loop() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cfg.accent;

    // 粒子：漂浮 + 鼠标避让
    for (const p of particles) {
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < AVOID_R * AVOID_R && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (AVOID_R - d) / AVOID_R * 1.6;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
      p.vx *= 0.965; p.vy *= 0.965;
      p.vx += (Math.random() - 0.5) * 0.02;
      p.vy += (Math.random() - 0.5) * 0.02;
      p.x += p.vx; p.y += p.vy;
      if (p.x < -8) p.x = W + 8; if (p.x > W + 8) p.x = -8;
      if (p.y < -8) p.y = H + 8; if (p.y > H + 8) p.y = -8;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
      // 近邻连线（若有鼠标交互时的网络感）
      if (d2 < 260 * 260 && d2 > AVOID_R * AVOID_R) {
        ctx.globalAlpha = 0.10;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(mouse.x, mouse.y);
        ctx.stroke();
      }
    }

    // 光标拖尾
    if (mouse.x > -999) trail.push({ x: mouse.x, y: mouse.y, a: 0.5 });
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i];
      t.a -= 0.03;
      if (t.a <= 0) { trail.splice(i, 1); continue; }
      ctx.globalAlpha = t.a;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3.2 * t.a + 0.6, 0, 6.2832);
      ctx.fill();
    }
    if (trail.length > 60) trail.splice(0, trail.length - 60);

    // 点击涟漪
    ctx.strokeStyle = cfg.accent;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += 3.4; rp.a -= 0.016;
      if (rp.a <= 0) { ripples.splice(i, 1); continue; }
      ctx.globalAlpha = rp.a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, 6.2832);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  loop();
})();
`;
}
