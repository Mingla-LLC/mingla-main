import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 video-due change after hire (Explorer). Runs under
// `node --experimental-strip-types --test`.
// Fails before the fix: the creator's "Ask to change the video-due date" sheet
// had a calendar only and sent changes.post_by (a day); the Video due row
// dropped the time once the terms moved the day; proposal cards said
// "Video due Nov 22" with no time; the server's due refusals had no words.
import {
  agreedVideoDue,
  agreedVideoDueText,
  dueChangeInitial,
  dueChangePayload,
  dueTimeOptions,
  proposalDueText,
} from "../../../utils/programFormat.ts";
import { programErrorMessage } from "../../../services/programResult.ts";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const local = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 26, 12, 0);

test("the Video due row shows the agreed (current terms) date and time", () => {
  const gig = { video_due_at: local(2026, 11, 30, 18, 0), post_by: "2026-11-30" };
  const terms = { video_due_at: local(2026, 11, 22, 18, 0), post_by: "2026-11-22" };
  assert.equal(agreedVideoDueText(terms, gig, now, "en-US"), "Nov 22, 6:00 PM");
  // Terms without a time on the gig's day keep the gig's time.
  assert.equal(agreedVideoDueText({ post_by: "2026-11-30" }, gig, now, "en-US"), "Nov 30, 6:00 PM");
  // An older server whose terms moved the day: the day alone, never the old time.
  assert.equal(agreedVideoDueText({ post_by: "2026-11-25" }, gig, now, "en-US"), "Nov 25");
});

test("the change sheet prefills the agreed date and time and sends video_due_at", () => {
  const due = agreedVideoDue({ video_due_at: local(2026, 11, 22, 18, 30), post_by: "2026-11-22" }, null);
  assert.deepEqual(dueChangeInitial(due), { day: "2026-11-22", time: "18:30" });
  assert.deepEqual(dueChangeInitial({ videoDueAt: null, postBy: "2026-11-22" }), { day: "2026-11-22", time: "23:59" });
  assert.deepEqual(dueChangePayload("2026-11-22", "18:00"), { video_due_at: "2026-11-22T18:00" });
  // The agreed time is always one of the chips.
  assert.ok(dueTimeOptions("18:30").includes("18:30"));
  assert.ok(dueTimeOptions(null).includes("18:00"));
});

test("proposal cards show the proposed date and time", () => {
  assert.equal(proposalDueText({ video_due_at: local(2026, 11, 22, 18, 0), post_by: "2026-11-22" }, now, "en-US"), "Video due Nov 22, 6:00 PM");
  assert.equal(proposalDueText({ post_by: "2026-11-22" }, now, "en-US"), "Video due Nov 22");
  assert.equal(proposalDueText({ usage_days: 90 }, now, "en-US"), null);
});

test("due refusals read as plain words", () => {
  for (const code of ["video_due_required", "video_due_before_shoot"]) {
    const words = programErrorMessage(code);
    assert.ok(!words.includes(code), words);
    assert.ok(!/something went wrong/i.test(words), words);
  }
  assert.match(programErrorMessage("video_due_before_shoot"), /before the shoot/);
});

test("the contract screen asks for a date and a time and shows the agreed due", () => {
  const screen = read("app/creator/contract/[contractId].tsx");
  assert.match(screen, /title="Ask to change the video-due date"[\s\S]*<CalendarGrid[\s\S]*<TimeChips/);
  assert.ok(screen.includes("dueChangePayload(dueDay, dueTime)"));
  assert.ok(!screen.includes("{ post_by: newPostBy }"));
  const sections = read("src/components/creator/contract/ContractSections.tsx");
  assert.ok(sections.includes("agreedVideoDueText(terms, gig)"));
  assert.ok(sections.includes("proposalDueText(proposal.changes)"));
});
