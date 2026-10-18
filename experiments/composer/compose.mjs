/**
 * Scene Composer 编译器：创意方案 JSON → 真实可运行单文件网页。
 * 页面 = 文档壳（字体/基础样式/reduced-motion） + 场景序列（能力代码生成） + 相邻转场（机制代码生成）。
 * 相邻场景缺转场时自动补 depthPush（记录在编译日志）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScene, renderTransition } from './capabilities.mjs';
import { validatePlan } from './director.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SHELL_CSS = (plan) => `:root { --accent: ${plan.artDirection?.palette?.[0] ?? '#7fd8ff'}; }
* { margin:0; box-sizing:border-box; }
html { scroll-behavior:smooth; }
body { background:#05070a; color:#dbe9f2; font-family:Georgia,'Songti SC',serif; overflow-x:hidden; }
a { -webkit-tap-highlight-color: transparent; }
@media (prefers-reduced-motion:reduce){ html{scroll-behavior:auto} *{animation-duration:.01s !important} }`;

export function compile(plan, { title = 'OrchestrAI · Scene Composer' } = {}) {
  const v = validatePlan(plan);
  if (!v.ok) throw new Error('方案校验未过：' + v.errors.join('；'));
  const log = { scenes: [], transitions: [], autoTransitions: [] };
  const css = [SHELL_CSS(plan)];
  const js = [];
  const body = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const s = plan.scenes[i];
    const r = renderScene(s);
    body.push(r.html); css.push(r.css); if (r.js) js.push(r.js);
    log.scenes.push({ id: s.id, capability: s.capability, purpose: s.purpose ?? '' });
    // 相邻转场
    if (i < plan.scenes.length - 1) {
      const next = plan.scenes[i + 1];
      const t = (plan.transitions ?? []).find((x) => x.after === s.id)
        ?? (() => { log.autoTransitions.push(`${s.id}→${next.id} 自动补 depthPush`); return { mechanism: 'depthPush', params: { word: next.name ?? '' } }; })();
      const tr = renderTransition(t, s, next);
      body.push(tr.html); css.push(tr.css); if (tr.js) js.push(tr.js);
      log.transitions.push({ after: s.id, mechanism: t.mechanism, why: t.why ?? '' });
    }
  }
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>
${css.join('\n')}
</style>
</head>
<body>
<script>
/* 评审钩子：?motion=force 强制启用动画（覆盖系统 reduced-motion，供转场/动效审查） */
if (location.search.includes('motion=force')) {
  const _mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => /prefers-reduced-motion/.test(q)
    ? { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
    : _mm(q);
}
</script>
${body.join('\n')}
<script type="module">
${js.join('\n')}
</script>
</body>
</html>`;
  return { html, log };
}

/* CLI：node compose.mjs <plan.json> <outDir> <title> */
if (process.argv[1] && process.argv[1].endsWith('compose.mjs')) {
  const [planFile, outDir, title] = process.argv.slice(2);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const { html, log } = compile(plan, { title });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.writeFileSync(path.join(outDir, 'compile-log.json'), JSON.stringify(log, null, 1));
  console.log('已编译 →', path.join(outDir, 'index.html'), '| 幕次:', log.scenes.length, '| 转场:', log.transitions.length, log.autoTransitions.length ? '| 自动补: ' + log.autoTransitions.join(',') : '');
}
