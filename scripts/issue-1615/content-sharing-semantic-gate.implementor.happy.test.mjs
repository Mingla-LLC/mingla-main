/**
 * #1615 implementor regression: repository-wide semantic producer ownership.
 * FAILS-ON-REVERT: removing repository-root discovery or per-call authorization
 * makes one of these controls stop detecting a raw content producer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSemanticInventory,
  findUnauthorizedConstructs,
  scanProductionSources,
} from './content-sharing-semantic-gate.mjs';

test('production inventory has no unclassified content-share construction', () => {
  const findings = scanProductionSources();
  assert.deepEqual(findings, []);
  assert.doesNotThrow(() => assertSemanticInventory(findings));
});

test('a raw call in a previously omitted packages production path is rejected', () => {
  const source = 'export const leak = () => Share.share({message: buildShareMessage(facts, ctx)});';
  const findings = findUnauthorizedConstructs(source, 'packages/new-share/index.ts');
  assert.deepEqual(findings.map(({ signature }) => signature), ['react_native_share']);
  assert.throws(() => assertSemanticInventory(findings), /packages\/new-share\/index\.ts/);
});

test('a raw call in a marketing component is rejected', () => {
  const source = 'export const Card = () => navigator.share({url: buildShortShareUrl(code)});';
  const findings = findUnauthorizedConstructs(source, 'mingla-marketing/components/Card.tsx');
  assert.deepEqual(findings.map(({ signature }) => signature), ['browser_share']);
});

test('a valid adapter role does not pardon an unclassified second call', () => {
  const source = `// SHARE-SEMANTIC-ROLE:content-adapter
import {buildShareMessage,buildShortShareUrl} from '@mingla/sharing';
// SHARE-CONTENT-CALL:adapter
Share.share({message: buildShareMessage(facts,{shortCode:code})});
Share.share({message: 'raw ' + buildShortShareUrl(code)});`;
  const findings = findUnauthorizedConstructs(source, 'packages/share-adapter/index.ts');
  assert.equal(findings.filter(({ signature }) => signature === 'react_native_share').length, 1);
});
