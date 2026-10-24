/**
 * M7-B4E：PagePlan 连续 Abort 故障复现与修复验证
 *
 * 真实故障（项目 PMVLZKTF7，2026-10-24 13:56:50 → 13:58:20）：
 *   - 两次尝试均失败：code=20（DOMException.ABORT_ERR）/ "This operation was aborted"
 *   - 实际总耗时 90.0s = 2 × 45s = 2 × llm.mjs 的 TIMEOUT
 *   - workspaces/<id>/_model/ 不存在 → 从未收到响应体
 *
 * 本文件先复现、再锁定修复后的行为。全部使用 mock fetch，零真实请求。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chatDetailed, chat, timeoutFor, LLMError,
  LLM_TIMEOUT_FLOOR_MS, LLM_TIMEOUT_PER_TOKEN_MS,
} from '../llm.mjs';

const GW = { provider: 'custom', key: 'sk-fake-for-test-only', model: 'stub-model', defaultBaseUrl: 'http://127.0.0.1:1/v1' };

/** 用可控 fetch 替换全局，返回 restore()。 */
function mockFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

/** 造一个"永不 resolve、只响应 abort"的 fetch，模拟供应商不返回。 */
function hangingFetch({ onAbort } = {}) {
  return (url, opts) => new Promise((resolve, reject) => {
    const signal = opts?.signal;
    const rejectAbort = () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      err.code = 20;                       // DOMException.ABORT_ERR（与真实日志一致）
      onAbort?.({ abortedAt: Date.now(), reason: signal?.reason });
      reject(err);
    };
    if (signal?.aborted) return rejectAbort();
    signal?.addEventListener('abort', rejectAbort, { once: true });
  });
}

function okFetch(content, usage = null) {
  return async () => ({
    ok: true,
    status: 200,
    url: 'http://127.0.0.1:1/v1/chat/completions',
    headers: new Map([['content-type', 'application/json']]),
    json: async () => ({ choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) }),
    text: async () => content,
  });
}

// ============ 1. 超时必须随 maxTokens 放大（根因修复的核心）============

test('1. 超时预算随 maxTokens 线性放大，且小请求保持原有 45s 下限', () => {
  // 小请求（历史默认 1200 tokens）应保持 45s，不改变既有行为
  assert.equal(timeoutFor(1200), LLM_TIMEOUT_FLOOR_MS);
  // PagePlan 用 maxTokens=10000，必须显著大于 45s
  const big = timeoutFor(10000);
  assert.ok(big > LLM_TIMEOUT_FLOOR_MS * 3,
    `10k tokens 的超时应远大于 45s，实际 ${big}ms`);
  assert.equal(big, Math.ceil(10000 * LLM_TIMEOUT_PER_TOKEN_MS));
  // 单调递增
  assert.ok(timeoutFor(20000) > timeoutFor(10000));
  // 非法输入退回下限
  for (const bad of [0, -1, NaN, undefined, null]) assert.equal(timeoutFor(bad), LLM_TIMEOUT_FLOOR_MS);
});

test('1b. 环境变量 ORCHESTRAI_LLM_TIMEOUT_MS 可覆盖（便于现场调参，不写死代码）', () => {
  const prev = process.env.ORCHESTRAI_LLM_TIMEOUT_MS;
  process.env.ORCHESTRAI_LLM_TIMEOUT_MS = '123456';
  try {
    assert.equal(timeoutFor(10000), 123456);
  } finally {
    if (prev === undefined) delete process.env.ORCHESTRAI_LLM_TIMEOUT_MS;
    else process.env.ORCHESTRAI_LLM_TIMEOUT_MS = prev;
  }
});

// ============ 2. 超时被正确分类，而不是 origin 不明的 code 20 ============

test('2. 请求超时 → 抛 LLMError(code=LLM_TIMEOUT)，不是裸 AbortError', async () => {
  const restore = mockFetch(hangingFetch());
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 60 }),
      (e) => {
        assert.ok(e instanceof LLMError, `应为 LLMError，实际 ${e?.name}`);
        assert.equal(e.code, 'LLM_TIMEOUT');
        assert.equal(e.classification, 'A_single_request_timeout');
        assert.equal(e.retryable, true, '超时是瞬时故障，允许重试');
        assert.equal(e.details.timedOut, true);
        assert.ok(e.details.elapsedMs >= 40);
        assert.match(e.message, /超时/);
        return true;
      },
    );
  } finally { restore(); }
});

test('2b. 外部取消（非超时）→ 分类为 LLM_ABORTED，且标记不可重试', async () => {
  const restore = mockFetch((url, opts) => new Promise((resolve, reject) => {
    // 200ms 后模拟"外部原因"中止（这里用 reason 区分）
    const t = setTimeout(() => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError'; err.code = 20;
      reject(err);
    }, 30);
    opts?.signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('This operation was aborted'); e.name = 'AbortError'; e.code = 20; reject(e); }, { once: true });
  }));
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 5000, externalSignal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 30); return c.signal; })() }),
      (e) => {
        assert.equal(e.code, 'LLM_ABORTED');
        assert.equal(e.classification, 'B_or_C_external_cancel');
        assert.equal(e.retryable, false, '外部取消不得自动重试');
        return true;
      },
    );
  } finally { restore(); }
});

// ============ 3. 重试不复用已取消的 signal ============

test('3. 每次调用创建独立 AbortController（不共享、不复用已 aborted 的 signal）', async () => {
  const seen = [];
  const restore = mockFetch((url, opts) => {
    seen.push(opts.signal);
    return Promise.reject(Object.assign(new Error('boom'), { name: 'Error' }));
  });
  try {
    await assert.rejects(() => chatDetailed(GW, [{ role: 'user', content: 'a' }], { maxTokens: 10, timeoutMs: 100 }));
    await assert.rejects(() => chatDetailed(GW, [{ role: 'user', content: 'b' }], { maxTokens: 10, timeoutMs: 100 }));
  } finally { restore(); }
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1], '两次调用必须使用不同的 AbortSignal 实例');
  // 第一次的 signal 在结束后处于 aborted 状态也不影响第二次
  assert.equal(seen[1].aborted, false, '第二次的 signal 不能被前一次污染');
});

test('3b. 超时发生后立刻发起第二次调用：新 signal 未 aborted，能够正常完成', async () => {
  let call = 0;
  const restore = mockFetch((url, opts) => {
    call += 1;
    if (call === 1) return hangingFetch()(url, opts);      // 第一次超时
    return okFetch('{"ok":true}')();                        // 第二次成功
  });
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'a' }], { maxTokens: 10, timeoutMs: 50 }),
      (e) => e.code === 'LLM_TIMEOUT',
    );
    const r = await chatDetailed(GW, [{ role: 'user', content: 'b' }], { maxTokens: 10, timeoutMs: 5000 });
    assert.equal(r.text, '{"ok":true}');
  } finally { restore(); }
});

// ============ 4. 超时绝不被解释为成功 ============

test('4. 超时/取消后不得返回任何"成功"结果', async () => {
  const restore = mockFetch(hangingFetch());
  try {
    let returned = null;
    try { returned = await chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 50 }); }
    catch { /* 预期抛错 */ }
    assert.equal(returned, null, '超时不得返回对象（不得伪造成功）');
  } finally { restore(); }
});

// ============ 5. 正常路径不受影响 ============

test('5. 正常响应：返回 text + usage，行为与修复前一致', async () => {
  const restore = mockFetch(okFetch('{"a":1}', { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 }));
  try {
    const r = await chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 1200 });
    assert.equal(r.text, '{"a":1}');
    assert.equal(r.usage.total_tokens, 16);
  } finally { restore(); }
});

test('5b. HTTP 错误仍按原样抛出（不得被分类逻辑吞掉）', async () => {
  const restore = mockFetch(async () => ({
    ok: false, status: 429, url: 'http://127.0.0.1:1/v1/chat/completions',
    headers: new Map(), text: async () => '{"error":"rate limited"}', json: async () => ({}),
  }));
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 5000 }),
      (e) => /429/.test(String(e.message)),
    );
  } finally { restore(); }
});

test('5c. 兼容旧 chat() 接口（仍返回字符串）', async () => {
  const restore = mockFetch(okFetch('hello'));
  try {
    assert.equal(await chat(GW, [{ role: 'user', content: 'x' }], { maxTokens: 100 }), 'hello');
  } finally { restore(); }
});

// ============ 6. 敏感信息不进入错误信息 ============

test('6. 超时错误信息不含 API Key / Authorization / 完整 URL 查询参数', async () => {
  const restore = mockFetch(hangingFetch());
  try {
    await assert.rejects(
      () => chatDetailed({ ...GW, key: 'sk-test-configured-secret', defaultBaseUrl: 'http://127.0.0.1:1/v1?key=url-query-secret' }, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 50 }),
      (e) => {
        const blob = `${e.message} ${JSON.stringify(e.details ?? {})}`;
        assert.ok(!blob.includes('configured-secret'), '错误信息不得含 API Key');
        assert.ok(!blob.includes('url-query-secret'), '错误信息不得含敏感查询参数');
        assert.ok(!/Bearer\s+[A-Za-z0-9._-]{8,}/.test(blob), '错误信息不得含 Authorization');
        return true;
      },
    );
  } finally { restore(); }
});

// ============ 7. 重试预算（不无限重试）============

test('7. 超时可重试但调用方必须自己控制次数（本层不做无限重试）', async () => {
  let calls = 0;
  const restore = mockFetch((url, opts) => { calls += 1; return hangingFetch()(url, opts); });
  try {
    // 调用方显式重试 2 次，本层不得自行再重试（否则 calls > 3）
    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10, timeoutMs: 30 }));
    }
  } finally { restore(); }
  assert.equal(calls, 3, '每次调用只发一次请求，本层不得内部重试');
});

// ============ 8. 空内容 / 截断分类（第二轮真实故障）============

import { shouldDisableThinking } from '../llm.mjs';

test('8. finish_reason=length 且 content 为空 → LLM_OUTPUT_TRUNCATED（不是笼统的"返回为空"）', async () => {
  const restore = mockFetch(async () => ({
    ok: true, status: 200, url: 'http://x/v1/chat/completions', headers: new Map(),
    json: async () => ({
      choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '', reasoning_content: 'thinking...' } }],
      usage: { completion_tokens: 10000, completion_tokens_details: { reasoning_tokens: 10000 } },
    }),
    text: async () => '',
  }));
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 10000, timeoutMs: 5000 }),
      (e) => {
        assert.equal(e.code, 'LLM_OUTPUT_TRUNCATED');
        assert.equal(e.classification, 'A2_output_budget_exhausted');
        assert.equal(e.retryable, true);
        assert.equal(e.details.reasoningTokens, 10000, '应记录推理 token 数，便于判断是否被思考耗尽');
        assert.equal(e.details.maxTokens, 10000);
        assert.match(e.message, /max_tokens|预算/);
        return true;
      },
    );
  } finally { restore(); }
});

test('8b. finish=stop 但 content 为空 → LLM_EMPTY_CONTENT（与截断区分开）', async () => {
  const restore = mockFetch(async () => ({
    ok: true, status: 200, url: 'http://x/v1/chat/completions', headers: new Map(),
    json: async () => ({
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '   ' } }],
      usage: { completion_tokens: 5 },
    }),
    text: async () => '',
  }));
  try {
    await assert.rejects(
      () => chatDetailed(GW, [{ role: 'user', content: 'x' }], { maxTokens: 100, timeoutMs: 5000 }),
      (e) => e.code === 'LLM_EMPTY_CONTENT' && e.classification === 'A3_empty_content',
    );
  } finally { restore(); }
});

test('8c. 推理模型识别：deepseek/glm/qwen 关闭 thinking，普通模型不动', () => {
  assert.equal(shouldDisableThinking({ model: 'deepseek-flash' }), true);
  assert.equal(shouldDisableThinking({ model: 'glm-5.3-flash' }), true);
  assert.equal(shouldDisableThinking({ model: 'qwen-max' }), true);
  assert.equal(shouldDisableThinking({ model: 'gpt-4o-mini' }), false);
  assert.equal(shouldDisableThinking({ model: 'my-custom-model' }), false);
});

test('8d. 环境变量可强制开关 thinking 策略', () => {
  const prev = process.env.ORCHESTRAI_DISABLE_THINKING;
  try {
    process.env.ORCHESTRAI_DISABLE_THINKING = 'on';
    assert.equal(shouldDisableThinking({ model: 'gpt-4o-mini' }), true, '强制开应对所有模型生效');
    process.env.ORCHESTRAI_DISABLE_THINKING = 'off';
    assert.equal(shouldDisableThinking({ model: 'deepseek-flash' }), false, '强制关应对推理模型也不生效');
  } finally {
    if (prev === undefined) delete process.env.ORCHESTRAI_DISABLE_THINKING;
    else process.env.ORCHESTRAI_DISABLE_THINKING = prev;
  }
});

test('8e. 非推理模型（gpt-4o-mini）不得收到 thinking 参数', async () => {
  let sentBody = null;
  const restore = mockFetch(async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, url, headers: new Map(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }), text: async () => '' };
  });
  try {
    await chatDetailed({ ...GW, provider: 'custom', model: 'gpt-4o-mini' }, [{ role: 'user', content: 'x' }], { maxTokens: 100, timeoutMs: 5000 });
    assert.equal(Object.hasOwn(sentBody, 'thinking'), false, '普通模型不应带 thinking 参数（避免 400）');
  } finally { restore(); }
});

test('8f. 推理模型（deepseek）会带 thinking:disabled', async () => {
  let sentBody = null;
  const restore = mockFetch(async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, url, headers: new Map(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }), text: async () => '' };
  });
  try {
    await chatDetailed({ ...GW, provider: 'custom', model: 'deepseek-flash' }, [{ role: 'user', content: 'x' }], { maxTokens: 100, timeoutMs: 5000 });
    assert.deepEqual(sentBody.thinking, { type: 'disabled' });
  } finally { restore(); }
});

// ============ 9. 最终错误信息必须反映"实际"尝试次数 ============

test('9. 首次即判不可重试时，错误信息里的次数必须是 1 而不是配置上限 2', async () => {
  // 真实故障证据（events 1792825532483）：只有 1 条"第 1/2 次失败"，
  // 最终却写"已尝试 2 次"——因为用了 attempts 配置上限。
  // 这里用 PAGEPLAN_BLOCKED（真正的不可重试）复现该计数错误。
  const { generatePagePlan } = await import('../generator/pageplan/generate.mjs');
  const blockedPlan = {
    schemaVersion: 'orchestrai.pageplan.v1',
    meta: { title: 'T', description: 'd', language: 'zh-CN' },
    userConstraints: { locked: true },
    designIntent: { concept: 'c', pageDirection: 'explore', visualPrinciples: ['a'] },
    theme: { styleId: 'neumorph-blossom', background: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#777777', accent: '#ce125d', accentSoft: '#f0c6d6', fontMood: 'serif', density: 'airy', radius: 'rounded' },
    nodes: [{ id: 's', type: 'section', title: 'S', children: [{ id: 't', type: 'text', text: 'x' }] }],
    unsupportedRequests: [{ requirementId: 'US1', capability: '真实 3D', reason: '渲染器不支持', severity: 'blocking' }],
  };
  let callCount = 0;
  await assert.rejects(
    () => generatePagePlan({
      requirement: 'test', gw: { provider: 'custom', model: 'm' },
      userChoices: {}, allowedStyleIds: ['neumorph-blossom'],
      availableCapabilities: ['section', 'text'],
      resolveTheme: async () => ({ styleId: 'neumorph-blossom', background: '#ffffff', surface: '#ffffff', text: '#111111', muted: '#777777', accent: '#ce125d', accentSoft: '#f0c6d6', density: 'airy', radius: 'rounded' }),
      callModel: async () => { callCount += 1; return JSON.stringify(blockedPlan); },
      maxAttempts: 2,
    }),
    (e) => {
      assert.equal(callCount, 1, 'blocking 声明只应请求 1 次');
      assert.equal(e.details.attempts, 1, 'details.attempts 必须是实际次数');
      assert.equal(e.details.attemptsAllowed, 2, '同时保留配置上限供审计');
      assert.match(e.message, /实际尝试 1\/2 次/, `消息应写明实际次数：${e.message}`);
      return true;
    },
  );
});

test('9b. 模型写非法枚举值时允许重试（有自愈机会）', async () => {
  const { describeAttemptFailure } = await import('../generator/pageplan/generate.mjs');
  for (const code of ['MODEL_UNKNOWN_FONT', 'MODEL_UNKNOWN_STYLE', 'MODEL_INVALID_DIRECTION', 'PAGEPLAN_INVALID']) {
    assert.equal(describeAttemptFailure({ code, message: 'x' }, { attempt: 1, attempts: 2 }).retryable, true,
      `${code} 应可重试（错误会回传给模型）`);
  }
});

test('9c. 真正的致命错误仍然不重试', async () => {
  const { describeAttemptFailure } = await import('../generator/pageplan/generate.mjs');
  for (const code of ['LLM_ABORTED', 'PAGEPLAN_BLOCKED', 'PAGEPLAN_CAPABILITY_UNAVAILABLE', 'MODEL_REQUIRED', 'PAGEPLAN_ASSET_MISSING']) {
    assert.equal(describeAttemptFailure({ code, message: 'x' }, { attempt: 1, attempts: 2 }).retryable, false,
      `${code} 不应重试`);
  }
});
