/**
 * M7-B4B 回归：PagePlan 关闭时，旧模板路径必须完全不变。
 * 用法：node verify-legacy.mjs
 * 隔离：临时密钥库 + Stub 模型（返回合法的"意图 JSON"）+ 临时工作区清理。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4b-legacy-'));
const PORT = 19800 + Math.floor(Math.random() * 100);
const KEYS = path.join(TMP, 'keys.json');

// 旧路径需要"意图 JSON"，供 intent.mjs 解析成 landing/todo 等模板
const INTENT = {
  type: 'landing',
  title: '果冻海岛手册',
  subject: '果冻海岛',
  features: ['浏览岛上风物', '查看地标介绍', '按年份浏览纪年'],
  design: { desc: '柔和的粉调表面与大留白章节节奏' },
};

const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(INTENT) } }] }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'Legacy Stub', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'test-only-stub-key', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS };
delete env.ORCHESTRAI_PAGEPLAN;   // 关键：默认关闭
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const ok = (n, d = '') => { checks.push({ pass: true, n }); console.log(`✔ ${n}${d ? '  ' + d : ''}`); };
const bad = (n, d = '') => { checks.push({ pass: false, n, d }); console.log(`✖ ${n}  ${d}`); };
const created = [];

try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) { up = true; break; } } catch {} await sleep(300); }
  if (!up) throw new Error('服务未启动: ' + log.slice(0, 400));
  ok('隔离服务启动（ORCHESTRAI_PAGEPLAN 未设置）');

  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'legacy-landing', sentence: '做一个果冻质感的海岛介绍页面，带岛上风物介绍', llm: 'custom:stub' }),
  });
  const body = await g.json();
  if (!body.jobId) throw new Error('no jobId: ' + JSON.stringify(body));
  let job = null;
  for (let i = 0; i < 120; i++) { await sleep(1500); job = await (await fetch(`${API}/api/jobs/${body.jobId}`)).json(); if (job.status !== 'running') break; }
  const r = job?.result ?? {};
  if (r.projectId) created.push(r.projectId);
  if (job.status === 'done' && r.failed === false) ok('旧模板路径仍可交付', `projectId=${r.projectId}`); else bad('旧模板路径失败', JSON.stringify({ status: job.status, error: job.error, r }).slice(0, 300));

  if (r.projectId) {
    const dir = path.join(ROOT, 'workspaces', r.projectId);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    pj.delivered === true ? ok('旧路径 delivered=true') : bad('旧路径 delivered 非 true');
    // 旧模板契约必须仍在：PWA 清单 / SW / 图标 / 逻辑测试
    const legacy = ['index.html', 'style.css', 'app.mjs', 'logic.mjs', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png'];
    const missing = legacy.filter((f) => !fs.existsSync(path.join(dir, f)));
    missing.length === 0 ? ok('旧模板产物结构完整（PWA 契约）') : bad('旧模板产物缺文件', missing.join(','));
    // 必须没有任何 PagePlan 痕迹
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const ppTrace = html.includes('--pp-bg') || html.includes('pp-section') || pj.typeName === 'PagePlan';
    !ppTrace ? ok('旧路径未混入 PagePlan 渲染痕迹') : bad('旧路径被 PagePlan 污染');
    // 用户没做选择时不应写入锁定选择
    (pj.userChoices ?? null) === null ? ok('未做选择时 userChoices 为空（无伪造锁定）') : bad('userChoices 意外非空', JSON.stringify(pj.userChoices));
  }
} catch (e) {
  bad('异常', String(e?.message ?? e).slice(0, 300));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n=== ${pass}/${checks.length} 通过 ===`);
  for (const id of created) { const p = path.join(ROOT, 'workspaces', id); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  console.log('已清理:', created.join(', ') || '(无)');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(pass === checks.length ? 0 : 1);
}
