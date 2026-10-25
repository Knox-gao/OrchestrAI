/**
 * 滚动叙事运行时（cinematic 层）：为 PagePlan 页面提供滚动驱动的能力。
 *
 * 能力全部由 data 属性驱动，模型只需要声明语义，运行时负责效果：
 *   [data-rv]                      进入视口时显现（可加 data-rv-i 做阶梯延迟）
 *   [data-count]                   数字滚动（data-to 终值、data-dec 小数位、data-pre/data-suf 前后缀）
 *   [data-scene="pinned"]          钉住场景：stage 高stage 高度内 sticky，滚动进度映射为 --p (0..1)；
 *                                  子元素 [data-at] 在进度越过阈值时点亮（.lit）；
 *                                  [data-meter] 计数器按进度从 data-from 插值到 data-to
 *   [data-scene="gallery"]         横向长廊：垂直滚动映射为轨道水平位移
 *   #pp-progress                   顶部阅读进度条
 *
 * 设计约束（与手工法拉利页同一套经验）：
 *   - prefers-reduced-motion：跳过全部动画，直接呈现终态（计数器直接写终值）
 *   - 无匹配元素时整个运行时空转，零副作用 —— 因此可以无条件嵌入
 *   - 不接管滚动本身（不做 lerp 平滑），native scroll + rAF 读进度，稳定性优先
 */

function scrollCinemaMain() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document;

  // ---------- 顶部进度条 ----------
  const bar = doc.createElement('div');
  bar.id = 'pp-progress';
  doc.body.appendChild(bar);

  // ---------- 显现 ----------
  const revealEls = [...doc.querySelectorAll('[data-rv]')];
  if (reduce) {
    revealEls.forEach((el) => el.classList.add('rv-in'));
  } else if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        const delay = Number(el.getAttribute('data-rv-i') || 0);
        setTimeout(() => el.classList.add('rv-in'), delay * 90);
        io.unobserve(el);
      }
    }, { threshold: 0.18 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('rv-in'));
  }

  // ---------- 数字滚动 ----------
  function fmt(value, decimals) {
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function countTo(el) {
    const to = Number(el.getAttribute('data-to'));
    const decimals = Number(el.getAttribute('data-dec') || 0);
    const pre = el.getAttribute('data-pre') || '';
    const suf = el.getAttribute('data-suf') || '';
    if (!Number.isFinite(to)) return;
    if (reduce) { el.textContent = pre + fmt(to, decimals) + suf; return; }
    const dur = 1300;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = pre + fmt(to * eased, decimals) + suf;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const countEls = [...doc.querySelectorAll('[data-count]')];
  if (countEls.length && 'IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        countTo(en.target);
        io.unobserve(en.target);
      }
    }, { threshold: 0.5 });
    countEls.forEach((el) => io.observe(el));
  }

  // ---------- 钉住场景与横向长廊 ----------
  // 长廊舞台的滚动高度取决于轨道总宽（渲染时未知），运行时按内容设定
  doc.querySelectorAll('[data-scene="gallery"]').forEach((stage) => {
    if (reduce) return;
    const track = stage.querySelector('[data-track]');
    if (!track) return;
    const dist = Math.max(0, track.scrollWidth - window.innerWidth);
    stage.style.height = (dist + window.innerHeight) + 'px';
  });

  const stages = [...doc.querySelectorAll('[data-scene="pinned"],[data-scene="gallery"]')];
  function applyProgress(stage, p) {
    const clamped = Math.max(0, Math.min(1, p));
    stage.style.setProperty('--p', String(clamped));
    stage.querySelectorAll('[data-at]').forEach((el) => {
      const at = Number(el.getAttribute('data-at'));
      if (Number.isFinite(at)) el.classList.toggle('lit', clamped >= at);
    });
    stage.querySelectorAll('[data-meter]').forEach((el) => {
      const from = Number(el.getAttribute('data-from') || 0);
      const to = Number(el.getAttribute('data-to') || 0);
      const decimals = Number(el.getAttribute('data-dec') || 0);
      el.textContent = (el.getAttribute('data-pre') || '') + fmt(from + (to - from) * clamped, decimals) + (el.getAttribute('data-suf') || '');
    });
    if (stage.getAttribute('data-scene') === 'gallery') {
      const track = stage.querySelector('[data-track]');
      if (track) {
        const dist = Math.max(0, track.scrollWidth - stage.clientWidth);
        track.style.transform = 'translate3d(' + (-dist * clamped) + 'px,0,0)';
      }
    }
  }
  function finalStates(stage) {
    stage.style.setProperty('--p', '1');
    stage.querySelectorAll('[data-at]').forEach((el) => el.classList.add('lit'));
    applyProgress(stage, 1);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const docH = doc.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (docH > 0 ? (window.scrollY / docH) * 100 : 0) + '%';
      if (!stages.length || reduce) return;
      for (const stage of stages) {
        const rect = stage.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        if (total <= 0) { applyProgress(stage, rect.top < 0 ? 1 : 0); continue; }
        applyProgress(stage, -rect.top / total);
      }
    });
  }
  if (reduce) {
    stages.forEach(finalStates);
    bar.style.width = '100%';
  } else {
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }
}

export const SCROLL_RUNTIME = `(${scrollCinemaMain.toString()})();`;

/** 渲染器侧的配套 CSS（与运行时一起构成完整能力）。 */
export const SCROLL_CINEMA_CSS = [
  '#pp-progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--pp-accent);z-index:60;transition:width .1s linear}',
  // 显现
  '[data-rv]{opacity:0;transform:translateY(26px);transition:opacity .8s ease,transform .8s cubic-bezier(.16,1,.3,1)}',
  '[data-rv].rv-in{opacity:1;transform:none}',
  // 钉住场景
  '.pp-sec-pin{position:relative}',
  '.pp-pin-stage{position:relative}',
  '.pp-pin-view{position:sticky;top:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:clamp(1rem,4vw,3rem) 0}',
  '.pp-pin-view [data-at]{opacity:.22;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}',
  '.pp-pin-view [data-at].lit{opacity:1;transform:none}',
  '.pp-pin-meter{font-size:clamp(2.6rem,7vw,5.6rem);font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:var(--pp-accent)}',
  // 横向长廊
  '.pp-sec-gallery{overflow:hidden}',
  '.pp-hstage{position:relative}',
  '.pp-htrack{display:flex;gap:clamp(1rem,2.5vw,2rem);width:max-content;will-change:transform;padding-inline:clamp(1rem,4vw,3rem)}',
  '.pp-htrack>.pp-card{width:clamp(260px,30vw,380px);flex-shrink:0}',
  // 移动端：钉住场景退化为普通 section，长廊退化为纵向堆叠
  '@media(max-width:760px){.pp-pin-stage{height:auto!important}.pp-pin-view{position:static;min-height:0}.pp-pin-view [data-at]{opacity:1;transform:none}.pp-hstage{height:auto!important}.pp-htrack{flex-direction:column;width:auto;transform:none!important;padding-inline:0}.pp-htrack>.pp-card{width:auto}}',
  // 降级
  '@media(prefers-reduced-motion:reduce){[data-rv]{opacity:1;transform:none;transition:none}#pp-progress{display:none}.pp-pin-view [data-at]{opacity:1;transform:none}}',
].join('');
