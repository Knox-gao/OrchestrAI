/** 模板：产品介绍页（landing）—— hero + 特性 + 参数表 + CTA，内容由 LLM 生成或占位 */
import { buildThemeCss, pageShell } from '../theme.mjs';
import { getStyleDef } from '../styles.mjs';

export const meta = {
  type: 'landing',
  name: '产品介绍页',
  keywords: ['介绍页', '产品页', '官网', '宣传页', '专题页', '落地页', 'landing', 'homepage', '发布会'],
  accent: '#4cc9f0', accentRgb: '76,201,240',
  features: ['全屏 Hero 与卖点呈现', '特性卡片网格', '参数规格表', '锚点导航与返回顶部', 'CTA 行动按钮'],
};

export function files(spec) {
  const L = spec.landing ?? {
    headline: spec.title,
    tagline: '为更好的体验而生',
    intro: '这是一个产品介绍页。接入大模型（🔑 配置 GLM/OpenAI Key）后，这里的文案将由 AI 根据你的需求真实撰写。',
    features: [
      { t: '特性一', d: '接入大模型后由 AI 撰写真实卖点' },
      { t: '特性二', d: '支持响应式布局与锚点导航' },
      { t: '特性三', d: 'PWA 可安装，可打包为 .exe/.apk' },
    ],
    specs: [['页面类型', '产品介绍页'], ['生成方式', 'OrchestrAI']],
  };

  const logic = `/** 导航锚点定义 */
export const SECTIONS = [
  { id: 'hero', label: '首页' },
  { id: 'features', label: '特性' },
  { id: 'specs', label: '参数' },
  { id: 'cta', label: '开始' },
];

/** 校验 landing 数据完整性（缺陷检测点：特性必须有标题） */
export function validFeatures(features) {
  return (features ?? []).filter((f) => f && typeof f.t === 'string' && f.t.trim());
}

export function findSpec(specs, key) {
  const hit = (specs ?? []).find(([k]) => k === key);
  return hit ? hit[1] : null;
}

/** 当前视口应高亮的锚点（缺陷检测点：最后一屏锁定最后一项） */
export function activeSection(offsets, scrollY, viewportH) {
  const list = (offsets ?? []).filter((o) => typeof o.top === 'number');
  if (list.length === 0) return null;
  let active = list[0].id;
  for (const o of list) {
    if (scrollY >= o.top - viewportH * 0.4) active = o.id;
  }
  return active;
}

export function ctaLabel(hasUrl) {
  return hasUrl ? '立即购买' : '了解更多';
}
`;

  const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, validFeatures, findSpec, activeSection, ctaLabel } from '../logic.mjs';

test('导航锚点定义完整', () => {
  assert.equal(SECTIONS.length, 4);
  assert.deepEqual(SECTIONS.map((s) => s.id), ['hero', 'features', 'specs', 'cta']);
});

test('特性校验过滤空标题（缺陷检测点）', () => {
  const fs2 = [{ t: 'A', d: 'x' }, { t: '  ', d: 'y' }, null, { d: 'no title' }];
  assert.deepEqual(validFeatures(fs2).map((f) => f.t), ['A']);
});

test('参数查找', () => {
  const specs = [['芯片', 'A19'], ['续航', '30 小时']];
  assert.equal(findSpec(specs, '芯片'), 'A19');
  assert.equal(findSpec(specs, '价格'), null);
});

test('锚点高亮随滚动推进', () => {
  const offsets = [{ id: 'hero', top: 0 }, { id: 'features', top: 800 }, { id: 'specs', top: 1600 }, { id: 'cta', top: 2400 }];
  assert.equal(activeSection(offsets, 100, 800), 'hero');
  assert.equal(activeSection(offsets, 900, 800), 'features');
  assert.equal(activeSection(offsets, 99999, 800), 'cta');
});

test('CTA 文案随链接有无切换', () => {
  assert.equal(ctaLabel(true), '立即购买');
  assert.equal(ctaLabel(false), '了解更多');
});
`;

  const app = `import { SECTIONS, activeSection } from './logic.mjs';

const navEl = document.getElementById('nav');
const backTop = document.getElementById('back-top');

// 导航
navEl.innerHTML = SECTIONS.map((s) => \`<a href="#\${s.id}" data-id="\${s.id}">\${s.label}</a>\`).join('');

// 锚点高亮
const ids = SECTIONS.map((s) => s.id);
function onScroll() {
  const offsets = ids.map((id) => ({ id, top: document.getElementById(id)?.offsetTop ?? 0 }));
  const active = activeSection(offsets, scrollY, innerHeight);
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.id === active));
  backTop.classList.toggle('show', scrollY > 600);
}
addEventListener('scroll', onScroll, { passive: true });
backTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
onScroll();
`;

  const html = pageShell(
    spec.title,
    spec.subtitle,
    `<nav id="nav" class="nav"></nav>
<section id="hero">
  <h1 class="headline">${L.headline}</h1>
  <p class="tagline">${L.tagline}</p>
  <p class="intro">${L.intro}</p>
  <div class="hero-actions"><a class="cta" href="#features">了解特性 ↓</a></div>
</section>
<section id="features">
  <h2>核心特性</h2>
  <div class="fgrid">
    ${L.features.map((f) => `<div class="fcard"><div class="ft">${f.t}</div><div class="fd">${f.d}</div></div>`).join('\n    ')}
  </div>
</section>
<section id="specs">
  <h2>参数规格</h2>
  <table class="specs">
    ${L.specs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n    ')}
  </table>
</section>
<section id="cta">
  <h2>准备好了解了吗？</h2>
  <a class="cta big" href="#hero">回到顶部 ↑</a>
</section>
<button id="back-top" title="返回顶部">↑</button>`,
  );

  const css = buildThemeCss(getStyleDef(spec)) + `
.nav { position: sticky; top: 0; z-index: 20; display: flex; gap: 4px; justify-content: center; padding: 10px; margin: -32px -16px 24px; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); }
.nav a { color: var(--text-dim); text-decoration: none; font-size: 13px; padding: 6px 14px; border-radius: 99px; }
.nav a.on { color: var(--accent); background: rgba(var(--accent-rgb), .12); }
section { padding: 48px 8px; }
.headline { font-size: 42px; line-height: 1.25; letter-spacing: .5px; }
.tagline { font-size: 17px; color: var(--accent); margin-top: 10px; }
.intro { color: var(--text-dim); line-height: 1.9; margin-top: 14px; font-size: 14.5px; }
.hero-actions { margin-top: 22px; }
.cta { display: inline-block; background: rgba(var(--accent-rgb), .15); border: 1px solid var(--accent); color: var(--accent); border-radius: 12px; padding: 12px 28px; font-size: 15px; font-weight: 600; text-decoration: none; }
.cta.big { font-size: 16px; }
h2 { font-size: 22px; margin-bottom: 18px; }
.fgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.fcard { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
.ft { font-weight: 700; margin-bottom: 6px; }
.fd { color: var(--text-dim); font-size: 13px; line-height: 1.7; }
.specs { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.specs th, .specs td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13.5px; }
.specs th { color: var(--text-faint); font-weight: 500; width: 34%; }
.specs tr:last-child th, .specs tr:last-child td { border-bottom: none; }
#back-top { position: fixed; right: 18px; bottom: 18px; width: 42px; height: 42px; border-radius: 50%; display: none; font-size: 16px; }
#back-top.show { display: block; }
`;

  return {
    'index.html': html,
    'style.css': css,
    'app.mjs': app,
    'logic.mjs': logic,
    'test/logic.test.mjs': test,
    'package.json': JSON.stringify({ name: 'app-landing', private: true, type: 'module' }, null, 2),
  };
}

export function defectVariant(f) {
  return {
    ...f,
    'logic.mjs': f['logic.mjs'].replace(
      "return (features ?? []).filter((f) => f && typeof f.t === 'string' && f.t.trim());",
      "return (features ?? []).filter(() => true); // [预设缺陷] 未过滤空标题特性",
    ),
  };
}

export function fixedLogic(f) {
  return f['logic.mjs'];
}
