// #2829 W8 — Admin sees each site's addresses with their domain state, can
// "Recheck" a brand's own domain (the same Core check the 6-hourly sweep
// runs) and "Fall back to Mingla address" when the brand's domain is the main
// address (the existing audited set_primary_host action, with the site's
// Mingla address). Nothing names Mingla's infrastructure providers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./BrandSitesPage.jsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../services/brandSitesAdminService.js", import.meta.url), "utf8");

test("#2829 W8 the addresses list shows domain state per host", () => {
  for (const token of [
    "host.dns_state", "host.tls_state", "host.misconfigured_since", "host.redirect_until",
    "host.tls_expires_at", "host.mx_missing", "host.last_checked_at", "Brand's own domain", "Mingla address",
  ]) assert.ok(page.includes(token), `addresses list misses ${token}`);
});

test("#2829 W8 Recheck goes through the brand-site-domains check route for that host", () => {
  assert.match(page, /recheckBrandSiteDomain\(siteId, host\.host_id\)/);
  assert.match(service, /functions\.invoke\("brand-site-domains"/);
  assert.match(service, /route: `\/v1\/sites\/\$\{siteId\}\/domains\/\$\{hostId\}\/check`, method: "POST"/);
  // Only for a brand's own domain that is still in play.
  assert.match(page, /host\.kind === "custom_domain" && host\.host_id && host\.status !== "retired"/);
});

test("#2829 W8 Fall back uses the audited set_primary_host action with the Mingla address", () => {
  assert.match(page, /set_primary_host: \{\s*title: "Fall back to Mingla address"/);
  assert.match(page, /host\.kind === "custom_domain" && host\.is_primary/);
  assert.match(page, /host\.kind === "mingla_subdomain" && host\.status === "active"/);
  assert.match(page, /action === "set_primary_host" \? fallbackHost : null/);
  assert.match(service, /p_hostname: hostname/);
  // Still exactly the three safe Core RPCs (the #2830 contract).
  const rpcNames = [...service.matchAll(/supabase\.rpc\("([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rpcNames, ["brand_site_admin_list", "brand_site_admin_detail", "brand_site_admin_action"]);
});

test("#2829 W8 the page never names an infrastructure provider", () => {
  for (const forbidden of ["Vercel", "Supabase", "Bunny"]) {
    assert.doesNotMatch(page, new RegExp(forbidden, "i"));
  }
});
