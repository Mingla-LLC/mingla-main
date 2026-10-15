// Issue #3802 (Wave 0) — implementor suite for roles in the admin app.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job").
// Changed here, and only this: C-9 "title and breadcrumb follow the person's
// own home" pinned the old header markup (a clickable root crumb). The approved
// breadcrumb is "Group › Page" in plain words. See the note on that test.
//
//   C-1  a page nobody listed is owner/admin-only: the two non-admin roles can
//        open none of the existing pages (every page id parsed from App.jsx)
//   C-2  named money, ads and people pages
//   C-3  Team and roles is the owner's alone
//   C-4  the menu each role sees
//   C-5  what an address resolves to (allowed, refused, unknown, no access)
//   C-6  invited people and inherited property names open nothing
//   C-7  the server's answer is checked before it is used
//   C-8  titles and role display names
//   C-9  source contracts: the wiring of auth, menu, palette and routes
//   C-10 invite link parsing
//   C-11 every invite screen state has a title, a body and one next step
//   C-12 invite row state mapping
//   C-13 invite row copy
//   C-14 source contracts: the invite flow
//
// Fails-on-revert is recorded on the issue for C-1 (the page default) and
// C-5 (the route guard).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import * as constants from "../lib/constants.js";
import {
  AREA,
  INVITABLE_ROLES,
  PAGE_AREA_OVERRIDES,
  ROLE_HOME_TITLES,
  ROLE_LABELS,
  TEAM_NAV_GROUP,
  areaForPage,
  canOpenPage,
  homePageFor,
  normalizeAccess,
  pageTitle,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import {
  ACCEPT_ACTION_KINDS,
  ACCEPT_COPY,
  INVITE_ROUTE,
  INVITE_STATE_COPY,
  acceptBody,
  acceptCopy,
  inviteRowState,
  parseInviteHash,
} from "../lib/inviteLink.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const APP_JSX = read("App.jsx");
const AUTH_CONTEXT = read("context/AuthContext.jsx");
const ADMIN_PAGE = read("pages/AdminPage.jsx");
const ROLE_HOME_PAGE = read("pages/RoleHomePage.jsx");
const SIDEBAR = read("components/layout/Sidebar.jsx");
const APP_SHELL = read("components/layout/AppShell.jsx");
const HEADER = read("components/layout/Header.jsx");
const CMD_PALETTE = read("components/CommandPalette.jsx");
const LOGIN_SCREEN = read("components/LoginScreen.jsx");
const INVITE_ACCEPT = read("components/InviteAcceptScreen.jsx");
const INVITE_SETUP = read("components/InviteSetupScreen.jsx");
const CONSTANTS_SRC = read("lib/constants.js");
const ACCESS_SRC = read("lib/access.js");
const AUDIT_LOG_SRC = read("lib/auditLog.js");

// Every page id the app has, parsed from App.jsx so pages other work adds are
// covered without touching this file.
function parsePageIds() {
  const m = APP_JSX.match(/const PAGES\s*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, "expected to find `const PAGES = { ... }`");
  return [...m[1].matchAll(/^\s*"?([a-zA-Z][\w-]*)"?\s*:/gm)].map((mm) => mm[1]);
}
const PAGE_IDS = parsePageIds();

// The same area lists the server returns for each role.
const owner = { email: "owner@test.local", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm", "beta_leads"] };
const admin = { email: "admin@test.local", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads"] };
const growth = { email: "growth@test.local", role: "growth", status: "active", areas: ["role_home"] };
const partner = { email: "partner@test.local", role: "partner", status: "active", areas: ["role_home"] };
const invitedGrowth = { email: "inv@test.local", role: "growth", status: "invited", areas: [] };

describe("#3802 C-1: a page nobody listed is owner/admin-only", () => {
  it("the parse found the whole page map", () => {
    assert.ok(PAGE_IDS.length >= 32, `only ${PAGE_IDS.length} page ids parsed`);
    assert.equal(PAGE_IDS[0], "home", "home is the first key of PAGES");
    for (const id of ["overview", "admin", "stripe-mode", "ad-engine", "refund-operations"]) {
      assert.ok(PAGE_IDS.includes(id), `expected page id '${id}'`);
    }
    assert.equal(new Set(PAGE_IDS).size, PAGE_IDS.length, "no page id appears twice");
  });

  it("Sales and marketing and Founding partner can open no page except home", () => {
    for (const id of PAGE_IDS) {
      if (id === "home") continue;
      assert.equal(canOpenPage(growth, id), false, `growth must not open '${id}'`);
      assert.equal(canOpenPage(partner, id), false, `partner must not open '${id}'`);
    }
    assert.equal(canOpenPage(growth, "home"), true);
    assert.equal(canOpenPage(partner, "home"), true);
  });

  it("a page added tomorrow needs the full admin console", () => {
    assert.equal(areaForPage("a-page-added-tomorrow"), AREA.ADMIN_CONSOLE);
    assert.equal(canOpenPage(growth, "a-page-added-tomorrow"), false);
    assert.equal(canOpenPage(partner, "a-page-added-tomorrow"), false);
    assert.equal(canOpenPage(admin, "a-page-added-tomorrow"), true);
    assert.equal(canOpenPage(owner, "a-page-added-tomorrow"), true);
  });

  it("only approved pages are listed as exceptions, and none loosens the default", () => {
    assert.deepEqual(PAGE_AREA_OVERRIDES, { home: "role_home", admin: "team_manage", hosts: "crm", creators: "crm", drafts: "crm", "beta-leads": "beta_leads", agent: "crm" });
    for (const id of PAGE_IDS) {
      if (Object.hasOwn(PAGE_AREA_OVERRIDES, id)) continue;
      assert.equal(areaForPage(id), "admin_console", `'${id}' must need admin_console`);
    }
  });

  it("every existing page except Team and roles stays open to an admin, and all to the owner", () => {
    for (const id of PAGE_IDS) {
      if (id === "home") continue;
      assert.equal(canOpenPage(owner, id), true, `owner must open '${id}'`);
      assert.equal(canOpenPage(admin, id), id !== "admin", `admin on '${id}'`);
    }
  });
});

describe("#3802 C-2: money, ads and people pages", () => {
  it("owner and admin yes; the two new roles no", () => {
    for (const id of ["ad-engine", "campaign-builder", "campaigns", "stripe-mode", "users", "refund-operations"]) {
      assert.equal(canOpenPage(owner, id), true, `owner '${id}'`);
      assert.equal(canOpenPage(admin, id), true, `admin '${id}'`);
      assert.equal(canOpenPage(growth, id), false, `growth '${id}'`);
      assert.equal(canOpenPage(partner, id), false, `partner '${id}'`);
    }
  });
});

describe("#3802 C-3: Team and roles", () => {
  it("is the owner's alone", () => {
    assert.equal(canOpenPage(owner, "admin"), true);
    assert.equal(canOpenPage(admin, "admin"), false);
    assert.equal(canOpenPage(growth, "admin"), false);
    assert.equal(canOpenPage(partner, "admin"), false);
  });

  it("is called Team and roles in the menu", () => {
    assert.equal(NAV_ITEMS.find((i) => i.id === "admin")?.label, "Team and roles");
  });
});

describe("#3802 C-4: the menu each role sees", () => {
  const ids = (access) => visibleNavGroups(NAV_GROUPS, access).flatMap((g) => g.items).map((i) => i.id);
  const allIds = NAV_ITEMS.map((i) => i.id);

  it("Sales and marketing and Founding partner see exactly Home", () => {
    assert.deepEqual(ids(growth), ["home"]);
    assert.deepEqual(ids(partner), ["home"]);
  });

  it("an admin sees every existing item except Team and roles, and no Home", () => {
    assert.deepEqual(ids(admin), allIds.filter((id) => id !== "admin"));
    assert.equal(ids(admin).includes("home"), false);
  });

  it("the owner sees every existing item, and no Home", () => {
    assert.deepEqual(ids(owner), allIds);
    assert.equal(ids(owner).includes("home"), false);
  });

  it("no empty group is returned, and nothing at all without access", () => {
    for (const access of [owner, admin, growth, partner]) {
      for (const g of visibleNavGroups(NAV_GROUPS, access)) {
        assert.ok(g.items.length > 0);
      }
    }
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, null), []);
    assert.deepEqual(visibleNavGroups(NAV_GROUPS, invitedGrowth), []);
    assert.equal(visibleNavGroups(NAV_GROUPS, growth).length, 1);
    assert.equal(visibleNavGroups(NAV_GROUPS, owner).length, NAV_GROUPS.length);
  });

  it("group labels and order are kept, and the source list is not changed", () => {
    const before = JSON.stringify(NAV_GROUPS);
    const groups = visibleNavGroups(NAV_GROUPS, owner);
    assert.deepEqual(groups.map((g) => g.label), NAV_GROUPS.map((g) => g.label));
    assert.equal(JSON.stringify(NAV_GROUPS), before);
    assert.deepEqual(TEAM_NAV_GROUP, { label: null, items: [{ id: "home", label: "Home", icon: "Home" }] });
  });
});

describe("#3802 C-5: what an address resolves to", () => {
  it("a page outside a role's access goes to their home and says so", () => {
    assert.deepEqual(resolveRoute("stripe-mode", growth, PAGE_IDS),
      { pageId: "home", denied: true, requestedId: "stripe-mode" });
    assert.deepEqual(resolveRoute("home", owner, PAGE_IDS),
      { pageId: "overview", denied: true, requestedId: "home" });
    assert.deepEqual(resolveRoute("admin", admin, PAGE_IDS),
      { pageId: "overview", denied: true, requestedId: "admin" });
  });

  it("an unknown address goes home quietly", () => {
    assert.deepEqual(resolveRoute("nonexistent", growth, PAGE_IDS),
      { pageId: "home", denied: false, requestedId: "nonexistent" });
    assert.deepEqual(resolveRoute("", owner, PAGE_IDS),
      { pageId: "overview", denied: false, requestedId: "" });
    assert.deepEqual(resolveRoute(INVITE_ROUTE, admin, PAGE_IDS),
      { pageId: "overview", denied: false, requestedId: INVITE_ROUTE });
  });

  it("an allowed page is shown", () => {
    assert.deepEqual(resolveRoute("home", partner, PAGE_IDS),
      { pageId: "home", denied: false, requestedId: "home" });
    assert.deepEqual(resolveRoute("admin", owner, PAGE_IDS),
      { pageId: "admin", denied: false, requestedId: "admin" });
    assert.deepEqual(resolveRoute("users", admin, PAGE_IDS),
      { pageId: "users", denied: false, requestedId: "users" });
  });

  it("no access resolves to no page at all", () => {
    assert.equal(resolveRoute("overview", null, PAGE_IDS).pageId, null);
    assert.equal(resolveRoute("overview", invitedGrowth, PAGE_IDS).pageId, null);
    assert.equal(resolveRoute("home", { ...growth, areas: [] }, PAGE_IDS).pageId, null);
  });

  it("every page id resolves, for every role, to a page that role may open", () => {
    for (const access of [owner, admin, growth, partner]) {
      for (const id of [...PAGE_IDS, "nonexistent", "", "constructor"]) {
        const route = resolveRoute(id, access, PAGE_IDS);
        assert.equal(canOpenPage(access, route.pageId), true,
          `${access.role} asked for '${id}' and was sent to '${route.pageId}'`);
        assert.ok(PAGE_IDS.includes(route.pageId));
      }
    }
  });

  it("homes", () => {
    assert.equal(homePageFor(owner), "overview");
    assert.equal(homePageFor(admin), "overview");
    assert.equal(homePageFor(growth), "home");
    assert.equal(homePageFor(partner), "home");
    assert.equal(homePageFor(null), null);
    assert.equal(homePageFor(invitedGrowth), null);
  });
});

describe("#3802 C-6: invited people and inherited names open nothing", () => {
  it("an invited person can open no page", () => {
    assert.equal(canOpenPage(invitedGrowth, "home"), false);
    assert.equal(canOpenPage({ ...invitedGrowth, areas: ["role_home", "admin_console"] }, "home"), false);
    assert.equal(canOpenPage({ ...invitedGrowth, areas: ["role_home", "admin_console"] }, "overview"), false);
  });

  it("names every object inherits fall to the default", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      assert.equal(areaForPage(name), AREA.ADMIN_CONSOLE, name);
      assert.equal(canOpenPage(growth, name), false, name);
      assert.equal(canOpenPage(partner, name), false, name);
    }
  });

  it("no access object, no page", () => {
    for (const bad of [null, undefined, {}, { status: "active" }, { status: "active", areas: "admin_console" }]) {
      assert.equal(canOpenPage(bad, "overview"), false);
      assert.equal(canOpenPage(bad, "home"), false);
    }
  });
});

describe("#3802 C-7: the server's answer is checked before it is used", () => {
  it("refuses an unknown role, a missing status and non-objects", () => {
    assert.equal(normalizeAccess({ role: "superadmin", status: "active", areas: ["admin_console"] }), null);
    assert.equal(normalizeAccess({ role: "constructor", status: "active", areas: [] }), null);
    assert.equal(normalizeAccess({ role: "admin", areas: ["admin_console"] }), null);
    assert.equal(normalizeAccess({ role: "admin", status: "revoked", areas: ["admin_console"] }), null);
    for (const bad of [null, undefined, "admin", 1, true, [], ["admin"]]) {
      assert.equal(normalizeAccess(bad), null);
    }
  });

  it("keeps only text areas, and never invents any", () => {
    assert.deepEqual(normalizeAccess({ email: "a@b.co", role: "growth", status: "active", areas: "role_home" }),
      { email: "a@b.co", role: "growth", status: "active", areas: [] });
    assert.deepEqual(normalizeAccess({ email: "a@b.co", role: "owner", status: "active" }).areas, []);
    assert.deepEqual(
      normalizeAccess({ email: "a@b.co", role: "admin", status: "active", areas: ["admin_console", 7, null, { a: 1 }, "x"] }).areas,
      ["admin_console", "x"]);
    assert.deepEqual(normalizeAccess({ role: "partner", status: "invited", areas: [] }),
      { email: "", role: "partner", status: "invited", areas: [] });
  });

  it("the areas come from the server, not from the role", () => {
    const ownerWithNothing = normalizeAccess({ email: "o@b.co", role: "owner", status: "active", areas: [] });
    assert.equal(canOpenPage(ownerWithNothing, "overview"), false);
    assert.equal(canOpenPage(ownerWithNothing, "admin"), false);
    assert.equal(/ROLE_AREAS|role\s*===\s*["'](owner|admin)["']\s*\?/.test(ACCESS_SRC), false);
  });
});

describe("#3802 C-8: titles and role display names", () => {
  it("role homes are titled per role", () => {
    assert.equal(pageTitle("home", growth, NAV_ITEMS), "My day");
    assert.equal(pageTitle("home", partner, NAV_ITEMS), "Company view");
    assert.deepEqual(ROLE_HOME_TITLES, { growth: "My day", partner: "Company view" });
  });

  it("other pages take their menu label; unknown ones read Dashboard", () => {
    assert.equal(pageTitle("admin", owner, NAV_ITEMS), "Team and roles");
    assert.equal(pageTitle("overview", admin, NAV_ITEMS), "Dashboard");
    assert.equal(pageTitle("nope", admin, NAV_ITEMS), "Dashboard");
  });

  it("the four display names, exactly", () => {
    assert.deepEqual(ROLE_LABELS, {
      owner: "Owner",
      admin: "Admin",
      growth: "Sales and marketing",
      partner: "Founding partner",
    });
    assert.deepEqual(INVITABLE_ROLES, ["admin", "growth", "partner"]);
    assert.deepEqual(AREA, { ADMIN_CONSOLE: "admin_console", TEAM_MANAGE: "team_manage", ROLE_HOME: "role_home", CRM: "crm", BETA_LEADS: "beta_leads" });
  });

  it("team actions have plain-English labels in the activity list", () => {
    // Read from the source: the module itself imports the Supabase client.
    const labels = {
      "team.invite": "Invited a teammate",
      "team.invite_resend": "Resent an invite",
      "team.role_change": "Changed a teammate's role",
      "team.remove": "Removed a teammate's access",
      "team.restore": "Restored a teammate's access",
      "team.activate": "Accepted an invite",
      "team.status_change": "Changed a teammate's status",
    };
    for (const [action, label] of Object.entries(labels)) {
      assert.ok(AUDIT_LOG_SRC.includes(`"${action}": "${label}",`), `missing label for ${action}`);
    }
  });
});

describe("#3802 C-9: source contracts — auth, menu, palette, routes", () => {
  it("the app reads a person's access from the server, in one place", () => {
    assert.ok(AUTH_CONTEXT.includes('rpc("admin_team_my_access")'));
    assert.ok(AUTH_CONTEXT.includes("normalizeAccess("));
    for (const gone of ["ALLOWED_ADMIN_EMAILS", "is_admin_email", "get_admin_emails", "refreshAdminList", "dynamicEmailsRef"]) {
      assert.equal(AUTH_CONTEXT.includes(gone), false, `AuthContext must not contain ${gone}`);
    }
    for (const exposed of ["access,", "accessError,", "retryAccess,", "authNotice,", "acceptInvite,"]) {
      assert.ok(AUTH_CONTEXT.includes(exposed), `context value must expose ${exposed}`);
    }
  });

  it("the hard-coded email list is gone", () => {
    assert.equal(Object.hasOwn(constants, "ALLOWED_ADMIN_EMAILS"), false);
    assert.equal(CONSTANTS_SRC.includes("ALLOWED_ADMIN_EMAILS"), false);
  });

  it("the Team and roles page writes no membership table itself", () => {
    assert.equal(ADMIN_PAGE.includes('from("admin_users")'), false);
    assert.equal(/from\(["'`]admin_team_/.test(ADMIN_PAGE), false);
    assert.ok(ADMIN_PAGE.includes('rpc("admin_team_list")'));
    assert.ok(ADMIN_PAGE.includes('rpc("admin_team_set_member"'));
    assert.equal(ADMIN_PAGE.includes("logAdminAction"), false);
    assert.equal(ADMIN_PAGE.includes("SETUP_SQL"), false);
    assert.equal(/CREATE POLICY/i.test(ADMIN_PAGE), false);
  });

  it("the menu is filtered and the Home icon is registered", () => {
    assert.ok(SIDEBAR.includes("visibleNavGroups("));
    assert.equal(/NAV_GROUPS\.(map|forEach)\(/.test(SIDEBAR), false, "the raw list is never iterated");
    const iconMap = SIDEBAR.match(/const ICON_MAP = \{([\s\S]*?)\n\};/);
    assert.ok(iconMap);
    assert.ok(/\bHome\b/.test(iconMap[1]), "Home must be in ICON_MAP");
    assert.ok(/import \{[\s\S]*?\bHome,[\s\S]*?\} from "lucide-react"/.test(SIDEBAR));
    assert.ok(SIDEBAR.includes("ROLE_LABELS[access.role]"));
  });

  it("the command palette offers only pages the person may open and searches only for the admin console", () => {
    assert.ok(CMD_PALETTE.includes("canOpenPage("));
    assert.ok(CMD_PALETTE.includes("AREA.ADMIN_CONSOLE"));
    assert.ok(CMD_PALETTE.includes('canOpenPage(access, "settings")'));
    const search = CMD_PALETTE.indexOf('supabase.from("profiles")');
    const gate = CMD_PALETTE.indexOf("if (!isAdminConsole) return;");
    assert.ok(gate > 0 && search > gate, "the lookup must sit behind the admin-console check");
    assert.equal(/NAV_ITEMS\.(slice|filter)\(/.test(CMD_PALETTE), false, "the raw page list is never offered");
    assert.ok(CMD_PALETTE.includes('"Search pages..."'));
  });

  it("the page shown is chosen from what the person may open", () => {
    assert.ok(APP_JSX.includes("resolveRoute("));
    assert.ok(APP_JSX.includes("const ActivePage = PAGES[route.pageId];"));
    const appCode = APP_JSX.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    // PAGES is indexed in exactly two places: the address normaliser and the
    // one lookup of the component, which uses the resolved page.
    assert.equal(appCode.match(/PAGES\[/g).length, 2, "a page component is never looked up from the address");
    assert.equal(/PAGES\[(activeTab|nav\.requested)\]/.test(appCode), false);
    // A refusal is announced only when the address named a real page.
    // #3720 Slice F: addressNamesPage() reads the hash once, treats legacy
    // #/support and #/email as named (they rewrite to community-support), then
    // Object.hasOwn(PAGES, page) — not the older inline requestedPageId() form.
    assert.ok(APP_JSX.includes("if (route.denied && nav.named && lastToldRef.current !== nav.seq) {"));
    assert.ok(APP_JSX.includes("function addressNamesPage()"));
    assert.ok(APP_JSX.includes('if (page === "support" || page === "email") return true;'));
    assert.ok(APP_JSX.includes("return Object.hasOwn(PAGES, page);"));
    assert.ok(APP_JSX.includes("<AppShell activeTab={route.pageId}"));
    assert.ok(APP_JSX.includes("That page isn't part of your access"));
    assert.ok(APP_JSX.includes("Couldn&apos;t load your access"));
    assert.ok(APP_JSX.includes("home: RoleHomePage,"));
  });

  it("title and breadcrumb follow the person's own home", () => {
    assert.ok(APP_SHELL.includes("pageTitle(activeTab, access, NAV_ITEMS)"));
    // [TEST-MOD-APPROVED ISSUE-3802] was: the header got a `homeId` and drew a
    // root crumb that went to it. The approved shell's breadcrumb is words only
    // ("Group › Page"), so there is no root crumb to send anyone anywhere. What
    // is kept: the crumb is built from the title the shell resolved for THIS
    // person (so a role home reads "My day"), and it never names the dashboard.
    assert.ok(APP_SHELL.includes("title={currentTitle}"));
    assert.ok(HEADER.includes("items={breadcrumbFor(activeTab, title, NAV_GROUPS)}"));
    assert.equal(HEADER.includes('onNavigate?.("overview")'), false);
    assert.equal(/["']overview["']|["']Admin["']/.test(HEADER), false);
  });

  it("the role home reads nothing from the database and offers a next step", () => {
    assert.equal(/supabase/.test(ROLE_HOME_PAGE), false);
    assert.ok(ROLE_HOME_PAGE.includes("useCrmSummary"));
    assert.ok(ROLE_HOME_PAGE.includes("Nothing due. Set a next action and a date"));
  });
});

describe("#3802 C-10: invite link parsing", () => {
  const secret = "Ab0_-".repeat(8) + "xyz"; // 43 characters
  it("a valid link gives the secret", () => {
    assert.equal(secret.length, 43);
    assert.equal(parseInviteHash(`#/${INVITE_ROUTE}/${secret}`), secret);
    assert.equal(INVITE_ROUTE, "accept-invite");
  });

  it("anything else gives nothing", () => {
    assert.equal(parseInviteHash(`#/accept-invite/${secret.slice(1)}`), null);   // 42
    assert.equal(parseInviteHash(`#/accept-invite/${secret}A`), null);           // 44
    assert.equal(parseInviteHash(`#/accept-invite/${secret}?x=1`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${secret}/`), null);
    assert.equal(parseInviteHash(`#/accept-invite/${secret.slice(0, 42)}+`), null);
    assert.equal(parseInviteHash(`#/accept-invite/`), null);
    assert.equal(parseInviteHash(`#/accept-invite`), null);
    assert.equal(parseInviteHash(`#/overview`), null);
    assert.equal(parseInviteHash(`/accept-invite/${secret}`), null);
    assert.equal(parseInviteHash(""), null);
    assert.equal(parseInviteHash(null), null);
    assert.equal(parseInviteHash(undefined), null);
  });
});

describe("#3802 C-11: every invite screen state has a next step", () => {
  const expected = ["ready", "working", "ok", "used", "expired", "invalid", "account_conflict", "try_again", "offline", "signed_in_other"];

  it("all ten states are there", () => {
    assert.deepEqual(Object.keys(ACCEPT_COPY).sort(), [...expected].sort());
  });

  it("each has a title, a body and exactly one action of a known kind", () => {
    assert.deepEqual(ACCEPT_ACTION_KINDS, ["continue", "go_sign_in", "retry", "sign_out", "copy_message"]);
    for (const state of expected) {
      const copy = ACCEPT_COPY[state];
      assert.ok(typeof copy.title === "string" && copy.title.length > 0, `${state} title`);
      assert.ok(typeof copy.body === "string" && copy.body.length > 0, `${state} body`);
      assert.ok(typeof copy.action.label === "string" && copy.action.label.length > 0, `${state} action label`);
      assert.ok(ACCEPT_ACTION_KINDS.includes(copy.action.kind), `${state} action kind`);
      assert.deepEqual(Object.keys(copy).sort(), ["action", "body", "title"]);
    }
  });

  it("the words on screen", () => {
    assert.equal(ACCEPT_COPY.ready.title, "Accept your invite");
    assert.equal(ACCEPT_COPY.ready.action.label, "Continue");
    assert.equal(ACCEPT_COPY.used.title, "This link was already used");
    assert.equal(ACCEPT_COPY.expired.title, "This invite has expired");
    assert.equal(ACCEPT_COPY.invalid.title, "This invite link doesn't work");
    assert.equal(ACCEPT_COPY.account_conflict.title, "This email needs a different invite");
    assert.equal(ACCEPT_COPY.try_again.title, "We couldn't open your invite");
    assert.equal(ACCEPT_COPY.try_again.body, "Nothing was used up. Try again in a moment.");
    assert.equal(ACCEPT_COPY.offline.title, "You're offline");
    assert.equal(ACCEPT_COPY.signed_in_other.title, "You're signed in already");
    assert.equal(ACCEPT_COPY.signed_in_other.action.label, "Sign out and continue");
    for (const state of ["used", "expired", "invalid"]) {
      assert.deepEqual(ACCEPT_COPY[state].action, { label: "Go to sign in", kind: "go_sign_in" });
    }
    assert.deepEqual(ACCEPT_COPY.account_conflict.action, { label: "Copy a message to send them", kind: "copy_message" });
    for (const state of ["try_again", "offline"]) {
      assert.deepEqual(ACCEPT_COPY[state].action, { label: "Try again", kind: "retry" });
    }
  });

  it("a state this app does not know reads as a link that doesn't work", () => {
    assert.equal(acceptCopy("something_new"), ACCEPT_COPY.invalid);
    assert.equal(acceptCopy("constructor"), ACCEPT_COPY.invalid);
    assert.equal(acceptCopy(undefined), ACCEPT_COPY.invalid);
    assert.equal(acceptBody("signed_in_other", { email: "a@b.co" }),
      "You're signed in as a@b.co. Sign out to accept this invite.");
    assert.equal(acceptBody("ready"), ACCEPT_COPY.ready.body);
  });
});

describe("#3802 C-12: invite row state mapping", () => {
  const row = { email: "p@test.local", status: "invited", role: "growth" };
  it("maps what the server says, and reads everything else as no link", () => {
    assert.equal(inviteRowState(row, []), "none");
    assert.equal(inviteRowState(row, [{ email: "other@test.local", state: "pending" }]), "none");
    assert.equal(inviteRowState(row, [{ email: "p@test.local", state: "pending" }]), "pending");
    assert.equal(inviteRowState(row, [{ email: "p@test.local", state: "opened" }]), "opened");
    assert.equal(inviteRowState(row, [{ email: "p@test.local", state: "expired" }]), "expired");
    assert.equal(inviteRowState(row, [{ email: "p@test.local", state: "brand_new_state" }]), "none");
    assert.equal(inviteRowState(row, [{ email: "p@test.local", state: "constructor" }]), "none");
    assert.equal(inviteRowState(row, null), "none");
    assert.equal(inviteRowState(null, [{ email: "p@test.local", state: "pending" }]), "none");
  });
});

describe("#3802 C-13: invite row copy", () => {
  it("four states, with their badges", () => {
    assert.deepEqual(Object.keys(INVITE_STATE_COPY).sort(), ["expired", "none", "opened", "pending"]);
    assert.equal(INVITE_STATE_COPY.pending.badge, "Link sent");
    assert.equal(INVITE_STATE_COPY.pending.variant, "info");
    assert.equal(INVITE_STATE_COPY.opened.badge, "Link opened");
    assert.equal(INVITE_STATE_COPY.opened.variant, "info");
    assert.equal(INVITE_STATE_COPY.expired.badge, "Link expired");
    assert.equal(INVITE_STATE_COPY.expired.variant, "warning");
    assert.equal(INVITE_STATE_COPY.none.badge, "No active link");
    assert.equal(INVITE_STATE_COPY.none.variant, "warning");
  });

  it("each state says what to do next", () => {
    assert.ok(INVITE_STATE_COPY.pending.line({}, { expires_at: "2026-10-19T12:00:00Z" }).startsWith("Expires "));
    assert.equal(INVITE_STATE_COPY.pending.line({}, null), "Expires soon");
    assert.equal(INVITE_STATE_COPY.opened.line({}, {}), "Setting up — not finished yet");
    assert.equal(INVITE_STATE_COPY.expired.line({}, {}), "Send a new invite so they can get in");
    assert.equal(INVITE_STATE_COPY.none.line({}, null), "Send a new invite so they can get in");
    assert.deepEqual(
      Object.entries(INVITE_STATE_COPY).filter(([, v]) => v.needsNewLink).map(([k]) => k).sort(),
      ["expired", "none"]);
  });
});

describe("#3802 C-14: source contracts — the invite flow", () => {
  it("the Team and roles page sends invitations through one function and nothing else", () => {
    assert.ok(ADMIN_PAGE.includes('functions.invoke("admin-team-invite"'));
    assert.ok(ADMIN_PAGE.includes("admin_team_invite_states"));
    assert.equal(ADMIN_PAGE.includes("signInWithOtp"), false);
    assert.equal(ADMIN_PAGE.includes('from("admin_users")'), false);
    assert.equal(ADMIN_PAGE.match(/functions\.invoke\(/g).length, 1);
    assert.ok(ADMIN_PAGE.includes("Resend invite"));
    assert.ok(ADMIN_PAGE.includes("Remove access for ${email}?"));
    assert.ok(ADMIN_PAGE.includes("They get an email with a one-time link that expires in 7 days, and choose their own password."));
  });

  it("the auth context opens a link through the accept function and signs other sessions out", () => {
    assert.ok(AUTH_CONTEXT.includes('functions.invoke("admin-team-accept-invite"'));
    assert.ok(AUTH_CONTEXT.includes('scope: "others"'));
    for (const gone of ["verifyInviteOtp", "activate_invited_admin", "check_invited_admin", "shouldCreateUser: true"]) {
      assert.equal(AUTH_CONTEXT.includes(gone), false, `AuthContext must not contain ${gone}`);
    }
    // Opening a link never marks the session as fully signed in.
    const accept = AUTH_CONTEXT.slice(AUTH_CONTEXT.indexOf("const acceptInvite = async"), AUTH_CONTEXT.indexOf("const completeInviteSetup = async"));
    assert.ok(accept.length > 200);
    assert.equal(accept.includes("localStorage.setItem"), false);
    assert.equal(/otpVerifiedRef\.current = true/.test(accept), false);
    assert.ok(accept.includes("localStorage.removeItem(FULL_AUTH_KEY)"));
    // Other sessions are signed out after the password is set and before activation.
    const setup = AUTH_CONTEXT.slice(AUTH_CONTEXT.indexOf("const completeInviteSetup = async"), AUTH_CONTEXT.indexOf("const verifyPassword = async"));
    const pw = setup.indexOf("updateUser({ password })");
    const others = setup.indexOf('signOut({ scope: "others" })');
    const activate = setup.indexOf('rpc("admin_team_activate_self")');
    assert.ok(pw > 0 && others > pw && activate > others);
    // A pending invite is said out loud at the password step.
    assert.ok(AUTH_CONTEXT.includes("Your invite is waiting. Open the link in your invite email to finish setting up."));
    assert.ok(AUTH_CONTEXT.includes("This invite link has expired. Ask the person who invited you to send a new one."));
    assert.ok(AUTH_CONTEXT.includes("Access denied. This email is not authorized."));
  });

  it("the sign-in screen no longer asks for a code", () => {
    assert.equal(/invite code/i.test(LOGIN_SCREEN), false);
    assert.equal(LOGIN_SCREEN.includes("verifyInviteOtp"), false);
    assert.ok(LOGIN_SCREEN.includes("Been invited? Open the link in your invite email."));
    assert.ok(LOGIN_SCREEN.includes("authNotice"));
  });

  it("the app takes the secret out of the address bar", () => {
    assert.ok(APP_JSX.includes("parseInviteHash("));
    assert.ok(APP_JSX.includes("replaceState"));
    assert.ok(APP_JSX.includes('window.history.replaceState(null, "", "#/" + INVITE_ROUTE)'));
    // The invite screen comes before the sign-in screen and before the app.
    const setup = APP_JSX.indexOf("if (inviteSetup) {");
    const invite = APP_JSX.indexOf("if (inviteToken) {");
    const error = APP_JSX.indexOf("if (accessError) {");
    const login = APP_JSX.indexOf("if (!session) {");
    assert.ok(setup > 0 && invite > setup && error > invite && login > error);
    // The secret never becomes the page id held in state.
    assert.ok(APP_JSX.includes('.split("?")[0].split("/")[0]'));
  });

  it("the invite screen opens a link only when its button is pressed", () => {
    assert.ok(INVITE_ACCEPT.includes("acceptInvite(token)"));
    assert.equal(INVITE_ACCEPT.match(/acceptInvite\(/g).length, 1, "called in exactly one place");
    const effects = [...INVITE_ACCEPT.matchAll(/useEffect\(\(\) => \{?([\s\S]*?)\}?, \[[^\]]*\]\)/g)].map((m) => m[1]);
    assert.ok(effects.length >= 1);
    for (const body of effects) {
      assert.equal(/acceptInvite|openInvite|handleAction/.test(body), false, "no effect may open the link");
    }
    assert.ok(INVITE_ACCEPT.includes("onClick={handleAction}"));
    // Once a link was opened it is forgotten, so this screen does not come
    // back after the password is chosen.
    assert.ok(INVITE_ACCEPT.includes("openedRef.current = true;"));
    assert.ok(INVITE_ACCEPT.includes("if (openedRef.current) onDoneRef.current();"));
    assert.ok(INVITE_ACCEPT.includes('aria-live="polite"'));
    assert.ok(INVITE_ACCEPT.includes("titleRef.current?.focus()"));
    assert.equal(/localStorage|sessionStorage|console\.(log|info|debug)/.test(INVITE_ACCEPT), false);
  });

  it("the password screen names the role and how long it stays open", () => {
    assert.ok(INVITE_SETUP.includes("You've been invited to Mingla Admin as ${roleLabel}. Set your password to get started."));
    assert.ok(INVITE_SETUP.includes("This set-up page stays open for 24 hours."));
  });
});
