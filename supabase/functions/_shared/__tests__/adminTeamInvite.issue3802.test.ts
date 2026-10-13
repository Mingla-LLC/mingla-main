/**
 * Issue #3802 — team invitations: the pure helpers and the wiring of the two
 * invite edge functions.
 *
 *   E-1  generated secrets are 43 base64url characters and never repeat
 *   E-2  hashing is SHA-256, lower-case hex
 *   E-3  the secret sits after the `#` of the link
 *   E-4  only listed admin origins are used for the link
 *   E-5  which existing accounts may receive team access
 *   E-6  source contracts: nothing about a link is logged or returned to the
 *        inviter, and the accept function prepares the sign-in before it uses
 *        the link up and hands it back only afterwards
 */
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  accountVerdict,
  ADMIN_APP_ORIGINS,
  buildInviteLink,
  generateInviteToken,
  INVITE_ROLE_LABELS,
  isInviteToken,
  resolveAdminOrigin,
  sha256Hex,
} from "../adminTeamInvite.ts";

const read = (rel: string) =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));
const INVITE_SRC = read("../../admin-team-invite/index.ts");
const ACCEPT_SRC = read("../../admin-team-accept-invite/index.ts");
/** Code only: whole-line comments removed. */
const code = (src: string) =>
  src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

Deno.test("#3802 E-1: 1000 generated secrets are 43 base64url chars, all distinct", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const t = generateInviteToken();
    assertEquals(t.length, 43);
    assertMatch(t, /^[A-Za-z0-9_-]{43}$/);
    assert(isInviteToken(t));
    seen.add(t);
  }
  assertEquals(seen.size, 1000);
});

Deno.test("#3802 E-1: isInviteToken refuses everything that is not exactly a secret", () => {
  const good = generateInviteToken();
  for (
    const bad of [
      good.slice(1),
      good + "A",
      good.slice(0, 42) + "=",
      good.slice(0, 42) + "+",
      good.slice(0, 42) + "/",
      good + "?x=1",
      " " + good.slice(1),
      "",
      null,
      undefined,
      42,
      {},
      [good],
    ]
  ) {
    assertEquals(isInviteToken(bad), false);
  }
});

Deno.test("#3802 E-2: sha256Hex known vectors, lower-case hex, 64 chars", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const h = await sha256Hex(generateInviteToken());
  assertMatch(h, /^[0-9a-f]{64}$/);
  assertNotEquals(h, await sha256Hex(generateInviteToken()));
});

Deno.test("#3802 E-3: the secret appears only after the # of the link", () => {
  const t = generateInviteToken();
  const link = buildInviteLink("https://admin.usemingla.com", t);
  assertEquals(link, `https://admin.usemingla.com/#/accept-invite/${t}`);
  const u = new URL(link);
  assertEquals(u.pathname, "/");
  assertEquals(u.search, "");
  assertEquals(u.hash, `#/accept-invite/${t}`);
  assertEquals(link.slice(0, link.indexOf("#")).includes(t), false);
});

Deno.test("#3802 E-4: only a listed admin origin is used", () => {
  assertEquals(ADMIN_APP_ORIGINS[0], "https://admin.usemingla.com");
  assertEquals(
    resolveAdminOrigin("https://evil.example"),
    "https://admin.usemingla.com",
  );
  assertEquals(resolveAdminOrigin(null), "https://admin.usemingla.com");
  assertEquals(
    resolveAdminOrigin("https://admin.usemingla.com.evil.example"),
    "https://admin.usemingla.com",
  );
  assertEquals(
    resolveAdminOrigin("https://admin.usemingla.com/"),
    "https://admin.usemingla.com",
  );
  assertEquals(
    resolveAdminOrigin("http://localhost:5173"),
    "http://localhost:5173",
  );
  assertEquals(
    resolveAdminOrigin("http://127.0.0.1:5173"),
    "http://127.0.0.1:5173",
  );
  assertEquals(
    resolveAdminOrigin("http://localhost:5174"),
    "https://admin.usemingla.com",
  );
});

Deno.test("#3802 E-5: which existing accounts may receive team access", () => {
  const email = "person@example.com";
  const emailIdentity = { provider: "email", identity_data: { email } };
  // email-only (an account's phone is an empty string when it has none)
  assertEquals(
    accountVerdict({ phone: "", identities: [emailIdentity] }, email),
    "ok",
  );
  assertEquals(accountVerdict({ identities: [emailIdentity] }, email), "ok");
  assertEquals(accountVerdict({ phone: null, identities: [] }, email), "ok");
  // a social identity under the same address, in any spelling
  assertEquals(
    accountVerdict({
      identities: [emailIdentity, {
        provider: "google",
        identity_data: { email: " Person@Example.com " },
      }],
    }, email),
    "conflict",
  );
  // a phone number on the account
  assertEquals(
    accountVerdict(
      { phone: "15555550100", identities: [emailIdentity] },
      email,
    ),
    "conflict",
  );
  // a phone identity
  assertEquals(
    accountVerdict({
      identities: [emailIdentity, { provider: "phone", identity_data: {} }],
    }, email),
    "conflict",
  );
  // a social identity under another address, or under none
  assertEquals(
    accountVerdict({
      identities: [emailIdentity, {
        provider: "google",
        identity_data: { email: "other@example.com" },
      }],
    }, email),
    "conflict",
  );
  assertEquals(
    accountVerdict({
      identities: [{ provider: "apple", identity_data: {} }],
    }, email),
    "conflict",
  );
  assertEquals(
    accountVerdict({
      identities: [{ provider: "apple", identity_data: null }],
    }, email),
    "conflict",
  );
  // no account to judge
  assertEquals(accountVerdict(null, email), "conflict");
  assertEquals(accountVerdict(undefined, email), "conflict");
});

Deno.test("#3802: role labels are the display names people see", () => {
  assertEquals(INVITE_ROLE_LABELS, {
    admin: "Admin",
    growth: "Sales and marketing",
    partner: "Founding partner",
  });
});

/** The argument text of every console.* call in a source file. */
function consoleArgs(src: string): string[] {
  const out: string[] = [];
  const re = /console\.\w+\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** The object literal handed to the last jsonResponse( in a source file. */
function lastResponseLiteral(src: string, opener: string): string {
  const at = src.lastIndexOf(opener);
  assert(at >= 0, `missing ${opener}`);
  const from = src.indexOf("{", at);
  let depth = 0;
  let i = from;
  do {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  } while (depth > 0);
  return src.slice(from, i);
}

Deno.test("#3802 E-6: neither function logs anything about a link, a sign-in or the request", () => {
  const forbidden =
    /token|hash|link|secret|stored|presented|exchange|parsed|body|\breq\b|signIn|seen|opened|issued|email|password|authHeader/i;
  for (const [name, src] of [["invite", INVITE_SRC], ["accept", ACCEPT_SRC]]) {
    const calls = consoleArgs(src);
    assert(calls.length >= 4, `${name}: expected console calls to inspect`);
    for (const args of calls) {
      // The fixed text label is allowed to name the function; nothing else.
      const withoutLabel = args.replace(/"\[admin-team-[a-z-]+\][^"]*"/, "");
      assertEquals(
        forbidden.test(withoutLabel),
        false,
        `${name}: console call logs something it must not: ${args}`,
      );
      const label = args.match(/"\[admin-team-[a-z-]+\]([^"]*)"/)?.[1] ?? "";
      assertEquals(
        /token|hash|link|secret/i.test(label),
        false,
        `${name}: log label names what it must not: ${label}`,
      );
    }
    assertEquals(/console\.(log|info|debug)\(/.test(src), false);
  }
});

Deno.test("#3802 E-6: the invite function acts as the caller and returns nothing secret", () => {
  assertEquals(INVITE_SRC.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert(INVITE_SRC.includes('Deno.env.get("SUPABASE_ANON_KEY")'));
  assert(
    INVITE_SRC.includes("global: { headers: { Authorization: authHeader } }"),
  );
  assert(INVITE_SRC.includes('"admin_team_issue_invite"'));
  assert(INVITE_SRC.includes("EMAIL_SENDERS.admin"));
  assert(INVITE_SRC.includes("assertNotResendSandbox"));
  assert(INVITE_SRC.includes('Deno.env.get("RESEND_API_KEY")'));
  assert(
    INVITE_SRC.includes(
      'resolveAdminOrigin(req.headers.get("origin"))',
    ),
  );

  const success = lastResponseLiteral(
    INVITE_SRC,
    "return jsonResponse({\n      ok: true",
  );
  const keys = [...success.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assertEquals(keys, [
    "ok",
    "email",
    "role",
    "status",
    "changed",
    "expires_at",
    "email_sent",
  ]);
  assertEquals(/token|hash|link|secret|stored|url/i.test(success), false);

  // The secret and its stored form are used in exactly the places they must be.
  assertEquals(code(INVITE_SRC).match(/\bsecret\b/g)?.length, 3); // made, hashed, put in the email link
  assertEquals(code(INVITE_SRC).match(/\bstored\b/g)?.length, 2); // made, sent to the database
  // Every other response is a fixed shape with a short code.
  for (
    const m of INVITE_SRC.matchAll(/jsonResponse\(\{ ok: false, ([^}]*)\}/g)
  ) {
    assertMatch(m[1].trim(), /^code(: "[a-z_]+")?,?$/);
  }
});

Deno.test("#3802 E-6: the accept function prepares the sign-in first and returns it last", () => {
  assert(ACCEPT_SRC.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'));
  const peekAt = ACCEPT_SRC.indexOf('"admin_team_invite_peek"');
  const createAt = ACCEPT_SRC.indexOf("auth.admin.createUser(");
  const verdictAt = ACCEPT_SRC.indexOf("accountVerdict(existing");
  const linkAt = ACCEPT_SRC.indexOf("auth.admin.generateLink(");
  const redeemAt = ACCEPT_SRC.indexOf('"admin_team_redeem_invite"');
  const redeemedAt = ACCEPT_SRC.indexOf('opened.state !== "redeemed"');
  const handBackAt = ACCEPT_SRC.indexOf("token_hash: exchange");
  for (
    const n of [
      peekAt,
      createAt,
      verdictAt,
      linkAt,
      redeemAt,
      redeemedAt,
      handBackAt,
    ]
  ) {
    assert(n > 0);
  }
  assert(peekAt < createAt, "look the invitation up before touching accounts");
  assert(createAt < verdictAt);
  assert(verdictAt < linkAt, "judge the account before preparing a sign-in");
  assert(linkAt < redeemAt, "prepare the sign-in before the link is used up");
  assert(redeemAt < redeemedAt);
  assert(redeemedAt < handBackAt, "hand the sign-in back only after it");
  // Handed back in exactly one place.
  assertEquals(ACCEPT_SRC.match(/^\s*token_hash:/gm)?.length, 1);
  assertEquals(code(ACCEPT_SRC).match(/\bexchange\b/g)?.length, 3); // read, checked, returned
  // The one-time code the provider also returns is never read.
  assertEquals(ACCEPT_SRC.includes("email_otp"), false);
  assertEquals(ACCEPT_SRC.includes("action_link"), false);
  // An account conflict answers before the link is used up.
  assert(
    ACCEPT_SRC.indexOf('state: "account_conflict"') < redeemAt,
  );
  // The magic-link type and a confirmed address, as proven against the auth service.
  assert(ACCEPT_SRC.includes('type: "magiclink"'));
  assert(ACCEPT_SRC.includes("email_confirm: true"));
  // A malformed secret never reaches the database.
  assert(ACCEPT_SRC.indexOf("isInviteToken(presented)") < peekAt);

  const success = lastResponseLiteral(
    ACCEPT_SRC,
    'return jsonResponse({\n      state: "ok"',
  );
  const keys = [...success.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assertEquals(keys, ["state", "email", "role", "token_hash", "type"]);
  // Every state the function can answer with is one the admin app has a screen for.
  const states = new Set(
    [...ACCEPT_SRC.matchAll(/state: "([a-z_]+)"/g)].map((m) => m[1]),
  );
  assertEquals(
    [...states].sort(),
    ["account_conflict", "invalid", "ok", "try_again"],
  );
  assert(ACCEPT_SRC.includes('state === "used" || state === "expired"'));
});

// ---------------------------------------------------------------------------
// Wave 1 follow-ups (appended): the conflict answer names the invited address,
// and a refusal from the database still reaches the owner as a refusal.
// ---------------------------------------------------------------------------

/** Every `jsonResponse({...})` literal in a source, as written. */
function responseLiterals(src: string): string[] {
  return [...src.matchAll(/jsonResponse\(\{([\s\S]*?)\}(?:,\s*\d+)?\)/g)].map((
    m,
  ) => m[1].replace(/\s+/g, " ").trim());
}

Deno.test("#3802 E-7: both account-conflict answers name the invited address, and nothing else does", () => {
  const answers = responseLiterals(ACCEPT_SRC);
  const conflicts = answers.filter((a) => a.includes('"account_conflict"'));
  assertEquals(conflicts.length, 2);
  for (const c of conflicts) {
    assertEquals(c, 'state: "account_conflict", email: seen.email');
  }
  // The address leaves in exactly three answers: the two conflicts and "ok".
  const withEmail = answers.filter((a) => /\bemail\b/.test(a));
  assertEquals(withEmail.length, 3);
  assert(
    withEmail.some((a) =>
      a.startsWith('state: "ok"') && a.includes("email: opened.email")
    ),
  );
  // No closed link (used, expired, invalid) and no try-again answer says
  // whose invitation it was.
  for (const a of answers) {
    if (
      a.includes("closedState(") || a.includes('"invalid"') ||
      a.includes('"try_again"')
    ) {
      assertEquals(/\bemail\b/.test(a), false, a);
    }
  }
  // Still answered before the link is used up, and after the link was found
  // to be pending.
  const pendingAt = ACCEPT_SRC.indexOf('seen.state !== "pending"');
  const firstConflictAt = ACCEPT_SRC.indexOf('state: "account_conflict"');
  const redeemAt = ACCEPT_SRC.indexOf('"admin_team_redeem_invite"');
  assert(pendingAt > 0 && pendingAt < firstConflictAt);
  assert(ACCEPT_SRC.lastIndexOf('state: "account_conflict"') < redeemAt);
  // The set of states is unchanged.
  const states = new Set(
    [...ACCEPT_SRC.matchAll(/state: "([a-z_]+)"/g)].map((m) => m[1]),
  );
  assertEquals(
    [...states].sort(),
    ["account_conflict", "invalid", "ok", "try_again"],
  );
});

Deno.test("#3802 E-7: the invite function still acts as the caller and passes a refusal on as a refusal", () => {
  const src = code(INVITE_SRC);
  assertEquals(src.includes("SERVICE_ROLE"), false);
  assertEquals(src.includes("auth.admin"), false);
  // One database call, as the caller; a refusal answers before any email.
  assertEquals(src.match(/\.rpc\(/g)?.length, 1);
  const refusedAt = src.indexOf("return jsonResponse({ ok: false, code });");
  const emailAt = src.indexOf("await sendInviteEmail(");
  assert(refusedAt > 0 && emailAt > 0 && refusedAt < emailAt);
  // The code is the database's own first word, whatever it is: no list of
  // known codes to fall out of date.
  assert(src.includes("const code = errorCode(issueError?.message);"));
  assertEquals(src.includes("address_in_use"), false);
});

// ---------------------------------------------------------------------------
// The strict rule (appended): any way of signing in other than email.
// ---------------------------------------------------------------------------

Deno.test("#3802 E-8: an account that can sign in any way other than email cannot be given team access", () => {
  const email = "person@example.com";
  const emailIdentity = { provider: "email", identity_data: { email } };
  // The same cases as H-10 in the SQL suite.
  const cases: Array<[string, Parameters<typeof accountVerdict>[0], string]> = [
    ["email only", { identities: [emailIdentity] }, "ok"],
    ["no identity recorded", { phone: null, identities: [] }, "ok"],
    ["a blank phone", { phone: "   ", identities: [emailIdentity] }, "ok"],
    [
      "a phone number",
      { phone: "15555550100", identities: [emailIdentity] },
      "conflict",
    ],
    [
      "a phone sign-in",
      { identities: [emailIdentity, { provider: "phone" }] },
      "conflict",
    ],
    ["Google under this same email", {
      identities: [emailIdentity, {
        provider: "google",
        identity_data: { email },
      }],
    }, "conflict"],
    ["Google only, under this same email", {
      identities: [{ provider: "google", identity_data: { email } }],
    }, "conflict"],
    ["Apple under this same email", {
      identities: [emailIdentity, {
        provider: "apple",
        identity_data: { email },
      }],
    }, "conflict"],
    ["Google under another email", {
      identities: [emailIdentity, {
        provider: "google",
        identity_data: { email: "x@y.z" },
      }],
    }, "conflict"],
    ["Apple with no email", {
      identities: [{ provider: "apple", identity_data: null }],
    }, "conflict"],
    ["a sign-in method nobody listed", {
      identities: [emailIdentity, { provider: "sso:example" }],
    }, "conflict"],
    [
      "an identity with no provider",
      { identities: [emailIdentity, {}] },
      "conflict",
    ],
  ];
  for (const [label, account, want] of cases) {
    assertEquals(accountVerdict(account, email), want, label);
  }
});

Deno.test("#3802 E-8: the accept function asks the database's one rule, and fails closed", () => {
  const src = code(ACCEPT_SRC);
  const askAt = src.indexOf('"admin_team_invite_address_verdict"');
  const linkAt = src.indexOf("auth.admin.generateLink(");
  const redeemAt = src.indexOf('"admin_team_redeem_invite"');
  assert(askAt > 0 && askAt < linkAt && askAt < redeemAt);
  assert(src.includes("{ p_email: seen.email }"));
  // Anything but a clear "ok" or "conflict" stops before a sign-in is prepared.
  assert(
    src.includes(
      'if (verdictError || (verdict !== "ok" && verdict !== "conflict")) {',
    ),
  );
  // Either check saying "conflict" is a conflict.
  assertMatch(
    src,
    /verdict === "conflict" \|\|\s*accountVerdict\(existing\.data\.user, seen\.email\) === "conflict"/,
  );
  // The invite function still decides nothing itself.
  assertEquals(
    code(INVITE_SRC).includes("admin_team_invite_address_verdict"),
    false,
  );
});
