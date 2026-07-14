#!/usr/bin/env node
/**
 * ORCH-1369 [release-1.1.2-config] —
 * I-RELEASE-SUBMIT-CONFIG.
 *
 * WHY: the two Mingla mobile apps are submitted to the stores via
 * `eas submit --profile production`, driven by each app's `eas.json`
 * `submit.production` block. Two proven team learnings must never regress:
 *
 *  1) Android internal-track `releaseStatus: "draft"` leaves the uploaded AAB
 *     UNPUBLISHED — an internal tester cannot install a draft. The proven
 *     value is `"completed"` (installable by internal testers). The `track`
 *     stays `"internal"` (this is NOT a public rollout); only the publish
 *     STATUS changes.
 *
 *  2) The BUSINESS iOS submit block must carry the App Store Connect API-key
 *     credentials (`ascApiKeyPath` + `ascApiKeyId` + `ascApiKeyIssuerId`) — the
 *     same key/issuer the consumer app already uses (same Apple team). Without
 *     them `eas submit` falls back to interactive Apple auth, which stalls the
 *     unattended release pipeline (bare `ascAppId` is not enough).
 *
 * This gate fails the build the moment either regression reappears.
 *
 * ASSERTS:
 *  A. app-mobile/eas.json    submit.production.android.releaseStatus === "completed"
 *     (specifically: it is NOT "draft").
 *  B. mingla-business/eas.json submit.production.android.releaseStatus === "completed"
 *     (specifically: it is NOT "draft").
 *  C. mingla-business/eas.json submit.production.ios declares ALL THREE of
 *     `ascApiKeyPath`, `ascApiKeyId`, `ascApiKeyIssuerId` as non-empty strings.
 *
 * A revert that flips either android `releaseStatus` back to "draft", or drops
 * any of the three business-iOS ASC API-key fields, must FAIL CI.
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location
// (.github/scripts/strict-grep/ → up three levels), so the gate runs
// identically from CI (repo-root cwd) and from any nested cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

const CONSUMER_EAS_JSON = path.join(root, "app-mobile/eas.json");
const BUSINESS_EAS_JSON = path.join(root, "mingla-business/eas.json");

// The three App Store Connect API-key fields the iOS submit profile must carry.
const REQUIRED_IOS_ASC_FIELDS = [
  "ascApiKeyPath",
  "ascApiKeyId",
  "ascApiKeyIssuerId",
];

/**
 * Parse an eas.json source string; push a failure and return null on bad JSON.
 */
function parseEas(label, easJsonSrc, failures) {
  try {
    return JSON.parse(easJsonSrc);
  } catch (e) {
    failures.push(`${label} is not valid JSON: ${e.message}`);
    return null;
  }
}

/**
 * A — the android submit.production.releaseStatus must be "completed", never
 * "draft" (a draft internal-track upload is UNPUBLISHED / non-installable).
 */
function checkAndroidReleaseStatus(label, parsed, failures) {
  if (parsed === null) return;
  const android = parsed?.submit?.production?.android;
  if (android === undefined || android === null) {
    failures.push(
      `${label} is missing submit.production.android — cannot confirm the ` +
        `internal-track release is published (releaseStatus "completed").`,
    );
    return;
  }
  const status = android.releaseStatus;
  if (status === "draft") {
    failures.push(
      `${label} submit.production.android.releaseStatus is "draft" — a draft ` +
        `internal-track upload is UNPUBLISHED and internal testers cannot ` +
        `install it. Set it to "completed" (keep track "internal").`,
    );
  } else if (status !== "completed") {
    failures.push(
      `${label} submit.production.android.releaseStatus must be "completed" ` +
        `(found: ${JSON.stringify(status)}).`,
    );
  }
}

/**
 * C — the business iOS submit block must carry all three ASC API-key fields as
 * non-empty strings (bare ascAppId falls back to interactive Apple auth).
 */
function checkBusinessIosAscKeys(label, parsed, failures) {
  if (parsed === null) return;
  const ios = parsed?.submit?.production?.ios;
  if (ios === undefined || ios === null) {
    failures.push(
      `${label} is missing submit.production.ios — cannot confirm the App ` +
        `Store Connect API-key credentials are present.`,
    );
    return;
  }
  for (const field of REQUIRED_IOS_ASC_FIELDS) {
    const value = ios[field];
    if (typeof value !== "string" || value.trim() === "") {
      failures.push(
        `${label} submit.production.ios must declare a non-empty string ` +
          `${field} (found: ${JSON.stringify(value)}). Unattended \`eas ` +
          `submit\` needs the ASC API key (path + id + issuer id), not just ` +
          `ascAppId.`,
      );
    }
  }
}

/**
 * Core check: given the two eas.json source strings, populate `failures`.
 */
function checkSubmitConfig(consumerSrc, businessSrc, failures) {
  const consumer = parseEas("app-mobile/eas.json", consumerSrc, failures);
  const business = parseEas("mingla-business/eas.json", businessSrc, failures);

  checkAndroidReleaseStatus("app-mobile/eas.json", consumer, failures);
  checkAndroidReleaseStatus("mingla-business/eas.json", business, failures);
  checkBusinessIosAscKeys("mingla-business/eas.json", business, failures);
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const goodConsumer = JSON.stringify({
    submit: {
      production: {
        android: { track: "internal", releaseStatus: "completed" },
        ios: { ascAppId: "6760440898" },
      },
    },
  });
  const goodBusiness = JSON.stringify({
    submit: {
      production: {
        android: { track: "internal", releaseStatus: "completed" },
        ios: {
          ascAppId: "6768737367",
          ascApiKeyPath: "/Users/x/AuthKey_B39RMRV6D8.p8",
          ascApiKeyId: "B39RMRV6D8",
          ascApiKeyIssuerId: "ee78d0ff-158c-4326-80ef-aec69745fc2d",
        },
      },
    },
  });

  // Good fixtures must pass clean.
  let f = [];
  checkSubmitConfig(goodConsumer, goodBusiness, f);
  if (f.length) self.push("good eas.json pair wrongly flagged: " + f.join("; "));

  // Revert A: consumer android releaseStatus back to "draft" → must fire.
  const draftConsumer = JSON.parse(goodConsumer);
  draftConsumer.submit.production.android.releaseStatus = "draft";
  f = [];
  checkSubmitConfig(JSON.stringify(draftConsumer), goodBusiness, f);
  if (f.length === 0) {
    self.push('consumer android releaseStatus "draft" was not flagged');
  }

  // Revert B: business android releaseStatus back to "draft" → must fire.
  const draftBusiness = JSON.parse(goodBusiness);
  draftBusiness.submit.production.android.releaseStatus = "draft";
  f = [];
  checkSubmitConfig(goodConsumer, JSON.stringify(draftBusiness), f);
  if (f.length === 0) {
    self.push('business android releaseStatus "draft" was not flagged');
  }

  // Revert C1: drop business iOS ascApiKeyPath → must fire.
  const noPath = JSON.parse(goodBusiness);
  delete noPath.submit.production.ios.ascApiKeyPath;
  f = [];
  checkSubmitConfig(goodConsumer, JSON.stringify(noPath), f);
  if (f.length === 0) self.push("missing business iOS ascApiKeyPath not flagged");

  // Revert C2: blank business iOS ascApiKeyId → must fire.
  const blankId = JSON.parse(goodBusiness);
  blankId.submit.production.ios.ascApiKeyId = "   ";
  f = [];
  checkSubmitConfig(goodConsumer, JSON.stringify(blankId), f);
  if (f.length === 0) self.push("blank business iOS ascApiKeyId not flagged");

  // Revert C3: drop business iOS ascApiKeyIssuerId → must fire.
  const noIssuer = JSON.parse(goodBusiness);
  delete noIssuer.submit.production.ios.ascApiKeyIssuerId;
  f = [];
  checkSubmitConfig(goodConsumer, JSON.stringify(noIssuer), f);
  if (f.length === 0) {
    self.push("missing business iOS ascApiKeyIssuerId not flagged");
  }

  // Regress: business iOS back to bare ascAppId only (the pre-ORCH-1369 shape)
  // → must fire (all three ASC fields missing at once).
  const bareIos = JSON.parse(goodBusiness);
  bareIos.submit.production.ios = { ascAppId: "6768737367" };
  f = [];
  checkSubmitConfig(goodConsumer, JSON.stringify(bareIos), f);
  if (f.length === 0) {
    self.push("bare business iOS ascAppId-only block not flagged");
  }

  // Invalid JSON on one side → must fire.
  f = [];
  checkSubmitConfig(goodConsumer, "{ not json", f);
  if (f.length === 0) self.push("invalid business eas.json not flagged");

  if (self.length) {
    console.error("ORCH-1369 release-submit-config self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1369 release-submit-config self-test PASS (8/8 cases).",
  );
  process.exit(0);
}

const failures = [];
for (const [label, file] of [
  ["app-mobile/eas.json", CONSUMER_EAS_JSON],
  ["mingla-business/eas.json", BUSINESS_EAS_JSON],
]) {
  if (!fs.existsSync(file)) {
    console.error(
      `ORCH-1369 I-RELEASE-SUBMIT-CONFIG script error: ${label} not found ` +
        `at ${file}.`,
    );
    process.exit(2);
  }
}

checkSubmitConfig(
  fs.readFileSync(CONSUMER_EAS_JSON, "utf8"),
  fs.readFileSync(BUSINESS_EAS_JSON, "utf8"),
  failures,
);

if (failures.length > 0) {
  console.error(
    "ORCH-1369 I-RELEASE-SUBMIT-CONFIG FAIL:\n  " + failures.join("\n  ") +
      "\n\nSee Mingla_Artifacts/INVARIANT_REGISTRY.md I-RELEASE-SUBMIT-CONFIG.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1369 I-RELEASE-SUBMIT-CONFIG PASS — both apps' " +
    'submit.production.android.releaseStatus is "completed" and ' +
    "mingla-business/eas.json submit.production.ios carries the ASC API-key " +
    "credentials (ascApiKeyPath + ascApiKeyId + ascApiKeyIssuerId).",
);
