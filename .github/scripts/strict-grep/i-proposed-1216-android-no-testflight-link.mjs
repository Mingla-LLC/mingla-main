#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture → TestFlight hard-gate] —
 * I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK.
 *
 * WHY: on a non-iOS (Android / desktop) device the success panel must show
 * Seth's "iOS-only beta" message and NO TestFlight link (Seth decision 3). This
 * gate asserts the non-iOS (`isIos` ? … : THIS) branch of the SuccessPanel in
 * get-the-app-modal.tsx contains NEITHER the `testflight.apple.com` token NOR
 * the "Open in TestFlight" label.
 *
 * `--self-test` injects fixtures (URL or label in the non-iOS branch → MUST fire;
 * compliant Seth-message-only branch → MUST pass).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MODAL = "mingla-marketing/components/marketing/get-the-app-modal.tsx";

const TESTFLIGHT_TOKEN = "testflight.apple.com";
const TESTFLIGHT_LABEL = "Open in TestFlight";

function successPanelRegion(src) {
  const start = src.indexOf("function SuccessPanel");
  if (start === -1) return null;
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return src.slice(braceStart);
}

/**
 * Isolate the NON-iOS (false) branch of `isIos ? ( ios ) : ( other )`. We
 * paren-match the iOS `(` group, then paren-match the FIRST `(` group that
 * follows the closing `)` + `:` → that is the non-iOS branch.
 */
function nonIosBranchRegion(panel) {
  const tern = panel.search(/isIos\s*\?/);
  if (tern === -1) return null;
  // iOS branch parens.
  let i = panel.indexOf("(", tern);
  if (i === -1) return null;
  let depth = 0;
  let iosEnd = -1;
  for (; i < panel.length; i++) {
    const c = panel[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        iosEnd = i;
        break;
      }
    }
  }
  if (iosEnd === -1) return null;
  // After the iOS branch there must be a `:` then the non-iOS `(` group.
  const colon = panel.indexOf(":", iosEnd);
  if (colon === -1) return null;
  const otherStart = panel.indexOf("(", colon);
  if (otherStart === -1) return null;
  depth = 0;
  for (let j = otherStart; j < panel.length; j++) {
    const c = panel[j];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return panel.slice(otherStart, j + 1);
    }
  }
  return null;
}

function checkModal(src, failures) {
  const panel = successPanelRegion(src);
  if (!panel) {
    failures.push(`${MODAL}: could not locate function SuccessPanel.`);
    return;
  }
  const other = nonIosBranchRegion(panel);
  if (!other) {
    failures.push(
      `${MODAL}: could not locate the non-iOS (\`isIos ? … : ( … )\`) branch in SuccessPanel.`,
    );
    return;
  }
  if (other.includes(TESTFLIGHT_TOKEN)) {
    failures.push(
      `${MODAL}: the non-iOS success branch contains the TestFlight token ` +
        `"${TESTFLIGHT_TOKEN}" — Android/non-iOS users must get NO install link.`,
    );
  }
  if (other.includes(TESTFLIGHT_LABEL)) {
    failures.push(
      `${MODAL}: the non-iOS success branch contains the "${TESTFLIGHT_LABEL}" ` +
        `label — Android/non-iOS users must get NO install button.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    checkModal(src, f);
    return f;
  };

  const wrap = (iosBody, otherBody) => `
function SuccessPanel(props) {
  const isIos = props.platform === 'ios'
  return (
    <div>
      {isIos ? (
        ${iosBody}
      ) : (
        ${otherBody}
      )}
    </div>
  )
}
`;

  // (a) Compliant: Seth message only in the non-iOS branch → MUST pass.
  const good = wrap(
    `<a href="https://testflight.apple.com/join/1gvHNqkQ">Open in TestFlight</a>`,
    `<p>We detect you're on Android — iOS-only beta.</p>`,
  );
  if (run(good).length !== 0) {
    selfFailures.push("compliant Seth-message-only non-iOS branch wrongly flagged");
  }

  // (b) URL leaked into the non-iOS branch → MUST fire.
  const leakUrl = wrap(
    `<span>iOS</span>`,
    `<a href="https://testflight.apple.com/join/1gvHNqkQ">link</a>`,
  );
  if (run(leakUrl).length === 0) {
    selfFailures.push("TestFlight URL in the non-iOS branch not flagged");
  }

  // (c) "Open in TestFlight" label leaked into the non-iOS branch → MUST fire.
  const leakLabel = wrap(
    `<span>iOS</span>`,
    `<button>Open in TestFlight</button>`,
  );
  if (run(leakLabel).length === 0) {
    selfFailures.push("'Open in TestFlight' label in the non-iOS branch not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK self-test PASS (3/3 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const modalAbs = path.join(root, MODAL);
if (!fs.existsSync(modalAbs)) {
  console.error(
    `ORCH-1216 gate FAIL — target not found at ${MODAL} (gate path out of sync with source).`,
  );
  process.exit(1);
}
const failures = [];
checkModal(fs.readFileSync(modalAbs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK FAIL — the non-iOS\n" +
      "success branch must show Seth's iOS-only message with NO TestFlight link.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1216 I-PROPOSED-1216-ANDROID-NO-TESTFLIGHT-LINK PASS — non-iOS branch\n" +
    "carries no TestFlight token and no 'Open in TestFlight' label.",
);
