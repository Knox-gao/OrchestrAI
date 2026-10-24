/**
 * M7-B4C：三主题 Stub 全链 E2E
 *
 * 验证（全部使用 Stub 网关，零真实模型调用）：
 *   1) 带 sceneBrief 的计划能通过 schema 并进入真实管线
 *   2) 管线产出真实 HTML（含 3D 场景）
 *   3) 事件流含真实的创作阶段（理解需求 → 创作规划 → 渲染检查）
 *   4) Scene Brief 与场景交叉校验生效（不一致时阻断）
 *   5) 三个不同主题都能成立，不是"全部套岛屿模板"
 *   6) requirement_hints 改名后不再出现旧名称，且不阻断
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'm7b4c-evidence');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4c-stub-'));
const PORT = 19900 + Math.floor(Math.random() * 40);
const KEYS = path.join(TMP, 'keys.json');
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const themes = {};
for (const name of ['island', 'village', 'dome']) {
  themes[name] = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'm7b4c-themes', `${name}.json`), 'utf8'));
}

// 故意不一致的计划：brief 声明的对象不在场景里 → 必须阻断
const mismatchPlan = (() => {
  const p = structuredClone(themes.island);
  p.sceneBrief.objects.push({ id: 'ghost-object', role: 'accent', scaleHint: 'small', layer: 'foreground', relation: '本应存在但被删除' });
  return p;
})();

let currentPlan = themes.island;
const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(currentPlan) } }],
      usage: { prompt_tokens: 120, completion_tokens: 900, total_tokens: 1020 },
    }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'M7B4C Stub', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'sk-m7b4c-stub', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const API = `http://127.0.0.1:${PORT}`;
const created = [];

async function generate(label) {
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: label, sentence: '做一个 3D 场景网页', llm: 'custom:stub', choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const body = await g.json();
  if (!body.jobId) return { error: body };
  let job = null;
  for (let i = 0; i < 160; i++) { await sleep(1400); job = await (await fetch(`${API}/api/jobs/${body.jobId}`)).json(); if (job.status !== 'running') break; }
  if (job?.result?.projectId) created.push(job.result.projectId);
  return job;
}

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }

  // ---- 三主题 ----
  for (const name of ['island', 'village', 'dome']) {
    currentPlan = themes[name];
    const job = await generate(`m7b4c-${name}`);
    const r = job?.result ?? {};
    (job.status === 'done' && r.failed === false && r.projectId)
      ? ok(`[${name}] 管线交付成功`, `projectId=${r.projectId}`)
      : bad(`[${name}] 管线失败`, JSON.stringify({ s: job.status, e: job.error, r: r.blocked ?? r.reason }).slice(0, 220));
    if (!r.projectId) continue;

    const dir = path.join(ROOT, 'workspaces', r.projectId);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    const review = pj.pagePlan?.sceneReview ?? null;
    review ? ok(`[${name}] 记录了 sceneReview`, `ok=${review.ok} 复合原语=${review.geometry?.compositeRatio} 材质=${review.geometry?.materials?.length}`) : bad(`[${name}] 缺 sceneReview`);
    (review?.brief != null) ? ok(`[${name}] 模型 brief 被接受并落盘`, `主体=${review.brief.subject?.id}`) : bad(`[${name}] 缺 sceneBrief`);
    (review?.ok === true) ? ok(`[${name}] brief 与场景一致`) : bad(`[${name}] brief 与场景不一致`, JSON.stringify(review?.findings ?? []).slice(0, 160));

    // 事件流：真实阶段
    const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    const evts = tl.flatMap((c) => c.events);
    const logs = evts.filter((e) => e.type === 'log').map((e) => e.message);
    const hasBriefLog = logs.some((m) => m.includes('Scene Brief'));
    const hasGeoLog = logs.some((m) => m.includes('几何检查'));
    hasBriefLog ? ok(`[${name}] 事件流含 Scene Brief 阶段`) : bad(`[${name}] 缺 Scene Brief 阶段`);
    hasGeoLog ? ok(`[${name}] 事件流含几何检查阶段`) : bad(`[${name}] 缺几何检查阶段`);

    // 门禁名：新名存在、旧名不存在
    const gates = evts.filter((e) => e.type === 'gate_result').map((e) => e.gate);
    (gates.includes('scene_brief')) ? ok(`[${name}] scene_brief 门禁存在`) : bad(`[${name}] 缺 scene_brief 门禁`);
    (gates.includes('requirement_hints')) ? ok(`[${name}] requirement_hints 门禁存在（改名生效）`) : bad(`[${name}] 缺 requirement_hints`);
    (!gates.includes('requirement_coverage')) ? ok(`[${name}] 旧名 requirement_coverage 已不再出现`) : bad(`[${name}] 旧名仍在`);

    // 产物确实含 3D
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    html.includes('data-pageplan-scene3d') ? ok(`[${name}] 产物含 3D 场景`) : bad(`[${name}] 产物缺 3D`);
    // 三个主题的对象/形状必须不同（不是同一模板）
    const cfg = html.match(/<template[^>]*data-scene3d-config[^>]*>([\s\S]*?)<\/template>/i);
    if (cfg) {
      const scene = JSON.parse(cfg[1]);
      const shapeSet = [...new Set(scene.objects.map((o) => o.shape))].sort();
      fs.writeFileSync(path.join(OUT, `stub-${name}-scene-signature.json`), JSON.stringify({ objects: scene.objects.length, shapes: shapeSet, ids: scene.objects.map((o) => o.id) }, null, 2));
      ok(`[${name}] 场景结构已记录`, `${scene.objects.length} 对象 / ${shapeSet.length} 种形状`);
    }
  }

  // ---- 主题差异断言：三个主题的 shape 组合不能完全一样 ----
  const sigs = ['island', 'village', 'dome'].map((n) => {
    const f = path.join(OUT, `stub-${n}-scene-signature.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).shapes.join(',') : null;
  }).filter(Boolean);
  (new Set(sigs).size >= 2) ? ok('三个主题的场景构成不完全相同', `不同签名数=${new Set(sigs).size}`) : bad('三主题场景构成相同（疑似套模板）', JSON.stringify(sigs));

  // ---- brief 不一致 → 阻断 ----
  currentPlan = mismatchPlan;
  const jm = await generate('m7b4c-mismatch');
  const rm = jm?.result ?? {};
  (rm.failed === true && rm.blocked === 'scene_brief_mismatch')
    ? ok('brief 与场景不一致 → 阻断交付', `blocked=${rm.blocked}`)
    : bad('brief 不一致未阻断', JSON.stringify({ failed: rm.failed, blocked: rm.blocked, reason: rm.reason }).slice(0, 220));
  (rm.previewUrl === null) ? ok('阻断时无 previewUrl') : bad('阻断仍给预览');
} catch (e) {
  bad('E2E 异常', String(e?.message ?? e).slice(0, 300));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  const pass = checks.filter((c) => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stub-e2e-summary.json'), JSON.stringify({
    testedAt: new Date().toISOString(),
    note: 'Stub 网关 + 临时密钥库；零真实模型调用。这些结果只证明管线与校验成立，不代表真实模型创作能力。',
    checks,
  }, null, 2));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  if (created.length) {
    console.log('\n本次创建的 workspaces 项目（删除需用户明确同意）：');
    for (const id of created) console.log(`  ${id}  →  ${path.join(ROOT, 'workspaces', id)}`);
  }
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  process.exit(pass === checks.length ? 0 : 1);
}
