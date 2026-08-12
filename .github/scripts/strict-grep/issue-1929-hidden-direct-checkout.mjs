#!/usr/bin/env node
import fs from "node:fs";

const migrationPath = "supabase/migrations/20270324001929_issue_1929_hidden_direct_checkout.sql";
const businessPath = "mingla-business/src/services/publicEventsService.ts";
const consumerHookPath = "app-mobile/src/hooks/usePublicEventBySlug.ts";
const consumerScreenPath = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";
const edgePath = "supabase/functions/ticket-checkout-create/index.ts";

const fail = (message) => {
  throw new Error(`issue-1929-hidden-direct-checkout: ${message}`);
};

const check = ({ migration, business, consumerHook, consumerScreen, edge }) => {
  if (!migration.includes("CREATE FUNCTION public.pg_direct_event_checkout_bundle(")) fail("bundle missing");
  if (!migration.includes("SET search_path = ''")) fail("bundle search_path widened");
  if (!migration.includes("e.visibility IN ('public'::text, 'hidden'::text)")) fail("bundle visibility changed");
  if (!migration.includes("'ended'::text, 'cancelled'::text")) fail("historical lifecycle removed");
  if (/tt\.is_(hidden|disabled)\s+IS\s+NOT\s+TRUE/.test(migration)) fail("ticket projection filtered");
  if (!migration.includes("v_event.visibility NOT IN ('public', 'hidden')")) fail("fresh checkout predicate changed");
  if (!business.includes('supabase.rpc("pg_direct_event_checkout_bundle"')) fail("business bundle missing");
  if (!business.includes('if (data === null) return "fallback"')) fail("fallback not literal-null gated");
  if (!business.includes('if (error !== null) throw error;')) fail("RPC error does not throw");
  if (!business.includes('throw new Error("invalid_direct_event_checkout_bundle")')) fail("malformed payload not redacted");
  if (!business.includes('row.event_type !== "rsvp"')) fail("slug fallback not RSVP-only");
  if (!business.includes('row.event_type === "rsvp" ? detailFromRow(row) : null')) fail("UUID fallback not RSVP-only");
  if (!business.includes('.eq("brand_slug", brandSlug)') || !business.includes('.eq("slug", eventSlug)')) fail("slug fallback not exact");
  if (!consumerHook.includes('supabase.rpc("pg_direct_event_checkout_bundle"')) fail("consumer bundle missing");
  if (consumerHook.includes('supabase.rpc("pg_public_event_by_slug"')) fail("legacy consumer reader remains");
  if (!consumerScreen.includes('canonical?.event.tickets ?? ticketsQuery.data ?? []')) fail("cold tickets not bundle-owned");
  if (!consumerScreen.includes('return acceptRsvpLegacySeed(candidate)')) fail("consumer RSVP fallback widened");
  if (!edge.includes("export const createTicketCheckoutCreateHandler")) fail("Edge handler factory missing");
  if (!edge.includes("deps.userIdFromAuthHeader(req)") || !edge.includes("deps.serviceClient()") || !edge.includes("deps.paystackInitializeTransaction({")) fail("Edge dependency seam bypassed");
  if ((edge.match(/if \(import\.meta\.main\)/g) ?? []).length !== 1) fail("Edge main guard count changed");
  if ((edge.match(/serve\(createTicketCheckoutCreateHandler\(\)\);/g) ?? []).length !== 1) fail("Edge bootstrap changed");
  const deps = edge.match(/const defaultDeps: TicketCheckoutCreateDeps = \{([\s\S]*?)\n\};/)?.[1]?.replace(/\s/g, "");
  if (deps !== "userIdFromAuthHeader,serviceClient,paystackInitializeTransaction,") fail("Edge production defaults changed");
};

const sources = {
  migration: fs.readFileSync(migrationPath, "utf8"),
  business: fs.readFileSync(businessPath, "utf8"),
  consumerHook: fs.readFileSync(consumerHookPath, "utf8"),
  consumerScreen: fs.readFileSync(consumerScreenPath, "utf8"),
  edge: fs.readFileSync(edgePath, "utf8"),
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    { key: "migration", from: "v_event.visibility NOT IN ('public', 'hidden')", to: "v_event.visibility <> 'public'" },
    { key: "business", from: 'row.event_type !== "rsvp"', to: 'row.event_type !== "event"' },
    { key: "consumerHook", from: 'supabase.rpc("pg_direct_event_checkout_bundle"', to: 'supabase.rpc("pg_public_event_by_slug"' },
    { key: "edge", from: "deps.paystackInitializeTransaction({", to: "paystackInitializeTransaction({" },
  ];
  for (const mutation of mutations) {
    const changed = { ...sources, [mutation.key]: sources[mutation.key].replace(mutation.from, mutation.to) };
    let rejected = false;
    try { check(changed); } catch { rejected = true; }
    if (!rejected) fail(`self-test mutation survived: ${mutation.from}`);
  }
  console.log("issue-1929 hidden direct checkout self-test: PASS");
} else {
  check(sources);
  console.log("issue-1929 hidden direct checkout: PASS");
}
