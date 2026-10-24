/**
 * 零依赖本地服务（应用服务层 + 工具执行层雏形）：
 *   POST /api/generate {sentence} → 真实生成流水线，返回事件队列 + 预览地址
 *   GET  /preview/:id/...        → 静态服务生成的 App（工作区只读）
 *   GET  /api/health
 * 安全边界：只执行 `node --test`（白名单命令）；静态服务限制在 workspaces/ 内。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './pipeline.mjs';
import { preflight, choicesToDirective, choicesToParams } from './preflight.mjs';
import { zipSync } from './zip.mjs';
import { buildExport } from './packaging.mjs';
import { PROVIDERS, maskedKeys, setKey, deleteKey, addCustom, removeCustom, setCustomModel } from './keys.mjs';
import { pickGateway, chat, sanitizeForOutput } from './llm.mjs';
import { isSupported, extractText } from './docx.mjs';
import { CATALOG, STYLE_COUNT } from './generator/styles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKSPACES = path.join(ROOT, 'workspaces');
const PORT = Number(process.env.PORT ?? 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  // /preview/<id>/<rest> → workspaces/<id>/<rest>（禁止穿越）
  const rel = decodeURIComponent(urlPath.replace(/^\/preview\//, ''));
  const abs = path.normalize(path.join(WORKSPACES, rel));
  if (!abs.startsWith(WORKSPACES)) { res.writeHead(403); res.end('forbidden'); return; }
  let target = abs;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    target = path.join(abs, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const ext = path.extname(target).toLowerCase();
  const body = fs.readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function resolveDeletableProject(id) {
  if (typeof id !== 'string' || !/^P[A-Za-z0-9_-]{1,80}$/.test(id)) {
    return { error: 'invalid project id', status: 400 };
  }
  const root = path.resolve(WORKSPACES);
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== root) return { error: 'invalid project path', status: 400 };
  if (!fs.existsSync(dir)) return { error: 'project not found', status: 404 };
  const dirStat = fs.lstatSync(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return { error: 'project path is not a workspace directory', status: 400 };
  const metaPath = path.join(dir, 'project.json');
  if (!fs.existsSync(metaPath) || !fs.lstatSync(metaPath).isFile()) return { error: 'project metadata not found', status: 404 };
  return { dir };
}

function removeProjectAssetReferences(id) {
  const registry = path.join(WORKSPACES, '_assets');
  if (!fs.existsSync(registry)) return 0;
  const prefix = `${id}/`;
  let removed = 0;
  for (const entry of fs.readdirSync(registry, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') continue;
    const file = path.join(registry, entry.name);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!Array.isArray(manifest?.entries)) continue;
    const entries = manifest.entries.filter((asset) => {
      const source = String(asset?.src ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
      return !source.startsWith(prefix);
    });
    const removedFromManifest = manifest.entries.length - entries.length;
    if (!removedFromManifest) continue;
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ ...manifest, entries }, null, 1));
    fs.renameSync(temp, file);
    removed += removedFromManifest;
  }
  return removed;
}

function isLocalOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())
      && (protocol === 'http:' || protocol === 'https:');
  } catch { return false; }
}

const JOBS = new Map();
setInterval(() => { const cutoff = Date.now() - 3600_000; for (const [k, j] of JOBS) if (j.startedAt < cutoff) JOBS.delete(k); }, 600_000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, mode: 'real-generation', node: process.version });
    }
    if (req.method === 'GET' && url.pathname === '/api/keys') {
      return json(res, 200, maskedKeys());
    }
    if (req.method === 'PUT' && url.pathname === '/api/keys') {
      const raw = await readBody(req);
      const body = JSON.parse((raw.toString('utf-8') || '{}') || '{}');
      try {
        const masked = setKey(String(body.provider ?? ''), String(body.key ?? ''));
        return json(res, 200, { ok: true, provider: body.provider, masked });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }
    if (req.method === 'DELETE' && /^\/api\/keys\/[\w-]+$/.test(url.pathname)) {
      const id = url.pathname.split('/').pop();
      if (id.startsWith('c')) removeCustom(id); else deleteKey(id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/keys/test') {
      const body = JSON.parse(await readBody(req).then((b) => b.toString('utf-8')) || '{}');
      const pref = typeof body.llm === 'string' && body.llm ? body.llm : 'auto';
      const gw = pickGateway(pref);
      if (!gw) return json(res, 200, { ok: false, error: pref === 'rule' ? '规则识别（不调用模型）' : '未找到可用的模型网关（请先配置 Key）' });
      const t0 = Date.now();
      try {
        const reply = await chat(gw, [
          { role: 'user', content: '回复两个字：正常' },
        ], { maxTokens: 64, temperature: 0 });
        return json(res, 200, { ok: true, provider: gw.label ?? gw.provider, model: gw.model, ms: Date.now() - t0, reply: reply.slice(0, 30) });
      } catch (e) {
        return json(res, 200, { ok: false, provider: gw.label ?? gw.provider, model: gw.model, error: String(e?.message ?? e).slice(0, 200) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/keys/custom/model') {
      const body = JSON.parse(await readBody(req).then((b) => b.toString('utf-8')) || '{}');
      try {
        const model = setCustomModel(String(body.id ?? ''), String(body.model ?? ''));
        return json(res, 200, { ok: true, model });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/keys/custom') {
      const body = JSON.parse(await readBody(req).then((b) => b.toString('utf-8')) || '{}');
      try {
        const item = addCustom(body);
        return json(res, 200, { ok: true, item });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/projects') {
      const entries = fs.existsSync(WORKSPACES) ? fs.readdirSync(WORKSPACES, { withFileTypes: true }) : [];
      const projects = [];
      for (const d of entries) {
        if (!d.isDirectory()) continue;
        const metaPath = path.join(WORKSPACES, d.name, 'project.json');
        if (!fs.existsSync(metaPath)) continue;
        try { projects.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8'))); } catch {}
      }
      projects.sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, projects);
    }
    if (req.method === 'POST' && url.pathname === '/api/projects/delete') {
      const origin = req.headers.origin;
      if (origin && !isLocalOrigin(origin)) return json(res, 403, { error: 'project deletion is only available to the local app' });
      let body;
      try { body = JSON.parse(await readBody(req, 256 * 1024).then((b) => b.toString('utf-8')) || '{}'); }
      catch { return json(res, 400, { error: 'invalid JSON body' }); }
      if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 2000) {
        return json(res, 400, { error: 'ids must contain between 1 and 2000 project ids' });
      }
      const ids = [...new Set(body.ids)];
      const targets = ids.map((id) => ({ id, ...resolveDeletableProject(id) }));
      const invalid = targets.find((target) => target.error);
      if (invalid) return json(res, invalid.status, { error: `${invalid.id}: ${invalid.error}` });

      const deleted = [];
      let cleanedAssetRefs = 0;
      for (const target of targets) {
        try {
          fs.rmSync(target.dir, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
          deleted.push(target.id);
          try { cleanedAssetRefs += removeProjectAssetReferences(target.id); }
          catch (cleanupError) { console.warn(`[projects] removed ${target.id}, but could not clean asset references:`, cleanupError.message); }
        } catch (e) {
          return json(res, 500, {
            error: `删除 ${target.id} 失败：${String(e?.message ?? e).slice(0, 160)}`,
            deleted,
          });
        }
      }
      return json(res, 200, { ok: true, deleted, cleanedAssetRefs });
    }
    if (req.method === 'GET' && /^\/api\/projects\/[\w-]+$/.test(url.pathname)) {
      const id = url.pathname.split('/').pop();
      const dir = path.join(WORKSPACES, id);
      const metaPath = path.join(dir, 'project.json');
      if (!fs.existsSync(metaPath)) return json(res, 404, { error: 'project not found' });
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      let cues = [];
      try { cues = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf-8')); } catch {}
      return json(res, 200, { meta, cues });
    }
    if (req.method === 'GET' && /^\/api\/projects\/[\w-]+\/export$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-2);
      const fmt = url.searchParams.get('fmt') ?? 'zip';
      // 内测版范围：只交付桌面版网页（ZIP）。原生应用打包（exe/apk）不在内测版范围内。
      if (fmt === 'exe' || fmt === 'apk') {
        return json(res, 409, {
          error: '本版本只支持生成网页（桌面版），不提供 .exe / .apk 原生应用打包',
          supported: ['zip'],
        });
      }
      if (fmt !== 'zip') return json(res, 400, { error: 'fmt must be zip' });
      const dir = path.join(WORKSPACES, id);
      const metaPath = path.join(dir, 'project.json');
      if (!fs.existsSync(metaPath)) return json(res, 404, { error: 'project not found' });
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const zipBuf = zipSync(buildExport(fmt, meta, dir));
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': zipBuf.length,
        'Content-Disposition': `attachment; filename="${id}-${fmt}.zip"`,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(zipBuf);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/preview/')) {
      return serveStatic(req, res, url.pathname);
    }
    if (req.method === 'GET' && url.pathname === '/api/styles') {
      return json(res, 200, { count: STYLE_COUNT, styles: CATALOG });
    }
    if (req.method === 'POST' && url.pathname === '/api/requirements/parse') {
      const rawName = req.headers['x-filename'] ?? 'untitled.txt';
      const filename = decodeURIComponent(String(rawName));
      if (!isSupported(filename)) return json(res, 415, { error: '仅支持 .docx / .txt / .md' });
      const buf = await readBody(req, 8 * 1024 * 1024);
      if (buf.length === 0) return json(res, 400, { error: '文件为空' });
      try {
        const text = extractText(filename, buf);
        if (text.length > 50000) return json(res, 413, { error: '文档过长（>5 万字符），请精简后重试' });
        return json(res, 200, { filename, chars: text.length, text });
      } catch (e) {
        return json(res, 422, { error: `解析失败：${String(e?.message ?? e)}` });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/preflight') {
      const raw = await readBody(req);
      const body = JSON.parse((raw.toString('utf-8') || '{}') || '{}');
      const requirement = String(body.requirement ?? body.sentence ?? '').trim();
      if (!requirement) return json(res, 400, { error: 'requirement required' });
      const llm = typeof body.llm === 'string' && body.llm ? body.llm : 'auto';
      const r = await preflight(requirement.slice(0, 4000), llm);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const raw = await readBody(req);
      const body = JSON.parse((raw.toString('utf-8') || '{}') || '{}');
      const name = String(body.name ?? '').trim().slice(0, 60);
      const requirement = String(body.requirement ?? body.sentence ?? '').trim();
      if (!requirement) return json(res, 400, { error: 'requirement required' });
      if (requirement.length > 50000) return json(res, 400, { error: 'requirement too long' });
      const style = typeof body.style === 'string' && body.style ? body.style : undefined;
      const fx = typeof body.fx === 'string' && body.fx ? body.fx : undefined;
      const styleDescription = typeof body.styleDescription === 'string' ? body.styleDescription.trim().slice(0, 120) : undefined;
      const llm = typeof body.llm === 'string' && body.llm ? body.llm : 'auto';
      // 内测版：把用户在 preflight 中的选择并入需求（让模型知情）
      // + 转成参数硬约束（防止被关键词风格识别静默覆盖）
      const directive = choicesToDirective(body.choices);
      const requirementWithChoices = directive ? `${requirement}\n\n${directive}` : requirement;
      const choiceParams = choicesToParams(body.choices);
      // 可信调用方声明的必需需求 ID（决定 required coverage 是否阻断交付）。
      // 不做模糊匹配：必须是显式数组，且每项是稳定 ID 字符串。
      const requiredRequirementIds = Array.isArray(body.requiredRequirementIds)
        ? body.requiredRequirementIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)).slice(0, 20)
        : [];
      const jobId = 'J' + Date.now().toString(36).toUpperCase();
      const job = { id: jobId, status: 'running', phase: '排队中…', startedAt: Date.now(), result: null, error: null, choices: body.choices ?? null };
      JOBS.set(jobId, job);
      runPipeline(requirementWithChoices, style, fx, name || undefined, styleDescription, (phase) => { job.phase = phase; }, llm, choiceParams, requiredRequirementIds)
        .then((result) => { job.status = 'done'; job.phase = '完成'; job.result = result; })
        .catch((e) => {
          // 发布前审计高危项：堆栈与上游正文一律不经 API 暴露给客户端。
          // 堆栈只写服务端日志（便于本地排查），客户端只拿到脱敏后的短消息 + 稳定错误码。
          job.status = 'error';
          job.phase = '失败';
          job.errorCode = String(e?.code ?? 'INTERNAL_ERROR');
          job.error = sanitizeForOutput(e?.message, 240);
          console.error('[job-error]', job.id, job.errorCode, String(e?.stack ?? '').split('\n').slice(0, 6).join(' | '));
        });
      return json(res, 202, { jobId });
    }
    if (req.method === 'GET' && /^\/api\/jobs\/[\w-]+$/.test(url.pathname)) {
      const job = JOBS.get(url.pathname.split('/').pop());
      if (!job) return json(res, 404, { error: 'job not found' });
      return json(res, 200, {
        id: job.id, status: job.status, phase: job.phase,
        startedAt: job.startedAt, elapsedMs: Date.now() - job.startedAt,
        // 只返回稳定错误码 + 脱敏短消息；stack/上游响应正文仅留在服务端日志。
        errorCode: job.errorCode ?? null,
        error: job.error, result: job.status === 'done' ? job.result : null,
      });
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[orchestrai] real generation ready → http://127.0.0.1:${PORT} (node ${process.version})`);
});
