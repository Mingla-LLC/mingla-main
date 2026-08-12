#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

export function checkSources({ shareMapper, previewServer, discoveryView, venueView }) {
  const failures = [];
  if (!/\["public", "discover"\]\.includes\(row\.visibility\)[\s\S]*row\.visibility !== "hidden"/.test(shareMapper)) failures.push("exact event share mapper must admit stored Unlisted visibility without broadening discovery visibility");
  if (!/\.in\("visibility", \["public", "discover"\]\)/.test(shareMapper)) failures.push("brand upcoming count must remain Public/discovery-only");
  if (!/requestRpcJson\("pg_direct_event_checkout_bundle"[\s\S]*p_event_id: null[\s\S]*p_brand_slug: brandSlug[\s\S]*p_event_slug: eventSlug/.test(previewServer)) failures.push("crawler slug read must consume the exact event RPC");
  if (!/requestRpcJson\("pg_direct_event_checkout_bundle"[\s\S]*p_event_id: eventId[\s\S]*p_brand_slug: null[\s\S]*p_event_slug: null/.test(previewServer)) failures.push("crawler image ID read must consume the exact event RPC");
  if (!/event_type: "eq\.rsvp"/.test(previewServer)) failures.push("legacy discovery-view fallback must be RSVP-only");
  if (!/e\.visibility = 'public'::text/.test(discoveryView)) failures.push("discovery view must remain Public-only");
  if (!/WHERE v\.claim_status = 'verified'/.test(venueView)) failures.push("pending venues must remain excluded");
  return failures;
}

const selfTest = () => {
  const valid = {
    shareMapper: '["public", "discover"].includes(row.visibility) && row.visibility !== "hidden"; query.in("visibility", ["public", "discover"]);',
    previewServer: 'requestRpcJson("pg_direct_event_checkout_bundle", { p_event_id: null, p_brand_slug: brandSlug, p_event_slug: eventSlug }); requestRpcJson("pg_direct_event_checkout_bundle", { p_event_id: eventId, p_brand_slug: null, p_event_slug: null }); event_type: "eq.rsvp";',
    discoveryView: "e.visibility = 'public'::text",
    venueView: "WHERE v.claim_status = 'verified'",
  };
  if (checkSources(valid).length) throw new Error("self-test valid fixture failed");
  for (const key of Object.keys(valid)) {
    const defeated = { ...valid, [key]: "" };
    if (checkSources(defeated).length === 0) throw new Error(`self-test did not detect ${key} removal`);
  }
  console.log("issue-1962 self-test: PASS");
};

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = checkSources({
    shareMapper: read("supabase/functions/_shared/contentShare.ts"),
    previewServer: read("mingla-business/server/socialPreview.js"),
    discoveryView: read("supabase/migrations/20270116000869_issue_868_cover_gallery_read_layer.sql"),
    venueView: read("supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql"),
  });
  if (failures.length) {
    for (const failure of failures) console.error(`issue-1962: ${failure}`);
    process.exit(1);
  }
  console.log("issue-1962 unlisted share previews: PASS");
}
