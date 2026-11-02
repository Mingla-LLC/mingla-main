#!/usr/bin/env node
/**
 * #3355 P10 — synthetic brands for Ari's live flow evals (SPEC §7.2).
 *
 * LOCAL ONLY. Refuses any non-loopback URL before the first request (the
 * check is in `localConfig`). Idempotent: re-running finds the same test
 * accounts and brands by email and slug and only fills what is missing.
 *
 * Test accounts use the reserved `.test` domain. Their password lives in this
 * file only; nothing here prints it or any key.
 *
 * Brands (only the ones an eval uses):
 * - B-New  "Lantern Supper Club" — just created, GB, owner + admin, no
 *          contact, media or payments.
 * - B-Sell "Afterglow Sessions" — Stripe charges on, payouts off; the owner
 *          accepted the Organiser Terms; an event manager who has not.
 * - B-NG   "Harmattan Kitchen" — NG, NGN, Paystack hold rail (sell before
 *          bank), with one approved Stay venue in Lagos.
 * - B-Recon is not seeded: resolving a currency change is handed to the
 *   model lane (moneyGate `resolve_currency` delegates), which the local
 *   model cannot drive, so no eval uses it.
 *
 * Usage: node scripts/ari/eval/seed-flow-brands.mjs --env-file=<local env>
 */

import { localConfig, serviceRest } from "./flows/lib.mjs";

// Local test-account password (synthetic; local stack only).
export const FLOW_EVAL_PASSWORD = "flow-eval-3355-local-only";

export const FLOW_ACCOUNTS = Object.freeze({
  new_owner: "flow-new-owner@example.test",
  new_admin: "flow-new-admin@example.test",
  sell_owner: "flow-sell-owner@example.test",
  sell_event_manager: "flow-sell-events@example.test",
  ng_owner: "flow-ng-owner@example.test",
});

export const FLOW_BRANDS = Object.freeze({
  new: {
    name: "Lantern Supper Club",
    slug: "flow-eval-lantern-supper-club",
    owner: "new_owner",
    team: [{ account: "new_admin", role: "brand_admin", terms: false }],
    columns: {
      country_code: "GB",
      default_currency: "GBP",
      kind: "popup",
    },
  },
  sell: {
    name: "Afterglow Sessions",
    slug: "flow-eval-afterglow-sessions",
    owner: "sell_owner",
    owner_terms: true,
    team: [{
      account: "sell_event_manager",
      role: "event_manager",
      terms: false,
    }],
    columns: {
      country_code: "GB",
      default_currency: "GBP",
      kind: "popup",
      stripe_connect_id: "acct_floweval3355sell",
      stripe_charges_enabled: true,
      stripe_payouts_enabled: false,
    },
    stripe: {
      stripe_account_id: "acct_floweval3355sell",
      charges_enabled: true,
      payouts_enabled: false,
      country: "GB",
      default_currency: "GBP",
    },
  },
  ng: {
    name: "Harmattan Kitchen",
    slug: "flow-eval-harmattan-kitchen",
    owner: "ng_owner",
    owner_terms: true,
    team: [],
    columns: {
      country_code: "NG",
      default_currency: "NGN",
      pricing_region: "NG",
      pricing_currency: "NGN",
      payment_provider: "paystack",
      payment_country: "NG",
      payout_hold_cutover_at: "2026-10-01T00:00:00Z",
      kind: "popup",
    },
    stay_venue: {
      name: "Harmattan Lagoon House",
      slug: "flowevalharmattanlagoon",
      lat: 6.4281,
      lng: 3.4219,
      city: "Lagos",
      country_code: "NG",
      address: "12 Adeola Odeku Street, Victoria Island, Lagos",
      venue_category: "stay",
      claim_status: "verified",
      coordinate_precision: "exact",
    },
  },
});

const TERMS_VERSION = "1.0";

async function ensureUser(rest, email) {
  // The admin list is small locally; find by email, else create confirmed.
  for (let page = 1; page <= 20; page += 1) {
    const data = await rest.auth("GET", `/admin/users?page=${page}&per_page=200`);
    const users = data?.users ?? [];
    const found = users.find((user) => user.email === email);
    if (found) return found.id;
    if (users.length < 200) break;
  }
  const created = await rest.auth("POST", "/admin/users", {
    email,
    password: FLOW_EVAL_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: email.split("@")[0] },
  });
  return created.id;
}

async function ensureCreatorAccount(rest, userId) {
  // The Host creates this row at first sign-in; brands.account_id needs it.
  const rows = await rest.select("creator_accounts", `select=id&id=eq.${userId}`);
  if (rows.length === 0) await rest.insert("creator_accounts", { id: userId });
}

async function ensureBrand(rest, spec, ownerId) {
  await ensureCreatorAccount(rest, ownerId);
  const existing = await rest.select(
    "brands",
    `select=id&slug=eq.${spec.slug}&deleted_at=is.null`,
  );
  if (existing.length > 0) return existing[0].id;
  const [row] = await rest.insert("brands", {
    account_id: ownerId,
    name: spec.name,
    slug: spec.slug,
    ...spec.columns,
  });
  return row.id;
}

async function ensureMember(rest, brandId, userId, role, terms) {
  const rows = await rest.select(
    "brand_team_members",
    `select=id,role,mingla_tos_version_accepted&brand_id=eq.${brandId}&user_id=eq.${userId}&removed_at=is.null`,
  );
  const now = new Date().toISOString();
  const termsPatch = terms
    ? { mingla_tos_accepted_at: now, mingla_tos_version_accepted: TERMS_VERSION }
    : { mingla_tos_accepted_at: null, mingla_tos_version_accepted: null };
  if (rows.length === 0) {
    await rest.insert("brand_team_members", {
      brand_id: brandId,
      user_id: userId,
      role,
      accepted_at: now,
      ...termsPatch,
    });
    return;
  }
  const accepted = rows[0].mingla_tos_version_accepted === TERMS_VERSION;
  if (rows[0].role !== role || accepted !== terms) {
    await rest.update(
      "brand_team_members",
      `id=eq.${rows[0].id}`,
      { role, ...(accepted !== terms ? termsPatch : {}) },
    );
  }
}

export async function seedFlowBrands(config = localConfig()) {
  const rest = serviceRest(config);
  const users = {};
  for (const [key, email] of Object.entries(FLOW_ACCOUNTS)) {
    users[key] = await ensureUser(rest, email);
  }
  const brands = {};
  for (const [key, spec] of Object.entries(FLOW_BRANDS)) {
    const ownerId = users[spec.owner];
    const brandId = await ensureBrand(rest, spec, ownerId);
    await ensureMember(rest, brandId, ownerId, "brand_owner", !!spec.owner_terms);
    for (const member of spec.team) {
      await ensureMember(
        rest,
        brandId,
        users[member.account],
        member.role,
        member.terms,
      );
    }
    if (spec.stripe) {
      const rows = await rest.select(
        "stripe_connect_accounts",
        `select=id&brand_id=eq.${brandId}`,
      );
      if (rows.length === 0) {
        await rest.insert("stripe_connect_accounts", {
          brand_id: brandId,
          ...spec.stripe,
        });
      }
    }
    if (spec.stay_venue) {
      const rows = await rest.select(
        "venue_listings",
        `select=id&brand_id=eq.${brandId}&slug=eq.${spec.stay_venue.slug}`,
      );
      if (rows.length === 0) {
        await rest.insert("venue_listings", {
          brand_id: brandId,
          ...spec.stay_venue,
        });
      }
    }
    brands[key] = brandId;
  }
  return { users, brands };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { brands } = await seedFlowBrands();
  // Ids only: no emails' passwords, no keys.
  console.log(JSON.stringify({ seeded: brands }, null, 2));
}
