#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture → TestFlight hard-gate] —
 * I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT.
 *
 * WHY: the live TestFlight install URL (testflight.apple.com/join/1gvHNqkQ) must
 * be revealed ONLY after a SUCCESSFUL submit, and ONLY on the iOS branch of the
 * success panel. Any error / idle / step render path showing the link = fail-open
 * (Seth decision 1). So this gate asserts, in get-the-app-modal.tsx:
 *
 *   1. The TestFlight token appears ONLY inside the iOS success-render region —
 *      i.e. inside the `SuccessPanel` function AND inside the `isIos ? … : …`
 *      true-branch. It must NOT appear in the step/idle/error render path, the
 *      transport, or the nav.
 *   2. The token NEVER appears in glass-nav.tsx or lib/explorer-app-submit.ts.
 *
 * The companion gate i-proposed-1216-android-no-testflight-link.mjs asserts the
 * non-iOS branch carries NO TestFlight token and no "Open in TestFlight" label.
 *
 * `--self-test` injects synthetic fixtures (URL in step body / error path / nav /
 * transport → MUST fire; URL only in the iOS success branch → MUST pass).
 *
 * Model: orch-1211-notif-web-render-safe.mjs (comment-aware string scanner).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MODAL = "mingla-marketing/components/marketing/get-the-app-modal.tsx";
const NAV = "mingla-marketing/components/marketing/glass-nav.tsx";
const TRANSPORT = "mingla-marketing/lib/explorer-app-submit.ts";

const TESTFLIGHT_TOKEN = "testflight.apple.com";

/**
 * Locate the body of the SuccessPanel function in the modal source. Returns the
 * substring from `function SuccessPanel` to the matching close brace (best-effort
 * brace-depth scan). The TestFlight token MUST live inside this region.
 */
function successPanelRegion(src) {
  const start = src.indexOf("function SuccessPanel");
  if (start === -1) return null;
  // Find the first "{" after the signature, then brace-match.
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
  return src.slice(braceStart); // unbalanced — return the rest (gate will still check)
}

/**
 * Within the SuccessPanel region, isolate the iOS true-branch of the
 * `isIos ? ( … ) : ( … )` ternary. We scan from the `isIos ?` marker, paren-match
 * the first `(` group → that group is the iOS branch JSX.
 */
function iosBranchRegion(panel) {
  const tern = panel.search(/isIos\s*\?/);
  if (tern === -1) return null;
  const parenStart = panel.indexOf("(", tern);
  if (parenStart === -1) return null;
  let depth = 0;
  for (let i = parenStart; i < panel.length; i++) {
    const c = panel[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return panel.slice(parenStart, i + 1);
    }
  }
  return null;
}

function checkModal(src, failures) {
  const occurrences = src.split(TESTFLIGHT_TOKEN).length - 1;
  if (occurrences === 0) {
    failures.push(
      `${MODAL}: TestFlight token "${TESTFLIGHT_TOKEN}" not found at all — the ` +
        `iOS success branch must reveal the install link.`,
    );
    return;
  }
  const panel = successPanelRegion(src);
  if (!panel) {
    failures.push(`${MODAL}: could not locate function SuccessPanel.`);
    return;
  }
  const panelOccurrences = panel.split(TESTFLIGHT_TOKEN).length - 1;
  if (panelOccurrences !== occurrences) {
    failures.push(
      `${MODAL}: the TestFlight token appears OUTSIDE the SuccessPanel render ` +
        `region (${occurrences - panelOccurrences} occurrence(s)) — it must live ` +
        `ONLY in the iOS success branch (no fail-open).`,
    );
    return;
  }
  const iosBranch = iosBranchRegion(panel);
  if (!iosBranch) {
    failures.push(
      `${MODAL}: could not locate the \`isIos ? ( … )\` true-branch in SuccessPanel.`,
    );
    return;
  }
  const iosBranchOccurrences = iosBranch.split(TESTFLIGHT_TOKEN).length - 1;
  if (iosBranchOccurrences !== occurrences) {
    failures.push(
      `${MODAL}: the TestFlight token appears OUTSIDE the \`isIos\` true-branch ` +
        `(in the non-iOS branch or the shared region) — it must be guarded by ` +
        `\`platform==='ios'\` (I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT).`,
    );
  }
}

function checkAbsent(label, relPath, failures) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    failures.push(`${label}: target not found at ${relPath} (gate path out of sync).`);
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (src.includes(TESTFLIGHT_TOKEN)) {
    failures.push(
      `${relPath}: the TestFlight token "${TESTFLIGHT_TOKEN}" must NEVER appear ` +
        `here — it belongs ONLY in the iOS success branch of get-the-app-modal.tsx.`,
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

  // (a) URL ONLY in the iOS success branch → MUST pass.
  const good = `
function SuccessPanel(props) {
  const isIos = props.platform === 'ios'
  return (
    <div>
      {isIos ? (
        <a href="https://testflight.apple.com/join/1gvHNqkQ">Open in TestFlight</a>
      ) : (
        <p>We detect you're on Android.</p>
      )}
    </div>
  )
}
`;
  if (run(good).length !== 0) {
    selfFailures.push("URL only in the iOS success branch wrongly flagged");
  }

  // (b) URL leaked into the NON-iOS branch → MUST fire.
  const leakAndroid = `
function SuccessPanel(props) {
  const isIos = props.platform === 'ios'
  return (
    <div>
      {isIos ? (
        <p>iOS</p>
      ) : (
        <a href="https://testflight.apple.com/join/1gvHNqkQ">link</a>
      )}
    </div>
  )
}
`;
  if (run(leakAndroid).length === 0) {
    selfFailures.push("URL leaked into the non-iOS branch not flagged");
  }

  // (c) URL in a step body OUTSIDE SuccessPanel → MUST fire.
  const leakStep = `
function StepBody(props) {
  return <p>Install at https://testflight.apple.com/join/1gvHNqkQ now</p>
}
function SuccessPanel(props) {
  const isIos = props.platform === 'ios'
  return <div>{isIos ? <span>x</span> : <span>y</span>}</div>
}
`;
  if (run(leakStep).length === 0) {
    selfFailures.push("URL in a step body outside SuccessPanel not flagged");
  }

  // (d) URL absent entirely → MUST fire (link must exist for iOS users).
  const absent = `
function SuccessPanel(props) {
  const isIos = props.platform === 'ios'
  return <div>{isIos ? <span>no link</span> : <span>y</span>}</div>
}
`;
  if (run(absent).length === 0) {
    selfFailures.push("absent TestFlight URL not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT self-test PASS (4/4 cases).",
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
checkAbsent("nav", NAV, failures);
checkAbsent("transport", TRANSPORT, failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT FAIL — the TestFlight\n" +
      "install link must be revealed ONLY in the iOS success branch of\n" +
      "get-the-app-modal.tsx (no fail-open) and never in the nav/transport.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1216 I-PROPOSED-1216-TESTFLIGHT-BEHIND-SUBMIT PASS — TestFlight link sits\n" +
    "only in the iOS success branch; absent from the nav + transport.",
);
