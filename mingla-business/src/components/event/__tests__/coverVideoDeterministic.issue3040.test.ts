import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

/**
 * Strip block + line comments so explanatory prose can neither satisfy nor trip
 * an assertion. Every `not.toContain` below MUST run on stripped source: the
 * code comments that explain what #3040 removed necessarily NAME the removed
 * symbols, and an assertion a comment can break (or satisfy) carries no
 * information — reference_audit_regex_matches_comments_same_file. The `[^:]`
 * guard before `//` preserves `https://` URLs. Mirrors `stripComments` in
 * `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const repoCode = (relativePath: string): string =>
  stripComments(repoFile(relativePath));

/**
 * issue #3040 — the cover-video flow must be deterministic and TRUTHFUL.
 *
 * Three fixes shipped in 48 hours, each verified against its own assertion
 * rather than against the user's task, and after all three the user still could
 * not upload a video. This suite pins the four umbrella invariants that are
 * checkable from source, on the exact lines that carried the untruths.
 *
 * FAILS ON REVERT — each block names the deletion that turns it red.
 */
describe("#3040 invariant 4 — the UI never states something untrue", () => {
  test("T-3040-B-01 neither wizard claims a 'Server draft' before anything is saved", () => {
    for (
      const file of [
        "src/components/event/EventCreatorWizard.tsx",
        "src/components/rsvp/RsvpCreatorWizard.tsx",
      ]
    ) {
      const src = repoCode(file);
      // The label sits on the `lastSavedAt === null` branch — i.e. NOTHING has
      // been written to `events`. "Server draft" stated the opposite of the
      // truth and was read as evidence of a server row by two separate
      // investigations while the cover pipeline was failing for want of one.
      expect(src).toContain('lastSavedAt !== null');
      expect(src).toContain('"Not saved yet"');
      expect(src).not.toContain('"Server draft"');
    }
  });

  test("T-3040-B-02 'we\\u2019ll finish automatically' is claimed ONLY where it is true", () => {
    const picker = repoCode("src/components/ui/CoverPicker.tsx");
    // Auto-apply is gated server-side on target_kind === "event" AND
    // apply_mode === "draft_auto" (autoApplyEventCover in the Bunny webhook).
    // The sheet's promise must carry the same two conditions.
    expect(picker).toContain("const coverVideoFinishesWithoutYou = (");
    expect(picker).toMatch(
      /status\.targetKind === "event" &&\s*\n?\s*status\.applyMode === "draft_auto"/,
    );
    // Every "finish automatically" promise is now behind that predicate.
    const promises = picker.match(/we’ll finish automatically/g) ?? [];
    expect(promises.length).toBeGreaterThan(0);
    for (const _ of promises) {
      expect(picker).toContain("coverVideoFinishesWithoutYou(status)");
    }
    // And the non-auto targets get the honest alternative instead.
    expect(picker).toContain("we’ll apply it when you come back");
  });

  test("T-3040-B-03 the webhook auto-apply gate the copy mirrors is still exactly that", () => {
    const webhook = repoCode("../supabase/functions/event-cover-video-webhook/index.ts");
    // If this gate ever widens or narrows, T-3040-B-02's predicate is a lie and
    // this test is the thing that says so.
    expect(webhook).toContain(
      'if (job.target_kind !== "event" || job.apply_mode !== "draft_auto") {',
    );
  });
});

describe("#3040 invariant 2 — no unbounded wait, client or server", () => {
  const hook = repoFile("src/hooks/useEventCoverVideoUpload.ts");

  test("T-3040-C-01 the ready-watch is bounded", () => {
    // `waitForEventCoverVideoReady` is a `while (true)` that exits only on a
    // terminal status or an abort. Deleting EVENT_COVER_VIDEO_WATCH_DEADLINE_MS
    // or the watchdog controller restores the unbounded wait.
    expect(hook).toContain("export const EVENT_COVER_VIDEO_WATCH_DEADLINE_MS = 600_000;");
    expect(hook).toContain("const watchdog = new AbortController();");
    expect(hook).toContain("signal: watchdog.signal,");
    expect(hook).toMatch(
      /setTimeout\(\(\) => \{\s*\n\s*deadlineReached = true;\s*\n\s*watchdog\.abort\(\);\s*\n\s*\}, EVENT_COVER_VIDEO_WATCH_DEADLINE_MS\)/,
    );
  });

  test("T-3040-C-02 crossing the watch bound DETACHES, it never fails the job", () => {
    // Invariant 1 adjacent: the job is alive server-side and finishes without
    // us. Rendering this as an error would teach the user to retry an upload
    // that is about to succeed.
    expect(hook).toContain(
      'setStage({ phase: "detached", percent: 0, sourceAcknowledged: true });',
    );
    // It must NOT reach the terminal-cleanup path on a deadline.
    expect(hook).toMatch(/if \(deadlineReached && !signal\.aborted\) \{/);
  });

  test("T-3040-C-03 the acknowledgement loop keeps its own client backstop", () => {
    expect(hook).toContain("export const EVENT_COVER_VIDEO_ACK_DEADLINE_MS = 150_000;");
    expect(hook).toContain("if (Date.now() >= ackDeadlineAt) {");
  });
});

describe("#3040 invariant 1 — never destroy a provider asset mid-processing", () => {
  const ack = repoCode("../supabase/functions/event-cover-video-source-uploaded/index.ts");

  test("T-3040-D-01 the acknowledgement endpoint cannot destroy anything", () => {
    // The #3039 destruction path lived here. The endpoint cannot see whether
    // Bunny is mid-encode, so it is not allowed to delete AT ALL — the import
    // itself is gone, which makes the capability unreachable rather than merely
    // unused. `event-cover-video-reaper` is the single owner of reclamation.
    expect(ack).not.toContain("destroyCoverVideoAsset");
  });

  test("T-3040-D-02 the encode-length acknowledgement deadline is gone", () => {
    // `SOURCE_ACK_DEADLINE_MS` bounded an ENCODE that was mistaken for a
    // transfer, and its breach deleted the asset. Its production mitigation
    // (EVENT_COVER_SOURCE_ACK_DEADLINE_MS raised 90s -> 30min) is likewise dead
    // config once this ships.
    expect(ack).not.toContain("SOURCE_ACK_DEADLINE_MS");
    expect(ack).not.toContain("EVENT_COVER_SOURCE_ACK_DEADLINE_MS");
    expect(ack).not.toContain("source_ack_deadline_exceeded");
  });

  test("T-3040-D-03 exact TUS offset equality is the acknowledgement gate", () => {
    expect(ack).toContain(
      "const complete = uploadOffset === sourceBytes && uploadLength === sourceBytes;",
    );
    expect(ack).toContain('if (transfer.kind === "complete") {');
    // storageSize may be RECORDED, but it may never gate.
    expect(ack).not.toMatch(/if \(storageSize <= 0\)/);
    expect(ack).not.toMatch(/storageSize > MAX_SOURCE_VIDEO_BYTES/);
    // The cap moved onto Bunny's own authoritative upload-length.
    expect(ack).toContain("if (transfer.uploadLength > MAX_SOURCE_VIDEO_BYTES) {");
  });

  test("T-3040-D-04 the expiry death sits AFTER the transfer proof", () => {
    const proofAt = ack.indexOf('if (transfer.kind === "complete") {');
    const expiryAt = ack.indexOf("if (tusExpiresAt !== null && nowMs >= tusExpiresAt) {");
    expect(proofAt).toBeGreaterThan(-1);
    expect(expiryAt).toBeGreaterThan(-1);
    // Ordering IS the fix: #2967 put the expiry check first and gated it on
    // storageSize, which made an expired lease lethal to a fully transferred,
    // still-encoding video.
    expect(expiryAt).toBeGreaterThan(proofAt);
  });
});

describe("#3040 invariant 6 — every terminal failure is retryable by the user", () => {
  test("T-3040-E-01 every failure_code this flow can emit is classified terminal", () => {
    const hook = repoFile("src/hooks/useEventCoverVideoUpload.ts");
    const terminal = hook.slice(
      hook.indexOf("const terminalCodes = new Set(["),
      hook.indexOf("]);", hook.indexOf("const terminalCodes = new Set([")),
    );
    for (
      const code of [
        "source_over_cap",
        "source_transport_expired",
        "source_ack_timeout",
        "event_not_ready",
      ]
    ) {
      expect(terminal).toContain(`"${code}"`);
    }
  });

  test("T-3040-E-02 a terminal error card carries BOTH a retry and a discard", () => {
    const picker = repoFile("src/components/ui/CoverPicker.tsx");
    expect(picker).toContain('label="Try again"');
    expect(picker).toContain('label="Discard upload"');
  });
});
