/**
 * #1615 independent semantic angle — new append-only suite.
 * FAILS-ON-REVERT: reverting the semantic scanner makes A1/A2 fail because an
 * unexpected producer can once again appear anywhere without detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSemanticInventory, findUnauthorizedConstructs, scanProductionSources,
} from './content-sharing-semantic-gate.mjs';

test('A1 production inventory remains at or below the staged semantic ceilings', () => {
  const findings = scanProductionSources();
  assert.doesNotThrow(() => assertSemanticInventory(findings));
});

test('A2 an unexpected producer in any new path is rejected by behavior, not filename', () => {
  const hostile = `export async function leak(title) {
    return Share.share({message: title + " https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F"});
  }`;
  const findings = findUnauthorizedConstructs(hostile, 'brand-new-surface/deep/NewComposer.tsx');
  assert.deepEqual(findings.map((finding) => finding.signature).sort(), ['inline_short_content_url', 'react_native_share']);
  assert.throws(() => assertSemanticInventory(findings, {}), /unauthorized content-share construction/);
});

test('A3 strict facts reject unexpected/private RSVP fields and malformed moving media', async () => {
  const sharing = await import('../../packages/sharing/index.js');
  const base = { schemaVersion: 1, kind: 'rsvp_event', title: 'Dinner', localDate: 'Aug 8' };
  for (const privateField of ['guestName', 'guestEmail', 'attendeeList', 'admissionToken', 'ticketBarcode', 'ownerId']) {
    assert.equal(sharing.validateShareFactsV1({ ...base, [privateField]: 'secret' }).ok, false, privateField);
  }
  for (const media of [
    { kind: 'video', url: 'https://cdn.test/video.mp4' },
    { kind: 'gif', url: 'https://cdn.test/cover.gif', posterUrl: 'http://cdn.test/poster.jpg' },
    { kind: 'photo', url: 'javascript:alert(1)' },
  ]) assert.equal(sharing.validateShareFactsV1({ ...base, media }).ok, false);
});
