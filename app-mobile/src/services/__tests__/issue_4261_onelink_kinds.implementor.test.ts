// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave B1: the friend_share and group_invite OneLink kinds, in the
// ONE resolver (I-ONELINK-SINGLE-RESOLVER; spec 5.2, 8.3 #3). The links the app
// builds (utils/friendShareLink.ts) must resolve back to the same tokens.
//
// FAILS-ON-REVERT: delete either new `case` and its payload falls to the
// unknown-discriminator `null`, so K-1 / K-3 fail.
import { resolveOneLinkDestination } from "../oneLinkResolver.ts";
import { buildFriendShareOneLink, buildGroupInviteOneLink } from "../../utils/friendShareLink.ts";

function assertEquals(actual: unknown, expected: unknown, label = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  actual:   ${a}\n  expected: ${e}`);
}

const TOKEN = "0123456789abcdef0123456789abcdef";
const GROUP = "fedcba9876543210fedcba9876543210";

function payloadOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

Deno.test("K-1 a personal invite link resolves to its token and referral code", () => {
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_share", deep_link_sub1: TOKEN, af_sub1: "SETH-4KQ2" }),
    { kind: "friend_share", token: TOKEN, referralCode: "SETH-4KQ2" },
  );
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_share", deep_link_sub1: TOKEN.toUpperCase() }),
    { kind: "friend_share", token: TOKEN },
    "upper-case hex is normalised",
  );
});

Deno.test("K-2 a malformed share token is never half-formed", () => {
  for (const sub1 of [undefined, "", "abc", `${TOKEN}00`, "../../etc", "zz23456789abcdef0123456789abcdef"]) {
    assertEquals(resolveOneLinkDestination({ deep_link_value: "friend_share", deep_link_sub1: sub1 }), null, `sub1=${sub1}`);
  }
});

Deno.test("K-3 a group link resolves with and without the sharer's token", () => {
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "group_invite", deep_link_sub1: GROUP, deep_link_sub2: TOKEN, af_sub1: "SETH" }),
    { kind: "group_invite", groupToken: GROUP, shareToken: TOKEN, referralCode: "SETH" },
  );
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "group_invite", deep_link_sub1: GROUP }),
    { kind: "group_invite", groupToken: GROUP },
  );
});

Deno.test("K-4 a group link with a bad group token or a bad share token is null", () => {
  assertEquals(resolveOneLinkDestination({ deep_link_value: "group_invite" }), null, "no token");
  assertEquals(resolveOneLinkDestination({ deep_link_value: "group_invite", deep_link_sub1: "abc" }), null, "bad group");
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "group_invite", deep_link_sub1: GROUP, deep_link_sub2: "nope" }),
    null,
    "present but bad share token",
  );
});

Deno.test("K-5 the links the app shares resolve back to the same tokens", () => {
  const share = buildFriendShareOneLink({ token: TOKEN, referralCode: "SETH-4KQ2" });
  assertEquals(resolveOneLinkDestination(payloadOf(share)), { kind: "friend_share", token: TOKEN, referralCode: "SETH-4KQ2" });
  const group = buildGroupInviteOneLink({ groupToken: GROUP, shareToken: TOKEN, referralCode: null });
  assertEquals(resolveOneLinkDestination(payloadOf(group)), { kind: "group_invite", groupToken: GROUP, shareToken: TOKEN });
});

Deno.test("K-6 existing kinds are unchanged", () => {
  const invite = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  assertEquals(
    resolveOneLinkDestination({ deep_link_value: "friend_invite", deep_link_sub1: invite, af_sub1: "ADA-42" }),
    { kind: "friend_invite", token: invite, referralCode: "ADA-42" },
  );
  assertEquals(resolveOneLinkDestination({ deep_link_value: "referral", deep_link_sub1: "ADA-42" }), { kind: "referral", referralCode: "ADA-42" });
  assertEquals(resolveOneLinkDestination({ deep_link_value: "follow_invite", deep_link_sub1: "t" }), { kind: "follow_invite", token: "t" });
  assertEquals(resolveOneLinkDestination({ deep_link_value: "mystery", deep_link_sub1: TOKEN }), null, "unknown stays null");
});
