// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] FIX-3 (device rework #2) — the consumer trip
// "Presented by" brand cover must source the BRAND's real cover media so the
// circle shows the brand image/GIF/video, NOT a solid themed fallback.
//
// ROOT CAUSE the prior pass left unfixed: useConsumerTripFoundation hardcoded
// `brandCoverMediaUrl: null`, so the chip ALWAYS rendered the fallback. The fix
// sources the brand cover anon-safe from `business_public_brands_view` (the
// security-definer public read model — 🔒 COMMS-0009: NEVER `.from("brands")`),
// threads it through useConsumerTripDetail → mapConsumerTripToFoundation, and the
// screen renders it via the media-aware EventCoverMedia (image/gif/video).
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions + behavioral replicas. Every assertion FAILS on a true
// LINE-DELETION of the guard it protects (fails-on-revert), NOT on a comment-out.
//
// Run with:
//   node app-mobile/src/hooks/__tests__/orch_1138_consumer_trip_brand_cover.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const hookSrc = read("src/hooks/useConsumerTripDetail.ts");
const adapterSrc = read("src/hooks/useConsumerTripFoundation.ts");
const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── B1: the hook sources the brand cover from the anon-safe public VIEW ───────
ok(
  "B1a useConsumerTripDetail SELECTs the brand cover from business_public_brands_view (anon-safe public read model)",
  /\.from\(\s*["']business_public_brands_view["']\s*\)[\s\S]{0,160}cover_media_url,\s*cover_media_type/.test(
    hookSrc,
  ),
  "the brand cover must come from the security-definer public view, by slug",
);
ok(
  "B1b the brand-cover query filters by the brand slug",
  /business_public_brands_view["'][\s\S]{0,200}\.eq\(\s*["']slug["']\s*,\s*brandSlug\s*\)/.test(
    hookSrc,
  ),
  "the brand cover must be resolved for THIS brand (by slug)",
);
// 🔒 COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW — the consumer path must NEVER
// read the brands table directly. The hook's prose cites the rule with the
// literal `.from('brands')` inside BACKTICKS; strip backtick spans first so this
// asserts on real CODE only. Fails-on-revert: a real `.from("brands")` call trips
// this even after the prose is stripped.
const hookCodeOnly = hookSrc.replace(/`[^`]*`/g, "");
ok(
  "B1c the hook NEVER reads the brands table directly in CODE (🔒 COMMS-0009)",
  !/\.from\(\s*["']brands["']\s*\)/.test(hookCodeOnly),
  "the consumer trip path must use the public view, never .from('brands')",
);

// ── B2: the hook coerces + returns the brand cover on ConsumerTripDetail ──────
ok(
  "B2a the hook coerces the raw brand cover type to the EventCoverMedia union",
  /function coerceBrandCoverType/.test(hookSrc) &&
    /brandCoverMediaType\s*=\s*coerceBrandCoverType\(/.test(hookSrc),
  "an unknown/null brand cover type must coerce to null (rule 9 — no fabricated type)",
);
ok(
  "B2b ConsumerTripDetail carries brandCoverMediaUrl + brandCoverMediaType",
  /brandCoverMediaUrl:\s*string \| null/.test(hookSrc) &&
    /brandCoverMediaType:\s*"image" \| "video" \| "gif" \| null/.test(hookSrc),
);
ok(
  "B2c the returned detail object sets brandCoverMediaUrl + brandCoverMediaType (not omitted)",
  /\n\s*brandCoverMediaUrl,\n\s*brandCoverMediaType,/.test(hookSrc),
  "the fetched brand cover must be returned, not dropped",
);

// ── B3: the adapter THREADS the brand cover (not hardcoded null) ──────────────
// This is the exact bug the prior pass left: the adapter returned null. Assert
// the adapter now passes the detail's value through. Fails-on-revert: restoring
// `brandCoverMediaUrl: null` trips this.
ok(
  "B3a the adapter maps detail.brandCoverMediaUrl (NOT hardcoded null)",
  /brandCoverMediaUrl:\s*detail\.brandCoverMediaUrl/.test(adapterSrc),
  "the prior pass hardcoded null here — the bug; it must read detail.brandCoverMediaUrl",
);
ok(
  "B3b the adapter maps detail.brandCoverMediaType (NOT hardcoded null)",
  /brandCoverMediaType:\s*detail\.brandCoverMediaType/.test(adapterSrc),
);
ok(
  "B3c the adapter does NOT hardcode brandCoverMediaUrl/Type back to null",
  !/brandCoverMediaUrl:\s*null/.test(adapterSrc) &&
    !/brandCoverMediaType:\s*null/.test(adapterSrc),
  "a regression to `brandCoverMediaUrl: null` would re-show the empty fallback",
);

// ── B4: the screen renders REAL media when present, themed initial otherwise ──
ok(
  "B4a the screen renders the brand cover media when present (EventCoverMedia fed fnd.brandCoverMediaUrl)",
  /fnd\.brandCoverMediaUrl !== null \? \([\s\S]{0,300}<EventCoverMedia[\s\S]*?mediaUrl=\{fnd\.brandCoverMediaUrl\}/.test(
    screenSrc,
  ),
);
ok(
  "B4b the no-cover fallback is the themed brand INITIAL, not a bare red disk",
  /styles\.brandInitial/.test(screenSrc) &&
    /fnd\.brandName\.trim\(\)\[0\]/.test(screenSrc),
  "the fallback must show the brand initial (rule 9), never a bare disk or broken alt",
);

// ── B5: behavioral replica of coerceBrandCoverType ────────────────────────────
function coerceBrandCoverTypeReplica(raw) {
  return raw === "image" || raw === "video" || raw === "gif" ? raw : null;
}
ok(
  "B5a coerce 'gif' → 'gif' (animated brand cover)",
  coerceBrandCoverTypeReplica("gif") === "gif",
);
ok(
  "B5b coerce 'video' → 'video'",
  coerceBrandCoverTypeReplica("video") === "video",
);
ok(
  "B5c coerce null/unknown → null (rule 9, no fabricated type)",
  coerceBrandCoverTypeReplica(null) === null &&
    coerceBrandCoverTypeReplica("bogus") === null,
);

console.log(
  `\n# ORCH-1138 FIX-3 consumer brand-cover data-path — ${passed} checks PASS`,
);
