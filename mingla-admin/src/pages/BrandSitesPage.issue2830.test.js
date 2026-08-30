import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./BrandSitesPage.jsx", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../services/brandSitesAdminService.js", import.meta.url),
  "utf8",
);

test("#2830 Admin exposes only bounded provider-neutral Sites operations", () => {
  for (const action of [
    "reconcile",
    "suspend",
    "resume",
    "revoke_editor_sessions",
  ]) {
    assert.match(page, new RegExp(`${action}:`));
  }
  for (const forbidden of [
    "force-publish",
    "delete_site",
    "run_sql",
    "signed_url",
    "Payload",
    "Supabase",
    "Vercel",
  ]) {
    assert.doesNotMatch(page, new RegExp(forbidden, "i"));
  }
  assert.match(page, /No control on this page can edit content/);
});

test("#2830 Admin reads and mutates only the three safe Core RPCs", () => {
  const rpcNames = [...service.matchAll(/supabase\.rpc\("([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(rpcNames, [
    "brand_site_admin_list",
    "brand_site_admin_detail",
    "brand_site_admin_action",
  ]);
  assert.doesNotMatch(service, /\.from\(|payload|artifact_key|secret/i);
});
