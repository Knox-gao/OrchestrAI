/**
 * 滚动叙事（cinematic）层的回归测试。
 *
 * 背景：用户对比「手工法拉利滚动视差页」与 OrchestrAI 一句话产出后，
 * 指出产出质量不如手作。根因是渲染器只支持静态栏目式布局，
 * 无法表达钉住进度场景、横向长廊、显现动画、计数动画。
 * 本组测试锁住渲染层与门禁对这组能力的支持。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPagePlan } from '../generator/pageplan/render.mjs';
import { validatePagePlan, PAGEPLAN_LIMITS } from '../generator/pageplan/schema.mjs';
import { checkPagePlanHtml } from '../generator/pageplan/pageplan-gate.mjs';
import { SCROLL_RUNTIME, SCROLL_CINEMA_CSS } from '../generator/pageplan/scrollcinema.mjs';

const THEME = {
  background: '#0b0b0d', surface: '#101015', text: '#f4f2ee', muted: '#9a9ab0',
  accent: '#ff2800', accentSoft: '#2a1f3f', density: 'comfortable', radius: 'soft',
  styleId: 'neon-obsidian', fontMood: 'sans',
};

function cinemaPlan() {
  return {
    schemaVersion: 'orchestrai.pageplan.v1',
    meta: { title: '展馆', description: '滚动叙事测试', language: 'zh-CN' },
    userConstraints: { locked: true },
    designIntent: { concept: '展馆叙事', pageDirection: 'showcase', visualPrinciples: ['p'] },
    theme: THEME,
    cinematic: true,
    nodes: [
      { id: 'hero', type: 'section', title: '展馆', variant: 'hero', children: [
        { id: 'm1', type: 'metric', value: '9,500 rpm', label: '红线转速' },
      ] },
      { id: 'peak', type: 'section', title: '转速仪式', scene: 'pinned', children: [
        { id: 'pt', type: 'text', text: '从怠速到红线。' },
        { id: 'pm', type: 'metric', value: '9,500 rpm', label: '极限转速' },
      ] },
      { id: 'gal', type: 'section', title: '车型长廊', scene: 'gallery', children: [
        { id: 'c1', type: 'card', title: '125 S', description: '一切的开始' },
        { id: 'c2', type: 'card', title: 'SF90', description: '混动图腾' },
      ] },
    ],
    unsupportedRequests: [],
  };
}

function render(plan) {
  return renderPagePlan(plan, { imageCredits: new Map() }).files['index.html'];
}

// ---------- schema ----------

test('cinematic 与 section.scene 通过校验', () => {
  const plan = cinemaPlan();
  assert.doesNotThrow(() => validatePagePlan(plan));
});

test('非法 scene 与非法 cinematic 被拒绝', () => {
  const plan = cinemaPlan();
  plan.nodes[1].scene = 'dramatic';
  assert.throws(() => validatePagePlan(plan), /expected one of pinned\|gallery/);
  const plan2 = cinemaPlan();
  plan2.cinematic = 'yes';
  assert.throws(() => validatePagePlan(plan2), /cinematic: expected boolean/);
});

test('不声明 cinematic 的普通计划照常通过', () => {
  const plan = cinemaPlan();
  delete plan.cinematic;
  plan.nodes.forEach((n) => { delete n.scene; });
  assert.doesNotThrow(() => validatePagePlan(plan));
});

// ---------- 渲染 ----------

test('钉住场景：300vh 舞台 + 子块 data-at 阈值 + metric 转进度计数器', () => {
  const html = render(cinemaPlan());
  assert.match(html, /data-scene="pinned"/);
  assert.match(html, /height:300vh/);
  assert.match(html, /data-at="0\.12"/, '第一个子块应有起始阈值');
  assert.match(html, /data-meter/, '钉住场景内 metric 应为进度计数器');
  assert.match(html, /data-to="9500"/, '计数器应带去逗号后的终值');
});

test('横向长廊：轨道 + 场景标记', () => {
  const html = render(cinemaPlan());
  assert.match(html, /data-scene="gallery"/);
  assert.match(html, /data-track/);
});

test('cinematic 计划注入滚动运行时与进度条，普通计划不注入', () => {
  const withCinema = render(cinemaPlan());
  assert.match(withCinema, /IntersectionObserver/);
  assert.match(withCinema, /pp-progress/);
  assert.match(withCinema, /data-rv/);

  const plain = cinemaPlan();
  delete plain.cinematic;
  plain.nodes.forEach((n) => { delete n.scene; });
  const plainHtml = render(plain);
  assert.doesNotMatch(plainHtml, /pp-progress/);
});

test('计数器保留前后缀与小数位（rpm 后缀不丢）', () => {
  const html = render(cinemaPlan());
  assert.match(html, /data-suf=" rpm"/);
  assert.match(html, /data-dec="0"/);
});

// ---------- 门禁 ----------

test('门禁信任滚动运行时组合：cinematic 页面通过静态检查', () => {
  const html = render(cinemaPlan());
  const { problems } = checkPagePlanHtml(html, {
    sectionIds: ['hero', 'peak', 'gal'],
    title: '展馆',
    themeVars: ['--pp-bg', '--pp-surface', '--pp-text', '--pp-muted', '--pp-accent', '--pp-accent-soft'],
    unsupported: [],
    imageRequired: false,
  });
  assert.equal(problems.length, 0, `门禁应通过，实际：${problems.join('；')}`);
});

test('运行时文本字节级一致（防模型借道注入）', () => {
  const html = render(cinemaPlan());
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, '应有内联运行时');
  assert.equal(m[1], SCROLL_RUNTIME, '脚本必须与 SCROLL_RUNTIME 字节一致');
});

test('CSS 常量包含移动端退化与 reduced-motion 降级', () => {
  assert.match(SCROLL_CINEMA_CSS, /@media\(max-width:760px\)/);
  assert.match(SCROLL_CINEMA_CSS, /prefers-reduced-motion:reduce/);
  assert.match(SCROLL_CINEMA_CSS, /pp-hstage/);
});

// ---------- LIMITS 不回退 ----------

test('schema 限额未被放宽（maxVisualPrinciples 仍为 12）', () => {
  assert.equal(PAGEPLAN_LIMITS.maxVisualPrinciples, 12);
});
