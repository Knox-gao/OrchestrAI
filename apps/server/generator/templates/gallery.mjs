/** 模板：展馆/图鉴 —— 双形态：图鉴=全屏海报舞台（大字排版/跑马灯/胶片导航/档案抽屉）；图库=照片墙+灯箱 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'gallery',
  name: '展馆',
  keywords: ['展馆', '画廊', '图库', '相册', '展示', '照片', '收藏夹', '展览', '图鉴', '百科', '介绍', 'gallery', 'showroom'],
  accent: '#ff6b35', accentRgb: '255,107,53',
  features: ['图鉴模式：全屏角色舞台（背景转场 + 超大逐字标题 + 胶片导航 + 档案抽屉）', '斜向跑马灯 / 半调网点 / 鼠标视差 / 入场编排', '图库模式：照片墙 + 灯箱浏览', '关键词搜索过滤 + 逐对象介绍与署名'],
};

export function files(spec) {
  const imgs = spec.images ?? [];
  const placeholder = imgs.length === 0;

  const logic = `export function createGallery(images) {
  return { images, query: '', lightbox: -1 };
}

/** 大小写无关的标题/副题/作者匹配 */
export function matches(img, rawQuery) {
  const q = String(rawQuery ?? '').trim().toLowerCase();
  if (!q) return true;
  return (img.title ?? '').toLowerCase().includes(q)
    || (img.author ?? '').toLowerCase().includes(q)
    || (img.sub ?? '').toLowerCase().includes(q);
}

export function visibleImages(g) {
  return g.images.filter((i) => matches(i, g.query));
}

export function openLightbox(g, index) {
  const visible = visibleImages(g);
  if (index < 0 || index >= visible.length) return -1;
  return g.lightbox = index;
}

export function closeLightbox(g) {
  g.lightbox = -1;
  return g.lightbox;
}

/** 灯箱下一张（缺陷检测点：越界回绕） */
export function nextImage(g) {
  const n = visibleImages(g).length;
  if (n === 0 || g.lightbox < 0) return -1;
  return g.lightbox = (g.lightbox + 1) % n;
}

export function prevImage(g) {
  const n = visibleImages(g).length;
  if (n === 0 || g.lightbox < 0) return -1;
  return g.lightbox = (g.lightbox - 1 + n) % n;
}

export function attributionText(img) {
  const parts = [];
  if (img.author) parts.push('图 ' + img.author);
  if (img.license) parts.push(img.license);
  return parts.join(' · ') || '来源见图片页';
}

/** 图鉴模式判定：任一对象带介绍即启用（海报舞台布局） */
export function isEncyclopedia(images) {
  return (images ?? []).some((i) => i && typeof i.desc === 'string' && i.desc.trim().length > 0);
}

/** 卡片副题：图鉴模式用对象副题，纯图库回退署名 */
export function cardSubtitle(img) {
  return (img.sub ?? '').trim() || attributionText(img);
}

/** 介绍摘要：超长截断加省略号（缺陷检测点：不得返回超长文本撑破卡片） */
export function blurb(img, max = 64) {
  const d = String(img.desc ?? '').trim();
  if (d.length <= max) return d;
  return d.slice(0, max - 1).replace(/[\\s,，。;；]+$/, '') + '…';
}

/** 计数文案：图鉴模式称「对象」，纯图库称「张素材」 */
export function countLabel(total, enc) {
  return total + (enc ? ' 个对象' : ' 张素材');
}

/** 舞台循环切换：dir=+1/-1，n 为可见对象数（缺陷检测点：必须回绕且与 n 取模） */
export function stageStep(index, dir, n) {
  if (!n || n <= 0) return 0;
  return ((index + dir) % n + n) % n;
}

/** 超大标题逐字拆分：供 stagger 入场编排（缺陷检测点：空名返回空数组、不去空白字符） */
export function splitName(name) {
  return String(name ?? '').split('').filter((c) => c.trim() !== '');
}

/** 跑马灯文案：主题重复拼接（装饰条用） */
export function marqueeText(theme, repeat = 8) {
  const t = String(theme ?? '').trim() || 'ORCHESTRAI';
  return (t + ' ★ ').repeat(Math.max(1, Math.min(24, repeat)));
}

/** 鼠标视差：把 [-1,1] 的归一化偏移限制到幅度内（缺陷检测点：输出必须限幅、无 -0） */
export function parallax(nx, ny, amp = 14) {
  const c = Math.max(-1, Math.min(1, nx));
  const c2 = Math.max(-1, Math.min(1, ny));
  return { x: Math.round(-c * amp) || 0, y: Math.round(-c2 * amp * 0.6) || 0 };
}

/** 编号丝带文本：NO.07 */
export function noLabel(i) {
  return 'NO.' + String(Math.max(0, Math.floor(i)) + 1).padStart(2, '0');
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGallery, matches, visibleImages, openLightbox, closeLightbox, nextImage, prevImage, attributionText, isEncyclopedia, cardSubtitle, blurb, countLabel, stageStep, splitName, marqueeText, parallax, noLabel } from '../logic.mjs';

const IMGS = [
  { file: 'a.jpg', title: 'Ferrari SF90', author: 'Alice' },
  { file: 'b.jpg', title: 'Ferrari 488', author: 'Bob' },
  { file: 'c.jpg', title: 'Lamborghini', author: 'Alice' },
];

test('关键词过滤大小写无关', () => {
  const g = createGallery(IMGS);
  g.query = 'ferrari';
  assert.equal(visibleImages(g).length, 2);
  g.query = 'alice';
  assert.equal(visibleImages(g).length, 2);
  g.query = '  ';
  assert.equal(visibleImages(g).length, 3);
});

test('副题也参与搜索（图鉴模式）', () => {
  const g = createGallery([{ title: '钢铁侠', sub: 'Tony Stark', desc: 'x' }, { title: '蜘蛛侠', sub: 'Peter Parker', desc: 'y' }]);
  g.query = 'stark';
  assert.equal(visibleImages(g).length, 1);
});

test('灯箱打开与关闭', () => {
  const g = createGallery(IMGS);
  assert.equal(openLightbox(g, 1), 1);
  assert.equal(closeLightbox(g), -1);
  assert.equal(openLightbox(g, 99), -1);
});

test('灯箱循环切换（缺陷检测点）', () => {
  const g = createGallery(IMGS);
  openLightbox(g, 2);
  assert.equal(nextImage(g), 0, '最后一张的下一张必须回到第一张');
  assert.equal(prevImage(g), 2, '第一张的上一张必须回到最后一张');
});

test('过滤后灯箱按可见列表循环', () => {
  const g = createGallery(IMGS);
  g.query = 'ferrari';
  openLightbox(g, 1);
  assert.equal(nextImage(g), 0);
});

test('署名拼接', () => {
  assert.equal(attributionText({ author: 'A', license: 'CC BY' }), '图 A · CC BY');
  assert.equal(attributionText({}), '来源见图片页');
});

test('图鉴模式判定', () => {
  assert.equal(isEncyclopedia([{ title: 'x' }, { title: 'y', desc: '介绍' }]), true);
  assert.equal(isEncyclopedia([{ title: 'x' }, { title: 'y' }]), false);
  assert.equal(isEncyclopedia([{ title: 'x', desc: '   ' }]), false);
});

test('卡片副题回退（缺陷检测点：无 sub 时用署名）', () => {
  assert.equal(cardSubtitle({ sub: '复仇者联盟创始人', author: 'A' }), '复仇者联盟创始人');
  assert.equal(cardSubtitle({ author: 'A', license: 'CC' }), '图 A · CC');
});

test('摘要截断（缺陷检测点：超长必须截断且以省略号结尾）', () => {
  const long = '钢铁侠是美国漫威漫画旗下的超级英雄，由斯坦·李创造，本名托尼·斯塔克，是斯塔克工业的董事长。';
  const b = blurb({ desc: long }, 20);
  assert.ok(b.length <= 20, '截断后不得超过 max');
  assert.ok(b.endsWith('…'));
  assert.equal(blurb({ desc: '短介绍' }, 20), '短介绍');
  assert.equal(blurb({}, 20), '');
});

test('计数文案区分图鉴/图库', () => {
  assert.equal(countLabel(12, true), '12 个对象');
  assert.equal(countLabel(12, false), '12 张素材');
});

test('舞台循环切换（缺陷检测点：双向回绕）', () => {
  assert.equal(stageStep(0, -1, 5), 4, '第一项向前回到最后一项');
  assert.equal(stageStep(4, 1, 5), 0, '最后一项向后回到第一项');
  assert.equal(stageStep(2, 1, 5), 3);
  assert.equal(stageStep(0, 1, 0), 0, '空列表安全');
});

test('逐字拆分（缺陷检测点：空名空数组、滤空白）', () => {
  assert.deepEqual(splitName('钢铁侠'), ['钢', '铁', '侠']);
  assert.deepEqual(splitName(''), []);
  assert.deepEqual(splitName('A B'), ['A', 'B']);
});

test('跑马灯文案与编号', () => {
  assert.equal(marqueeText('漫威', 3), '漫威 ★ 漫威 ★ 漫威 ★ ');
  assert.ok(marqueeText('x', 0).length > 0);
  assert.equal(noLabel(0), 'NO.01');
  assert.equal(noLabel(6), 'NO.07');
});

test('视差限幅（缺陷检测点：超界输入必须钳制）', () => {
  assert.deepEqual(parallax(1, 0, 14), { x: -14, y: 0 });
  assert.deepEqual(parallax(-2, 0, 14), { x: 14, y: 0 });
  const p = parallax(5, -5, 10);
  assert.ok(Math.abs(p.x) <= 10 && Math.abs(p.y) <= 10);
});
`;

  const app = `import { createGallery, visibleImages, openLightbox, closeLightbox, nextImage, prevImage, attributionText, isEncyclopedia, cardSubtitle, blurb, countLabel, stageStep, splitName, marqueeText, parallax, noLabel } from './logic.mjs';
import { IMAGES } from './images.js';

const gallery = createGallery(IMAGES);
const ENC = isEncyclopedia(IMAGES);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ===================== 图鉴模式：全屏海报舞台 ===================== */
if (ENC) {
  document.body.classList.add('ency', 'stage-mode');
  const heroBgA = document.getElementById('hero-bg-a');
  const heroBgB = document.getElementById('hero-bg-b');
  const heroName = document.getElementById('hero-name');
  const heroSub = document.getElementById('hero-sub');
  const heroNo = document.getElementById('hero-no');
  const heroDesc = document.getElementById('hero-desc');
  const heroCount = document.getElementById('hero-count');
  const marquee = document.getElementById('marquee');
  const dock = document.getElementById('dock');
  const dossier = document.getElementById('dossier');
  const dTitle = document.getElementById('d-title');
  const dSub = document.getElementById('d-sub');
  const dDesc = document.getElementById('d-desc');
  const dAttr = document.getElementById('d-attr');
  const searchBtn = document.getElementById('search-btn');
  const searchBox = document.getElementById('search-box');
  const searchInput = document.getElementById('search');
  const themeEl = document.getElementById('stage-theme');

  let cur = 0, front = heroBgA, back = heroBgB, flipping = false;

  marquee.textContent = marqueeText(document.querySelector('.app header h1')?.textContent || 'ATLAS', 10);
  if (themeEl) themeEl.textContent = document.querySelector('.app header p')?.textContent || '';

  function items() { return visibleImages(gallery); }

  function renderName(name) {
    heroName.innerHTML = '';
    const chars = splitName(name);
    chars.forEach((c, i) => {
      const s = document.createElement('span');
      s.className = 'ch' + (i === chars.length - 1 ? ' last' : '');
      s.textContent = c;
      s.style.animationDelay = (i * 0.055) + 's';
      heroName.appendChild(s);
    });
  }

  function show(idx, animate = true) {
    const list = items();
    if (!list.length) return;
    if (flipping) return;
    cur = Math.max(0, Math.min(idx, list.length - 1));
    const it = list[cur];
    back.style.backgroundImage = 'url(' + it.file + ')';
    if (animate && !reduced) {
      flipping = true;
      back.classList.add('enter');
      const old = front, newFront = back;
      setTimeout(() => {
        old.classList.remove('enter'); old.style.opacity = 0;
        newFront.classList.remove('enter'); newFront.style.opacity = 1;
        front = newFront; back = old; flipping = false;
      }, 950);
      [front, back] = [back, front];
    } else {
      front.classList.remove('enter');
      front.style.backgroundImage = 'url(' + it.file + ')';
      front.style.opacity = 1;
    }
    renderName(it.title);
    heroSub.textContent = cardSubtitle(it);
    heroNo.textContent = noLabel(cur);
    heroDesc.textContent = blurb(it, 88);
    heroCount.textContent = (cur + 1) + ' / ' + list.length;
    // 胶片条
    dock.innerHTML = '';
    list.forEach((im, i) => {
      const d = document.createElement('button');
      d.className = 'frame' + (i === cur ? ' on' : '');
      d.title = im.title;
      const img = document.createElement('img');
      img.src = im.file; img.alt = im.title; img.loading = 'lazy';
      const cap = document.createElement('i');
      cap.textContent = im.title;
      d.append(img, cap);
      d.onclick = () => { if (i !== cur) show(i); };
      dock.appendChild(d);
    });
    const on = dock.querySelector('.frame.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }

  document.getElementById('stage-prev').onclick = () => show(stageStep(cur, -1, items().length));
  document.getElementById('stage-next').onclick = () => show(stageStep(cur, 1, items().length));
  document.getElementById('dossier-btn').onclick = () => {
    const it = items()[cur];
    if (!it) return;
    dTitle.textContent = it.title;
    dSub.textContent = it.sub || '';
    dDesc.textContent = it.desc || '';
    dAttr.textContent = attributionText(it);
    dossier.classList.add('open');
  };
  document.getElementById('d-close').onclick = () => dossier.classList.remove('open');
  dossier.addEventListener('click', (e) => { if (e.target === dossier) dossier.classList.remove('open'); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dossier.classList.remove('open');
    if (e.key === 'ArrowLeft') show(stageStep(cur, -1, items().length));
    if (e.key === 'ArrowRight') show(stageStep(cur, 1, items().length));
  });

  // 鼠标视差（作用于背景包裹层，避免与转场动画的 transform 冲突）
  const bgwrap = document.getElementById('bgwrap');
  if (!reduced && bgwrap) {
    addEventListener('mousemove', (e) => {
      const p = parallax((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1, 16);
      bgwrap.style.transform = 'scale(1.06) translate(' + p.x + 'px,' + p.y + 'px)';
    });
  }

  // 搜索：右上角图标展开
  searchBtn.onclick = () => {
    searchBox.classList.toggle('open');
    if (searchBox.classList.contains('open')) searchInput.focus();
    else { searchInput.value = ''; gallery.query = ''; show(0, false); }
  };
  searchInput.addEventListener('input', () => {
    gallery.query = searchInput.value;
    show(0, false);
  });

  show(0);
} else {
/* ===================== 图库模式：照片墙 + 灯箱（原布局） ===================== */
  const gridEl = document.getElementById('grid');
  const qEl = document.getElementById('q');
  const boxEl = document.getElementById('lightbox');
  const boxImg = document.getElementById('lb-img');
  const boxTitle = document.getElementById('lb-title');
  const boxSub = document.getElementById('lb-sub');
  const boxDesc = document.getElementById('lb-desc');
  const boxAttr = document.getElementById('lb-attr');
  const boxCount = document.getElementById('lb-count');

  function render() {
    const items2 = visibleImages(gallery);
    const total = gallery.images.length;
    document.getElementById('count').textContent = countLabel(total, ENC) + (total !== items2.length ? '，匹配 ' + items2.length : '');
    if (items2.length === 0) {
      gridEl.innerHTML = '<div class="empty">没有匹配「' + gallery.query + '」的对象</div>';
      return;
    }
    gridEl.innerHTML = '';
    items2.forEach((img, i) => {
      const card = document.createElement('figure');
      card.className = 'ph' + (i === 0 ? ' hero' : '');
      card.innerHTML = '<img loading="lazy" alt="" /><figcaption><span class="t"></span><span class="s"></span><span class="d"></span><span class="a"></span></figcaption>';
      const im = card.querySelector('img');
      im.src = img.file; im.alt = img.title;
      card.querySelector('.t').textContent = img.title;
      card.querySelector('.s').textContent = cardSubtitle(img);
      card.querySelector('.d').textContent = img.desc ? blurb(img, 64) : '';
      card.querySelector('.a').textContent = attributionText(img);
      card.addEventListener('click', () => { openLightbox(gallery, i); render(); });
      gridEl.appendChild(card);
    });
    if (gallery.lightbox >= 0) {
      const idx = Math.min(gallery.lightbox, items2.length - 1);
      const cur = items2[idx];
      boxImg.src = cur.file;
      boxImg.alt = cur.title;
      boxTitle.textContent = cur.title;
      boxSub.textContent = cur.sub || '';
      boxSub.style.display = cur.sub ? '' : 'none';
      boxDesc.textContent = cur.desc || '';
      boxDesc.style.display = cur.desc ? '' : 'none';
      boxCount.textContent = (idx + 1) + ' / ' + items2.length;
      boxAttr.textContent = attributionText(cur) + (cur.page ? ' · ' : '');
      if (cur.page) {
        const a = document.createElement('a');
        a.href = cur.page; a.target = '_blank'; a.rel = 'noreferrer'; a.textContent = '来源 ↗';
        boxAttr.appendChild(a);
      }
      boxEl.classList.add('show');
    } else {
      boxEl.classList.remove('show');
    }
  }

  qEl.addEventListener('input', () => { gallery.query = qEl.value; closeLightbox(gallery); render(); });
  document.getElementById('lb-close').addEventListener('click', () => { closeLightbox(gallery); render(); });
  document.getElementById('lb-prev').addEventListener('click', () => { prevImage(gallery); render(); });
  document.getElementById('lb-next').addEventListener('click', () => { nextImage(gallery); render(); });
  boxEl.addEventListener('click', (e) => { if (e.target === boxEl) { closeLightbox(gallery); render(); } });
  addEventListener('keydown', (e) => {
    if (!boxEl.classList.contains('show')) return;
    if (e.key === 'Escape') { closeLightbox(gallery); render(); }
    if (e.key === 'ArrowLeft') { prevImage(gallery); render(); }
    if (e.key === 'ArrowRight') { nextImage(gallery); render(); }
  });
  render();
}
`;

  const html = pageShell(
    spec.title,
    spec.subtitle,
    `<!-- 图鉴：全屏海报舞台 -->
<div id="stage" class="stage">
  <div id="bgwrap" class="bgwrap">
    <div id="hero-bg-a" class="hero-bg"></div>
    <div id="hero-bg-b" class="hero-bg"></div>
  </div>
  <div class="stage-shade"></div>
  <div class="halftone"></div>
  <i class="deco d1"></i><i class="deco d2"></i>
  <div id="hero-no" class="hero-no"></div>
  <button id="search-btn" class="search-fab" title="搜索">⌕</button>
  <div id="search-box" class="search-box"><input id="search" placeholder="搜索名称 / 副题…" autocomplete="off" /></div>
  <div class="hero-body">
    <div id="stage-theme" class="stage-theme"></div>
    <h1 id="hero-name" class="hero-name"></h1>
    <div id="hero-sub" class="hero-sub"></div>
    <p id="hero-desc" class="hero-desc"></p>
    <button id="dossier-btn" class="dossier-btn">查看完整档案 →</button>
  </div>
  <div class="stage-side">
    <button id="stage-prev" title="上一个 (←)">‹</button>
    <span id="hero-count" class="hero-count"></span>
    <button id="stage-next" title="下一个 (→)">›</button>
  </div>
  <div id="marquee" class="marquee"></div>
  <div id="dock" class="dock"></div>
</div>
<div id="dossier" class="dossier">
  <button id="d-close" title="关闭 (Esc)">✕</button>
  <h2 id="d-title"></h2>
  <div id="d-sub" class="d-sub"></div>
  <div class="d-rule"></div>
  <p id="d-desc" class="d-desc"></p>
  <div id="d-attr" class="d-attr"></div>
</div>
<!-- 图库：照片墙 -->
<div class="card lib-bar">
  <div class="row"><input id="q" class="grow" placeholder="搜索标题或作者…" autocomplete="off" /><span id="count" style="align-self:center;color:var(--text-dim);font-size:13px;white-space:nowrap"></span></div>
</div>
<div id="grid" class="grid"></div>
<div id="lightbox">
  <button id="lb-close" title="关闭 (Esc)">✕</button>
  <button id="lb-prev" title="上一张 (←)">‹</button>
  <div class="lb-body">
    <img id="lb-img" alt="" />
    <aside class="lb-info">
      <h3 id="lb-title"></h3>
      <div id="lb-sub" class="lb-sub"></div>
      <p id="lb-desc" class="lb-desc"></p>
      <div id="lb-count" class="lb-count"></div>
      <div id="lb-attr" class="lb-attr"></div>
    </aside>
  </div>
  <button id="lb-next" title="下一张 (→)">›</button>
</div>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
/* ============ 共用 ============ */
* { margin: 0; box-sizing: border-box; }
body { display: block; padding: 0; min-height: 100vh; background: var(--bg); }
.app > header, .app > footer { display: none; }

/* ============ 图鉴：全屏海报舞台 ============ */
body.stage-mode { overflow: hidden; }
.stage { position: fixed; inset: 0; overflow: hidden; background: #08070a; }
.bgwrap { position: absolute; inset: -4%; will-change: transform; }
.hero-bg { position: absolute; inset: 0; background-size: cover; background-position: center 20%; opacity: 0; transition: opacity .9s ease; will-change: opacity; }
.hero-bg.enter { animation: bgIn .9s cubic-bezier(.22,1,.36,1); }
@keyframes bgIn { from { opacity: 0; transform: scale(1.12); } to { opacity: 1; transform: scale(1); } }
.stage-shade { position: absolute; inset: 0; background:
  linear-gradient(75deg, rgba(4,3,6,.94) 0%, rgba(4,3,6,.72) 34%, rgba(4,3,6,.12) 62%, rgba(4,3,6,.5) 100%),
  linear-gradient(0deg, rgba(4,3,6,.9), transparent 40%); }
.halftone { position: absolute; right: -80px; top: -60px; width: 44vw; height: 44vw; transform: rotate(12deg); pointer-events: none; opacity: .5;
  background-image: radial-gradient(circle, rgba(255,255,255,.13) 1.2px, transparent 1.8px); background-size: 13px 13px;
  -webkit-mask-image: radial-gradient(closest-side, #000 30%, transparent 72%); mask-image: radial-gradient(closest-side, #000 30%, transparent 72%); }
.deco { position: absolute; pointer-events: none; }
.deco.d1 { left: -70px; bottom: 18vh; width: 300px; height: 46px; background: var(--accent); opacity: .8; transform: rotate(-24deg); animation: floatY 7s ease-in-out infinite; }
.deco.d2 { right: 12vw; bottom: 30vh; width: 120px; height: 12px; background: rgba(255,255,255,.55); transform: rotate(-24deg); animation: floatY 9s ease-in-out 1.2s infinite; }
@keyframes floatY { 0%,100% { margin-top: 0; } 50% { margin-top: -14px; } }
.hero-no { position: absolute; top: 26px; left: -34px; background: var(--accent); color: #fff; font: 700 13px/1 var(--sans, sans-serif); letter-spacing: 3px; padding: 9px 44px 9px 52px; transform: rotate(-36deg); box-shadow: 0 6px 24px rgba(0,0,0,.5); z-index: 3; }
.search-fab { position: absolute; top: 22px; right: 24px; z-index: 6; width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.3); background: rgba(10,8,14,.5); color: #fff; font-size: 20px; cursor: pointer; backdrop-filter: blur(8px); transition: all .2s; }
.search-fab:hover { background: var(--accent); border-color: var(--accent); }
.search-box { position: absolute; top: 22px; right: 78px; z-index: 6; width: 0; opacity: 0; transition: all .3s cubic-bezier(.22,1,.36,1); }
.search-box.open { width: 240px; opacity: 1; }
.search-box input { width: 100%; padding: 12px 16px; border-radius: 99px; border: 1px solid rgba(255,255,255,.3); background: rgba(10,8,14,.72); color: #fff; font-size: 13px; backdrop-filter: blur(10px); outline: none; }
.hero-body { position: absolute; left: clamp(20px, 7vw, 110px); bottom: 24vh; z-index: 2; max-width: min(760px, 80vw); }
.stage-theme { color: var(--accent); font: 600 12px/1 var(--sans, sans-serif); letter-spacing: 6px; text-transform: uppercase; margin-bottom: 14px; opacity: 0; animation: riseIn .8s .1s cubic-bezier(.16,1,.3,1) forwards; }
.hero-name { font-family: Georgia, 'Times New Roman', 'STSong', serif; font-weight: 900; font-style: italic; font-size: clamp(64px, 13.5vw, 176px); line-height: .96; letter-spacing: 2px; color: #fff; text-shadow: 0 10px 60px rgba(0,0,0,.7); white-space: nowrap; }
.hero-name .ch { display: inline-block; opacity: 0; transform: translateY(110%) rotate(6deg); animation: chIn .9s cubic-bezier(.16,1,.3,1) forwards; }
.hero-name .ch.last { color: var(--accent); -webkit-text-stroke: 0; }
@keyframes chIn { to { opacity: 1; transform: translateY(0) rotate(0); } }
@keyframes riseIn { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
.hero-sub { color: rgba(255,255,255,.82); font-size: clamp(13px, 1.6vw, 18px); letter-spacing: 4px; margin: 14px 0 10px; opacity: 0; animation: riseIn .8s .5s cubic-bezier(.16,1,.3,1) forwards; }
.hero-desc { color: rgba(255,255,255,.66); font-size: 14px; line-height: 1.9; max-width: 520px; opacity: 0; animation: riseIn .8s .62s cubic-bezier(.16,1,.3,1) forwards; }
.dossier-btn { margin-top: 20px; padding: 13px 30px; background: var(--accent); color: #fff; border: none; font: 700 14px/1 var(--sans, sans-serif); letter-spacing: 3px; cursor: pointer; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); transition: transform .18s, filter .18s; opacity: 0; animation: riseIn .8s .74s cubic-bezier(.16,1,.3,1) forwards; }
.dossier-btn:hover { transform: translateX(6px); filter: brightness(1.12); }
.stage-side { position: absolute; right: 26px; bottom: 27vh; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.stage-side button { width: 52px; height: 52px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(12,10,16,.45); color: #fff; font-size: 26px; cursor: pointer; backdrop-filter: blur(8px); transition: all .18s; }
.stage-side button:hover { background: var(--accent); border-color: var(--accent); transform: scale(1.08); }
.hero-count { color: rgba(255,255,255,.75); font: 500 12px/1 var(--sans, sans-serif); letter-spacing: 2px; font-variant-numeric: tabular-nums; }
.marquee { position: absolute; left: -4%; right: -4%; bottom: 15.5vh; background: var(--accent); color: #fff; transform: rotate(-1.6deg); padding: 7px 0; overflow: hidden; white-space: nowrap; z-index: 2; box-shadow: 0 8px 40px rgba(0,0,0,.45); }
.marquee { font: 900 italic 15px/1 var(--sans, sans-serif); letter-spacing: 4px; }
.marquee { animation: mqScroll 26s linear infinite; }
@keyframes mqScroll { from { transform: rotate(-1.6deg) translateX(0); } to { transform: rotate(-1.6deg) translateX(-50%); } }
.dock { position: absolute; left: 0; right: 0; bottom: 18px; z-index: 4; display: flex; gap: 10px; padding: 10px clamp(16px, 5vw, 60px); overflow-x: auto; scrollbar-width: none; }
.dock::-webkit-scrollbar { display: none; }
.frame { flex: 0 0 auto; width: 58px; height: 74px; border: 2px solid rgba(255,255,255,.22); border-radius: 6px; overflow: hidden; cursor: pointer; padding: 0; background: #000; position: relative; transition: all .22s cubic-bezier(.22,1,.36,1); }
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.7) brightness(.75); transition: filter .22s; }
.frame i { position: absolute; left: 0; right: 0; bottom: 0; font-size: 8px; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,.85)); padding: 8px 3px 2px; font-style: normal; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frame:hover { transform: translateY(-6px) rotate(-3deg); }
.frame:hover img { filter: none; }
.frame.on { width: 70px; height: 90px; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(255,255,255,.14), 0 10px 30px rgba(0,0,0,.6); transform: translateY(-10px); }
.frame.on img { filter: none; }
/* 档案抽屉 */
.dossier { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 92vw); z-index: 20; background: linear-gradient(160deg, rgba(14,11,18,.96), rgba(10,8,13,.93)); border-left: 1px solid rgba(255,255,255,.14); box-shadow: -30px 0 90px rgba(0,0,0,.6); padding: 56px 36px 36px; transform: translateX(105%); transition: transform .5s cubic-bezier(.22,1,.36,1); backdrop-filter: blur(16px); overflow-y: auto; }
.dossier.open { transform: translateX(0); }
.dossier h2 { font-family: Georgia, 'STSong', serif; font-style: italic; font-weight: 900; color: #fff; font-size: 44px; line-height: 1.05; margin-bottom: 8px; }
#d-close { position: absolute; top: 18px; right: 18px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.3); background: none; color: #fff; font-size: 15px; cursor: pointer; }
.d-sub { color: var(--accent); font-size: 12px; letter-spacing: 3px; margin-bottom: 16px; }
.d-rule { height: 2px; background: linear-gradient(90deg, var(--accent), transparent); margin-bottom: 18px; }
.d-desc { color: rgba(255,255,255,.82); font-size: 15px; line-height: 2.1; }
.d-attr { color: rgba(255,255,255,.4); font-size: 11px; margin-top: 26px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.12); }
/* 图鉴模式下隐藏图库骨架 */
body.stage-mode .lib-bar, body.stage-mode .grid, body.stage-mode #lightbox { display: none !important; }

/* ============ 图库模式：照片墙 + 灯箱（原布局） ============ */
body:not(.stage-mode) .stage, body:not(.stage-mode) .dossier { display: none !important; }
.app { max-width: 1160px; margin: 0 auto; padding: 22px 20px 40px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; }
.row { display: flex; gap: 10px; }
.grow { flex: 1; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 10px; padding: 10px 14px; font-size: 14px; outline: none; }
input.grow:focus { border-color: var(--accent); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
.ph { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; cursor: zoom-in; transition: transform .15s, border-color .15s, box-shadow .15s; margin: 0; display: flex; flex-direction: column; }
.ph:hover { transform: translateY(-3px); border-color: var(--accent); box-shadow: 0 10px 28px rgba(0,0,0,.35); }
.ph img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: var(--panel-2); }
.ph figcaption { padding: 10px 12px 11px; font-size: 12px; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.ph .t { color: var(--text); font-weight: 600; font-size: 13.5px; }
.ph .s { color: var(--accent); font-size: 11px; letter-spacing: .3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ph .d { color: var(--text-dim); font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ph .a { color: var(--text-faint); font-size: 10.5px; margin-top: auto; padding-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#lightbox { position: fixed; inset: 0; background: rgba(5,8,20,.94); display: none; align-items: center; justify-content: center; z-index: 50; }
#lightbox.show { display: flex; }
.lb-body { display: flex; align-items: stretch; max-width: min(94vw, 1180px); max-height: 82vh; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 90px rgba(0,0,0,.65); }
#lb-img { max-width: min(70vw, 780px); max-height: 82vh; object-fit: contain; background: #04060f; display: block; }
.lb-info { width: 300px; background: var(--panel); border-left: 1px solid var(--border); padding: 26px 24px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
#lb-title { font-size: 22px; font-weight: 700; color: var(--text); margin: 0; }
.lb-sub { color: var(--accent); font-size: 12px; letter-spacing: .5px; }
.lb-desc { color: var(--text-dim); font-size: 13.5px; line-height: 1.85; margin: 4px 0 8px; }
.lb-count { font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.lb-attr { font-size: 11.5px; color: var(--text-faint); margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }
.lb-attr a { color: var(--accent); }
#lightbox button { position: fixed; background: rgba(24,29,51,.85); border: 1px solid var(--border-hi, var(--border)); color: var(--text); font-size: 22px; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; }
#lb-close { top: 18px; right: 18px; font-size: 16px; }
#lb-prev { left: 18px; top: 50%; transform: translateY(-50%); }
#lb-next { right: 18px; top: 50%; transform: translateY(-50%); }
@media (max-width: 760px) {
  .lb-body { flex-direction: column; max-height: 86vh; overflow-y: auto; }
  #lb-img { max-width: 94vw; max-height: 46vh; }
  .lb-info { width: auto; border-left: none; border-top: 1px solid var(--border); }
  .hero-body { bottom: 30vh; }
  .hero-name { white-space: normal; }
  .stage-side { bottom: 38vh; right: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-bg.enter, .hero-name .ch, .stage-theme, .hero-sub, .hero-desc, .dossier-btn, .deco, .marquee { animation: none !important; }
  .hero-name .ch, .stage-theme, .hero-sub, .hero-desc, .dossier-btn { opacity: 1 !important; transform: none !important; }
}
`;

  const imagesJs = `// 素材清单（${placeholder ? '本地生成示意卡' : (spec.imageSource === 'network' ? '定向真实采集：' + (spec.provider ?? '') : spec.provider ?? '')}）
export const IMAGES = ${JSON.stringify(
    imgs.map((i) => ({ file: i.file, title: i.title, sub: i.sub ?? '', desc: i.desc ?? '', author: i.author, license: i.license, page: i.page })),
    null, 2)};
`;

  return {
    'index.html': html,
    'style.css': css,
    'app.mjs': app,
    'logic.mjs': logic,
    'test/logic.test.mjs': test,
    'images.js': imagesJs,
    'package.json': JSON.stringify({ name: 'app-gallery', private: true, type: 'module' }, null, 2),
  };
}

export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      'return g.lightbox = (g.lightbox + 1) % n;',
      'return g.lightbox = g.lightbox + 1; // [预设缺陷] 灯箱切换未回绕',
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
