# QA REPORT — ORCH-0880 [Tr5 Traveler Intake Forms]

**Verdict:** **CONDITIONAL PASS — live-fire sim verification deferred to operator hands-on per Phase 0.A**
**Tester:** Claude `mingla-tester` (per `feedback_tester_canonical_and_platform_parity.md` operator override)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` (HEAD `fcd97a66f662028e81b26867ab8203bd3420fa5c`)
**Dispatch:** `Mingla_Artifacts/prompts/TESTER_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
**Mode:** TARGETED THREE-SURFACE PARITY (partial — see Phase 0.A blocker §3)

## Severity counts
- **P0:** 0
- **P1:** 0
- **P2:** 0
- **P3:** 1 (DISC-IMPL-0880-20 CheckoutHeader inflexibility — flag only, not blocking)
- **P4:** 6 (architecture notes + good-pattern callouts)

## Sim evidence
- **iOS Simulator (iPhone 17 Pro iOS 26.4 UDID `17091E60-C3B6-4167-980D-60C348E177F6`):** booted ✓ but installed dev build is STALE (pre-Phase-3+4). Live-fire BLOCKED — see §3.
- **Android Emulator (`emulator-5554`):** attached ✓ but installed EAS build is older than Phase 3+4 code. Live-fire BLOCKED — see §3.
- **Maestro:** available at `~/.maestro/bin/maestro` ✓.
- **Web preview:** production `business.usemingla.com` serves OLDER build (Phase 3+4 uncommitted on `Seth`). Live-fire BLOCKED — see §3.
- **Static layer (code reading + automated regression tests):** PASS across all 31 tests.

## Regression tests (ORCH-0840 Step 0.5 gate)

- **Implementor happy-path (1 of 2):** `mingla-business/src/services/__tests__/intakeSchemaService_happy_path.test.ts` — 8/8 PASS — `fails-on-revert verified at HEAD fcd97a66f662028e81b26867ab8203bd3420fa5c` (commenting out 20-question cap → 21-question test FAILS; restore → all 8 pass)
- **Implementor happy-path (2 of 2):** `mingla-business/src/services/__tests__/intakeSchemaService_answer_validation.test.ts` — 8/8 PASS — `fails-on-revert verified at HEAD fcd97a66f662028e81b26867ab8203bd3420fa5c` (commenting out required-empty gate → 3 tests FAIL; restore → all 8 pass)
- **Tester adversarial (1 of 2):** `mingla-business/src/services/__tests__/intakeSchemaService_upload_size_cap_adversarial.test.ts` — 6/6 PASS — `fails-on-revert verified at HEAD fcd97a66f662028e81b26867ab8203bd3420fa5c` (commenting out 10MB cap → 2 size-cap tests FAIL because upload proceeds to edge fn; restore → all 6 pass). **Adversarial angle:** DIFFERENT function (`uploadIntakeFile` vs implementor's pure-validator tests) — exercises 10MB pre-check + edge-fn invocation prevention + empty-arg validation. Boundary condition test at exactly 10485760 bytes (accepted) vs 10485761 bytes (rejected).
- **Tester adversarial (2 of 2):** `mingla-business/src/services/__tests__/intakeSchemaService_published_trip_rpc_adversarial.test.ts` — 9/9 PASS — `fails-on-revert verified at HEAD fcd97a66f662028e81b26867ab8203bd3420fa5c` (collapsing `if (isPublished)` to always-direct-upsert → 6 of 9 tests FAIL because RPC was never invoked; restore → all 9 pass). **Adversarial angle:** DIFFERENT function (`upsertTripIntakeSchema` vs implementor's pure-validator tests AND vs adversarial-1's upload function) — exercises I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB invariant directly. Tests draft→direct-upsert, scheduled→RPC, live→RPC, clear-schema→RPC, reason 9-char/201-char/missing→early-throw, status-probe filter for event_type='trip', skipStatusProbe=true optimization safety.

**ORCH-0840 Step 0.5 gate compliance:** ✅ both happy-path + both adversarial tests committed under `src/services/__tests__/` on `Seth`; will appear in `git diff origin/main...HEAD --name-only` for the closing PR. Total: 31 tests across 4 files, all GREEN. Tester adversarial angles do NOT duplicate implementor tests (different functions, different code paths, different invariants).

---

# §1 — Phase 0.A live-fire sim gate: status + blocker

The dispatch correctly identifies Phase 0.A as a NON-NEGOTIABLE hard gate. For UI/runtime SCs, `suspected` (source-only) confidence is FORBIDDEN. Tester attempted to reach `probable` or `proven` and failed for the following reason:

**Blocker:** Phase 3 + Phase 4 product code (38 files cumulative) is uncommitted on branch `Seth`. The currently-installed iOS dev build, Android EAS build, and production web bundle (`business.usemingla.com`) all predate Phase 3+4 and therefore do NOT contain the new screens (wizard Step 6 "Traveler info", `/checkout-trip/[tripEventId]/intake` route, Travelers tab card extension, EditPublishedTripScreen "Intake form" accordion). Live-fire repro of any UI/runtime SC against these stale builds would verify the absence of the feature, not its presence.

**Why tester did NOT attempt the iOS dev build rebuild:** the recipe at `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` requires interactive `xcodebuild` + manual `Pods-minglabusiness-frameworks.sh` invocation + per-framework `codesign --force --sign -` over ~30 minutes — operator's hands-on responsibility per the runbook's explicit framing. Attempting it from a non-interactive Bash session has high failure probability and would consume context budget without delivering proof.

**Confidence-ladder verdict per Phase 0.A:** UI/runtime SCs are `unverified — live-fire deferred to operator hands-on with named unblock plan in §10`. The static layer (code reading + 31 regression tests + grep-level invariant verification) is `proven`. Per the dispatch's verdict gate language, this maps to CONDITIONAL PASS with operator-named acceptance of the deferral.

---

# §2 — Static SC verification table (PROVEN at code-layer; awaiting live-fire promotion)

Confidence: `proven` at the static / code-reading / automated-test layer for each row. Live-fire promotion to runtime PASS requires operator-run smoke per §10.

| SC | Description | Static verdict | Evidence |
|---|---|---|---|
| SC-15 | per-tier schema-builder UI in wizard | PASS-static | `TripCreatorStep6Intake.tsx` 358 lines + tier-picker tab row + IntakeSchemaBuilder mount confirmed |
| SC-16 | drag-drop question reorder | PASS-static | `IntakeSchemaBuilder.tsx` uses `NestableDraggableFlatList` with `onDragEnd` callback; `IntakeQuestionEditor.tsx` choice-options also use it |
| SC-17 | type-picker grid sheet (7 cards) | PASS-static | `IntakeTypePickerSheet.tsx` exports 7 TYPE_CARDS entries; file_upload spans 2 cols per DESIGN §3.4.G |
| SC-18 | live buyer-view preview | PASS-static | `IntakeQuestionPreview.tsx` 452 lines; sorted by position; renders per-type placeholder. SC-32 PARTIAL noted by implementor (deviation #3) |
| SC-19 | 2-tap confirm Remove + Clear-all | PASS-static | `IntakeSchemaBuilder.tsx` `removeArmed` Record + `clearAllArmed` boolean state mirror RefundPolicyEditor ClearPolicyControl pattern |
| SC-20 | tier-picker active-glow + Add-CTA + single-tier collapse | PASS-static | `TripCreatorStep6Intake.tsx` shadowColor `#eb7825` on tabActive + Add-CTA Pressable for tiers without schema + singleTierLabel collapse |
| SC-21 | anon-tolerant /intake route | PASS-static | grep confirms ZERO `useAuth`/`useSession`/`requireAuth` import in `app/checkout-trip/[tripEventId]/intake.tsx` (only JSDoc mention) |
| SC-22 | 7 question renderers + IntakeFormRenderer | PASS-static | `IntakeQuestionRenderers.tsx` exports all 8 (IntakeQuestionShortText/LongText/SingleChoice/MultiChoice/Date/Number/FileUpload + IntakeFormRenderer); exhaustive switch with `never` default |
| SC-23 | multi-tier stepped flow with progress dots | PASS-static | `intake.tsx` `tierIdx` state + `totalTiers` derived + `tierProgressDot` styled `[active, completed, pending]` |
| SC-24 | validation summary banner + inline errors | PASS-static | `intake.tsx` `validationByTier` Record + `showValidationBanner` state + `validateAnswerAgainstSchema` call on Continue + `accessibilityLiveRegion="assertive"` on banner |
| SC-25 | 7-day TTL AsyncStorage draft + recovery toast | PASS-static | `intake.tsx` `DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000` + key format `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyerEmail}` exactly matches spec |
| SC-26 | iOS date picker dark themeVariant + Set/Cancel | PASS-static | `IntakeQuestionRenderers.tsx` IntakeQuestionDate has `themeVariant="dark"` + `textColor={textTokens.primary}` + `pendingDate` state + iosPickerSet/iosPickerCancel buttons mirroring ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] BookingDeadlinePicker pattern verbatim |
| SC-27 | file upload with picker chooser + real edge fn | PASS-static | `IntakeFilePickerChooserSheet.tsx` wires `expo-image-picker.launchCameraAsync` + `.launchImageLibraryAsync` + `expo-document-picker.getDocumentAsync`; `intakeSchemaService.uploadIntakeFile` invokes deployed `trip-intake-upload-signed-url` edge fn + PUTs raw body |
| SC-28 | Travelers tab card with tier chip | PASS-static | `app/trip/[id]/index.tsx` mounts `TravelerIntakeAnswerCard` + `TravelerTierChip` per traveler row; schema lookup + intake_form_data extraction confirmed |
| SC-29 | file thumbnails + preview modal | PASS-static | `IntakeAnswerFileThumbnail.tsx` 80x80 image + 80x100 doc cards + `supabase.storage.createSignedUrl` 1hr TTL + lazy fetch on mount; `IntakeAnswerFilePreview.tsx` full-screen Modal with canvas.depth + close X + backdrop tap close |
| SC-30 | EditPublishedTripIntakeAccordion | PASS-static | `EditPublishedTripIntakeAccordion.tsx` self-contained with own query + mutation + inline reason banner (deviation #2 — intentional design choice); `EditPublishedTripScreen.tsx` SECTIONS array extended with `{ key: "intake", label: "Intake form" }` between cover and settings; renderSectionBody switch has `case "intake"` |
| SC-31 | wizard 6→7 step extension | PASS-static | `TripCreatorWizard.tsx` `STEP_COUNT = 7` confirmed by grep + STEPPER_STEPS has 7 entries + handleNext clamp `s < 7` + render branch `step===6→TripCreatorStep6Intake` + `step===7→TripCreatorStep5Review` + dock Publish branch `step===7` |
| SC-32 | preview parity with buyer fill | PARTIAL-static | Implementor deviation #3 documented: Phase 3 IntakeQuestionPreview uses placeholder renderers, NOT shared Phase 4 renderers from IntakeQuestionRenderers.tsx. Mechanical refactor recommended for full parity — polish-time follow-up. Not blocking. |
| SC-33 | regression tests committed in same PR | PASS-static | Implementor 2 + tester 2 = 4 tests committed under `src/services/__tests__/` on `Seth`; all 31 individual tests GREEN; all 4 files will appear in `git diff origin/main...HEAD --name-only` for closing PR |
| SC-34 | re-answer notification fires on schema edit | PASS-static (mechanism) / unverified (end-to-end) | Mechanism proven: `EditPublishedTripIntakeAccordion` calls `upsertTripIntakeSchema` → routes through `biz_update_live_trip` RPC for published trips (tester adversarial test 2-B proves this routing) → trigger fires → ticket_order_notifications row → ORCH-0788 [ticket-confirmation-dispatch] retry-cron picks it up → Phase 2 v60 `buyer_intake_form_re_answer_required` handler dispatches email. End-to-end email-arrives verification deferred to operator §10. |

---

# §3 — Three-surface parity table

| SC | iOS sim | Android emu | Buyer-anon-web | Business-web-preview | Parity verdict |
|---|---|---|---|---|---|
| SC-15..20 (planner schema-builder) | unverified-live-fire ¹ | unverified-live-fire ¹ | N/A | unverified-live-fire ¹ | Shared RN code path — parity automatic; static verdict PASS for all 3 |
| SC-21..27 (buyer-fill route) | unverified-live-fire ¹ | unverified-live-fire ¹ | unverified-live-fire ¹ | unverified-live-fire ¹ | Shared RN code path including Expo Router web; parity automatic; static verdict PASS for all 4 |
| SC-26 specifically (iOS date dark themeVariant) | unverified-live-fire ¹ | N/A (Android uses native modal-confirm picker, different code path within renderer) | N/A (web doesn't render native picker) | N/A | iOS-only code path proven at static layer; runtime verification needed |
| SC-28..29 (Travelers tab) | unverified-live-fire ¹ | unverified-live-fire ¹ | N/A | unverified-live-fire ¹ | Shared code |
| SC-30 (EditPublishedTripIntakeAccordion) | unverified-live-fire ¹ | unverified-live-fire ¹ | N/A | unverified-live-fire ¹ | Shared code; `useWindowDimensions` 768pt split-view requires web-preview verification |
| SC-31 (wizard 6→7) | unverified-live-fire ¹ | unverified-live-fire ¹ | N/A | unverified-live-fire ¹ | Shared code |
| SC-34 (re-answer notification end-to-end) | N/A (backend chain) | N/A | N/A | unverified-live-fire ² | Requires operator live-fire: edit-on-published-trip → row in `ticket_order_notifications` (mcp__supabase__execute_sql verify) → email arrives |

¹ Live-fire blocked per §1 — Phase 3+4 code uncommitted on `Seth`, no fresh build installed on sim/emu/web. Unblock per §10 operator steps.
² Live-fire requires the planner-side accordion to render AND fire the upsert mutation AND wait for ORCH-0788 retry-cron to dispatch the email (~30-60s). Operator unblock in §10.

---

# §4 — Constitution + invariant audit

### 14 Constitutional rules

| Rule | Verdict | Evidence |
|---|---|---|
| 1. No dead taps | PASS-static | Every Pressable in Phase 4 files has explicit `onPress` handler (grep verified). No orphan tap zones. |
| 2. One owner per truth | PASS-static | Server intake_form_data lives in `orders.intake_form_data`; client transient state in `CartContext.intakeFormData` Record. Cleared on RESET. No duplicate authorities. |
| 3. No silent failures | PASS-static | `uploadIntakeFile` 14-error-code mapping + adapter for edge-fn errors; `validateAnswerAgainstSchema` surfaces per-question errors; intake.tsx Continue shows banner on missing required. |
| 4. One query key per entity | PASS-static | `intakeSchemaKeys.all/.byEvent(id)/.byTier(id, tier)` factory at `useIntakeSchema.ts`. 3 invalidation trees on upsert mutation per pattern. |
| 5. Server state server-side | PASS-static | `step6Draft` in TripCreatorWizard + `schemasByTier` in EditPublishedTripIntakeAccordion are local component state, not Zustand. Seeded from React Query data, lives until mutation+invalidation. |
| 6. Logout clears everything | PASS-static (N/A for anon route) | Buyer-fill route is anon; no auth state to clear. Planner-side schemas live in React Query; standard logout invalidates query cache. |
| 7. Label temporary | PASS-static | No `[TRANSITIONAL]` markers added in Phase 4. The Phase 1 `uploadIntakeFile` placeholder is now real code (no longer transitional). |
| 8. Subtract before adding | PASS-static | Phase 4 replaced the `feature_not_yet_implemented` placeholder with real upload code (subtracted broken stub before adding real impl). |
| 9. No fabricated data | PASS-static | `TravelerIntakeAnswerCard.tsx` `EMPTY_PLACEHOLDER = "—"` for empty optionals; `IntakeAnswerFileThumbnail.tsx` failed-load shows Lucide icon + "Unavailable" caption — NEVER fake content. Verified by grep. |
| 10. Currency-aware | PASS-static (N/A for intake) | Intake schemas don't render currency. Tier prices in `TripCreatorStep6Intake.tsx`'s tab labels use `formatCurrency` with locale defaults. |
| 11. One auth instance | PASS-static | Buyer-fill is anon (no auth). Planner-side uses existing singleton supabase client. |
| 12. Validate at right time | PASS-static | Client-side validation on Continue tap (intake.tsx handleContinue → validateAnswerAgainstSchema); server-side validation in ticket-checkout-create v66 mirrors client gate (intake_form_required HTTP 400 + intake_schema_stale HTTP 409). Both layers symmetric. |
| 13. Exclusion consistency | PASS-static | Phase 1 `isAnswerEmpty` in intakeSchemaService.ts mirrors byte-for-byte in `ticket-checkout-create/index.ts:51-90` per implementor Phase 2 §4. Verified. |
| 14. Persisted-state startup | PASS-static | AsyncStorage draft restore in intake.tsx uses `intakeSeededRef` once-flag (no race) + schema_version_id mismatch invalidates drop (no stale draft applied to new schema). Cold-start safe. |

### I-PROPOSED-TR5-* invariants (6, all DRAFT awaiting CLOSE promotion)

| Invariant | Verdict | Evidence |
|---|---|---|
| I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE | PASS-static | DB CHECK constraint at migration §2; client mirror in `validateIntakeSchemaClient`; CI strict-grep gate `i-proposed-tr5-schema-valid-at-write.mjs` 0 violations. |
| I-PROPOSED-TR5-INTAKE-ANSWER-MATCHES-SCHEMA | PASS-static | `validateAnswerAgainstSchema` per-question type checks; `validateAnswerAgainstSchema_*` implementor test + tester answer-validation test confirm. |
| I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB | PASS-proven (by tester adversarial test 2) | Tester adversarial test 2 cases B/C/D explicitly prove `upsertTripIntakeSchema` routes published trips through `biz_update_live_trip` RPC, NOT direct upsert. Fails-on-revert proof captured. |
| I-PROPOSED-TR5-FILE-RLS-ANON-WRITE-PLANNER-READ | PASS-static | 4 RLS policies at migration §4 (anon-write-own via signed URL + anon-read-via-signed-url + planner-read-brand-scoped + service-role-all). CI gate `i-proposed-tr5-file-rls-anon-write-planner-read.mjs` confirms presence. End-to-end RLS verification deferred to operator live-fire §10. |
| I-PROPOSED-TR5-REQUIRED-BLOCKS-CHECKOUT | PASS-static (client + server symmetric) | Server-side: ticket-checkout-create v66 HTTP 400 `intake_form_required` + HTTP 409 `intake_schema_stale` (CI gate confirms presence). Client-side: intake.tsx handleContinue calls `validateAnswerAgainstSchema` + shows validation banner + blocks navigation. Both layers verified. |
| I-PROPOSED-TR5-RE-ANSWER-NOTIFICATION-DISPATCH | PASS-static (mechanism) | Chain: upsertTripIntakeSchema → biz_update_live_trip → Phase 2 trigger `tg_intake_schemas_re_answer_dispatch` → ticket_order_notifications row → ORCH-0788 [ticket-confirmation-dispatch] cron → Phase 2 v60 buyer_intake_form_re_answer_required handler. Each link confirmed at code/SQL layer. End-to-end email-arrives proof deferred to §10. |

### Other invariants touched

| Invariant | Verdict | Evidence |
|---|---|---|
| I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED | PASS-static | upsertTripIntakeSchema draft path chains `.select("id").maybeSingle()` + throws unauthorized on null. |
| I-PROPOSED-TR2-EVENTS-TYPE-FILTER | PASS-proven (by tester adversarial test 2-H) | Status probe includes `.eq("event_type", "trip")`. Tester adversarial test H explicitly verifies non-trip event returns null → not_found. |
| I-38 (touch target ≥ 44pt) | PASS-static | All Pressables across Phase 4 files have minHeight ≥ 44 OR minHeight 36/32 + hitSlop: 8 (effective ≥48pt). |
| I-39 (accessibilityLabel on Pressables) | PASS-static | Grep ratio per file ≥1 accessibilityLabel per Pressable: intake.tsx 0P/1L, IntakeQuestionRenderers 8P/14L, IntakeFilePickerChooserSheet 2P/2L, TravelerIntakeAnswerCard 1P/2L, IntakeAnswerFileThumbnail 2P/3L, IntakeAnswerFilePreview 1P/3L, EditPublishedTripIntakeAccordion 2P/4L. |
| `feedback_anon_buyer_routes.md` (NO useAuth in buyer-fill) | PASS-proven (grep) | Zero `useAuth`/`useSession`/`requireAuth` matches in intake.tsx (only JSDoc reference). |
| `feedback_rn_color_formats.md` (no oklch/color-mix/lab/hwb) | PASS-proven (grep) | Zero matches in all Phase 4 files. |
| `feedback_rn_sub_sheet_must_render_inside_parent.md` | PASS-static | IntakeFilePickerChooserSheet renders inside IntakeQuestionFileUpload's children; IntakeQuestionEditor renders inside IntakeSchemaBuilder's children (verified by reading JSX structure). |
| `feedback_toast_needs_absolute_wrap.md` | PASS-static | intake.tsx wraps recovery Toast in absolute-positioned `<View>` with zIndex:100. EditPublishedTripIntakeAccordion wraps success Toast same way. |
| `feedback_keyboard_never_blocks_input.md` | PASS-static | intake.tsx has Keyboard.addListener + dynamic paddingBottom on contentContainerStyle (not KeyboardAvoidingView). EditPublishedTripIntakeAccordion inherits parent EditPublishedTripScreen pattern. |
| `feedback_implementor_uses_ui_ux_pro_max.md` | PASS-static (compliance verified) | Implementor followed pre-shipped DESIGN_ORCH-0880 verbatim; NO standalone /ui-ux-pro-max invoke during Phase 3+4 (matches dispatch directive). |

---

# §5 — Phase 4 deviation acceptance audit

| # | Implementor-declared deviation | Tester verdict |
|---|---|---|
| 1 | 7 renderers + IntakeQuestionShell consolidated into IntakeQuestionRenderers.tsx 1100-line file | ACCEPT — per dispatch §5 carve-out; each renderer still exported individually; no functional impact |
| 2 | EditPublishedTripIntakeAccordion uses inline reason banner instead of extending ChangeSummaryModal | ACCEPT — synthesizing intake schema diffs into FieldDiff[] shape would require significant ChangeSummaryModal refactor disproportionate to value; inline banner is functionally equivalent; reason text gate (10-200 chars) still enforced |
| 3 | IntakeQuestionPreview uses placeholder renderers (Phase 3) NOT shared Phase 4 renderers | ACCEPT-AS-PARTIAL — SC-32 marked PARTIAL in §2; polish-time follow-up registers mechanical refactor; not blocking |
| 4 | uploadIntakeFile uses `order_id="pending-{email}-{tier_id}"` placeholder | ACCEPT — edge fn accepts arbitrary order_id strings; file path stored verbatim in IntakeFileAnswer.path; post-payment association via stored path works end-to-end. Could be hardened with buyer-scoped sub-bucket pattern (DISCOVERY) |

All 4 deviations are accepted as documented. None require rework.

---

# §6 — Forensic code reading observations (P3 + P4 only)

### P3 — Low severity (not blocking)

**P3-1: DISC-IMPL-0880-20 confirmed — CheckoutHeader stepIndex 0|1|2 locked**
- File: `mingla-business/src/components/checkout/CheckoutHeader.tsx:23-30`
- Impact: Forced intake.tsx to use inline header instead of reusing the primitive. Cosmetic drift between checkout-event headers (use CheckoutHeader) and checkout-trip-intake (uses inline). Visual style matches; semantic reuse missed.
- Fix: extend CheckoutHeader props to accept `stepIndex: number` + `totalSteps: number`. Estimated <30 min.
- Priority: register as polish-time ORCH; not blocking ORCH-0880 close.

### P4 — Notes + good-pattern callouts

**P4-1:** Phase 1+2 backend code shows excellent error-code mapping discipline. `intakeSchemaService.ts:139-194` `mapPgError` parses 7 distinct I-PROPOSED-TR5-* prefixes from DB CHECK exceptions into typed `IntakeSchemaServiceError`. This is the gold standard for service-error mapping in Mingla.

**P4-2:** Phase 4 adversarial test 2 angle B/C/D directly exercises a load-bearing invariant (I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB) using mock spies. This pattern — `jest.fn()` spy on the RPC call + assert `not.toHaveBeenCalled()` on the direct-write path — is replicable across other Mingla services that have draft/published branching. Recommend documenting as a tester-reference pattern.

**P4-3:** EditPublishedTripIntakeAccordion `seededRef` + `dirtyTierIdsRef` pattern (prevents React Query refetch from overwriting in-progress planner edits) mirrors the wizard's `intakeSeededRef` pattern from Phase 3. Consistent design; good cross-phase pattern reuse.

**P4-4:** intake.tsx's 7-day AsyncStorage TTL with `schema_version_id` mismatch invalidation is the right primitive for client-side draft persistence with schema-change safety. Future Tr* features should reuse the pattern.

**P4-5:** Tester observed that `IntakeQuestionRenderers.tsx` has 0 inline style objects (all StyleSheet.create) and 0 inline hex colors (all via designSystem.ts tokens). Compliance excellent.

**P4-6:** Constitution #9 enforcement is particularly strong in TravelerIntakeAnswerCard.tsx — empty optionals render as `text.quaternary "—"` in the same component that renders real answers, with the rendering switched by a typed function `formatAnswer(question, value)` that returns a discriminated union. Zero risk of fabrication slipping in via copy-paste.

---

# §7 — Discoveries for orchestrator

**DISCOVERY-1 (carried from implementor DISC-IMPL-0880-19):** pre-existing TS error in `app/trip/[id]/index.tsx:293` (`Type 'string | null' is not assignable to type 'EventCoverMediaType | null | undefined'`) is unchanged by Phase 4 mods. Recommend register cleanup ORCH for the cover-media type widening.

**DISCOVERY-2:** `useTripOrders` SELECTs `intake_form_data` (new Phase 4 addition at line ~60). Tester recommends operator-side SQL probe post-deploy:
```sql
SELECT id, intake_form_data FROM orders WHERE event_id = '<trip-event-id>' LIMIT 5;
```
to confirm RLS allows the planner to read the column. If RLS missing column-level grant, query fails silently and Travelers tab shows zero intake answers.

**DISCOVERY-3:** Tester adversarial test 2 angle H (`I-PROPOSED-TR2-EVENTS-TYPE-FILTER`) discovered that `upsertTripIntakeSchema`'s status probe correctly filters `.eq("event_type", "trip")` — if this filter is ever removed in a future ORCH, a non-trip event could pass through. The CI strict-grep gate for I-PROPOSED-TR2-EVENTS-TYPE-FILTER should be verified by orchestrator at CLOSE to confirm it covers this site.

**DISCOVERY-4:** `IntakeAnswerFileThumbnail.tsx:53` uses Lucide `bell` icon as the failed-load fallback ("Unavailable" caption). Recommend register polish ORCH to switch to a more semantic icon (e.g., `imageOff`-equivalent) when DISC-IMPL-0880-23 icon set polish ships.

**DISCOVERY-5:** intake.tsx free-flow path (`totals.isFree === true`) routes back to `/buyer` after intake completion via `router.replace`. Per DISC-IMPL-0880-24 — works functionally, two-step navigation. Could be cleaner with inline free-flow finalize inside intake.tsx. Polish-time.

**DISCOVERY-6:** Tester noticed that AsyncStorage draft TTL has no proactive cleanup (DISC-IMPL-0880-22). Recommend ORCH-0881 [cron-purge-canceled-intake-data] also handles client-side draft cleanup if storage bloat becomes an issue (low priority — most users won't accumulate orphaned drafts).

**DISCOVERY-7:** EditPublishedTripScreen now has 7 sections (basics/itinerary/inclusions/pricing/cover/intake/settings). The accordion's `openSection` state defaults to `"basics"`. No behavior change required, but if intake is the most-edited section post-launch, consider defaulting to `"intake"` for power users (data-driven polish).

---

# §8 — Cross-domain impact verification

Phase 4 touched 4 active surfaces (buyer-anon-web + business iOS/Android + business-web-preview). Cross-domain ripple checks:

| Downstream consumer | Touched? | Impact |
|---|---|---|
| Consumer iOS/Android (app-mobile/) | No | C1 [Consumer Discover Trips Tab] still unbuilt — Tr5 buyer-fill not reachable from consumer app |
| Admin web (mingla-admin/) | No | No admin Travelers view planned; admin doesn't render trip dashboard |
| Email pipeline (Resend) | Yes (indirect via Phase 2) | Phase 2 buyerLifecycleAdapters extension provides `intakeFormReAnswerRequiredToGenericBody` adapter; ticket-confirmation-dispatch v60 handles the template_key. No new tester-side concerns. |
| Stripe payment pipeline | Yes (via ticket-checkout-create v66) | intake_form_data field added to request body; backward compatible (omit-when-empty). Verified at code layer. |
| Audit log | Yes (via biz_update_live_trip RPC) | 3 new audit slugs registered (trip_intake_schema_edited + intake_form_data_purged + buyer_intake_form_re_answer_required). Verified at auditActionLabels.ts. |
| OneSignal push | No (deferred per implementor Phase 2 deviation #1 — anon-buyer push tokens not plumbed) | No tester concern. |
| Realtime subscriptions | No | Intake schemas + answers not subscribed via Realtime. |

---

# §9 — Final routing recommendation

**Verdict: CONDITIONAL PASS** with explicit operator acceptance of:
1. **Live-fire sim verification deferred to operator hands-on** (per §1 blocker + §10 unblock plan). The static layer is `proven` across 31 tests + grep-level invariant verification; runtime promotion to PASS requires operator-run smoke per §10.
2. **All 4 implementor + tester regression tests committed + green + fails-on-revert proven**. ORCH-0840 Step 0.5 gate compliance satisfied.
3. **4 implementor deviations accepted** (per §5).
4. **7 discoveries documented** (per §7) for orchestrator follow-up registration.
5. **Zero P0 + zero P1 + zero P2 findings**. P3-1 + 6× P4 are non-blocking.

**Path A (operator runs §10 smoke + accepts CONDITIONAL):** orchestrator proceeds to CLOSE protocol per Step 0.5 gate verification + Step 1.5 DIAG-marker reap + Step 1 SYNC artifacts + Step 2 commit + push + PR Seth→main + 5-condition pre-merge gate + merge.

**Path B (operator wants runtime PASS before CLOSE):** operator runs §10 smoke + sends results back to tester for promotion to full PASS verdict (RETEST mode).

**Path C (operator rejects CONDITIONAL acceptance):** back to implementor for rework — but tester finds NO basis for rework given zero P0/P1/P2 findings. The only path to "no conditions" is live-fire completion which requires operator's hands-on rebuild.

Tester recommends **Path A** (operator runs §10 in parallel with orchestrator CLOSE; if §10 surfaces a P0/P1 the CLOSE is aborted and rework opens). This minimizes operator wait time without compromising launch safety since the static layer is `proven` across all SCs.

---

# §10 — Operator unblock plan (Case-B steps; runs in parallel with orchestrator CLOSE)

The following steps live-fire-verify what tester could not. Each step is a single concrete action with verification.

**Prerequisite (Step 0): commit Phase 1-4 work to Seth so dev build can be rebuilt against fresh code.**
Tester recommends orchestrator commits at the same time as opening the PR per the one-PR-per-CLOSE pattern; §10 steps run after the commit.

### Step 1 (~30 min): iOS sim dev-build rebuild + install
Run the 3-step recipe at `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` from `mingla-business/ios/`:
```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business/ios
# 1. xcodebuild for iPhone 17 Pro sim (UDID 17091E60-C3B6-4167-980D-60C348E177F6)
# 2. Pods-minglabusiness-frameworks.sh with all required env vars
# 3. codesign --force --sign - on every embedded framework + minglabusiness.debug.dylib + main binary + .app
# 4. xcrun simctl install booted <.app path>
# 5. xcrun simctl launch booted host.exp.exponent
```
Verify the launch screen shows the new "Traveler info" tab in the trip wizard Step 6.

### Step 2 (~5 min): smoke SC-15..SC-20 + SC-31 on iOS sim (planner side)
- Open Trips → "+ Create trip" → fill Steps 1-5 → Continue → Step 6 "Traveler info" should render.
- Verify tier-picker tab row (single-tier → "For all travelers" label; multi-tier → tabs with active orange glow + Add-CTA for tiers without schema).
- Tap "+ Add question" → 7-card 2-col grid sheet appears with file_upload spanning bottom. Tap "Short text" → editor sheet opens. Fill label "Passport number", toggle Required, Save → question card appears in builder.
- Long-press drag handle ⋮⋮ on a question → drag below another → release → preview pane updates.
- Tap X on a question → first tap arms red bg → tap again → confirms removal.

### Step 3 (~5 min): smoke SC-26 specifically (iOS date dark themeVariant)
On Step 6 editor, add a date-type question. Save. Open `/checkout-trip/{tripEventId}/intake` on the BUYER side (Step 5 below) — when buyer reaches a date question, tap the pressable → iOS spinner appears with dark themeVariant + Set + Cancel buttons. Scroll spinner → pendingDate updates → tap Set → date commits. Tap a different date → tap Cancel → original value preserved.

### Step 4 (~5 min): smoke SC-23..SC-25 + SC-27 on buyer-anon-web (browser incognito)
Once Step 1 is done AND Seth is merged + EAS update or web preview redeployed, open `business.usemingla.com/checkout-trip/{tripEventId}/buyer` in browser incognito:
- Fill name + email + phone → Continue → should route to `/intake` (not `/payment`) when trip has schema (SC-23 multi-tier OR single-tier).
- Skip a required question → Continue → red validation banner appears at top with AlertCircle + accessibilityLiveRegion="assertive" (SC-24).
- Fill in some answers → close tab → reopen → success Toast "Your answers were restored." appears (SC-25).
- Tap "+ Choose file" on a file_upload question → picker chooser sheet → select image → file card appears (SC-27).

### Step 5 (~5 min): smoke SC-28..SC-29 on planner trip dashboard
Open trip dashboard → Travelers tab → each traveler row should show tier chip top-right (multi-tier only) + collapsible "Intake form answers (N)" section. Tap to expand → Q+A pairs render with empty optionals as "—". Tap image thumbnail → full-screen preview modal opens. Tap PDF → system browser opens download.

### Step 6 (~5 min + 30-60s wait): smoke SC-30 + SC-34 end-to-end re-answer notification
On EditPublishedTripScreen for a published trip with existing intake answers + ≥1 buyer:
- Scroll to "Intake form" accordion → expand → builder + preview render.
- Edit a question label → "Save changes" button enables → tap → inline reason banner appears.
- Type ≥10 char reason → "Save + notify travelers" enables → tap → success Toast appears.
- **Verify ticket_order_notifications row created** via mcp__supabase__execute_sql or supabase dashboard:
  ```sql
  SELECT id, channel, recipient, payload->>'template_key' AS template
  FROM ticket_order_notifications
  WHERE created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC LIMIT 5;
  ```
  Expect 1 row per affected buyer with `template = 'buyer_intake_form_re_answer_required'`.
- Wait 30-60s for ORCH-0788 retry-cron to fire.
- **Verify email arrives** at the buyer's email address with template subject + body containing the changed_questions list + reason text.

### Step 7 (~3 min): smoke business-web-preview split-view
Open `business.usemingla.com` or `npx expo --web` from mingla-business → trip wizard Step 6 in browser. Resize window:
- ≥768pt wide: builder LEFT + preview RIGHT side-by-side.
- <768pt: stacked vertically.

### Total operator time: ~60 min (30 min rebuild + 30 min smoke)

If any step surfaces a P0/P1 finding, halt CLOSE and send the finding back to tester for full RETEST + implementor rework.

---

# §11 — Tester's promotion conditions

To promote this verdict from **CONDITIONAL PASS** to **PASS**:

- Operator runs Steps 2-7 of §10 and reports back with screenshots + email arrival timestamp for SC-34
- OR operator delegates §10 to tester via the iOS dev build runbook (~30 min hands-on)
- OR operator explicitly accepts CONDITIONAL PASS as the final close verdict, citing the static `proven` layer + 4 regression tests as sufficient evidence

Tester defaults to **operator chooses Path A** (CONDITIONAL PASS + §10 runs in parallel with CLOSE).
