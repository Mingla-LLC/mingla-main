#!/usr/bin/env node
/**
 * ISSUE-1158 [Dependabot semver-trap: @vercel/og dragged to the broken 1.0.0
 * mispublish] — OG RENDER SMOKE. Companion to
 * issue-1158-vercel-og-semver-trap-pin-check.mjs (the static version-floor/ceiling
 * gate). This gate is the RUNTIME half: it actually renders an OG card.
 *
 * WHY A RUNTIME SMOKE (defense-in-depth beyond the static pin):
 *   1. Under the broken @vercel/og@1.0.0, `await import("@vercel/og")` throws
 *      `ERR_MODULE_NOT_FOUND: 'wbg'` (a 2023 WASM-only build). The static gate
 *      catches the *version* (1.0.0 in the lockfile); this gate catches the
 *      *behaviour* — ANY future parent breakage that still satisfies the version
 *      bounds but fails to render (e.g. a bad 0.11.x republish) reds CI here.
 *   2. #1158 forces `sharp` to `0.35.3` via an npm override — one minor ABOVE
 *      @vercel/og@0.11.1's declared `^0.34.5` optional-dep cap (to close the 2026
 *      libvips advisory GHSA-f88m-g3jw-g9cj). This gate is the empirical proof
 *      (SPEC §4.3 Open Question O-1, resolved Path A) that @vercel/og@0.11.1 still
 *      renders a valid PNG when driven against `sharp 0.35.3`. The embedded logo is
 *      a base64 PNG rendered through an <img>, so sharp decodes it even for a
 *      cover-less card — this smoke genuinely exercises sharp.
 *
 * WHAT IT DOES: requires the REAL mingla-business/server/socialPreview.js and
 * calls its exported `renderOgPng` with a minimal event card (coverUrl:null). It
 * asserts the returned value is a Buffer that begins with the PNG magic bytes
 * (89 50 4E 47 0D 0A 1A 0A) and is longer than 1000 bytes. It renders NOTHING to
 * disk, mutates no state, and hits no network (cover is null; the logo is a local
 * base64 data URI).
 *
 * DEPENDENCIES: needs mingla-business's node_modules populated (react, @vercel/og,
 * and the native sharp binary). It therefore runs in strict-grep CLASS C — the
 * only lane whose job installs mingla-business deps
 * (`npm install --no-save` in mingla-business, honoring the overrides so sharp
 * resolves to 0.35.3) before invoking run-batch.mjs --class C. NOT class A (which
 * has no app deps installed).
 *
 * FAILS-ON-REVERT: dragging @vercel/og back to 1.0.0 (the import throws) OR any
 * @vercel/og/sharp combination that fails to render a valid PNG makes this gate
 * exit non-zero. A green run means a real OG card actually rendered.
 *
 * Exit codes: 0 valid PNG rendered, 1 render/assert failure (the OG bug), 2 setup
 * error (socialPreview.js not found / deps not installed).
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SOCIAL_PREVIEW = path.join(REPO_ROOT, "mingla-business", "server", "socialPreview.js");

// PNG signature — the first 8 bytes of every PNG file.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_BYTES = 1000;

async function main() {
  if (!fs.existsSync(SOCIAL_PREVIEW)) {
    console.error(
      `ISSUE-1158 og-render-smoke: cannot find ${path.relative(REPO_ROOT, SOCIAL_PREVIEW)} — the OG renderer moved or the ` +
        `checkout is incomplete. This is a setup error, not a render failure.`,
    );
    process.exit(2);
  }

  const require = createRequire(import.meta.url);
  let renderOgPng;
  try {
    // socialPreview.js is CommonJS; resolve react + @vercel/og from
    // mingla-business/node_modules (walked up from the required file).
    ({ renderOgPng } = require(SOCIAL_PREVIEW));
  } catch (err) {
    console.error(
      `ISSUE-1158 og-render-smoke: FAILED to load the OG renderer (require of socialPreview.js threw). In CLASS C this means ` +
        `mingla-business deps were not installed (react / @vercel/og / sharp), OR @vercel/og itself failed to load — the exact ` +
        `symptom of the 1.0.0 mispublish drag (ERR_MODULE_NOT_FOUND: 'wbg').`,
    );
    console.error(err && err.stack ? err.stack : String(err));
    // A require throw that is the @vercel/og WASM failure IS the bug → exit 1.
    process.exit(1);
  }

  if (typeof renderOgPng !== "function") {
    console.error(
      `ISSUE-1158 og-render-smoke: socialPreview.js does not export a renderOgPng function (got ${typeof renderOgPng}).`,
    );
    process.exit(2);
  }

  let buffer;
  try {
    buffer = await renderOgPng({
      cardKind: "event",
      title: "Smoke",
      subtitle: "x",
      kicker: "Mingla",
      coverUrl: null,
      dateLabel: "",
      locationLabel: "",
    });
  } catch (err) {
    console.error(
      `ISSUE-1158 og-render-smoke: renderOgPng THREW while rendering. Under the broken @vercel/og@1.0.0 the ` +
        `await import("@vercel/og") throws ERR_MODULE_NOT_FOUND: 'wbg'; a sharp/@vercel/og incompatibility would throw here too. ` +
        `Every business OG share-preview would render zero images. Issue #1158.`,
    );
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }

  const isBuffer = Buffer.isBuffer(buffer);
  const magicOk = isBuffer && buffer.subarray(0, 8).equals(PNG_MAGIC);
  const len = isBuffer ? buffer.length : -1;

  if (!isBuffer) {
    console.error(`ISSUE-1158 og-render-smoke: renderOgPng returned ${typeof buffer}, not a Buffer. Expected a PNG Buffer.`);
    process.exit(1);
  }
  if (!magicOk) {
    console.error(
      `ISSUE-1158 og-render-smoke: the rendered buffer does not begin with the PNG magic bytes ` +
        `(got ${buffer.subarray(0, 8).toString("hex")}, expected ${PNG_MAGIC.toString("hex")}). Not a valid PNG.`,
    );
    process.exit(1);
  }
  if (len <= MIN_BYTES) {
    console.error(
      `ISSUE-1158 og-render-smoke: the rendered PNG is only ${len} bytes (<= ${MIN_BYTES}); a real 1200x630 OG card is far larger. ` +
        `Suspect a degenerate render.`,
    );
    process.exit(1);
  }

  console.log(
    `ISSUE-1158 og-render-smoke PASS — renderOgPng returned a valid PNG (magic ${buffer.subarray(0, 8).toString("hex")}, ${len} bytes). ` +
      `@vercel/og@0.11.1 renders correctly under the pinned sharp; the OG share-preview path is intact.`,
  );
  process.exit(0);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error(`ISSUE-1158 og-render-smoke script error: ${err && err.stack ? err.stack : String(err)}`);
    process.exit(2);
  });
}
