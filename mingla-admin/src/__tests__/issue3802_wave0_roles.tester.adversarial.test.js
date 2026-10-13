// Issue #3802 (Wave 0) — INDEPENDENT TESTER suite for the admin app.
//
// Written by the tester, not the implementor. The implementor suite proves the
// happy mappings and the source wiring. This suite attacks the pure modules
// with hostile and boundary inputs, because those modules are the only thing
// standing between a crafted address and a page a role may not open:
//
//   AC-1  parseInviteHash rejects everything that is not exactly a 43-char
//         base64url secret in the exact route (length, charset, trailing data,
//         extra segments, case, query, non-string).
//   AC-2  the route gate never opens a page for a role that lacks its area,
//         for a person who is only invited, or when the server's answer is
//         malformed; prototype keys fall to the admin-only default.
//   AC-3  normalizeAccess refuses a forged shape and strips non-string areas.
//   AC-4  every invite-screen state offers exactly one known next step, an
//         unknown state degrades to "invalid", and the email placeholder is
//         always filled.
//   AC-5  inviteRowState is only meaningful for an invited row and tolerates
//         missing / malformed state data.
//   AC-6  the menu a role sees contains only openable pages and never leaks an
//         admin-only or Team page to a non-owner.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AREA,
  areaForPage,
  canOpenPage,
  homePageFor,
  normalizeAccess,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import {
  ACCEPT_ACTION_KINDS,
  ACCEPT_COPY,
  acceptBody,
  acceptCopy,
  INVITE_STATE_COPY,
  inviteRowState,
  parseInviteHash,
} from "../lib/inviteLink.js";
import { NAV_GROUPS } from "../lib/constants.js";

const VALID = "A".repeat(43);
const owner = { email: "o@x", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm"] };
const admin = { email: "a@x", role: "admin", status: "active", areas: ["admin_console", "crm"] };
const growth = { email: "g@x", role: "growth", status: "active", areas: ["role_home"] };
const partner = { email: "p@x", role: "partner", status: "active", areas: ["role_home"] };

describe("#3802 AC-1: parseInviteHash rejects everything but an exact secret", () => {
  it("accepts a well-formed link", () => {
    assert.equal(parseInviteHash(`#/accept-invite/${VALID}`), VALID);
    assert.equal(parseInviteHash(`#/accept-invite/${"-_az09AZ".padEnd(43, "x")}`), "-_az09AZ".padEnd(43, "x"));
  });
  it("rejects wrong lengths", () => {
    assert.equal(parseInviteHash(`#/accept-invite/${"A".repeat(42)}`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${"A".repeat(44)}`), null);
  });
  it("rejects disallowed characters in an otherwise 43-char token", () => {
    assert.equal(parseInviteHash(`#/accept-invite/${"A".repeat(42)}+`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${"A".repeat(42)}/`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${"A".repeat(42)}.`), null);
  });
  it("rejects trailing data, extra segments and a query", () => {
    assert.equal(parseInviteHash(`#/accept-invite/${VALID}/more`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${VALID}?x=1`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${VALID}#frag`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${VALID} `), null);
  });
  it("rejects the wrong route, the wrong case and non-strings", () => {
    assert.equal(parseInviteHash(`#/accept-invites/${VALID}`), null);
    assert.equal(parseInviteHash(`#/ACCEPT-INVITE/${VALID}`), null);
    assert.equal(parseInviteHash(`#/overview`), null);
    assert.equal(parseInviteHash(""), null);
    assert.equal(parseInviteHash(null), null);
    assert.equal(parseInviteHash(undefined), null);
    assert.equal(parseInviteHash(123), null);
    assert.equal(parseInviteHash({}), null);
  });
});

describe("#3802 AC-2: the route gate never over-grants", () => {
  it("a growth/partner person can open neither the console nor Team", () => {
    for (const a of [growth, partner]) {
      assert.equal(canOpenPage(a, "admin"), false, "Team and roles");
      assert.equal(canOpenPage(a, "overview"), false, "dashboard");
      assert.equal(canOpenPage(a, "business-money-ledger"), false);
      assert.equal(canOpenPage(a, "home"), true, "their own home");
    }
  });
  it("a page nobody classified needs the admin console (never role_home)", () => {
    assert.equal(areaForPage("some-future-page"), AREA.ADMIN_CONSOLE);
    assert.equal(canOpenPage(growth, "some-future-page"), false);
    assert.equal(canOpenPage(admin, "some-future-page"), true);
  });
  it("inherited object keys fall to the admin-only default, not role_home", () => {
    for (const key of ["__proto__", "constructor", "hasOwnProperty", "toString"]) {
      assert.equal(areaForPage(key), AREA.ADMIN_CONSOLE, key);
      assert.equal(canOpenPage(growth, key), false, key);
    }
  });
  it("an invited (not active) person can open nothing, including their home", () => {
    const invited = { email: "i@x", role: "growth", status: "invited", areas: ["role_home"] };
    assert.equal(canOpenPage(invited, "home"), false);
    assert.equal(canOpenPage(invited, "admin"), false);
    assert.equal(homePageFor(invited), null);
  });
  it("a malformed access object opens nothing and resolves nowhere", () => {
    for (const bad of [null, undefined, {}, { status: "active" }, { areas: "role_home" }, { areas: null, status: "active" }]) {
      assert.equal(canOpenPage(bad, "home"), false);
      assert.equal(canOpenPage(bad, "admin"), false);
      assert.deepEqual(resolveRoute("admin", bad, ["admin", "home"]), { pageId: null, denied: false, requestedId: "admin" });
    }
  });
  it("a refused known page lands on home with denied:true; an unknown one lands quietly", () => {
    const ids = ["admin", "overview", "home", "business-orders"];
    assert.deepEqual(resolveRoute("admin", growth, ids), { pageId: "home", denied: true, requestedId: "admin" });
    assert.deepEqual(resolveRoute("business-orders", growth, ids), { pageId: "home", denied: true, requestedId: "business-orders" });
    assert.deepEqual(resolveRoute("made-up", growth, ids), { pageId: "home", denied: false, requestedId: "made-up" });
    // the owner is never denied a real page
    assert.deepEqual(resolveRoute("admin", owner, ids), { pageId: "admin", denied: false, requestedId: "admin" });
  });
});

describe("#3802 AC-3: normalizeAccess refuses a forged shape", () => {
  it("rejects non-objects, arrays, unknown roles and bad statuses", () => {
    for (const bad of [null, undefined, 1, "x", [], ["role_home"], { role: "superuser", status: "active" },
                       { role: "growth", status: "pending" }, { role: "growth" }, { status: "active" }]) {
      assert.equal(normalizeAccess(bad), null, JSON.stringify(bad));
    }
  });
  it("keeps a valid shape and strips non-string areas", () => {
    const got = normalizeAccess({ email: "g@x", role: "growth", status: "active", areas: ["role_home", 7, null, {}, "x"] });
    assert.deepEqual(got, { email: "g@x", role: "growth", status: "active", areas: ["role_home", "x"] });
  });
  it("a missing email becomes an empty string, areas default to []", () => {
    const got = normalizeAccess({ role: "owner", status: "active" });
    assert.deepEqual(got, { email: "", role: "owner", status: "active", areas: [] });
  });
});

describe("#3802 AC-4: every invite-screen state has exactly one known next step", () => {
  it("every state has a non-empty title, body and a known action kind", () => {
    for (const [state, copy] of Object.entries(ACCEPT_COPY)) {
      assert.ok(copy.title && copy.title.length > 0, `${state} title`);
      assert.ok(copy.body && copy.body.length > 0, `${state} body`);
      assert.ok(copy.action && copy.action.label && copy.action.label.length > 0, `${state} action label`);
      assert.ok(ACCEPT_ACTION_KINDS.includes(copy.action.kind), `${state} action kind ${copy.action.kind}`);
    }
  });
  it("the required states all exist", () => {
    for (const s of ["ready", "signed_in_other", "working", "ok", "used", "expired",
                     "invalid", "account_conflict", "try_again", "offline"]) {
      assert.ok(Object.hasOwn(ACCEPT_COPY, s), s);
    }
  });
  it("an unknown or non-string state degrades to the invalid screen", () => {
    assert.equal(acceptCopy("not-a-state"), ACCEPT_COPY.invalid);
    assert.equal(acceptCopy(""), ACCEPT_COPY.invalid);
    assert.equal(acceptCopy(undefined), ACCEPT_COPY.invalid);
    assert.equal(acceptCopy("__proto__"), ACCEPT_COPY.invalid);
  });
  it("the email placeholder is always filled, even with no email", () => {
    assert.ok(acceptBody("signed_in_other", { email: "person@x" }).includes("person@x"));
    assert.ok(!acceptBody("signed_in_other", {}).includes("{email}"));
    assert.ok(acceptBody("signed_in_other", {}).includes("another account"));
    // a state without the token is returned intact
    assert.equal(acceptBody("expired", {}), ACCEPT_COPY.expired.body);
  });
});

describe("#3802 AC-5: inviteRowState is only meaningful for an invited row", () => {
  const row = { email: "g@x", status: "invited" };
  it("maps a present state and falls back to none", () => {
    assert.equal(inviteRowState(row, [{ email: "g@x", state: "pending" }]), "pending");
    assert.equal(inviteRowState(row, [{ email: "g@x", state: "opened" }]), "opened");
    assert.equal(inviteRowState(row, [{ email: "g@x", state: "expired" }]), "expired");
    assert.equal(inviteRowState(row, [{ email: "g@x", state: "weird" }]), "none");
    assert.equal(inviteRowState(row, []), "none");
  });
  it("tolerates missing row and malformed states", () => {
    assert.equal(inviteRowState(null, [{ email: "g@x", state: "pending" }]), "none");
    assert.equal(inviteRowState(row, null), "none");
    assert.equal(inviteRowState(row, "pending"), "none");
    assert.equal(inviteRowState(row, [null, { email: "other@x", state: "pending" }]), "none");
  });
  it("every mapped state has a badge, a variant and a line", () => {
    for (const s of ["pending", "opened", "expired", "none"]) {
      const c = INVITE_STATE_COPY[s];
      assert.ok(c && c.badge && c.variant, s);
      assert.equal(typeof c.line, "function", `${s} line`);
    }
  });
});

describe("#3802 AC-6: the menu never leaks a forbidden page", () => {
  it("growth and partner see only their Home", () => {
    for (const a of [growth, partner]) {
      const groups = visibleNavGroups(NAV_GROUPS, a);
      const ids = groups.flatMap((g) => g.items.map((i) => i.id));
      assert.deepEqual(ids, ["home"], a.role);
      assert.ok(!ids.includes("admin"), "no Team and roles");
    }
  });
  it("an admin sees the console but not Team and roles", () => {
    const ids = visibleNavGroups(NAV_GROUPS, admin).flatMap((g) => g.items.map((i) => i.id));
    assert.ok(ids.includes("overview"), "dashboard");
    assert.ok(!ids.includes("admin"), "Team and roles is the owner's alone");
    assert.ok(!ids.includes("home"), "admin has no role home");
  });
  it("the owner sees Team and roles; a malformed access sees an empty menu", () => {
    const ownerIds = visibleNavGroups(NAV_GROUPS, owner).flatMap((g) => g.items.map((i) => i.id));
    assert.ok(ownerIds.includes("admin"), "owner sees Team and roles");
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, null), []);
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, { status: "invited", areas: ["role_home"] }), []);
  });
});
