/**
 * 图片搜索相关性过滤的回归测试。
 *
 * 真实故障：交付页面里 8 张图有 2 张被替换成矢量插画。查下来不是搜索词问题，
 * 是过滤规则用「最长的英文词」当锚点：
 *
 *   `ferrari showroom architecture` 的 35 条候选里有 26 条真带 ferrari，
 *   但最长词 architecture 命中 0 条 → 26 张真实法拉利照片被整批丢弃
 *   → 判定"无结果" → 回退成矢量插画。
 *
 * 修复：主体词（品牌/车型 > 首个实词 > 最长实词）做锚点，两段式判定。
 * 这组测试锁住锚点选择与两段式的边界，防止以后又退回"最长词"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBingRelevance } from '../scraper.mjs';

const hitStrict = (q, title, page = 'https://example.com/x') => buildBingRelevance(q).hitStrict(title, page);
const hitRelaxed = (q, title, page = 'https://example.com/x') => buildBingRelevance(q).hitRelaxed(title, page);

// ---------- 锚点选择 ----------

test('锚点优先取品牌词，而不是最长的修饰语', () => {
  const r = buildBingRelevance('ferrari showroom architecture');
  assert.equal(r.anchor, 'ferrari', '品牌词必须优先于 architecture');
  assert.equal(r.anchorIsProperNoun, true);
});

test('车型编号被识别为专有名词', () => {
  // 品牌词优先于车型编号，两者都算专有名词
  const withBrand = buildBingRelevance('toyota ae86 Trueno side profile');
  assert.equal(withBrand.anchor, 'toyota', '品牌词优先级最高');
  assert.equal(withBrand.anchorIsProperNoun, true);

  // 没有品牌词时，车型编号自己就是锚点
  const codeOnly = buildBingRelevance('ae86 Trueno side profile');
  assert.equal(codeOnly.anchor, 'ae86', '车型编号应成为锚点');
  assert.equal(codeOnly.anchorIsProperNoun, true);
});

test('没有品牌词时取第一个长度 ≥4 的实词，跳过修饰语', () => {
  const r = buildBingRelevance('workspace sketch monitor');
  // workspace/sketch 都在修饰语表里，monitor 也是；此时回退到最长实词或最长词
  assert.ok(r.anchor, '仍要给出一个锚点');
  const r2 = buildBingRelevance('volcano eruption aerial');
  assert.equal(r2.anchor, 'volcano', '没有修饰语干扰时应取首个实词');
});

test('中文查询识别中文词', () => {
  const r = buildBingRelevance('法拉利 展馆 建筑');
  assert.ok(r.cjkTokens.includes('法拉利'));
  assert.equal(r.hitStrict('法拉利最新跑车发布', 'https://a.com/1'), true);
});

// ---------- 严格段 ----------

test('严格段：主体词 + 额外实词都命中才算相关', () => {
  // 品牌命中但缺 showroom → 严格段拒绝
  assert.equal(hitStrict('ferrari showroom architecture', '2013红色ferrari法拉利跑车'), false);
  // 两者都命中 → 通过
  assert.equal(hitStrict('ferrari showroom architecture', 'Ferrari showroom in Tokyo', 'https://a.com/ferrari-showroom'), true);
});

test('严格段仍然拦住"只中泛词"的垃圾图', () => {
  // Rocket Raccoon Marvel 的历史教训：只中 rocket 的火箭发射图必须被拒
  assert.equal(hitStrict('rocket raccoon marvel', '中国长征火箭发射成功'), false);
  assert.equal(hitStrict('rocket raccoon marvel', 'Rocket Raccoon Marvel figure review'), true);
});

// ---------- 放宽段 ----------

test('放宽段救回品牌命中但缺修饰词的真实照片（主修复点）', () => {
  const title = '2013红色ferrari法拉利跑车';
  // 修复前：这张会被丢弃 → 页面退化成矢量插画
  assert.equal(hitStrict('ferrari showroom architecture', title), false);
  // 修复后：放宽段接受它
  assert.equal(hitRelaxed('ferrari showroom architecture', title), true);
});

test('放宽段只对专有名词开放：普通名词不得单独放行', () => {
  // aurora 是普通词，会和"叫 Aurora 的品牌/人名"撞车
  const r = buildBingRelevance('aurora gradient poster design on dark wall');
  assert.equal(r.anchorIsProperNoun, false, 'aurora 不是专有名词');
  assert.equal(hitRelaxed('aurora gradient poster design on dark wall', 'Aurora-的抖音 - 抖音'), false);
  assert.equal(hitRelaxed('aurora gradient poster design on dark wall', 'Es | Aurora Bus'), false);
});

test('放宽段对中文查询同样生效', () => {
  assert.equal(hitRelaxed('法拉利 展馆 内部', '法拉利新车型实拍'), true);
});

// ---------- 不该误伤 ----------

test('完全无关的候选在两种判定下都被拒', () => {
  const q = 'ferrari showroom architecture';
  assert.equal(hitStrict(q, 'Robosense三维激光雷达H16'), false);
  assert.equal(hitRelaxed(q, 'Robosense三维激光雷达H16'), false);
});

test('空查询与空标题不抛异常', () => {
  assert.doesNotThrow(() => buildBingRelevance(''));
  assert.equal(hitStrict('', 'anything'), false);
  assert.equal(hitRelaxed('', 'anything'), false);
  assert.doesNotThrow(() => buildBingRelevance('ferrari showroom').hitStrict('', ''));
});

test('品牌词大小写不敏感', () => {
  assert.equal(hitRelaxed('Ferrari Showroom', 'FERRARI 308 GTB'), true);
  assert.equal(hitRelaxed('FERRARI showroom', 'ferrari 308 gtb'), true);
});
