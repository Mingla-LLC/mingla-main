// Issue #4383 — Admin Communications: one menu group for everything we tell
// hosts and explorers, each its own screen.
//
//   C-1  the menu: a Communications group after Support, its screens in
//        order, each with a registered icon and its own page (T1)
//   C-2  every old tab address lands on the new screen with its other query
//        values kept, in any order (T2); #/email is a live page again
//   C-3  roadmap card links: the new and both older forms open the card (T3)
//   C-4  access is unchanged: for nine personas the set of panels they can
//        open is the same before and after; growth loses only the empty
//        Support menu entry (T4, I-4383-COMMS-ACCESS-UNCHANGED)
//   C-5  unknown and hostile addresses never crash (T5)
//   C-6  the Email screen's sections live in the address (view=)
//   C-7  Later pickers: a wall time in the chosen zone becomes one UTC
//        instant; past and impossible times are refused (T24)
//   C-8  the Push composer's choices, reach and review wording; the server's
//        refusal codes become plain words with the code kept
//   C-9  the screens call their RPCs through the one service and check the
//        time in its zone at submit
//
// MINGLA-INVARIANT: I-4383-COMMS-ACCESS-UNCHANGED | issue #4383 | Moving a panel to its own Communications screen never changes who can open it (C-4 persona table below).
//
// Run: node --test src/__tests__/issue_4383_communications.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AREA,
  BLOG_AREA,
  COMMUNITY_OPERATIONS_AREA,
  COMMUNITY_SUPPORT_AREA,
  SUPPORT_OPERATIONS_AREA,
  canOpenPage,
  normalizeAccess,
  resolveRoute,
  visibleNavGroups,
} from "../lib/access.js";
import { isRetiredPageId, redirectHash } from "../lib/adminRoutes.js";
import {
  COMMUNICATIONS_TAB_PAGES,
  COMMUNITY_PAGE_TABS,
  SUPPORT_PAGE_TABS,
} from "../lib/supportCommunityTabs.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { COMMUNITY_SUPPORT_TAB_CONTRACT } from "../lib/communitySupportCapabilityContract.js";
import { isRoadmapHash, roadmapCardFromHash, roadmapDraftHref } from "../lib/opsModel.js";
import { emailViewFromHash, emailViewHash, emailViewsFor } from "../lib/emailViews.js";
import { checkLaterTime, formatInZone, scheduleLabel, utcToZonedInputs, zonedLocalToUtc } from "../lib/scheduleTime.js";
import { EXPLORER_DESTINATIONS, HOST_DESTINATIONS, opensLabel, pushReach } from "../lib/pushDestinations.js";
import { COMMUNICATIONS_ERROR_COPY, CommunicationsError, communicationsErrorCode, communicationsErrorMessage } from "../lib/communicationsErrors.js";
import { SERVER_TIME_ZONES } from "../lib/serverTimeZones.js";
import { isValidTimeZone, timeZoneOptions } from "../lib/scheduleTime.js";
import { attentionWords, cancelKindLabel } from "../lib/communications.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const APP = read("App.jsx");
const SIDEBAR = read("components/layout/Sidebar.jsx");

// The approved menu (spec §4.1).
const COMMUNICATIONS = [
  ["communications", "Overview", "RadioTower"],
  ["push", "Push", "Send"],
  ["announcements", "Announcements", "BellRing"],
  ["roadmap", "Roadmap", "Milestone"],
  ["email", "Email", "Mail"],
  ["blog", "Blog", "Newspaper"],
  ["links", "Links page", "Link"],
];

describe("C-1 the Communications menu group", () => {
  it("sits right after Support and holds its screens in order", () => {
    const labels = NAV_GROUPS.map((group) => group.label);
    assert.equal(labels.indexOf("Communications"), labels.indexOf("Support") + 1);
    const group = NAV_GROUPS.find((g) => g.label === "Communications");
    assert.deepEqual(group.items.map((item) => [item.id, item.label, item.icon]), COMMUNICATIONS);
    assert.equal(NAV_ITEMS.length, 41, "34 entries + the seven Communications screens");
  });

  it("each screen is a page App draws, and its icon is registered", () => {
    for (const [id, , icon] of COMMUNICATIONS) {
      assert.match(APP, new RegExp(`\\n\\s+${id}: [A-Z]\\w+Page,`), `${id} has a page`);
      assert.match(SIDEBAR, new RegExp(`\\n  ${icon},`), `${icon} is in ICON_MAP`);
    }
  });

  it("Support keeps the inbox and People and roles; Community opens on Ideas", () => {
    assert.deepEqual(SUPPORT_PAGE_TABS.map((t) => [t.id, t.label]), [["support", "Inbox"], ["team", "People and roles"]]);
    assert.deepEqual(COMMUNITY_PAGE_TABS.map((t) => t.id), ["ideas", "questions", "moderation", "enquiry-reports", "brand-groups", "feature-guide", "product"]);
    assert.equal(COMMUNITY_PAGE_TABS.find((t) => t.id === "product").label, "Product board");
  });

  it("the moved panels are drawn by their own screens, not by Support or Community", () => {
    const console = read("pages/CommunitySupportPage.jsx");
    for (const gone of ["<EmailPage", "<BlogPanel", "<LinksPagePanel", "<AnnouncementsPanel", "<RoadmapPanel", "<FailedPushBanner", "community:new-announcement"]) {
      assert.equal(console.includes(gone), false, gone);
    }
    assert.match(read("pages/communications/AnnouncementsPage.jsx"), /<AnnouncementsPanel \/>/);
    assert.match(read("pages/communications/AnnouncementsPage.jsx"), /<FailedPushBanner \/>/);
    assert.match(read("pages/communications/RoadmapPage.jsx"), /<RoadmapPanel \/>/);
    assert.match(read("pages/communications/BlogPage.jsx"), /<BlogPanel onCounts=\{onCounts\} \/>/);
    assert.match(read("pages/communications/LinksPage.jsx"), /<LinksPagePanel \/>/);
    assert.equal(/embedded/.test(read("pages/EmailPage.jsx")), false, "Email is a screen, not an embed");
  });
});

describe("C-2 old addresses land on the new screens", () => {
  const POST = "00000000-0000-4000-8000-0000000000b1";
  const CARD = "00000000-0000-4000-8000-0000000000c1";
  const TABLE = [
    ["#/support?tab=email", "#/email"],
    [`#/support?tab=blog&view=editor&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    [`#/support?view=editor&tab=blog&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    ["#/support?tab=links", "#/links"],
    ["#/community?tab=announcements", "#/announcements"],
    [`#/community?tab=roadmap&card=${CARD}`, `#/roadmap?card=${CARD}`],
    [`#/community?card=${CARD}&tab=roadmap`, `#/roadmap?card=${CARD}`],
    ["#/community-support?tab=email&x=1", "#/email?x=1"],
    [`#/community-support?tab=blog&view=editor&post=${POST}`, `#/blog?view=editor&post=${POST}`],
    ["#/community-support?tab=links", "#/links"],
    ["#/community-support?tab=announcements", "#/announcements"],
    [`#/community-support?x=1&tab=roadmap&card=${CARD}`, `#/roadmap?x=1&card=${CARD}`],
    [`#/community-support?tab=support&ticket=${CARD}`, `#/support?ticket=${CARD}`],
  ];

  it("each row of the approved redirect table", () => {
    for (const [from, to] of TABLE) assert.equal(redirectHash(from), to, from);
  });

  it("the new screens, Support, Community and #/email are live addresses", () => {
    for (const live of ["#/email", "#/email?view=sent", "#/blog?view=editor&post=x", "#/links", "#/announcements", "#/roadmap?card=x", "#/communications", "#/community", "#/support", "#/support?tab=team", "#/community?tab=ideas"]) {
      assert.equal(redirectHash(live), null, live);
    }
    assert.equal(isRetiredPageId("email"), false);
    // #/community with no tab opens Ideas (the page's first tab).
    assert.equal(COMMUNITY_PAGE_TABS[0].id, "ideas");
  });

  it("every moved tab names a real page, and that page's old tab is gone everywhere", () => {
    for (const [tab, page] of Object.entries(COMMUNICATIONS_TAB_PAGES)) {
      assert.ok(COMMUNICATIONS.some(([id]) => id === page), `${tab} -> ${page}`);
      assert.equal([...SUPPORT_PAGE_TABS, ...COMMUNITY_PAGE_TABS].some((t) => t.id === tab), false, `${tab} is still a tab`);
      assert.equal(COMMUNITY_SUPPORT_TAB_CONTRACT[tab].page, page, `${tab} contract row names its screen`);
    }
  });

  it("in-app links point at the new screens", () => {
    assert.match(read("components/blog/BlogPanel.jsx"), /window\.location\.hash = `#\/blog\$\{query \? `\?\$\{query\}` : ""\}`;/);
    assert.match(read("lib/dashboardToday.js"), /href: "#\/announcements",/);
    assert.match(read("components/ops/WordingQueue.jsx"), /href="#\/announcements"/);
    assert.match(read("components/community/FailedPushBanner.jsx"), /see Communications, Announcements\./);
  });
});

describe("C-3 roadmap card links", () => {
  const id = "00000000-0000-4000-8000-0000000000aa";
  it("the new form and both older forms open the card", () => {
    assert.equal(roadmapDraftHref({ links: [{ kind: "roadmap_card", id }] }), `#/roadmap?card=${id}`);
    for (const hash of [`#/roadmap?card=${id}`, `#/community?tab=roadmap&card=${id}`, `#/community-support?tab=roadmap&card=${id}`]) {
      assert.equal(roadmapCardFromHash(hash), id, hash);
    }
  });
  it("a Work card address is not a roadmap address", () => {
    assert.equal(isRoadmapHash(`#/work-board?card=${id}`), false);
    assert.equal(roadmapCardFromHash(`#/work-board?card=${id}`), null);
    assert.equal(roadmapCardFromHash("#/roadmap?card=not-a-card"), null);
  });
});

describe("C-4 nobody gains or loses a panel (I-4383-COMMS-ACCESS-UNCHANGED)", () => {
  // The server's areas per persona (#4255: every active teammate also holds
  // email_drafts and blog; owner, admin and partner hold admin_console).
  const TEAM = [AREA.EMAIL_DRAFTS, BLOG_AREA];
  const person = (role, areas, status = "active") => normalizeAccess({ email: `${role}@example.test`, role, status, areas });
  const PERSONAS = {
    owner: person("owner", [AREA.ADMIN_CONSOLE, AREA.TEAM_MANAGE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    admin: person("admin", [AREA.ADMIN_CONSOLE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    partner: person("partner", [AREA.ADMIN_CONSOLE, AREA.TEAM_MANAGE, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    growth: person("growth", [AREA.ROLE_HOME, AREA.CRM, AREA.BETA_LEADS, ...TEAM]),
    supportOnly: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, ...TEAM]),
    communityOnly: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    supportAndCommunity: person("growth", [AREA.ROLE_HOME, COMMUNITY_SUPPORT_AREA, SUPPORT_OPERATIONS_AREA, COMMUNITY_OPERATIONS_AREA, ...TEAM]),
    invitedAdmin: person("admin", [AREA.ADMIN_CONSOLE, ...TEAM], "invited"),
    noAccess: person("growth", []),
  };
  const ALL = ["announcements", "blog", "brand-groups", "email", "enquiry-reports", "feature-guide", "ideas", "links", "moderation", "product", "questions", "roadmap", "support", "team"];
  const SUPPORT_AREA_PANELS = ["brand-groups", "feature-guide", "links", "support"];
  const COMMUNITY_AREA_PANELS = ["enquiry-reports", "ideas", "moderation", "questions"];
  // What each persona could open on origin/main before #4383 (the old
  // Support and Community tab lists through communitySupportTabsForAccess).
  const BEFORE = {
    owner: ALL,
    admin: ALL,
    partner: ALL,
    growth: ["blog", "email"],
    supportOnly: ["blog", "email", ...SUPPORT_AREA_PANELS].sort(),
    communityOnly: ["blog", "email", ...COMMUNITY_AREA_PANELS].sort(),
    supportAndCommunity: ["blog", "email", ...SUPPORT_AREA_PANELS, ...COMMUNITY_AREA_PANELS].sort(),
    invitedAdmin: [],
    noAccess: [],
  };

  function panelsAfter(access) {
    const out = [];
    for (const page of ["support", "community"]) {
      if (!canOpenPage(access, page)) continue;
      out.push(...communitySupportTabsForAccess(access, page === "support" ? SUPPORT_PAGE_TABS : COMMUNITY_PAGE_TABS).map((t) => t.id));
    }
    for (const screen of Object.values(COMMUNICATIONS_TAB_PAGES)) if (canOpenPage(access, screen)) out.push(screen);
    return out.sort();
  }

  it("each persona opens exactly the panels it opened before", () => {
    for (const [who, access] of Object.entries(PERSONAS)) {
      assert.deepEqual(panelsAfter(access), BEFORE[who], who);
    }
  });

  it("an address for a panel you could not open is still refused", () => {
    const known = NAV_ITEMS.map((i) => i.id);
    for (const [who, access] of Object.entries(PERSONAS)) {
      if (!access || access.status !== "active") continue;
      for (const screen of ["announcements", "roadmap", "email", "blog", "links"]) {
        const route = resolveRoute(screen, access, known);
        assert.equal(route.pageId === screen, BEFORE[who].includes(screen), `${who} -> ${screen}`);
      }
    }
  });

  it("Overview opens for whoever opens any Communications screen, and nobody else", () => {
    for (const [who, access] of Object.entries(PERSONAS)) {
      const any = ["announcements", "roadmap", "email", "blog", "links"].some((id) => canOpenPage(access, id));
      assert.equal(canOpenPage(access, "communications"), any, who);
    }
  });

  it("the only menu change: growth no longer sees an empty Support entry", () => {
    const menu = (access) => visibleNavGroups(NAV_GROUPS, access).flatMap((g) => g.items.map((i) => i.id));
    assert.equal(menu(PERSONAS.growth).includes("support"), false);
    assert.deepEqual(menu(PERSONAS.growth).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog"]);
    assert.deepEqual(menu(PERSONAS.supportOnly).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog", "links"]);
    assert.deepEqual(menu(PERSONAS.communityOnly).filter((id) => COMMUNICATIONS.some(([c]) => c === id)), ["communications", "email", "blog"]);
    for (const who of ["supportOnly", "communityOnly", "supportAndCommunity"]) {
      assert.ok(menu(PERSONAS[who]).includes("support") && menu(PERSONAS[who]).includes("community"), who);
    }
    assert.deepEqual(menu(PERSONAS.noAccess), []);
  });
});

describe("C-5 unknown and hostile addresses", () => {
  it("never crash and never resolve inherited keys", () => {
    for (const bad of ["#/__proto__", "#/constructor", "#/support?tab=__proto__", "#/community?tab=constructor", "#/communications?tab=x", "#/support?tab=%E0%A4%A", "", null, undefined, 7]) {
      assert.doesNotThrow(() => redirectHash(bad), String(bad));
    }
    assert.equal(redirectHash("#/support?tab=__proto__"), null);
    assert.equal(redirectHash("#/communications?tab=x"), null);
    const admin = normalizeAccess({ email: "a@example.test", role: "admin", status: "active", areas: [AREA.ADMIN_CONSOLE] });
    const known = NAV_ITEMS.map((i) => i.id);
    assert.equal(resolveRoute("__proto__", admin, known).pageId, "overview");
    assert.equal(resolveRoute("communications", admin, known).pageId, "communications");
  });
});

describe("C-6 the Email screen's sections", () => {
  const admin = { status: "active", role: "admin", areas: [AREA.ADMIN_CONSOLE] };
  const teammate = { status: "active", role: "growth", areas: [AREA.EMAIL_DRAFTS] };
  it("admins see Sent and Unsubscribes; teammates do not", () => {
    assert.deepEqual(emailViewsFor(admin).map((v) => v.id), ["write", "scheduled", "sent", "templates", "unsubscribes"]);
    // #4383 (SC-10): every teammate who writes email sees Scheduled.
    assert.deepEqual(emailViewsFor(teammate).map((v) => v.id), ["write", "scheduled", "templates"]);
  });
  it("the section is read from and written to the address", () => {
    assert.equal(emailViewFromHash("#/email", emailViewsFor(admin)), "write");
    assert.equal(emailViewFromHash("#/email?view=sent", emailViewsFor(admin)), "sent");
    assert.equal(emailViewFromHash("#/email?view=sent", emailViewsFor(teammate)), "write", "an admin-only section falls back");
    assert.equal(emailViewFromHash("#/email?view=scheduled", emailViewsFor(teammate)), "scheduled");
    assert.equal(emailViewFromHash("#/email?view=history", emailViewsFor(admin)), "sent", "the old History id");
    assert.equal(emailViewFromHash("#/email?view=send", emailViewsFor(admin)), "write", "the old Send id");
    assert.equal(emailViewFromHash("#/email?view=__proto__", emailViewsFor(admin)), "write");
    assert.equal(emailViewHash("write"), "#/email");
    assert.equal(emailViewHash("templates"), "#/email?view=templates");
    assert.equal(emailViewHash("nope"), "#/email");
  });
});

describe("C-7 Later pickers (T24)", () => {
  it("09:00 in Africa/Lagos is stored as 08:00Z and listed as 09:00 Africa/Lagos", () => {
    const at = zonedLocalToUtc("2026-11-14", "09:00", "Africa/Lagos");
    assert.equal(at.toISOString(), "2026-11-14T08:00:00.000Z");
    assert.equal(formatInZone(at.toISOString(), "Africa/Lagos"), "Sat 14 Nov · 09:00");
    const label = scheduleLabel(at.toISOString(), "Africa/Lagos", "America/New_York");
    assert.deepEqual(label, { primary: "Sat 14 Nov · 09:00", zone: "Africa/Lagos", viewer: "Sat 14 Nov · 03:00 your time" });
    assert.equal(scheduleLabel(at.toISOString(), "Africa/Lagos", "Africa/Lagos").viewer, "");
    assert.deepEqual(utcToZonedInputs(at.toISOString(), "Africa/Lagos"), { date: "2026-11-14", time: "09:00" });
  });
  it("the same wall time in another zone is a different instant", () => {
    assert.equal(zonedLocalToUtc("2026-11-14", "09:00", "America/New_York").toISOString(), "2026-11-14T14:00:00.000Z");
    assert.equal(zonedLocalToUtc("2026-07-14", "09:00", "Europe/London").toISOString(), "2026-07-14T08:00:00.000Z");
  });
  it("past, too-soon, impossible and unknown-zone times are refused at submit", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    assert.equal(checkLaterTime({ date: "2026-11-10", time: "12:30", zone: "Africa/Lagos" }, now).ok, false, "12:30 Lagos is 11:30Z: past");
    assert.equal(checkLaterTime({ date: "2026-11-10", time: "13:00", zone: "Africa/Lagos" }, now).message, "Pick a time at least a minute from now.");
    assert.equal(checkLaterTime({ date: "2026-11-10", time: "13:02", zone: "Africa/Lagos" }, now).ok, true);
    assert.match(checkLaterTime({ date: "2026-03-08", time: "02:30", zone: "America/New_York" }, now).message, /doesn't exist/);
    assert.equal(checkLaterTime({ date: "2026-11-11", time: "09:00", zone: "Mars/Olympus" }, now).ok, false);
    assert.equal(checkLaterTime({ date: "", time: "09:00", zone: "UTC" }, now).ok, false);
    assert.equal(zonedLocalToUtc("2026-02-30", "09:00", "UTC"), null);
  });
});

describe("C-8 the Push composer's wording", () => {
  it("offers exactly the five approved screens, by their on-screen names", () => {
    assert.deepEqual(EXPLORER_DESTINATIONS.map((d) => d.label), ["Explore", "Discover", "Likes"]);
    assert.deepEqual(HOST_DESTINATIONS.map((d) => d.value), ["community", "home"]);
    assert.equal(opensLabel({ audience: "both", explorer_target: "discover", host_target: "home" }), "Explorer app: Discover · Host app: Home");
    assert.equal(opensLabel({ audience: "hosts", explorer_target: "discover", host_target: "community" }), "Host app: Community (Account, Support)");
  });
  it("reach: people for the review, rows paced 12 a minute", () => {
    const counts = { hosts: 49, explorers: 243, both: 243 };
    assert.deepEqual(pushReach("hosts", counts), { people: 49, rows: 49, minutes: 5 });
    assert.deepEqual(pushReach("explorers", counts), { people: 243, rows: 243, minutes: 21 });
    assert.deepEqual(pushReach("both", counts), { people: 243, rows: 292, minutes: 25 });
    assert.deepEqual(pushReach("hosts", null), { people: 0, rows: 0, minutes: 1 });
  });
  it("server refusals become plain words with the code kept", () => {
    const err = { code: "PT409", message: "already_sending" };
    assert.equal(communicationsErrorCode(err), "already_sending");
    assert.equal(communicationsErrorMessage(err), "This push already started sending, so it can't be changed. (already_sending)");
    assert.equal(communicationsErrorMessage({ code: "22023", message: "scheduled_time_past" }), `${COMMUNICATIONS_ERROR_COPY.scheduled_time_past} (scheduled_time_past)`);
    assert.equal(communicationsErrorMessage({ code: "XX000", message: "boom" }), "The server didn't accept that. boom (XX000)");
    assert.equal(communicationsErrorMessage(null), "The server didn't accept that.");
  });
  it("Needs attention says what went wrong", () => {
    assert.match(attentionWords({ problem: "late" }), /five minutes ago/);
    assert.equal(attentionWords({ problem: "push_failed", detail: { push_failed: 2, inapp_delivered: 49 } }), "2 phones did not accept the push. 49 bell items landed.");
    assert.equal(attentionWords({ problem: "failed", detail: "forced" }), "It did not go out: forced.");
    assert.equal(cancelKindLabel("roadmap_notice"), "notice");
  });
});

describe("C-9 the screens and the server", () => {
  const SERVICE = read("services/communicationsService.js");
  it("every issue_4383 RPC the migration grants to authenticated has one service call", () => {
    const sql = fs.readFileSync(path.join(SRC, "../../supabase/migrations/20280608004383_issue_4383_communications_scheduling.sql"), "utf8");
    const granted = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(issue_4383_[a-z_]+)\([^)]*\) TO authenticated;/g)].map((m) => m[1])
      .filter((name) => !["issue_4383_push_deep_link", "issue_4383_check_schedule"].includes(name));
    for (const name of granted) assert.match(SERVICE, new RegExp(`supabase\\.rpc\\("${name}"`), name);
  });
  it("Push, Announcements and Roadmap check a Later time in its zone at submit", () => {
    const push = read("pages/communications/PushPage.jsx");
    assert.ok((push.match(/checkLaterTime\(form\.later\)/g) || []).length >= 2, "checked at review and again at confirm");
    assert.match(read("components/community/AnnouncementsPanel.jsx"), /checkLaterTime\(editor\.later\)/);
    assert.match(read("components/community/RoadmapPanel.jsx"), /checkLaterTime\(goLive\.later\)/);
    assert.match(read("components/community/RoadmapPanel.jsx"), /checkLaterTime\(notifyLater\)/);
  });
  it("every load has an error state with Retry, and no load error is swallowed", () => {
    for (const file of ["pages/communications/PushPage.jsx", "pages/communications/CommunicationsOverviewPage.jsx", "components/community/AnnouncementsPanel.jsx", "components/community/RoadmapPanel.jsx"]) {
      const src = read(file);
      assert.match(src, /<LoadError/, file);
      assert.equal(/catch\s*\(\)\s*\{\s*\}/.test(src), false, `${file}: empty catch`);
    }
  });
  it("Review shows To, Apps, Opens and When before anything sends", () => {
    const push = read("pages/communications/PushPage.jsx");
    for (const term of [">To<", ">Apps<", ">Opens<", ">When<", "Send test to me", "Review and send", "Review and schedule"]) assert.ok(push.includes(term), term);
  });
});

describe("C-10 scheduled emails (Wave 3)", () => {
  const PAGE = read("pages/EmailPage.jsx");
  const COMPOSER = read("components/email/EmailComposer.jsx");
  it("the Scheduled section lists every scheduled email with Change time, Edit and Cancel", () => {
    assert.match(PAGE, /activeSubTab === "scheduled" && \(\s*<ScheduledSubView/);
    assert.match(PAGE, /await listScheduledEmails\(\)/);
    for (const action of ["reschedule_campaign", "get_scheduled_campaign", "cancel_campaign"]) assert.ok(PAGE.includes(`action: "${action}"`), action);
    for (const words of ["Change time", ">Edit<", ">Cancel<", "Started sending", "(counted ", "To change who gets it, cancel and write a new email."]) assert.ok(PAGE.includes(words), words);
    assert.match(PAGE, /const check = checkLaterTime\(moving\.later\);/);
    assert.match(PAGE, /<LoadError title="Couldn't load scheduled emails"/);
  });
  it("the composer's edit mode changes only the words, through update_scheduled_campaign", () => {
    assert.match(COMPOSER, /editingCampaign = null, onEditingDone = null/);
    assert.match(COMPOSER, /action: "update_scheduled_campaign",/);
    assert.match(COMPOSER, /if \(editingCampaign\) return;\n\s+const legacy = legacyDraftToMigrate/);
    assert.match(COMPOSER, /The audience was counted when this email was scheduled and stays the same\./);
  });
});

describe("C-11 tester rework (P2-3, P3-1, P3-3)", () => {
  it("an unexpected error is worded once, with its code once", () => {
    const network = new CommunicationsError({ message: "TypeError: Failed to fetch" });
    assert.equal(communicationsErrorMessage(network), "The server didn't accept that. TypeError: Failed to fetch");
    const server = new CommunicationsError({ code: "XX000", message: "mock failure" });
    const words = communicationsErrorMessage(server);
    assert.equal(words, "The server didn't accept that. mock failure (XX000)");
    assert.equal(words.split("The server didn't accept that.").length - 1, 1);
    assert.equal(words.split("(XX000)").length - 1, 1);
    assert.equal(communicationsErrorMessage(new CommunicationsError({ code: "PT409", message: "already_sending" })),
      "This push already started sending, so it can't be changed. (already_sending)");
    assert.deepEqual(server.raw, { code: "XX000", message: "mock failure" });
  });
  it("the pickers offer only zones the database accepts", () => {
    assert.ok(SERVER_TIME_ZONES.includes("Africa/Lagos") && SERVER_TIME_ZONES.includes("UTC"));
    assert.equal(SERVER_TIME_ZONES.includes("America/Coyhaique"), false, "newer than the database's tzdata");
    assert.equal(isValidTimeZone("America/Coyhaique"), false);
    assert.equal(isValidTimeZone("Africa/Lagos"), true);
    for (const zone of timeZoneOptions(["America/Coyhaique", "Mars/Olympus"])) assert.ok(SERVER_TIME_ZONES.includes(zone), zone);
  });
  it("each audience button has an accessible name", () => {
    assert.match(read("pages/communications/PushPage.jsx"), /aria-label=\{`\$\{a\.label\}\$\{n === null \? "" : `, \$\{n\} people`\}/);
  });
});
