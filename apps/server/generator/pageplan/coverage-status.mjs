const STRONG_EVIDENCE = new Set(['browser', 'integration', 'manual-reviewed']);
const BLOCKING_REQUIRED = new Set(['required_unsupported', 'required_evidence_insufficient', 'required_missing_evidence', 'blocking_unsupported', 'status_conflict']);

/** Classify trusted requirements against independently recorded evidence and unsupported declarations. */
export function evaluateRequirementCoverage({ requirements = [], evidence = [], unsupportedRequests = [] } = {}) {
  if (!Array.isArray(requirements) || !Array.isArray(evidence) || !Array.isArray(unsupportedRequests)) throw new TypeError('coverage inputs must be arrays');
  const ids = new Set();
  const results = requirements.map((requirement) => {
    if (!requirement || typeof requirement.id !== 'string' || !requirement.id.trim()) throw new TypeError('each trusted requirement needs a stable id');
    if (ids.has(requirement.id)) throw new TypeError(`duplicate trusted requirement id: ${requirement.id}`);
    ids.add(requirement.id);
    const matches = evidence.filter((item) => item?.requirementId === requirement.id && item.passed === true);
    const strong = matches.filter((item) => STRONG_EVIDENCE.has(item.kind) && typeof item.artifact === 'string' && item.artifact.length > 0);
    const unsupported = unsupportedRequests.filter((item) => item?.requirementId === requirement.id);
    const required = requirement.required === true;
    let status;
    if (strong.length && unsupported.length) status = 'status_conflict';
    else if (unsupported.some((item) => item.severity === 'blocking')) status = 'blocking_unsupported';
    else if (required && unsupported.length) status = 'required_unsupported';
    else if (strong.length) status = 'implemented_verified';
    else if (required && matches.length) status = 'required_evidence_insufficient';
    else if (required) status = 'required_missing_evidence';
    else if (unsupported.length) status = 'declared_unsupported';
    else status = matches.length ? 'evidence_insufficient' : 'not_verified';
    const blocking = status === 'blocking_unsupported' || status === 'status_conflict' || (required && BLOCKING_REQUIRED.has(status));
    return {
      requirementId: requirement.id,
      required,
      status,
      blocking,
      evidence: matches.map(({ kind, artifact }) => ({ kind, artifact })),
      unsupported: unsupported.map(({ capability, reason, severity }) => ({ capability, reason, severity })),
    };
  });
  return {
    status: results.some((item) => item.blocking) ? 'blocked' : results.some((item) => item.status !== 'implemented_verified') ? 'pass_with_declared_limits' : 'pass',
    blocking: results.some((item) => item.blocking),
    requirements: results,
  };
}

export function assertRequiredCoverage(result) {
  if (!result || typeof result !== 'object') throw new TypeError('coverage result is required');
  if (result.blocking) {
    const ids = (result.requirements ?? []).filter((item) => item.blocking).map((item) => item.requirementId);
    const error = new Error(`required PagePlan coverage is incomplete: ${ids.join(', ')}`);
    error.code = 'PAGEPLAN_COVERAGE_BLOCKED';
    error.requirementIds = ids;
    throw error;
  }
  return result;
}
