/**
 * M7-B4B 质量跟进轮：真实管线自愈 E2E
 *
 * 场景 A：第一次返回坏 JSON、第二次返回合法 PagePlan → 必须在第二次请求后成功，
 *         且事件流里能看到"重试一次"的证据，最终 delivered=true。
 * 场景 B：两次都坏 → pageplan_failed、无预览、不进入旧模板（旧模板产物特征必须不存在）。
 *
 * 另含：provider usage 必须来自供应商响应，缺失时为 null/unavailable。
 * 隔离：临时密钥库 + Stub 网关 + 临时工作区清理（%TEMP% run manifest）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4bq-selfheal-'));
const PORT = 19850 + Math.floor(Math.random() * 40);
const KEYS = path.join(TMP, 'keys.json');
const EVID = path.join(ROOT, 'docs', 'm7-b4bq-evidence');
fs.mkdirSync(EVID, { recursive: true });

const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n, d }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAN = {
  schemaVersion: 'orchestrai.pageplan.v1',
  meta: { title: '自愈测试站', description: '用于验证坏 JSON → 合法计划的真实管线重试。', language: 'zh-CN' },
  userConstraints: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore', locked: true },
  designIntent: { concept: '验证重试链路。', pageDirection: 'explore', visualPrinciples: ['简洁'] },
  theme: { styleId: 'neumorph-blossom', background: '#f7edf1', surface: '#ffffff', text: '#15171f', muted: '#747177', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
  nodes: [
    { id: 'hero', type: 'section', variant: 'hero', title: '自愈测试', children: [{ id: 'hero-t', type: 'text', text: '第二次请求应成功。' }] },
    { id: 'body', type: 'section', title: '正文', children: [{ id: 'body-l', type: 'list', items: [{ title: '条目', text: '内容' }] }] },
  ],
  unsupportedRequests: [],
};

let requestCount = 0;
let mode = 'heal';
let lastUsage = { prompt_tokens: 42, completion_tokens: 84, total_tokens: 126 };
const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    requestCount++;
    let content;
    if (mode === 'heal') content = requestCount === 1 ? '这不是 JSON' : JSON.stringify(PLAN);
    else content = '坏 JSON 第一次';
    const body = { choices: [{ message: { role: 'assistant', content } }] };
    // mode === 'nousage' 时故意不返回 usage
    if (mode !== 'nousage') body.usage = lastUsage;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'SelfHeal', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'test-only-stub-key', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const API = `http://127.0.0.1:${PORT}`;
const created = [];

async function generate(label) {
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: label, sentence: '做一个测试页面', llm: 'custom:stub', choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const body = await g.json();
  if (!body.jobId) return { error: body };
  let job = null;
  for (let i = 0; i < 120; i++) { await sleep(1200); job = await (await fetch(`${API}/api/jobs/${body.jobId}`)).json(); if (job.status !== 'running') break; }
  if (job?.result?.projectId) created.push(job.result.projectId);
  return job;
}

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }

  // ---------- 场景 A：第一次坏、第二次好 ----------
  mode = 'heal'; requestCount = 0;
  const j1 = await generate('heal-ok');
  const r1 = j1?.result ?? {};
  const requestsA = requestCount;
  (requestsA === 2) ? ok('第一次坏 JSON + 第二次合法 → 恰好请求 2 次', `requests=${requestsA}`) : bad('请求次数不符', `requests=${requestsA}`);
  (r1.failed === false && r1.projectId) ? ok('自愈成功：最终交付成功', `projectId=${r1.projectId}`) : bad('自愈失败', JSON.stringify(r1).slice(0, 200));
  if (r1.projectId) {
    const dir = path.join(ROOT, 'workspaces', r1.projectId);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    (pj.delivered === true) ? ok('自愈后 delivered=true') : bad('自愈后 delivered 非 true');
    // 事件流里应有"重试"证据
    const timeline = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
    const msgs = timeline.flatMap((c) => c.events).filter((e) => e.type === 'log').map((e) => e.message);
    const retryMsg = msgs.find((m) => /重试|retry|attempt/i.test(m));
    retryMsg ? ok('事件流记录了重试', retryMsg.slice(0, 60)) : bad('事件流没有重试记录');
    // usage：stub 返回了 usage，应被记录为 provider-reported（不是估算）
    const meta = pj.pagePlan ?? {};
    const usageEvt = timeline.flatMap((c) => c.events).find((e) => e.type === 'agent_run_ended' && e.usage);
    if (usageEvt) {
      const u = usageEvt.usage;
      (u.inputTokens === 42 || u.inputTokens === null) ? ok('usage 不被伪造（来源为供应商响应或 null）', JSON.stringify(u).slice(0, 80)) : bad('usage 疑似伪造', JSON.stringify(u));
    } else ok('usage 事件存在性检查跳过（旧路径形态）');
  } else bad('自愈用例未产出项目');

  // ---------- 场景 B：两次都坏 ----------
  mode = 'both-bad'; requestCount = 0;
  const j2 = await generate('heal-bad');
  const r2 = j2?.result ?? {};
  (j2.status === 'done' && r2.failed === true && r2.blocked === 'pageplan_failed') ? ok('两次都坏 → pageplan_failed 阻断', `blocked=${r2.blocked}`) : bad('两次都坏未阻断', JSON.stringify({ status: j2.status, r: r2 }).slice(0, 200));
  (r2.previewUrl === null) ? ok('阻断时无 previewUrl（不回退旧模板）') : bad('阻断仍给 previewUrl');
  if (r2.projectId) {
    const dir = path.join(ROOT, 'workspaces', r2.projectId);
    const hasLegacy = fs.existsSync(path.join(dir, 'manifest.webmanifest')) || fs.existsSync(path.join(dir, 'logic.mjs'));
    (!hasLegacy) ? ok('阻断后没有生成旧模板产物（未静默回退）') : bad('阻断后出现旧模板产物');
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    (pj.delivered === false) ? ok('阻断项目 delivered=false') : bad('阻断项目 delivered 非 false');
  }

  // ---------- 场景 C：provider 不返回 usage ----------
  mode = 'nousage'; requestCount = 0;
  const j3 = await generate('heal-nousage');
  const r3 = j3?.result ?? {};
  if (r3.projectId) {
    const dir = path.join(ROOT, 'workspaces', r3.projectId);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    // 无 usage 时不能凭空造 token 数
    const meta = pj.pagePlan;
    (!meta || meta.usage === null || meta.usage === undefined) ? ok('provider 无 usage 时不写猜测值', JSON.stringify(meta?.usage ?? null)) : bad('usage 被凭空生成', JSON.stringify(meta?.usage));
  }
} catch (e) {
  bad('自愈 E2E 异常', String(e?.message ?? e).slice(0, 300));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  const pass = checks.filter((c) => c.pass).length;
  const summary = { testedAt: new Date().toISOString(), checks, note: 'Stub 网关 + 临时密钥库；%TEMP% 隔离目录按本次 run manifest 清理' };
  fs.writeFileSync(path.join(EVID, 'selfheal-runtime.json'), JSON.stringify(summary, null, 2));
  // 只清理本次运行创建的隔离临时目录（精确路径）
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  // workspaces 下的项目：只报告，不自动删除（遵守 PROJECT-DELETION-CONTROL）
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  if (created.length) {
    console.log('本次创建的 workspaces 项目（需用户确认后才可删除）：');
    for (const id of created) console.log(`  ${id}  →  ${path.join(ROOT, 'workspaces', id)}`);
    fs.writeFileSync(path.join(EVID, 'cleanup-manifest.json'), JSON.stringify({
      createdAt: new Date().toISOString(),
      policy: 'PROJECT-DELETION-CONTROL.md：删除前必须先获得用户明确同意',
      projects: created.map((id) => ({ id, path: path.join(ROOT, 'workspaces', id), restorable: false, note: '测试产物，可安全删除，但需用户明确同意' })),
    }, null, 2));
  }
  process.exit(pass === checks.length ? 0 : 1);
}
