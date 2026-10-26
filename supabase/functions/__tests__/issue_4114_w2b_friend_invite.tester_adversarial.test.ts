// Issue #4114 Wave 2b — tester adversarial suite for the friend invite link,
// the invite token claim, and the add-friend path at the pairing limit.
//
// The implementor suite drives the happy handler paths. This suite attacks:
//   * hostile tokens and referral codes (query injection, wrong length, upper
//     case, path tricks) never produce a half-formed or extra deep-link
//     parameter, and every link is the go.usemingla.com/w36m OneLink;
//   * no invite text in send-pair-request or send-phone-invite can carry the
//     dead `mingla.app` domain, the Business template, or a raw onelink.me;
//   * claim_friend_invite (static SQL review): a token converted to account A
//     is refused for account B BEFORE any write; the invite row is locked;
//     the inviter cannot claim their own; anon can never call it;
//   * a non-Mingla number at the free pairing limit still gets the invite text
//     (D16): no limit refusal sits on the Tier-3 path before the invite upsert,
//     and the response flags the limit.
//
// FAILS-ON-REVERT: drop the `already_claimed` branch (or move it below the
// INSERTs), loosen TOKEN_RE, or put `return pairingLimitResponse()` back ahead
// of the Tier-3 upsert, and this suite fails.

import {
  buildFriendInviteOneLink,
  buildFriendInviteSms,
  buildSessionInviteOneLink,
  EXPLORER_ONELINK_BASE,
} from "../_shared/friendInviteLink.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const read = (relative: string) => Deno.readTextFile(new URL(relative, import.meta.url));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripSqlComments = (source: string) => source.replace(/--.*$/gm, "");

const GOOD_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function params(link: string): URLSearchParams {
  const url = new URL(link);
  assertEquals(`${url.origin}${url.pathname}`, EXPLORER_ONELINK_BASE, "every link is the Explorer OneLink");
  assertEquals(url.hostname, "go.usemingla.com", "branded consumer domain");
  return url.searchParams;
}

Deno.test("#4114 W2b adversarial: hostile tokens never make a friend_invite payload", () => {
  const hostile = [
    "",
    "   ",
    GOOD_TOKEN.toUpperCase(),
    GOOD_TOKEN.slice(0, 31),
    GOOD_TOKEN + "0",
    `${GOOD_TOKEN.slice(0, 32)}&deep_link_value=referral`,
    "../../etc/passwd",
    "g".repeat(32),
    null,
    undefined,
  ];
  for (const token of hostile) {
    const p = params(buildFriendInviteOneLink({ token }));
    assert(!p.has("deep_link_value") && !p.has("deep_link_sub1"), `token ${JSON.stringify(token)} must not deep link`);
    assertEquals(p.getAll("pid"), ["friend_invite"], "exactly one pid");
  }
  const ok = params(buildFriendInviteOneLink({ token: ` ${GOOD_TOKEN.slice(0, 32)} ` }));
  assertEquals(ok.get("deep_link_sub1"), GOOD_TOKEN.slice(0, 32), "a padded valid token is trimmed, not refused");
});

Deno.test("#4114 W2b adversarial: a hostile referral code is dropped, never injected", () => {
  for (const code of ["a&deep_link_value=x", "-leading", "a b", "x".repeat(65), "é", "a#b"]) {
    const friend = params(buildFriendInviteOneLink({ token: GOOD_TOKEN, referralCode: code }));
    assert(!friend.has("af_sub1"), `friend link drops ${JSON.stringify(code)}`);
    assertEquals(friend.getAll("deep_link_value"), ["friend_invite"], "the payload is not overwritten");
    const session = params(buildSessionInviteOneLink({ referralCode: code }));
    assert(!session.has("deep_link_value") && !session.has("af_sub1"), `session link drops ${JSON.stringify(code)}`);
  }
});

Deno.test("#4114 W2b adversarial: the SMS body carries the link exactly once and survives a blank or tricky name", () => {
  const link = buildFriendInviteOneLink({ token: GOOD_TOKEN, referralCode: "SETH1" });
  const blank = buildFriendInviteSms("   ", link);
  assert(blank.startsWith("A friend "), "a blank name never renders as an empty sender");
  const tricky = buildFriendInviteSms("{link} $& Tomi", link);
  assertEquals(tricky.split(link).length - 1, 1, "a name containing {link} or $& never duplicates or mangles the link");
  assert(!/mingla\.app/i.test(tricky), "never the dead domain");
});

// Tester finding T-W2b-1 (fixed in the #4114 rework): `$&`, `$'` or a literal
// `{link}` in a display name must never rewrite the SMS template.
Deno.test({
  name: "#4114 W2b adversarial [T-W2b-1]: a display name can never rewrite the SMS template",
  fn: () => {
    const link = buildFriendInviteOneLink({ token: GOOD_TOKEN });
    for (const name of ["{link} Tomi", "$& Tomi", "$' Tomi", "$` Tomi"]) {
      const body = buildFriendInviteSms(name, link);
      assert(body.startsWith(`${name} added you as a friend on Mingla.`), `name ${JSON.stringify(name)} is inserted literally`);
      // The name itself may legitimately contain "{link}" (it is inserted
      // literally, asserted above), so the placeholder check reads the text
      // after the name: the template's own placeholders are all filled.
      assert(body.endsWith(link) && !body.slice(name.length).includes("{link}") && !body.includes("{name}"),
        `name ${JSON.stringify(name)}: the link ends the text`);
      assertEquals(body.split(link).length - 1, 1, `name ${JSON.stringify(name)}: the link appears exactly once`);
    }
  },
});

Deno.test("#4114 W2b adversarial: no invite text in the two senders can point at a dead or wrong domain", async () => {
  for (const file of ["../send-pair-request/index.ts", "../send-phone-invite/index.ts", "../_shared/friendInviteLink.ts"]) {
    const code = stripComments(await read(file));
    assert(!/mingla\.app/i.test(code), `${file}: no mingla.app in code`);
    assert(!/biz\.usemingla\.com/i.test(code), `${file}: never the Business OneLink`);
    assert(!/onelink\.me/i.test(code), `${file}: never a raw onelink.me domain`);
  }
});

Deno.test("#4114 W2b adversarial: a non-Mingla number at the free limit still gets the invite (D16)", async () => {
  const code = stripComments(await read("../send-pair-request/index.ts"));
  const tier3 = code.slice(code.indexOf("TIER 3") >= 0 ? code.indexOf("TIER 3") : code.indexOf('.from("pending_pair_invites")'));
  const upsertAt = tier3.indexOf(".upsert(");
  assert(upsertAt > 0, "the Tier-3 invite upsert exists");
  assert(!/pairingLimitResponse\(\)/.test(tier3.slice(0, upsertAt)), "no limit refusal before the invite upsert");
  assert(/pairingLimitReached:\s*!canPair/.test(tier3), "the Tier-3 response flags the limit");
  assert(/smsStatus/.test(tier3), "the Tier-3 response reports the SMS outcome");
  assert(/smsStatus:\s*"sent"\s*\|\s*"failed"\s*=\s*"failed"/.test(tier3), "smsStatus defaults to failed (only a real send says sent)");
});

Deno.test("#4114 W2b adversarial: claim_friend_invite refuses token reuse by a second account before any write", async () => {
  const sql = stripSqlComments(await read("../../migrations/20271230024114_issue_4114_friend_invite_token.sql"));
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.claim_friend_invite"), sql.indexOf("REVOKE ALL ON FUNCTION public.claim_friend_invite"));
  assert(/SECURITY DEFINER/.test(body), "definer");
  assert(/SET search_path/.test(body), "pinned search_path");
  assert(/FOR UPDATE/.test(body), "the invite row is locked so two accounts cannot claim at once");
  const firstWrite = Math.min(
    ...["INSERT INTO", "UPDATE public."].map((w) => body.indexOf(w)).filter((i) => i >= 0),
  );
  for (const guard of ["'own_invite'", "'invite_cancelled'", "'already_claimed'", "'unavailable'"]) {
    const at = body.indexOf(guard);
    assert(at > 0 && at < firstWrite, `${guard} is decided before the first write`);
  }
  assert(/status = 'converted'\s+AND v_invite\.converted_user_id IS DISTINCT FROM v_uid/.test(body), "reuse is keyed on the converting account");
  assert(/p_token !~ '\^\[0-9a-f\]\{32,64\}\$'/.test(body), "malformed tokens are refused before the lookup");
  assert(!/GRANT[^;]*claim_friend_invite[^;]*TO[^;]*\banon\b/.test(sql), "anon is never granted");
  assert(/REVOKE ALL ON FUNCTION public\.claim_friend_invite\(text\) FROM anon/.test(sql), "anon is explicitly revoked");
  assert(/REVOKE ALL ON FUNCTION public\.claim_friend_invite\(text\) FROM PUBLIC/.test(sql), "PUBLIC is revoked");
});
