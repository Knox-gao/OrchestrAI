/**
 * PagePlan 图片资产落地单测（M7-B4B）
 * 重点：不伪造图片、不静默丢图；本地路径缺失必须阻断。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bundlePagePlanAssets, PagePlanAssetError, collectImageNodes } from '../generator/pageplan/assets.mjs';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001' +
  '0d0a2db40000000049454e44ae426082',
  'hex',
);

function planWith(sources) {
  return {
    nodes: sources.map((src, i) => ({ id: `img-${i}`, type: 'image', src, alt: `图 ${i}` })),
  };
}

test('collectImageNodes 递归收集嵌套图片节点', () => {
  const plan = { nodes: [
    { id: 's', type: 'section', children: [
      { id: 'c', type: 'container', children: [{ id: 'i', type: 'image', src: 'a.jpg', alt: 'a' }] },
    ] },
  ] };
  assert.deepEqual(collectImageNodes(plan).map((n) => n.id), ['i']);
});

test('HTTPS 图片被下载并改写为本地相对路径', async () => {
  const plan = planWith(['https://example.com/a.png', 'https://example.com/a.png']);
  const files = new Map();
  const r = await bundlePagePlanAssets(plan, {
    fetcher: async () => ({ buf: PNG, ext: 'png' }),
    existing: (rel) => files.has(rel),
  });
  assert.equal(r.assets.length, 1, '同一 URL 应复用同一文件');
  assert.equal(plan.nodes[0].src, r.assets[0].file);
  assert.match(plan.nodes[0].src, /^images\/pp-[0-9a-f]{12}\.png$/);
  assert.equal(plan.nodes[1].src, plan.nodes[0].src, '重复引用应指向同一文件');
  assert.equal(r.unresolved.length, 0);
});

test('下载失败不伪造图片：保留外链并记录 unresolved', async () => {
  const plan = planWith(['https://example.com/broken.jpg']);
  const r = await bundlePagePlanAssets(plan, {
    fetcher: async () => { throw new Error('HTTP 404'); },
  });
  assert.equal(r.assets.length, 0);
  assert.equal(plan.nodes[0].src, 'https://example.com/broken.jpg', '外链必须原样保留，不能替换成占位图');
  assert.equal(r.unresolved.length, 1);
  assert.match(r.unresolved[0].reason, /404/);
});

test('本地相对路径必须已存在，缺失则抛 PAGEPLAN_ASSET_MISSING（阻断）', async () => {
  const plan = planWith(['images/none.jpg']);
  await assert.rejects(
    () => bundlePagePlanAssets(plan, { existing: () => false }),
    (e) => e instanceof PagePlanAssetError && e.code === 'PAGEPLAN_ASSET_MISSING',
  );
});

test('本地相对路径存在时保持原样', async () => {
  const plan = planWith(['images/ok.jpg']);
  const r = await bundlePagePlanAssets(plan, { existing: (rel) => rel === 'images/ok.jpg' });
  assert.equal(plan.nodes[0].src, 'images/ok.jpg');
  assert.equal(r.assets.length, 0);
});

test('http:// 与 data: 不被当作可下载外链，按本地缺失处理（更严格）', async () => {
  for (const src of ['http://example.com/a.png', 'data:image/png;base64,AAAA']) {
    await assert.rejects(
      () => bundlePagePlanAssets(planWith([src]), { existing: () => false }),
      (e) => e instanceof PagePlanAssetError && e.code === 'PAGEPLAN_ASSET_MISSING',
      `${src} 必须被拒绝`,
    );
  }
});
