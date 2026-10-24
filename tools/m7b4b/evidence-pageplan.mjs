/**
 * M7-B4B 证据采集：跑一次真实管线（Stub 模型），把产物/截图/门禁证据固化到 docs/m7-b4b-evidence/。
 * 不调用真实模型，不使用真实 Key；结束后清理 workspaces 临时项目。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const EVID = path.join(ROOT, 'docs', 'm7-b4b-evidence');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4b-evid-'));
const PORT = 19950 + Math.floor(Math.random() * 40);
const KEYS = path.join(TMP, 'keys.json');
fs.mkdirSync(EVID, { recursive: true });

const PLAN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'plan-fixture.json'), 'utf8'));

const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(PLAN) } }] }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
fs.writeFileSync(KEYS, JSON.stringify({ custom: [{ id: 'stub', label: 'M7B4B Evidence Stub', baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, key: 'test-only-stub-key', model: 'stub' }] }));

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_KEYS_FILE: KEYS, ORCHESTRAI_PAGEPLAN: 'on' };
delete env.ORCHESTRAI_MANAGED_KEY;
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
const API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { generatedAt: new Date().toISOString(), note: 'Stub 模型 + 隔离密钥库；零真实模型调用' };
let projectId = null;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }
  const g = await fetch(`${API}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'evidence-jelly-island', sentence: '帮我做一个3d果冻质感的海上小岛网站，带岛上风物介绍', llm: 'custom:stub',
      choices: { style: 'neumorph-blossom', font: 'serif', direction: 'explore' } }),
  });
  const { jobId } = await g.json();
  let job = null;
  for (let i = 0; i < 120; i++) { await sleep(1500); job = await (await fetch(`${API}/api/jobs/${jobId}`)).json(); if (job.status !== 'running') break; }
  out.job = { status: job.status, phase: job.phase, error: job.error ?? null, result: job.result };
  projectId = job?.result?.projectId ?? null;

  if (projectId) {
    const dir = path.join(ROOT, 'workspaces', projectId);
    fs.cpSync(dir, path.join(EVID, 'site'), { recursive: true });
    out.project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
    out.events = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));

    // 渲染证据（桌面视口截图 + 指标）
    const { renderCheck } = await import(pathToFileURL(path.join(ROOT, 'apps', 'server', 'rendercheck.mjs')).href);
    const rc = await renderCheck({ wsDir: dir, label: 'evidence', outDir: path.join(EVID, 'rendercheck'), commit: 'stub-evidence' });
    out.rendercheck = rc.gate;
    for (const f of fs.readdirSync(path.join(EVID, 'rendercheck'))) {
      const src = path.join(EVID, 'rendercheck', f);
      if (f.endsWith('.png')) fs.copyFileSync(src, path.join(EVID, `desktop-${f}`));
    }

    // ZIP + 独立运行
    const exp = await fetch(`${API}/api/projects/${projectId}/export?fmt=zip`);
    if (exp.ok) {
      const buf = Buffer.from(await exp.arrayBuffer());
      const zp = path.join(EVID, 'delivery.zip');
      fs.writeFileSync(zp, buf);
      const unz = path.join(TMP, 'unz'); fs.mkdirSync(unz, { recursive: true });
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zp}' -DestinationPath '${unz}' -Force`], { stdio: 'pipe' });
      const rc2 = await renderCheck({ wsDir: unz, label: 'zip-independent', outDir: path.join(EVID, 'rendercheck-zip'), commit: 'stub-evidence' });
      out.zip = { bytes: buf.length, files: fs.readdirSync(unz), independentRun: rc2.gate };
    }
  }
  out.serverLog = log.slice(-1200);
  fs.writeFileSync(path.join(EVID, 'evidence.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ projectId, delivered: out.project?.delivered, gate: out.rendercheck?.status, zipRun: out.zip?.independentRun?.status }, null, 1));
} finally {
  try { srv.kill(); } catch {}
  stub.close(); await sleep(300);
  if (projectId) { const p = path.join(ROOT, 'workspaces', projectId); if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
  fs.rmSync(TMP, { recursive: true, force: true });
}
