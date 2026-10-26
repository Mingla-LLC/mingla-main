// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2b — the friend_invite OneLink kind, in the ONE resolver
// (I-ONELINK-SINGLE-RESOLVER). The invite SMS links to
// go.usemingla.com/w36m?deep_link_value=friend_invite&deep_link_sub1=<token>
// &af_sub1=<inviter referral code>.
//
// FAILS-ON-REVERT: delete the `case 'friend_invite'` branch and the payload
// falls to the unknown-discriminator `null`, so R-1 fails.

import { resolveOneLinkDestination } from "../oneLinkResolver.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

Deno.test("R-1 a friend invite resolves to its token and the inviter's referral code", () => {
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: TOKEN, af_sub1: "ADA-42" }),
    { kind: "friend_invite", token: TOKEN, referralCode: "ADA-42" },
  );
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: TOKEN }),
    { kind: "friend_invite", token: TOKEN },
  );
});

Deno.test("R-2 a malformed or missing token never becomes a half-formed invite", () => {
  assertEquals(resolveOneLinkDestination({ deep_link_value: "friend_invite" }), null);
  assertEquals(resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: "../../etc" }), null);
  assertEquals(resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: "abc" }), null);
});

Deno.test("R-3 a bad referral code is dropped, the invite still resolves", () => {
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: TOKEN.toUpperCase(), af_sub1: "bad code!" }),
    { kind: "friend_invite", token: TOKEN },
  );
});
