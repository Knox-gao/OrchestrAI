/**
 * 生成器自检：4 个模板全部真实写入临时工作区并跑 node --test（缺陷变体必须失败）。
 * 用法：node apps/server/selftest.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATES, buildFiles } from './generator/index.mjs';
import { staticCheck } from './generator/quality.mjs';
import { runNodeTests } from './runner.mjs';

let failed = 0;
for (const [key, tpl] of Object.entries(TEMPLATES)) {
  // 展馆模板自带纯逻辑测试（素材为空数组的骨架形态），不联网
  const spec = {
    type: key, template: tpl, title: tpl.meta.name, subtitle: 'selftest',
    images: key === 'gallery' ? [] : undefined,
    ...(key === 'landing' ? { landing: { headline: 'Test', tagline: 't', intro: 'i', features: [{ t: 'A', d: 'B' }], specs: [['k', 'v']] } } : {}),
    ...(key === 'atlas' ? { atlas: { theme: '测试图谱', unitLabel: '年份', objects: Array.from({ length: 6 }, (_, i) => ({ name: '对象' + i, sub: '20' + (10 + i), desc: 'd', year: 2010 + i, metric: i * 10, metricLabel: '指标' })) } } : {}),
  };
  for (const variant of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `studio-${key}-${variant ? 'defect' : 'ok'}-`));
    const files = buildFiles(spec, { defect: variant });
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const r = await runNodeTests(dir).catch((e) => ({ exitCode: 1, passed: 0, failed: 1, logExcerpt: [String(e)], logRelPath: '-', durationMs: 0 }));
    // 静态质量门禁：两种变体都必须通过（缺陷只影响逻辑，不影响资源完整性）
    const problems = staticCheck(dir);
    const expect = variant ? 'FAIL' : 'PASS';
    const actual = r.exitCode === 0 ? 'PASS' : 'FAIL';
    const good = actual === expect && problems.length === 0;
    if (!good) failed++;
    console.log(`${good ? '✓' : '✗'} ${key.padEnd(9)} defect=${variant ? 'yes' : 'no '} → exit=${r.exitCode} (${r.passed}✓/${r.failed}✗, ${r.durationMs}ms) static=${problems.length === 0 ? 'OK' : problems.join(';')}  期望=${expect}`);
    if (!good) console.log(r.logExcerpt.join('\n'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
process.exit(failed === 0 ? 0 : 1);
