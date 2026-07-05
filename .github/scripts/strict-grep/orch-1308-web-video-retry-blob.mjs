#!/usr/bin/env node
/**
 * ORCH-1308 [web-video-retry-blob] — strict-grep gate (2nd invariant).
 *
 * WHY: on web the cover video upload reads the picked clip via
 * `fetch(blob:uri)`. `pickVideoCover` revoked that blob in its `finally` (right
 * after `videoUpload.start`), so the "Upload failed - try again" button —
 * which re-runs `videoUpload.start(lastVideoUploadFileRef.current)` with the
 * SAME uri — re-fetched a DEAD blob and failed with "Could not read the
 * selected video in your browser." (deterministically reproduced on Seth's
 * Samsung after the integer fix let the flow reach the upload). Native is
 * unaffected (its assets carry no objectUrl, so the revoke is a no-op).
 *
 * FIX (ORCH-1308): retain the picked video blob across a retry via
 * `pickedVideoAssetsRef`. Free the PREVIOUS pick's blob at the START of the next
 * pick, and the current one on unmount — NOT in the pick's finally. The video
 * upload's finally must NOT revoke the just-picked blob.
 *
 * RULE — all must hold against CoverPicker.tsx (comment-stripped), else fail:
 *   A. `pickedVideoAssetsRef` exists and is assigned from a fresh pick
 *      (`pickedVideoAssetsRef.current = result.assets`).
 *   B. an unmount cleanup revokes `pickedVideoAssetsRef.current`.
 *   C. the video upload path does NOT revoke a blob between
 *      `videoUpload.start(uploadFile)` and its `setUploading(false)` (the finally
 *      must not kill the blob the retry needs).
 *
 * Self-test (`--self-test`): the GOOD (post-fix) shape passes; the BAD
 * (revoke-in-finally) revert fails. Invariant I-PROPOSED-1308-WEB-VIDEO-RETRY-BLOB.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const PICKER_REL = "mingla-business/src/components/ui/CoverPicker.tsx";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

function scanPicker(src) {
  const failures = [];
  const s = normalize(src);

  if (!/pickedVideoAssetsRef\.current\s*=\s*result\.assets/.test(s)) {
    failures.push(
      "A: CoverPicker.tsx no longer retains the picked video blob " +
        "(`pickedVideoAssetsRef.current = result.assets`) — the retry path can't " +
        "re-read the clip (ORCH-1308).",
    );
  }
  if (!/revokeCoverPickedAssets\(\s*pickedVideoAssetsRef\.current\s*\)/.test(s)) {
    failures.push(
      "B: CoverPicker.tsx no longer frees the retained video blob via " +
        "`revokeCoverPickedAssets(pickedVideoAssetsRef.current)` (next pick / " +
        "unmount) — either a leak or the retention was removed (ORCH-1308).",
    );
  }
  // C: the video upload path must not revoke a blob after start (finally).
  const m = s.match(
    /videoUpload\.start\(uploadFile\)[\s\S]*?setUploading\(false\)/,
  );
  if (m === null) {
    failures.push(
      "C: CoverPicker.tsx video upload shape changed — cannot locate the " +
        "start(uploadFile)…setUploading(false) block to verify no blob revoke " +
        "(ORCH-1308).",
    );
  } else if (/revokeCoverPickedAssets/.test(m[0])) {
    failures.push(
      "C: CoverPicker.tsx revokes a picked blob in the video upload finally " +
        "(between videoUpload.start and setUploading(false)) — this kills the " +
        "blob the 'try again' retry re-fetches on web (ORCH-1308).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const pickedVideoAssetsRef = useRef([]);
    useEffect(() => () => { revokeCoverPickedAssets(pickedVideoAssetsRef.current); }, []);
    const pickVideoCover = async () => {
      setUploading(true);
      try {
        const result = await launchCoverVideoPicker();
        if (result.canceled) return;
        revokeCoverPickedAssets(pickedVideoAssetsRef.current);
        pickedVideoAssetsRef.current = result.assets;
        lastVideoUploadFileRef.current = uploadFile;
        await videoUpload.start(uploadFile);
      } catch (e) { onShowToast("x"); }
      finally { setUploading(false); }
    };`;
  const BAD_REVOKE_IN_FINALLY = `
    const pickedVideoAssetsRef = useRef([]);
    useEffect(() => () => { revokeCoverPickedAssets(pickedVideoAssetsRef.current); }, []);
    const pickVideoCover = async () => {
      let pickedAssets = [];
      try {
        const result = await launchCoverVideoPicker();
        pickedAssets = result.assets;
        pickedVideoAssetsRef.current = result.assets;
        await videoUpload.start(uploadFile);
      } catch (e) { onShowToast("x"); }
      finally { revokeCoverPickedAssets(pickedAssets); setUploading(false); }
    };`;
  const BAD_NO_RETENTION = `
    const pickVideoCover = async () => {
      let pickedAssets = [];
      try {
        const result = await launchCoverVideoPicker();
        pickedAssets = result.assets;
        await videoUpload.start(uploadFile);
      } finally { setUploading(false); }
    };`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1308 retry-blob self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1308 retry-blob self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("picker GOOD (blob retained)", scanPicker(GOOD), false);
  check("picker BAD (revoke in finally)", scanPicker(BAD_REVOKE_IN_FINALLY), true);
  check("picker BAD (no retention)", scanPicker(BAD_NO_RETENTION), true);

  console.log("ORCH-1308 retry-blob gate self-test PASS (3/3).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1308 retry-blob gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanPicker(read(PICKER_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1308 retry-blob gate FAIL — the web video 'try again' path regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe picked video blob MUST survive a retry (web reads it via " +
      "fetch(blob:uri)); free it on the next pick / unmount, never in the pick's " +
      "finally. See ORCH-1308.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1308 retry-blob gate PASS — the picked video blob is retained across " +
    "retry (pickedVideoAssetsRef) and freed on next pick / unmount.",
);
