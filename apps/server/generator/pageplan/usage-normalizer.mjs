function finiteNonNegativeInt(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
function firstInt(...values) {
  for (const value of values) { const result = finiteNonNegativeInt(value); if (result !== null) return result; }
  return null;
}

/** Normalize only provider-reported usage. Never infer token counts from code, characters, or time. */
export function normalizeProviderUsage(responseOrUsage) {
  if (!responseOrUsage || typeof responseOrUsage !== 'object') return { usage: null, usageStatus: 'unavailable' };
  const root = responseOrUsage;
  const usage = root.usage ?? root.usageMetadata ?? root.token_usage ?? root.response?.usage ?? root.data?.usage;
  if (!usage || typeof usage !== 'object') return { usage: null, usageStatus: 'unavailable' };
  const inputTokens = firstInt(usage.prompt_tokens, usage.input_tokens, usage.inputTokens, usage.promptTokenCount, usage.promptTokenCountTotal, usage.inputTokenCount);
  const outputTokens = firstInt(usage.completion_tokens, usage.output_tokens, usage.outputTokens, usage.candidatesTokenCount, usage.completionTokenCount, usage.outputTokenCount);
  const totalTokens = firstInt(usage.total_tokens, usage.totalTokens, usage.totalTokenCount) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  if (inputTokens === null && outputTokens === null && totalTokens === null) return { usage: null, usageStatus: 'unavailable' };
  const normalized = { inputTokens, outputTokens, totalTokens };
  const providerCost = usage.costUsd ?? usage.cost_usd ?? usage.cost;
  if (typeof providerCost === 'number' && Number.isFinite(providerCost) && providerCost >= 0) normalized.costUsd = providerCost;
  return { usage: normalized, usageStatus: 'provider-reported' };
}
