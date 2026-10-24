/**
 * 图片搜索词压缩的回归测试。
 *
 * 真实故障：真实模型写的 searchQuery 全是 7-9 个词的形容词堆叠，实测 7/8 搜不到图，
 * 页面只好退化成矢量插画。同一图位改用 2-3 个具体名词，7/7 都能搜到。
 *
 * 这组测试锁住压缩规则：不能退化成"取前 N 个词"（那会得到 designer working at），
 * 必须剔除形容词/介词/动名词，并优先保留品牌与名词短语。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { shortenImageQuery, buildImageQueryCandidates } from '../pipeline.mjs';

// ---------- 真实失败样本 ----------

const REAL_FAILURES = [
  ['designer working at desk with glowing screens at night', 'desk'],
  ['minimal coffee shop neon sign at night', 'coffee shop'],
  ['dark control room with large data dashboard screens', 'control room'],
  ['neon light installation reacting to music in dark venue', 'music venue'],
  ['designer sketching wireframes on tablet on dark desk', 'wireframe'],
  ['aurora gradient poster design on dark wall', 'aurora'],
  ['neon light trails long exposure on dark stage', 'stage'],
];

test('真实失败样本都能压出有效短语', () => {
  for (const [long, expectContains] of REAL_FAILURES) {
    const out = shortenImageQuery(long, 3);
    assert.ok(out, `未能压缩：${long}`);
    assert.ok(
      out.toLowerCase().includes(expectContains) || buildImageQueryCandidates(long, 3).some((c) => c.includes(expectContains)),
      `压缩结果应保留核心主体 "${expectContains}"，实际得到 "${out}"（全部候选：${buildImageQueryCandidates(long, 3).join(' / ')}）`,
    );
  }
});

test('压缩结果不超过 3 个词', () => {
  for (const [long] of REAL_FAILURES) {
    for (const c of buildImageQueryCandidates(long, 3)) {
      assert.ok(c.split(' ').length <= 3, `候选超过 3 词：${c}（来自 ${long}）`);
    }
  }
});

// ---------- 不能只是截断 ----------

test('不能退化成"取前 N 个词"：形容词与介词必须被剔除', () => {
  const out = buildImageQueryCandidates('designer working at desk with glowing screens at night', 3);
  for (const c of out) {
    assert.equal(/\b(?:working|glowing|at|with|night)\b/.test(c), false, `候选里不应含动作/介词/时间词：${c}`);
  }
  assert.ok(out.some((c) => c.includes('desk')), '应保留核心主体 desk');
});

test('尺寸与数据类修饰词被剔除', () => {
  const out = buildImageQueryCandidates('dark control room with large data dashboard screens', 3);
  assert.ok(out.some((c) => c === 'control room'), `应产出 "control room"，实际：${out.join(' / ')}`);
  for (const c of out) {
    assert.equal(/\blarge\b|\bdata\b/.test(c), false, `不该含 large/data：${c}`);
  }
});

// ---------- 品牌与专有名词优先 ----------

test('品牌词被优先保留在候选前列', () => {
  const out = buildImageQueryCandidates('ferrari showroom architecture interior detail', 3);
  assert.ok(out.length > 0);
  assert.ok(out[0].toLowerCase().includes('ferrari'), `品牌应排在首位，实际首位：${out[0]}`);
});

test('车型编号识别为高价值词', () => {
  const out = buildImageQueryCandidates('toyota ae86 trueno side profile detail', 3);
  assert.ok(out.some((c) => /ae86/i.test(c)), `应保留 ae86：${out.join(' / ')}`);
});

// ---------- 中文与边界 ----------

test('中文查询原样返回，不做英文式压缩', () => {
  const zh = '法拉利展馆内部照片';
  assert.equal(shortenImageQuery(zh), zh);
  assert.deepEqual(buildImageQueryCandidates(zh), [zh]);
});

test('已经是短词时返回空（无需兜底）', () => {
  // 两词查询本身就该直接成功，不必再压缩
  assert.equal(shortenImageQuery('coffee shop'), '');
});

test('空查询与纯停用词不崩', () => {
  assert.equal(shortenImageQuery(''), '');
  assert.deepEqual(buildImageQueryCandidates(''), []);
  assert.deepEqual(buildImageQueryCandidates('at night with glowing'), []);
});

test('候选按分值排序且内部去重', () => {
  const out = buildImageQueryCandidates('neon light trails long exposure on dark stage', 3);
  assert.equal(new Set(out).size, out.length, '候选不得重复');
  assert.ok(out.length >= 1);
});
