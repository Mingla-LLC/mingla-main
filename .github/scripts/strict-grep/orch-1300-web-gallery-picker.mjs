#!/usr/bin/env node
/**
 * ORCH-1300 [web-gallery-picker] — strict-grep gate.
 *
 * WHY: on business WEB the venue gallery "Add photos" button was a silent dead
 * tap. `venueGalleryService.pickGalleryPhotos` called `launchImageLibraryAsync`
 * from `platformImagePicker`, whose WEB variant is a permanent-cancel STUB
 * (`{ canceled: true, assets: [] }`, no file input). The pick always returned
 * empty, the handler bailed with no feedback (Constitution #1 no-dead-taps + #3
 * no-silent-failures). The hero COVER path was made web-safe by ORCH-1097
 * (`coverPickerDeviceMedia.ts` → `pickBrowserFiles`) and locked by its CI guard,
 * but that guard never covered the gallery — so the gallery shipped on the stub.
 *
 * FIX (ORCH-1300, mirroring ORCH-1097's cover split): the gallery picker is now
 * platform-split — `venueGalleryDeviceMedia.ts` (web) routes through the shared,
 * CI-guarded `pickBrowserFiles` (`<input type=file multiple accept="image/*">`,
 * capped at the remaining slots); `venueGalleryDeviceMedia.native.ts` keeps the
 * unchanged expo-image-picker path. `venueGalleryService` consumes the split,
 * NOT the raw `platformImagePicker` stub.
 *
 * RULE (structural anti-recurrence) — all must hold, else exit non-zero:
 *   A. venueGalleryDeviceMedia.ts (WEB) routes through pickBrowserFiles with
 *      multi-select (`multiple: true`) and a `maxFiles` remaining-slots cap, is
 *      NOT a permanent-cancel stub (`canceled: true` literal), and does NOT
 *      import expo-image-picker (the web bundle must never pull the native
 *      picker back in).
 *   B. venueGalleryDeviceMedia.native.ts (NATIVE) still routes the gallery
 *      through `launchImageLibraryAsync` from `../utils/platformImagePicker`
 *      (the native expo path) and does NOT import the web `browserFilePicker`
 *      (native must not resolve the browser input).
 *   C. venueGalleryService.ts consumes `launchGalleryImagePicker` from
 *      `./venueGalleryDeviceMedia` and does NOT import `launchImageLibraryAsync`
 *      directly from `../utils/platformImagePicker` (that direct import IS the
 *      web-stub bug ORCH-1300 fixed).
 *
 * Comment-stripped before scanning (the rationale comments name the very tokens
 * the gate asserts). Self-test: `--self-test` proves the GOOD shapes pass and
 * each reverted BAD shape fails.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const WEB_REL = "mingla-business/src/services/venueGalleryDeviceMedia.ts";
const NATIVE_REL = "mingla-business/src/services/venueGalleryDeviceMedia.native.ts";
const SERVICE_REL = "mingla-business/src/services/venueGalleryService.ts";

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

/** Scan the WEB split (rule A). */
function scanWeb(src) {
  const failures = [];
  const s = normalize(src);
  if (!/pickBrowserFiles\s*\(/.test(s)) {
    failures.push(
      "A: venueGalleryDeviceMedia.ts (web) no longer calls pickBrowserFiles(...) " +
        "— the venue gallery reverted to a picker that opens no browser file " +
        "input, re-creating the silent web dead tap (ORCH-1300).",
    );
  }
  if (!/multiple\s*:\s*true/.test(s)) {
    failures.push(
      "A: venueGalleryDeviceMedia.ts (web) no longer requests multi-select " +
        "(multiple: true) — the gallery must let the operator pick many photos " +
        "at once (ORCH-1300).",
    );
  }
  if (!/maxFiles\s*:/.test(s)) {
    failures.push(
      "A: venueGalleryDeviceMedia.ts (web) no longer passes a maxFiles cap — the " +
        "selection must be hard-capped at the remaining gallery slots (ORCH-1300).",
    );
  }
  if (/canceled\s*:\s*true/.test(s)) {
    failures.push(
      "A: venueGalleryDeviceMedia.ts (web) contains a `canceled: true` literal — " +
        "the permanent-cancel STUB is back and the gallery is a silent dead tap " +
        "again (ORCH-1300).",
    );
  }
  if (/expo-image-picker/.test(s)) {
    failures.push(
      "A: venueGalleryDeviceMedia.ts (web) imports expo-image-picker — the native " +
        "picker must stay quarantined to the .native split; the web bundle uses " +
        "pickBrowserFiles only (ORCH-1300 / ORCH-1097 web-media contract).",
    );
  }
  return failures;
}

/** Scan the NATIVE split (rule B). */
function scanNative(src) {
  const failures = [];
  const s = normalize(src);
  if (!/launchImageLibraryAsync/.test(s) || !/platformImagePicker/.test(s)) {
    failures.push(
      "B: venueGalleryDeviceMedia.native.ts no longer routes the gallery through " +
        "launchImageLibraryAsync from ../utils/platformImagePicker — native lost " +
        "its real expo photo-library picker (ORCH-1300 must not touch native).",
    );
  }
  if (/browserFilePicker/.test(s) || /pickBrowserFiles/.test(s)) {
    failures.push(
      "B: venueGalleryDeviceMedia.native.ts imports the web browserFilePicker — " +
        "the browser <input type=file> must never resolve on native (ORCH-1300).",
    );
  }
  return failures;
}

/** Scan the service (rule C). */
function scanService(src) {
  const failures = [];
  const s = normalize(src);
  if (!/launchGalleryImagePicker/.test(s) || !/venueGalleryDeviceMedia/.test(s)) {
    failures.push(
      "C: venueGalleryService.ts no longer consumes launchGalleryImagePicker " +
        "from ./venueGalleryDeviceMedia — the gallery pick bypasses the " +
        "platform-split web picker (ORCH-1300).",
    );
  }
  // The pre-ORCH-1300 bug: importing launchImageLibraryAsync straight from the
  // platformImagePicker stub. `import ... from "../utils/platformImagePicker"`
  // must not reappear as the gallery pick source.
  if (
    /import[\s\S]{0,160}launchImageLibraryAsync[\s\S]{0,160}from\s*["']\.\.\/utils\/platformImagePicker["']/.test(
      s,
    )
  ) {
    failures.push(
      "C: venueGalleryService.ts imports launchImageLibraryAsync directly from " +
        "../utils/platformImagePicker again — that is the web-STUB bug ORCH-1300 " +
        "fixed; route through ./venueGalleryDeviceMedia instead.",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const WEB_OK = `
    import { pickBrowserFiles } from "../utils/browserFilePicker";
    export async function launchGalleryImagePicker(remainingSlots) {
      const result = await pickBrowserFiles({
        accept: "image/*", multiple: true, maxFiles: remainingSlots, validate: false,
      });
      return { canceled: result.canceled, assets: result.files.map((f) => ({ uri: f.uri })) };
    }`;
  const WEB_BAD_STUB = `
    export async function launchGalleryImagePicker(_remainingSlots) {
      return { canceled: true, assets: [] };
    }`;
  const WEB_BAD_EXPO = `
    import * as ImagePicker from "expo-image-picker";
    export async function launchGalleryImagePicker(remainingSlots) {
      return ImagePicker.launchImageLibraryAsync({ selectionLimit: remainingSlots });
    }`;
  const NATIVE_OK = `
    import { launchImageLibraryAsync } from "../utils/platformImagePicker";
    export async function launchGalleryImagePicker(remainingSlots) {
      const result = await launchImageLibraryAsync({ allowsMultipleSelection: true, selectionLimit: remainingSlots });
      return { canceled: result.canceled, assets: result.assets };
    }`;
  const NATIVE_BAD = `
    import { pickBrowserFiles } from "../utils/browserFilePicker";
    export async function launchGalleryImagePicker(remainingSlots) {
      return pickBrowserFiles({ multiple: true, maxFiles: remainingSlots });
    }`;
  const SERVICE_OK = `
    import { launchGalleryImagePicker } from "./venueGalleryDeviceMedia";
    export async function pickGalleryPhotos(remainingSlots) {
      const result = await launchGalleryImagePicker(remainingSlots);
      if (result.canceled) return [];
      return result.assets;
    }`;
  const SERVICE_BAD = `
    import { launchImageLibraryAsync } from "../utils/platformImagePicker";
    export async function pickGalleryPhotos(remainingSlots) {
      const result = await launchImageLibraryAsync({ selectionLimit: remainingSlots });
      if (result.canceled) return [];
      return result.assets;
    }`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1300 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1300 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  // GOOD shapes pass.
  check("web GOOD", scanWeb(WEB_OK), false);
  check("native GOOD", scanNative(NATIVE_OK), false);
  check("service GOOD", scanService(SERVICE_OK), false);

  // BAD shapes (each a plausible revert) fail.
  check("web BAD (permanent-cancel stub)", scanWeb(WEB_BAD_STUB), true);
  check("web BAD (expo-image-picker on web)", scanWeb(WEB_BAD_EXPO), true);
  check("native BAD (web picker on native)", scanNative(NATIVE_BAD), true);
  check("service BAD (direct platformImagePicker stub import)", scanService(SERVICE_BAD), true);

  console.log(
    "ORCH-1300 gate self-test PASS (7/7: 3 fixed shapes pass; 4 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1300 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanWeb(read(WEB_REL)),
  ...scanNative(read(NATIVE_REL)),
  ...scanService(read(SERVICE_REL)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1300 gate FAIL — the venue gallery web photo picker regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nOn business WEB the gallery picker MUST route through the real browser " +
      "file input (pickBrowserFiles), mirroring the ORCH-1097 cover path, never " +
      "the permanent-cancel platformImagePicker stub. See ORCH-1300.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1300 gate PASS — web gallery split routes through pickBrowserFiles " +
    "(multi-select, remaining-slots cap); native keeps expo-image-picker; " +
    "venueGalleryService consumes the split, not the web stub.",
);
