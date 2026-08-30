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
  const payloadReader = business.match(/const fetchDirectEventBundlePayload = async \([\s\S]*?\): Promise<JsonRecord \| null> => \{([\s\S]*?)\n\};/)?.[1];
  if (!payloadReader?.includes('if (data === null) return null;')) fail("payload absence not literal-null gated");
  if (!payloadReader.includes('if (!isDirectEventBundle(data))') || !payloadReader.includes('throw new Error("invalid_direct_event_checkout_bundle")')) fail("payload malformed envelope not rejected");
  if (payloadReader.indexOf('if (error !== null) throw error;') > payloadReader.indexOf('if (data === null) return null;')) fail("payload null checked before RPC error");
  const detailReader = business.match(/const readDirectEventBundle = async \([\s\S]*?\): Promise<PublicEventDetail \| null \| "fallback"> => \{([\s\S]*?)\n\};/)?.[1];
  if (!detailReader?.includes('return payload === null ? "fallback" : detailFromDirectBundle(payload);')) fail("fallback not payload literal-null gated");
  if (!business.includes('if (error !== null) throw error;')) fail("RPC error does not throw");
  if (!business.includes('throw new Error("invalid_direct_event_checkout_bundle")')) fail("malformed payload not redacted");
  if (!business.includes('row.event_type !== "rsvp"')) fail("slug fallback not RSVP-only");
  if (!business.includes('row.event_type === "rsvp" ? detailFromRow(row) : null')) fail("UUID fallback not RSVP-only");
  if (!business.includes('.eq("brand_slug", brandSlug)') || !business.includes('.eq("slug", eventSlug)')) fail("slug fallback not exact");
  if (!consumerHook.includes('supabase.rpc("pg_direct_event_checkout_bundle"')) fail("consumer bundle missing");
  if (consumerHook.includes('supabase.rpc("pg_public_event_by_slug"')) fail("legacy consumer reader remains");
  // #2242: this assertion only ever inspected the page BODY's line (:586). Its old
  // message, "cold tickets not bundle-owned", claimed the whole invariant while
  // covering one of the two sites it names — which is why 96cbd78ba (#1936) shipped a
  // five-site migration having moved four, past a green gate. The assertion is correct
  // and stays; only its overclaiming name is corrected, and the cart's site is added
  // below so the gate can finally fail for the reason it is named for.
  if (!consumerScreen.includes('canonical?.event.tickets ?? ticketsQuery.data ?? []')) fail("page body tickets not bundle-owned");
  // #2242: the CART's site. `cartTickets` is a named local precisely so it can be
  // pinned — the inline expression is a prefix substring of the body's line above and
  // an includes() assertion on it would be satisfied by :586 on a fully reverted cart.
  if (!consumerScreen.includes('const cartTickets = canonical?.event.tickets ?? ticketsQuery.data;')) fail("event cart ticket source is not canonical-first");
  if (!consumerScreen.includes('tickets={cartTickets}')) fail("event cart mount does not read cartTickets");
  // Load-bearing NEGATIVE — nothing but the fix can satisfy it. Scoped to
  // consumerScreen only: the trip and experience screens legitimately contain this
  // exact string (neither has the allowLegacyTicketRead gate), so a repo-wide
  // version would be wrong.
  if (consumerScreen.includes('tickets={ticketsQuery.data}')) fail("event cart reads the gated legacy query directly");
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
    { key: "business", from: 'if (error !== null) throw error;\n  if (data === null) return null;\n  if (!isDirectEventBundle(data))', to: 'if (error !== null) throw error;\n  if (!data) return null;\n  if (!isDirectEventBundle(data))' },
    { key: "business", from: 'return payload === null ? "fallback" : detailFromDirectBundle(payload);', to: 'return !payload ? "fallback" : detailFromDirectBundle(payload);' },
    { key: "consumerHook", from: 'supabase.rpc("pg_direct_event_checkout_bundle"', to: 'supabase.rpc("pg_public_event_by_slug"' },
    { key: "edge", from: "deps.paystackInitializeTransaction({", to: "paystackInitializeTransaction({" },
    // #2242 — the cart's site must be falsifiable. The first mutation is the exact
    // pre-fix code: reverting the mount while leaving the body's line (:586) intact
    // must still be REJECTED. That is the anti-prefix proof — the hole F-8 found.
    { key: "consumerScreen", from: "tickets={cartTickets}", to: "tickets={ticketsQuery.data}" },
    { key: "consumerScreen", from: "const cartTickets =", to: "const cartTicketsRenamed =" },
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
