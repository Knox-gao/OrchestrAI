import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRequirementCoverage, assertRequiredCoverage } from '../generator/pageplan/coverage-status.mjs';

const req = [{ id: 'REQ-3D', required: true, description: 'interactive 3D scene' }];
test('required capability with browser evidence is verified', () => {
  const result = evaluateRequirementCoverage({ requirements: req, evidence: [{ requirementId: 'REQ-3D', kind: 'browser', passed: true, artifact: 'evidence/scene3d.png' }] });
  assert.equal(result.status, 'pass'); assert.equal(result.blocking, false); assert.equal(result.requirements[0].status, 'implemented_verified');
});
test('model cannot downgrade trusted required capability to nonblocking unsupported', () => {
  const result = evaluateRequirementCoverage({ requirements: req, unsupportedRequests: [{ requirementId: 'REQ-3D', capability: 'scene3d', reason: 'not implemented', severity: 'nonblocking' }] });
  assert.equal(result.blocking, true); assert.equal(result.requirements[0].status, 'required_unsupported');
  assert.throws(() => assertRequiredCoverage(result), (error) => error.code === 'PAGEPLAN_COVERAGE_BLOCKED');
});
test('canvas-only static evidence is insufficient for a required semantic capability', () => {
  const result = evaluateRequirementCoverage({ requirements: req, evidence: [{ requirementId: 'REQ-3D', kind: 'static', passed: true, artifact: 'checks.html' }] });
  assert.equal(result.blocking, true); assert.equal(result.requirements[0].status, 'required_evidence_insufficient');
});
test('required capability with no evidence blocks', () => {
  const result = evaluateRequirementCoverage({ requirements: req });
  assert.equal(result.blocking, true); assert.equal(result.requirements[0].status, 'required_missing_evidence');
});
test('non-required unsupported capability may be disclosed without blocking', () => {
  const result = evaluateRequirementCoverage({ requirements: [{ id: 'REQ-AUDIO', required: false }], unsupportedRequests: [{ requirementId: 'REQ-AUDIO', capability: 'audio', reason: 'not included', severity: 'nonblocking' }] });
  assert.equal(result.blocking, false); assert.equal(result.status, 'pass_with_declared_limits');
});
test('blocking unsupported request remains blocking even if model claims the requirement is optional', () => {
  const result = evaluateRequirementCoverage({ requirements: [{ id: 'REQ-X', required: false }], unsupportedRequests: [{ requirementId: 'REQ-X', capability: 'x', reason: 'missing', severity: 'blocking' }] });
  assert.equal(result.blocking, true); assert.equal(result.requirements[0].status, 'blocking_unsupported');
});
test('verified evidence conflicting with an unsupported declaration requires review', () => {
  const result = evaluateRequirementCoverage({ requirements: req, evidence: [{ requirementId: 'REQ-3D', kind: 'browser', passed: true, artifact: 'browser/ok.png' }], unsupportedRequests: [{ requirementId: 'REQ-3D', capability: 'scene3d', reason: 'model says unavailable', severity: 'nonblocking' }] });
  assert.equal(result.blocking, true); assert.equal(result.requirements[0].status, 'status_conflict');
});
