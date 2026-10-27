// Issue #4130 (final rework after the retest) — each finding pinned so that
// reverting the fix turns this suite red.
//
//   F-2  Global Plus has one write path: Settings shows global_plus_access
//        read-only and links to Subscriptions (the server-side refusal of a
//        direct table write is pinned in the Wave 2b pg17 suite, §10).
//   F-3a Subscriptions tiles leave out staff and test when the list does, and
//        say how many (server counts pinned in the Wave 2b pg17 suite, §9).
//   F-3b Competitor watch: plain words for the stop reasons; no "Settings
//        version", no Watch ID / Brand ID columns.
//   F-3c Data room months read "Oct 2026", never "Oct 26".
//   F-3d Ads: "Edge Function returned a non-2xx status code" is never shown.
//   F-3e A negative amount after another currency reads "₦150.00 − $0.01".
//   F-3f Reason labels name their inputs (htmlFor / id).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADS_SERVICE_DOWN,
  adsErrorWords,
  appConfigLock,
  safeReasonWords,
} from "../lib/systemPages.js";
import { tilesScopeNote } from "../lib/subscriptionsView.js";
import { monthLabel } from "../lib/dataRoomAnalytics.js";
import { joinMoneyAmounts } from "../lib/moneyFormat.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const ROOT = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("F-2 Global Plus is read-only in Settings", () => {
  it("global_plus_access is locked and points at Subscriptions; other keys are not", () => {
    assert.deepEqual({ ...appConfigLock("global_plus_access") }, { href: "#/subscriptions", label: "Change it in Subscriptions" });
    assert.equal(appConfigLock("pairing_daily_limit"), null);
    assert.equal(appConfigLock("__proto__"), null, "inherited names are not locks");
    assert.equal(appConfigLock(undefined), null);
  });

  it("the Settings row for a locked key has no edit or delete, and the writes refuse it", () => {
    const page = strip(read("pages/SettingsPage.jsx"));
    assert.match(page, /\{appConfigLock\(cfg\.key\) \? \(\s*<a href=\{appConfigLock\(cfg\.key\)\.href\}/);
    // The edit and delete buttons sit only in the unlocked branch.
    const lockedBranch = page.slice(page.indexOf("{appConfigLock(cfg.key) ? ("), page.indexOf(") : (", page.indexOf("{appConfigLock(cfg.key) ? (")));
    assert.ok(!/icon=\{Edit3\}|icon=\{Trash2\}/.test(lockedBranch), "a locked row offers edit or delete");
    assert.match(page, /const handleSaveEdit = async \(\) => \{\s*if \(appConfigLock\(editing\?\.key\)\)/);
    assert.match(page, /const handleDelete = async \(cfg\) => \{\s*if \(appConfigLock\(cfg\?\.key\)\)/);
    assert.match(page, /if \(appConfigLock\(newConfig\.key\.trim\(\)\)\)/);
  });

  it("the server refuses a direct write to the key (trigger in the Wave 2b migration)", () => {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20280112004130_issue_4130_messaging_limits_and_subscriptions.sql"), "utf8");
    assert.match(sql, /CREATE TRIGGER issue_4130_guard_global_plus_config\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.app_config/);
    assert.match(sql, /current_user IN \('anon', 'authenticated', 'service_role'\)/);
    const fn = sql.slice(sql.indexOf("FUNCTION public.issue_4130_guard_global_plus_config()"));
    assert.ok(!/SECURITY DEFINER/.test(fn.slice(0, fn.indexOf("$function$;"))), "the guard must see the caller's role");
  });
});

describe("F-3a Subscriptions tiles follow the list's staff/test toggle", () => {
  it("the note says how many the tiles leave out", () => {
    assert.equal(tilesScopeNote({ internal_hidden: 4, show_internal: false }), "Counts leave out 4 staff and test accounts, as the list does.");
    assert.equal(tilesScopeNote({ internal_hidden: 1, show_internal: false }), "Counts leave out 1 staff and test account, as the list does.");
    assert.equal(tilesScopeNote({ internal_hidden: 0, show_internal: false }), "");
    assert.equal(tilesScopeNote({ internal_hidden: 0, show_internal: true }), "Counts include staff and test accounts.");
    assert.equal(tilesScopeNote(null), "");
  });

  it("the page asks for the tiles with the list's toggle and shows the note", () => {
    const service = strip(read("services/subscriptionsService.js"));
    assert.match(service, /rpc\("admin_subscription_overview", \{ p_show_internal: showInternal === true \}\)/);
    const page = strip(read("pages/SubscriptionManagementPage.jsx"));
    assert.match(page, /getSubscriptionOverview\(\{ showInternal \}\)/);
    assert.match(page, /setOverviewLoading\(false\);\s*\}\s*\}, \[showInternal\]\);/, "the tiles reload when the toggle flips");
    assert.match(page, /tilesScopeNote\(overview\)/);
  });

  it("the overview RPC leaves staff and test out unless asked", () => {
    const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/20280112004130_issue_4130_messaging_limits_and_subscriptions.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_subscription_overview("));
    const body = fn.slice(0, fn.indexOf("$function$;"));
    assert.match(body, /admin_subscription_overview\(p_show_internal boolean DEFAULT false\)/);
    assert.match(body, /WHERE COALESCE\(p_show_internal, false\) OR NOT e\.internal/);
    assert.match(body, /'internal_hidden'/);
  });
});

describe("F-3b Competitor watch in plain words", () => {
  it("stop reasons are words, never codes", () => {
    for (const code of ["meta_not_ready", "rollout_disabled", "link_only", "rate_limited", "some_new_code"]) {
      const words = safeReasonWords(code);
      assert.ok(words && !words.includes("_"), `${code} → ${words}`);
    }
    assert.equal(safeReasonWords("meta_not_ready"), "Waiting for Instagram access from Meta");
    assert.equal(safeReasonWords("rollout_disabled"), "Not switched on yet");
    assert.equal(safeReasonWords("some_new_code"), "Some new code");
    assert.equal(safeReasonWords(null), "");
    assert.equal(safeReasonWords("toString"), "ToString", "inherited names fall through to words");
  });

  it("the panel shows the words, and no settings version or raw ids", () => {
    const page = strip(read("pages/ToolLeadsPage.jsx"));
    const panel = page.slice(page.indexOf("export function CompetitorOpsPanel"));
    assert.ok(!/Settings version/.test(panel), "Settings version is still shown");
    assert.ok(!/key: "watch_id"|key: "brand_id"/.test(panel), "Watch ID / Brand ID columns are still shown");
    assert.match(panel, /\{safeReasonWords\(cap\.safe_reason\)\}/);
    assert.match(panel, /key: "safe_reason", label: "Why it stopped", render: \(v\) => safeReasonWords\(v\)/);
  });
});

describe("F-3c Data room months", () => {
  it("read 'Oct 2026', never 'Oct 26'", () => {
    assert.equal(monthLabel("2026-10"), "Oct 2026");
    assert.ok(!/ 26$/.test(monthLabel("2026-10")));
    assert.match(monthLabel("2027-01"), /^Jan 2027$/);
  });
});

describe("F-3d Ads errors in plain words", () => {
  it("the generic edge error becomes a sentence; a real reason is kept", () => {
    assert.equal(adsErrorWords("Edge Function returned a non-2xx status code", "The campaign list could not load."), ADS_SERVICE_DOWN);
    assert.equal(adsErrorWords("", "The campaign list could not load."), "The campaign list could not load.");
    assert.equal(adsErrorWords(undefined, "The review queue could not load."), "The review queue could not load.");
    assert.equal(adsErrorWords("Meta token expired"), "Meta token expired");
    assert.ok(!/non-2xx/.test(ADS_SERVICE_DOWN));
  });

  it("the Campaigns page routes every load error through the plain words", () => {
    const page = strip(read("pages/CampaignsPage.jsx"));
    const load = page.slice(page.indexOf("const load = useCallback(async () => {"), page.indexOf("setBrandNames(await resolveAdBrandNames"));
    assert.ok(!/description: error\.message,/.test(load), "raw error.message in the campaign list toast");
    assert.equal((load.match(/adsErrorWords\(/g) || []).length, 6);
  });
});

describe("F-3e money across currencies", () => {
  it("a negative amount after another reads with a minus sign, never '+ -'", () => {
    assert.equal(joinMoneyAmounts([{ cents: 15000, currency: "NGN" }, { cents: -1, currency: "USD" }]), "₦150.00 − $0.01");
    assert.equal(joinMoneyAmounts([{ cents: -1, currency: "USD" }, { cents: 15000, currency: "NGN" }]), "−$0.01 + ₦150.00");
    assert.equal(joinMoneyAmounts([{ cents: 250, currency: "USD" }, { cents: 400, currency: "GBP" }]), "$2.50 + £4.00");
    assert.equal(joinMoneyAmounts([]), "");
    assert.ok(!/\+ -/.test(joinMoneyAmounts([{ cents: 1, currency: "NGN" }, { cents: -5, currency: "USD" }])));
  });

  it("Mingla money and the Data room use it", () => {
    assert.match(strip(read("pages/MinglaMoneyPage.jsx")), /return joinMoneyAmounts\(parts\) \|\|/);
    const overview = strip(read("components/dataRoom/DataRoomOverview.jsx"));
    assert.match(overview, /joinMoneyAmounts\(profit\)/);
    assert.ok(!/profit\.map\(\(p\) => formatMoneyMinor\(p\.cents, p\.currency\)\)\.join\(" \+ "\)/.test(overview));
  });
});

describe("F-3f reason labels name their inputs", () => {
  let render;
  before(async () => {
    let esbuild;
    try {
      esbuild = await import("esbuild");
    } catch {
      assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
    }
    const harness = `
import { renderToStaticMarkup } from "react-dom/server";
import { Input, Textarea } from "../components/ui/Input.jsx";
export function render(kind, props) { const C = kind === "textarea" ? Textarea : Input; return renderToStaticMarkup(<C {...props} />); }
`;
    const out = await esbuild.build({
      stdin: { contents: harness, resolveDir: HERE, sourcefile: "input.harness.jsx", loader: "jsx" },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "issue4130-input-")), "harness.mjs");
    fs.writeFileSync(file, out.outputFiles[0].text);
    ({ render } = await import(pathToFileURL(file).href));
  });

  for (const kind of ["input", "textarea"]) {
    it(`${kind}: the label's for= is the field's id`, () => {
      const html = render(kind, { label: "Reason (saved with your name)", value: "", onChange: () => {} });
      const forId = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
      const fieldId = html.match(new RegExp(`<${kind}[^>]*id="([^"]+)"`))?.[1];
      assert.ok(forId, `label has no for=: ${html}`);
      assert.equal(forId, fieldId);
      const own = render(kind, { label: "Reason", id: "grant-reason", value: "", onChange: () => {} });
      assert.match(own, /<label[^>]*for="grant-reason"/);
      assert.match(own, new RegExp(`<${kind}[^>]*id="grant-reason"`));
    });
  }

  it("the two reason boxes the retest named are that Input", () => {
    assert.match(read("pages/SubscriptionManagementPage.jsx"), /<Input\s+label="Reason for removing it \(logged on the server with your name\)"/);
    assert.match(read("components/pricing/MessagingLimitsPanel.jsx"), /<Input\s+label="Reason \(saved with your name\)"/);
  });
});
