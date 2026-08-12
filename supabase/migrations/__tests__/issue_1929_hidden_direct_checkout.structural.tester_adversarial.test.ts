import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(new URL("../20270324001929_issue_1929_hidden_direct_checkout.sql", import.meta.url));
const viewWriter = await Deno.readTextFile(new URL("../20270116000869_issue_868_cover_gallery_read_layer.sql", import.meta.url));
const allowlist = await Deno.readTextFile(new URL("../../security/anon_executable_definer_allowlist.txt", import.meta.url));
const businessService = await Deno.readTextFile(new URL("../../../mingla-business/src/services/publicEventsService.ts", import.meta.url));
const consumerHook = await Deno.readTextFile(new URL("../../../app-mobile/src/hooks/usePublicEventBySlug.ts", import.meta.url));

const bundleStart = migration.indexOf("CREATE FUNCTION public.pg_direct_event_checkout_bundle(");
const checkoutStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(");
const bundle = migration.slice(bundleStart, checkoutStart);
const checkout = migration.slice(checkoutStart);

Deno.test("#1929 tester: exact-key bundle cannot enumerate or leak management/provider truth", () => {
  assert(bundleStart >= 0 && checkoutStart > bundleStart);
  assertMatch(bundle, /p_event_id IS NOT NULL[\s\S]*p_brand_slug IS NULL[\s\S]*p_event_slug IS NULL/);
  assertMatch(bundle, /p_event_id IS NULL[\s\S]*b\.slug = p_brand_slug[\s\S]*e\.slug = p_event_slug/);
  for (const forbidden of ["LIMIT p_", "OFFSET", "ORDER BY e.", "payment_provider", "paystack_subaccount_code", "created_by", "attendee", "invite_token"]) {
    assert(!bundle.includes(forbidden), `bundle leaked/listed via ${forbidden}`);
  }
  assert(bundle.includes("e.theme - 'business_draft'::text"), "management draft must be stripped from projected theme");
  assert(bundle.includes("e.event_type = 'event'"));
  assert(bundle.includes("e.visibility IN ('public'::text, 'hidden'::text)"));
  assert(bundle.includes("'ended'::text, 'cancelled'::text"));
});

Deno.test("#1929 tester: public enumeration and base RLS remain public-only negative space", () => {
  const viewStart = viewWriter.indexOf("CREATE OR REPLACE VIEW public.business_public_events_view");
  const view = viewWriter.slice(viewStart, viewWriter.indexOf("COMMENT ON VIEW", viewStart));
  assert(view.includes("e.visibility = 'public'::text"));
  assert(!view.includes("e.visibility IN ('public'::text, 'hidden'::text)"));
  assertEquals((migration.match(/CREATE (?:OR REPLACE )?VIEW/g) ?? []).length, 0);
  assertEquals((migration.match(/CREATE POLICY|ALTER POLICY/g) ?? []).length, 0);
  assertEquals((migration.match(/pg_direct_event_checkout_bundle\(/g) ?? []).length >= 4, true);
  assertEquals((businessService.match(/supabase\.rpc\("pg_direct_event_checkout_bundle"/g) ?? []).length, 1);
  assertEquals((consumerHook.match(/supabase\.rpc\("pg_direct_event_checkout_bundle"/g) ?? []).length, 1);
  const listStart = businessService.indexOf("export const fetchPublicBrandEvents");
  const listEnd = businessService.indexOf("export const", listStart + 20);
  assert(!businessService.slice(listStart, listEnd < 0 ? undefined : listEnd).includes("pg_direct_event_checkout_bundle"), "exact-key RPC entered Business list source");
});

Deno.test("#1929 tester: catalog/ACL/overload and latest checkout writer stay locked", () => {
  assertEquals((migration.match(/CREATE FUNCTION public\.pg_direct_event_checkout_bundle\(/g) ?? []).length, 1);
  assertMatch(bundle, /LANGUAGE sql[\s\S]*STABLE[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assertMatch(migration, /REVOKE ALL ON FUNCTION public\.pg_direct_event_checkout_bundle\(uuid, text, text\) FROM PUBLIC, anon, authenticated, service_role;/);
  assertMatch(migration, /GRANT EXECUTE ON FUNCTION public\.pg_direct_event_checkout_bundle\(uuid, text, text\) TO anon, authenticated, service_role;/);
  assertEquals((allowlist.match(/pg_direct_event_checkout_bundle\(p_event_id uuid, p_brand_slug text, p_event_slug text\)/g) ?? []).length, 1);
  assert(checkout.indexOf("WHERE idempotency_key = p_idempotency_key") < checkout.indexOf("v_event.visibility NOT IN ('public', 'hidden')"));
  assertMatch(checkout, /v_event\.visibility NOT IN \('public', 'hidden'\)[\s\S]*ARRAY\['scheduled'::text, 'live'::text\]/);
  const freshGuard = checkout.match(/IF v_event\.visibility[\s\S]*?RAISE EXCEPTION 'event_not_selling';[\s\S]*?END IF;/)?.[0] ?? "";
  assert(!freshGuard.includes("private") && !freshGuard.includes("ended") && !freshGuard.includes("cancelled"), "fresh admission widened beyond public/hidden scheduled/live");
  assert(checkout.includes("v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online"), "load-bearing tier checkout guard removed");
  assert(checkout.includes("RAISE EXCEPTION 'ticket_type_unavailable'"), "load-bearing tier denial token removed");
  assert(!checkout.includes("#1930"), "#1930 transition semantics were smuggled into checkout writer");
  assert(!bundle.includes("biz_validate_offering_invite_token"), "#1931 private invite authority was smuggled into bundle");
});
