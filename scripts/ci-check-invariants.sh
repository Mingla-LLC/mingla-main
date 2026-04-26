#!/bin/bash
# ORCH-0640 ch15 — CI invariant grep gates.
# Enforces 7 invariants established in ORCH-0640 (I-POOL-ONLY-SERVING,
# I-BOUNCER-IS-QUALITY-GATE, I-THREE-GATE-SERVING, I-GEOCODING-VS-SERVING-BOUNDARY,
# I-PLACE-ID-CONTRACT, I-CURATED-STOP-INTEGRITY, I-ENGAGEMENT-IDENTITY-PLACE-LEVEL).
#
# Run locally:  ./scripts/ci-check-invariants.sh
# Exit code 0 = pass, 1 = violation found.

set -e

echo "ORCH-0640 CI invariant check..."
FAIL=0

# ─── I-POOL-ONLY-SERVING: no card_pool refs outside archive/docs/Mingla_Artifacts ───
CARD_POOL_VIOLATIONS=$(git grep -l "\.from(.card_pool\|from('card_pool" \
    supabase/functions/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '_archive|\.md$|Mingla_Artifacts/|/outputs/|/prompts/' \
  || true)
if [ -n "$CARD_POOL_VIOLATIONS" ]; then
  echo "FAIL: card_pool reference found outside archive/docs:"
  echo "$CARD_POOL_VIOLATIONS"
  FAIL=1
fi

# ─── I-BOUNCER-IS-QUALITY-GATE: no ai_approved in serving code or admin frontend ───
# ORCH-0646 extension (2026-04-23): mingla-admin/src/ added after ORCH-0640 cleanup
# gap allowed ai_approved references to persist in admin pages after column drop.
# Must not regress — admin reads the same dropped column and would 500.
AI_VIOLATIONS=$(git grep -l "ai_approved\|ai_override\|ai_validated" \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    supabase/functions/get-paired-saves/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$AI_VIOLATIONS" ]; then
  echo "FAIL: AI-validation reference in serving code:"
  echo "$AI_VIOLATIONS"
  FAIL=1
fi

# ─── I-GEOCODING-VS-SERVING-BOUNDARY: Google Places only in allow-listed files ───
ALLOWED_REGEX='supabase/functions/(admin-seed-places|admin-refresh-places|admin-place-search|_shared/placesCache|_shared/textSearchHelper|_shared/photoStorageService|backfill-place-photos|admin-seed-map-strangers)|app-mobile/src/(services/geocodingService|utils/throttledGeocode)'
GOOGLE_VIOLATIONS=$(git grep -l "places\.googleapis\|maps\.googleapis" \
    supabase/ \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE "$ALLOWED_REGEX" \
  | grep -vE '\.md$' \
  || true)
if [ -n "$GOOGLE_VIOLATIONS" ]; then
  echo "FAIL: Google Places API call outside allowed surfaces:"
  echo "$GOOGLE_VIOLATIONS"
  echo "(Allowed: admin-seed-places, admin-refresh-places, admin-place-search,"
  echo " _shared/placesCache, _shared/textSearchHelper, _shared/photoStorageService,"
  echo " backfill-place-photos, admin-seed-map-strangers, geocodingService, throttledGeocode)"
  FAIL=1
fi

# ─── Legacy 2025-era tables: no .from('saves'|'experiences'|'saved_experiences') in mobile/edge ───
LEGACY_VIOLATIONS=$(git grep -lE "\.from\(.(saves|experiences|saved_experiences)." \
    supabase/functions/ \
    app-mobile/src/ \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$LEGACY_VIOLATIONS" ]; then
  echo "FAIL: legacy saves/experiences/saved_experiences table reference:"
  echo "$LEGACY_VIOLATIONS"
  FAIL=1
fi

# ─── Deleted services: no imports from experiencesService, experienceGenerationService, savesService, useExperiences ───
DELETED_IMPORT_VIOLATIONS=$(git grep -l "from ['\"].*\\(experiencesService\\|experienceGenerationService\\|savesService\\|useExperiences\\)['\"]" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$DELETED_IMPORT_VIOLATIONS" ]; then
  echo "FAIL: import from deleted service/hook:"
  echo "$DELETED_IMPORT_VIOLATIONS"
  FAIL=1
fi

# ─── ORCH-0649: I-NO-FABRICATED-DISPLAY-N/A ───────────────────────────────────
# Forbid the literal string "N/A" as a fallback default for display strings
# in saved-card / calendar / session-view ExpandedCardData constructors.
# Constitution #9 — never show fabricated data to users. Hide the pill if
# no real value exists.
echo "Checking I-NO-FABRICATED-DISPLAY-N/A..."
NA_HITS=$(grep -rEn '\|\|\s*"N/A"' \
    app-mobile/src/components/activity/SavedTab.tsx \
    app-mobile/src/components/activity/CalendarTab.tsx \
    app-mobile/src/components/SessionViewModal.tsx \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$NA_HITS" ]; then
  echo "FAIL: I-NO-FABRICATED-DISPLAY-N/A violated. ORCH-0649 forbids '|| \"N/A\"'"
  echo "   defaulting for display strings in these files. Hit lines:"
  echo "$NA_HITS"
  FAIL=1
fi

# ─── ORCH-0659/0660: I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME ────────────────
# Forbid hardcoded distanceKm: 0 / travelTimeMin: 0 sentinels in any
# deck-serving edge function transformer. The transformer must compute
# haversine + per-mode estimate, or set both to null. Never 0.
echo "Checking I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (edge fn)..."
DECK_ZERO_HITS=$(grep -rEn 'distanceKm:\s*0,|travelTimeMin:\s*0,' \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$DECK_ZERO_HITS" ]; then
  echo "FAIL: I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME violated. ORCH-0659/0660"
  echo "   forbids 'distanceKm: 0,' or 'travelTimeMin: 0,' literals in edge"
  echo "   fn card transformers. Compute haversine + estimate, or set null."
  echo "   Hit lines:"
  echo "$DECK_ZERO_HITS"
  FAIL=1
fi

# ─── ORCH-0659: forbid '|| t(...nearby)' fallback in render code ───────────
# Constitution #9 — never fabricate display values. Hide the badge when
# distance is null instead of showing a "nearby" placeholder.
echo "Checking I-NO-NEARBY-FALLBACK..."
NEARBY_HITS=$(grep -rEn "\|\|\s*t\(['\"]cards:swipeable\.nearby['\"]\)|\|\|\s*t\(['\"]expanded_details:card_info\.nearby['\"]\)" \
    app-mobile/src/components/SwipeableCards.tsx \
    app-mobile/src/components/expandedCard/CardInfoSection.tsx \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$NEARBY_HITS" ]; then
  echo "FAIL: I-NO-NEARBY-FALLBACK violated. ORCH-0659 forbids"
  echo "   '|| t(...nearby)' fallback in render path — hide the badge"
  echo "   on null instead. Hit lines:"
  echo "$NEARBY_HITS"
  FAIL=1
fi

# ORCH-0659/0660 rework v2: also forbid hardcoded 'Nearby' literal at
# parseAndFormatDistance:196 (returned for missing/malformed input). The
# function MUST return empty string so render-layer truthy guards hide
# the pill. Lines 223/230/238 ('Nearby' for genuinely-tiny distances)
# are intentionally not gated — defensible UX, deferred to ORCH-0673 i18n.
NEARBY_FORMATTER_HITS=$(grep -nE "if \(!distanceString.*return 'Nearby'" \
    app-mobile/src/components/utils/formatters.ts \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$NEARBY_FORMATTER_HITS" ]; then
  echo "FAIL: I-NO-NEARBY-FALLBACK violated (formatter). ORCH-0659/0660 rework v2"
  echo "   forbids 'return Nearby' on the missing-input branch of"
  echo "   parseAndFormatDistance. Return empty string so callers hide the pill."
  echo "   Hit lines:"
  echo "$NEARBY_FORMATTER_HITS"
  FAIL=1
fi

# ─── ORCH-0659/0660: forbid timeAway field resurrection ────────────────────
# Constitution #2 — single owner per truth. timeAway was deleted; travelTime
# is the single source. Reintroduction would re-create the dual-shape bug.
echo "Checking timeAway field resurrection..."
TIMEAWAY_HITS=$(git grep -nE "timeAway\s*[:=]" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$TIMEAWAY_HITS" ]; then
  echo "FAIL: timeAway field reintroduced. ORCH-0659/0660 deleted it because"
  echo "   it duplicated travelTime with a '0 min' sentinel. Use travelTime"
  echo "   only. Hit lines:"
  echo "$TIMEAWAY_HITS"
  FAIL=1
fi

# ─── ORCH-0664: I-DEDUP-AFTER-DELIVERY ────────────────────────────────────
# Forbid pre-emptive `broadcastSeenIds.current.add(...)` inside the broadcast
# event handler in useBroadcastReceiver.ts. The seen-set MUST be populated by
# the delegate (ConnectionsPage.addIncomingMessageToUI) AFTER the message is
# added to UI state. Pre-emptive population was the root cause of ORCH-0664:
# the broadcast handler marked the id as "delivered" while the delegate was
# a no-op, then postgres_changes saw the seen flag and silently skipped the
# setMessages add. Result: every DM receiver dropped every incoming message.
echo "Checking I-DEDUP-AFTER-DELIVERY..."
DEDUP_HITS=$(grep -nE "broadcastSeenIds\.current\.add\(" \
    app-mobile/src/hooks/useBroadcastReceiver.ts \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$DEDUP_HITS" ]; then
  echo "FAIL: I-DEDUP-AFTER-DELIVERY violated. ORCH-0664 forbids"
  echo "   'broadcastSeenIds.current.add(' inside useBroadcastReceiver.ts."
  echo "   Population belongs in the delegate (ConnectionsPage."
  echo "   addIncomingMessageToUI), AFTER setMessages succeeds. Hit lines:"
  echo "$DEDUP_HITS"
  FAIL=1
fi

# ----------------------------------------------------------------------------
# ORCH-0667 — Forbid the toast-only "Share Saved Card" stub from coming back.
# The original stub at AppHandlers.tsx:340-355 fired i18n.t('common:toast_card_shared*')
# without doing any real send work — Constitution #1 (dead tap), #3 (silent
# fake-success), #9 (fabricated state). Replaced by the real picker flow in
# MessageInterface (sendCardMessage). These gates keep it dead.
# ----------------------------------------------------------------------------
echo "Checking I-NO-TOAST-CARD-SHARED-STRINGS..."
TOAST_KEY_HITS=$(grep -rnE "toast_card_shared" \
    app-mobile/src/ \
    --include='*.ts' --include='*.tsx' --include='*.json' \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$TOAST_KEY_HITS" ]; then
  echo "FAIL: ORCH-0667 — stale 'toast_card_shared' i18n key detected."
  echo "   The lying success toast was deleted from all 28 locales."
  echo "   Real flow lives in MessageInterface.handleSelectCardToShare which"
  echo "   uses chat:cardSentToast / chat:cardShareFailedToast based on real"
  echo "   send result. Constitution #8 (subtract before adding) violation."
  echo "   Hit lines:"
  echo "$TOAST_KEY_HITS"
  FAIL=1
fi

echo "Checking I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS (sender path)..."
# Forbid direct .insert({ message_type: 'card', ... }) anywhere except
# messagingService.sendCardMessage. The trim function + service guard are the
# only sanctioned write paths — bypassing them risks card_payload missing or
# untrimmed (>5KB, fabricated recipient-relative fields, etc.).
CARD_INSERT_HITS=$(grep -rnE "message_type:\s*['\"]card['\"]" \
    app-mobile/src/ \
    --include='*.ts' --include='*.tsx' \
    2>/dev/null \
  | grep -v 'src/services/messagingService.ts' \
  | grep -v '__test_gate' \
  || true)
if [ -n "$CARD_INSERT_HITS" ]; then
  echo "FAIL: ORCH-0667 — direct card-message INSERT found outside messagingService.sendCardMessage."
  echo "   I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS requires every card-type"
  echo "   message to flow through trimCardPayload (size guard + Constitution #9"
  echo "   field exclusion). Hit lines:"
  echo "$CARD_INSERT_HITS"
  FAIL=1
fi

# ─────────────────────────────────────────────────────────────────────
# I-RPC-LANGUAGE-SQL-FOR-HOT-PATH (ORCH-0668)
# Forbid LANGUAGE plpgsql for hot-path RPCs unless explicitly allowlisted
# with plan_cache_mode = force_custom_plan + justification.
# ─────────────────────────────────────────────────────────────────────
echo "Checking I-RPC-LANGUAGE-SQL-FOR-HOT-PATH..."

HOT_PATH_RPCS=(
  "query_person_hero_places_by_signal"
  "query_servable_places_by_signal"
  "fetch_local_signal_ranked"
)

LANG_VIOLATIONS=""
for fn in "${HOT_PATH_RPCS[@]}"; do
  # Find the LATEST migration that defines this function
  latest=$(grep -lE "FUNCTION public\.${fn}\(" supabase/migrations/*.sql 2>/dev/null \
           | sort -r | head -1)

  if [ -z "$latest" ]; then
    LANG_VIOLATIONS="$LANG_VIOLATIONS\n  $fn (no defining migration found)"
    continue
  fi

  # The defining migration must be LANGUAGE sql, OR LANGUAGE plpgsql with
  # plan_cache_mode = force_custom_plan AND a CRITICAL justification block.
  if grep -E "LANGUAGE[[:space:]]+sql" "$latest" > /dev/null 2>&1; then
    continue   # SQL — passes
  fi

  if grep -E "LANGUAGE[[:space:]]+plpgsql" "$latest" > /dev/null 2>&1; then
    if grep -E "plan_cache_mode[[:space:]]*=[[:space:]]*force_custom_plan" "$latest" > /dev/null 2>&1 \
       && grep -E "I-RPC-LANGUAGE-SQL-FOR-HOT-PATH" "$latest" > /dev/null 2>&1; then
      continue   # plpgsql with required overrides — passes
    fi
    LANG_VIOLATIONS="$LANG_VIOLATIONS\n  $fn ($latest is plpgsql without overrides)"
  fi
done

if [ -n "$LANG_VIOLATIONS" ]; then
  echo "FAIL: I-RPC-LANGUAGE-SQL-FOR-HOT-PATH violation(s):"
  printf '%b\n' "$LANG_VIOLATIONS"
  echo "  Hot-path RPCs must be LANGUAGE sql STABLE, OR plpgsql with"
  echo "  SET plan_cache_mode = force_custom_plan AND a comment block"
  echo "  containing 'I-RPC-LANGUAGE-SQL-FOR-HOT-PATH' justifying plpgsql."
  echo "  See INVARIANT_REGISTRY.md and ORCH-0668 for context."
  FAIL=1
fi

# ─── ORCH-0666: I-INVITE-CREATION-IS-RPC-ONLY ───────────────────────────────
# Direct INSERTs into collaboration_invites from mobile code are forbidden.
# Use the `add_friend_to_session` SECURITY DEFINER RPC via
# `services/sessionMembershipService` instead. Phone-cold-path is allowed in
# its own service for `pending_session_invites` (different table).
INVITE_INSERT_VIOLATIONS=$(git grep -lE "\.from\(['\"]collaboration_invites['\"]\)\s*\.insert\(|from\(['\"]collaboration_invites['\"]\)\.\s*insert\(" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE '\.test\.|\.spec\.|__tests__/|\.md$' \
  || true)
if [ -n "$INVITE_INSERT_VIOLATIONS" ]; then
  echo "FAIL: I-INVITE-CREATION-IS-RPC-ONLY violation — direct INSERT into collaboration_invites:"
  echo "$INVITE_INSERT_VIOLATIONS"
  echo "  Use sessionMembershipService.addFriendsToSessions (which calls the"
  echo "  add_friend_to_session SECURITY DEFINER RPC) instead. See ORCH-0666."
  FAIL=1
fi

# ─── ORCH-0666: I-NO-FAKE-API-DELAY ─────────────────────────────────────────
# No setTimeout-based API simulation in production component files.
# The literal phrase "Simulate API call delay" is the smoking gun for the
# AddToBoardModal placeholder that shipped to prod for 7 weeks.
FAKE_DELAY_VIOLATIONS=$(git grep -l "Simulate API call delay" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -vE '\.test\.|\.spec\.|__tests__/|\.md$' \
  || true)
if [ -n "$FAKE_DELAY_VIOLATIONS" ]; then
  echo "FAIL: I-NO-FAKE-API-DELAY violation — placeholder API delay found:"
  echo "$FAKE_DELAY_VIOLATIONS"
  echo "  Remove the simulated delay and call a real service. See ORCH-0666."
  FAIL=1
fi

# ─── ORCH-0669: I-CHROME-HAIRLINE-SUB-PERCEPTIBLE ───────────────────────────
# Forbid inline borderColor with white alpha >= 0.09 in any chrome consumer
# file. Chrome perimeter borders MUST consume glass.chrome.border.hairline
# (locked at 0.06 alpha) by token reference. Applies to Glass*.tsx in
# components/ and components/ui/, plus MessageInterface.tsx (which shares
# the home-chrome design language for its input capsule per spec §2 v2).
# See SPEC_ORCH-0669_HOME_CHROME_HAIRLINE.md §6 + §10.1.
echo "Checking I-CHROME-HAIRLINE-SUB-PERCEPTIBLE..."
HAIRLINE_HITS=$(grep -rEn "borderColor:[[:space:]]*['\"]rgba\([[:space:]]*255[[:space:]]*,[[:space:]]*255[[:space:]]*,[[:space:]]*255[[:space:]]*,[[:space:]]*0\.(0[9]|[1-9])" \
    app-mobile/src/components/Glass*.tsx \
    app-mobile/src/components/ui/Glass*.tsx \
    app-mobile/src/components/MessageInterface.tsx \
    2>/dev/null \
  | grep -v '__test_gate' \
  | grep -v '__not_chrome__' \
  || true)
if [ -n "$HAIRLINE_HITS" ]; then
  echo "FAIL: I-CHROME-HAIRLINE-SUB-PERCEPTIBLE violated. ORCH-0669 forbids"
  echo "   inline borderColor with white alpha >= 0.09 on chrome files."
  echo "   Chrome perimeters MUST consume glass.chrome.border.hairline by"
  echo "   reference (currently locked at 0.06). Hit lines:"
  echo "$HAIRLINE_HITS"
  FAIL=1
fi

# ─── ORCH-0677: I-CURATED-REVERSEANCHOR-NEEDS-COMBOS ───────────────────────
# Any EXPERIENCE_TYPES typedef with `reverseAnchor: true` must have
# `combos.length >= 2`. Single-combo + reverseAnchor = no fallback variety
# when an anchor fails (root cause of picnic-dates stuck-curating bug).
# Delegated to a Deno script that imports EXPERIENCE_TYPES so the check
# remains robust across typedef refactors. Skipped if `deno` not installed.
if command -v deno >/dev/null 2>&1; then
  echo "Checking I-CURATED-REVERSEANCHOR-NEEDS-COMBOS..."
  if ! deno run --allow-read \
      supabase/functions/generate-curated-experiences/_lint_invariants.ts \
      >/dev/null 2>&1; then
    echo "FAIL: I-CURATED-REVERSEANCHOR-NEEDS-COMBOS violated. Re-run:"
    echo "   deno run --allow-read supabase/functions/generate-curated-experiences/_lint_invariants.ts"
    echo "   for details. ORCH-0677 — picnic-dates regression class."
    FAIL=1
  fi
else
  echo "  (deno not on PATH — I-CURATED-REVERSEANCHOR-NEEDS-COMBOS skipped)"
fi

if [ $FAIL -eq 1 ]; then
  echo ""
  echo "ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 / ORCH-0664 / ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0669 / ORCH-0677 invariant check FAILED."
  exit 1
fi

echo "All ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 / ORCH-0664 / ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0669 / ORCH-0677 invariant gates pass."
exit 0
