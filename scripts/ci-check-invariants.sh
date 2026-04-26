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

# ─── ORCH-0671: I-LABEL-MATCHES-PREDICATE ───────────────────────────────────
# No "AI Approved" / "AI Validated" labels in admin UI. Underlying data is the
# bouncer signal (is_servable); the legacy ai_approved column was dropped by
# ORCH-0640. Inverse-naming = Constitution #9 violation (operator-trust framing).
# See SPEC_ORCH-0671_PHOTO_POOL_DELETE_AND_RELABEL.md §6 + §3.7 Gate 1.
echo "Checking I-LABEL-MATCHES-PREDICATE..."
LABEL_VIOLATIONS=$(git grep -lE "AI[ -]?(Approved|Validated)" \
    mingla-admin/src/ \
    2>/dev/null \
  | grep -vE '\.md$' \
  || true)
if [ -n "$LABEL_VIOLATIONS" ]; then
  echo "FAIL: I-LABEL-MATCHES-PREDICATE violation(s):"
  echo "  Admin UI label says 'AI Approved' or 'AI Validated' but the data is the"
  echo "  bouncer signal. Rename to 'Bouncer Approved' or 'Servable'."
  echo "$LABEL_VIOLATIONS"
  FAIL=1
fi

# ─── ORCH-0671: I-OWNER-PER-OPERATION-TYPE ──────────────────────────────────
# Every value allowed by admin_backfill_log.operation_type CHECK constraint MUST
# have >=1 consumer in supabase/functions/. New operation_type values without a
# consumer create zombie pending rows (per ORCH-0671's 17 zombies, $3,283.98
# estimated, $0 actual API spend).
echo "Checking I-OWNER-PER-OPERATION-TYPE..."
# ORCH-0671: exclude *ROLLBACK*.sql files from scan — they're emergency-only
# manual-apply migrations that intentionally restore pre-cutover state and
# would falsely re-trip gates the cutover migration just resolved.
LATEST_OP_CONSTRAINT=$(ls -1 supabase/migrations/*.sql 2>/dev/null \
  | grep -v ROLLBACK \
  | xargs grep -l "admin_backfill_log_operation_type_check" 2>/dev/null \
  | sort -r | head -1)
if [ -n "$LATEST_OP_CONSTRAINT" ]; then
  # ORCH-0671: extract values from the CHECK constraint definition specifically
  # (using surrounding lines around "ADD CONSTRAINT") to avoid picking up
  # operation_type filters in DELETE / SELECT / DO-block assertions elsewhere
  # in the same file.
  ALLOWED_VALUES=$(grep -A 2 "ADD CONSTRAINT admin_backfill_log_operation_type_check" "$LATEST_OP_CONSTRAINT" \
    | grep -oE "operation_type[[:space:]]*(=|IN)[[:space:]]*\(?'[^']+'(,[[:space:]]*'[^']+')*\)?" \
    | tail -1 \
    | grep -oE "'[^']+'" \
    | tr -d "'")
  for op_value in $ALLOWED_VALUES; do
    # ORCH-0671: regex tolerates JS/TS supabase client pattern
    #   .eq("operation_type", "place_refresh")
    # which has a closing quote on the column name before the comma+value.
    CONSUMER_COUNT=$(git grep -lE "operation_type[\"']?[[:space:]]*[,=]?[[:space:]]*[\"']${op_value}[\"']" \
        supabase/functions/ \
        2>/dev/null | wc -l)
    if [ "$CONSUMER_COUNT" -lt 1 ]; then
      echo "FAIL: I-OWNER-PER-OPERATION-TYPE violation:"
      echo "  admin_backfill_log.operation_type allows '$op_value' but no consumer in supabase/functions/"
      FAIL=1
    fi
  done
fi

# ─── ORCH-0671: I-PHOTO-FILTER-EXPLICIT-EXTENSION ───────────────────────────
# Every Postgres function named admin_*photo* MUST gate aggregations on
# is_servable IS TRUE. Exception: function bodies containing the literal string
# 'RAW POOL VIEW' justify intentional unfiltered aggregation. Per ORCH-0671,
# the deleted Photo Pool page's 5 RPCs filtered only on is_active and produced
# 65-95% noise from bouncer-rejected places.
echo "Checking I-PHOTO-FILTER-EXPLICIT-EXTENSION..."
# ORCH-0671: exclude *ROLLBACK*.sql files — rollback intentionally restores
# pre-cutover bouncer-blind RPCs that this gate would otherwise re-flag.
PHOTO_RPC_FILES=$(grep -lE "CREATE (OR REPLACE )?FUNCTION public\.admin_[a-z_]*photo[a-z_]*" \
  supabase/migrations/*.sql 2>/dev/null \
  | grep -v ROLLBACK \
  | sort -r)
PHOTO_VIOLATIONS=""
for f in $PHOTO_RPC_FILES; do
  FN_NAMES=$(grep -oE "CREATE (OR REPLACE )?FUNCTION public\.admin_[a-z_]*photo[a-z_]*" "$f" \
    | sed -E 's/CREATE (OR REPLACE )?FUNCTION public\.//')
  for fn_name in $FN_NAMES; do
    LATEST_FOR_FN=$(grep -lE "CREATE (OR REPLACE )?FUNCTION public\.${fn_name}" \
      supabase/migrations/*.sql 2>/dev/null | grep -v ROLLBACK | sort -r | head -1)
    if [ "$f" != "$LATEST_FOR_FN" ]; then continue; fi
    # ORCH-0671 enhancement: skip if a LATER migration DROPs the function (function
    # no longer exists live in DB; the historical CREATE is dead code in source).
    # This handles the post-deletion case where the spec gate would otherwise
    # falsely flag historical CREATE migrations after a clean DROP. Documented
    # as Discovery D-1 in IMPLEMENTATION_ORCH-0671_REPORT.md (spec §3.7 gate logic gap).
    LATEST_DROP=$(grep -lE "DROP FUNCTION (IF EXISTS )?public\.${fn_name}" \
      supabase/migrations/*.sql 2>/dev/null | grep -v ROLLBACK | sort -r | head -1)
    if [ -n "$LATEST_DROP" ] && [[ "$LATEST_DROP" > "$f" ]]; then continue; fi
    if ! grep -E "is_servable|RAW POOL VIEW" "$f" > /dev/null 2>&1; then
      PHOTO_VIOLATIONS="$PHOTO_VIOLATIONS\n  $fn_name (defined in $f) lacks is_servable filter and no RAW POOL VIEW comment"
    fi
  done
done
if [ -n "$PHOTO_VIOLATIONS" ]; then
  echo "FAIL: I-PHOTO-FILTER-EXPLICIT-EXTENSION violation(s):"
  printf '%b\n' "$PHOTO_VIOLATIONS"
  echo "  Every admin_*photo* RPC must filter on is_servable IS TRUE,"
  echo "  OR the function body must contain a 'RAW POOL VIEW' comment justifying"
  echo "  the unfiltered aggregation (rare; e.g. admin tooling that intentionally"
  echo "  needs to see the entire pool including bouncer-rejected places)."
  FAIL=1
fi

# ─── ORCH-0678: I-PRE-PHOTO-BOUNCER-SOLE-WRITER ─────────────────────────────
# Only run-pre-photo-bouncer/index.ts may write to passes_pre_photo_check (plus
# the one-time backfill UPDATE in the ORCH-0678 migration). Any other writer
# breaks Constitutional #2 (one owner per truth) for the new column.
echo "Checking I-PRE-PHOTO-BOUNCER-SOLE-WRITER..."
PRE_PHOTO_LEAKS=$(grep -rln "passes_pre_photo_check" \
    supabase/functions/ \
    2>/dev/null \
  | grep -v 'supabase/functions/run-pre-photo-bouncer/' \
  | grep -v 'supabase/functions/backfill-place-photos/' \
  | grep -v '__test_gate' \
  || true)
if [ -n "$PRE_PHOTO_LEAKS" ]; then
  # backfill-place-photos READS the column for its eligibility gate; that's
  # allowed. This gate catches WRITES specifically — narrow the check below.
  PRE_PHOTO_WRITES=$(grep -rln "\.update.*passes_pre_photo_check\|passes_pre_photo_check\s*:\s*\(true\|false\|verdict\)" \
      supabase/functions/ \
      2>/dev/null \
    | grep -v 'supabase/functions/run-pre-photo-bouncer/' \
    | grep -v '__test_gate' \
    || true)
  if [ -n "$PRE_PHOTO_WRITES" ]; then
    echo "FAIL: I-PRE-PHOTO-BOUNCER-SOLE-WRITER violated. Only run-pre-photo-bouncer"
    echo "   may write passes_pre_photo_check. Other write-site detected:"
    echo "$PRE_PHOTO_WRITES"
    FAIL=1
  fi
fi

# ─── ORCH-0678: I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO ─────────────────────────
# backfill-place-photos must gate eligibility on passes_pre_photo_check (mode
# 'pre_photo_passed') or is_servable (mode 'refresh_servable'). The legacy
# no-action handleLegacy route was deleted; POSTing without an action returns
# HTTP 400. This gate catches resurrection of either pattern.
echo "Checking I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO..."
LEGACY_HANDLER_HITS=$(grep -nE "function handleLegacy\(|return handleLegacy\(" \
    supabase/functions/backfill-place-photos/index.ts \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$LEGACY_HANDLER_HITS" ]; then
  echo "FAIL: I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO violated. ORCH-0678 retired"
  echo "   handleLegacy. Photo backfill must always go through the action-based"
  echo "   modes (pre_photo_passed | refresh_servable). Hit lines:"
  echo "$LEGACY_HANDLER_HITS"
  FAIL=1
fi
# Forbid resurrection of the dropped RPCs as callers in code.
LEGACY_RPC_HITS=$(grep -rnE "rpc\(['\"]get_places_needing_photos['\"]\)|rpc\(['\"]count_places_needing_photos['\"]\)" \
    supabase/functions/ \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$LEGACY_RPC_HITS" ]; then
  echo "FAIL: I-PHOTO-DOWNLOAD-GATES-ON-PRE-PHOTO violated. ORCH-0678 dropped"
  echo "   get_places_needing_photos + count_places_needing_photos. Resurrection"
  echo "   detected:"
  echo "$LEGACY_RPC_HITS"
  FAIL=1
fi

# ─── ORCH-0678: I-TWO-PASS-BOUNCER-RULE-PARITY ──────────────────────────────
# The Bouncer rule body in _shared/bouncer.ts is the single source of truth
# for both passes. Hand-rolled rule keywords (B7:no_google_photos, B8:no_stored_photos,
# B5:social_only, etc.) must NOT appear in any other source file outside the
# canonical locations (the bouncer module + its tests + the two runner edge fns
# that pass verdicts through, + backfill-place-photos which logs reasons).
echo "Checking I-TWO-PASS-BOUNCER-RULE-PARITY..."
RULE_DUPLICATION=$(grep -rln "B8:no_stored_photos\|B7:no_google_photos\|B5:social_only" \
    supabase/functions/ \
    2>/dev/null \
  | grep -v 'supabase/functions/_shared/bouncer.ts' \
  | grep -v 'supabase/functions/_shared/__tests__/' \
  | grep -v 'supabase/functions/run-bouncer/' \
  | grep -v 'supabase/functions/run-pre-photo-bouncer/' \
  | grep -v 'supabase/functions/backfill-place-photos/' \
  | grep -v '__test_gate' \
  || true)
if [ -n "$RULE_DUPLICATION" ]; then
  echo "FAIL: I-TWO-PASS-BOUNCER-RULE-PARITY violated. Bouncer rule strings"
  echo "   appear outside the canonical files (_shared/bouncer.ts is the only"
  echo "   source of truth). Hit:"
  echo "$RULE_DUPLICATION"
  FAIL=1
fi

# ─── ORCH-0686: I-DB-ENUM-CODE-PARITY ───────────────────────────────────────
# The TypeScript BackfillMode union and the SQL CHECK constraint
# photo_backfill_runs_mode_check MUST reference the same set of values. Same
# class of failure as ORCH-0540 (PL/pgSQL type-resolution drift after flag flip)
# and ORCH-0686 (TS rename without SQL update — 14,401 places stranded).
echo "Checking I-DB-ENUM-CODE-PARITY..."

DBENUM_TS_FILE="supabase/functions/backfill-place-photos/index.ts"
DBENUM_TS_VALUES=""
if [ -f "$DBENUM_TS_FILE" ]; then
  DBENUM_TS_VALUES=$(grep -E "^type BackfillMode " "$DBENUM_TS_FILE" \
    | grep -oE "'[^']+'" | tr -d "'" | sort -u | tr '\n' ' ' | xargs || true)
fi

# Find the latest non-ROLLBACK migration that defines photo_backfill_runs_mode_check.
DBENUM_SQL_FILE=$(ls supabase/migrations/*.sql 2>/dev/null \
  | grep -v ROLLBACK \
  | xargs grep -l "photo_backfill_runs_mode_check" 2>/dev/null \
  | sort | tail -n 1 || true)
DBENUM_SQL_VALUES=""
if [ -n "$DBENUM_SQL_FILE" ]; then
  # Extract the literal values from the actual CHECK (mode IN (...)) clause.
  # Match only the CHECK line + the immediate continuation, then pull single-quoted
  # tokens. Avoids matching RAISE EXCEPTION strings and LIKE '%...%' predicates
  # elsewhere in the migration.
  DBENUM_SQL_VALUES=$(awk '/CHECK[[:space:]]*\(mode[[:space:]]+IN[[:space:]]*\(/{p=1} p{print; if (/\)/) exit}' "$DBENUM_SQL_FILE" \
    | grep -oE "'[^']+'" | tr -d "'" | sort -u | tr '\n' ' ' | xargs || true)
fi

if [ -z "$DBENUM_TS_VALUES" ] || [ -z "$DBENUM_SQL_VALUES" ]; then
  echo "FAIL: I-DB-ENUM-CODE-PARITY could not extract value sets."
  echo "   TS file: $DBENUM_TS_FILE (values: '$DBENUM_TS_VALUES')"
  echo "   SQL file: $DBENUM_SQL_FILE (values: '$DBENUM_SQL_VALUES')"
  FAIL=1
else
  # Subset check: every TS value MUST appear in the SQL CHECK clause.
  # SQL may carry additional legacy values not in TS (e.g., 'initial' kept as a
  # legacy alias for historical rows that TS code no longer writes — see
  # ORCH-0686 spec §3.6 + test case T-02). The bug class this gate prevents is
  # TS additions/renames that never reach SQL. SQL-only legacy values are fine.
  DBENUM_MISSING=""
  for v in $DBENUM_TS_VALUES; do
    if ! echo " $DBENUM_SQL_VALUES " | grep -q " $v "; then
      DBENUM_MISSING="$DBENUM_MISSING $v"
    fi
  done
  if [ -n "$DBENUM_MISSING" ]; then
    echo "FAIL: I-DB-ENUM-CODE-PARITY violated."
    echo "   BackfillMode TS values ($DBENUM_TS_FILE): $DBENUM_TS_VALUES"
    echo "   CHECK constraint SQL values ($DBENUM_SQL_FILE): $DBENUM_SQL_VALUES"
    echo "   Missing from SQL CHECK clause:$DBENUM_MISSING"
    echo "   Every TS BackfillMode value MUST be present in the SQL CHECK clause."
    echo "   Update the migration to include the missing value(s)."
    FAIL=1
  else
    echo "  OK (TS=[$DBENUM_TS_VALUES] subset-of SQL=[$DBENUM_SQL_VALUES])"
  fi
fi

# ─── ORCH-0684: I-PERSON-HERO-RPC-USES-USER-PARAMS ───────────────────────
# query_person_hero_places_by_signal must reference both p_user_id and
# p_person_id in its body (not just declare them). Catches future
# regressions where the personalization JOINs are accidentally removed.
# Threshold ≥3 each: 1 in parameter declaration + ≥2 in body uses
# (saves filter + visits filter in the personalization layer).
echo "[invariants] Checking I-PERSON-HERO-RPC-USES-USER-PARAMS..."
PERSON_HERO_RPC_FILE=$(ls supabase/migrations/*orch_0684_person_hero_personalized.sql 2>/dev/null | tail -1)
if [ -z "$PERSON_HERO_RPC_FILE" ]; then
  echo "  WARN: ORCH-0684 migration file not found — gate inactive (acceptable until merged)"
else
  # Require the structural personalization JOINs that consume the user params:
  # one for saved_card (saves CTE) and one for user_visits (visits CTE). Both
  # must filter on (p_user_id, p_person_id). If either is missing, the
  # personalization layer has been gutted and RC-3 has regressed.
  SAVES_JOIN=$(grep -E "saved_card.*sc.*profile_id.*IN.*\(p_user_id.*p_person_id\)" "$PERSON_HERO_RPC_FILE" \
    || grep -B0 -A4 "saved_card sc" "$PERSON_HERO_RPC_FILE" | grep -E "profile_id.*IN.*\(p_user_id" || true)
  VISITS_JOIN=$(grep -E "user_visits.*uv.*user_id.*IN.*\(p_user_id.*p_person_id\)" "$PERSON_HERO_RPC_FILE" \
    || grep -B0 -A4 "user_visits uv" "$PERSON_HERO_RPC_FILE" | grep -E "user_id.*IN.*\(p_user_id" || true)
  if [ -z "$SAVES_JOIN" ] || [ -z "$VISITS_JOIN" ]; then
    echo "  FAIL: $PERSON_HERO_RPC_FILE missing structural personalization JOINs."
    [ -z "$SAVES_JOIN" ]  && echo "    - saved_card JOIN filtered by IN (p_user_id, p_person_id) NOT FOUND"
    [ -z "$VISITS_JOIN" ] && echo "    - user_visits JOIN filtered by IN (p_user_id, p_person_id) NOT FOUND"
    echo "    Reverting these eliminates D-Q2 Option B personalization (RC-3 regression)."
    FAIL=1
  else
    echo "  OK (saves + visits joint-pair JOINs present)"
  fi
fi

# ─── ORCH-0684: I-RPC-RETURN-SHAPE-MATCHES-CONSUMER ──────────────────────
# get-person-hero-cards's mapPlacePoolRowToCard must read place_pool fields
# (snake_case Google shape: name, stored_photo_urls, primary_type, price_level,
# opening_hours, etc.) and MUST NOT read deleted card_pool ghost fields
# (raw.title / raw.image_url / raw.category_slug / raw.price_tier / raw.tagline
# / raw.total_price_min/max / raw.estimated_duration_minutes / raw.experience_type
# / raw.shopping_list / raw.card_type).
#
# We isolate only the mapPlacePoolRowToCard function body via awk and then grep
# inside it. The curatedCardToCard helper in the same file legitimately reads
# similarly-named fields from the curated-experiences edge fn output (not
# place_pool), so it is excluded by the function-scope extraction.
echo "[invariants] Checking I-RPC-RETURN-SHAPE-MATCHES-CONSUMER..."
MAPPER_FILE="supabase/functions/get-person-hero-cards/index.ts"
if [ ! -f "$MAPPER_FILE" ]; then
  echo "  WARN: $MAPPER_FILE not found — gate inactive"
else
  # Extract the mapPlacePoolRowToCard function body via awk: start at the
  # 'function mapPlacePoolRowToCard' line, end at the matching closing brace
  # at column 0 (top-level function definition).
  MAPPER_BODY=$(awk '
    /^function mapPlacePoolRowToCard/ { in_fn=1 }
    in_fn { print }
    in_fn && /^}/ { exit }
  ' "$MAPPER_FILE")
  GHOST_REFS=$(echo "$MAPPER_BODY" \
    | grep -nE "raw\.(title|image_url|category_slug|price_tier|price_tiers|tagline|total_price_min|total_price_max|estimated_duration_minutes|experience_type|shopping_list|card_type)\b" \
    || true)
  if [ -n "$GHOST_REFS" ]; then
    echo "  FAIL: mapPlacePoolRowToCard in $MAPPER_FILE reads card_pool ghost fields:"
    echo "$GHOST_REFS"
    FAIL=1
  else
    echo "  OK"
  fi
fi

if [ $FAIL -eq 1 ]; then
  echo ""
  echo "ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 / ORCH-0664 / ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0669 / ORCH-0671 / ORCH-0677 / ORCH-0678 / ORCH-0684 / ORCH-0686 invariant check FAILED."
  exit 1
fi

echo "All ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 / ORCH-0664 / ORCH-0666 / ORCH-0667 / ORCH-0668 / ORCH-0669 / ORCH-0671 / ORCH-0677 / ORCH-0678 / ORCH-0684 / ORCH-0686 invariant gates pass."
exit 0
