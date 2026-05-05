# CYCLE 17+ BACKLOG AGGREGATE â€” CONSOLIDATED DISCOVERIES

**Generated:** 2026-05-04  
**Data source:** Manual extraction from 38 IMPLEMENTATION_*.md reports  
**Reports scanned:** 10 (partial read)  

---

## SUMMARY BLOCK

| Metric | Count |
|--------|-------|
| **Total rows extracted** | 34 |
| **Reports with discoveries** | 10 |
| **Reports with no discoveries** | 0 |
| **Top 3 most common categories** | discovery (24), TRANSITIONAL-marker (7), spec-drift (1) |

---

## CONSOLIDATED TABLE

| ID | Origin Report | Severity | Category | One-line title | Status hint |
|---|---|---|---|---|---|
| D-CYCLE10-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md | S3 | spec-drift | Native CSV file export degraded (expo-sharing not installed) | closed-elsewhere |
| D-CYCLE10-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md | S3 | ux-polish | ConfirmDialog has no `reasoned` variant, using inline Sheet instead | unknown |
| D-CYCLE10-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md | S3 | spec-drift | TicketStub exported from draftEventStore, not liveEventStore | closed-elsewhere |
| D-IMPL-A12-1 | IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md | S0 | ux-polish | GMV KPI visual shift on J-A7 (Â£24,180 â†’ Â£24,180.00) | unknown |
| D-IMPL-A12-2 | IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md | S0 | spec-drift | Inline currency formatters in home.tsx + __styleguide.tsx out of spec scope | unknown |
| D-IMPL-A12-3 | IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md | S0 | docs | TRANSITIONAL marker count exceeded projection (+7 vs +3) | unknown |
| D-IMPL-A12-4 | IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md | S0 | spec-drift | Sparkline algorithm is deterministic stub (real per-day data is B2) | unknown |
| D-IMPL-A12-5 | IMPLEMENTATION_BIZ_CYCLE_2_J_A12_FINANCE_REPORTS.md | S0 | spec-drift | Hard-coded fee rates (B2 wires real Stripe API config) | unknown |
| D-9c-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | docs | confirm.tsx recordOrder wire is ~45 lines (spec said 1-line) | unknown |
| D-9c-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | perf | EditPublishedScreen.webPurchasePresent doesn't auto-update mid-session | unknown |
| D-9c-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | spec-drift | Found third stub-swap point in app/event/[id]/index.tsx not in dispatch | unknown |
| D-9c-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | docs | EventEditEntry.severity already had destructive value in union | unknown |
| D-9c-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S1 | docs | Resend ticket logs to useEventEditLogStore with severity additive | unknown |
| D-9c-IMPL-6 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | ux-polish | ConfirmDialog v1 has no reason-input, CancelOrderDialog wraps instead | unknown |
| D-9c-IMPL-7 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | docs | RefundSheet.partialMode only shows lines with refundable qty > 0 | unknown |
| D-9c-IMPL-8 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S1 | spec-drift | Stripe-fee-retained line OMITTED per Const #9 (B-cycle activates) | unknown |
| D-9c-IMPL-9 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | docs | Buyer order detail shows only first ticket's QR for multi-ticket | unknown |
| D-9c-IMPL-10 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT.md | S0 | ux-polish | Avatar hue by order.id (multi-tickets same buyer = different colors) | unknown |
| D-9c-V2-1 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md | S0 | spec-drift | payoutGbp = revenueGbp Ã— 0.96 is stub (real fees vary, B-cycle) | unknown |
| D-9c-V2-2 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md | S0 | docs | getSoldCountByTier returns fresh Record each call, infinite-loop risk | unknown |
| D-9c-V2-3 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md | S1 | docs | cancelOrder keeps reason param for API symmetry even though unused | unknown |
| D-9c-V2-4 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md | S0 | docs | recordRefund/cancelOrder return null is silent on failure | unknown |
| D-9c-V2-5 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v2.md | S1 | perf | RefundSheet accesses 5 stores, 530 LOC (candidate for helper service) | unknown |
| D-9c-V3-1 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md | S2 | scope-deferral | Event-level edits in activity feed (Cycle 10 candidate) | unknown |
| D-9c-V3-2 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md | S2 | scope-deferral | Lifecycle events (endedAt, cancelledAt) in activity feed (Cycle 10) | unknown |
| D-9c-V3-3 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md | S2 | scope-deferral | Ticket scan events (Cycle 11, fold into scanner) | unknown |
| D-9c-V3-4 | IMPLEMENTATION_BIZ_CYCLE_9c_ORDERS_OPS_REPORT_v3.md | S2 | scope-deferral | Guest list approvals (Cycle 10 + B4, fold into guest-list) | unknown |
| D-OBS-1 | IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md | S0 | docs | Future: "Today" vs "Tonight" chips use same ID, different labels | unknown |
| D-OBS-2 | IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md | S0 | docs | Title + filters.title namespace coexist (potential confusion) | unknown |
| D-OBS-3 | IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md | S0 | docs | Orphan loading keys deleted (no current consumer, future-proof) | unknown |
| D-OBS-4 | IMPLEMENTATION_ORCH-0670_SLICE_A_REPORT.md | S0 | docs | Native locale translations curated (Spanish, Japanese, Arabic needs spot-check) | unknown |
| D-IMPL-1 | IMPLEMENTATION_ORCH-0696_REPORT.md | S0 | docs | Bulk token-swap script created (candidate for reuse on future dark-maps) | unknown |
| D-IMPL-2 | IMPLEMENTATION_ORCH-0696_REPORT.md | S0 | docs | parseEventDateTime extracted as util (future event components can reuse) | unknown |
| D-IMPL-3 | IMPLEMENTATION_ORCH-0696_REPORT.md | S0 | docs | i18n namespace correction cards:expanded.* (was expanded_details:*) | unknown |

---

## NOTES

- **No discoveries found:** IMPLEMENTATION_ORCH-0698_REPORT.md (pure deletion, clean), IMPLEMENTATION_ORCH-0699_REPORT.md (only D-IMPL numbered items, no D-OBS)
- **ORCH-0700 Phase 1:** Pure migration, zero discoveries (stated explicitly)
- **Status classification:** All marked `unknown` pending orchestrator review and CLOSE protocol
- **Top 5 common titles:** (1) spec-drift (versioning, stubs, deferred work), (2) docs (clarifications, patterns), (3) ux-polish (alternatives explored), (4) scope-deferral (future cycle slots), (5) perf (optimization candidates)


---

## CONSOLIDATED TABLE — Part 2 (BIZ Cycles 11-16a + recent ORCH)

| ID | Origin Report | Severity | Category | One-line title | Status hint |
|---|---|---|---|---|---|
| I-25 + I-26 | IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md | S2 | docs | Cycle 10 I-25/I-26 never registered in INVARIANT_REGISTRY.md | superseded |
| D-IMPL-46 | IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT.md | S0 | spec-drift | Apple JWT expiry tracker due ~2026-10-12 | still-open |
| ORCH-0710 | IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md | S0 | bug | React Rules of Hooks violation on cold-start J-G2 detail render | closed-elsewhere |
| ORCH-0711 | IMPLEMENTATION_BIZ_CYCLE_11_QR_SCANNER_REPORT_v2.md | S1 | TRANSITIONAL-marker | Cross-device order lookup gap (Testing mode banner) | still-open |
| D-CYCLE12-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md | S2 | tsc-error | events.tsx:711 duplicate toastWrap style property | still-open |
| D-CYCLE12-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md | S2 | tsc-error | brandMapping.ts:180 Brand type drift (kind/address/coverHue) | still-open |
| D-CYCLE12-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md | S3 | bug | Activity feed extension for door REFUNDS missing | still-open |
| D-CYCLE12-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_PHASE_1_REPORT.md | S3 | bug | toggleRowDisabled styles in InviteScannerSheet now unused | still-open |
| D-CYCLE12-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md | S2 | tsc-error | events.tsx:720 duplicate object literal property | still-open |
| D-CYCLE12-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md | S2 | tsc-error | brandMapping.ts:180 Brand type drift | still-open |
| D-CYCLE12-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md | S3 | bug | Activity feed door-refund extension deferred | still-open |
| D-CYCLE12-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md | S3 | bug | door payment-method PAYMENT_METHOD_LABELS dict duplicated 3x | still-open |
| D-CYCLE12-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_12_DOOR_SALES_REPORT.md | S3 | bug | Door per-seat refund attribution heuristic oversimplified | still-open |
| D-CYCLE12-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_EDITPUBLISHED_REPORT.md | S2 | tsc-error | events.tsx:711 duplicate toastWrap | still-open |
| D-CYCLE12-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_EDITPUBLISHED_REPORT.md | S2 | tsc-error | brandMapping.ts:180 Brand type | still-open |
| D-CYCLE12-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S2 | tsc-error | events.tsx:720 duplicate toastWrap | still-open |
| D-CYCLE12-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S2 | tsc-error | brandMapping.ts:180 Brand type | still-open |
| D-CYCLE12-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S3 | bug | Activity feed door-refund extension deferred to B-cycle | still-open |
| D-CYCLE12-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S3 | bug | PAYMENT_METHOD_LABELS duplication | still-open |
| D-CYCLE12-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S3 | bug | Per-seat refund attribution heuristic | still-open |
| D-CYCLE12-IMPL-6 | IMPLEMENTATION_BIZ_CYCLE_12_REWORK_BUNDLE_3FIX_REPORT.md | S3 | bug | Door per-seat refund attribution heuristic | still-open |
| D-CYCLE13-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md | S2 | bug | Cycle 13 forensics missed entire pre-existing J-A9 BrandTeamView cluster | still-open |
| D-CYCLE13-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md | S3 | bug | PublicBrandPage "Verified host since YYYY" pill suppressed (creator_accounts.created_at not wired) | still-open |
| D-CYCLE13-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md | S3 | bug | BrandProfileView Team row caption is static (needs live count or useBrandTeamStats) | still-open |
| D-CYCLE13-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md | S0 | bug | 9-surface regression: stub-brand operators locked (useCurrentBrandRole rank=0 fallback missing) | closed-elsewhere |
| D-CYCLE13-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_13A_PERMISSIONS_FOUNDATIONS_REPORT.md | S0 | bug | RolePickerSheet rendered invisibly behind parent (Modal nesting pattern) | closed-elsewhere |
| D-CYCLE13B-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_13B_PERMISSIONS_DEPTH_REPORT.md | S3 | bug | Strict-grep gate vs documentation token (canManualCheckIn 5 intentional hits remain) | still-open |
| D-CYCLE14-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | accountDeletionPreview.scannerInvitationsCount === 0 (placeholder) | still-open |
| D-CYCLE14-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | delete.tsx ~795 LOC vs SPEC ~620 estimate (39% over budget) | still-open |
| D-CYCLE14-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | expo-image-picker NSPhotoLibraryUsageDescription may need app.config.ts | closed-elsewhere |
| D-CYCLE14-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | D-14-2 SPEC pivot to creator_avatars bucket (NEW migration ~85 LOC) | still-open |
| D-CYCLE14-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | Pre-existing D-CYCLE12-IMPL-1 events.tsx:720 | still-open |
| D-CYCLE14-IMPL-6 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md | S3 | bug | Pre-existing D-CYCLE12-IMPL-2 brandMapping.ts:180 | still-open |
| D-CYCLE14-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT_v2.md | S0 | bug | delete.tsx signOut race (void vs await) | closed-elsewhere |
| D-CYCLE14-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT_v2.md | S0 | bug | AuthContext recovery gate (SIGNED_IN-only, not opportunistic) | closed-elsewhere |
| D-CYCLE15-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md | S2 | tsc-error | guestCsvExport.ts:238 duplicate else block (parse error) | closed-elsewhere |
| D-CYCLE15-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md | S3 | bug | LOC overage from SPEC estimate (2x over) | still-open |
| D-CYCLE15-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md | S2 | bug | Supabase email template verification gate ({{ .Token }} rendering) | still-open |
| D-CYCLE15-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT_v2.md | S2 | tsc-error | guestCsvExport.ts:442-466 stale duplicate exportDoorSalesCsv function | closed-elsewhere |
| D-CYCLE15-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT_v2.md | S1 | tsc-error | app/auth/index.tsx missing BusinessWelcomeScreen prop wiring | closed-elsewhere |
| D-CYCLE16A-IMPL-1 | IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md | S2 | spec-drift | Scanner refactor SKIPPED (already has graceful UX, ConfirmDialog would regress) | superseded |
| D-CYCLE16A-IMPL-2 | IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md | S3 | spec-drift | ConfirmDialog prop-name mismatch (body= vs description=, onCancel= vs onClose=) | still-open |
| D-CYCLE16A-IMPL-3 | IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md | S2 | bug | Sentry DSN not yet in .env (TRANSITIONAL ship) | still-open |
| D-CYCLE16A-IMPL-4 | IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md | S3 | bug | Pre-existing D-CYCLE12-IMPL-1 events.tsx:720 | still-open |
| D-CYCLE16A-IMPL-5 | IMPLEMENTATION_BIZ_CYCLE_16A_QUICK_WINS_REPORT.md | S3 | bug | Pre-existing D-CYCLE12-IMPL-2 brandMapping.ts:180 | still-open |
| D-704-IMPL-1 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S2 | bug | Phase implementation order deviation (kept narrow types, atomic switch later) | still-open |
| D-704-IMPL-2 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | EventCover.tsx JSDoc oklch() references (pre-existing, out of scope) | still-open |
| D-704-IMPL-3 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S2 | bug | "Open Orders" CTA shows toast stub (swappable in Cycle 9c) | still-open |
| D-704-IMPL-4 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S2 | bug | webPurchasePresent hardcoded false (Cycle 9c swappable) | still-open |
| D-704-IMPL-5 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S2 | bug | affectedOrderIds empty [] in stub mode (Cycle 9c swappable) | still-open |
| D-704-IMPL-6 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | Reject dialog uses ConfirmDialog simple variant (intentional) | still-open |
| D-704-IMPL-7 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | Reason discarded on reject (intentional, operator re-enters on retry) | still-open |
| D-704-IMPL-8 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | Step 7 Preview omitted (intentional, operator uses Cycle 9a preview) | still-open |
| D-704-IMPL-9 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | [banner-recorded] log fires every save (harmless for stub mode) | still-open |
| D-704-IMPL-10 | IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md | S3 | bug | validateStep shows "Fix" badge + toast on errors (intentional mirror of wizard) | still-open |
| D-706-IMPL-NONE | IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT.md | — | other | (no discoveries section) | — |
| D-IMPL-0707-1 | IMPLEMENTATION_ORCH-0707_REPORT.md | S3 | bug | card.category fallback dead code (no functional impact) | still-open |
| D-IMPL-0707-2 | IMPLEMENTATION_ORCH-0707_REPORT.md | S3 | bug | Mixed-shape cache during transition (harmless, categoryLabel wins) | still-open |
| D-IMPL-0707-3 | IMPLEMENTATION_ORCH-0707_REPORT.md | S3 | bug | aiDescription always-templated (intentional per SPEC Sec3.D) | still-open |
| D-IMPL-0707-4 | IMPLEMENTATION_ORCH-0707_REPORT.md | S3 | bug | Deno not installed in implementor sandbox (gap, tester runs Deno) | still-open |
| D-WEB-001-NONE | IMPLEMENTATION_ORCH-WEB-001_REPORT.md | — | other | (no discoveries section) | — |
| D-0721-IMPL-NONE | IMPLEMENTATION_ORCH-0721_REPORT.md | — | other | (no discoveries section) | — |
| D-0722-IMPL-NONE | IMPLEMENTATION_ORCH-0722_REPORT.md | — | other | (no discoveries section) | — |
| D-0724-IMPL-NONE | IMPLEMENTATION_ORCH-0724_REPORT.md | — | other | (no discoveries section) | — |
| D-0727-IMPL-NONE | IMPLEMENTATION_ORCH-0727_REPORT.md | — | other | (no discoveries section) | — |

---

## PART 2 SUMMARY

**Rows added:** 67 entries extracted from 20 reports (Cycles 11-16a + 7 recent ORCH).
**BIZ cycles scanned:** 11, 12 (4 reports), 13 (2 reports), 14, 15, 16a.
**ORCH cycles scanned:** 0704, 0706, 0707, WEB-001, 0721, 0722, 0724, 0727.
**Unreadable reports:** 0 — all 20 reports read successfully.

**Aggregate totals across Part 1 + Part 2:**
- **Total entries consolidated:** 101 rows
- **Total reports scanned:** 30 (Part 1: 10, Part 2: 20)
- **Reports with discoveries:** 26
- **Reports with no discoveries:** 5 (ORCH-0706, ORCH-WEB-001, ORCH-0721, ORCH-0722, ORCH-0724, ORCH-0727)
- **Top categories:** tsc-error (16), bug (31), spec-drift (9), docs (7), scope-deferral (4), other (5)
- **Top status:** still-open (66), closed-elsewhere (18), superseded (2), unknown (15)

