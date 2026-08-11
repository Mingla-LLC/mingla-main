/**
 * #1880 Calendar collaboration provenance regression.
 *
 * calendar_entries.board_card_id is the board_saved_cards row identifier.
 * card_id is heterogeneous and calendar_entries.id names the calendar row, so
 * neither is an admissible substitute for authoritative share provenance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ISSUE_1880_ROOT
  ? path.resolve(process.env.ISSUE_1880_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const calendar = fs.readFileSync(
  path.join(ROOT, 'app-mobile/src/components/activity/CalendarTab.tsx'),
  'utf8',
);

test('C1 Calendar collaboration maps only a non-empty board_card_id to saved provenance', () => {
  const start = calendar.indexOf('const boardCardId');
  const end = calendar.indexOf('source.category', start);
  assert.notEqual(start, -1, 'Calendar collaboration provenance carrier is missing');
  assert.notEqual(end, -1, 'Calendar provenance boundary is missing');
  const carrier = calendar.slice(start, end);

  assert.match(carrier, /board_card_id/);
  assert.match(carrier, /entry\.source\s*===\s*["']collaboration["']/);
  assert.match(carrier, /typeof boardCardId\s*===\s*["']string["']/);
  assert.match(carrier, /boardCardId\.trim\(\)\.length\s*>\s*0/);
  assert.match(carrier, /source\.sourceScope\s*=\s*["']collaboration["']/);
  assert.match(carrier, /source\.sourceRecordId\s*=\s*collaborationSourceRecordId/);
  assert.match(carrier, /source\.savedCardId\s*=\s*collaborationSourceRecordId/);
});

test('C2 Calendar never fabricates saved provenance from card_id or the calendar row id', () => {
  assert.doesNotMatch(calendar, /source\.(?:sourceRecordId|savedCardId)\s*=\s*(?:[^;\n]*\bcard_id\b|[^;\n]*entry\.id)/);
  assert.doesNotMatch(calendar, /(?:sourceRecordId|savedCardId)\s*:\s*(?:[^,\n]*\bcard_id\b|[^,\n]*entry\.id)/);
});
