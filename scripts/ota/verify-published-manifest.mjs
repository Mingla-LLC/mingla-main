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
 *   3. THE EXPECTED KEYS CARRY REAL VALUES. `assertExtra` checks, per key and
 *      IN THIS ORDER: `{}` (UNSET SIGNATURE) -> absent/null -> non-string ->
 *      empty -> wrong prefix. A required key failing any of these is exit 1.
 *   4. THE CHECK CANNOT PASS VACUOUSLY. An `extra` with fewer than 5 keys, or
 *      an empty expectation table, is exit 2 (V-3, V-4). Both apps ship 15+
 *      extra keys today, so 5 is a real floor with headroom.
 *
 * THE EXPECTATION TABLES ARE DELIBERATELY SHORT — DO NOT PAD THEM.
 *   Only a key that (a) reaches `extra` and (b) has NO committed literal
 *   fallback can distinguish a blind publish from a correct one. A key with a
 *   literal fallback resolves identically either way and would be a FAKE check.
 *
 *   `consumer` holds exactly ONE key, `EXPO_PUBLIC_POSTHOG_KEY`. That is not a
 *   weakness to be fixed by adding more: `app-mobile/app.config.ts` emits no
 *   Stripe key into `extra` at all, and every other consumer entry (the
 *   AppsFlyer trio, the PostHog host, the four Google client IDs) carries a
 *   committed literal fallback and would pass identically on a blind publish.
 *   POSTHOG_KEY's role here is a CANARY for whether `--environment production`
 *   was applied at all — it is not coverage of Stripe. Adding
 *   `EXPO_PUBLIC_APPSFLYER_DEV_KEY` here would look like more coverage and
 *   would be none.
 *
 *   `business` deliberately EXCLUDES `EXPO_PUBLIC_POSTHOG_KEY`, which on that
 *   app has a committed literal fallback (`app.config.ts`) and therefore always
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

/** V-3 — an `extra` this small means every assertion below would be vacuous. */
export const MIN_EXTRA_KEYS = 5;

/**
 * Per-app expectation tables. Exported so the #994 strict-grep gate and the
 * tester can read them without re-deriving. See the header before editing.
 * @type {Record<string, {name: string, required: boolean, prefix: string|null}[]>}
 */
export const EXPECTATIONS = {
  consumer: [
    { name: "EXPO_PUBLIC_POSTHOG_KEY", required: true, prefix: "phc_" },
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
        `V-3: \`extra\` holds ${keyCount} keys (floor ${MIN_EXTRA_KEYS}); every assertion ` +
          "below would pass for the wrong reason. Both apps ship 15+ extra keys.",
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
 * @returns {{code:number, messages:string[], live:number, extraKeys:number}}
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

  const result = assertExtra(manifest.extra, expectations);
  return {
    ...result,
    extraKeys:
      manifest.extra && typeof manifest.extra === "object"
        ? Object.keys(manifest.extra).length
        : 0,
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
  }

  if (problems.length) {
    console.error("#994 OTA-MANIFEST-VERIFY self-test FAIL:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }
  console.log(
    "#994 OTA-MANIFEST-VERIFY self-test PASS (25/25: 1-8 per-key verdicts incl. " +
      "UNSET SIGNATURE first, 9-11 multipart/expo+json body extraction, 12-17 vacuity " +
      "(404, non-JSON, no launchAsset, thin extra, [] and wrong-platform update json), " +
      "18-23 empty table / unparseable / non-array / empty permalink / happy parse / null extra, " +
      "24-25 the real expectation tables stay non-empty and un-padded).",
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
        `expected extra key(s) live; ${result.extraKeys} extra keys present.`,
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
