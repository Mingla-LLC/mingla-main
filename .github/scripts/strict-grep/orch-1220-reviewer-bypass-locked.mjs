#!/usr/bin/env node
/**
 * ORCH-1220 [business-reviewer-bypass] —
 * I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED.
 *
 * WHY: the reviewer-signin edge function mints a real Supabase session for an
 * App-Store / Play reviewer with NO email send. If it ever degraded into a
 * "log in as anyone" oracle — or if it minted a session for the caller-supplied
 * email instead of the LOCKED reviewer email, or dropped its secret-code gate —
 * it would be a catastrophic account-takeover backdoor. This gate locks the two
 * load-bearing security properties in place:
 *
 *   (a) reviewer-signin/index.ts:
 *       - reads BOTH REVIEWER_EMAIL and REVIEWER_BYPASS_CODE from Deno.env,
 *       - compares the code with a constant-time compare (timingSafeEqual),
 *       - passes the env REVIEWER_EMAIL (never a caller-supplied/body email
 *         variable) into admin.generateLink — i.e. generateLink is anchored to
 *         the locked reviewer email.
 *   (b) AuthContext.tsx:
 *       - defines REVIEWER_EMAIL = 'appreview@usemingla.com',
 *       - invokes the 'reviewer-signin' function,
 *       - and routes to it ONLY behind the reviewer-email gate (isReviewerEmail).
 *
 * PASS on the ORCH-1220 implementation; FAILS-ON-REVERT if any of these
 * properties is removed.
 *
 * `--self-test` injects fixtures proving fire-on-violation + pass-on-correct.
 *
 * Model: orch-1216-no-service-key-client.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = (() => {
  // Allow running from repo root OR from a package subdir.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "supabase", "functions"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
})();

const FN_PATH = path.join(
  root,
  "supabase",
  "functions",
  "reviewer-signin",
  "index.ts",
);
const AUTH_PATH = path.join(
  root,
  "mingla-business",
  "src",
  "context",
  "AuthContext.tsx",
);

// ── (a) edge-function checks. Each entry: [label, predicate(src) => boolean] ──
const FN_CHECKS = [
  [
    "reads REVIEWER_EMAIL from Deno.env",
    (s) => /Deno\.env\.get\(\s*["']REVIEWER_EMAIL["']\s*\)/.test(s),
  ],
  [
    "reads REVIEWER_BYPASS_CODE from Deno.env",
    (s) => /Deno\.env\.get\(\s*["']REVIEWER_BYPASS_CODE["']\s*\)/.test(s),
  ],
  [
    "uses a constant-time compare (timingSafeEqual) for the code",
    (s) => /timingSafeEqual\s*\(/.test(s),
  ],
  [
    "passes the env reviewerEmail (NOT a caller-supplied email) into generateLink",
    (s) => {
      // Find the generateLink call and assert its `email:` field is the
      // server-side reviewerEmail variable, never the request-body `email`.
      const m = s.match(/generateLink\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      if (!m) return false;
      const args = m[1];
      const emailField = args.match(/email\s*:\s*([A-Za-z0-9_]+)/);
      if (!emailField) return false;
      return emailField[1] === "reviewerEmail";
    },
  ],
];

// ── (b) AuthContext checks. ──────────────────────────────────────────────────
const AUTH_CHECKS = [
  [
    "defines REVIEWER_EMAIL = 'appreview@usemingla.com'",
    (s) =>
      /REVIEWER_EMAIL\s*=\s*["']appreview@usemingla\.com["']/.test(s),
  ],
  [
    "invokes the 'reviewer-signin' edge function",
    (s) =>
      /functions\.invoke\(\s*["']reviewer-signin["']/.test(s),
  ],
  [
    "gates the reviewer-signin invoke behind the reviewer-email check (isReviewerEmail)",
    (s) => {
      // The invoke must be preceded (in the same verify function) by an
      // isReviewerEmail(...) guard. Assert the guard exists AND appears before
      // the invoke in source order.
      const guardIdx = s.search(/isReviewerEmail\s*\(/);
      const invokeIdx = s.search(
        /functions\.invoke\(\s*["']reviewer-signin["']/,
      );
      return guardIdx !== -1 && invokeIdx !== -1 && guardIdx < invokeIdx;
    },
  ],
  [
    "does NOT route any non-reviewer literal email to the function",
    (s) => {
      // Defense: the only email literal wired to reviewer routing must be the
      // reviewer address. Flag any OTHER quoted email adjacent to an
      // isReviewerEmail/REVIEWER_EMAIL comparison would be over-reach; instead
      // assert there is no second hardcoded '@usemingla.com'-style reviewer
      // constant masquerading as the gate. Simplest robust check: exactly one
      // REVIEWER_EMAIL string-literal definition exists.
      const defs = s.match(
        /REVIEWER_EMAIL\s*=\s*["'][^"']+["']/g,
      );
      return defs !== null && defs.length === 1;
    },
  ],
];

function evaluate(label, src, checks, failures) {
  for (const [desc, pred] of checks) {
    if (!pred(src)) {
      failures.push(`${label}: missing/violated — ${desc}`);
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];

  // GOOD edge fn — satisfies all FN_CHECKS.
  const goodFn = `
    const reviewerEmail = (Deno.env.get("REVIEWER_EMAIL") ?? "").trim().toLowerCase();
    const bypassCode = Deno.env.get("REVIEWER_BYPASS_CODE") ?? "";
    const codeOk = timingSafeEqual(code, bypassCode);
    await admin.auth.admin.generateLink({ type: "magiclink", email: reviewerEmail });
  `;
  {
    const f = [];
    evaluate("fn", goodFn, FN_CHECKS, f);
    if (f.length !== 0) selfFailures.push("good edge fn wrongly flagged: " + f.join("; "));
  }

  // BAD edge fn #1 — generateLink uses the caller-supplied `email`, not reviewerEmail.
  const badFnEmail = goodFn.replace("email: reviewerEmail", "email: email");
  {
    const f = [];
    evaluate("fn", badFnEmail, FN_CHECKS, f);
    if (f.length === 0) selfFailures.push("caller-email generateLink not flagged");
  }

  // BAD edge fn #2 — drops the constant-time compare (plain ===).
  const badFnCompare = goodFn.replace(
    "const codeOk = timingSafeEqual(code, bypassCode);",
    "const codeOk = code === bypassCode;",
  );
  {
    const f = [];
    evaluate("fn", badFnCompare, FN_CHECKS, f);
    if (f.length === 0) selfFailures.push("missing constant-time compare not flagged");
  }

  // BAD edge fn #3 — drops the REVIEWER_BYPASS_CODE env read.
  const badFnCode = goodFn.replace(
    'const bypassCode = Deno.env.get("REVIEWER_BYPASS_CODE") ?? "";',
    'const bypassCode = "";',
  );
  {
    const f = [];
    evaluate("fn", badFnCode, FN_CHECKS, f);
    if (f.length === 0) selfFailures.push("missing REVIEWER_BYPASS_CODE env read not flagged");
  }

  // GOOD AuthContext — satisfies all AUTH_CHECKS.
  const goodAuth = `
    const REVIEWER_EMAIL = 'appreview@usemingla.com';
    const isReviewerEmail = (e) => e === REVIEWER_EMAIL;
    if (isReviewerEmail(trimmedEmail)) {
      const { data, error } = await supabase.functions.invoke("reviewer-signin", { body: { email, code } });
    }
  `;
  {
    const f = [];
    evaluate("auth", goodAuth, AUTH_CHECKS, f);
    if (f.length !== 0) selfFailures.push("good AuthContext wrongly flagged: " + f.join("; "));
  }

  // BAD AuthContext #1 — wrong reviewer email literal.
  const badAuthEmail = goodAuth.replace(
    "'appreview@usemingla.com'",
    "'anyone@example.com'",
  );
  {
    const f = [];
    evaluate("auth", badAuthEmail, AUTH_CHECKS, f);
    if (f.length === 0) selfFailures.push("wrong reviewer email literal not flagged");
  }

  // BAD AuthContext #2 — invoke not gated behind isReviewerEmail (guard removed).
  const badAuthGate = goodAuth.replace("if (isReviewerEmail(trimmedEmail)) {", "if (true) {");
  {
    const f = [];
    evaluate("auth", badAuthGate, AUTH_CHECKS, f);
    if (f.length === 0) selfFailures.push("ungated reviewer invoke not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1220 I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1220 I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED self-test PASS (7/7 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const [p, label] of [
  [FN_PATH, "supabase/functions/reviewer-signin/index.ts"],
  [AUTH_PATH, "mingla-business/src/context/AuthContext.tsx"],
]) {
  if (!fs.existsSync(p)) {
    failures.push(`${label}: file not found at ${p} (gate path out of sync).`);
  }
}
if (failures.length === 0) {
  evaluate(
    "supabase/functions/reviewer-signin/index.ts",
    fs.readFileSync(FN_PATH, "utf8"),
    FN_CHECKS,
    failures,
  );
  evaluate(
    "mingla-business/src/context/AuthContext.tsx",
    fs.readFileSync(AUTH_PATH, "utf8"),
    AUTH_CHECKS,
    failures,
  );
}

if (failures.length > 0) {
  console.error(
    "ORCH-1220 I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED FAIL — the reviewer-login\n" +
      "bypass lost a load-bearing security property (it must gate on REVIEWER_EMAIL +\n" +
      "REVIEWER_BYPASS_CODE with a constant-time compare, only ever generateLink the\n" +
      "locked reviewer email, and AuthContext must route ONLY appreview@usemingla.com\n" +
      "to the function).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1220 I-PROPOSED-1220-REVIEWER-BYPASS-LOCKED PASS — reviewer bypass is\n" +
    "locked to the configured reviewer email + secret code with a constant-time\n" +
    "compare; generateLink is anchored to the env reviewer email; AuthContext\n" +
    "routes only appreview@usemingla.com to the function.",
);
