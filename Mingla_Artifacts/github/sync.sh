#!/usr/bin/env bash
#
# sync.sh — idempotent GitHub Project + milestones + labels + epics + user-stories sync.
#
# Run after `gh auth login` (with scopes: repo, project, write:org).
#
#   bash Mingla_Artifacts/github/sync.sh
#
# Re-runnable. Skips already-existing items by name/title.

set -euo pipefail

# ---- Configuration ---------------------------------------------------

OWNER="Mingla-LLC"
REPO="mingla-main"
PROJECT_TITLE="Mingla Business"
DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- Helpers ---------------------------------------------------------

c_ok()   { printf "\033[32m✓ %s\033[0m\n" "$*"; }
c_skip() { printf "\033[33m· %s\033[0m\n" "$*"; }
c_step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
c_err()  { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }

require_auth() {
  if ! gh auth status >/dev/null 2>&1; then
    c_err "Not authenticated. Run: gh auth login"
    exit 1
  fi
  c_ok "Authenticated"
}

# ---- 1. Auth ---------------------------------------------------------

c_step "Checking gh authentication"
require_auth

# ---- 2. Project ------------------------------------------------------

c_step "Creating org-level project '$PROJECT_TITLE' (if missing)"
PROJECT_NUMBER=$(gh project list --owner "$OWNER" --format json 2>/dev/null \
  | jq -r --arg t "$PROJECT_TITLE" '.projects[] | select(.title == $t) | .number' || true)

if [ -z "$PROJECT_NUMBER" ]; then
  PROJECT_NUMBER=$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json | jq -r '.number')
  c_ok "Created project #$PROJECT_NUMBER"
else
  c_skip "Project '$PROJECT_TITLE' already exists (#$PROJECT_NUMBER)"
fi

PROJECT_URL="https://github.com/orgs/$OWNER/projects/$PROJECT_NUMBER"

# ---- 3. Labels -------------------------------------------------------

c_step "Creating labels in $OWNER/$REPO"
EXISTING_LABELS=$(gh label list --repo "$OWNER/$REPO" --limit 200 --json name | jq -r '.[].name' || echo "")

while IFS=$'\t' read -r NAME COLOR DESC; do
  [ -z "$NAME" ] && continue
  if echo "$EXISTING_LABELS" | grep -qx "$NAME"; then
    c_skip "label: $NAME"
  else
    gh label create "$NAME" --repo "$OWNER/$REPO" --color "$COLOR" --description "$DESC" >/dev/null \
      && c_ok "label: $NAME"
  fi
done < "$DIR/labels.tsv"

# ---- 4. Milestones ---------------------------------------------------

c_step "Creating milestones in $OWNER/$REPO"
EXISTING_MILESTONES=$(gh api "repos/$OWNER/$REPO/milestones?state=all&per_page=100" --jq '.[].title' || echo "")

while IFS=$'\t' read -r TITLE DESC; do
  [ -z "$TITLE" ] && continue
  if echo "$EXISTING_MILESTONES" | grep -qxF "$TITLE"; then
    c_skip "milestone: $TITLE"
  else
    gh api "repos/$OWNER/$REPO/milestones" \
      --method POST \
      -f title="$TITLE" \
      -f description="$DESC" >/dev/null \
      && c_ok "milestone: $TITLE"
  fi
done < "$DIR/milestones.tsv"

# Build a milestone-title → number map for issue creation.
declare -A MS_NUM
while IFS=$'\t' read -r NUM TITLE; do
  MS_NUM["$TITLE"]="$NUM"
done < <(gh api "repos/$OWNER/$REPO/milestones?state=all&per_page=100" --jq '.[] | "\(.number)\t\(.title)"')

# ---- 5. Epic issues --------------------------------------------------

c_step "Creating epic issues (one per cycle)"

# Format: cycle-id | title | milestone-title | extra-labels | done?
EPICS=(
  "0a|Cycle 0a — Foundation: tokens, primitives, nav, auth|Phase 1 — Foundations|cycle:0a,phase:foundations,area:platform,layer:design,layer:ui,platform:both,mvp,priority:p2|done"
  "0b|Cycle 0b — Web foundation: Expo Web auth + bundle|Phase 1 — Foundations|cycle:0b,phase:foundations,area:platform,layer:ui,platform:web,mvp,priority:p2|done"
  "1|Cycle 1 — Sign-in → Home → brand creation|Phase 2 — Core Wedge|cycle:1,phase:core-wedge,area:account,area:brand,layer:ui,platform:both,mvp,priority:p1|done"
  "2|Cycle 2 — Brands inventory: list, profile, edit, team, finance|Phase 2 — Core Wedge|cycle:2,phase:core-wedge,area:brand,layer:ui,platform:both,mvp,priority:p1|done"
  "3|Cycle 3 — Event creator wizard (the wedge cycle)|Phase 2 — Core Wedge|cycle:3,phase:core-wedge,area:event,layer:ui,platform:both,mvp,priority:p1|done"
  "4|Cycle 4 — Recurring + multi-date + per-date overrides|Phase 2 — Core Wedge|cycle:4,phase:core-wedge,area:event,layer:ui,platform:both,mvp,priority:p1|done"
  "5|Cycle 5 — Ticket types: free/paid/approval/password/waitlist + reorder + visibility|Phase 2 — Core Wedge|cycle:5,phase:core-wedge,area:tickets,layer:ui,platform:both,mvp,priority:p1|active"
  "6|Cycle 6 — Public event page + variants|Phase 3 — Public Surfaces|cycle:6,phase:public-surfaces,area:public-pages,layer:ui,platform:web,mvp,priority:p2|"
  "7|Cycle 7 — Public brand + organiser page + share modal|Phase 3 — Public Surfaces|cycle:7,phase:public-surfaces,area:public-pages,layer:ui,platform:web,mvp,priority:p2|"
  "8|Cycle 8 — Checkout flow (UI + payment stubs)|Phase 3 — Public Surfaces|cycle:8,phase:public-surfaces,area:public-pages,area:payments,layer:ui,platform:web,mvp,priority:p2|"
  "9|Cycle 9 — Event management: detail dashboard, orders, refunds, cancel|Phase 4 — Event Management|cycle:9,phase:management,area:event,area:payments,layer:ui,platform:both,mvp,priority:p2|"
  "10|Cycle 10 — Guests: pending approvals, manual add, manual check-in, attendee detail|Phase 4 — Event Management|cycle:10,phase:management,area:event,layer:ui,platform:both,mvp,priority:p2|"
  "11|Cycle 11 — Scanner mode: camera, states, manual lookup, activity log|Phase 4 — Event Management|cycle:11,phase:management,area:scanner,layer:ui,platform:mobile,mvp,priority:p2|"
  "12|Cycle 12 — Door payments: cash, card-reader, NFC, manual, receipt|Phase 4 — Event Management|cycle:12,phase:management,area:payments,layer:ui,platform:mobile,mvp,priority:p2|"
  "13|Cycle 13 — End-of-night reconciliation report|Phase 4 — Event Management|cycle:13,phase:management,area:payments,area:analytics,layer:ui,platform:both,mvp,priority:p2|"
  "14|Cycle 14 — Account: edit profile, settings, delete-flow, sign out|Phase 5 — Account + Polish|cycle:14,phase:account-polish,area:account,layer:ui,platform:both,mvp,priority:p2|"
  "15|Cycle 15 — Marketing landing + organiser login + magic-link|Phase 5 — Account + Polish|cycle:15,phase:account-polish,area:account,area:public-pages,layer:ui,platform:web,mvp,priority:p2|"
  "16|Cycle 16 — Cross-cutting: offline, force-update, error, 404, splash|Phase 5 — Account + Polish|cycle:16,phase:account-polish,area:platform,layer:ui,platform:both,mvp,priority:p2|"
  "17|Cycle 17 — Refinement pass|Phase 5 — Account + Polish|cycle:17,phase:account-polish,area:platform,layer:design,platform:both,mvp,priority:p2|"
  "b1|Cycle B1 — Backend: schema + RLS for accounts/brands/events/tickets/orders/guests/scanners/audit-log|Phase 6 — Backend MVP|cycle:b1,phase:backend-mvp,area:permissions,layer:db,layer:backend,platform:both,mvp,priority:p1|"
  "b2|Cycle B2 — Backend: Stripe Connect wired live|Phase 6 — Backend MVP|cycle:b2,phase:backend-mvp,area:payments,layer:backend,layer:api,platform:both,mvp,priority:p1|"
  "b3|Cycle B3 — Backend: checkout wired live (Stripe Payment Element)|Phase 6 — Backend MVP|cycle:b3,phase:backend-mvp,area:payments,area:public-pages,layer:backend,layer:api,platform:web,mvp,priority:p1|"
  "b4|Cycle B4 — Backend: scanner + door payments wired live|Phase 6 — Backend MVP|cycle:b4,phase:backend-mvp,area:scanner,area:payments,layer:backend,layer:api,platform:mobile,mvp,priority:p1|"
  "b5|Cycle B5 — Backend: marketing infrastructure (email, SMS, CRM, tracking, analytics)|Phase 7 — Post-MVP|cycle:b5,phase:post-mvp,area:marketing,area:analytics,layer:backend,layer:api,platform:both,post-mvp,priority:p3|"
  "b6|Cycle B6 — Backend: chat agent (M19+ from old plan)|Phase 7 — Post-MVP|cycle:b6,phase:post-mvp,area:agent,layer:backend,layer:api,platform:both,post-mvp,priority:p3|"
)

# We'll need the Cycle 5 epic's issue number to attach user stories.
CYCLE_5_ISSUE_NUMBER=""

declare -A EPIC_NUM_BY_CYCLE

for ENTRY in "${EPICS[@]}"; do
  IFS='|' read -r CYCLE TITLE MS LABELS DONE <<< "$ENTRY"
  BODY_FILE="$DIR/epics/cycle-$CYCLE.md"
  [ ! -f "$BODY_FILE" ] && { c_err "missing body: $BODY_FILE"; continue; }

  # Check if an issue with this exact title already exists.
  EXISTING=$(gh issue list --repo "$OWNER/$REPO" --state all --search "\"$TITLE\" in:title" --json number,title \
    | jq -r --arg t "$TITLE" '.[] | select(.title == $t) | .number' | head -1 || true)

  if [ -n "$EXISTING" ]; then
    c_skip "epic: $TITLE (#$EXISTING)"
    EPIC_NUM_BY_CYCLE["$CYCLE"]="$EXISTING"
    [ "$CYCLE" = "5" ] && CYCLE_5_ISSUE_NUMBER="$EXISTING"
    continue
  fi

  MS_NUMBER="${MS_NUM[$MS]:-}"
  LABEL_FLAGS=""
  IFS=',' read -ra LBL_ARR <<< "epic,$LABELS"
  for L in "${LBL_ARR[@]}"; do
    LABEL_FLAGS="$LABEL_FLAGS --label $L"
  done

  # Create issue
  if [ -n "$MS_NUMBER" ]; then
    NEW_NUM=$(gh issue create \
      --repo "$OWNER/$REPO" \
      --title "$TITLE" \
      --body-file "$BODY_FILE" \
      --milestone "$MS" \
      $LABEL_FLAGS \
      | grep -oE '[0-9]+$' || true)
  else
    NEW_NUM=$(gh issue create \
      --repo "$OWNER/$REPO" \
      --title "$TITLE" \
      --body-file "$BODY_FILE" \
      $LABEL_FLAGS \
      | grep -oE '[0-9]+$' || true)
  fi

  if [ -n "$NEW_NUM" ]; then
    c_ok "epic: $TITLE (#$NEW_NUM)"
    EPIC_NUM_BY_CYCLE["$CYCLE"]="$NEW_NUM"
    [ "$CYCLE" = "5" ] && CYCLE_5_ISSUE_NUMBER="$NEW_NUM"

    # Close done cycles immediately
    if [ "$DONE" = "done" ]; then
      gh issue close "$NEW_NUM" --repo "$OWNER/$REPO" --reason completed >/dev/null 2>&1 || true
      c_skip "    (closed — DONE)"
    fi
  else
    c_err "failed to create: $TITLE"
  fi
done

# ---- 6. Cycle 5 user stories (sub-issues of the Cycle 5 epic) -------

c_step "Creating Cycle 5 user stories"

if [ -z "$CYCLE_5_ISSUE_NUMBER" ]; then
  c_err "Cycle 5 epic number unknown — skipping user-story creation"
else
  for US_FILE in "$DIR/user-stories/cycle-5/"*.md; do
    [ ! -f "$US_FILE" ] && continue
    US_BASENAME=$(basename "$US_FILE" .md)
    # Extract a title from the user-story filename: us-01-add-ticket-type → "Add ticket type"
    US_TITLE=$(echo "$US_BASENAME" | sed -E 's/^us-[0-9]+-//' | tr '-' ' ' | sed 's/\b\(.\)/\U\1/g')
    FULL_TITLE="[Cycle 5] $US_TITLE"

    EXISTING=$(gh issue list --repo "$OWNER/$REPO" --state all --search "\"$FULL_TITLE\" in:title" --json number,title \
      | jq -r --arg t "$FULL_TITLE" '.[] | select(.title == $t) | .number' | head -1 || true)

    if [ -n "$EXISTING" ]; then
      c_skip "user-story: $FULL_TITLE (#$EXISTING)"
      continue
    fi

    NEW_NUM=$(gh issue create \
      --repo "$OWNER/$REPO" \
      --title "$FULL_TITLE" \
      --body-file "$US_FILE" \
      --milestone "Phase 2 — Core Wedge" \
      --label user-story \
      --label cycle:5 \
      --label phase:core-wedge \
      --label area:tickets \
      --label layer:ui \
      --label platform:both \
      --label mvp \
      --label priority:p1 \
      | grep -oE '[0-9]+$' || true)

    if [ -n "$NEW_NUM" ]; then
      c_ok "user-story: $FULL_TITLE (#$NEW_NUM)"

      # Attach as sub-issue to Cycle 5 epic via REST API (sub_issues endpoint)
      gh api "repos/$OWNER/$REPO/issues/$CYCLE_5_ISSUE_NUMBER/sub_issues" \
        --method POST \
        -F sub_issue_id="$(gh api repos/$OWNER/$REPO/issues/$NEW_NUM --jq '.id')" \
        >/dev/null 2>&1 \
        && c_skip "    (linked as sub-issue of #$CYCLE_5_ISSUE_NUMBER)" \
        || c_skip "    (sub-issue link failed — link manually in UI)"
    else
      c_err "failed to create user-story: $FULL_TITLE"
    fi
  done
fi

# ---- 7. Add issues to project ---------------------------------------

c_step "Adding all created issues to project '$PROJECT_TITLE'"

# Pre-fetch existing items so we can skip them (rate-limit friendly).
EXISTING_ITEM_NUMS=$(gh api graphql -f query="
query {
  organization(login: \"$OWNER\") {
    projectV2(number: $PROJECT_NUMBER) {
      items(first: 200) {
        nodes { content { ... on Issue { number } } }
      }
    }
  }
}" 2>/dev/null | jq -r '.data.organization.projectV2.items.nodes[].content.number // empty' || echo "")

add_to_project() {
  local URL="$1"
  local NUM
  NUM=$(echo "$URL" | grep -oE '[0-9]+$')
  if echo "$EXISTING_ITEM_NUMS" | grep -qx "$NUM"; then
    c_skip "  · #$NUM already in project"
    return 0
  fi
  if gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$URL" >/dev/null 2>&1; then
    c_ok "  → #$NUM added"
  else
    c_err "  ✗ #$NUM add failed"
  fi
}

# Add epics
gh issue list --repo "$OWNER/$REPO" --state all --label epic --limit 100 --json url \
  | jq -r '.[].url' \
  | while read -r URL; do add_to_project "$URL"; done

# Add user stories
gh issue list --repo "$OWNER/$REPO" --state all --label user-story --limit 100 --json url \
  | jq -r '.[].url' \
  | while read -r URL; do add_to_project "$URL"; done

# ---- 8. Summary -----------------------------------------------------

c_step "Summary"
EPIC_COUNT=$(gh issue list --repo "$OWNER/$REPO" --state all --label epic --limit 50 --json number | jq 'length')
US_COUNT=$(gh issue list --repo "$OWNER/$REPO" --state all --label user-story --limit 50 --json number | jq 'length')

c_ok "Project URL: $PROJECT_URL"
c_ok "Epics: $EPIC_COUNT"
c_ok "User stories: $US_COUNT"
echo ""
echo "Next steps:"
echo "  - Open the project URL above in a browser"
echo "  - Set up board views: by Phase (group by milestone), by Cycle (group by cycle: label), by Status"
echo "  - Invite the new engineer to the org with read+write on $OWNER/$REPO"
echo "  - Point them at /ONBOARDING.md as the entry point"
echo ""
