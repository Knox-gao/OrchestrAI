import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAGEPLAN_SCHEMA_VERSION, validatePagePlan } from '../generator/pageplan/schema.mjs';

const schema = JSON.parse(await readFile(new URL('../generator/pageplan/pageplan.schema.json', import.meta.url), 'utf8'));
const sample = JSON.parse(await readFile(new URL('../../../examples/island-pageplan.json', import.meta.url), 'utf8'));

test('JSON Schema and runtime validator agree on PagePlan version and required top-level safety contract', () => {
  assert.equal(schema.properties.schemaVersion.const, PAGEPLAN_SCHEMA_VERSION);
  for (const key of ['schemaVersion', 'meta', 'userConstraints', 'designIntent', 'theme', 'nodes', 'unsupportedRequests']) {
    assert.ok(schema.required.includes(key), `schema must require ${key}`);
  }
  assert.equal(schema.additionalProperties, false);
  assert.doesNotThrow(() => validatePagePlan(sample));
});

test('unsupported request schema records requirement, capability, reason and severity', () => {
  const itemRef = schema.properties.unsupportedRequests.items.$ref;
  assert.equal(itemRef, '#/$defs/unsupportedRequest');
  const item = schema.$defs.unsupportedRequest;
  assert.deepEqual(item.required, ['requirementId', 'capability', 'reason', 'severity']);
  assert.deepEqual(item.properties.severity.enum, ['blocking', 'nonblocking']);
});


test('JSON Schema formally declares bounded scene3d objects and supported shape/material enumerations', () => {
  const scene = schema.$defs.scene3d;
  assert.ok(scene, 'scene3d definition must exist');
  assert.equal(scene.properties.objects.maxItems, 48);
  const object = schema.$defs.scene3dObject;
  assert.ok(object.properties.shape.enum.includes('island'));
  assert.ok(object.properties.shape.enum.includes('torus'));
  assert.deepEqual(object.properties.material.enum, ['jelly', 'matte', 'metal', 'foliage']);
  assert.equal(object.additionalProperties, false);
  assert.equal(scene.properties.controls.additionalProperties, false);
});
