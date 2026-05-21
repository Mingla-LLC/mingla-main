#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0897 happy-path regression check.
 *
 * Structural repo-running gate for the Trips + Events Group Chat contract.
 * The FAILS-ON-REVERT anchor is T-04/T-05: removing the order-finalize helper
 * integration flips this script to exit 1.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const migration = read("supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql");
const claimFn = read("supabase/functions/claim-pending-trip-chat-participation/index.ts");
const marketingSend = read("supabase/functions/marketing-send/index.ts");
const config = read("supabase/config.toml");
const messaging = read("app-mobile/src/services/messagingService.ts");
const countdownHook = read("app-mobile/src/hooks/useTripCountdown.ts");
const countdownBanner = read("app-mobile/src/components/chat/TripCountdownBanner.tsx");
const claimsHook = read("app-mobile/src/hooks/usePendingTripChatClaims.ts");
const onboarding = read("app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx");
const messageInterface = read("app-mobile/src/components/MessageInterface.tsx");
const deepLinks = read("app-mobile/src/services/deepLinkService.ts");
const appIndex = read("app-mobile/app/index.tsx");
const appJson = read("app-mobile/app.json");
const groupService = read("mingla-business/src/services/groupChatService.ts");
const groupHook = read("mingla-business/src/hooks/useEventGroupChat.ts");
const moderationHook = read("mingla-business/src/hooks/useEventGroupChatModeration.ts");
const groupPanel = read("mingla-business/src/components/groupChat/GroupChatPanel.tsx");
const moderationSheet = read("mingla-business/src/components/groupChat/GroupChatModerationSheet.tsx");
const groupRoute = read("mingla-business/app/event/[id]/group-chat.tsx");
const tripPage = read("mingla-business/app/trip/[id]/index.tsx");
const eventPage = read("mingla-business/app/event/[id]/index.tsx");
const checkoutCta = read("mingla-business/src/components/checkout/DownloadMinglaCta.tsx");
const checkoutConfirm = read("mingla-business/app/checkout/[eventId]/confirm.tsx");
const ticketBody = read("supabase/functions/_shared/email/ticketBody.ts");

check(
  "T-01 events INSERT creates trip/event conversations and excludes experience",
  migration !== null &&
    /CREATE TRIGGER ensure_group_conversation_on_event_create[\s\S]*?AFTER INSERT ON public\.events/.test(migration) &&
    /NEW\.event_type NOT IN \('event', 'trip'\)/.test(migration) &&
    /CASE NEW\.event_type WHEN 'trip' THEN 'trip' ELSE 'event' END/.test(migration),
  "Migration must define the events trigger, gate event_type to event/trip, and derive linked_entity_type.",
);

check(
  "T-02 linked_entity_type includes event and keeps coherent event_id branches",
  migration !== null &&
    /CHECK \(linked_entity_type IN \('direct', 'session', 'trip', 'event'\)\)/.test(migration) &&
    /linked_entity_type = 'event' AND event_id IS NOT NULL AND session_id IS NULL/.test(migration),
  "Migration must add event to the discriminator and coherence CHECK.",
);

check(
  "T-03 anon buyers get pending_trip_chat_claims with crypto token",
  migration !== null &&
    /CREATE TABLE IF NOT EXISTS public\.pending_trip_chat_claims/.test(migration) &&
    /claim_token text NOT NULL UNIQUE/.test(migration) &&
    /encode\(gen_random_bytes\(24\), 'base64url'\)/.test(migration),
  "Pending claim table and 24-byte random token generation must exist.",
);

check(
  "T-04 [FAILS-ON-REVERT KEY] order finalization calls add_buyer_to_event_chat",
  migration !== null &&
    /CREATE OR REPLACE FUNCTION public\.add_buyer_to_event_chat/.test(migration) &&
    /PERFORM public\.add_buyer_to_event_chat\([\s\S]*?v_session\.event_id[\s\S]*?v_session\.buyer_user_id[\s\S]*?v_order_id[\s\S]*?v_session\.buyer_email/.test(migration),
  "Reverting the finalize extension removes the PERFORM and must fail this check.",
);

check(
  "T-05 auth buyers are inserted into conversation_participants and anon buyers write claims",
  migration !== null &&
    /IF p_buyer_user_id IS NOT NULL THEN[\s\S]*?INSERT INTO public\.conversation_participants/.test(migration) &&
    /INSERT INTO public\.pending_trip_chat_claims/.test(migration),
  "Helper must cover both auth and anon buyer paths.",
);

check(
  "T-06 claim edge function is JWT-protected and idempotently inserts participants",
  claimFn !== null &&
    /caller\.auth\.getUser\(\)/.test(claimFn) &&
    /pending_trip_chat_claims/.test(claimFn) &&
    /conversation_participants/.test(claimFn) &&
    /claimed_at/.test(claimFn) &&
    /\[functions\.claim-pending-trip-chat-participation\][\s\S]*?verify_jwt = true/.test(config ?? ""),
  "Claim function must authenticate caller, claim rows, add participants, and keep verify_jwt true.",
);

check(
  "T-07 marketing-send writes one idempotent chat message for event_buyers",
  marketingSend !== null &&
    /function writeBlastIntoEventChat/.test(marketingSend) &&
    /audience\.query_definition\.kind !== "event_buyers"/.test(marketingSend) &&
    /marketing_campaign_id: campaign\.id/.test(marketingSend) &&
    /messages_unique_blast_per_conversation|messageError\.code === "23505"/.test(marketingSend) &&
    /CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_blast_per_conversation/.test(migration ?? ""),
  "Blast-to-chat helper and UNIQUE partial index must be present.",
);

check(
  "T-08 RLS extends trip/event read, broadcast-only, and moderation policies",
  migration !== null &&
    /linked_entity_type IN \('trip', 'event'\)/.test(migration) &&
    /CREATE POLICY messages_broadcast_only_enforcement[\s\S]*?AS RESTRICTIVE/.test(migration) &&
    /CREATE POLICY messages_brand_team_member_insert/.test(migration) &&
    /CREATE POLICY conversation_participants_brand_team_member_read/.test(migration) &&
    /CREATE POLICY conversations_brand_team_member_update/.test(migration) &&
    /CREATE POLICY conversation_participants_brand_team_member_delete/.test(migration) &&
    /CREATE POLICY messages_brand_team_member_update/.test(migration),
  "RLS must cover event-linked reads, brand team send/list, broadcast-only, toggle, participant removal, and soft-delete.",
);

check(
  "T-09 consumer services and hooks expose event conversation lookup and claims",
  messaging !== null &&
    /getOrCreateGroupConversationForEvent/.test(messaging) &&
    /\.eq\('event_id', eventId\)[\s\S]*?\.in\('linked_entity_type', \['trip', 'event'\]\)/.test(messaging) &&
    /fetchPendingChatClaims/.test(messaging) &&
    /claimPendingTripChats/.test(messaging) &&
    claimsHook !== null,
  "Consumer service and hook layer must expose trip/event chat and claim helpers.",
);

check(
  "T-10 countdown banner renders from events_with_master_date_view and is slotted in MessageInterface",
  countdownHook !== null &&
    /events_with_master_date_view/.test(countdownHook) &&
    /master_start_at/.test(countdownHook) &&
    countdownBanner !== null &&
    /TripCountdownBanner/.test(messageInterface ?? "") &&
    /friend\.linkedEntityType === "trip" \|\| friend\.linkedEntityType === "event"/.test(messageInterface ?? ""),
  "Countdown hook/banner must exist and render only for trip/event group chats.",
);

check(
  "T-11 onboarding step 6 surfaces pending trip/event chat claims",
  onboarding !== null &&
    /usePendingTripChatClaims/.test(onboarding) &&
    /Your trip and event chats/.test(onboarding) &&
    /Join chat/.test(onboarding) &&
    /mingla:\/\/chat\//.test(onboarding),
  "OnboardingCollaborationStep must render pending claim cards and navigate to claimed chat.",
);

check(
  "T-12 deep links handle mingla://chat and https://usemingla.com/orders/<id>/chat",
  deepLinks !== null &&
    /case 'chat'/.test(deepLinks) &&
    /case 'orders'/.test(deepLinks) &&
    /claimPendingTripChats/.test(deepLinks) &&
    /handleDeepLink\(url\)/.test(appIndex ?? "") &&
    /pathPrefix": "\/orders"/.test(appJson ?? "") &&
    /pathPrefix": "\/chat"/.test(appJson ?? ""),
  "Parser, app executor, and Android intent filters must include chat/order paths.",
);

check(
  "T-13 business group chat tile, route, panel, services, and moderation exist",
  groupService !== null &&
    /getEventGroupChat/.test(groupService) &&
    /postPlannerMessage/.test(groupService) &&
    /setBroadcastOnly/.test(groupService) &&
    /removeParticipant/.test(groupService) &&
    /deleteMessage/.test(groupService) &&
    groupHook !== null &&
    moderationHook !== null &&
    groupPanel !== null &&
    moderationSheet !== null &&
    groupRoute !== null &&
    /label="Group chat"/.test(tripPage ?? "") &&
    /label="Group chat"/.test(eventPage ?? ""),
  "Business app must expose the tile, route, panel, message composer, and moderation actions.",
);

check(
  "T-14 buyer confirmation page and email include Download Mingla CTA",
  checkoutCta !== null &&
    /https:\/\/usemingla\.com\/orders\/\$\{orderId\}\/chat/.test(checkoutCta) &&
    /<DownloadMinglaCta/.test(checkoutConfirm ?? "") &&
    /renderDownloadAppCta/.test(ticketBody ?? "") &&
    /usemingla\.com\/orders\/.*\/chat/.test(ticketBody ?? ""),
  "Checkout confirmation page and event email body must include the app/chat CTA.",
);

check(
  "T-15 backfill uses row-count RAISE EXCEPTION and keeps experience out of scope",
  migration !== null &&
    /RAISE EXCEPTION 'ORCH-0897 backfill row-count mismatch/.test(migration) &&
    /WHERE e\.event_type IN \('event', 'trip'\)/.test(migration) &&
    !/event_type IN \('event', 'trip', 'experience'\)/.test(migration),
  "Backfill must assert counts and must not include experience.",
);

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log(`  ${c.detail}`);
}

if (failed.length > 0) {
  console.error(`\nORCH-0897 regression check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`\nORCH-0897 regression check passed: ${checks.length}/${checks.length}`);
