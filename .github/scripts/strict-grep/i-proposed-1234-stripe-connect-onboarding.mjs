#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1234 (two Stripe Connect onboarding bugs).
 *
 * BUG A — audit write threw a uuid error and failed the ENTIRE Connect webhook.
 *   audit_log.event_id is a uuid column. The Connect webhook call sites were
 *   passing a Stripe `evt_…` id into it → writeAudit threw → the whole webhook
 *   was marked processed=false (Stripe retried forever; downstream notify +
 *   AppsFlyer never ran). Fix = pass `event_id: null` at those sites + a
 *   defense-in-depth coercion in writeAudit so a non-uuid id can NEVER reach the
 *   uuid column again.
 *
 *   GATE A (revert = a Stripe id flows back into event_id = fail):
 *     A1. In _shared/stripeWebhookRouter.ts, NO `writeAudit` call site passes a
 *         Stripe event id (`event.id` / `eventId`) into `event_id:`. The ONLY
 *         non-null `event_id:` allowed in that file is the real Mingla
 *         `orderDetail.event_id` (handleRefundEvent reconciliation). Every other
 *         `event_id:` MUST be `null`.
 *     A2. stripe-webhook/index.ts: the writeAudit `event_id:` is `null` (never
 *         `event.id`).
 *     A3. _shared/audit.ts coerces a non-uuid event_id to null before INSERT
 *         (a uuid regex + a coercion helper applied to event_id in the insert).
 *
 * BUG B — post-onboarding redirect stranded the user on "Redirecting…".
 *   ConnectOnboardingBody.web.tsx ran in a sessionless in-app browser and did a
 *   client-side router.replace into the auth-gated /brand/<id>/payments route →
 *   the root layout bounced it to sign-in → stuck. Fix = persist return_to to
 *   sessionStorage, recover it in handleExit, and FULL-PAGE navigate (never
 *   router.replace into an auth-gated SPA route).
 *
 *   GATE B (revert = SPA-replace into the authed payments route returns = fail):
 *     B1. ConnectOnboardingBody.web.tsx does NOT navigate to `/brand/.../payments`
 *         (the auth-gated SPA route) anywhere, and does NOT call router.replace /
 *         router.push at all (the sessionless browser has no session).
 *     B2. handleExit recovers return_to from sessionStorage (readPersistedReturnTo
 *         / sessionStorage.getItem) AND uses a full-page navigation
 *         (window.location.assign or window.location.href).
 *     B3. return_to is persisted on mount (sessionStorage.setItem) so it survives
 *         Stripe's intra-flow param drop.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let failures = 0;
const fail = (check, msg) => {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
};
const ok = (check, msg) => console.log(`OK   [${check}] ${msg}`);

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`fs error reading ${rel}: ${e.message}`);
    process.exit(2);
  }
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROUTER = "supabase/functions/_shared/stripeWebhookRouter.ts";
const WEBHOOK = "supabase/functions/stripe-webhook/index.ts";
const AUDIT = "supabase/functions/_shared/audit.ts";
const ONBOARD_BODY =
  "mingla-business/src/components/stripe/connect-pages/ConnectOnboardingBody.web.tsx";

// Pull the `event_id:` value from every writeAudit(...) CALL ONLY (comment-stripped).
// Other `event_id:`/`*_event_id:` object fields (HTTP response bodies, the
// idempotency `stripe_webhook_event_id`, console.warn breadcrumbs) are NOT audit
// inserts and are deliberately ignored. The leading boundary `[\s{(,]` prevents
// matching `webhook_event_id`/`stripe_event_id` substrings.
function eventIdValues(rawSrc) {
  const src = stripComments(rawSrc);
  const values = [];
  // Find each `writeAudit(` and scan its balanced argument object for event_id.
  const re = /writeAudit\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Slice a generous window after the call open-paren and read the FIRST
    // event_id: field inside it (the audit input object is the first object arg).
    const window = src.slice(m.index, m.index + 1200);
    const f = window.match(/[\s{(,]event_id\s*:\s*([A-Za-z0-9_.]+)\s*,/);
    if (f) values.push(f[1]);
  }
  return values;
}

// ----- A: router event_id values -----
function checkRouter(rawSrc) {
  const values = eventIdValues(rawSrc);
  // Allowed non-null value: the real Mingla orderDetail.event_id only.
  const offenders = values.filter(
    (v) => v !== "null" && v !== "orderDetail.event_id",
  );
  return { values, offenders };
}

function runSelfTest() {
  let f = 0;
  const expect = (cond, label) => {
    if (!cond) {
      console.error(`SELF-TEST FAIL: ${label}`);
      f++;
    }
  };

  // A1 — router: Stripe id offender detected, null + orderDetail allowed.
  const badRouter = `
    await writeAudit(s, { event_id: event.id, action: "x" });
    await writeAudit(s, { event_id: eventId, action: "y" });
  `;
  const goodRouter = `
    await writeAudit(s, { event_id: null, action: "x" });
    await writeAudit(s, { event_id: orderDetail.event_id, action: "y" });
  `;
  expect(checkRouter(badRouter).offenders.length === 2, "bad router not flagged");
  expect(checkRouter(goodRouter).offenders.length === 0, "good router flagged");
  // comment-stripping: a commented event_id must NOT count.
  expect(
    checkRouter(`// event_id: event.id,\nawait w({ event_id: null,`).offenders
      .length === 0,
    "commented event_id falsely counted",
  );

  // A3 — audit coercion detectors.
  const goodAudit = `
    const UUID_RE = /^[0-9a-f]{8}-.../i;
    function coerceEventId(e){ return UUID_RE.test(e) ? e : null; }
    insert({ event_id: coerceEventId(input.event_id) });
  `;
  const badAudit = `insert({ event_id: input.event_id ?? null });`;
  expect(/coerceEventId|UUID_RE|isUuid/i.test(goodAudit), "good audit missing coercion token");
  expect(!/coerceEventId|UUID_RE|isUuid/i.test(badAudit), "bad audit falsely passed coercion");

  // B — onboarding body detectors.
  const badBody = `router.replace(\`/brand/\${brandId}/payments\`);`;
  const goodBody = `
    const r = readPersistedReturnTo();
    window.sessionStorage.setItem(KEY, returnTo);
    window.location.assign(recovered);
  `;
  expect(/router\.(replace|push)/.test(badBody), "bad body router nav not detected");
  expect(/\/brand\/[^"'\`]*\/payments/.test(badBody) || /\/payments`/.test(badBody) || badBody.includes("/payments"), "bad body payments route not detected");
  expect(!/router\.(replace|push)/.test(goodBody), "good body falsely flagged for router nav");
  expect(/window\.location\.(assign|href)/.test(goodBody), "good body full-page nav not detected");
  expect(/sessionStorage/.test(goodBody), "good body sessionStorage not detected");

  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1234 detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

// ===== BUG A =====
// A1 — router
{
  const { values, offenders } = checkRouter(read(ROUTER));
  if (values.length === 0) {
    fail("A1: router-event-id", `no event_id: values found in ${ROUTER} — file structure changed`);
  } else if (offenders.length > 0) {
    fail(
      "A1: router-event-id",
      `${ROUTER} passes Stripe event id(s) into the uuid event_id column: ${JSON.stringify(offenders)}. ` +
        `Connect webhooks have NO Mingla event uuid — pass event_id: null (the Stripe id lives in payment_webhook_events.stripe_event_id). ` +
        `Only orderDetail.event_id (a real Mingla events.id) may be non-null.`,
    );
  } else {
    ok("A1: router-event-id", `all ${values.length} writeAudit event_id values are null or the real Mingla orderDetail.event_id`);
  }
}

// A2 — stripe-webhook/index.ts
{
  const values = eventIdValues(read(WEBHOOK));
  const offenders = values.filter((v) => v !== "null");
  if (offenders.length > 0) {
    fail(
      "A2: webhook-ip-soft-fail-event-id",
      `${WEBHOOK} writeAudit passes a non-null event_id ${JSON.stringify(offenders)} — must be null (Stripe event id is preserved in target_id text).`,
    );
  } else {
    ok("A2: webhook-ip-soft-fail-event-id", `${WEBHOOK} writeAudit event_id is null`);
  }
}

// A3 — audit coercion
{
  const src = stripComments(read(AUDIT));
  const hasUuidGuard = /UUID_RE|coerceEventId|isUuid/.test(src);
  const insertUsesCoercion = /event_id\s*:\s*coerceEventId\s*\(/.test(src);
  const rawPassthrough = /event_id\s*:\s*input\.event_id\s*\?\?\s*null/.test(src);
  if (!hasUuidGuard || !insertUsesCoercion || rawPassthrough) {
    fail(
      "A3: audit-coerces-non-uuid",
      `${AUDIT} must coerce a non-uuid event_id to null before INSERT (a uuid regex + coerceEventId applied at the event_id insert field). ` +
        `hasUuidGuard=${hasUuidGuard} insertUsesCoercion=${insertUsesCoercion} rawPassthrough=${rawPassthrough}. ` +
        `Without this, a future caller passing a Stripe/acct id throws and fails the whole webhook again.`,
    );
  } else {
    ok("A3: audit-coerces-non-uuid", `${AUDIT} coerces non-uuid event_id to null before insert`);
  }
}

// ===== BUG B =====
{
  const raw = read(ONBOARD_BODY);
  const src = stripComments(raw);

  // B1 — no router.replace/push, no nav to the auth-gated payments route.
  const usesRouterNav = /router\.(replace|push)\s*\(/.test(src);
  const navToPayments = /\/brand\/[^)]*\/payments/.test(src);
  if (usesRouterNav) {
    fail(
      "B1: no-spa-replace",
      `${ONBOARD_BODY} calls router.replace/push — the onboarding browser is SESSIONLESS; an SPA replace into an auth-gated route is bounced to sign-in and strands the user. Use a full-page navigation instead.`,
    );
  } else {
    ok("B1: no-spa-replace", "no router.replace/push in the sessionless onboarding body");
  }
  if (navToPayments) {
    fail(
      "B1: no-payments-route-nav",
      `${ONBOARD_BODY} navigates to the auth-gated /brand/<id>/payments route — that route is intercepted by the root layout in a sessionless browser. Do NOT target it from here.`,
    );
  } else {
    ok("B1: no-payments-route-nav", "does not navigate to the auth-gated /brand/<id>/payments route");
  }

  // B2 — handleExit recovers return_to from sessionStorage + full-page nav.
  const recoversFromStorage =
    /readPersistedReturnTo\s*\(/.test(src) ||
    /sessionStorage\.getItem/.test(src);
  const fullPageNav = /window\.location\.(assign\s*\(|href\s*=)/.test(src);
  if (!recoversFromStorage) {
    fail(
      "B2: recover-return-to",
      `${ONBOARD_BODY} must recover return_to from sessionStorage (readPersistedReturnTo / sessionStorage.getItem) so it survives Stripe's intra-flow param drop.`,
    );
  } else {
    ok("B2: recover-return-to", "handleExit recovers return_to from sessionStorage");
  }
  if (!fullPageNav) {
    fail(
      "B2: full-page-nav",
      `${ONBOARD_BODY} must use a full-page navigation (window.location.assign / window.location.href) on exit — never an SPA router replace.`,
    );
  } else {
    ok("B2: full-page-nav", "exit uses a full-page navigation");
  }

  // B3 — return_to persisted on mount.
  const persists = /sessionStorage\.setItem/.test(src);
  if (!persists) {
    fail(
      "B3: persist-return-to",
      `${ONBOARD_BODY} must persist return_to to sessionStorage on mount (sessionStorage.setItem) so it can be recovered after Stripe drops the param.`,
    );
  } else {
    ok("B3: persist-return-to", "return_to persisted to sessionStorage on mount");
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1234 (Stripe Connect onboarding): ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1234 (Stripe Connect onboarding): PASS · violations=0");
process.exit(0);
