import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatePagePlan, PagePlanGenerationError, PAGEPLAN_BASE_CAPABILITIES } from '../generator/pageplan/generate.mjs';

const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));
const canonicalTheme = { ...sample.theme };
const callModelFactory = (outputs, seen = []) => async (gw, messages, options) => {
  seen.push({ gw, messages, options });
  const next = outputs.shift();
  if (next instanceof Error) throw next;
  return typeof next === 'string' ? next : JSON.stringify(next);
};

test('PagePlan generation uses injected existing gateway and resolves canonical style tokens', async () => {
  const seen = [];
  const modelPlan = structuredClone(sample);
  modelPlan.theme.styleId = 'clay-obsidian';
  modelPlan.theme.fontMood = 'sans';
  modelPlan.designIntent.pageDirection = 'showcase';
  const { plan, metadata } = await generatePagePlan({
    requirement: '做一个探索式虚构果冻海岛网页',
    projectTitle: '果冻海岛',
    gw: { provider: 'custom', model: 'test-model', key: 'not-a-real-key' },
    userChoices: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore' },
    availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES, 'scene3d'],
    allowedStyleIds: ['neumorph-blossom', 'clay-obsidian'],
    resolveTheme: async ({ styleId, fontMood }) => ({ ...canonicalTheme, styleId, fontMood }),
    callModel: callModelFactory([modelPlan], seen),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].options.temperature, 0.25);
  assert.match(seen[0].messages[1].content, /"pageDirection":"explore"/);
  assert.equal(plan.theme.styleId, 'neumorph-blossom');
  assert.equal(plan.theme.fontMood, 'serif');
  assert.equal(plan.designIntent.pageDirection, 'explore');
  assert.equal(plan.userConstraints.locked, true);
  assert.deepEqual(metadata.lockedChoiceFields, ['styleId', 'fontMood', 'pageDirection']);
  assert.equal(metadata.usage, null, 'must not invent real token usage');
});

test('generation retries invalid JSON, then returns validated plan', async () => {
  const seen = [];
  const { metadata } = await generatePagePlan({
    requirement: '做一个网页',
    gw: { provider: 'custom', model: 'test-model' },
    userChoices: { styleId: 'neumorph-blossom', fontMood: 'serif', pageDirection: 'explore' },
    availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES, 'scene3d'],
    allowedStyleIds: ['neumorph-blossom'],
    resolveTheme: async () => canonicalTheme,
    callModel: callModelFactory(['not json', sample], seen),
    maxAttempts: 2,
  });
  assert.equal(seen.length, 2);
  assert.equal(metadata.attempts, 2);
  assert.match(seen[1].messages[1].content, /previousValidationIssue/);
});

test('repeated invalid PagePlan fails closed with a classified error', async () => {
  await assert.rejects(() => generatePagePlan({
    requirement: 'test', gw: { provider: 'custom', model: 'test-model' },
    userChoices: { styleId: 'neumorph-blossom' }, allowedStyleIds: ['neumorph-blossom'],
    availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES, 'scene3d'],
    resolveTheme: async () => canonicalTheme,
    callModel: callModelFactory(['not json', 'still not json']), maxAttempts: 2,
  }), (error) => error instanceof PagePlanGenerationError && error.code === 'PAGEPLAN_GENERATION_FAILED' && error.details.attempts === 2);
});

test('blocking unsupported user requirements stop PagePlan generation without trying another template', async () => {
  const blocked = structuredClone(sample);
  blocked.unsupportedRequests.push({ requirementId: 'US1-3D', capability: '真实 3D 岛屿', reason: '没有可用的 3D renderer', severity: 'blocking' });
  await assert.rejects(() => generatePagePlan({
    requirement: '做一个真实 3D 岛屿', gw: { provider: 'custom', model: 'test-model' },
    userChoices: { styleId: 'neumorph-blossom' }, allowedStyleIds: ['neumorph-blossom'],
    availableCapabilities: [...PAGEPLAN_BASE_CAPABILITIES, 'scene3d'],
    resolveTheme: async () => canonicalTheme, callModel: callModelFactory([blocked, sample]), maxAttempts: 2,
  }), (error) => error instanceof PagePlanGenerationError && error.details.lastCode === 'PAGEPLAN_BLOCKED');
});

test('missing model gateway blocks before attempting generation', async () => {
  await assert.rejects(() => generatePagePlan({
    requirement: 'test', gw: null, allowedStyleIds: ['neumorph-blossom'],
    resolveTheme: async () => canonicalTheme, callModel: async () => JSON.stringify(sample),
  }), (error) => error instanceof PagePlanGenerationError && error.code === 'MODEL_REQUIRED');
});

test('noncanonical locked style ID is rejected rather than silently guessed', async () => {
  await assert.rejects(() => generatePagePlan({
    requirement: 'test', gw: { provider: 'custom', model: 'test-model' },
    userChoices: { styleId: 'pink-neumorph' }, allowedStyleIds: ['neumorph-blossom'],
    resolveTheme: async () => canonicalTheme, callModel: async () => JSON.stringify(sample),
  }), (error) => error instanceof PagePlanGenerationError && error.code === 'INVALID_LOCKED_CHOICE');
});
