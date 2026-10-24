/**
 * 用户日志 PMVMNBF1R 的三处回归测试。
 *
 * 日志显示两次尝试都失败、交付阻断：
 *   第 1 次 MODEL_INVALID_JSON —— 模型把 Python 表达式塞进 JSON 值：
 *       "type": "eyebrow" in [0] and null or None
 *   第 2 次 PAGEPLAN_INVALID —— `nodes[1].variant: unsupported value`
 *       实际值是 "split"，而 split 是 container.layout 的合法值，不是 section.variant 的。
 *
 * 修复三点：
 *   1. 枚举错误要报出「实际值 + 合法值 + 跨属性提示」，否则模型不知道该怎么改
 *   2. section.variant 被填布局值时确定性映射回缺省 plain（与删字段等价）
 *   3. JSON 语法崩坏老实重试，不做高风险的文本级"猜修复"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePagePlan, PAGEPLAN_LIMITS } from '../generator/pageplan/schema.mjs';
import { normalizePagePlanDraft } from '../generator/pageplan/normalize-draft.mjs';
import { generatePagePlan, PAGEPLAN_BASE_CAPABILITIES } from '../generator/pageplan/generate.mjs';

const THEME = {
  background: '#0a0a12', surface: '#12121c', text: '#f2f2f7', muted: '#9a9ab0',
  accent: '#b06bff', accentSoft: '#2a1f3f', density: 'comfortable', radius: 'soft',
};

const ATTEMPT_2 = readFileSync(new URL('../../../workspaces/PMVMNBF1R/_model/attempt-2.txt', import.meta.url), 'utf8');

function parseSample(raw) {
  const body = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim() ?? raw.trim();
  const plan = JSON.parse(body);
  plan.userConstraints = { styleId: 'glass-obsidian', fontMood: 'sans', pageDirection: 'showcase', locked: true };
  plan.theme = { ...THEME, styleId: 'glass-obsidian', fontMood: 'sans' };
  return plan;
}

// ---------- 1. 枚举错误消息必须可执行 ----------

test('枚举错误报出实际值与合法值', () => {
  const plan = parseSample(ATTEMPT_2);
  plan.nodes[1].variant = 'cinematic'; // 模型凭空造的值
  assert.throws(
    () => validatePagePlan(plan),
    (err) => {
      const msg = err.issues.join(' ');
      assert.match(msg, /expected one of plain\|hero\|panel\|contrast/, '必须列出合法值');
      assert.match(msg, /got "cinematic"/, '必须报出实际值');
      return true;
    },
  );
});

test('把另一个属性的枚举值填错时，错误直接点明归属', () => {
  const plan = parseSample(ATTEMPT_2);
  assert.equal(plan.nodes[1].variant, 'split', '样例句型本身就是 split 误用');
  assert.throws(
    () => validatePagePlan(plan),
    (err) => {
      const msg = err.issues.join(' ');
      assert.match(msg, /"split" is a container\.layout value, not a variant value/, `应点明跨属性误用，实际：${msg.slice(0, 200)}`);
      return true;
    },
  );
});

// ---------- 2. 跨属性误用可确定性修复 ----------

test('section.variant 被填布局值时映射回 plain，且能通过校验', () => {
  const plan = parseSample(ATTEMPT_2);
  const { draft, repairs } = normalizePagePlanDraft(plan, { limits: PAGEPLAN_LIMITS });
  assert.equal(draft.nodes[1].variant, 'plain');
  assert.ok(repairs.some((r) => r.action === 'map-layout-to-default-variant' && r.from === 'split'));
  assert.doesNotThrow(() => validatePagePlan(draft));
});

test('container.layout 被填 section.variant 值时映射回 stack', () => {
  const plan = parseSample(ATTEMPT_2);
  // 找一个 container 塞错值
  let target = null;
  const walk = (nodes) => (nodes ?? []).forEach((n) => {
    if (n.type === 'container' && !target) target = n;
    walk(n.children);
    (n.panels ?? []).forEach((p) => walk(p.children));
  });
  walk(plan.nodes);
  assert.ok(target, '样例句型里应有 container');
  target.layout = 'panel'; // panel 是 section.variant 的值

  const { draft, repairs } = normalizePagePlanDraft(plan, { limits: PAGEPLAN_LIMITS });
  const after = (() => { let hit = null; const w = (nodes) => (nodes ?? []).forEach((n) => { if (n.id === target.id) hit = n; w(n.children); (n.panels ?? []).forEach((p) => w(p.children)); }); w(draft.nodes); return hit; })();
  assert.equal(after.layout, 'stack');
  assert.ok(repairs.some((r) => r.action === 'map-variant-to-default-layout'));
});

test('凭空造的枚举值不会被"修"成合法值，仍然拒绝', () => {
  const plan = parseSample(ATTEMPT_2);
  plan.nodes[1].variant = 'cinematic';
  const { draft } = normalizePagePlanDraft(plan, { limits: PAGEPLAN_LIMITS });
  assert.equal(draft.nodes[1].variant, 'cinematic', '不得擅自替换成合法值');
  assert.throws(() => validatePagePlan(draft));
});

// ---------- 3. 端到端：坏 JSON 重试后成功 ----------

const badJson = readFileSync(new URL('../../../workspaces/PMVMNBF1R/_model/attempt-1.txt', import.meta.url), 'utf8');

async function run(outputs) {
  const seen = [];
  const result = await generatePagePlan({
    requirement: '做一个 iPhone 17 评测页面',
    projectTitle: 'iPhone 17',
    gw: { provider: 'replay', model: 'sample', key: 'x' },
    userChoices: { styleId: 'glass-obsidian', fontMood: 'sans', pageDirection: 'showcase' },
    availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES],
    allowedStyleIds: ['glass-obsidian'],
    resolveTheme: async ({ styleId, fontMood }) => ({ ...THEME, styleId, fontMood }),
    callModel: async (gw, messages) => { seen.push(messages[1].content); return outputs[seen.length - 1]; },
  }).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: e }));
  return { ...result, calls: seen.length, seen };
}

test('第一次 JSON 坏、第二次合格：重试后成功交付', async () => {
  const r = await run([badJson, ATTEMPT_2]);
  assert.equal(r.ok, true, `应成功，实际错误：${r.error?.code}`);
  assert.equal(r.calls, 2, '应该重试了一次');
  assert.equal(r.metadata.attempts, 2);
  assert.ok(r.metadata.repairs.length > 0, '应记录规范化修复');
});

test('两次都 JSON 坏：如实失败，不静默降级', async () => {
  const r = await run([badJson, badJson]);
  assert.equal(r.ok, false);
  assert.equal(r.calls, 2, '重试次数不变（仍为 2）');
  assert.match(r.error.message, /实际尝试 2\/2 次/);
  assert.match(r.error.message, /MODEL_INVALID_JSON/);
});

test('第二次的校验错误会回传给下一轮（含具体合法值）', async () => {
  // 第一次给凭空造的值（无法机械修复），第二次给好样本
  const bad = parseSample(ATTEMPT_2);
  bad.nodes[1].variant = 'cinematic';
  const r = await run([JSON.stringify(bad), ATTEMPT_2]);
  assert.equal(r.ok, true);
  assert.equal(r.calls, 2);
  const payload = JSON.parse(r.seen[1]);
  assert.match(payload.previousValidationIssue, /plain\|hero\|panel\|contrast/, '回传的诊断要含合法值');
});
