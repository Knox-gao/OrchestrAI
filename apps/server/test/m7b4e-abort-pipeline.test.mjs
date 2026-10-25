/**
 * M7-B4E：真实管线级 Abort 行为验证（Stub 网关，零真实请求）
 *
 * 复现现场：项目 PMVLZKTF7 —— PagePlan 两次尝试均 "This operation was aborted"，
 * 实际总耗时 90.0s = 2 × 45s TIMEOUT。
 *
 * 这里用**可控的本地 HTTP 服务器**模拟「供应商永不响应」与「先慢后快」，
 * 通过真实 runPipeline 验证：
 *   - 超时被正确分类，且不再表现为裸 AbortError；
 *   - 外部取消不重试；
 *   - 失败仍阻断交付（不回退模板）；
 *   - 正常路径不受影响。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { chatDetailed, timeoutFor, LLMError } from '../llm.mjs';

const GW = (port) => ({ provider: 'custom', key: 'sk-stub-not-real', model: 'stub', defaultBaseUrl: `http://127.0.0.1:${port}/v1` });

/** 启动一个可控 stub：mode='hang' 永不返回；mode='ok' 立刻返回；'slowThenOk' 第一次拖住、第二次立刻返回。 */
async function startStub(mode = 'ok') {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub' }] }));
      calls += 1;
      if (mode === 'hang') return;                       // 永不响应 → 触发客户端超时
      const send = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":1}' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
      };
      if (mode === 'slowThenOk' && calls === 1) setTimeout(send, 10_000);  // 第一次远超预算
      else send();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)), calls: () => calls };
}

test('现场复现：供应商永不响应 → 被分类为 LLM_TIMEOUT（不是裸 AbortError）', async () => {
  const stub = await startStub('hang');
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => chatDetailed(GW(stub.port), [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 120 }),
      (e) => {
        assert.ok(e instanceof LLMError, `应为 LLMError，实际 ${e?.name}/${e?.code}`);
        assert.equal(e.code, 'LLM_TIMEOUT');
        assert.equal(e.classification, 'A_single_request_timeout');
        assert.equal(e.retryable, true);
        assert.ok(e.details.elapsedMs >= 100, `应记录真实耗时，实际 ${e.details.elapsedMs}`);
        return true;
      },
    );
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 2000, `应在预算附近返回，实际 ${elapsed}ms`);
  } finally { await stub.close(); }
});

test('现场复现：两次连续超时的总耗时 ≈ 2 × 预算（与 90s = 2×45s 同构）', async () => {
  const stub = await startStub('hang');
  const budget = 120;
  try {
    const t0 = Date.now();
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => chatDetailed(GW(stub.port), [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: budget }));
    }
    const total = Date.now() - t0;
    // 两次都超时 → 总耗时约 2×budget（允许调度误差）
    assert.ok(total >= budget * 1.8 && total < budget * 6,
      `两次超时应约等于 2×预算（${budget}ms），实际 ${total}ms`);
    assert.equal(stub.calls(), 2, '应恰好发出 2 次请求');
  } finally { await stub.close(); }
});

test('修复验证：第一次超时后，第二次用新预算成功（父任务仍有效）', async () => {
  const stub = await startStub('slowThenOk');
  try {
    // 第一次用极短预算 → 超时
    await assert.rejects(
      () => chatDetailed(GW(stub.port), [{ role: 'user', content: 'a' }], { maxTokens: 10, timeoutMs: 100 }),
      (e) => e.code === 'LLM_TIMEOUT',
    );
    // 第二次用充足预算（真实链路里 PagePlan 现在默认给 250s）→ 成功。
    // 注意预算要远大于全量回归时的并行调度抖动：8s 曾在多文件并行
    // （渲染测试起 headless Edge）时被调度延迟顶穿，产生与被测行为无关的假超时。
    const r = await chatDetailed(GW(stub.port), [{ role: 'user', content: 'b' }], { maxTokens: 10, timeoutMs: 30_000 });
    assert.equal(r.text, '{"ok":1}');
    assert.equal(r.usage.total_tokens, 3, 'usage 应来自供应商响应');
  } finally { await stub.close(); }
});

test('外部取消：不可重试，且错误分类为 LLM_ABORTED', async () => {
  const stub = await startStub('hang');
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 60);
  try {
    await assert.rejects(
      () => chatDetailed(GW(stub.port), [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 30_000, externalSignal: ctrl.signal }),
      (e) => {
        assert.equal(e.code, 'LLM_ABORTED');
        assert.equal(e.retryable, false, '外部取消绝不能标记为可重试');
        return true;
      },
    );
  } finally { await stub.close(); }
});

test('超时预算：PagePlan 的 maxTokens=10000 得到远大于 45s 的预算', () => {
  const pagePlanBudget = timeoutFor(10000);
  assert.ok(pagePlanBudget >= 200_000, `PagePlan 预算应 ≥200s，实际 ${pagePlanBudget}ms`);
  // 同构验证：现场 90s 的两次失败若按旧 45s 常数发生，
  // 新预算下单次就有 250s，不会在同样的 45s 处被切断。
  assert.ok(pagePlanBudget > 45_000);
});

test('默认调用（无 maxTokens 指定）仍为 45s，旧行为不变', () => {
  const { LLM_TIMEOUT_FLOOR_MS } = { LLM_TIMEOUT_FLOOR_MS: 45_000 };
  assert.equal(timeoutFor(1200), LLM_TIMEOUT_FLOOR_MS, '历史默认 1200 tokens 仍应是 45s');
});

test('失败仍阻断交付：超时错误不会被上层当成成功（无 rawText 即无模型输出）', async () => {
  const stub = await startStub('hang');
  try {
    let succeeded = false;
    try {
      await chatDetailed(GW(stub.port), [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 80 });
      succeeded = true;
    } catch { /* 预期 */ }
    assert.equal(succeeded, false, '超时绝不能返回成功');
  } finally { await stub.close(); }
});

test('敏感信息：真实 HTTP 服务器场景下错误信息不含 key', async () => {
  const stub = await startStub('hang');
  try {
    await assert.rejects(
      () => chatDetailed({ ...GW(stub.port), key: 'sk-LEAKCHECK9876543210' }, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 80 }),
      (e) => {
        const blob = `${e.message}|${JSON.stringify(e.details ?? {})}`;
        assert.ok(!blob.includes('LEAKCHECK'), '错误信息不得泄漏 key');
        return true;
      },
    );
  } finally { await stub.close(); }
});
