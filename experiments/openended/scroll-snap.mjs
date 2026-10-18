/**
 * Scroll Snap Controller（任务 B）：滚动意图阈值 + 场景吸附 + 状态机
 * 设计原则：
 *  - 不改变页面结构——作为可选基础设施注入
 *  - 可配置：意图阈值/动画时长/吸附模式/连续锁定/反向处理/reduced-motion
 *  - 尊重长内容场景（高度>1.5×视口时不吸附，允许自然滚动）
 *  - 不破坏键盘导航（方向键/PageUp/PageDown/Home/End 原生行为保留）
 *
 * 状态机: idle → accumulating → transitioning → settling → idle
 *         (accumulating 中反向输入 → cancelled → idle)
 */
export function createScrollSnap(root = document, opts = {}) {
  const cfg = {
    threshold: opts.threshold ?? 130,          // 累积意图阈值(px 归一化)
    animMs: opts.animMs ?? 600,                // 翻页动画时长
    mode: opts.mode ?? 'snap',                 // 'snap'（吸附）| 'free'（自然滚动，控制器不干预）
    lockMs: opts.lockMs ?? 800,                // 转场后锁定时长
    gapTolerance: opts.gapTolerance ?? 40,     // 场景间隙容差
    maxViewportRatio: opts.maxViewportRatio ?? 1.5, // 超过此比例的场景不吸附
    reduced: opts.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  const state = {
    phase: 'idle',       // idle | accumulating | transitioning | settling
    accumulated: 0,      // 归一化累积意图（正=向下）
    target: -1,          // 目标场景索引
    locked: false,
    lastWheel: 0,
  };
  let scenes = [];
  let observers = [];
  let cleanup = [];

  function findScenes() {
    scenes = [...root.querySelectorAll('section[id], [data-snap]')].map((el) => ({
      el,
      id: el.id,
      snap: el.dataset.snap !== 'false',
      freeScroll: el.dataset.freeScroll === 'true',
    }));
  }

  function anchorOf(i) {
    if (i < 0 || i >= scenes.length) return null;
    const s = scenes[i];
    if (!s.snap) return null;
    const r = s.el.getBoundingClientRect();
    const top = scrollY + r.top; // 视口相对 → 文档绝对
    // 长内容场景：锚定顶部；否则锚定使场景居中（或顶对齐如果场景≥视口）
    if (r.height > innerHeight * cfg.maxViewportRatio || s.freeScroll) {
      return Math.round(scrollY + r.top);
    }
    // 短场景：尽量居中（但不超边界）
    const centered = scrollY + r.top - (innerHeight - r.height) / 2;
    const maxScroll = (root === document ? root.documentElement : root).scrollHeight - innerHeight;
    return Math.round(Math.max(0, Math.min(maxScroll, centered)));
  }

  function nearestScene() {
    const mid = scrollY + innerHeight / 2;
    let best = 0, bd = Infinity;
    scenes.forEach((s, i) => {
      const r = s.el.getBoundingClientRect();
      const center = scrollY + r.top + r.height / 2;
      const d = Math.abs(center - mid);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function snapScenes() {
    return scenes.map((s, i) => ({ ...s, i })).filter((s) => s.snap && s.el.getBoundingClientRect().height <= innerHeight * cfg.maxViewportRatio);
  }

  function goTo(targetIdx) {
    const snaps = snapScenes();
    const inSnap = snaps.find((s) => s.i === targetIdx);
    if (!inSnap) return false;
    const pos = anchorOf(targetIdx);
    if (pos === null) return false;
    state.phase = 'transitioning';
    state.target = targetIdx;
    state.locked = true;
    window.scrollTo({ top: pos, behavior: cfg.reduced ? 'instant' : 'smooth' });
    setTimeout(() => {
      state.phase = 'settling';
      setTimeout(() => {
        state.phase = 'idle';
        state.accumulated = 0;
        state.locked = false;
      }, cfg.lockMs);
    }, cfg.animMs);
    return true;
  }

  function handleWheel(e) {
    if (cfg.mode === 'free') return;
    if (state.locked) { e.preventDefault(); return; }
    // 检查是否在自由滚动区（嵌套滚动/长内容内部）
    const inNested = e.target.closest && e.target.closest('[data-free-scroll], pre, .free-scroll');
    if (inNested) return;
    e.preventDefault();
    // 归一化：deltaMode 1=行(×33) 2=页(×innerHeight)；高分辨率触控板小 delta 自然小
    const mode = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1;
    const delta = e.deltaY * mode;
    const now = performance.now();
    // 时间衰减：>300ms 未滚动则重置累积
    if (now - state.lastWheel > 300) state.accumulated = 0;
    state.lastWheel = now;
    // 累积（同向叠加，反向消减）
    state.accumulated += delta;
    if (state.accumulated !== 0 && Math.sign(state.accumulated) !== Math.sign(delta)) {
      state.accumulated = delta; // 反向重置
    }
    if (state.phase === 'idle') state.phase = 'accumulating';
    if (Math.abs(state.accumulated) >= cfg.threshold) {
      const dir = Math.sign(state.accumulated);
      const snaps = snapScenes();
      const cur = nearestScene();
      // 在吸附场景序列中找下一个（可能跳过非吸附场景）
      let next = -1;
      if (dir > 0) { for (let j = cur + 1; j < scenes.length; j++) { if (snapScenes().some((s) => s.i === j)) { next = j; break; } } }
      else { for (let j = cur - 1; j >= 0; j--) { if (snapScenes().some((s) => s.i === j)) { next = j; break; } } }
      if (next >= 0 && goTo(next)) {
        // 成功触发
      } else {
        // 到达边界：允许原生滚动（首尾）
        state.accumulated = 0;
        state.phase = 'idle';
      }
    }
  }

  function handleKey(e) {
    if (cfg.mode === 'free') return;
    // 键盘：方向键=单步翻页，PageUp/PageDown/Home/End 保留原生
    if (e.key === 'ArrowDown' && !state.locked) {
      e.preventDefault();
      const cur = nearestScene();
      const snaps = snapScenes();
      for (let j = cur + 1; j < scenes.length; j++) { if (snaps.some((s) => s.i === j)) { goTo(j); return; } }
    } else if (e.key === 'ArrowUp' && !state.locked) {
      e.preventDefault();
      const cur = nearestScene();
      const snaps = snapScenes();
      for (let j = cur - 1; j >= 0; j--) { if (snaps.some((s) => s.i === j)) { goTo(j); return; } }
    }
    // PageUp/PageDown/Home/End: 不拦截，原生行为
  }

  function handleTouch(e) {
    // 触屏：让原生滚动工作（浏览器已有惯性），只在松手后做吸附
    // 不 preventDefault（保留自然触感）
  }

  function handleTouchEnd(e) {
    if (cfg.mode === 'free' || state.locked) return;
    // 触屏松手后：如果接近某个场景锚点（<25%视口），轻吸附
    const cur = nearestScene();
    const pos = anchorOf(cur);
    if (pos !== null && Math.abs(scrollY - pos) < innerHeight * 0.25) {
      window.scrollTo({ top: pos, behavior: 'smooth' });
    }
  }

  function handleResize() {
    findScenes();
  }

  function mount() {
    findScenes();
    const wheelOpts = { passive: false };
    window.addEventListener('wheel', handleWheel, wheelOpts);
    window.addEventListener('keydown', handleKey);
    root.addEventListener('touchend', handleTouchEnd, { passive: true });
    root.addEventListener('resize', handleResize);
    cleanup = [
      () => window.removeEventListener('wheel', handleWheel, wheelOpts),
      () => window.removeEventListener('keydown', handleKey),
      () => root.removeEventListener('touchend', handleTouchEnd, { passive: true }),
      () => root.removeEventListener('resize', handleResize),
    ];
    return api;
  }

  const api = {
    state,
    cfg,
    scenes: () => scenes,
    nearestScene,
    anchorOf,
    goTo,
    mount,
    destroy: () => { cleanup.forEach((fn) => fn()); state.phase = 'idle'; },
    // 测试辅助：模拟意图
    _test: { handleWheel, handleKey, findScenes },
  };
  return api;
}
