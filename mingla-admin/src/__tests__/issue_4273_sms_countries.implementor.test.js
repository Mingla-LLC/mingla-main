// Issue #4273 (country switches) — implementor happy path for Admin › System ›
// SMS countries.
//
//   A  the pure words (lib/smsCountries.js): country names, prices, senders,
//      registration, what blocks turning on, every RPC error in plain English
//      (a stale write included), the marketing sender line
//   B  the save plan: OFF first, readiness, ON last; a blocked ON
//   C  wiring: the menu puts SMS countries right after Feature flags in
//      System; App draws SmsCountriesPage; the services call the three RPCs
//   D  the page gates on owner/admin BEFORE any server call: rendered with a
//      stubbed auth and service, the partner sees "Owner and admins only" and
//      the service is never called; the owner gets the board
//
// Run: node --test src/__tests__/issue_4273_sms_countries.implementor.test.js
// (from mingla-admin; D builds the real page with esbuild: run `npm ci` first).
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS } from "../lib/constants.js";
import {
  blockedWords,
  countryName,
  formatSmsPrice,
  marketingSenderWords,
  planSmsCountryChange,
  prospectiveBlock,
  reasonOk,
  registrationLabel,
  senderChangeable,
  senderLabel,
  smsCountryErrorWords,
} from "../lib/smsCountries.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GB = {
  country: "GB",
  marketingEnabled: false,
  sender: "marketing_service",
  registrationRequired: false,
  registrationDoneAt: null,
  price: { provider: "twilio", currency: "USD", minorNumerator: 560, minorDenominator: 100, fetchedAt: "2026-11-09T06:17:00Z" },
  blockedReason: null,
  updatedAt: "2026-11-09T08:00:00.123456+00:00",
};
const IE = { ...GB, country: "IE", registrationRequired: true, blockedReason: "registration_pending" };
const BE = { ...GB, country: "BE", sender: "needs_local_number", blockedReason: "needs_local_number" };
const CA = { ...GB, country: "CA", sender: "toll_free", price: null, blockedReason: "unpriced" };

describe("#4273 A: the words", () => {
  it("names countries and prices", () => {
    assert.equal(countryName("GB"), "United Kingdom");
    assert.equal(countryName("ng"), "Nigeria");
    assert.equal(formatSmsPrice(GB.price), "$0.0560 per text");
    assert.equal(formatSmsPrice({ currency: "NGN", minorNumerator: 500, minorDenominator: 1 }), "₦5.00 per text");
    assert.equal(formatSmsPrice(null), "No price yet");
    assert.equal(formatSmsPrice({ currency: "USD", minorNumerator: 0, minorDenominator: 1 }), "No price yet");
  });
  it("names senders and registration", () => {
    assert.equal(senderLabel("toll_free"), "Toll-free number (+1)");
    assert.equal(senderLabel("marketing_service"), "Mingla (letters)");
    assert.equal(senderLabel("termii"), "Termii");
    assert.equal(senderLabel("needs_local_number"), "Needs a local number");
    assert.equal(registrationLabel(GB), "Not needed");
    assert.equal(registrationLabel(IE), "Needed, not done");
    assert.equal(registrationLabel({ ...IE, registrationDoneAt: "2026-11-09T10:00:00Z" }), "Done 9 Nov 2026");
  });
  it("says what blocks turning on", () => {
    assert.equal(blockedWords("needs_local_number"), "Add a local number in Twilio first.");
    assert.equal(blockedWords("registration_pending"), 'Register "Mingla" with Twilio first.');
    assert.equal(blockedWords("unpriced"), "No price yet.");
    assert.equal(blockedWords(null), null);
  });
  it("puts every RPC error in plain English", () => {
    const cases = {
      sms_country_switch_stale: "Someone changed this country just now. Reload and try again.",
      not_authorized: "Only the owner and admins can change SMS countries.",
      sms_country_needs_local_number: "Add a local number in Twilio first.",
      sms_country_registration_pending: 'Register "Mingla" with Twilio first, then mark it done here.',
      sms_country_unpriced: "This country has no SMS price yet, so it can't be turned on.",
      reason_required: "Add a reason first.",
      unknown_country: "That country isn't one Mingla can text. Reload the page.",
      state_required: "Choose on or off.",
      no_change: "Nothing changed: it's already set that way.",
      registration_not_required: "This country doesn't need its sender registered.",
      sender_not_changeable: "This country's sender can't be changed here.",
      switch_off_first: "Turn marketing texts off for this country first.",
    };
    for (const [code, words] of Object.entries(cases)) {
      assert.equal(smsCountryErrorWords({ message: code }), words, code);
    }
    // A stale write is recognised by its SQLSTATE too.
    assert.equal(smsCountryErrorWords({ code: "PT409", message: "" }), cases.sms_country_switch_stale);
    assert.equal(smsCountryErrorWords({ code: "42501", message: "" }), cases.not_authorized);
    assert.equal(smsCountryErrorWords({ message: "socket hang up" }), "Something went wrong saving that. Try again.");
  });
  it("shows the marketing sender with the SID shortened", () => {
    assert.equal(
      marketingSenderWords({ sid: "MG9d42785c51834395018b52144736b9a7", label: "Mingla Marketing" }),
      "Mingla Marketing (MG9d…b9a7)",
    );
    assert.equal(marketingSenderWords(null), "not set");
    assert.equal(reasonOk("  "), false);
    assert.equal(reasonOk("UK first"), true);
  });
});

describe("#4273 B: the save plan", () => {
  it("turns a ready country on in one step", () => {
    assert.deepEqual(planSmsCountryChange(GB, { on: true, sender: "marketing_service" }), {
      steps: [{ kind: "switch", on: true }],
      blocked: null,
    });
  });
  it("marks registration done BEFORE turning on, and blocks on without it", () => {
    assert.deepEqual(planSmsCountryChange(IE, { on: true, registrationDone: true, sender: "marketing_service" }), {
      steps: [{ kind: "readiness", registrationDone: true }, { kind: "switch", on: true }],
      blocked: null,
    });
    assert.equal(planSmsCountryChange(IE, { on: true, registrationDone: false }).blocked, "registration_pending");
  });
  it("turns OFF before undoing readiness", () => {
    const on = { ...IE, marketingEnabled: true, registrationDoneAt: "2026-11-09T10:00:00Z" };
    assert.deepEqual(planSmsCountryChange(on, { on: false, registrationDone: false, sender: "marketing_service" }).steps, [
      { kind: "switch", on: false },
      { kind: "readiness", registrationDone: false },
    ]);
  });
  it("a local number unblocks Belgium; Canada stays blocked without a price; US/CA/NG senders never change", () => {
    assert.equal(prospectiveBlock(BE, { sender: "needs_local_number" }), "needs_local_number");
    assert.deepEqual(planSmsCountryChange(BE, { on: true, sender: "marketing_service" }), {
      steps: [{ kind: "readiness", sender: "marketing_service" }, { kind: "switch", on: true }],
      blocked: null,
    });
    assert.equal(planSmsCountryChange(CA, { on: true }).blocked, "unpriced");
    assert.equal(senderChangeable("US"), false);
    assert.equal(senderChangeable("ng"), false);
    assert.equal(senderChangeable("GB"), true);
    assert.deepEqual(planSmsCountryChange({ ...CA, country: "US" }, { on: false, sender: "marketing_service" }).steps, []);
  });
});

describe("#4273 C: wiring", () => {
  it("SMS countries sits right after Feature flags in System", () => {
    const system = NAV_GROUPS.find((g) => g.label === "System");
    const ids = system.items.map((i) => i.id);
    assert.equal(ids[ids.indexOf("feature-flags") + 1], "sms-countries");
    const item = system.items.find((i) => i.id === "sms-countries");
    assert.deepEqual(item, { id: "sms-countries", label: "SMS countries", icon: "MessageSquare" });
    const sidebar = stripComments(read("components/layout/Sidebar.jsx"));
    assert.match(sidebar, /ICON_MAP = \{[\s\S]*\bMessageSquare,[\s\S]*\};/);
  });
  it("App draws SmsCountriesPage", () => {
    const app = stripComments(read("App.jsx"));
    assert.ok(app.includes('import { SmsCountriesPage } from "./pages/SmsCountriesPage";'));
    assert.match(app, /"sms-countries": SmsCountriesPage,/);
  });
  it("the services call the three owner/admin RPCs with the expected timestamp", () => {
    const svc = stripComments(read("services/smsCountriesService.js"));
    assert.ok(svc.includes('supabase.rpc("admin_sms_country_switches_list")'));
    assert.ok(svc.includes('supabase.rpc("admin_set_sms_country_switch"'));
    assert.ok(svc.includes('supabase.rpc("admin_set_sms_country_readiness"'));
    assert.equal((svc.match(/p_expected_updated_at: expectedUpdatedAt \?\? null/g) || []).length, 2);
  });
  it("the page gates on owner/admin before the board (and so before any server call)", () => {
    const page = stripComments(read("pages/SmsCountriesPage.jsx"));
    const gate = page.indexOf('const allowed = role === "owner" || role === "admin";');
    assert.ok(gate > 0, "the gate reads useAuth().access.role");
    assert.ok(page.indexOf("allowed ? (") > gate);
    // The only component that calls the service is the board, drawn after the gate.
    const pageFn = page.slice(page.indexOf("export function SmsCountriesPage"), page.indexOf("function SmsCountriesBoard"));
    assert.equal(/getSmsCountries|setSmsCountry/.test(pageFn), false);
  });
});

describe("#4273 D: rendered", () => {
  let harness;
  before(async () => {
    let esbuild;
    try {
      esbuild = await import("esbuild");
    } catch {
      assert.fail("esbuild is not installed: run `npm ci` in mingla-admin before this test");
    }
    const stubs = {
      name: "issue4273-stubs",
      setup(build) {
        build.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: "auth", namespace: "issue4273" }));
        build.onResolve({ filter: /services\/smsCountriesService$/ }, () => ({ path: "svc", namespace: "issue4273" }));
        build.onLoad({ filter: /.*/, namespace: "issue4273" }, (args) => ({
          loader: "js",
          contents: args.path === "auth"
            ? "export const useAuth = () => ({ access: globalThis.__issue4273Access ?? null });"
            : `const hit = (name) => { globalThis.__issue4273Calls.push(name); return Promise.resolve({ data: null, error: null }); };
               export const getSmsCountries = () => { globalThis.__issue4273Calls.push("list"); return new Promise(() => {}); };
               export const setSmsCountrySwitch = () => hit("switch");
               export const setSmsCountryReadiness = () => hit("readiness");`,
        }));
      },
    };
    const out = await esbuild.build({
      stdin: {
        contents: `import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../context/ToastContext.jsx";
import { SmsCountriesPage } from "../pages/SmsCountriesPage.jsx";
export const page = () => renderToStaticMarkup(<ToastProvider><SmsCountriesPage /></ToastProvider>);`,
        resolveDir: HERE, sourcefile: "issue4273.sms.harness.jsx", loader: "jsx",
      },
      bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", logLevel: "silent",
      loader: { ".js": "jsx" },
      plugins: [stubs],
      banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"VITE_SUPABASE_URL":"https://x.supabase.test","VITE_SUPABASE_ANON_KEY":"test"}' },
    });
    const file = path.join(HERE, `.issue4273-harness-${process.pid}.mjs`);
    fs.writeFileSync(file, out.outputFiles[0].text);
    try {
      harness = await import(file);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  for (const role of ["partner", "growth", null]) {
    it(`${role ?? "no seat"}: the "Owner and admins only" card and no server call`, () => {
      globalThis.__issue4273Calls = [];
      globalThis.__issue4273Access = role ? { role, areas: ["admin_console"] } : null;
      const html = harness.page();
      assert.ok(html.includes("SMS countries"));
      assert.ok(html.includes("Owner and admins only"));
      assert.ok(html.includes("Only the owner and admins can see and change SMS countries."));
      assert.equal(html.includes("Marketing sender:"), false);
      assert.deepEqual(globalThis.__issue4273Calls, []);
    });
  }
  for (const role of ["owner", "admin"]) {
    it(`${role}: the board, not the card`, () => {
      globalThis.__issue4273Calls = [];
      globalThis.__issue4273Access = { role, areas: ["admin_console"] };
      const html = harness.page();
      assert.ok(html.includes("Which countries hosts can send marketing texts to."));
      assert.ok(html.includes("Marketing sender:"));
      assert.equal(html.includes("Owner and admins only"), false);
    });
  }
});
