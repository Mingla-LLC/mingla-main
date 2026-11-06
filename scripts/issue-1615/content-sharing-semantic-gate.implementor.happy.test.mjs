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
  // [TEST-MOD-APPROVED #1719] Written reason: canonical adapters now consume
  // immutable server `data.message`; client buildShareMessage is forbidden.
  const source = `// SHARE-SEMANTIC-ROLE:content-adapter
import {buildShortShareUrl} from '@mingla/sharing';
const prepared={message: data.message,url: buildShortShareUrl(code)};
// SHARE-CONTENT-CALL:adapter
Share.share(prepared);
Share.share({message: 'raw ' + buildShortShareUrl(code)});`;
  const findings = findUnauthorizedConstructs(source, 'packages/share-adapter/index.ts');
  assert.equal(findings.filter(({ signature }) => signature === 'react_native_share').length, 1);
});

// #4271: a door sale receipt is a transactional record, not shared content.
// FAILS-ON-REVERT: dropping `receipt` from NON_CONTENT_CLASSIFICATION makes the
// tagged receipt call a finding again.
test('#4271 a receipt classification passes only on its own call; untagged and unknown classes still fail', () => {
  const receipt = '// SHARE-NON-CONTENT:receipt\nawait Share.share({ message });';
  assert.deepEqual(findUnauthorizedConstructs(receipt, 'mingla-business/src/components/door/tap/Receipt.tsx'), []);
  const untagged = findUnauthorizedConstructs('await Share.share({ message });', 'mingla-business/src/components/door/tap/Receipt.tsx');
  assert.deepEqual(untagged.map(({ signature }) => signature), ['react_native_share']);
  assert.throws(() => assertSemanticInventory(untagged), /react_native_share@mingla-business\/src\/components\/door\/tap\/Receipt\.tsx:1/);
  for (const unknown of ['receipts', 'receipt-content', 'Receipt', 'content']) {
    const source = `// SHARE-NON-CONTENT:${unknown}\nawait Share.share({ message });`;
    assert.equal(findUnauthorizedConstructs(source, 'arbitrary/Unknown.ts').length, 1, unknown);
  }
  const distant = '// SHARE-NON-CONTENT:receipt\nconst a = 1;\nconst b = 2;\nawait Share.share({ message });';
  assert.equal(findUnauthorizedConstructs(distant, 'arbitrary/Distant.ts').length, 1);
});
