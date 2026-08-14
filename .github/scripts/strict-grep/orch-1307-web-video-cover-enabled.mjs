#!/usr/bin/env node
/**
 * ORCH-1307 [web-video-cover] — strict-grep gate.
 *
 * WHY: the CoverPicker video button was hard-gated OFF on mobile web via an
 * `isPhoneWeb` flag (`Platform.OS === "web" && window.innerWidth < 768`): the
 * button was `disabled={uploading || disabled || isPhoneWeb}`, `pickVideoCover`
 * early-returned with "Video cover uploads are available on desktop or in the
 * app for now.", and the sheet showed desktop-only copy. Deterministically
 * confirmed live on Seth's Samsung (innerWidth 384 → button disabled=true).
 * Meanwhile Bunny's TUS endpoint accepts browser uploads (preflight:
 * access-control-allow-origin *), so a clip within the 33s ceiling uploads fine
 * on mobile web too. Seth's call (2026-07-04): enable mobile-web video; for a
 * clip the web can't trim (no web trimmer — react-native-video-trim is
 * native-only), show an actionable message instead of a dead-end.
 *
 * FIX (ORCH-1307): the `isPhoneWeb` video gate is REMOVED entirely — the video
 * button is `disabled={uploading || disabled}` (no phone-web term),
 * `pickVideoCover` has no isPhoneWeb early return, and the over-ceiling toast is
 * platform-aware (native keeps "trim to 29s"; web gets "pick a shorter clip /
 * trim in the app").
 *
 * RULE (structural anti-recurrence) — all must hold against CoverPicker.tsx
 * (comment-stripped before scanning), else exit non-zero:
 *   A. NO `isPhoneWeb` token anywhere (the phone-web video gate is gone and must
 *      not creep back).
 *   B. NO "Video cover uploads are available on desktop or in the app for now."
 *      copy (the desktop-only gate message is gone).
 *   C. The video button's `disabled` is exactly `{uploading || disabled}` and
 *      NOT `{uploading || disabled || isPhoneWeb}` (no re-gating).
 *   D. The web helper copy "video covers upload the clip as-is" is present (web
 *      users are told the as-is/30s behavior).
 *
 * Self-test (`--self-test`): the GOOD (post-fix) shape passes; each reverted BAD
 * shape (gate re-added / copy back / disabled re-gated) fails.
 * Invariant I-PROPOSED-1307-WEB-VIDEO-COVER-ENABLED.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const PICKER_REL = "mingla-business/src/components/ui/CoverPicker.tsx";

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so multi-line exprs match on a single normalized line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Scan CoverPicker (rules A–D). */
function scanPicker(src) {
  const failures = [];
  const stripped = stripComments(src);
  const s = normalize(src);

  if (/isPhoneWeb/.test(stripped)) {
    failures.push(
      "A: CoverPicker.tsx contains `isPhoneWeb` again — the phone-web video gate " +
        "is back; mobile web must NOT be blocked from video covers (ORCH-1307).",
    );
  }
  if (/Video cover uploads are available on desktop or in the app for now\./.test(stripped)) {
    failures.push(
      "B: CoverPicker.tsx contains the desktop-only gate copy again — mobile web " +
        "is no longer gated out of video covers (ORCH-1307).",
    );
  }
  if (/disabled=\{\s*uploading\s*\|\|\s*disabled\s*\|\|\s*isPhoneWeb\s*\}/.test(s)) {
    failures.push(
      "C: CoverPicker.tsx re-gates the video button with " +
        "`disabled={uploading || disabled || isPhoneWeb}` — drop the isPhoneWeb " +
        "term; the button is enabled on mobile web (ORCH-1307).",
    );
  }
  if (!/video covers upload the clip as-is/.test(s)) {
    failures.push(
      "D: CoverPicker.tsx no longer tells web users the as-is/30s behavior " +
        '("video covers upload the clip as-is") — keep the actionable web copy ' +
        "(ORCH-1307).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const isNative = Platform.OS !== "web";
    // pickVideoCover has no isPhoneWeb early return
    <Button label="Video" onPress={onPickVideo} disabled={uploading || disabled} />
    {Platform.OS === "web" ? (
      <Text>On the web, video covers upload the clip as-is, up to 30 seconds. To
        trim a longer clip, use the Mingla Host app.</Text>
    ) : null}`;
  const BAD_GATE_BACK = `
    const isPhoneWeb = Platform.OS === "web" && window.innerWidth < 768;
    <Button label="Video" onPress={onPickVideo} disabled={uploading || disabled} />
    {Platform.OS === "web" ? (<Text>video covers upload the clip as-is</Text>) : null}`;
  const BAD_COPY_BACK = `
    <Button label="Video" onPress={onPickVideo} disabled={uploading || disabled} />
    <Text>Video cover uploads are available on desktop or in the app for now.</Text>
    <Text>video covers upload the clip as-is</Text>`;
  const BAD_DISABLED_REGATED = `
    <Button label="Video" onPress={onPickVideo} disabled={uploading || disabled || isPhoneWeb} />
    <Text>video covers upload the clip as-is</Text>`;
  const BAD_WEB_COPY_GONE = `
    <Button label="Video" onPress={onPickVideo} disabled={uploading || disabled} />
    {Platform.OS === "web" ? (<Text>Some other copy.</Text>) : null}`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1307 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1307 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("picker GOOD (gate removed)", scanPicker(GOOD), false);
  check("picker BAD (isPhoneWeb gate back)", scanPicker(BAD_GATE_BACK), true);
  check("picker BAD (desktop-only copy back)", scanPicker(BAD_COPY_BACK), true);
  check("picker BAD (video button re-gated)", scanPicker(BAD_DISABLED_REGATED), true);
  check("picker BAD (web as-is copy gone)", scanPicker(BAD_WEB_COPY_GONE), true);

  console.log(
    "ORCH-1307 gate self-test PASS (5/5: fixed shape passes; 4 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1307 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanPicker(read(PICKER_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1307 gate FAIL — the mobile-web video cover gate regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nMobile web MUST be able to upload video covers (no isPhoneWeb gate); " +
      "clips within the 33s ceiling upload as-is (Bunny TUS accepts browser " +
      "uploads), and an over-30s clip gets an actionable web message since the " +
      "web has no trimmer. See ORCH-1307.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1307 gate PASS — CoverPicker has no isPhoneWeb video gate; the video " +
    "button is enabled on mobile web; the web as-is/30s copy is present.",
);
