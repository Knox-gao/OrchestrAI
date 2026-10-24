/**
 * M7-B4F：发布前安全回归（依据 GitHub 发布前审计的两个高危项）
 *
 * 1. `/api/jobs/:id` 不得返回 errorStack（栈里可能含构建机路径/上游 URL）
 * 2. LLM 错误不得回显上游响应正文（供应商常在 error body 里回显 key）
 *
 * 全部使用合成数据，零真实请求、零真实密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

import { sanitizeForOutput } from '../llm.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

// ---------------- sanitizeForOutput：脱敏能力 ----------------

test('脱敏 Bearer / sk- / URL 查询参数 / user:pass / JSON 键值', () => {
  const cases = [
    ['Authorization: Bearer sk-test-bearer-value', (o) => !o.includes('bearer-value')],
    ['{"error":"Invalid key sk-test-project-key"}', (o) => !o.includes('project-key')],
    ['https://api.x.com/v1?key=SECRET123&model=x', (o) => !o.includes('SECRET123') && o.includes('model=x')],
    ['https://user:sk-test-password@api.x.com/v1', (o) => !o.includes('test-password')],
    ['{"apiKey":"sk-test-json-key"}', (o) => !o.includes('json-key')],
    ['{"access_token":"sk-test-access-token"}', (o) => !o.includes('access-token')],
  ];
  for (const [input, check] of cases) {
    const out = sanitizeForOutput(input);
    assert.ok(check(out), `脱敏失败：${input} → ${out}`);
  }
});

test('脱敏本地绝对路径，但不误伤 URL 的 scheme', () => {
  const winPath = String.raw`D:\app\src\llm.mjs:178`;
  assert.equal(sanitizeForOutput(winPath).includes('app\\src'), false, 'Windows 路径应被替换');
  const url = 'https://api.deepseek.com/v1/chat/completions';
  assert.equal(sanitizeForOutput(url), url, '正常 URL 不应被改成 http[local-path]');
});

test('脱敏不破坏正常文本', () => {
  const normal = '模型返回的 JSON 无法解析；已尝试 2 次';
  assert.equal(sanitizeForOutput(normal), normal);
});

test('超长文本被截断并带省略号', () => {
  const long = 'x'.repeat(1000);
  const out = sanitizeForOutput(long, 100);
  assert.ok(out.length <= 101, `实际长度 ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('非字符串输入不抛错', () => {
  for (const v of [null, undefined, 0, {}, []]) {
    assert.doesNotThrow(() => sanitizeForOutput(v));
  }
});

// ---------------- 源码级断言：出口不得包含 errorStack ----------------

test('/api/jobs 响应体不再包含 errorStack 字段', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/server/index.mjs'), 'utf8');
  assert.equal(/errorStack\s*:/.test(src), false, 'index.mjs 不得把 errorStack 放进响应体');
  // 栈只允许进服务端日志
  assert.match(src, /console\.error\([^)]*job\.id/, '堆栈应写服务端日志而非返回给客户端');
  assert.match(src, /sanitizeForOutput/, '错误消息必须经脱敏后再返回');
});

test('LLM HTTP 错误不再原样回显上游响应正文', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/server/llm.mjs'), 'utf8');
  assert.equal(/body\.slice\(0,\s*120\)/.test(src), false, '不得再截取上游 body 直接抛错');
  assert.match(src, /sanitizeForOutput\(raw/, '上游 body 必须先脱敏');
  assert.match(src, /LLM_HTTP_ERROR/, 'HTTP 错误应有稳定 code');
});

// ---------------- 行为级：真实 HTTP stub 验证错误体脱敏 ----------------

test('真实 HTTP 401 + 上游回显 key → 抛出的错误里没有 key', async () => {
  const { chatDetailed } = await import('../llm.mjs');
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: 'Incorrect API key provided: sk-LEAKTEST9876543210',
          type: 'invalid_request_error',
        },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await assert.rejects(
      () => chatDetailed(
        { provider: 'custom', key: 'sk-test-configured-key', model: 'm', defaultBaseUrl: `http://127.0.0.1:${port}/v1` },
        [{ role: 'user', content: 'x' }],
        { maxTokens: 10, timeoutMs: 5000 },
      ),
      (e) => {
        const blob = `${e.message}|${JSON.stringify(e.details ?? {})}`;
        assert.ok(!blob.includes('LEAKTEST9876543210'), `错误里泄漏了上游回显的 key：${blob.slice(0, 200)}`);
        assert.ok(!blob.includes('configured-key'), '错误里泄漏了真实 key');
        assert.equal(e.code, 'LLM_HTTP_ERROR');
        assert.equal(e.details.httpStatus, 401);
        assert.equal(e.retryable, false, '401 不应重试');
        return true;
      },
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('真实 HTTP 500 → 可重试，且错误体仍脱敏', async () => {
  const { chatDetailed } = await import('../llm.mjs');
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('upstream overloaded; trace=Bearer sk-test-upstream-trace');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await assert.rejects(
      () => chatDetailed(
        { provider: 'custom', key: 'sk-x', model: 'm', defaultBaseUrl: `http://127.0.0.1:${port}/v1` },
        [{ role: 'user', content: 'x' }],
        { maxTokens: 10, timeoutMs: 5000 },
      ),
      (e) => {
        assert.ok(!e.message.includes('upstream-trace'), '上游 token 泄漏');
        assert.equal(e.details.httpStatus, 500);
        assert.equal(e.retryable, true, '5xx 应可重试');
        return true;
      },
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------- 仓库卫生：敏感文件必须被忽略 ----------------

test('keys.json 与 evidence 目录被 .gitignore 排除', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^apps\/server\/keys\.json$/m, 'keys.json 必须被忽略');
  assert.match(gi, /^workspaces\/$/m, 'workspaces 必须被忽略');
  assert.match(gi, /^\.env$/m, '.env 必须被忽略');
  assert.match(gi, /^\.env\.\*$/m, '.env.* 必须被忽略');
  for (const dir of ['m7b4c-evidence', 'm7b4d-evidence', 'm7-b4b-evidence']) {
    assert.ok(gi.includes(dir), `证据目录 ${dir} 应被忽略`);
  }
});
