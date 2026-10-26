// Issue #4130 (Wave 4b) — Place pool, Ads, Team and roles, Platform health,
// Feature flags and Settings in Mingla Admin.
//
//   1. Place pool's funnel is honest: every share is of ACTIVE places (the old
//      "Judged 40%" was the visible share; "Photo coverage 100%" counted
//      visible places only); a failed load is never zeros; "Scored" can't go
//      over 100%; each city says whether it is ready to launch; going live asks.
//   2. Platform health: problems first; a balance is judged against the
//      provider's own alert line; Paystack's kobo are shown as naira; Stripe
//      mode says "agree" only when every check is confirmed; queue health says
//      "not set up in production yet" when its function is missing.
//   3. Feature flags change only through the server, with a reason, from a
//      drawer; Settings has no flags, no Integrations and no one-click
//      "reset everyone"; the danger zone is the owner's, behind RESTART.
//   4. Team and roles: one table with tabs, Careers inside, last active.
//   5. Ads: plain words, campaigns first, results labelled "not proven".
//   6. Every old address still lands on its page and tab.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLACE_POOL_TABS,
  PLATFORM_HEALTH_SECTIONS,
  SETTINGS_SECTIONS,
  TEAM_TABS,
  canChangeFlag,
  canRestartTour,
  cityReadiness,
  flagChange,
  flagIssue,
  isMissingFunctionError,
  lastActiveLabel,
  placeFunnelSteps,
  placePoolTabFor,
  platformProblems,
  providerBalance,
  providerStatus,
  sectionFor,
  sortProviders,
  stageShare,
  stripeModeVerdict,
  tabFor,
  teamGroups,
} from "../lib/systemPages.js";
import { redirectHash, RETIRED_PAGE_REDIRECTS } from "../lib/adminRoutes.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("#4130 W4b-1: Place pool", () => {
  it("every funnel share is of active places, as production measured it", () => {
    const steps = placeFunnelSteps({ active: 88364, checked: 62663, visible: 35250, with_photos: 40133 });
    assert.deepEqual(
      steps.map((s) => [s.label, s.count, s.share]),
      [
        ["Active places", 88364, 100],
        ["Checked by Bouncer", 62663, 71],
        ["Explorers can see", 35250, 40],
        ["Have stored photos", 40133, 45],
      ]
    );
  });
  it("a funnel that did not load is not zeros", () => {
    assert.equal(placeFunnelSteps(null), null);
    assert.equal(placeFunnelSteps({ error: "x" }), null);
    const page = read("pages/PlacePoolPage.jsx");
    assert.ok(page.includes('<LoadError title="Couldn\'t load the place counts"'));
  });
  it("the place counts come from the server aggregate, never a client count", () => {
    const service = read("services/systemPagesService.js");
    assert.ok(service.includes('call("admin_place_pool_funnel"'));
    const page = stripComments(read("pages/PlacePoolPage.jsx"));
    assert.equal(/supabase|from\(|\.rpc\(/.test(page), false, "the page goes through the service");
    assert.equal(/render\/image/.test(page + service), false, "no image transformations");
  });
  it("the old wrong cards are gone", () => {
    const old = stripComments(read("pages/PlacePoolManagementPage.jsx"));
    assert.equal(/Bouncer Judged|label="Photo Coverage"|function OverviewTab/.test(old), false);
  });
  it('"Scored" never goes over 100%; the extra is said, not shown as a share', () => {
    const lagos = stageShare(1140, 1000);
    assert.equal(lagos.pct, 100);
    assert.equal(lagos.done, 1000);
    assert.equal(lagos.extra, 140);
    assert.match(lagos.label, /^1,000 \/ 1,000 \(100%\) · 140 more no longer visible$/);
    assert.equal(stageShare(500, 1000).pct, 50);
    assert.ok(read("pages/SignalLibraryPage.jsx").includes("const { pct, label } = stageShare(done, total);"));
  });
  it("each city says where it stands", () => {
    assert.equal(cityReadiness({ is_live_for_consumers: true, is_servable_places: 900 }).label, "Live");
    assert.equal(cityReadiness({ is_live_for_consumers: false, is_servable_places: 1205, total_active_places: 3000 }).label, "Ready to launch");
    assert.equal(cityReadiness({ is_live_for_consumers: false, is_servable_places: 0, total_active_places: 40 }).key, "checking");
    assert.equal(cityReadiness({ is_live_for_consumers: false, is_servable_places: 0, total_active_places: 0 }).label, "Not seeded");
  });
  it("going live asks first: the switch opens a confirmation, which makes the change", () => {
    const page = read("pages/LaunchCitiesPage.jsx");
    assert.ok(page.includes("onChange={() => setConfirmCity(row)}"));
    assert.ok(page.includes("if (row) handleToggleLive(row);"));
    assert.equal(/onChange=\{\(\) => handleToggleLive\(row\)\}/.test(page), false);
  });
  it("the Deck tuner is the place's score override", () => {
    const modal = read("pages/PlacePoolManagementPage.jsx");
    assert.ok(modal.includes("<PlaceScoreOverride place={place} />"));
    assert.ok(read("components/placePool/PlaceScoreOverride.jsx").includes("<ScoreTunerPanel"));
  });
});

describe("#4130 W4b-2: Platform health", () => {
  const twilio = {
    service_key: "twilio",
    display_name: "Twilio",
    sort_order: 53,
    depletion_signal: { balance: { warn: 25, crit: 5, unit: "USD" } },
    layers: { synthetic: { status: "healthy", detail: { balance: 6.67, currency: "USD" }, checked_at: "2026-10-26T20:00:00Z" } },
  };
  const paystack = {
    service_key: "paystack",
    display_name: "Paystack",
    sort_order: 11,
    depletion_signal: { processor: { balance_display_only: true } },
    layers: { synthetic: { status: "healthy", detail: { balance: 12125200, currency: "NGN" }, checked_at: "2026-10-26T20:00:00Z" } },
  };
  const giphy = { service_key: "giphy", display_name: "Giphy", sort_order: 43, layers: {} };
  const stripe = { service_key: "stripe", display_name: "Stripe", sort_order: 10, layers: { synthetic: { status: "healthy", detail: { balance: 0, currency: "usd" } } } };

  it("a balance is judged against the provider's own alert line", () => {
    const b = providerBalance(twilio);
    assert.equal(b.text, "$6.67");
    assert.equal(b.line, "$25.00");
    assert.equal(b.low, true);
    assert.equal(providerStatus(twilio).label, "Low balance");
  });
  it("Paystack reports kobo; the page shows naira", () => {
    assert.equal(providerBalance(paystack).text, "₦121,252.00");
    assert.equal(providerBalance(paystack).low, false);
  });
  it("problems come first, then never-checked providers", () => {
    const problems = platformProblems({ services: [stripe, paystack, giphy, twilio], queue: { missing: true } });
    assert.deepEqual(problems.map((p) => p.key), ["queue", "twilio", "never-checked"]);
    assert.equal(problems[0].badge, "Not set up");
    assert.match(problems[2].title, /^Giphy has never been checked$/);
    assert.deepEqual(sortProviders([stripe, giphy, twilio]).map((s) => s.service_key), ["twilio", "giphy", "stripe"]);
  });
  it('Stripe mode says "agree" only when every check is confirmed', () => {
    const ok = { status: "ok", mode: "live" };
    const unsure = { status: "unverifiable" };
    const v = stripeModeVerdict([ok, unsure, unsure]);
    assert.equal(v.state, "unconfirmed");
    assert.equal(v.title, "Live mode · 1 of 3 checks confirmed");
    assert.equal(stripeModeVerdict([ok, ok, ok]).state, "aligned");
    assert.equal(stripeModeVerdict([ok, { status: "ok", mode: "test" }, ok]).state, "misaligned");
    assert.equal(stripeModeVerdict([{ status: "error" }, unsure, unsure]).state, "misaligned");
    const code = stripComments(read("pages/PlatformHealthPage.jsx") + read("lib/stripeModeSignals.js"));
    assert.equal(/RUNBOOK|github\.com\/sethogieva/.test(code), false, "the dead runbook link is gone");
  });
  it('queue health says "not set up in production yet" when its function is missing', () => {
    assert.equal(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function public.admin_get_queue_health(p_hours)" }), true);
    assert.equal(isMissingFunctionError({ code: "42883" }), true);
    assert.equal(isMissingFunctionError({ code: "42501", message: "not_authorized" }), false);
    assert.equal(isMissingFunctionError(null), false);
    const queue = read("pages/QueueHealthPage.jsx");
    assert.ok(queue.includes("if (isMissingFunctionError(err)) {"));
    assert.ok(queue.includes("Queue health is not set up in production yet"));
    assert.ok(read("services/queueHealthService.js").includes("err.code = error.code;"));
  });
});

describe("#4130 W4b-3: Feature flags and Settings", () => {
  it("a flag changes only through the server, with a reason, from a drawer", () => {
    assert.equal(canChangeFlag(""), false);
    assert.equal(canChangeFlag("   "), false);
    assert.equal(canChangeFlag("Lagos launch"), true);
    assert.deepEqual(flagChange({ flag_key: "x", is_enabled: true }).button, "Turn off…");
    assert.equal(flagIssue({ description: "Brand circle (#1777)" }), "1777");
    assert.equal(flagIssue({ description: "No issue" }), "");
    const page = stripComments(read("pages/FeatureFlagsPage.jsx"));
    assert.ok(page.includes("await setFeatureFlag(changing.flag_key, change.next, reason.trim())"));
    assert.ok(page.includes("<Drawer"));
    assert.equal(/<Toggle|from\("feature_flags"\)|\.delete\(/.test(page), false, "no one-click toggle, no browser write");
  });
  it("Settings: no flags, no Integrations, no browser-wide profile update", () => {
    const settings = stripComments(read("pages/SettingsPage.jsx"));
    assert.equal(/feature_flags|integrations|IntegrationsView|FeatureFlagsView/.test(settings), false);
    assert.equal(/\.neq\("coach_mark_step"/.test(settings), false, "reset-all no longer runs from the browser");
    assert.ok(settings.includes("await restartTourForEveryone(typed, resetReason.trim())"));
    assert.ok(settings.includes("{isOwner && ("), "the danger zone is the owner's");
    assert.ok(settings.includes("<TeamAutomationSettings online={online} />"), "Automatic steps moved here");
    assert.equal(fs.existsSync(path.join(SRC, "components/placeIntelligenceTrial/SignalAnchorsTab.jsx")), false);
  });
  it("restarting the tour for everyone needs the exact word and a reason", () => {
    assert.equal(canRestartTour("RESTART", "new tour"), true);
    assert.equal(canRestartTour("restart", "new tour"), false);
    assert.equal(canRestartTour("RESTART", " "), false);
  });
});

describe("#4130 W4b-4: Team and roles", () => {
  const owner = { status: "active", areas: ["admin_console", "team_manage"] };
  it("the team tabs are the owner's; Careers is anyone's who could open Careers", () => {
    assert.deepEqual(TEAM_TABS.map((t) => `${t.id}:${t.hosts}`), ["team:admin", "invited:admin", "removed:admin", "careers:careers"]);
    const page = read("pages/AdminPage.jsx");
    assert.ok(page.includes('const canTeam = canOpenOwnPage(access, "admin");'));
    assert.ok(page.includes('const canCareers = canOpenOwnPage(access, "careers");'));
    assert.ok(page.includes('(t.hosts === "careers" ? canCareers : canTeam)'));
    assert.ok(owner);
  });
  it("one table split by status, with last active", () => {
    const g = teamGroups([{ status: "active" }, { status: "invited" }, { status: "revoked" }, { status: "revoked" }]);
    assert.deepEqual([g.team.length, g.invited.length, g.removed.length], [1, 1, 2]);
    const now = Date.parse("2026-10-26T12:00:00Z");
    assert.equal(lastActiveLabel("2026-10-26T11:58:00Z", now), "now");
    assert.equal(lastActiveLabel("2026-10-23T12:00:00Z", now), "3d ago");
    assert.equal(lastActiveLabel(null, now), "–");
    const page = read("pages/AdminPage.jsx");
    assert.ok(page.includes("<th scope=\"col\" className=\"px-3 py-2.5\">Last active</th>"));
    assert.ok(page.includes('<Drawer open={inviteOpen}'), "Invite is a drawer");
  });
});

describe("#4130 W4b-5: Ads", () => {
  const ads = read("pages/AdEnginePage.jsx");
  it("plain words: no 'not observed', campaigns first, results not proven", () => {
    assert.equal(/not observed|Status observed/.test(ads), false);
    assert.ok(/const ADS_TABS = \[\n  \{ id: "campaigns"/.test(ads));
    assert.ok(ads.includes('?? "campaigns";'));
    assert.ok(ads.includes('<Badge variant="warning">Not proven</Badge>'));
  });
});

describe("#4130 W4b-6: old addresses land on their page and tab", () => {
  it("each redirect into these pages names a tab or section that exists", () => {
    const pages = {
      placepool: (t) => PLACE_POOL_TABS.some((x) => x.id === placePoolTabFor(t)) && placePoolTabFor(t) !== "overview",
      "platform-health": (t) => sectionFor(PLATFORM_HEALTH_SECTIONS, t) === t,
      settings: (t) => sectionFor(SETTINGS_SECTIONS, t) === t,
      admin: (t) => tabFor(TEAM_TABS, t) === t,
    };
    let checked = 0;
    for (const [id, { page, tab }] of Object.entries(RETIRED_PAGE_REDIRECTS)) {
      if (!Object.hasOwn(pages, page)) continue;
      assert.ok(pages[page](tab), `${id} -> ${page}?tab=${tab}`);
      checked += 1;
    }
    assert.equal(checked, 8);
    assert.equal(redirectHash("#/deck-tuner"), "#/placepool?tab=browse");
    assert.equal(placePoolTabFor("places"), "browse");
    assert.equal(placePoolTabFor("nonsense"), "overview");
  });
  it("App draws the built pages, not hubs or placeholders", () => {
    const app = read("App.jsx");
    for (const line of [
      "placepool: PlacePoolPage,",
      "admin: AdminPage,",
      '"platform-health": PlatformHealthPage,',
      '"feature-flags": FeatureFlagsPage,',
      "settings: SettingsPage,",
    ]) assert.ok(app.includes(line), line);
  });
});
