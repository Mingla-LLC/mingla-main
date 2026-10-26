// @ts-nocheck — node --experimental-strip-types needs the .ts import extension.
// #3872 walkthrough build — a server `{ ok: false, error }` answer is a
// failure. Before the build, `gig_interest_send` returning
// `{ ok:false, error:'note_not_anonymous' }` resolved normally and the app
// showed "Interest sent". Runs under `node --experimental-strip-types --test`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ProgramActionError,
  programErrorMessage,
  toProgramError,
  unwrapProgramResult,
} from '../programResult.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8');

test('#3872 ok:false throws a ProgramActionError carrying the code and field', () => {
  assert.throws(() => unwrapProgramResult({ ok: false, error: 'gig_full' }), (error: unknown) => {
    assert.ok(error instanceof ProgramActionError);
    assert.equal(error.code, 'gig_full');
    assert.match(error.message, /filled up/);
    return true;
  });
  assert.throws(() => unwrapProgramResult({ ok: false, error: 'invalid_price', field: 'price' }), (error: unknown) => {
    assert.ok(error instanceof ProgramActionError);
    assert.equal(error.field, 'price');
    return true;
  });
  const ok = { ok: true, saved: true };
  assert.equal(unwrapProgramResult(ok), ok);
  assert.equal(unwrapProgramResult(null), null);
});

test('#3872 every gig_interest_send refusal has its own human copy', () => {
  for (const code of ['payout_rail_mismatch', 'creator_not_ready', 'gig_full', 'already_interested']) {
    const message = programErrorMessage(code);
    assert.doesNotMatch(message, /Something went wrong/, code);
    assert.doesNotMatch(message, /_/, `${code} leaks a raw key`);
  }
  const note = new ProgramActionError('note_not_anonymous', { reasons: ['phone', 'url'] });
  assert.equal(note.message, 'Remove a phone number and a link from your note. Notes can’t include contact details until you’re hired.');
});

test('#3872 raised codes and edge bodies map to copy; raw text never leaks', () => {
  assert.equal(toProgramError({ message: 'pick_window_closed' }).code, 'pick_window_closed');
  assert.equal(toProgramError(new Error('Edge Function returned a non-2xx status code'), { error: 'media_capacity', detail: 'Uploads are paused…' }).message,
    'Uploads are paused for a few minutes. Your work is saved; try again shortly.');
  assert.equal(toProgramError(new Error('x'), { error: 'validation_error', detail: 'country_unsupported' }).code, 'country_unsupported');
  const raw = toProgramError({ message: 'duplicate key value violates unique constraint "creator_handles_pkey"' });
  assert.equal(raw.code, 'unknown_error');
  assert.doesNotMatch(raw.message, /duplicate key|constraint|object Object/);
  assert.doesNotMatch(toProgramError({}).message, /object Object/);
});

test('#3872 every Creator and Local write goes through the ok:false unwrap', () => {
  const api = read('src/services/programApi.ts');
  assert.match(api, /export async function programWrite[\s\S]*unwrapProgramResult/);
  assert.match(api, /export async function programEdge[\s\S]*unwrapProgramResult/);
  for (const file of ['src/services/creatorGigsService.ts', 'src/services/creatorProgramService.ts', 'src/services/localProgramService.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /supabase\.rpc\(/, `${file} calls an RPC without the shared unwrap`);
    assert.doesNotMatch(source, /supabase\.functions\.invoke\(/, `${file} calls an edge function without the shared unwrap`);
  }
  const gigs = read('src/services/creatorGigsService.ts');
  assert.match(gigs, /sendInterest[\s\S]*programWrite\('gig_interest_send'/);
  assert.match(gigs, /programWrite<\{ ok: true; proposal_id: string \}>\('gig_counter_send'/);
  assert.match(gigs, /programWrite<\{ ok: true; saved: boolean \}>\('creator_gig_save'/);
});
