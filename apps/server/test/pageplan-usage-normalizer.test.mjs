import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderUsage } from '../generator/pageplan/usage-normalizer.mjs';

test('normalizes OpenAI reported usage only', () => {
  assert.deepEqual(normalizeProviderUsage({ usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } }), { usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 }, usageStatus: 'provider-reported' });
});
test('normalizes Anthropic input/output token names', () => {
  assert.deepEqual(normalizeProviderUsage({ usage: { input_tokens: 20, output_tokens: 8 } }), { usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 }, usageStatus: 'provider-reported' });
});
test('normalizes Gemini usageMetadata', () => {
  assert.deepEqual(normalizeProviderUsage({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9, totalTokenCount: 39 } }), { usage: { inputTokens: 30, outputTokens: 9, totalTokens: 39 }, usageStatus: 'provider-reported' });
});
test('missing usage remains null and unavailable, never estimated', () => {
  assert.deepEqual(normalizeProviderUsage({ text: 'a long response' }), { usage: null, usageStatus: 'unavailable' });
  assert.deepEqual(normalizeProviderUsage(null), { usage: null, usageStatus: 'unavailable' });
});
test('negative and invalid token fields are ignored rather than converted to estimates', () => {
  assert.deepEqual(normalizeProviderUsage({ usage: { prompt_tokens: -100, completion_tokens: 'long' } }), { usage: null, usageStatus: 'unavailable' });
});
test('provider-reported cost is retained only when explicitly supplied', () => {
  assert.deepEqual(normalizeProviderUsage({ usage: { input_tokens: 2, output_tokens: 3, costUsd: 0.004 } }), { usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, costUsd: 0.004 }, usageStatus: 'provider-reported' });
});
