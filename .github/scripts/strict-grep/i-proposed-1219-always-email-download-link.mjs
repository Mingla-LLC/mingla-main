#!/usr/bin/env node
/**
 * ORCH-1219 [Explorer form follow-ups] — I-PROPOSED-1219-ALWAYS-EMAIL-DOWNLOAD-LINK.
 *
 * WHY (Fix D): on EVERY newly `created` explorer lead the edge function must ALSO
 * email the LEAD a branded TestFlight download link (iOS, Android AND desktop) —
 * Seth: "also send when the user is on ios too". The internal seth@usemingla.com
 * notify must remain. A duplicate (already_on_list) returns BEFORE the send block
 * so the user email is naturally not re-sent (idempotency parity).
 *
 * This gate asserts, in supabase/functions/explorer-app-lead-submit/index.ts:
 *   1. A `buildDownloadLinkEmail` builder exists AND it carries the live
 *      TestFlight URL (testflight.apple.com/join/1gvHNqkQ).
 *   2. That builder is rendered through the shared `renderShell` (branded chrome).
 *   3. The builder is invoked in the handler's CREATED path — i.e. the
 *      `buildDownloadLinkEmail(` call sits AFTER the `already_on_list` early
 *      return (so duplicates never trigger it) and is passed to a `sendEmail(`
 *      call. If the call is missing, or sits before the already_on_list return,
 *      FIRE.
 *
 * --self-test injects fixtures:
 *   (a) compliant: builder + renderShell + send in the created path → MUST pass
 *   (b) no buildDownloadLinkEmail call at all                        → MUST fire
 *   (c) builder present but NOT wrapped in renderShell               → MUST fire
 *   (d) builder call placed BEFORE the already_on_list return        → MUST fire
 *   (e) builder present but missing the TestFlight URL               → MUST fire
 *
 * Model: orch-1211-notif-web-render-safe.mjs (region/string scanner).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const EDGE_FN =
  "supabase/functions/explorer-app-lead-submit/index.ts";

const TESTFLIGHT_TOKEN = "testflight.apple.com/join/1gvHNqkQ";
const BUILDER = "buildDownloadLinkEmail";
const RENDER_SHELL = "renderShell(";
const ALREADY_ON_LIST = 'status: "already_on_list"';
const SEND = "sendEmail(";

function check(src, failures) {
  // 1. Builder definition + TestFlight URL.
  if (!src.includes(`function ${BUILDER}`)) {
    failures.push(
      `${EDGE_FN}: no \`${BUILDER}\` builder — the lead-facing TestFlight email ` +
        `must be built (ORCH-1219 Fix D).`,
    );
    return;
  }
  if (!src.includes(TESTFLIGHT_TOKEN)) {
    failures.push(
      `${EDGE_FN}: the TestFlight URL "${TESTFLIGHT_TOKEN}" is absent — the ` +
        `download-link email must carry the install link.`,
    );
  }

  // 2. Builder body must flow through renderShell. Isolate the builder body by
  //    slicing from the builder definition to the NEXT top-level function decl.
  //    (A brace-depth scan is unreliable here because the body is dense with
  //    `${…}` template interpolations + inline-CSS `{…}` that a naive counter
  //    miscounts.)
  const bStart = src.indexOf(`function ${BUILDER}`);
  const afterDef = bStart + `function ${BUILDER}`.length;
  const nextDecl = (() => {
    const m = src.slice(afterDef).search(/\n(?:export )?(?:async )?function /);
    return m === -1 ? src.length : afterDef + m;
  })();
  const builderBody = src.slice(bStart, nextDecl);
  const bEnd = nextDecl;
  if (!builderBody.includes(RENDER_SHELL)) {
    failures.push(
      `${EDGE_FN}: \`${BUILDER}\` does not call \`${RENDER_SHELL}\` — the email ` +
        `must be wrapped in the branded Mingla shell.`,
    );
  }

  // 3. The builder must be INVOKED in the created path: a `buildDownloadLinkEmail(`
  //    call that is NOT the definition (`function buildDownloadLinkEmail(`),
  //    appearing AFTER the already_on_list early return, handed to a sendEmail(...).
  let callIdx = -1;
  {
    let from = 0;
    while (true) {
      const i = src.indexOf(`${BUILDER}(`, from);
      if (i === -1) break;
      const preceded = src.slice(Math.max(0, i - 9), i); // "function "
      if (!preceded.endsWith("function ")) {
        callIdx = i;
        break;
      }
      from = i + 1;
    }
  }
  // Keep bEnd referenced (used above for body slice end) to avoid lint churn.
  void bEnd;
  if (callIdx === -1) {
    failures.push(
      `${EDGE_FN}: \`${BUILDER}\` is defined but never CALLED in the handler — ` +
        `the lead email is never sent (ORCH-1219 Fix D).`,
    );
    return;
  }
  const alreadyIdx = src.indexOf(ALREADY_ON_LIST);
  if (alreadyIdx === -1) {
    failures.push(
      `${EDGE_FN}: could not find the \`already_on_list\` early return — cannot ` +
        `prove the user email is gated to the created path.`,
    );
    return;
  }
  if (callIdx < alreadyIdx) {
    failures.push(
      `${EDGE_FN}: the \`${BUILDER}(\` call sits BEFORE the already_on_list early ` +
        `return — duplicates would be re-emailed (idempotency break). It must run ` +
        `only on a NEW (created) lead.`,
    );
  }
  // The builder call must be the argument to a sendEmail( within ~200 chars.
  const region = src.slice(Math.max(0, callIdx - 200), callIdx + 80);
  if (!region.includes(SEND)) {
    failures.push(
      `${EDGE_FN}: the \`${BUILDER}(\` result is not passed to \`${SEND}\` — it ` +
        `must actually be sent via Resend.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    check(src, f);
    return f;
  };

  const mkBuilder = (withShell, withUrl) => `
export function buildDownloadLinkEmail(lead, from) {
  const url = ${withUrl ? '"https://testflight.apple.com/join/1gvHNqkQ"' : '"x"'};
  ${withShell ? "const html = renderShell({ bodyHtml: url });" : "const html = url;"}
  return { from, to: [lead.email], subject: "s", html, text: url };
}
`;
  const createdPath = (callBeforeReturn) => callBeforeReturn
    ? `
  ${"const u = await sendEmail(key, buildDownloadLinkEmail(lead, from));"}
  if (insertErr) {
    if (insertErr.code === "23505") return json({ ok: true, status: "already_on_list" }, 200);
  }
  return json({ ok: true, status: "created" }, 200);
`
    : `
  if (insertErr) {
    if (insertErr.code === "23505") return json({ ok: true, status: "already_on_list" }, 200);
  }
  const notify = await sendEmail(key, buildNotifyEmail(lead));
  const u = await sendEmail(key, buildDownloadLinkEmail(lead, from));
  return json({ ok: true, status: "created" }, 200);
`;

  // (a) compliant → MUST pass.
  if (run(mkBuilder(true, true) + createdPath(false)).length !== 0) {
    selfFailures.push("compliant created-path send wrongly flagged");
  }
  // (b) no builder call at all → MUST fire.
  const noCall = mkBuilder(true, true) + `
  if (insertErr) {
    if (insertErr.code === "23505") return json({ ok: true, status: "already_on_list" }, 200);
  }
  return json({ ok: true, status: "created" }, 200);
`;
  if (run(noCall).length === 0) {
    selfFailures.push("missing buildDownloadLinkEmail call not flagged");
  }
  // (c) builder not wrapped in renderShell → MUST fire.
  if (run(mkBuilder(false, true) + createdPath(false)).length === 0) {
    selfFailures.push("builder without renderShell not flagged");
  }
  // (d) builder call BEFORE the already_on_list return → MUST fire.
  if (run(mkBuilder(true, true) + createdPath(true)).length === 0) {
    selfFailures.push("call before already_on_list return not flagged");
  }
  // (e) builder missing the TestFlight URL → MUST fire.
  if (run(mkBuilder(true, false) + createdPath(false)).length === 0) {
    selfFailures.push("builder missing TestFlight URL not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1219 I-PROPOSED-1219-ALWAYS-EMAIL-DOWNLOAD-LINK self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1219 I-PROPOSED-1219-ALWAYS-EMAIL-DOWNLOAD-LINK self-test PASS (5/5 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, EDGE_FN);
if (!fs.existsSync(abs)) {
  console.error(
    `ORCH-1219 gate FAIL — target not found at ${EDGE_FN} (gate path out of sync).`,
  );
  process.exit(1);
}
const failures = [];
check(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1219 I-PROPOSED-1219-ALWAYS-EMAIL-DOWNLOAD-LINK FAIL — the edge fn must\n" +
      "email the lead a branded TestFlight download link on every CREATED submit\n" +
      "(iOS + non-iOS), never on a duplicate.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1219 I-PROPOSED-1219-ALWAYS-EMAIL-DOWNLOAD-LINK PASS — the branded\n" +
    "download-link email is built (renderShell + TestFlight URL) and sent on the\n" +
    "created path, after the already_on_list early return.",
);
