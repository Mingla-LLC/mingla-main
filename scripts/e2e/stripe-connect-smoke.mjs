#!/usr/bin/env node
/**
 * Stripe Connect smoke tests against a deployed Supabase project.
 *
 * ## Light mode (default)
 * Verifies JWT-protected functions return 401 when no user session is sent.
 *
 *   STRIPE_CONNECT_SMOKE_URL=https://xxxx.supabase.co
 *   STRIPE_CONNECT_SMOKE_ANON_KEY=<anon key>
 *   node scripts/e2e/stripe-connect-smoke.mjs
 *
 * ## Full mode
 * Calls refresh-status + balances with a real user JWT, then reads `brands` via service role.
 *
 *   STRIPE_CONNECT_SMOKE_MODE=full
 *   STRIPE_CONNECT_SMOKE_JWT=<user access token>
 *   STRIPE_CONNECT_SMOKE_SERVICE_ROLE_KEY=<service_role>
 *   STRIPE_CONNECT_SMOKE_BRAND_ID=<uuid>
 *   node scripts/e2e/stripe-connect-smoke.mjs
 *
 * Do not log JWTs or service keys.
 */

const base = (process.env.STRIPE_CONNECT_SMOKE_URL ?? "").replace(/\/$/, "");
const anon = process.env.STRIPE_CONNECT_SMOKE_ANON_KEY ?? "";
const mode = process.env.STRIPE_CONNECT_SMOKE_MODE ?? "light";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function expect401(name, path, body) {
  const url = `${base}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
    },
    body: JSON.stringify(body),
  });
  if (r.status !== 401) {
    const t = await r.text();
    fail(`${name}: expected 401 without Authorization, got ${r.status}: ${t.slice(0, 200)}`);
  }
}

async function main() {
  if (base === "" || anon === "") {
    if (process.env.CI === "true") {
      fail("CI requires STRIPE_CONNECT_SMOKE_URL and STRIPE_CONNECT_SMOKE_ANON_KEY");
    }
    console.log("Skip: set STRIPE_CONNECT_SMOKE_URL and STRIPE_CONNECT_SMOKE_ANON_KEY");
    return;
  }

  const sampleBrand = "00000000-0000-4000-8000-000000000001";

  if (mode === "light") {
    await expect401("brand-stripe-connect-session", "/functions/v1/brand-stripe-connect-session", {
      brandId: sampleBrand,
    });
    await expect401("brand-stripe-refresh-status", "/functions/v1/brand-stripe-refresh-status", {
      brandId: sampleBrand,
    });
    await expect401("brand-stripe-balances", "/functions/v1/brand-stripe-balances", {
      brandId: sampleBrand,
    });
    console.log("stripe-connect-smoke (light): OK");
    return;
  }

  if (mode === "full") {
    const jwt = process.env.STRIPE_CONNECT_SMOKE_JWT ?? "";
    const service = process.env.STRIPE_CONNECT_SMOKE_SERVICE_ROLE_KEY ?? "";
    const brandId = process.env.STRIPE_CONNECT_SMOKE_BRAND_ID ?? "";
    if (jwt === "" || service === "" || brandId === "") {
      fail("full mode requires STRIPE_CONNECT_SMOKE_JWT, SERVICE_ROLE_KEY, BRAND_ID");
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${jwt}`,
    };

    const refresh = await fetch(`${base}/functions/v1/brand-stripe-refresh-status`, {
      method: "POST",
      headers,
      body: JSON.stringify({ brandId }),
    });
    const refreshText = await refresh.text();
    if (refresh.status !== 200) {
      fail(`brand-stripe-refresh-status ${refresh.status}: ${refreshText.slice(0, 500)}`);
    }

    const balRes = await fetch(`${base}/functions/v1/brand-stripe-balances`, {
      method: "POST",
      headers,
      body: JSON.stringify({ brandId }),
    });
    const balJson = await balRes.json();
    if (balRes.status !== 200) {
      fail(`brand-stripe-balances ${balRes.status}: ${JSON.stringify(balJson)}`);
    }
    if (typeof balJson.availableMinor !== "number" || typeof balJson.pendingMinor !== "number") {
      fail(`balances shape invalid: ${JSON.stringify(balJson)}`);
    }

    const rest = await fetch(
      `${base}/rest/v1/brands?id=eq.${encodeURIComponent(brandId)}&select=id,stripe_connect_id,stripe_charges_enabled`,
      {
        headers: {
          apikey: service,
          Authorization: `Bearer ${service}`,
        },
      },
    );
    const rows = await rest.json();
    if (!Array.isArray(rows) || rows.length !== 1) {
      fail(`expected one brand row: ${JSON.stringify(rows)}`);
    }

    console.log("stripe-connect-smoke (full): OK", {
      stripe_connect_id: rows[0].stripe_connect_id,
      stripe_charges_enabled: rows[0].stripe_charges_enabled,
      availableMinor: balJson.availableMinor,
      pendingMinor: balJson.pendingMinor,
    });
    return;
  }

  fail(`Unknown STRIPE_CONNECT_SMOKE_MODE=${mode} (use light or full)`);
}

await main();
