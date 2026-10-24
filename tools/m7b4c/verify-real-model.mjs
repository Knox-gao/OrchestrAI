#!/usr/bin/env node
/**
 * M7-B4D 真实模型验收入口（**默认不发起任何真实请求**）
 *
 * 安全模型（任务 A 的 10 个问题逐条对应）：
 *   Q1 无 --authorized → 在加载任何网关/密钥/网络之前退出（本文件顶层不 import llm.mjs）
 *   Q2 --authorized 是唯一授权门，且必须同时给 --llm（不允许隐式 auto）
 *   Q3 每主题最多 2 次请求（1 首请求 + 1 重试），由 assertRequestBudget 强制
 *   Q4 分类后不 retryable 的失败不再请求；预算按主题累计
 *   Q5 模型标识只来自 --llm；Base URL/协议/Key 由仓库既有 keys 机制在服务端解析
 *   Q6 所有落盘内容经 redactSecrets/redactString 脱敏
 *   Q7 原始输出 / 规范化计划 / brief / 检查结果 分别保存
 *   Q8 每次运行独立目录（时间戳+runId），绝不覆盖历史证据
 *   Q9 失败保留原始文本 + 分类 + 服务端 reason
 *   Q10 产物带 provenance 标记（stub / real-raw / human-corrected），不混淆
 *
 * 用法：
 *   node tools/m7b4c/verify-real-model.mjs                    # 只打印计划，退出码 2
 *   node tools/m7b4c/verify-real-model.mjs --authorized --llm custom:my-gw
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  PROTOCOL_VERSION, REQUIRED_THEMES, HELD_OUT_THEME, MAX_REQUESTS_PER_THEME,
  parseInvocationArgs, redactSecrets, redactString, assertRequestBudget,
  classifyFailure, makeRunDir, assessEvidenceCompleteness,
} from './real-model-guard.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const inv = parseInvocationArgs(process.argv.slice(2));

// 冻结的输入（协议的一部分；改动即视为新协议版本）
const FROZEN_THEMES = Object.freeze([
  { key: 'island', prompt: '做一个果冻质感的粉色热带小岛 diorama 网页，带可交互的 3D 场景，风格要求：方形地层底座、有厚度的岛体、棕榈、灯塔、木栈桥' },
  { key: 'village', prompt: '做一个山谷里微缩村落的网页，带可交互 3D 场景：梯田山丘、教堂钟楼、几栋民居、山道。不要做成海岛' },
  { key: 'dome', prompt: '做一个沙漠中玻璃温室营地的网页，带可交互 3D 场景：起伏沙丘、半透明穹顶温室、供水塔、补给箱' },
  // 保留主题：从未参与 prompt / 原语调参，用于检查泛化
  { key: HELD_OUT_THEME, prompt: '做一个夜间灯笼市集的网页，带可交互 3D 场景：石板街道、几排挂灯笼的木架、小摊、石桥。不要做成海岛或村落' },
]);

if (inv.dryRun) {
  console.log('=== M7-B4D 真实模型验收：未执行 ===');
  console.log('');
  if (inv.errors.length) {
    for (const e of inv.errors) console.log(`  ✖ ${e}`);
    console.log('');
  }
  console.log('本脚本默认**不发起任何真实模型请求**，且在授权前不加载网关、不读取密钥。');
  console.log('');
  console.log(`协议版本：${PROTOCOL_VERSION}`);
  console.log(`请求预算：每主题 ≤ ${MAX_REQUESTS_PER_THEME} 次（1 首请求 + 1 重试）`);
  console.log(`主题数：${FROZEN_THEMES.length}（含 1 个未参与调参的保留主题 "${HELD_OUT_THEME}"）`);
  console.log(`最坏情况请求数：${FROZEN_THEMES.length * MAX_REQUESTS_PER_THEME}`);
  console.log('费用风险：取决于你的模型单价；单次 maxTokens=10000');
  console.log('需要：--authorized 且明确指定 --llm（不接受隐式 auto）');
  console.log('');
  console.log('冻结输入：');
  for (const t of FROZEN_THEMES) console.log(`  [${t.key}] ${t.prompt}`);
  console.log('');
  console.log('授权后执行：');
  console.log('  node tools/m7b4c/verify-real-model.mjs --authorized --llm custom:<id>');
  console.log('');
  console.log('产出：docs/m7b4c-evidence/real-runs/<时间戳>-<runId>/（每次独立，不覆盖历史）');
  process.exit(2);
}

// ---------- 以下仅在明确授权后执行 ----------
const RUN_ID = crypto.randomBytes(4).toString('hex');
const RUN_DIR = makeRunDir(path.join(ROOT, 'docs', 'm7b4c-evidence', 'real-runs'), { runId: RUN_ID });
fs.mkdirSync(RUN_DIR, { recursive: true });

const PORT = 19980 + Math.floor(Math.random() * 40);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm7b4d-real-'));
console.log('=== 已授权，开始真实模型验收 ===');
console.log(`协议：${PROTOCOL_VERSION}  runId=${RUN_ID}`);
console.log(`模型：${inv.llm}`);
console.log(`证据目录：${path.relative(ROOT, RUN_DIR)}`);

const env = { ...process.env, PORT: String(PORT), ORCHESTRAI_PAGEPLAN: 'on' };
const { spawn } = await import('node:child_process');
const srv = spawn(process.execPath, ['index.mjs'], { cwd: path.join(ROOT, 'apps', 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
srv.stdout.on('data', (d) => (serverLog += d));
srv.stderr.on('data', (d) => (serverLog += d));
const API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requestCounts = {};
const manifest = {
  protocolVersion: PROTOCOL_VERSION,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  model: inv.llm,
  // provenance：本文件只记录 real-raw；stub / human-corrected 绝不能混入
  provenance: 'real-model-raw',
  viewport: { width: 1440, height: 900 },
  themes: {},
  requests: [],
  note: '真实模型调用，费用由用户承担。所有文本已经过脱敏。',
};

function writeJson(name, value) {
  fs.writeFileSync(path.join(RUN_DIR, name), JSON.stringify(redactSecrets(value), null, 2));
}
function writeText(name, text) {
  fs.writeFileSync(path.join(RUN_DIR, name), redactString(String(text ?? '')));
}

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/styles`)).ok) break; } catch {} await sleep(300); }

  for (const theme of FROZEN_THEMES) {
    console.log(`\n--- ${theme.key} ---`);
    requestCounts[theme.key] = 0;
    const startedAt = Date.now();
    let job = null;
    let lastFailure = null;

    for (let attempt = 1; attempt <= MAX_REQUESTS_PER_THEME; attempt++) {
      assertRequestBudget(requestCounts, theme.key, { perTheme: MAX_REQUESTS_PER_THEME });
      requestCounts[theme.key] += 1;
      manifest.requests.push({ theme: theme.key, attempt, at: new Date().toISOString() });

      const g = await fetch(`${API}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `real-${theme.key}`, sentence: theme.prompt, llm: inv.llm }),
      });
      const body = await g.json();
      if (!body.jobId) {
        lastFailure = { category: 'no_job', retryable: false, detail: JSON.stringify(body).slice(0, 200) };
        break;
      }
      for (let i = 0; i < 200; i++) { await sleep(1500); job = await (await fetch(`${API}/api/jobs/${body.jobId}`)).json(); if (job.status !== 'running') break; }

      const r = job?.result ?? {};
      const classified = classifyFailure({ status: job.status, failed: r.failed, blocked: r.blocked, reason: r.reason, error: job.error });
      lastFailure = classified;
      console.log(`  attempt ${attempt}: ${classified.category}${r.projectId ? ` project=${r.projectId}` : ''}`);
      if (classified.category === 'delivered' || !classified.retryable) break;
      if (attempt < MAX_REQUESTS_PER_THEME) console.log('  → 重试一次');
    }

    const entry = {
      theme: theme.key,
      prompt: theme.prompt,
      attempts: requestCounts[theme.key],
      elapsedMs: Date.now() - startedAt,
      status: job?.status ?? null,
      outcome: lastFailure?.category ?? 'unknown',
      detail: lastFailure?.detail ?? '',
      projectId: job?.result?.projectId ?? null,
      effectiveModel: job?.result?.projectId ? undefined : null,
    };

    const pid = entry.projectId;
    if (pid) {
      const dir = path.join(ROOT, 'workspaces', pid);

      // Q7：原始输出（模型未清洗文本）单独保存，不进 manifest
      try {
        const modelDir = path.join(dir, '_model');
        if (fs.existsSync(modelDir)) {
          for (const f of fs.readdirSync(modelDir)) {
            writeText(`raw-${theme.key}-${f}`, fs.readFileSync(path.join(modelDir, f), 'utf8'));
          }
        }
      } catch (e) { entry.rawCaptureError = String(e?.message ?? e).slice(0, 120); }

      // Q7：规范化计划 + brief + 检查结果
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
        entry.delivered = pj.delivered;
        const review = pj.pagePlan?.sceneReview ?? null;
        writeJson(`plan-${theme.key}.json`, {
          provenance: 'real-model-raw',
          pagePlan: pj.pagePlan ?? null,
          delivered: pj.delivered ?? null,
        });
        if (review) {
          writeJson(`brief-${theme.key}.json`, { provenance: 'real-model-raw', brief: review.brief ?? null, briefCheck: review.briefCheck ?? null });
          writeJson(`review-${theme.key}.json`, { provenance: 'real-model-raw', sceneReview: review });
          entry.sceneReview = { ok: review.ok, geometry: review.geometry, findings: review.findings?.length ?? 0 };
        }
        entry.completeness = assessEvidenceCompleteness({
          rawModelText: fs.existsSync(path.join(dir, '_model')) ? 'present' : '',
          normalizedPlan: pj.pagePlan ?? null,
          sceneBrief: review?.brief ?? null,
          sceneReview: review ?? null,
        });
      } catch (e) { entry.projectReadError = String(e?.message ?? e).slice(0, 120); }

      // 截图 + 运行时指标
      try {
        const { launchCdp } = await import(new URL('../../apps/server/cdp-viewport.mjs', import.meta.url).href);
        const cdp = await launchCdp({ edgeBin: process.env.RENDERCHECK_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 }, sessionId);
        const { pathToFileURL } = await import('node:url');
        await cdp.send('Page.navigate', { url: pathToFileURL(path.join(dir, 'index.html')).href }, sessionId);
        await cdp.waitEvent('Page.loadEventFired', sessionId, 12000);
        await sleep(3000);
        const cap = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sessionId);
        fs.writeFileSync(path.join(RUN_DIR, `shot-${theme.key}-full.png`), Buffer.from(cap.data, 'base64'));
        const st = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const r = document.querySelector('[data-pageplan-scene3d]');
            return {
              status: r?.dataset.scene3dStatus ?? null,
              metrics: r?.dataset.scene3dMetrics ? JSON.parse(r.dataset.scene3dMetrics) : null,
              subjectCoverage: r?.dataset.scene3dSubjectCoverage ? JSON.parse(r.dataset.scene3dSubjectCoverage) : null,
            };
          })()`,
          returnByValue: true,
        }, sessionId);
        entry.render = st.result.value;
        await cdp.send('Target.closeTarget', { targetId });
        await cdp.close();
      } catch (e) { entry.screenshotError = String(e?.message ?? e).slice(0, 160); }
    }

    manifest.themes[theme.key] = entry;
    writeJson('manifest.partial.json', manifest);   // 中途崩溃也留下已完成部分
  }
} catch (e) {
  manifest.aborted = String(e?.message ?? e).slice(0, 300);
} finally {
  try { srv.kill(); } catch {}
  writeText('server.log', serverLog);
  manifest.finishedAt = new Date().toISOString();
  manifest.totalRequests = Object.values(requestCounts).reduce((a, b) => a + b, 0);
  writeJson('manifest.json', manifest);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n=== 完成：${manifest.totalRequests} 次请求，汇总见 ${path.relative(ROOT, RUN_DIR)}/manifest.json ===`);
  console.log('workspaces 下的项目未删除（需用户确认后才能删除）');
}
