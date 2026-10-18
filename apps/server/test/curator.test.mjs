import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { scoreCandidate, rankCandidates, profileFromFeatures } from '../generator/curator.mjs';
import { resolveSlot, slotKeyOf, assetEntry, hashBuf } from '../assets.mjs';
import { imageFeaturesFromFile, mediaClass } from '../imaging.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cur-'));
// 真实样本两张（漫威工作区现图）
const REAL1 = path.join(ROOT, 'workspaces', 'PMVD10MOR', 'images', 'img-01.jpg');
const REAL2 = path.join(ROOT, 'workspaces', 'PMVD10MOR', 'images', 'img-05.jpg');
const have = fs.existsSync(REAL1) && fs.existsSync(REAL2);

test('真实图特征提取（解码+特征+媒介）', { skip: !have }, () => {
  const f = imageFeaturesFromFile(REAL1);
  assert.ok(f.width > 200 && f.height > 200);
  assert.ok(f.brightness >= 0 && f.brightness <= 255);
  assert.ok(/^#[0-9a-f]{6}$/.test(f.dominant[0].hex));
  assert.equal(mediaClass('来源站 baike.so.com', 'https://baike.so.com/x'), 'encyclopedia');
});

test('评分四维分离：强内容命中 > 弱命中 > 失配（缺陷检测点：排序可解释）', { skip: !have }, () => {
  const slot = { targets: ['钢铁侠', 'Iron Man'] };
  const strong = scoreCandidate({ file: REAL1, title: '钢铁侠 Iron Man 电影剧照', author: '来源站 x', license: 'via Bing', page: 'https://a.com/p' }, slot);
  const weak = scoreCandidate({ file: REAL1, title: '冶金的钢铁厂图片', author: '来源站 x', license: 'via Bing', page: 'https://b.com/p' }, slot);
  const miss = scoreCandidate({ file: REAL1, title: '风景壁纸', author: '', license: '', page: '' }, slot);
  assert.equal(strong.dims.content.level, 'strong');
  assert.equal(weak.dims.content.level, 'weak');
  assert.equal(miss.dims.content.level, 'miss');
  assert.ok(strong.total > weak.total && weak.total > miss.total, `排序 ${strong.total} > ${weak.total} > ${miss.total}`);
  assert.equal(miss.dims.source.score, 0, '无许可无署名无来源页→source 0 分且 licenseState=unconfirmed');
  assert.equal(miss.licenseState, 'unconfirmed');
  // reasons 必须可读（可解释性）
  assert.ok(strong.reasons.length === 4 && strong.reasons.join('').includes('content: strong'));
});

test('visual 维：项目画像偏离可量化（媒介不符降权）', { skip: !have }, () => {
  const slotMatch = { targets: ['x'], profile: { brightness: 100, saturation: 0.5, media: 'encyclopedia' } };
  const r = scoreCandidate({ file: REAL1, title: 't', author: '来源站 baike', page: 'https://baike/x' }, slotMatch);
  assert.ok(r.dims.visual.score > 0 && r.dims.visual.score <= 1);
  assert.ok(r.dims.visual.notes.includes('媒介'), '媒介作为辅助信号写入 notes');
  const prof = profileFromFeatures([
    { brightness: 100, saturation: 0.5, media: 'encyclopedia' },
    { brightness: 80, saturation: 0.4, media: 'encyclopedia' },
    { brightness: 240, saturation: 0.9, media: 'stock' },
  ]);
  assert.equal(prof.media, 'encyclopedia', '主导媒介=百科');
  assert.equal(prof.brightness, 100, '中位数亮度');
});

test('rankCandidates：总分降序且保留全量评分记录', { skip: !have }, () => {
  const cands = [
    { file: REAL1, title: '风景壁纸', author: '', license: '', page: '' },
    { file: REAL2, title: '钢铁侠 剧照', author: '来源站 b', license: 'via Bing', page: 'https://c.com/p' },
  ];
  const { ranked, all } = rankCandidates(cands, { targets: ['钢铁侠'] });
  assert.equal(ranked[0].cand.title.includes('钢铁侠'), true, '强命中排第一');
  assert.equal(all.length, 2);
});

test('图位解析：名称变/语义不变→复用；语义变→拒绝；源丢→明确状态（缺陷检测点）', () => {
  const ws = path.join(ROOT, 'workspaces', 'cur-test-ws');
  fs.mkdirSync(path.join(ws, 'images'), { recursive: true });
  const buf = Buffer.from('data-1');
  fs.writeFileSync(path.join(ws, 'images', 'x.jpg'), buf);
  const entry = {
    ...assetEntry({ file: 'images/x.jpg', title: '雷神托尔', sub: '', author: 'a', license: 'l', page: 'https://p', buf }, { srcWs: 'cur-test-ws' }),
    en: 'thor',
  };
  entry.sha1 = hashBuf(buf); // 以可控文件内容计算
  const assets = { version: 1, entries: [entry] };
  // 名称变（雷神托尔→雷神）但 en 相同 → 同图位复用
  assert.equal(resolveSlot(assets, { name: '雷神', en: 'Thor' }).status, 'reuse');
  // en 不同 → 语义角色实质变化，拒绝复用
  assert.equal(resolveSlot(assets, { name: '雷神托尔', en: 'Loki' }).status, 'semantic-change');
  // 源文件丢失 → 明确状态（不静默换图）
  fs.unlinkSync(path.join(ws, 'images', 'x.jpg'));
  assert.equal(resolveSlot(assets, { name: '雷神', en: 'Thor' }).status, 'source-missing');
  fs.rmSync(ws, { recursive: true, force: true });
});

test('slotKey 归一化', () => {
  assert.equal(slotKeyOf(' 钢铁 侠 '), '钢铁侠');
  assert.equal(slotKeyOf('Iron Man'), 'ironman');
  assert.equal(slotKeyOf('Iron Man'), slotKeyOf('iron man'), '大小写与空白不敏感');
});
