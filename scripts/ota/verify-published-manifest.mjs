#!/usr/bin/env node
// #994 — WHY THIS MODULE EXISTS.
//
// Five production OTAs have been published without `--environment production`.
// Every one of them exited 0. Twice it shipped: the business app stuck on its
// splash screen (#990, loud) and the consumer app looked completely normal for
// forty minutes while checkout was silently dead (2026-08-06).
//
// `eas update`'s exit code is NOT evidence of a correct publish. The ONLY
// evidence is the manifest the CDN will actually serve to phones. This module
// downloads that manifest, per platform, AFTER the publish, and asserts the
// expected `EXPO_PUBLIC_*` values are really in its `extra`.
//
// An unset variable does not serialize as `null` or as an absent key — it
// serializes as `{}`. That is the UNSET SIGNATURE, verified against the real
// 2026-08-06 manifest and reproduced locally against `expo config --json`. It
// is checked FIRST, and named in the failure output, because it is the shape a
// human skims past.
/**
 * #994 [ota-publish-guardrails] — I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND
 * (DRAFT; flips ACTIVE at CLOSE). SPEC §4.3.
 *
 * WHAT IT ENFORCES
 *   1. THE PUBLISH IS IDENTIFIABLE. `parseUpdateJson` reads the `eas update
 *      --json` array and finds the entry for the platform that was just
 *      published. Zero entries, no entry for that platform, or an empty
 *      `manifestPermalink` means the publish happened but is UNVERIFIABLE —
 *      exit 2, never a pass (V-5).
 *   2. THE SERVED MANIFEST IS REALLY A MANIFEST. Non-200, a body that is not
 *      JSON, or a JSON object lacking `id` / `extra` / `launchAsset` is exit 2
 *      (V-1, V-2). iOS may answer `application/expo+json` and Android
 *      `multipart/mixed`; both shapes are handled, and a multipart body whose
 *      `manifest` part is missing is exit 2, never "no violations found".
 *   3. THE APP CONFIG `extra` IS FOUND AT ITS REAL PATH. A served manifest does
 *      NOT carry the app config's `extra` at the top level. The manifest's own
 *      `extra` is a WRAPPER holding exactly `expoClient` / `eas` / `scopeKey`,
 *      and the app config `extra` — the only node that holds EXPO_PUBLIC_*
 *      values — is nested one level down at `extra.expoClient.extra`
 *      (`resolveAppExtra`). Reading the wrapper instead makes every assertion
 *      below unreachable; that shipped once and is now V-6, exit 2, never a pass.
 *   4. THE EXPECTED KEYS CARRY REAL VALUES. `assertExtra` checks, per key and
 *      IN THIS ORDER: `{}` (UNSET SIGNATURE) -> absent/null -> non-string ->
 *      empty -> wrong prefix. A required key failing any of these is exit 1.
 *   5. THE CHECK CANNOT PASS VACUOUSLY. A RESOLVED app `extra` with fewer than
 *      5 keys, or an empty expectation table, is exit 2 (V-3, V-4). Measured on
 *      six genuine production permalinks (2026-08-09/10): the resolved node
 *      holds 15 keys on app-mobile and 16 on mingla-business, so 5 is a real
 *      floor with headroom. The floor applies to the RESOLVED node — applying
 *      it to the 3-key wrapper is what made this check unfalsifiable before.
 *
 * THE SHAPE IS MEASURED, NOT ASSUMED — AND THE FIXTURES MATCH THE WIRE.
 *   The first version of this module was green on 25/25 self-test cases while
 *   failing on 6/6 real manifests, because its fixtures used the FLAT shape
 *   `expo config --json` emits rather than the nested shape u.expo.dev serves.
 *   Fixtures that do not match reality are how that shipped. `realWireManifest`
 *   below is built from a read-only capture of six genuine production
 *   permalinks, and self-test case 31 FAILS if that fixture is ever flattened
 *   back to the config shape.
 *
 * THE EXPECTATION TABLES ARE DELIBERATELY SHORT — DO NOT PAD THEM.
 *   Only a key that (a) reaches `extra` and (b) has NO committed literal
 *   fallback can distinguish a blind publish from a correct one. A key with a
 *   literal fallback resolves identically either way and would be a FAKE check.
 *
 *   `consumer` holds exactly TWO keys, and both earn their place.
 *     · `EXPO_PUBLIC_POSTHOG_KEY` — the original CANARY for whether
 *       `--environment production` was applied at all. Until #1733 it was the
 *       app's ONLY tripwire, i.e. a single point of failure for the whole
 *       guardrail: one key acquiring a literal fallback would have retired the
 *       consumer half of this check in silence.
 *     · `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — added at #1733, prefix-checked
 *       `pk_live_`. `app-mobile/app.config.js` now emits it into `extra` with a
 *       `null` (never literal) local fallback, so the key that actually went
 *       missing on 2026-08-06 is DIRECTLY measurable here instead of covered by
 *       the transitive argument below.
 *   Every OTHER consumer entry (the AppsFlyer trio, the PostHog host, the four
 *   Google client IDs) carries a committed literal fallback and would pass
 *   identically on a blind publish. Adding `EXPO_PUBLIC_APPSFLYER_DEV_KEY` here
 *   would look like more coverage and would be none.
 *
 *   `business` deliberately EXCLUDES `EXPO_PUBLIC_POSTHOG_KEY`, which on that
 *   app has a committed literal fallback (`app.config.js`) and therefore always
 *   passes. It also excludes `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`: SPEC §3.4-V1
 *   made that entry conditional on the variable existing in the EAS production
 *   environment, and the IMPLEMENT-phase read-only check (2026-08-09,
 *   `eas env:list --environment production` in `mingla-business`) found it
 *   ABSENT. A required check on a value the environment never had would abort
 *   every correct publish.
 *
 * WHAT THIS MODULE DOES NOT PROVE — read before citing it as proof.
 *   - It does NOT prove `EXPO_PUBLIC_SENTRY_DSN` (business) or
 *     `EXPO_PUBLIC_MIXPANEL_TOKEN` (either app) are inlined in the Hermes
 *     bytecode. Those are read statically from `process.env` and never reach
 *     `extra`. They are covered TRANSITIVELY: the wrapper's preflight proves the
 *     EAS production environment holds them, and a live tripwire in `extra`
 *     proves that environment is the one this publish resolved. That argument is
 *     sound, but it is an ARGUMENT, not a measurement.
 *   - It does NOT string-probe `launchAsset.url`. #990's residual-risks section
 *     records that the CDN denied direct download of the iOS launch asset; a
 *     check that cannot run on iOS is not a gate.
 *   - It does NOT prove the app boots. That stays a human pre-publish step
 *     (handbook §7.6), for the reasons in SPEC §6.1.
 *
 * EXIT CODES: 0 every expected key is live · 1 an assertion failed (the publish
 * is broken and is being served RIGHT NOW) · 2 the check could not be evaluated
 * (vacuity — never treat as a pass).
 */
import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Fetch timeout. A timeout is V-1, i.e. exit 2, never a pass. */
export const FETCH_TIMEOUT_MS = 20_000;

/**
 * V-3 — a RESOLVED app `extra` this small means every assertion below would be
 * vacuous. Applied to the node `resolveAppExtra` returns, never to the served
 * manifest's 3-key wrapper.
 */
export const MIN_EXTRA_KEYS = 5;

/**
 * The served manifest's own `extra` is a WRAPPER, not the app config's `extra`.
 *
 * Measured read-only on 2026-08-09/10 against six genuine production
 * permalinks (app-mobile + mingla-business, iOS + Android, including the
 * 2026-08-06 republishes). In ALL six the manifest's top-level `extra` held
 * exactly these three keys and never an `EXPO_PUBLIC_*` value.
 */
export const MANIFEST_EXTRA_WRAPPER_KEYS = Object.freeze([
  "expoClient",
  "eas",
  "scopeKey",
]);

/** Where the app config's `extra` actually lives in a served manifest. */
export const APP_EXTRA_PATH = "extra.expoClient.extra";

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Resolve the APP CONFIG `extra` out of a served manifest's `extra`.
 *
 * WHY THIS FUNCTION EXISTS, IN ONE PARAGRAPH. The first shipped version of this
 * module asserted against `manifest.extra` directly. On every real manifest that
 * node holds three keys, so the V-3 vacuity floor fired and the module exited 2
 * on all six production permalinks — both apps, both platforms. Worse, a healthy
 * manifest and the 2026-08-06 incident manifest produced BYTE-IDENTICAL output:
 * the check built to detect the `{}` unset signature could not detect it. That is
 * `feedback_unfalsifiable_test_bug_class`, reproduced inside the guardrail built
 * to prevent it. Resolution is therefore explicit, and every way it can go wrong
 * is exit 2 — never a silent fall back onto the wrapper.
 *
 * @param {unknown} manifestExtra the served manifest's own `extra`
 * @returns {{extra: Record<string, unknown>, path: string}}
 * @throws {VerifyVacuityError} V-2 / V-6
 */
export function resolveAppExtra(manifestExtra) {
  if (!isPlainObject(manifestExtra)) {
    throw new VerifyVacuityError(
      `V-2: the manifest's \`extra\` is ${
        manifestExtra === null
          ? "null"
          : Array.isArray(manifestExtra)
            ? "an array"
            : typeof manifestExtra
      }, not an object. The response is not an Expo manifest.`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(manifestExtra, "expoClient")) {
    const client = manifestExtra.expoClient;
    if (!isPlainObject(client)) {
      throw new VerifyVacuityError(
        "V-6: the served manifest's `extra.expoClient` is not an object, so the app " +
          `config \`extra\` cannot be located at ${APP_EXTRA_PATH}. Nothing below was ` +
          "verified — this is NOT a pass.",
      );
    }
    if (!isPlainObject(client.extra)) {
      throw new VerifyVacuityError(
        `V-6: the served manifest carries \`extra.expoClient\` but no app config \`extra\` ` +
          `at ${APP_EXTRA_PATH}. That node is the ONLY place EXPO_PUBLIC_* values appear, ` +
          "so every assertion below would be unreachable. Refusing to report success.",
      );
    }
    return { extra: client.extra, path: APP_EXTRA_PATH };
  }

  // No `expoClient`: either the FLAT `expo config --json --type public` shape
  // (which the #994 env-resolution smoke legitimately feeds in), or a wrapper
  // that lost its expoClient. The second must never be asserted against.
  const keys = Object.keys(manifestExtra);
  if (
    keys.length > 0 &&
    keys.every((k) => MANIFEST_EXTRA_WRAPPER_KEYS.includes(k))
  ) {
    throw new VerifyVacuityError(
      `V-6: the node being asserted holds only served-manifest wrapper keys ` +
        `(${keys.join(", ")}) and no app config \`extra\`. This is the exact defect that ` +
        `shipped once: asserting the wrapper instead of ${APP_EXTRA_PATH} makes a healthy ` +
        "manifest and a blind publish produce identical output.",
    );
  }
  return { extra: manifestExtra, path: "extra" };
}

/**
 * Per-app expectation tables. Exported so the #994 strict-grep gate and the
 * tester can read them without re-deriving. See the header before editing.
 * @type {Record<string, {name: string, required: boolean, prefix: string|null}[]>}
 */
export const EXPECTATIONS = {
  consumer: [
    { name: "EXPO_PUBLIC_POSTHOG_KEY", required: true, prefix: "phc_" },
    // #1733 — the payment key, now emitted into `extra` by
    // app-mobile/app.config.js with a release-bound fail-loud guard and a
    // `null` (never literal) local fallback. Second, independent tripwire.
    {
      name: "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      required: true,
      prefix: "pk_live_",
    },
  ],
  business: [
    {
      name: "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      required: true,
      prefix: "pk_live_",
    },
    { name: "EXPO_PUBLIC_GIPHY_API_KEY", required: true, prefix: null },
  ],
};

export const APPS = Object.keys(EXPECTATIONS);
export const PLATFORMS = ["ios", "android"];

/** App id -> the directory a human should re-run the wrapper from. */
const APP_DIR = { consumer: "app-mobile", business: "mingla-business" };

/**
 * A condition that makes the check UNEVALUABLE. Always exit 2 — a vacuity that
 * exits 0 is the "green because it checked nothing" mode this repo keeps
 * reproducing, and it is the exact defect #994 exists to close.
 */
export class VerifyVacuityError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerifyVacuityError";
    this.exitCode = 2;
  }
}

/** First 8 characters of a value, for logs. NEVER the whole secret. */
export function head8(value) {
  return String(value).slice(0, 8);
}

/**
 * Parse `eas update --json` stdout and return the entry for `platform`.
 *
 * EAS CLI prints an ARRAY whose elements carry `id`, `createdAt`, `group`,
 * `branch`, `message`, `runtimeVersion`, `platform`, `manifestPermalink`,
 * `isRollBackToEmbedded`, `gitCommitHash`.
 *
 * @param {string} text  raw stdout of `eas update --json`
 * @param {string} platform  "ios" | "android"
 * @returns {{id:string, group:string, runtimeVersion:string, platform:string, manifestPermalink:string, gitCommitHash:string|null}}
 * @throws {VerifyVacuityError} V-5
 */
export function parseUpdateJson(text, platform) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new VerifyVacuityError(
      "V-5: `eas update --json` stdout is not parseable JSON, so the publish " +
        `cannot be located and is UNVERIFIABLE (${err.message}).`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new VerifyVacuityError(
      `V-5: expected \`eas update --json\` to print an ARRAY, got ${
        parsed === null ? "null" : typeof parsed
      }. The publish is UNVERIFIABLE.`,
    );
  }
  if (parsed.length === 0) {
    throw new VerifyVacuityError(
      "V-5: `eas update --json` printed ZERO update entries. The publish " +
        "happened but is UNVERIFIABLE — do NOT treat this as a pass.",
    );
  }
  const entry = parsed.find((e) => e && e.platform === platform);
  if (!entry) {
    const seen = parsed.map((e) => (e && e.platform) || "<none>").join(", ");
    throw new VerifyVacuityError(
      `V-5: no update entry for platform "${platform}" (entries present: ${seen}). ` +
        "Verifying the wrong platform's manifest would be a false green.",
    );
  }
  if (
    typeof entry.manifestPermalink !== "string" ||
    entry.manifestPermalink.trim().length === 0
  ) {
    throw new VerifyVacuityError(
      `V-5: the ${platform} update entry carries no \`manifestPermalink\`. ` +
        "There is nothing to fetch, so the publish is UNVERIFIABLE.",
    );
  }
  return {
    id: typeof entry.id === "string" ? entry.id : "<unknown>",
    group: typeof entry.group === "string" ? entry.group : "<unknown>",
    runtimeVersion:
      typeof entry.runtimeVersion === "string"
        ? entry.runtimeVersion
        : "<unknown>",
    platform: entry.platform,
    manifestPermalink: entry.manifestPermalink,
    gitCommitHash:
      typeof entry.gitCommitHash === "string" ? entry.gitCommitHash : null,
  };
}

/**
 * Return the manifest JSON text out of a served response body.
 *
 * EAS itself requests a permalink with `accept: multipart/mixed` and pulls the
 * part named `manifest`. #990 evidence shows iOS may answer
 * `application/expo+json` and Android `multipart/mixed`, so BOTH shapes occur
 * and both are handled. A multipart body with no `manifest` part is a vacuity,
 * never "nothing to check".
 *
 * @param {string} contentType
 * @param {string} rawBody
 * @returns {string} the manifest JSON text
 * @throws {VerifyVacuityError}
 */
export function extractManifestBody(contentType, rawBody) {
  const ct = String(contentType || "");
  if (!ct.toLowerCase().includes("multipart/")) return rawBody;

  const boundaryMatch = ct.match(/boundary=("([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch
    ? boundaryMatch[2] || boundaryMatch[3]
    : null;
  if (!boundary) {
    throw new VerifyVacuityError(
      `V-2: the response declares "${ct}" but carries no multipart boundary, ` +
        "so the manifest part cannot be located.",
    );
  }
  const parts = rawBody.split(`--${boundary}`);
  for (const part of parts) {
    const split = part.indexOf("\r\n\r\n") !== -1
      ? part.indexOf("\r\n\r\n")
      : part.indexOf("\n\n");
    if (split === -1) continue;
    const sep = part.indexOf("\r\n\r\n") !== -1 ? 4 : 2;
    const headers = part.slice(0, split);
    if (!/content-disposition:/i.test(headers)) continue;
    if (!/name="?manifest"?/i.test(headers)) continue;
    return part.slice(split + sep).replace(/\r?\n--?$/, "").trim();
  }
  throw new VerifyVacuityError(
    "V-2: the multipart response carries no part named `manifest`. The body " +
      "is not an Expo manifest response — this is NOT a pass.",
  );
}

/**
 * Assert the expected keys in a served manifest's `extra`.
 *
 * Per-key order is fixed and may not be rearranged. `{}` is checked FIRST
 * because it is the verified real-world unset signature and because it produces
 * the clearest operator message; the later checks make the assertion robust to
 * a future serializer change without weakening it.
 *
 * @param {Record<string, unknown>} extra
 * @param {{name:string, required:boolean, prefix:string|null}[]} expectations
 * @returns {{code:number, messages:string[], live:number}}
 */
export function assertExtra(extra, expectations) {
  if (!Array.isArray(expectations) || expectations.length === 0) {
    return {
      code: 2,
      live: 0,
      messages: [
        "V-4: the expectation table for this app is EMPTY. A per-key loop over " +
          "zero keys passes for the wrong reason — refusing to report success.",
      ],
    };
  }
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return {
      code: 2,
      live: 0,
      messages: [
        `V-2: the manifest's \`extra\` is ${
          extra === null ? "null" : Array.isArray(extra) ? "an array" : typeof extra
        }, not an object. The response is not an Expo manifest.`,
      ],
    };
  }
  const keyCount = Object.keys(extra).length;
  if (keyCount < MIN_EXTRA_KEYS) {
    return {
      code: 2,
      live: 0,
      messages: [
        `V-3: the resolved app config \`extra\` holds ${keyCount} keys (floor ${MIN_EXTRA_KEYS}); ` +
          "every assertion below would pass for the wrong reason. Measured on six genuine " +
          `production manifests, ${APP_EXTRA_PATH} holds 15 keys on app-mobile and 16 on ` +
          "mingla-business. If this fires, the wrong node is being asserted (see V-6).",
      ],
    };
  }

  const messages = [];
  let failed = 0;
  let live = 0;

  for (const exp of expectations) {
    const present = Object.prototype.hasOwnProperty.call(extra, exp.name);
    const value = present ? extra[exp.name] : undefined;
    let verdict = null;

    // A — the UNSET SIGNATURE. FIRST, always.
    if (present && JSON.stringify(value) === "{}") {
      verdict = `${exp.name} = {}  — the UNSET SIGNATURE.`;
    } else if (!present || value === null || value === undefined) {
      // B — absent.
      verdict = `${exp.name} is absent from the served manifest's \`extra\`.`;
    } else if (typeof value !== "string") {
      // C — non-string.
      verdict = `${exp.name} is non-string (${typeof value}).`;
    } else if (value.trim().length === 0) {
      // D — empty string.
      verdict = `${exp.name} is an empty string.`;
    } else if (exp.prefix && !value.startsWith(exp.prefix)) {
      // E — wrong prefix.
      verdict =
        `${exp.name} has the wrong prefix (expected ${exp.prefix}, got ` +
        `${head8(value)}…).`;
    }

    if (verdict === null) {
      live += 1;
      messages.push(
        `  OK ${exp.name} = ${head8(value)}… (${String(value).length} chars)`,
      );
      continue;
    }
    if (exp.required) {
      failed += 1;
      messages.push(`  x ${verdict}`);
    } else {
      messages.push(`  ! ADVISORY ${verdict} Continuing.`);
    }
  }

  return { code: failed > 0 ? 1 : 0, messages, live };
}

/**
 * Evaluate a served response end-to-end. Pure — all I/O is injected — so the
 * self-test can drive every vacuity case without a network.
 *
 * @param {{status:number, contentType:string, rawBody:string, expectations:any[]}} args
 * @returns {{code:number, messages:string[], live:number, extraKeys:number, extraPath:string|null}}
 */
export function evaluateResponse({ status, contentType, rawBody, expectations }) {
  if (status !== 200) {
    return {
      code: 2,
      live: 0,
      extraKeys: 0,
      messages: [
        `V-1: the manifest could not be fetched (HTTP ${status}); this is NOT a pass. ` +
          "The update is live and its contents are unknown.",
      ],
    };
  }

  let manifestText;
  try {
    manifestText = extractManifestBody(contentType, rawBody);
  } catch (err) {
    if (err instanceof VerifyVacuityError) {
      return { code: 2, live: 0, extraKeys: 0, messages: [err.message] };
    }
    throw err;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    return {
      code: 2,
      live: 0,
      extraKeys: 0,
      messages: [
        `V-2: the served body is not parseable JSON (${err.message}); the response ` +
          "is not an Expo manifest.",
      ],
    };
  }
  if (manifest === null || typeof manifest !== "object") {
    return {
      code: 2,
      live: 0,
      extraKeys: 0,
      messages: ["V-2: the served body is not a JSON object — not an Expo manifest."],
    };
  }
  for (const field of ["id", "extra", "launchAsset"]) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) {
      return {
        code: 2,
        live: 0,
        extraKeys: 0,
        messages: [
          `V-2: the served body has no \`${field}\` — the response is not an Expo manifest, ` +
            "so nothing below was actually verified.",
        ],
      };
    }
  }

  // The app config `extra` is NOT `manifest.extra` — see resolveAppExtra.
  let appExtra;
  let extraPath;
  try {
    ({ extra: appExtra, path: extraPath } = resolveAppExtra(manifest.extra));
  } catch (err) {
    if (err instanceof VerifyVacuityError) {
      return {
        code: 2,
        live: 0,
        extraKeys: 0,
        extraPath: null,
        messages: [err.message],
      };
    }
    throw err;
  }

  const result = assertExtra(appExtra, expectations);
  return {
    ...result,
    extraKeys: Object.keys(appExtra).length,
    extraPath,
  };
}

/** Remediation block. Printed verbatim on a failed verification. */
export function remediation(app, platform, message) {
  const dir = APP_DIR[app] ?? app;
  return [
    "",
    "REMEDIATE IN THIS ORDER:",
    `  1. npx -y eas-cli@latest update:roll-back-to-embedded --branch production --platform ${platform} --non-interactive`,
    "  2. Re-run this script from the SAME commit:",
    `       ${dir}/scripts/ota/publish-production-ota.sh ${platform} "${message}"`,
    "  3. This script's own post-publish check must print OK for every key before you walk away.",
    "NOTE: devices that already fetched the bad update need TWO cold starts to escape it",
    "      (#990 mitigation-v2 finding).",
  ];
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
function selfTest() {
  const problems = [];
  const expect = (label, got, want) => {
    if (got !== want) problems.push(`${label}: expected exit ${want}, got ${got}`);
  };
  const expectMsg = (label, messages, needle) => {
    if (!messages.some((m) => m.includes(needle))) {
      problems.push(`${label}: no message contained "${needle}" (got ${JSON.stringify(messages)})`);
    }
  };

  const EXP = [{ name: "K", required: true, prefix: "phc_" }];
  const filler = () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
  const withK = (v) => {
    const o = filler();
    if (v !== "<<omit>>") o.K = v;
    return o;
  };

  // ---- assertExtra, per-key verdicts (cases 1-8) ----
  {
    const r = assertExtra(withK({}), EXP);
    expect("1 unset signature {}", r.code, 1);
    expectMsg("1 unset signature {}", r.messages, "UNSET SIGNATURE");
  }
  {
    const r = assertExtra(withK(null), EXP);
    expect("2 null", r.code, 1);
    expectMsg("2 null", r.messages, "absent");
  }
  {
    const r = assertExtra(withK("<<omit>>"), EXP);
    expect("3 key absent", r.code, 1);
    expectMsg("3 key absent", r.messages, "absent");
  }
  {
    const r = assertExtra(withK(""), EXP);
    expect("4 empty string", r.code, 1);
    expectMsg("4 empty string", r.messages, "empty string");
  }
  {
    const r = assertExtra(withK("   "), EXP);
    expect("5 whitespace-only", r.code, 1);
    expectMsg("5 whitespace-only", r.messages, "empty string");
  }
  {
    const r = assertExtra(withK(42), EXP);
    expect("6 number", r.code, 1);
    expectMsg("6 number", r.messages, "non-string (number)");
  }
  {
    const r = assertExtra(withK("phx_wrongkind"), EXP);
    expect("7 wrong prefix", r.code, 1);
    expectMsg("7 wrong prefix", r.messages, "wrong prefix");
  }
  {
    const r = assertExtra(withK("phc_realvalue"), EXP);
    expect("8 correct value", r.code, 0);
    expectMsg("8 correct value", r.messages, "OK K = phc_real…");
  }

  // ---- body extraction (cases 9-11) ----
  const manifestObj = (extra) =>
    JSON.stringify({ id: "u-1", launchAsset: { url: "https://x/y" }, extra });
  {
    const body = manifestObj(withK("phc_ok"));
    const raw =
      `--BOUND\r\ncontent-disposition: form-data; name="manifest"\r\ncontent-type: application/json\r\n\r\n${body}\r\n--BOUND--\r\n`;
    const r = evaluateResponse({
      status: 200,
      contentType: 'multipart/mixed; boundary="BOUND"',
      rawBody: raw,
      expectations: EXP,
    });
    expect("9 multipart with manifest part", r.code, 0);
  }
  {
    const raw =
      `--BOUND\r\ncontent-disposition: form-data; name="extensions"\r\n\r\n{}\r\n--BOUND--\r\n`;
    const r = evaluateResponse({
      status: 200,
      contentType: "multipart/mixed; boundary=BOUND",
      rawBody: raw,
      expectations: EXP,
    });
    expect("10 multipart without a manifest part", r.code, 2);
    expectMsg("10 multipart without a manifest part", r.messages, "no part named");
  }
  {
    const r = evaluateResponse({
      status: 200,
      contentType: "application/expo+json; charset=utf-8",
      rawBody: manifestObj(withK("phc_ok")),
      expectations: EXP,
    });
    expect("11 application/expo+json plain body", r.code, 0);
  }

  // ---- vacuity (cases 12-17) ----
  {
    const r = evaluateResponse({
      status: 404,
      contentType: "text/plain",
      rawBody: "not found",
      expectations: EXP,
    });
    expect("12 HTTP 404", r.code, 2);
    expectMsg("12 HTTP 404", r.messages, "V-1");
  }
  {
    const r = evaluateResponse({
      status: 200,
      contentType: "text/html",
      rawBody: "<html>gateway</html>",
      expectations: EXP,
    });
    expect("13 HTTP 200 non-JSON", r.code, 2);
    expectMsg("13 HTTP 200 non-JSON", r.messages, "V-2");
  }
  {
    const noLaunch = JSON.stringify({ id: "u-1", extra: withK("phc_ok") });
    const r = evaluateResponse({
      status: 200,
      contentType: "application/json",
      rawBody: noLaunch,
      expectations: EXP,
    });
    expect("14 manifest lacking launchAsset", r.code, 2);
    expectMsg("14 manifest lacking launchAsset", r.messages, "launchAsset");
  }
  {
    const r = assertExtra({ a: 1, b: 2, c: 3, K: "phc_ok" }, EXP);
    expect("15 extra with 4 keys", r.code, 2);
    expectMsg("15 extra with 4 keys", r.messages, "V-3");
  }
  {
    let code = 0;
    try {
      parseUpdateJson("[]", "ios");
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("16 update json []", code, 2);
  }
  {
    let code = 0;
    try {
      parseUpdateJson(
        JSON.stringify([
          { platform: "android", manifestPermalink: "https://u.expo.dev/x" },
        ]),
        "ios",
      );
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("17 update json only the other platform", code, 2);
  }

  // ---- extra vacuity + parse coverage (cases 18-23) ----
  {
    const r = assertExtra(withK("phc_ok"), []);
    expect("18 empty expectation table", r.code, 2);
    expectMsg("18 empty expectation table", r.messages, "V-4");
  }
  {
    let code = 0;
    try {
      parseUpdateJson("not json at all", "ios");
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("19 update json unparseable", code, 2);
  }
  {
    let code = 0;
    try {
      parseUpdateJson(JSON.stringify({ platform: "ios" }), "ios");
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("20 update json is an object not an array", code, 2);
  }
  {
    let code = 0;
    try {
      parseUpdateJson(
        JSON.stringify([{ platform: "ios", manifestPermalink: "" }]),
        "ios",
      );
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("21 empty manifestPermalink", code, 2);
  }
  {
    const parsed = parseUpdateJson(
      JSON.stringify([
        {
          id: "019fd7e3",
          group: "51a4e47d",
          runtimeVersion: "1.1.3",
          platform: "ios",
          manifestPermalink: "https://u.expo.dev/update/019fd7e3",
          gitCommitHash: "9f719922d",
        },
      ]),
      "ios",
    );
    if (parsed.manifestPermalink !== "https://u.expo.dev/update/019fd7e3") {
      problems.push("22 happy parse: wrong permalink returned");
    }
    if (parsed.gitCommitHash !== "9f719922d") {
      problems.push("22 happy parse: wrong gitCommitHash returned");
    }
  }
  {
    const r = assertExtra(null, EXP);
    expect("23 extra is null", r.code, 2);
  }

  // ---- the real tables must never silently empty out (cases 24-25) ----
  for (const app of APPS) {
    if (!Array.isArray(EXPECTATIONS[app]) || EXPECTATIONS[app].length === 0) {
      problems.push(`24 EXPECTATIONS.${app} is empty — the check would be vacuous`);
    }
    for (const exp of EXPECTATIONS[app]) {
      if (typeof exp.name !== "string" || typeof exp.required !== "boolean") {
        problems.push(`24 EXPECTATIONS.${app} has a malformed row`);
      }
    }
  }
  {
    // 25 — the business table must NOT hold POSTHOG (literal fallback = fake check).
    if (EXPECTATIONS.business.some((e) => e.name === "EXPO_PUBLIC_POSTHOG_KEY")) {
      problems.push(
        "25 business table holds EXPO_PUBLIC_POSTHOG_KEY, which has a committed " +
          "literal fallback on that app and would pass on a blind publish",
      );
    }
    if (!EXPECTATIONS.consumer.some((e) => e.name === "EXPO_PUBLIC_POSTHOG_KEY")) {
      problems.push("25 consumer table lost its only tripwire");
    }
    // 25b (#1733) — the consumer table must carry the PAYMENT key, prefix-checked.
    // Until #1733 the consumer half of this check rested on a single tripwire;
    // losing this row puts it back to one thread and makes the key that actually
    // went missing on 2026-08-06 unmeasurable again.
    const consumerStripe = EXPECTATIONS.consumer.find(
      (e) => e.name === "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    );
    if (!consumerStripe) {
      problems.push(
        "25b consumer table lost EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY — the payment key is " +
          "no longer directly measurable in the served manifest (#1733)",
      );
    } else if (consumerStripe.prefix !== "pk_live_" || consumerStripe.required !== true) {
      problems.push(
        "25b consumer EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY must stay required with the " +
          `pk_live_ prefix; got required=${consumerStripe.required} prefix=${consumerStripe.prefix}`,
      );
    }
  }

  // ---- THE REAL WIRE SHAPE (cases 26-34) ----
  //
  // Every fixture below is built by `realWireManifest`, whose STRUCTURE was
  // captured read-only on 2026-08-09/10 from six genuine production permalinks:
  //   app-mobile      ios     019fe873-bf46-721f-9765-58683f10c6bf  rt 1.1.3
  //   app-mobile      android 019fdd87-afc9-7238-bdaf-a516dc7f1975  rt 1.1.2
  //   app-mobile      ios     019fd7e3-bcdb-7c96-91e9-e538331ca1e1  rt 1.1.2 (08-06 republish)
  //   app-mobile      android 019fd7e4-7afd-7036-a1c6-9c29f214227d  rt 1.1.2 (08-06 republish)
  //   mingla-business ios     019fd32a-5778-7bfc-976f-33b51b4bafd8  rt 1.1.2
  //   mingla-business android 019fd32b-05e5-7342-94d8-cb3ece1dc85b  rt 1.1.2
  // All six answered HTTP 200 `multipart/mixed`; all six nest the app config
  // `extra` at extra.expoClient.extra. VALUES below are fakes — only the SHAPE
  // is real, and case 31 fails if that shape ever drifts back to flat.

  /** The real app config `extra`, key-for-key (values redacted). */
  const realAppExtra = (posthog, stripe = "pk_live_fakebutwellformed") => ({
    eas: { build: {}, projectId: "01f9ff7c-0000-0000-0000-000000000000" },
    router: {},
    IOS_CLIENT_ID: "1691-i.apps.googleusercontent.com",
    ANDROID_CLIENT_ID: "1691-a.apps.googleusercontent.com",
    GOOGLE_PROJECT_ID: "example-pr",
    googleWebClientId: "1691-w.apps.googleusercontent.com",
    EXPO_PUBLIC_POSTHOG_KEY: posthog,
    // #1733 — app-mobile now emits the payment key into `extra`, so the real
    // consumer shape carries it. Fake value, real shape.
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: stripe,
    EXPO_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
    GOOGLE_ANDROID_CLIENT_ID: "1691-a.apps.googleusercontent.com",
    GOOGLE_IOS_CLIENT_SECRET: "",
    GOOGLE_WEB_CLIENT_SECRET: "",
    EXPO_PUBLIC_APPSFLYER_DEV_KEY: "FAKEDEVKEYFAKEDEVKEY00",
    EXPO_PUBLIC_APPSFLYER_IOS_APP_ID: "6760000000",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "1691-w.apps.googleusercontent.com",
    EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID: "com.example.app",
  });

  /** The real served-manifest envelope: app config extra nested under expoClient. */
  const realWireManifest = (appExtra) => ({
    id: "019fe873-0000-0000-0000-000000000000",
    createdAt: "2026-08-09T21:35:27.558Z",
    runtimeVersion: "1.1.3",
    launchAsset: {
      hash: "h",
      key: "k",
      contentType: "application/javascript",
      url: "https://assets.example/bundle",
    },
    assets: [],
    metadata: {},
    extra: {
      expoClient: { name: "Mingla", slug: "mingla", extra: appExtra },
      eas: { projectId: "01f9ff7c-0000-0000-0000-000000000000" },
      scopeKey: "@example/mingla",
    },
  });

  /** The real framing: `--` + a dash-prefixed boundary, CRLF headers. */
  const REAL_BOUNDARY = "-----ExpoManifestBoundary-AZ_oc79Gch-XZVhoPxDGvw";
  const REAL_CT = `multipart/mixed; boundary=${REAL_BOUNDARY}`;
  const realWireBody = (manifest) =>
    `--${REAL_BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="manifest"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(manifest)}\r\n` +
    `--${REAL_BOUNDARY}--\r\n`;

  const evalWire = (appExtra, expectations) =>
    evaluateResponse({
      status: 200,
      contentType: REAL_CT,
      rawBody: realWireBody(realWireManifest(appExtra)),
      expectations,
    });

  const GOOD_POSTHOG = "phc_fakebutwellformedvalue00000000000000";

  {
    // 26 — a CORRECT consumer manifest in the real wire shape must VERIFY.
    const r = evalWire(realAppExtra(GOOD_POSTHOG), EXPECTATIONS.consumer);
    expect("26 real wire shape, healthy consumer", r.code, 0);
    expectMsg("26 real wire shape, healthy consumer", r.messages, "OK EXPO_PUBLIC_POSTHOG_KEY");
    if (r.extraPath !== APP_EXTRA_PATH) {
      problems.push(`26 read the wrong node: extraPath=${r.extraPath}, expected ${APP_EXTRA_PATH}`);
    }
  }
  {
    // 27 — the 2026-08-06 incident body: the tripwire serialised to `{}`.
    const r = evalWire(realAppExtra({}), EXPECTATIONS.consumer);
    expect("27 real wire shape, UNSET SIGNATURE", r.code, 1);
    expectMsg("27 real wire shape, UNSET SIGNATURE", r.messages, "UNSET SIGNATURE");
  }
  {
    // 28 — FALSIFIABILITY. Healthy and incident bodies MUST diverge. As first
    //      shipped they were byte-identical (both V-3, exit 2), which is the
    //      whole reason this issue exists.
    const healthy = evalWire(realAppExtra(GOOD_POSTHOG), EXPECTATIONS.consumer);
    const incident = evalWire(realAppExtra({}), EXPECTATIONS.consumer);
    if (
      healthy.code === incident.code &&
      JSON.stringify(healthy.messages) === JSON.stringify(incident.messages)
    ) {
      problems.push(
        "28 a healthy manifest and the 2026-08-06 incident manifest produced IDENTICAL " +
          "verdicts — the post-publish check is unfalsifiable",
      );
    }
  }
  {
    // 29 — the business tables against the real wire shape.
    const extra = realAppExtra(GOOD_POSTHOG);
    extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_fakebutwellformed";
    extra.EXPO_PUBLIC_GIPHY_API_KEY = "fakegiphykeyfakegiphykey";
    const r = evalWire(extra, EXPECTATIONS.business);
    expect("29 real wire shape, healthy business", r.code, 0);
  }
  {
    // 30 — a business publish that went blind: the Stripe key is `{}`.
    const extra = realAppExtra(GOOD_POSTHOG);
    extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = {};
    extra.EXPO_PUBLIC_GIPHY_API_KEY = "fakegiphykeyfakegiphykey";
    const r = evalWire(extra, EXPECTATIONS.business);
    expect("30 real wire shape, blind business", r.code, 1);
    expectMsg("30 real wire shape, blind business", r.messages, "UNSET SIGNATURE");
  }
  {
    // 31 — FIXTURE SHAPE DRIFT GUARD. This is the case that would have caught
    //      the original P0. The self-test fixture must carry the SERVED wire
    //      shape, not the flat `expo config --json` shape. If someone flattens
    //      `realWireManifest`, every case above would silently start exercising
    //      a shape production never serves — exactly how 25/25 green shipped a
    //      module that failed on 6/6 real manifests.
    const m = realWireManifest(realAppExtra(GOOD_POSTHOG));
    const topKeys = Object.keys(m.extra);
    const drifted =
      topKeys.length !== MANIFEST_EXTRA_WRAPPER_KEYS.length ||
      !MANIFEST_EXTRA_WRAPPER_KEYS.every((k) => topKeys.includes(k));
    if (drifted) {
      problems.push(
        `31 FIXTURE SHAPE DRIFT: manifest.extra keys are [${topKeys.join(", ")}], expected exactly ` +
          `[${MANIFEST_EXTRA_WRAPPER_KEYS.join(", ")}]. The fixture no longer matches what ` +
          "u.expo.dev serves, so every case above is testing a shape production never returns.",
      );
    }
    if (Object.prototype.hasOwnProperty.call(m.extra, "EXPO_PUBLIC_POSTHOG_KEY")) {
      problems.push(
        "31 FIXTURE SHAPE DRIFT: an EXPO_PUBLIC_* key appears on the manifest's OWN `extra`. " +
          "No real manifest does that — the fixture has been flattened to the config shape.",
      );
    }
    if (!Object.prototype.hasOwnProperty.call(m.extra.expoClient.extra, "EXPO_PUBLIC_POSTHOG_KEY")) {
      problems.push(
        `31 FIXTURE SHAPE DRIFT: the tripwire is not at ${APP_EXTRA_PATH}, which is the only ` +
          "place a served manifest carries it.",
      );
    }
  }
  {
    // 32 — V-6: asserting the WRAPPER is exit 2 with a named cause, never a
    //      per-key verdict and never a pass. This is the shipped defect, pinned.
    const wrapperOnly = {
      id: "u-1",
      launchAsset: { url: "https://x/y" },
      extra: { expoClient: { name: "Mingla" }, eas: {}, scopeKey: "@e/m" },
    };
    const r = evaluateResponse({
      status: 200,
      contentType: "application/expo+json",
      rawBody: JSON.stringify(wrapperOnly),
      expectations: EXPECTATIONS.consumer,
    });
    expect("32 expoClient without an app config extra", r.code, 2);
    expectMsg("32 expoClient without an app config extra", r.messages, "V-6");
    let code = 0;
    try {
      resolveAppExtra({ eas: {}, scopeKey: "@e/m" });
    } catch (err) {
      code = err.exitCode ?? 1;
    }
    expect("32b wrapper keys only, no expoClient", code, 2);
  }
  {
    // 33 — the FLAT shape stays supported. `expo config --json --type public`
    //      emits it, the #994 env-resolution smoke reads it, and older manifests
    //      may still carry it. Resolution must not break that.
    const flat = resolveAppExtra(withK("phc_ok"));
    if (flat.path !== "extra") problems.push(`33 flat shape resolved to ${flat.path}, expected "extra"`);
    const r = evaluateResponse({
      status: 200,
      contentType: "application/expo+json",
      rawBody: manifestObj(withK("phc_ok")),
      expectations: EXP,
    });
    expect("33 flat legacy shape still verifies", r.code, 0);
  }
  {
    // 34 — the V-3 floor is applied to the RESOLVED node, not the wrapper. A
    //      thin app config extra is still vacuous even when nested correctly.
    const r = evalWire({ a: 1, b: 2, EXPO_PUBLIC_POSTHOG_KEY: "phc_ok" }, EXPECTATIONS.consumer);
    expect("34 thin resolved extra is still vacuous", r.code, 2);
    expectMsg("34 thin resolved extra is still vacuous", r.messages, "V-3");
  }

  // ---- #1733: the CONSUMER payment tripwire (cases 35-37) ----
  //
  // The point of these three: before #1733 a consumer OTA published without
  // `--environment production` could only be detected through PostHog. Now the
  // payment key is measured directly, and 37 proves the two tripwires are
  // INDEPENDENT — a healthy PostHog value can no longer certify a publish whose
  // Stripe key went missing.
  {
    // 35 — a blind consumer publish: the payment key carries the UNSET SIGNATURE
    //      while PostHog is fine. Must fail, and must name the signature.
    const r = evalWire(realAppExtra(GOOD_POSTHOG, {}), EXPECTATIONS.consumer);
    expect("35 consumer stripe key is the UNSET SIGNATURE", r.code, 1);
    expectMsg("35 consumer stripe key is the UNSET SIGNATURE", r.messages, "UNSET SIGNATURE");
    expectMsg(
      "35 consumer stripe key is the UNSET SIGNATURE",
      r.messages,
      "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    );
  }
  {
    // 36 — the #990 shape on the consumer app: a pk_test_ key served to real
    //      users. Presence alone is not enough; the prefix is contractual.
    const r = evalWire(realAppExtra(GOOD_POSTHOG, "pk_test_wrongmode"), EXPECTATIONS.consumer);
    expect("36 consumer stripe key has the wrong prefix", r.code, 1);
    expectMsg("36 consumer stripe key has the wrong prefix", r.messages, "wrong prefix");
  }
  {
    // 37 — INDEPENDENCE. A healthy PostHog value must NOT mask a dead payment
    //      key, and a healthy payment key must NOT mask a dead PostHog value.
    //      If either masked the other, the second tripwire would be decoration.
    const healthy = evalWire(realAppExtra(GOOD_POSTHOG), EXPECTATIONS.consumer);
    const stripeDead = evalWire(realAppExtra(GOOD_POSTHOG, {}), EXPECTATIONS.consumer);
    const posthogDead = evalWire(realAppExtra({}), EXPECTATIONS.consumer);
    expect("37 fully healthy consumer verifies", healthy.code, 0);
    if (stripeDead.code === healthy.code || posthogDead.code === healthy.code) {
      problems.push(
        "37 a dead tripwire produced the same verdict as a healthy manifest — the consumer " +
          "tripwires are not independent",
      );
    }
    if (JSON.stringify(stripeDead.messages) === JSON.stringify(posthogDead.messages)) {
      problems.push(
        "37 a dead Stripe key and a dead PostHog key produced IDENTICAL output — the operator " +
          "cannot tell which key went missing",
      );
    }
  }

  if (problems.length) {
    console.error("#994 OTA-MANIFEST-VERIFY self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#994 OTA-MANIFEST-VERIFY self-test PASS (38/38: 1-8 per-key verdicts incl. " +
      "UNSET SIGNATURE first, 9-11 multipart/expo+json body extraction, 12-17 vacuity " +
      "(404, non-JSON, no launchAsset, thin extra, [] and wrong-platform update json), " +
      "18-23 empty table / unparseable / non-array / empty permalink / happy parse / null extra, " +
      "24-25 the real expectation tables stay non-empty and un-padded, " +
      "26-34 THE REAL SERVED WIRE SHAPE: healthy consumer/business verify, the `{}` unset " +
      "signature is caught on both apps, healthy and incident verdicts diverge, the fixture " +
      "shape-drift guard fails if the fixture is ever flattened back to the config shape, " +
      "V-6 refuses to assert the 3-key wrapper, the flat legacy shape still verifies, and the " +
      "V-3 floor applies to the RESOLVED node; " +
      "25b/35-37 (#1733) the CONSUMER PAYMENT tripwire: the table keeps it required at " +
      "pk_live_, the unset signature and a pk_test_ prefix are both caught on app-mobile, and " +
      "the two consumer tripwires are proven INDEPENDENT — neither masks the other).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

async function liveRun() {
  const updateJsonPath = argValue("--update-json");
  const app = argValue("--app");
  const platform = argValue("--platform");
  const message = argValue("--message") ?? "<the same message>";

  if (!updateJsonPath || !app || !platform) {
    console.error(
      "usage: node scripts/ota/verify-published-manifest.mjs --update-json <path> " +
        `--app <${APPS.join("|")}> --platform <${PLATFORMS.join("|")}>`,
    );
    console.error("       node scripts/ota/verify-published-manifest.mjs --self-test");
    process.exit(2);
  }
  if (!APPS.includes(app)) {
    console.error(`V-4: unknown --app "${app}" (expected one of ${APPS.join(", ")}).`);
    process.exit(2);
  }
  if (!PLATFORMS.includes(platform)) {
    console.error(
      `V-5: unknown --platform "${platform}" (expected one of ${PLATFORMS.join(", ")}).`,
    );
    process.exit(2);
  }

  let updateText;
  try {
    updateText = fs.readFileSync(updateJsonPath, "utf8");
  } catch (err) {
    console.error(
      `V-5: could not read the \`eas update --json\` output at ${updateJsonPath} ` +
        `(${err.message}). The publish is UNVERIFIABLE.`,
    );
    process.exit(2);
  }

  let entry;
  try {
    entry = parseUpdateJson(updateText, platform);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? 2);
  }

  let status = 0;
  let contentType = "";
  let rawBody = "";
  try {
    const res = await fetch(entry.manifestPermalink, {
      headers: { accept: "multipart/mixed" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = res.status;
    contentType = res.headers.get("content-type") ?? "";
    rawBody = await res.text();
  } catch (err) {
    console.error(
      `V-1: fetching the served manifest failed (${err.message}); the manifest could ` +
        "not be fetched, and this is NOT a pass.",
    );
    process.exit(2);
  }

  const result = evaluateResponse({
    status,
    contentType,
    rawBody,
    expectations: EXPECTATIONS[app],
  });

  const dir = APP_DIR[app] ?? app;
  if (result.code === 0) {
    console.log(
      `[verify] OK ${dir} ${platform} — update ${entry.id}… (group ${entry.group}…, ` +
        `runtime ${entry.runtimeVersion}): ${result.live}/${EXPECTATIONS[app].length} ` +
        `expected extra key(s) live; ${result.extraKeys} app config extra keys present at ` +
        `\`${result.extraPath ?? "<unresolved>"}\`.`,
    );
    result.messages.forEach((m) => console.log(m));
    console.log(
      `[done] update group ${entry.group}… published and VERIFIED against the served manifest.`,
    );
    process.exit(0);
  }

  const label = result.code === 2 ? "OTA-MANIFEST-UNVERIFIABLE" : "OTA-MANIFEST-VERIFY";
  console.error(
    `ABORT [#994 ${label}] ${dir} ${platform} — update ${entry.id}\n` +
      `       group ${entry.group}  runtime ${entry.runtimeVersion}  commit ${entry.gitCommitHash ?? "<none>"}`,
  );
  result.messages.forEach((m) => console.error(m));
  if (result.code === 1) {
    console.error(
      "    `--environment production` did not take effect. This update is being served to real\n" +
        "    users RIGHT NOW with its production keys missing: on app-mobile that means checkout\n" +
        "    is dead while the app looks completely normal; on mingla-business the splash bricks.",
    );
  }
  remediation(app, platform, message).forEach((m) => console.error(m));
  process.exit(result.code);
}

// Entry-point guard. MUST use pathToFileURL: a naive `file://${process.argv[1]}`
// comparison silently fails whenever the checkout path contains characters the
// URL spec percent-encodes (e.g. the `[` `]` in the per-issue worktree
// `994-[ota-publish-guardrails]`) — the same trap ORCH-1383 hit in
// run-batch.mjs. Without this guard, IMPORTING this module (the #994
// env-resolution smoke reads EXPECTATIONS from here, so there is exactly one
// expectation table in the repo) would execute liveRun() as a side effect.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  if (process.argv.includes("--self-test")) selfTest();
  else await liveRun();
}
