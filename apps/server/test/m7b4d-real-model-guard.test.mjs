/**
 * M7-B4D 任务 A：真实模型验收入口安全审计（合成数据，零真实请求）
 *
 * 覆盖 M7-B4D 任务书任务 A 的 10 个问题中可自动化的部分：
 *   - 无授权安全退出（不加载网关/不读密钥/不发请求）
 *   - 授权是唯一门，且必须显式指定模型
 *   - 请求预算上限
 *   - 失败分类正确（retryable 才重试）
 *   - 脱敏（密钥/Authorization/URL 查询参数）
 *   - 证据目录唯一性（不覆盖历史）
 *   - 证据完整性
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROTOCOL_VERSION, MAX_REQUESTS_PER_THEME, REQUIRED_THEMES, HELD_OUT_THEME,
  parseInvocationArgs, redactSecrets, redactString, assertRequestBudget,
  classifyFailure, makeRunDir, assessEvidenceCompleteness,
} from '../../../tools/m7b4c/real-model-guard.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const ENTRY = path.join(ROOT, 'tools', 'm7b4c', 'verify-real-model.mjs');

/** 用子进程跑入口，返回 {code, out}。绝不触发真实请求：这些参数组合都应被拒绝。 */
function runEntry(args) {
  try {
    const out = execFileSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// ---------------- Q1 / Q2：授权门 ----------------

test('Q1/Q2 无 --authorized → 退出码 2，且打印"未执行"', () => {
  const r = runEntry([]);
  assert.equal(r.code, 2, '无授权必须退出码 2');
  assert.match(r.out, /未执行/);
  assert.match(r.out, /不发起任何真实模型请求/);
});

test('Q2 --authorized 但缺 --llm → 拒绝（不允许隐式 auto 网关）', () => {
  const r = runEntry(['--authorized']);
  assert.equal(r.code, 2);
  assert.match(r.out, /拒绝使用隐式 auto 网关/);
});

test('Q2 只给 --llm 不给 --authorized → 仍然拒绝', () => {
  const r = runEntry(['--llm', 'custom:whatever']);
  assert.equal(r.code, 2);
  assert.match(r.out, /未执行/);
});

test('Q2 --dry-run 即使带 --authorized --llm 也不执行', () => {
  const r = runEntry(['--authorized', '--llm', 'custom:x', '--dry-run']);
  assert.equal(r.code, 2);
  assert.match(r.out, /未执行/);
});

test('Q2 --llm 后面没有值 → 视为错误', () => {
  const inv = parseInvocationArgs(['--authorized', '--llm']);
  assert.equal(inv.dryRun, true);
  assert.ok(inv.errors.some((e) => e.includes('--llm')));
});

test('Q1 入口文件顶层没有导入任何网关/密钥模块', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(ENTRY, 'utf8');
  const topImports = [...src.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
  const forbidden = topImports.filter((p) => /llm\.mjs|keys\.mjs|keys\.json/.test(p));
  assert.equal(forbidden.length, 0, `顶层不得导入网关/密钥：${forbidden.join(',')}`);
  // 网关相关模块只能在授权分支内动态 import
  assert.match(src, /await import\(/, '授权后应使用动态 import 加载 CDP 等');
});

// ---------------- Q3 / Q4：请求预算 ----------------

test('Q3 每主题预算为 2（1 首请求 + 1 重试）', () => {
  assert.equal(MAX_REQUESTS_PER_THEME, 2);
});

test('Q3/Q4 达到上限后再请求 → 抛 REQUEST_BUDGET_EXCEEDED', () => {
  const counts = { island: MAX_REQUESTS_PER_THEME };
  assert.throws(() => assertRequestBudget(counts, 'island'), (e) => e.code === 'REQUEST_BUDGET_EXCEEDED');
  assert.doesNotThrow(() => assertRequestBudget({ island: 1 }, 'island'));
});

test('Q3 全局预算也能拦住', () => {
  assert.throws(
    () => assertRequestBudget({ a: 2, b: 2 }, 'c', { perTheme: 2, totalLimit: 4 }),
    (e) => e.code === 'GLOBAL_BUDGET_EXCEEDED',
  );
});

test('Q4 只有 retryable 的失败才允许重试', () => {
  const cases = [
    [{ status: 'done', failed: true, blocked: 'pageplan_failed', reason: 'MODEL_NOT_JSON' }, 'invalid_json', true],
    [{ status: 'done', failed: true, blocked: 'pageplan_failed', reason: 'MODEL_INVALID_JSON: bad' }, 'invalid_json', true],
    [{ status: 'done', failed: true, blocked: 'pageplan_failed', reason: 'PAGEPLAN_BLOCKED: 3D 不支持' }, 'model_declared_blocking', false],
    [{ status: 'done', failed: true, blocked: 'scene_brief_mismatch', reason: 'x' }, 'brief_mismatch', false],
    [{ status: 'done', failed: true, blocked: 'asset_unresolved', reason: 'x' }, 'asset_unresolved', false],
    [{ status: 'done', failed: true, blocked: 'model_required', reason: 'x' }, 'no_model_configured', false],
    [{ status: 'done', failed: false }, 'delivered', false],
  ];
  for (const [input, category, retryable] of cases) {
    const r = classifyFailure(input);
    assert.equal(r.category, category, `分类错误：${JSON.stringify(input)} → ${r.category}`);
    assert.equal(r.retryable, retryable, `retryable 错误：${category}`);
  }
});

test('Q4 交付成功不算失败（不应触发重试）', () => {
  const r = classifyFailure({ status: 'done', failed: false });
  assert.equal(r.category, 'delivered');
  assert.equal(r.retryable, false);
});

// ---------------- Q6：脱敏 ----------------

test('Q6 Authorization Bearer 被脱敏', () => {
  const out = redactString('Authorization: Bearer sk-test-bearer-value');
  assert.ok(!out.includes('bearer-value'), out);
  assert.match(out, /\[REDACTED\]/);
});

test('Q6 常见 key 形态被脱敏', () => {
  assert.ok(!redactString('sk-test-plain-key').includes('1234567890abcdef'));
  assert.match(redactString('sk-test-plain-key'), /sk-\[REDACTED\]/);
});

test('Q6 URL 查询参数中的 key/token 被脱敏', () => {
  const out = redactString('https://api.example.com/v1?key=sk-test-query&model=x&access_token=sk-test-token');
  assert.ok(!out.includes('test-query'), out);
  assert.ok(!out.includes('test-token'), out);
  assert.match(out, /model=x/, '非敏感参数应保留');
});

test('Q6 URL 中的 user:pass@host 被脱敏', () => {
  const out = redactString('https://user:sk-test-password@api.example.com/v1');
  assert.ok(!out.includes('test-password'), out);
});

test('Q6 对象脱敏：敏感键名替换，正常字段保留', () => {
  const out = redactSecrets({
    apiKey: 'sk-test-object-key',
    headers: { Authorization: 'Bearer sk-test-header' },
    model: 'glm-4',
    nested: { token: 'sk-test-nested', keep: 'ok' },
    list: [{ key: 'sk-test-list' }, { keep: 'v' }],
  });
  assert.equal(out.apiKey, '[REDACTED]');
  assert.equal(out.headers.Authorization, '[REDACTED]');
  assert.equal(out.model, 'glm-4');
  assert.equal(out.nested.token, '[REDACTED]');
  assert.equal(out.nested.keep, 'ok');
  assert.equal(out.list[0].key, '[REDACTED]');
  assert.equal(out.list[1].keep, 'v');
});

test('Q6 循环引用不炸（返回占位而非栈溢出）', () => {
  const o = { name: 'x' };
  o.self = o;
  const out = redactSecrets(o);
  assert.equal(out.self, '[CIRCULAR]');
});

// ---------------- Q8：证据目录唯一性 ----------------

test('Q8 同一时刻不同 runId → 不同目录（不覆盖历史）', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const a = makeRunDir('docs/m7b4c-evidence/real-runs', { runId: 'aaaaaa', now });
  const b = makeRunDir('docs/m7b4c-evidence/real-runs', { runId: 'bbbbbb', now });
  assert.notEqual(a, b);
  assert.match(a, /20261024-100000-aaaaaa$/);
});

test('Q8 runId 不合法 → 拒绝（防止路径注入）', () => {
  assert.throws(() => makeRunDir('docs/x', { runId: '../../evil' }), TypeError);
  assert.throws(() => makeRunDir('docs/x', { runId: 'a' }), TypeError);
});

// ---------------- Q7 / Q9 / Q10：证据完整性 ----------------

test('Q7 证据缺任一项即判定不完整', () => {
  const full = { rawModelText: 'x', normalizedPlan: {}, sceneBrief: {}, sceneReview: {} };
  assert.equal(assessEvidenceCompleteness(full).complete, true);
  for (const key of ['rawModelText', 'normalizedPlan', 'sceneBrief', 'sceneReview']) {
    const partial = { ...full, [key]: null };
    const r = assessEvidenceCompleteness(partial);
    assert.equal(r.complete, false, `缺 ${key} 应不完整`);
    assert.ok(r.missing.includes(key));
  }
});

test('Q9/Q10 协议常量：三个既有主题 + 一个保留主题', () => {
  assert.deepEqual([...REQUIRED_THEMES], ['island', 'village', 'dome']);
  assert.equal(HELD_OUT_THEME, 'lantern-market');
  assert.equal(PROTOCOL_VERSION, 'm7b4d-real-model.v1');
});

test('Q10 入口声明 provenance 区分（real-model-raw）', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(ENTRY, 'utf8');
  assert.match(src, /provenance:\s*'real-model-raw'/, '必须显式标注真实模型原始产物');
  // 不得把 stub 产物混入真实运行目录
  assert.doesNotMatch(src, /provenance:\s*'stub'/, '真实运行不应产生 stub provenance');
});
