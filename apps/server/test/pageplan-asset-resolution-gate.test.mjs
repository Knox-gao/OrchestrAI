import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAssetsResolved, PagePlanAssetResolutionError } from '../generator/pageplan/asset-resolution-gate.mjs';

test('unresolved required asset blocks offline delivery regardless of rendercheck configuration', () => {
  assert.throws(() => assertAssetsResolved({ assets: [], unresolved: [{ id: 'hero', src: 'https://images.example/hero.jpg', reason: 'timeout' }], bundleFiles: {}, offlineDelivery: true }), PagePlanAssetResolutionError);
});
test('a declared path in the asset inventory is not proof that the file exists in the bundle', () => {
  assert.throws(() => assertAssetsResolved({ assets: [{ id: 'hero', path: 'images/hero.jpg', required: true }], unresolved: [], bundleFiles: {}, offlineDelivery: true }), /unresolved/);
});
test('resolved required asset succeeds only when its path exists in the actual file map', () => {
  const result = assertAssetsResolved({ assets: [{ id: 'hero', path: 'images/hero.jpg', required: true }], unresolved: [], bundleFiles: { 'index.html': '<html/>', 'images/hero.jpg': Buffer.from('image') }, offlineDelivery: true });
  assert.equal(result.passed, true); assert.equal(result.assetCount, 1); assert.equal(result.bundledFileCount, 2);
});
test('online-only mode may disclose an optional unresolved external resource', () => {
  const result = assertAssetsResolved({ assets: [], unresolved: [{ id: 'decor', src: 'https://images.example/decor.jpg', reason: 'offline', required: false }], bundleFiles: {}, offlineDelivery: false });
  assert.equal(result.passed, true);
});
test('required unresolved assets still block online-only mode', () => {
  assert.throws(() => assertAssetsResolved({ unresolved: [{ id: 'hero', src: 'https://images.example/hero.jpg', required: true }], bundleFiles: {}, offlineDelivery: false }), PagePlanAssetResolutionError);
});
test('unresolved optional assets block default offline ZIP when their URL remains referenced', () => {
  assert.throws(() => assertAssetsResolved({ unresolved: [{ id: 'optional-still-referenced', src: 'https://images.example/optional.jpg', required: false }], bundleFiles: {}, offlineDelivery: true }), PagePlanAssetResolutionError);
});
test('bundle file map accepts Map and object forms containing actual content', () => {
  assert.equal(assertAssetsResolved({ assets: [{ path: 'a.png', required: true }], bundleFiles: new Map([['a.png', Buffer.from('x')]]) }).passed, true);
  assert.equal(assertAssetsResolved({ assets: [{ path: 'a.png', required: true }], bundleFiles: { 'a.png': 'image bytes', 'index.html': '<img src=\"a.png\">' } }).passed, true);
});

test('rejects a path-only inventory or map without actual file content', () => {
  assert.throws(() => assertAssetsResolved({ assets: [{ path: 'a.png', required: true }], bundleFiles: ['a.png'] }), /actual Map or plain file-content map/);
  assert.throws(() => assertAssetsResolved({ assets: [{ path: 'a.png', required: true }], bundleFiles: { 'a.png': true } }), /actual string or byte content/);
});

test('offline ZIP blocks missing optional assets that remain referenced', () => {
  assert.throws(
    () => assertAssetsResolved({ assets: [{ id: 'decor', path: 'images/decor.jpg', required: false, resolved: true }], unresolved: [], bundleFiles: { 'index.html': '<img src=\"images/decor.jpg\">' }, offlineDelivery: true }),
    (error) => error instanceof PagePlanAssetResolutionError && /not present in the actual bundle file map/.test(error.unresolved.map((x) => x.reason).join(' ')),
  );
});

test('rejects bundle file paths that could escape the output root', () => {
  for (const badPath of ['../secret.txt', '/absolute/file', 'C:/Windows/win.ini', 'images\\..\\secret.txt', 'https://evil.example/a.js']) {
    assert.throws(() => assertAssetsResolved({ assets: [], unresolved: [], bundleFiles: new Map([[badPath, 'content']]) }), /unsafe relative path/);
  }
});
test('asset failure metadata strips query credentials and does not echo malformed source strings', () => {
  let error;
  try { assertAssetsResolved({ unresolved: [{ id: 'hero', src: 'https://images.example/hero.jpg?token=secret#frag', reason: 'timeout' }], bundleFiles: { 'index.html': '<img>' } }); }
  catch (caught) { error = caught; }
  assert.ok(error instanceof PagePlanAssetResolutionError);
  assert.equal(error.unresolved[0].src, 'https://images.example/hero.jpg');
  assert.doesNotMatch(JSON.stringify(error.unresolved), /secret|frag/);
  let unsafe;
  try { assertAssetsResolved({ unresolved: [{ id: 'x', src: 'not a url with secret=123', reason: 'bad' }], bundleFiles: { 'index.html': '<img>' } }); }
  catch (caught) { unsafe = caught; }
  assert.equal(unsafe.unresolved[0].src, '[redacted-source]');
});
