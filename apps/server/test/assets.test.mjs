import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssets, saveAssets, assetEntry, reusableAsset, hashBuf, ASSET_REGISTRY } from '../assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WS = path.join(ROOT, 'workspaces', 'assets-test-ws');
const IMG = { file: 'images/img-01.jpg', title: '钢铁侠测试', sub: '托尼', author: '来源站 x', license: 'via Bing', page: 'https://e.com/p', buf: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) };

test('注册表按项目名读写往返（缺陷检测点：跨工作区可读）', () => {
  const proj = '测试项目-alpha';
  assert.deepEqual(loadAssets(proj), { version: 1, entries: [] }, '无清单时空结构');
  saveAssets(proj, { version: 1, entries: [assetEntry(IMG, { reason: 'r', srcWs: 'assets-test-ws' })] });
  const back = loadAssets(proj);
  assert.equal(back.entries[0].title, '钢铁侠测试');
  assert.ok(back.entries[0].src.includes('assets-test-ws'), '条目必须记录来源工作区');
  fs.rmSync(path.join(ASSET_REGISTRY, '测试项目-alpha.json'), { force: true });
});

test('资产条目：可追溯字段齐全且默认锁定（缺陷检测点）', () => {
  const e = assetEntry(IMG, { reason: 'strict 命中', provider: 'Bing 图片搜索', srcWs: 'assets-test-ws' });
  assert.equal(e.locked, true);
  assert.equal(e.sha1, hashBuf(IMG.buf));
  assert.ok(e.chosenAt);
  assert.ok(e.page.startsWith('https://'));
});

test('锁定复用三态：一致→复用 / 文件被动过→拒绝 / 未锁定→拒绝（缺陷检测点）', () => {
  fs.mkdirSync(path.join(WS, 'images'), { recursive: true });
  fs.writeFileSync(path.join(WS, IMG.file), IMG.buf);
  const mk = (over = {}) => ({ version: 1, entries: [{ ...assetEntry(IMG, { srcWs: 'assets-test-ws' }), ...over }] });
  // 1) 一致 → 复用
  const got = reusableAsset(mk(), '钢铁侠测试');
  assert.ok(got?.reused, '源文件一致时必须复用');
  assert.deepEqual(got.buf, IMG.buf);
  // 2) 源文件被改动 → 拒绝
  fs.writeFileSync(path.join(WS, IMG.file), Buffer.from([9, 9]));
  assert.equal(reusableAsset(mk(), '钢铁侠测试'), null, '文件被改动后必须拒绝复用');
  // 3) 未锁定 → 拒绝
  fs.writeFileSync(path.join(WS, IMG.file), IMG.buf);
  assert.equal(reusableAsset(mk({ locked: false }), '钢铁侠测试'), null, '未锁定条目不得复用');
  fs.rmSync(WS, { recursive: true, force: true });
});
