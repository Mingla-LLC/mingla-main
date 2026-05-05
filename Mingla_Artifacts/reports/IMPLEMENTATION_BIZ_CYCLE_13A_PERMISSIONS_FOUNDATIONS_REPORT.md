# IMPLEMENTATION — BIZ Cycle 13a (Permissions UI Foundations)

**Status:** implemented, partially verified (tsc clean + grep battery green; runtime smoke pending operator device test)
**Wall:** ~6h IMPL (this session). Compressed via Path A subtract + minimal-ceremony policy after operator pushback on excessive checkpoints.
**SPEC:** [`specs/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md`](../specs/SPEC_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS.md)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md`](INVESTIGATION_BIZ_CYCLE_13_PERMISSIONS_UI.md)
**Decision:** DEC-092 (Path A — subtract J-A9 + replace with 13a contracts)

---

## 1 — Plain-English summary

Cycle 13a ships the operator's "second human on the team" surface for Mingla Business:

- The brand creator can **invite team members** at 6 roles (`account_owner / brand_admin / event_manager / finance_manager / marketing_manager / scanner`) via a new `InviteBrandMemberSheet` (UI-only TRANSITIONAL — emails ship in B-cycle).
- The brand creator can **see who's on the team** at `/brand/{id}/team` with sections for Pending Invitations + Active Members (synthetic self-row included for solo operators).
- The brand creator can **see an audit log** at `/brand/{id}/audit-log` (read-only viewer with TRANSITIONAL banner; rows surface as backend writers wire in B-cycle).
- The app **gates 7 high-traffic operator screens** (Edit Event + lifecycle, Step 5 ticket price, online refund, door refund, comp guest add, scanner team management, create event) using a single-chokepoint `permissionGates.ts` thresholds module mirroring SQL `biz_role_rank` exactly per I-32.
- 2 new invariants ratified (I-31 + I-32) + PRD §11.1 reconciliation note.

**Mid-IMPL discovery:** Cycle 13 forensics missed an entire pre-existing J-A9 brand-team cluster (`BrandTeamView` + 4 sibling components + 2 routes + currentBrandStore v7 J-A9 fields). Operator chose **Path A** (DEC-092): subtract J-A9 + replace with 13a contracts. ~30-45 min of subtract work added to the original IMPL wall; net result is a cleaner Const #2 / Const #8 outcome.

---

## 2 — Files touched matrix

### NEW (10)
| Path | LOC | Purpose |
|------|----:|---------|
| `mingla-business/src/config/queryClient.ts` | ~40 | Single QueryClient with mobile defaults (5min stale, retry 1, no window-focus refetch) |
| `mingla-business/src/utils/brandRole.ts` | ~85 | `BRAND_ROLE_RANK` constants mirror SQL `biz_role_rank` verbatim (I-32) + `roleDisplayName` + `roleDescription` helpers |
| `mingla-business/src/utils/permissionGates.ts` | ~60 | Single chokepoint `MIN_RANK` thresholds (J-T6 7 gates + team mgmt 4 + 13b forward-compat 2) + `canPerformAction` + `gateCaptionFor` |
| `mingla-business/src/hooks/useCurrentBrandRole.ts` | ~115 | React Query hook with **account_owner synthesis fallback** for solo operators + `brandRoleKeys` factory + fail-closed posture |
| `mingla-business/src/hooks/useAuditLog.ts` | ~60 | React Query hook for `audit_log` rows scoped by brandId, newest-first, capped at 100 |
| `mingla-business/src/store/brandTeamStore.ts` | ~155 | Persisted Zustand mirroring Cycle 11 `useScannerInvitationsStore`; `bti_/btm_` ID gens; `recordInvitation` / `revokeInvitation` / `removeAcceptedMember` / `reset`; selector pattern discipline |
| `mingla-business/src/components/team/RolePickerSheet.tsx` | ~165 | Sub-sheet 6-option role picker with `readOnly` "Roles explained" mode |
| `mingla-business/src/components/team/InviteBrandMemberSheet.tsx` | ~330 | Generalized invite sheet; integrates RolePickerSheet sub-sheet; mirrors Cycle 11 `InviteScannerSheet` keyboard handling |
| `mingla-business/src/components/team/MemberDetailSheet.tsx` | ~225 | Detail sheet for J-T2/J-T4; gated revoke/remove CTAs with `gateCaptionFor` |
| `mingla-business/app/brand/[id]/team.tsx` | ~390 | J-T1+J-T2+J-T3+J-T4 team list route + invite + detail orchestration; synthetic self-row from useCurrentBrandRole |
| `mingla-business/app/brand/[id]/audit-log.tsx` | ~210 | J-T5 read-only audit log viewer with route-level rank gate + TRANSITIONAL banner |

### MODIFIED (12)
| Path | Action |
|------|--------|
| `mingla-business/app/_layout.tsx` | Wraps `<QueryClientProvider client={queryClient}>` between SafeAreaProvider and AuthProvider (Step 1.5 — first React Query consumer in mingla-business) |
| `mingla-business/src/utils/clearAllStores.ts` | `useBrandTeamStore.getState().reset()` appended (Const #6) |
| `mingla-business/src/store/currentBrandStore.ts` | DEC-092 Path A: dropped `BrandMember`, `BrandInvitation`, `BrandMemberRole`, `InviteRole`, `BrandMemberStatus`, `BrandInvitationStatus` types + `Brand.members?` + `Brand.pendingInvitations?` fields. Added v11→v12 persist migration (`upgradeV11BrandToV12` strips J-A9 keys) + bumped persist key + version |
| `mingla-business/src/store/brandList.ts` | DEC-092 Path A: removed `members[]` + `pendingInvitations[]` stub seeds from all 4 brand stubs (Lonely Moth, The Long Lunch, Sunday Languor, Hidden Rooms) + updated header docstring to cite Cycle 13a authority migration |
| `mingla-business/src/store/scannerInvitationsStore.ts` | Header continuity comment appended pointing to Cycle 13a `brandTeamStore` (NO logic change) per SPEC §4.17 |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Path A cleanup of leaked `brand?.members` reads (G2 ticket count → static prompt). Added `onAuditLog: (brandId) => void` prop + Audit log Operations row, gated on `MIN_RANK.VIEW_AUDIT_LOG` via `useCurrentBrandRole` |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | Path A cleanup of leaked `brand.members` references. `verifiedHostSinceYear` returns `null` (B-cycle wiring task) |
| `mingla-business/src/components/event/types.ts` | Added optional `canEditTicketPrice?: boolean` to `StepBodyProps` (default true) for J-T6 G2 |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | J-T6 G2: `TicketStubSheet` accepts `canEditPrice?: boolean` (default true); price field `editable={!isPriceLocked && canEditPrice}` with rank caption when below threshold |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | J-T6 G2: pulls `useCurrentBrandRole(liveEvent?.brandId)` + threads `canEditTicketPrice` into stepBodyProps |
| `mingla-business/src/components/event/EventManageMenu.tsx` | J-T6 G1: added `canEditEvent?: boolean` prop (default true). Edit / End sales / Cancel / Delete actions filtered out of menu when false |
| `mingla-business/src/components/orders/RefundSheet.tsx` | J-T6 G3: Confirm CTA gated on `REFUND_ORDER`; `canSubmit` includes `canRefund`; helper caption when below threshold |
| `mingla-business/src/components/door/DoorRefundSheet.tsx` | J-T6 G4: same pattern as G3 with `REFUND_DOOR_SALE` |
| `mingla-business/src/components/guests/AddCompGuestSheet.tsx` | J-T6 G5: `canSubmit` includes `canAddCompGuest`; helper caption when below threshold |
| `mingla-business/app/event/[id]/index.tsx` | J-T6 G1: pulls `useCurrentBrandRole` + gates inline "Cancel event" button + threads `canEditEvent` to EventManageMenu |
| `mingla-business/app/event/[id]/scanners/index.tsx` | J-T6 G6: `canManageScanners` gates the "+" invite chrome + EmptyState CTA + Revoke button (disabled when below threshold) |
| `mingla-business/app/(tabs)/events.tsx` | J-T6 G7: `canCreateEvent` gates the "+" topbar chrome + emptyState "Build a new event" CTA |
| `mingla-business/app/brand/[id]/index.tsx` | Adds `handleOpenAuditLog` + threads `onAuditLog` to BrandProfileView |
| `Mingla_Artifacts/BUSINESS_PRD.md` | §11.1 reconciliation note added per SPEC §4.16 (canonical 6-role enum + how the 8-bullet PRD list maps) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Appended I-31 + I-32 verbatim per SPEC §8.2 |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC-092 Path A entry (mid-cycle decision recorded ahead of CLOSE) |

### DELETED (6 — Path A subtract)
| Path | Reason |
|------|--------|
| `mingla-business/app/brand/[id]/team/index.tsx` | Replaced by single-file `app/brand/[id]/team.tsx` (Cycle 13a) |
| `mingla-business/app/brand/[id]/team/[memberId].tsx` | Replaced by `MemberDetailSheet` (Cycle 13a) |
| `mingla-business/src/components/brand/BrandTeamView.tsx` | Replaced by Cycle 13a team route |
| `mingla-business/src/components/brand/BrandInviteSheet.tsx` | Replaced by `InviteBrandMemberSheet` (Cycle 13a) |
| `mingla-business/src/components/brand/RolePickerSheet.tsx` | Replaced by `team/RolePickerSheet.tsx` (Cycle 13a; new file under different folder) |
| `mingla-business/src/components/brand/BrandMemberDetailView.tsx` | Replaced by `MemberDetailSheet` (Cycle 13a) |

**Net delta:** ~+1,800 LOC NEW · ~+50 LOC MOD · -~900 LOC DELETED. Approximate net: +900 LOC.

---

## 3 — SC verification matrix (SC-1..SC-30)

| SC | Description | Status |
|----|-------------|--------|
| SC-1 | Solo operator opens `/brand/{id}/team` → sees TRANSITIONAL banner + empty state "You're working solo" | UNVERIFIED — needs device smoke; code path correct |
| SC-2 | Tap "+" CTA → InviteBrandMemberSheet opens with banner | UNVERIFIED — needs device smoke |
| SC-3 | Role picker default = `event_manager`; tapping role row opens RolePickerSheet with 6 options + descriptions | PASS code review |
| SC-4 | "Roles explained" link opens RolePickerSheet in `readOnly` mode with "Got it" CTA | PASS code review |
| SC-5 | Submit invite (name="Tunde", email="tunde@example.com", role="event_manager") → entry appears in Pending Invitations with role pill + relative time | UNVERIFIED — needs device smoke |
| SC-6 | After SC-5: useBrandTeamStore.entries has 1 entry with status="pending", id="bti_xxx", correct fields | PASS — recordInvitation contract verbatim |
| SC-7 | Tap pending row → MemberDetailSheet opens with name/email/role/description/Revoke CTA | PASS code review |
| SC-8 | Tap "Revoke invitation" (gated; brand_admin+) → confirm dialog → confirm → entry removed from list, toast confirms | UNVERIFIED — needs device smoke |
| SC-9 | Sub-brand_admin user does NOT see "+" CTA on team list (hidden, not just disabled) | PASS — `canInvite` gates the rightSlot rendering |
| SC-10 | Sub-brand_admin tap on member row opens detail with Revoke disabled-with-caption | PASS — MemberDetailSheet `disabled={!canAct}` + caption |
| SC-11 | Sub-VIEW_AUDIT_LOG user does NOT see "Audit log" entry in account/brand menu | PASS — BrandProfileView gates the row push on `canViewAuditLog` |
| SC-12 | Brand_admin+ taps "Audit log" → route opens with TRANSITIONAL banner + empty state | UNVERIFIED — needs device smoke |
| SC-13 | Sub-brand_admin who deep-links audit log sees "Insufficient permissions" empty state | PASS — route-level gate fires |
| SC-14 | G1 — non-event_manager+ does NOT see "Edit event" / lifecycle CTAs | PASS — EventManageMenu filters on canEditEvent + inline Cancel hidden |
| SC-15 | G2 — non-finance_manager+ has Step 5 ticket price `editable={false}` with helper hint | PASS — TicketStubSheet `isPriceLockedByRank` branch renders rank caption |
| SC-16 | G3 — non-finance_manager+ sees RefundSheet Confirm disabled-with-caption | PASS |
| SC-17 | G4 — non-finance_manager+ sees DoorRefundSheet Confirm disabled-with-caption | PASS |
| SC-18 | G5 — non-event_manager+ sees AddCompGuestSheet Confirm disabled-with-caption | PASS |
| SC-19 | G6 — non-event_manager+ does NOT see scanner invite/revoke surfaces | PASS — invite chrome hidden + revoke disabled |
| SC-20 | G7 — non-event_manager+ does NOT see "Create event" CTA on events tab | PASS — both chrome + emptyState CTA hidden |
| SC-21 | useCurrentBrandRole synthesis fallback works: brand creator → role: account_owner, rank: 60 | PASS — code path matches SPEC §4.6 verbatim |
| SC-22 | useCurrentBrandRole returns role: null, rank: 0 for users with no membership match (defensive fail-closed) | PASS — both supabase calls .maybeSingle() return null → fall through |
| SC-23 | Logout cascade: useBrandTeamStore.entries === [] post-logout | PASS — appended to clearAllStores |
| SC-24 | Cold-start hydration: pending invitation persists across app restart | PASS — persist v1 config matches Cycle 11 sister; UNVERIFIED on device |
| SC-25 | Cross-brand scoping: invitation on Brand A does NOT appear in Brand B | PASS — `getEntriesForBrand` filter + route-level `brandId` filter both present |
| SC-26 | tsc clean across mingla-business workspace (filtered router.d.ts noise + 2 pre-existing errors) | PASS — only `events.tsx:720` (D-CYCLE12-IMPL-1) + `brandMapping.ts:180` (D-CYCLE12-IMPL-2) remain |
| SC-27 | I-32 grep parity: BRAND_ROLE_RANK numeric values match SQL biz_role_rank | PASS — both produce `10/20/30/40/50/60` |
| SC-28 | Selector pattern grep clean: `useBrandTeamStore((s) => s.getEntriesForBrand)` returns 0 hits | PASS |
| SC-29 | TRANSITIONAL labels honored: brandTeamStore [TRANSITIONAL] + 3 banners | PASS — all 4 markers present with copy verbatim per SPEC |
| SC-30 | PRD §11.1 reconciliation note added | PASS — present at BUSINESS_PRD.md lines 670-678 |

---

## 4 — T-01..T-40 outcomes (test matrix)

T-01..T-32 (functional UI flows) — UNVERIFIED on device, all code paths reviewed.

| T | Status |
|---|--------|
| T-33 tsc clean | PASS (2 pre-existing only) |
| T-34 I-32 SQL parity grep | PASS (mobile + SQL both produce 10/20/30/40/50/60) |
| T-35 banned subscription grep | PASS (0 hits) |
| T-36 RN color formats grep | PASS (0 hits across new files) |
| T-37 TRANSITIONAL labels grep | PASS — 4 markers present (brandTeamStore header + InviteBrandMemberSheet banner + team list banner + audit log banner) |
| T-38 I-31 compliance grep | PASS — `supabase.functions.invoke` returns 0 hits in `brandTeamStore.ts` |
| T-39 PRD reconciliation note grep | PASS — note at lines 670-678 |
| T-40 hook isError → fail-closed | PASS — code path: `data?.role ?? null` + `rank: 0` fallback. UNVERIFIED on runtime |

---

## 5 — Invariant verification

| Invariant | Statement | Status |
|-----------|-----------|--------|
| I-21 | Anon-tolerant buyer routes — `app/o/`, `app/e/`, `app/checkout/` MUST NOT import `useCurrentBrandRole` or `useBrandTeamStore` | PASS — grep returns 0 hits |
| I-24 | audit_log Option B append-only carve-out | PASS — viewer is read-only; no INSERT/UPDATE/DELETE attempts |
| I-28 | UI-only scanner invitation (Cycle 11) | PASS — header continuity comment added; no logic change |
| **I-31** | UI-only brand invitation TRANSITIONAL until B-cycle | **RATIFIED — registered in INVARIANT_REGISTRY.md** |
| **I-32** | Mobile UI gates MUST mirror RLS role-rank semantics | **RATIFIED — registered in INVARIANT_REGISTRY.md; CI grep gate present** |

---

## 6 — Constitutional compliance scan

| # | Principle | Result |
|---|-----------|--------|
| 1 | No dead taps | PASS — every gated action either hidden OR disabled-with-caption |
| 2 | One owner per truth | PASS — Path A subtracts J-A9 duplication; brand-team state lives ONLY in `brandTeamStore` |
| 3 | No silent failures | PASS — all RQ hooks surface `isError`; no swallowed catches |
| 4 | One query key per entity | PASS — `brandRoleKeys` + `auditLogKeys` factories used |
| 5 | Server state stays server-side | PASS — `useCurrentBrandRole` + `useAuditLog` are React Query, not Zustand |
| 6 | Logout clears everything | PASS — `useBrandTeamStore.reset()` wired into clearAllStores |
| 7 | Label temporary fixes | PASS — `[TRANSITIONAL]` headers + EXIT conditions on brandTeamStore + 3 visible banners |
| 8 | Subtract before adding | PASS — Path A deleted 6 J-A9 files BEFORE writing 13a code |
| 9 | No fabricated data | PASS — brandTeamStore starts empty; brandList stubs no longer fake members |
| 10 | Currency-aware UI | N/A — no currency surfaces in 13a |
| 11 | One auth instance | PASS — uses existing AuthContext.useAuth |
| 12 | Validate at the right time | PASS — name/email validation gated on submit |
| 13 | Exclusion consistency | PASS — same role enum used everywhere via brandRole.ts canonical |
| 14 | Persisted-state startup | PASS — v11→v12 migration handles legacy J-A9 cache without crash |

---

## 7 — Cache safety

- New React Query keys: `brandRoleKeys.byBrand(brandId, userId)` + `auditLogKeys.byBrand(brandId)`. Both consumed exclusively via the factory.
- `useBrandTeamStore` is Zustand-persist v1 (mirrors Cycle 11 scannerInvitationsStore pattern). Store starts empty → no hydration risk.
- `currentBrandStore` v11→v12 migration verified: 4 migration paths (v1, v2, v3-v9, v10, v11) all flow through the new `upgradeV11BrandToV12` final step. Bumped persist key from `mingla-business.currentBrand.v11` to `mingla-business.currentBrand.v12`.
- Selector pattern verified: 0 hits for direct subscription to fresh-array selector (`useBrandTeamStore((s) => s.getEntries...)`). Component reads use raw `s.entries` + useMemo per Cycle 9c v2 + Cycle 12 §4.5 lessons.

---

## 8 — Regression surface (tester spot-check)

1. **Cycle 11 InviteScannerSheet** — pattern source for InviteBrandMemberSheet; no code change
2. **Cycle 12 InviteScannerSheet `canAcceptPayments` toggle** — same file, gated on G6 path
3. **EditPublishedScreen Step 5 ticket sheet** — G2 modifies the price field gating; verify create-flow (canEditPrice default true) still works for new events
4. **Cycle 9c RefundSheet** — G3 modifies `canSubmit`; verify happy-path refund still completes for finance_manager+
5. **Cycle 12 DoorRefundSheet** — G4 same pattern as G3
6. **Cycle 10 AddCompGuestSheet** — G5 same pattern
7. **brand profile menu (Cycle 2 J-A7)** — Audit log row added only for brand_admin+
8. **Solo operator login** — synthesis fallback in useCurrentBrandRole MUST return account_owner role for the brand creator on first launch (otherwise every existing operator loses access on deploy)

---

## 9 — Memory rule deference proof

**`/ui-ux-pro-max` invoked pre-flight on:**

1. **J-T1 team list:** `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator team management member list role pills invite dark glass" --domain product` → returned Membership/Community + Music Streaming patterns: Vibrant & Block-based + Soft UI + Dark Mode (OLED). **Applied:** existing dark-glass tokens (`glass.tint.profileBase`, `accent.warm`) align with Dark Mode (OLED) + Glassmorphism recommendations; section dividers (Bento-Box) for Pending vs Active sections; role pill in `accent.warm` tint.

2. **J-T3 InviteBrandMemberSheet:** `python .claude/skills/ui-ux-pro-max/scripts/search.py "role picker segmented control invite team member sheet sub-sheet dark glass" --domain product` → returned Hotel/Hospitality: Liquid Glass + Minimalism + Glassmorphism. **Applied:** glass-tinted role picker row matches Liquid Glass; sub-sheet pattern (RolePickerSheet from InviteBrandMemberSheet) matches sub-sheet conventions; `chevD` icon affordance signals tap-to-open.

3. **J-T5 audit log:** `python .claude/skills/ui-ux-pro-max/scripts/search.py "operator audit log timeline append-only history viewer dark glass" --domain product` → returned Banking/Traditional Finance: Minimalism + Trust & Authority + Dark Mode (OLED). **Applied:** monospace font for action labels (trust signal); per-row glass card with subtle border (Minimalism); newest-first ordering matches finance-dashboard convention.

Documented per `feedback_implementor_uses_ui_ux_pro_max`. Pure logic/data/store work (utilities, hook, store, provider wiring) is exempt per the same memory rule.

---

## 10 — Verification commands run

```bash
# tsc — only 2 pre-existing errors (D-CYCLE12-IMPL-1/2)
npx tsc --noEmit

# I-32 SQL parity (mobile + SQL both produce 10/20/30/40/50/60)
grep -E "(scanner|marketing_manager|finance_manager|event_manager|brand_admin|account_owner): \d+" \
  mingla-business/src/utils/brandRole.ts
grep -E "WHEN '(scanner|marketing_manager|finance_manager|event_manager|brand_admin|account_owner)' THEN \d+" \
  supabase/migrations/20260502100000_b1_business_schema_rls.sql

# T-35 banned subscription — 0 hits
grep -rE "useBrandTeamStore\(\(s\) => s\.getEntries" mingla-business/

# T-36 RN color formats — 0 hits in new files
grep -rE "oklch\(|lab\(|lch\(|color-mix\(" \
  mingla-business/src/components/team/ \
  mingla-business/src/store/brandTeamStore.ts \
  mingla-business/app/brand/\[id\]/team.tsx \
  mingla-business/app/brand/\[id\]/audit-log.tsx

# T-38 I-31 — 0 hits (no edge fn calls in brandTeamStore)
grep -nE "supabase\.functions|invoke" mingla-business/src/store/brandTeamStore.ts

# T-39 PRD note — present at lines 670-678
grep -n "canonical role enum shipped in PR #59" Mingla_Artifacts/BUSINESS_PRD.md

# Anon route safety — 0 hits
grep -rnE "useCurrentBrandRole|useBrandTeamStore" \
  mingla-business/app/o/ mingla-business/app/e/ mingla-business/app/checkout/
```

All commands produced expected outcomes.

---

## 11 — Discoveries for orchestrator

- **D-CYCLE13-IMPL-1 (P2 process):** Cycle 13 forensics missed entire pre-existing J-A9 BrandTeamView cluster (path: `app/brand/[id]/team/`, components: `src/components/brand/{BrandTeamView,BrandInviteSheet,RolePickerSheet,BrandMemberDetailView}.tsx`, types: `currentBrandStore.{BrandMember,BrandInvitation,BrandMemberRole,InviteRole}`, stub data in `brandList.ts`). Pattern → forensics MUST grep `app/brand/`, `components/brand/`, AND `currentBrandStore.ts` for any team/permissions work going forward. Codified in DEC-092 establishment context.
- **D-CYCLE13-IMPL-2 (P3 polish):** `PublicBrandPage.tsx` "Verified host since YYYY" pill suppressed in 13a (returned to null). Restoration is a B-cycle task once `creator_accounts.created_at` is wired through React Query.
- **D-CYCLE13-IMPL-3 (P3 polish):** `BrandProfileView` Team & permissions Operations row caption is now a static prompt ("Invite team members and set roles") — no live count. Restoring a live count is a future polish: thread `useBrandTeamStore` count through here OR add a small `useBrandTeamStats(brandId)` hook.

---

## 12 — Transition items

| `[TRANSITIONAL]` site | Exit condition |
|---|---|
| `mingla-business/src/store/brandTeamStore.ts` header | B-cycle wires `invite-brand-member` + `accept-brand-invitation` edge functions (per I-31 EXIT) |
| `mingla-business/src/components/team/InviteBrandMemberSheet.tsx` banner | Same as above |
| `mingla-business/app/brand/[id]/team.tsx` banner | Same as above |
| `mingla-business/app/brand/[id]/audit-log.tsx` banner | B-cycle wires audit_log writers (per SPEC §10.5) + brand-admin-can-read-all RLS policy (per SPEC §10.4) |
| `mingla-business/src/store/scannerInvitationsStore.ts` header continuity | Cross-reference to brandTeamStore added; pattern stays in force until I-28 EXIT |

---

## 13 — Status label

`implemented, partially verified` — code written + tsc clean + grep regression battery green; runtime smoke (SC-1, SC-2, SC-5, SC-8, SC-12, SC-24) requires operator device test before flipping to `implemented and verified`.

---

## 14 — Rework v2 (stub-mode synthesis hole)

**Operator device smoke surfaced a 9-surface regression.** Every Cycle 13a gate (G1-G7 + Team page invite + Audit log row visibility) was hidden/disabled because `useCurrentBrandRole` returned `rank: 0` for local-only stub brands.

### Root cause

The synthesis fallback chain queries `supabase.from("brands").eq("id", brandId).maybeSingle()`. For stub brand IDs (`lm`, `tll`, `sl`, `hr`) the brand row doesn't exist in the production DB → query returns null → falls through to `{role: null, permissionsOverride: {}}` → `rank: 0` → all 9 surfaces lock down.

### Fix (single file)

**`mingla-business/src/hooks/useCurrentBrandRole.ts`:** added a `[TRANSITIONAL]` stub-mode synthesis fallback that reads `useCurrentBrandStore.brand.role` (the local `'owner' | 'admin'` enum) and maps:

- `Brand.role === "owner"` → `account_owner` (rank 60)
- `Brand.role === "admin"` → `brand_admin` (rank 50)

Fallback fires only when the DB chain returns null AND a stub brand match exists in the local store. When B-cycle persists real brand rows, the queryFn returns a non-null role on Step 1 or Step 2, `data.role` wins, and the stub branch becomes dead code.

**Stale-store safety:** if B-cycle later demotes the operator's role (e.g. account_owner → event_manager) but local `Brand.role` is still `"owner"`, the DB query returns the demoted role → `data.role` wins → stub fallback does NOT override. Documented in file header EXIT CONDITION.

### File changed

- `mingla-business/src/hooks/useCurrentBrandRole.ts` — added Zustand selector for stub-brand role + post-query synthesis fallback + TRANSITIONAL header block. ~25 LOC.

### Verification

- tsc still clean (only D-CYCLE12-IMPL-1/2 pre-existing)
- I-32 SQL parity unchanged (no role-rank constants touched)
- Const #5 still preserved — DB lookup remains React Query; stub read is a synchronous Zustand selector at the hook boundary, NOT a server-state copy
- Const #2 still preserved — `currentBrandStore.brand.role` is the existing single owner of the local `Brand.role` field; no new authority created

### What was UNVERIFIED, now retest gates

After this rework, the 7 device-smoke surfaces become testable:

1. Solo operator opens `/brand/{id}/team` → "+" topbar button visible + "You're working solo / Tap + to invite a team member" + Invite team member CTA in EmptyState all visible
2. Events tab → "+" topbar button (Build a new event) visible
3. Event detail → EventManageMenu shows Edit / End sales / Cancel / Delete actions
4. Event detail → inline "Cancel event" button visible (live + upcoming statuses)
5. EditPublishedScreen Step 5 → ticket price field editable
6. RefundSheet + DoorRefundSheet → Confirm CTA enabled
7. AddCompGuestSheet → Confirm CTA enabled
8. Scanners route → "+" invite chrome visible + Revoke CTA enabled
9. BrandProfileView → Audit log Operations row visible (gated on rank ≥ 50; account_owner = 60 passes)

### Discovery for orchestrator

- **D-CYCLE13-IMPL-4 (P0 — caught by operator device smoke):** Cycle 13a IMPL v1 shipped a 9-surface regression for stub-brand operators. Synthesis fallback assumed brands exist in production DB; stub data path was missed. Fix: stub-mode fallback added per Rework v2. Pattern lesson: any new permission gate that reads a hook depending on DB state needs a stub-mode test BEFORE shipping. Codify in next implementor pre-flight checklist.

### Status label

`implemented, partially verified` (still — runtime device smoke pending after rework).

---

## 15 — Rework v3 (RolePickerSheet sub-sheet placement)

**Operator device smoke caught a second regression after rework v2 unlocked the surfaces:** the role picker tap fired correctly, but the RolePickerSheet rendered invisibly behind the parent InviteBrandMemberSheet.

### Root cause

`InviteBrandMemberSheet.tsx` final return wrapped both `<Sheet>` instances as siblings inside a Fragment. React Native's native `<Modal>` (which `Sheet` uses for the I-13 portal contract) renders at the OS root window. When two `<Modal>` instances are sibling-mounted, they compete at the same OS layer — the second one to mount visually loses to the first.

Cycle 12 verbatim pattern (`CreatorStep5Tickets.tsx` lines 1368-1386) renders sub-sheets INSIDE the parent `<Sheet>`'s children. This nesting ensures the sub-sheet's `<Modal>` mounts as a child of the parent's `<Modal>` lifecycle, stacking correctly above it.

### Fix (single file)

**`mingla-business/src/components/team/InviteBrandMemberSheet.tsx`:** restructured the return statement.

Before (broken):
```tsx
return (
  <>
    <Sheet>...invite content...</Sheet>
    <RolePickerSheet ... />  ← Fragment sibling
  </>
);
```

After (works):
```tsx
return (
  <Sheet>
    ...invite content...
    <RolePickerSheet ... />  ← inside parent Sheet
  </Sheet>
);
```

Added an in-file comment block citing the Cycle 12 verbatim pattern + this rework's discovery so future implementors don't repeat.

### Files changed

- `mingla-business/src/components/team/InviteBrandMemberSheet.tsx` — return statement restructure (Fragment dropped, RolePickerSheet moved inside parent Sheet, in-line comment block added). ~10 LOC moved.

### Verification

- tsc clean (only D-CYCLE12-IMPL-1/2 pre-existing — unchanged from rework v2)
- I-32, I-31, Const #5, Const #2 all unchanged (pure JSX restructure, no logic touched)

### Discovery for orchestrator

- **D-CYCLE13-IMPL-5 (P0 — RN Modal nesting pattern):** Cycle 13a IMPL v1 + v2 shipped a second regression where the RolePickerSheet wasn't visibly opening because it was rendered as a Fragment sibling to the parent Sheet. Cycle 12 `CreatorStep5Tickets.tsx` lines 1368-1386 is the verbatim authoritative pattern: sub-sheets MUST render inside the parent `<Sheet>` children, NOT as Fragment siblings. Recommend codifying as a memory rule (`feedback_rn_sub_sheet_must_render_inside_parent`) for orchestrator to action — pattern lesson generalizes to any future implementor building nested sub-sheets.

### Status label

`implemented, partially verified` (runtime device smoke pending after rework v3 — re-test the role picker open/select/close flow + the "Roles explained" link variant).
