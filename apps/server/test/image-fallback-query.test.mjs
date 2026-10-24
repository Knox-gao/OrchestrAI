/**
 * 系统兜底补图时 searchQuery 的回归测试。
 *
 * 真实故障（第 2 个根因）：模型这次写的 5 个 searchQuery 全部合格，
 * 但页面仍有 1 张矢量插画 —— 因为模型给的图位不够，系统自己补了一张，
 * 而补位时把**整段正文**拼成搜索词：
 *   "Kávé Műhely — 高端咖啡器具评测 四位胜出者 经三十轮盲测与拆机评估，以下四件
 *    器具在本季各品类中综合得分最高。 establishing photo"
 * 这种长句一张图都搜不到。第二个兜底分支更糟，直接把需求原文拼进去。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackImageQuery } from '../generator/pageplan/generate.mjs';

const run = (sectionTitle, title = '页面', variant = 0) =>
  fallbackImageQuery({ title, sectionTitle, variant });

test('兜底查询不含正文长句与摄影术语', () => {
  const q = run('Kávé Műhely — 高端咖啡器具评测 四位胜出者 经三十轮盲测与拆机评估，以下四件器具在本季各品类中综合得分最高。');
  assert.ok(q.length <= 60, `查询过长（${q.length}）：${q}`);
  assert.equal(/establishing|editorial photograph|blind test|三十轮/i.test(q), false, `不该含正文或术语：${q}`);
});

test('英文标题抽取名词主体，跳过虚词与动名词', () => {
  assert.equal(run('Origin Stories: How They Began'), 'Origin Stories');
  // 动名词 Designing 被剔除，只留名词 Systems Web
  assert.equal(run('Designing Systems for the Web'), 'Systems Web');
});

test('重音拉丁字母不被切断', () => {
  // 曾经的 bug：正则只认 [A-Za-z]，把 "Kávé Műhely" 切成 "hely"
  const q = run('Kávé Műhely — 高端咖啡器具评测');
  assert.match(q, /Kávé/);
  assert.equal(/^hely\b/.test(q), false, `不该只剩半截词：${q}`);
});

test('中文标题整段保留，不按字切开也不重复拼接', () => {
  const q = run('一座只属于你的海');
  assert.equal(q, '一座只属于你的海');
  // 曾经的 bug：\p{L} 把汉字当拉丁字母又匹配一遍，拼出 "xx xx"
  assert.equal(q.split(' ').length, 1, `中文不应被空格拼接：${q}`);
});

test('中英混排时中文主体优先且不与汉字重复', () => {
  const q = run('展馆空间设计 — 从赛道到展厅');
  assert.equal(q, '展馆空间设计');
});

test('主体过短时才补具体场景词，且场景词不含 mood 形容词', () => {
  const q = run('A');
  assert.ok(q.split(' ').length === 2, `应为主体 + 场景词：${q}`);
  assert.equal(/glowing|dark|minimal|luxury|at night/i.test(q), false, `场景词不得含氛围形容词：${q}`);
});

test('兜底查询词数不超过 4，符合图库检索习惯', () => {
  const cases = [
    'Ferrari 展馆 — 从赛道到展厅',
    'Origin Stories: How They Began',
    'Kávé Műhely — 高端咖啡器具评测',
    '一座只属于你的海',
    'Toyota AE86 轻量后驱的永恒符号',
  ];
  for (const c of cases) {
    const q = run(c);
    assert.ok(q.split(/\s+/).length <= 4, `词数过多：${q}（来自 ${c}）`);
  }
});

test('空标题不崩，退化为纯场景词', () => {
  assert.doesNotThrow(() => fallbackImageQuery({ title: '', sectionTitle: '' }));
  const q = fallbackImageQuery({ title: '', sectionTitle: '' });
  assert.ok(typeof q === 'string');
});

test('variant 轮换场景词，避免同一页多张兜底图撞同一个搜索词', () => {
  const a = run('A', '页面', 0);
  const b = run('A', '页面', 1);
  const c = run('A', '页面', 2);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});
