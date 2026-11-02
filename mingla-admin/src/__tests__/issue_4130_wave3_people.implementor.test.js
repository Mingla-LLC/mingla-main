// Issue #4130 (Wave 3) — People, Brands and Offerings in Mingla Admin.
//
//   1. A person action the server refuses changes nothing: no table is
//      touched from the browser, no edge function is called, the error is
//      shown. (The old Users page fell back to deleting rows table by table
//      when the server said no.)
//   2. The old Users page and every trace of its browser-side delete are gone.
//   3. The words behind People, Brands and Offerings (segments, readiness,
//      one state per offering, the Mingla fee column only when overridden).
//   4. People and Brands are real pages, and every old address still opens.
//   5. The brand detail asks for columns that exist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersonActions, personActionErrorMessage, CONFIRM_WORDS } from "../lib/personActions.js";
import {
  PEOPLE_TABS,
  peopleTabFor,
  peopleTabLabel,
  personDisplayName,
  gotAsFarAs,
  signInMethodLabel,
  paymentReadiness,
  bestReadiness,
  feeOverrideLabel,
  hasFeeOverride,
  offeringState,
  offeringViewFor,
  soldOrGoing,
  brandToolFor,
  flattenPersonRow,
} from "../lib/peopleSegments.js";
import { redirectHash } from "../lib/adminRoutes.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** A stand-in for the Supabase client that records everything asked of it. */
function recordingClient(rpcResult) {
  const calls = { rpc: [], from: [], deletes: [], invoke: [] };
  const builder = (table) => ({
    delete() {
      calls.deletes.push(table);
      return { eq: async () => ({ error: null }) };
    },
    update() {
      return { eq: async () => ({ error: null }) };
    },
  });
  return {
    calls,
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      if (typeof rpcResult === "function") return rpcResult(name, params);
      return rpcResult;
    },
    from: (table) => {
      calls.from.push(table);
      return builder(table);
    },
    functions: {
      invoke: async (name) => {
        calls.invoke.push(name);
        return { data: null, error: null };
      },
    },
  };
}

function withFetchSpy(run) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return Promise.resolve(run(seen)).finally(() => {
    globalThis.fetch = original;
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : walk(full);
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

describe("#4130 W3: a refused server action changes nothing", () => {
  for (const [label, run] of [
    ["ban", (a) => a.ban("user-1", "spam")],
    ["unban", (a) => a.unban("user-1", "appeal")],
    ["close the business account", (a) => a.deleteBusinessAccount("user-1", "asked to leave")],
    ["mark as staff or test", (a) => a.setInternal("user-1", true, "team phone")],
  ]) {
    it(`${label}: the server says no -> error shown, no table, no edge function, no fetch`, async () => {
      for (const refusal of [{ data: null, error: { message: "not_authorized" } }, { data: null, error: { message: "boom" } }]) {
        const client = recordingClient(refusal);
        await withFetchSpy(async (fetched) => {
          await assert.rejects(run(createPersonActions(client)), (err) => {
            assert.equal(err.message, personActionErrorMessage(refusal.error));
            assert.match(err.message, /[Nn]othing was changed/);
            return true;
          });
          assert.equal(client.calls.rpc.length, 1, "one server call");
          assert.deepEqual(client.calls.from, [], "no table read or written from the browser");
          assert.deepEqual(client.calls.deletes, [], "no browser-side delete");
          assert.deepEqual(client.calls.invoke, [], "no edge function");
          assert.deepEqual(fetched, [], "no direct request");
        });
      }
    });
  }

  it("a network failure is reported the same way, with nothing else tried", async () => {
    const client = recordingClient(() => {
      throw new Error("Failed to fetch");
    });
    await withFetchSpy(async (fetched) => {
      await assert.rejects(createPersonActions(client).deleteBusinessAccount("user-1", "x"), /[Nn]othing was changed/);
      assert.deepEqual(client.calls.from, []);
      assert.deepEqual(client.calls.invoke, []);
      assert.deepEqual(fetched, []);
    });
  });

  it("no reason -> nothing is sent at all", async () => {
    const client = recordingClient({ data: {}, error: null });
    await assert.rejects(createPersonActions(client).ban("user-1", "   "), /Add a reason first/);
    assert.equal(client.calls.rpc.length, 0);
  });

  it("each action is exactly one audited admin RPC", async () => {
    const client = recordingClient({ data: { ok: true }, error: null });
    const actions = createPersonActions(client);
    await actions.ban("u", " spam ");
    await actions.unban("u", "appeal");
    await actions.deleteBusinessAccount("u", "left");
    await actions.setInternal("u", false, "real customer");
    assert.deepEqual(client.calls.rpc, [
      { name: "admin_set_user_active", params: { p_user_id: "u", p_active: false, p_reason: "spam" } },
      { name: "admin_set_user_active", params: { p_user_id: "u", p_active: true, p_reason: "appeal" } },
      { name: "admin_set_account_deleted", params: { p_user_id: "u", p_deleted: true, p_reason: "left" } },
      { name: "admin_set_internal_account", params: { p_user_id: "u", p_internal: false, p_reason: "real customer" } },
    ]);
    assert.deepEqual(client.calls.from, []);
    assert.deepEqual(CONFIRM_WORDS, { ban: "BAN", deleteBusinessAccount: "DELETE" });
  });
});

describe("#4130 W3: the browser-side delete is gone", () => {
  it("the old Users page is deleted", () => {
    assert.equal(fs.existsSync(path.join(SRC, "pages", "UserManagementPage.jsx")), false);
  });
  it("no admin source deletes a person's rows from the browser or calls delete-user", () => {
    for (const file of walk(SRC)) {
      const code = fs.readFileSync(file, "utf8");
      const rel = path.relative(SRC, file);
      assert.equal(code.includes("tablesToDelete"), false, `${rel}: table-by-table delete list`);
      assert.equal(code.includes("functions/v1/delete-user"), false, `${rel}: delete-user edge call`);
      assert.equal(/invoke\(\s*["']delete-user["']/.test(code), false, `${rel}: delete-user edge call`);
      assert.equal(code.includes("auth/v1/admin/users"), false, `${rel}: auth admin call from the browser`);
      assert.equal(/from\(\s*["']profiles["']\s*\)\s*\.delete\(/.test(code), false, `${rel}: browser delete of profiles`);
    }
  });
  it("the drawer's writes go through personActions only, each behind a confirmation", () => {
    const drawer = read("components/people/PersonDrawer.jsx");
    assert.match(drawer, /personActions\.ban\(/);
    assert.match(drawer, /personActions\.deleteBusinessAccount\(/);
    assert.match(drawer, /confirmPhrase: CONFIRM_WORDS\.ban/);
    assert.match(drawer, /confirmPhrase: CONFIRM_WORDS\.deleteBusinessAccount/);
    assert.match(drawer, /<HighRiskActionModal/);
    assert.equal(/\.from\(/.test(drawer), false);
    // The list rows carry no write: no toggle, no delete.
    const page = read("pages/PeoplePage.jsx");
    for (const word of ["Toggle", "personActions", "Delete", "is_beta_tester:"]) {
      assert.equal(page.includes(word), false, `People list has ${word}`);
    }
  });
});

describe("#4130 W3: People words", () => {
  it("the approved tabs, in order, with server counts", () => {
    // #4226 adds "Ticket buyers, no app" and "Host contacts, no app" after Staff and test.
    assert.deepEqual(PEOPLE_TABS.map((t) => t.id), ["explorers", "hosts", "both", "incomplete", "internal", "ticket-buyers", "host-contacts"]);
    assert.equal(peopleTabFor("hosts").segment, "host");
    assert.equal(peopleTabFor("constructor").id, "explorers", "unknown or inherited keys fall back");
    assert.equal(peopleTabLabel(PEOPLE_TABS[0], { explorer: 42 }), "Explorers · 42");
    assert.equal(peopleTabLabel(PEOPLE_TABS[0], null), "Explorers", "no count until the server answers");
    assert.equal(peopleTabLabel(PEOPLE_TABS[4], { internal: "x" }), "Staff and test");
  });
  it("names, sign-in and how far an unfinished sign-up got", () => {
    assert.equal(personDisplayName({ name: "  " }), "No name yet");
    assert.equal(signInMethodLabel("google"), "Google");
    assert.equal(signInMethodLabel("__proto__"), "Not recorded");
    assert.equal(gotAsFarAs({ closed_business_account: true }), "Closed their business account");
    assert.equal(gotAsFarAs({ onboarding_step: 4 }), "Explorer onboarding, step 4");
    assert.equal(gotAsFarAs({ onboarding_step: null }), "Signed in, never started onboarding");
  });
  // #4130 (integration): readiness codes are Wave 2a's '<provider>_<state>'
  // (admin_brand_payment_readiness), named with the Payments page's words.
  it("a host's payments: ready beats not ready; Paystack counts as ready", () => {
    assert.equal(paymentReadiness("paystack_ready").label, "Ready · Paystack · NGN");
    assert.equal(paymentReadiness("paystack_no_setup").ready, false);
    assert.equal(paymentReadiness("stripe_needs_action").label, "Needs host action · Stripe · USD");
    assert.equal(paymentReadiness("needs_bank"), null, "the old Wave 3 code is gone");
    assert.equal(paymentReadiness("toString"), null);
    assert.equal(bestReadiness([{ payment_readiness: "paystack_no_setup" }, { payment_readiness: "paystack_ready" }]).short, "Paystack");
    assert.equal(bestReadiness([]), null);
    const flat = flattenPersonRow({ brands: [{ name: "Ctrl", role: "brand_owner", payment_readiness: "stripe_ready" }] });
    assert.equal(flat.brand_names, "Ctrl");
    assert.equal(flat.main_role, "Owner");
    assert.equal(flat.payments_label, "Ready · Stripe · USD");
  });
});

describe("#4130 W3: Brands and Offerings words", () => {
  it("the Mingla fee shows only when a brand has its own rate", () => {
    assert.equal(feeOverrideLabel(null), null);
    assert.equal(feeOverrideLabel(250), "2.5% custom");
    assert.equal(hasFeeOverride([{ take_rate_bps_override: null }]), false);
    assert.equal(hasFeeOverride([{ take_rate_bps_override: null }, { take_rate_bps_override: 300 }]), true);
    const page = read("pages/BrandsPage.jsx");
    assert.match(page, /setShowFee\(hasFeeOverride\(result\.rows\)\)/);
  });
  it("one state per offering, and sold or going", () => {
    assert.equal(offeringState("on_sale").label, "On sale");
    assert.equal(offeringState("happening_now").label, "Happening now");
    assert.equal(offeringState("nope").label, "Unknown");
    assert.equal(offeringViewFor(undefined).id, "on_sale", "opens on what is on sale");
    assert.equal(soldOrGoing({ event_type: "rsvp", going: 3 }), "3 going");
    assert.equal(soldOrGoing({ event_type: "event", sold: 48 }), "48 sold");
    const list = read("pages/OfferingsConsolePage.jsx");
    assert.match(list, /listOfferingsBoard\(view, query\)/);
    for (const old of ['key: "visibility"', 'key: "lifecycle_bucket"', 'key: "status"']) {
      assert.equal(list.includes(old), false, `Offerings list still has the separate ${old} badge`);
    }
  });
});

describe("#4130 W3: pages and old addresses", () => {
  it("People and Brands are real pages", () => {
    const app = read("App.jsx");
    assert.match(app, /people: PeoplePage/);
    assert.match(app, /brands: BrandsPage/);
    assert.equal(/PeopleHub|BrandsHub/.test(app), false);
    // #4130 (integration): pages/shellHubs.jsx is retired; the old Users page
    // (and its browser-side delete) must not be drawn from anywhere.
    assert.equal(fs.existsSync(path.join(SRC, "pages", "UserManagementPage.jsx")), false);
    const code = (file) => fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const file of walk(SRC)) {
      assert.equal(/UserManagementPage/.test(code(file)), false, path.relative(SRC, file));
    }
  });
  it("old addresses land on the right tab, drawer or tool", () => {
    assert.equal(redirectHash("#/users?userId=u1"), "#/people?tab=explorers&userId=u1");
    assert.equal(redirectHash("#/business-people?userId=u1"), "#/people?tab=hosts&userId=u1");
    assert.equal(redirectHash("#/business-brands?brandId=b1"), "#/brands?tab=brands&brandId=b1");
    assert.equal(redirectHash("#/brand-sites?siteId=s1"), "#/brands?tab=websites&siteId=s1");
    assert.equal(redirectHash("#/business-venues?venueId=v1"), "#/brands?tab=venues&venueId=v1");
    assert.equal(redirectHash("#/claims"), "#/brands?tab=claims");
    assert.equal(brandToolFor("websites").hosts, "brand-sites");
    assert.equal(brandToolFor("venues").hosts, "business-venues");
    assert.equal(brandToolFor("claims").hosts, "claims");
    assert.equal(brandToolFor("brands"), null, "the brands tab is the list");
    assert.equal(brandToolFor("hasOwnProperty"), null);
  });
});

describe("#4130 W3: the brand detail asks for columns that exist", () => {
  it("lat, lng and profile_photo_url, not the names that made every detail fail", () => {
    const svc = read("services/identityReadService.js");
    const cols = svc.slice(svc.indexOf("const BRAND_DETAIL_COLS"), svc.indexOf("export async function getBrandDetail"));
    for (const col of ["lat", "lng", "profile_photo_url"]) assert.match(cols, new RegExp(`[,"]${col},`));
    for (const col of ["latitude", "longitude", "profile_media_url"]) assert.equal(cols.includes(col), false, col);
  });
  // #4130 (integration): the Wave 3 helper now delegates to Wave 2a's rule.
  it("payment readiness lives in one server helper, Wave 2a's rule", () => {
    const sql = fs.readFileSync(
      path.join(REPO, "supabase/migrations/20280118004130_issue_4130_integration.sql"),
      "utf8"
    );
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.admin_brand_payment_readiness_w3\(p_brand_id uuid\)[\s\S]*?SELECT public\.admin_brand_payment_readiness\(p_brand_id\)/);
    assert.match(sql, /brand_paystack_recipients pr\s+WHERE pr\.brand_id = b\.id AND pr\.is_active/);
    assert.match(sql, /LEFT JOIN public\.stripe_connect_accounts sca ON sca\.brand_id = b\.id/);
  });
});
