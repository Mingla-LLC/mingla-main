#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture → TestFlight hard-gate] —
 * TESTER adversarial guard: I-PROPOSED-1216-SUCCESS-MOUNT-GATED.
 *
 * ATTACK ANGLE (deliberately DIFFERENT from the implementor's gates):
 *   The implementor's i-proposed-1216-testflight-behind-submit.mjs proves the
 *   TestFlight URL is textually INSIDE `function SuccessPanel` and inside the
 *   `isIos ? (…)` true-branch (callee-side). The android-no-link gate checks the
 *   non-iOS branch. NEITHER gate verifies the *caller-side* gate: that
 *   <SuccessPanel … /> is only MOUNTED when `status === 'success'`. If someone
 *   inverted / dropped the `status === 'success' ?` mount condition, SuccessPanel
 *   (and its iOS TestFlight link) would render on an idle / step / error state —
 *   a fail-open — and EVERY implementor gate would still PASS (the URL never
 *   moved out of the function body). This gate closes that hole.
 *
 * It asserts, in get-the-app-modal.tsx:
 *   1. <SuccessPanel is mounted exactly once.
 *   2. Its nearest-preceding render guard is `status === 'success'` — i.e. the
 *      mount sits inside a `{status === 'success' ? <SuccessPanel … /> : …}`
 *      conditional. If the mount is unconditional or guarded by something else,
 *      FIRE (the TestFlight link could render outside a successful submit).
 *   3. The `platform=` prop passed to SuccessPanel is the component's `platform`
 *      state (not a literal `"ios"`), so the branch is driven by the detected
 *      device, never hard-pinned to iOS.
 *
 * This is NOT a renamed copy of any implementor gate: it scans the MOUNT SITE
 * (the `{status === 'success' ? <SuccessPanel …}` JSX in GetTheAppModal), where
 * the implementor's gates scan the SuccessPanel function body + the nav/transport.
 *
 * `--self-test` injects fixtures:
 *   (a) correct `status === 'success' ?`-gated mount        → MUST pass
 *   (b) unconditional <SuccessPanel … /> mount              → MUST fire
 *   (c) mount gated by the WRONG condition (status==='idle')→ MUST fire
 *   (d) platform pinned to a literal "ios"                  → MUST fire
 *
 * Model: orch-1211-notif-web-render-safe.mjs (string/region scanner).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MODAL = "mingla-marketing/components/marketing/get-the-app-modal.tsx";
const MOUNT = "<SuccessPanel";
const SUCCESS_GUARD = "status === 'success'";

function checkModal(src, failures) {
  const occurrences = src.split(MOUNT).length - 1;
  if (occurrences === 0) {
    failures.push(
      `${MODAL}: <SuccessPanel is never mounted — the success state cannot render ` +
        `(the iOS TestFlight link would be unreachable).`,
    );
    return;
  }
  if (occurrences > 1) {
    failures.push(
      `${MODAL}: <SuccessPanel is mounted ${occurrences} times — there must be ` +
        `exactly one success mount, gated by status === 'success'.`,
    );
    return;
  }

  const idx = src.indexOf(MOUNT);
  // The mount must be immediately preceded (within ~120 chars — the JSX ternary
  // head `{status === 'success' ? (`) by the success guard, AND that guard must
  // be the nearest-preceding `status === '…'` comparison.
  const before = src.slice(Math.max(0, idx - 120), idx);
  const successPos = before.lastIndexOf(SUCCESS_GUARD);
  // any OTHER status comparison nearer than the success guard = wrong gate
  const otherStatusMatch = [...before.matchAll(/status === '(\w+)'/g)];
  const lastStatus = otherStatusMatch.length
    ? otherStatusMatch[otherStatusMatch.length - 1][1]
    : null;

  if (successPos === -1 || lastStatus !== "success") {
    failures.push(
      `${MODAL}: <SuccessPanel mount is NOT gated by \`status === 'success'\` ` +
        `(nearest-preceding status guard = ${lastStatus ?? "none"}). The success ` +
        `panel — and its iOS TestFlight link — must render ONLY on a successful ` +
        `submit (no fail-open). (I-PROPOSED-1216-SUCCESS-MOUNT-GATED)`,
    );
    return;
  }

  // The platform prop must be the state var, not a literal — guard against the
  // branch being hard-pinned to iOS (which would force the link on every device).
  const mountRegionEnd = src.indexOf("/>", idx);
  const mountRegion = src.slice(idx, mountRegionEnd === -1 ? idx + 200 : mountRegionEnd);
  if (/platform=\{?\s*["']ios["']/.test(mountRegion) || /platform="ios"/.test(mountRegion)) {
    failures.push(
      `${MODAL}: <SuccessPanel platform prop is pinned to the literal "ios" — it ` +
        `must pass the detected \`platform\` state so non-iOS users never see the ` +
        `TestFlight link.`,
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

  // (a) correct: status === 'success' ?-gated mount → MUST pass
  const good = `
{status === 'success' ? (
  <SuccessPanel headingId={headingId} platform={platform} reduced={reduced} onDone={onClose} />
) : (
  <div>form</div>
)}
`;
  if (run(good).length !== 0) {
    selfFailures.push("correctly status==='success'-gated mount wrongly flagged");
  }

  // (b) unconditional mount → MUST fire
  const uncond = `
<SuccessPanel headingId={headingId} platform={platform} reduced={reduced} onDone={onClose} />
`;
  if (run(uncond).length === 0) {
    selfFailures.push("unconditional <SuccessPanel mount not flagged");
  }

  // (c) gated by the WRONG status → MUST fire
  const wrong = `
{status === 'idle' ? (
  <SuccessPanel headingId={headingId} platform={platform} reduced={reduced} onDone={onClose} />
) : null}
`;
  if (run(wrong).length === 0) {
    selfFailures.push("mount gated by status==='idle' not flagged");
  }

  // (d) platform pinned to literal "ios" → MUST fire
  const pinned = `
{status === 'success' ? (
  <SuccessPanel headingId={headingId} platform="ios" reduced={reduced} onDone={onClose} />
) : null}
`;
  if (run(pinned).length === 0) {
    selfFailures.push("platform pinned to literal 'ios' not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-SUCCESS-MOUNT-GATED self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-SUCCESS-MOUNT-GATED self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const modalAbs = path.join(root, MODAL);
if (!fs.existsSync(modalAbs)) {
  console.error(
    `ORCH-1216 gate FAIL — target not found at ${MODAL} (gate path out of sync).`,
  );
  process.exit(1);
}
const failures = [];
checkModal(fs.readFileSync(modalAbs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-SUCCESS-MOUNT-GATED FAIL — the success panel (and\n" +
      "its iOS TestFlight link) must be mounted ONLY inside a `status === 'success'`\n" +
      "guard, driven by the detected platform.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1216 I-PROPOSED-1216-SUCCESS-MOUNT-GATED PASS — <SuccessPanel mounts only\n" +
    "under status === 'success', with the detected platform prop (no fail-open).",
);
