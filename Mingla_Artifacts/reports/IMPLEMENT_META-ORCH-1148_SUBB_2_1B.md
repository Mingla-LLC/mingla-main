# IMPLEMENT — META-ORCH-1148 sub-ORCH 2.1b (Reservations lifecycle + Waitlist + Twilio "table's ready" SMS)

- **Skill:** mingla-implementor
- **Sub-ORCH:** META-ORCH-1148 / **2.1b** (the second/final slice of the OPERATOR booking core).
- **Branch / worktree:** `ORCH-1148-venue-reservations-waitlist` @ `~/Desktop/mingla-orchs/ORCH-1148-[venue-reservations-waitlist]/`
- **HEAD after this implementation:** **`7eeb41d6f328b11def80273463b7be396370c11b`** (rebased onto current origin/main — already up to date, no rebase movement).
- **Binding inputs read on entry:** PRD `PRD_META-ORCH-1148_FIRSTSHIP_BOOKING_LOOP.md`, Journey Map `JOURNEY_MAP_META-ORCH-1148_RESERVATION_E2E.md` (incl. the LOCKED DECISIONS: Twilio SMS in ship 1, auto-forfeit no-show), Vision, Design IA, the SHIPPED 2.0 schema + 2.1a engine + suite shell. (No `COMMS_LEDGER.md` exists at the cited path in this worktree or main; the closest ledger artifacts were reviewed — none carry an open BLOCK relevant to 2.1b.)
- **NOT done (per directive):** no deploy, no migration applied to prod, no edge-fn deploy, no merge. Migrations authored only.

---

## 1. Changed files (21; all committed, scoped allowlist only)

### Migrations (additive-only; base `20261010*`, monotonic above the 2.1a max `20261008000003`)
| File | Purpose |
|------|---------|
| `supabase/migrations/20261010000000_orch_1148_sms_consent_and_log.sql` | `venue_sms_opt_out` (STOP ledger, service-role-only, partial-unique global+per-brand) + `venue_sms_log` (append-only send attempts, brand-member READ / service-role WRITE). |
| `supabase/migrations/20261010000001_orch_1148_reservation_lifecycle_rpcs.sql` | `pg_reservation_transition_is_legal(text,text)` (the legal-transition matrix), `biz_reservation_transition(...)` (the SINGLE guarded+audited lifecycle mutator), `biz_reservation_create(...)` (manual FREE operator create). |
| `supabase/migrations/20261010000002_orch_1148_waitlist_rpcs_and_indexes.sql` | `biz_waitlist_mark_notified(...)`, `biz_waitlist_convert_to_reservation(...)` (ATOMIC create+mark), the list-view index `reservations_brand_status_reserved_idx` + active-queue index. |
| `supabase/migrations/20261010000003_orch_1148_reservation_lifecycle_probes.sql` | Read-only invariant probe (fails-on-revert at the DB layer). |
| `supabase/migrations/__tests__/orch_1148_venue_suite_migration.test.ts` | **Extended** (T-MIG-21..30) + corrected the pre-existing stale T-MIG-20 (see §6). |

### Edge function
| File | Purpose |
|------|---------|
| `supabase/functions/send-venue-sms/index.ts` | NEW — operator-triggered "table's ready" Twilio SMS (auth + manager-plus brand gate + E.164 validation + opt-out gate + locked copy + approved-toll-free Messaging Service + send-log + mark-notified). |
| `supabase/functions/__tests__/send_venue_sms.test.ts` | NEW — source-contract test (T-SMS-1..8: locked copy, toll-free-only, opt-out honored, E.164, env creds, brand gate, log). |
| `supabase/config.toml` | **Modified (add-only)** — registered `[functions.send-venue-sms] verify_jwt = true`. |

### Business app
| File | Purpose |
|------|---------|
| `mingla-business/src/types/venueReservation.ts` | **Modified (add-only)** — 2.1b domain shapes (`Reservation`, `ReservationStatus/Source/View/Action/Tag`, `WaitlistEntry`, create/add inputs). 2.0/2.1a shapes untouched. |
| `mingla-business/src/hooks/useVenueReservations.ts` | NEW — list + brand-scoped realtime + guarded create + transition. |
| `mingla-business/src/hooks/useVenueWaitlist.ts` | NEW — list + realtime + add/notify(edge fn)/convert/mark-lost. |
| `mingla-business/src/components/venue/reservationViews.ts` | NEW pure helper — view filtering + the CLIENT lifecycle-transition mirror + status presentation (fails-on-revert anchor). |
| `mingla-business/src/components/venue/ReservationCard.tsx` | NEW — the Design-IA reservation card. |
| `mingla-business/src/components/venue/ReservationDetailSheet.tsx` | NEW — lifecycle actions (legal-only; destructive reach+confirm). |
| `mingla-business/src/components/venue/ReservationCreateSheet.tsx` | NEW — manual create (party/date/engine-slots/table/source/occasion/tags/contact). |
| `mingla-business/src/components/venue/VenueReservationsModule.tsx` | NEW — the module (segmented views + list + detail + create). |
| `mingla-business/src/components/venue/WaitlistAddSheet.tsx` | NEW — add-to-waitlist form. |
| `mingla-business/src/components/venue/WaitlistConvertSheet.tsx` | NEW — convert (engine slots + table → atomic RPC). |
| `mingla-business/src/components/venue/VenueWaitlistModule.tsx` | NEW — the queue + Notify/Seat/Lost. |
| `mingla-business/src/components/venue/VenueSuiteShell.tsx` | **Modified (surgical)** — dispatch swap ONLY (reservations→module, waitlist→module; ComingSoon import removed; unused `goToSettings` removed; stale docstring updated). All shell machine/layout/scroll preserved. |
| `mingla-business/src/components/venue/__tests__/reservationViews.test.ts` | NEW unit test (T-RES-1..9). |

> `VenueModuleComingSoon.tsx` is now orphaned but intentionally **left in place** (2.0 artifact, harmless, not deleted).

---

## 2. RPC signatures (the guarded contract 2.2 / the operator UI call)

```
pg_reservation_transition_is_legal(p_from text, p_to text) RETURNS boolean
  LANGUAGE sql IMMUTABLE  -- the single legal-transition matrix

biz_reservation_transition(
  p_reservation_id uuid, p_to_status text,
  p_table_id uuid DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS public.reservations
  SECURITY DEFINER · manager+ gate · enforces pg_reservation_transition_is_legal · audited
  · no_show records the venue's no_show_fee_policy DECISION (NO Stripe capture — 2.2 seam)

biz_reservation_create(
  p_brand_id uuid, p_reserved_for timestamptz, p_party_size int,
  p_source text='phone', p_guest_name/p_guest_phone_e164/p_guest_email,
  p_table_id, p_occasion, p_guest_notes, p_tags text[], p_status text='confirmed'
) RETURNS public.reservations
  SECURITY DEFINER · manager+ gate · FREE (no fee) · created_via='operator' · audited

biz_waitlist_mark_notified(p_waitlist_id uuid, p_expire_minutes int=15, p_notify_via text='sms')
  RETURNS public.venue_waitlist · SECURITY DEFINER · manager+ gate · audited

biz_waitlist_convert_to_reservation(p_waitlist_id uuid, p_reserved_for timestamptz, p_table_id uuid=NULL)
  RETURNS public.reservations · SECURITY DEFINER · manager+ gate · ATOMIC (insert reservation + mark
  waitlist converted+linked in ONE txn) · audited
```

**Legal-transition matrix (server-authoritative):** requested→{confirmed,cancel\*}; confirmed→{seated,no_show,completed,cancel\*}; seated→{completed,no_show,cancelled_by_venue}; waitlisted→{confirmed,cancel\*}; completed/no_show/cancelled\* = terminal. `no_show` is reachable ONLY from confirmed/seated.

**Grant boundary (all 5 fns):** `REVOKE ALL … FROM PUBLIC` + `REVOKE EXECUTE … FROM anon` + `GRANT EXECUTE … TO authenticated`. The `REVOKE … FROM PUBLIC` is **required** — the Supabase Postgres image auto-grants EXECUTE to PUBLIC on every new function; without it the fns are PUBLIC/anon-callable (the live probe caught this; see §6).

---

## 3. Edge fn design + Twilio secrets

**`send-venue-sms`** (`verify_jwt = true`): POST `{ waitlistId }`. Flow: (1) authenticate caller's JWT; (2) resolve waitlist row → brand → phone; (3) gate on `biz_brand_effective_rank_for_caller >= 40` (event_manager); (4) validate E.164 (`/^\+[1-9][0-9]{1,14}$/`); (5) **opt-out gate** — read `venue_sms_opt_out`, block on a global (`brand_id IS NULL`) OR per-brand match; (6) send the LOCKED copy via the **approved toll-free Messaging Service** (never a raw `From`); (7) log every attempt to `venue_sms_log`; (8) on success call `biz_waitlist_mark_notified`. A Twilio `21610` (blacklisted) persists a defensive global opt-out.

**LOCKED copy (verbatim, no link):** `Your table's ready at {VenueName}. Reply STOP to opt out.`

**Twilio Supabase secrets the orchestrator MUST set at deploy** (read from Deno env, NEVER hardcoded):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID` (the Messaging Service bound to the approved toll-free **+1 888-250-5351**)
- (optional, reused) `TWILIO_STATUS_CALLBACK_SECRET` — wires the existing `twilio-message-status` delivery callback.

**Consent / STOP:** the primary STOP path is Twilio's native Advanced Opt-Out on the Messaging Service (carrier-level; no inbound webhook required). The edge fn's pre-send `venue_sms_opt_out` check + the `21610` defensive persistence + the consent ledger together honor "never send to an opted-out number." (No new inbound-STOP webhook is added — Twilio's Messaging Service handles STOP natively; flagged for the tester.)

---

## 4. Gate results

| Gate | Result |
|------|--------|
| `deno test orch_1148_venue_suite_migration.test.ts` | **30 passed / 0 failed** (9 carried 2.0 + 6 carried 2.1a + 5 carried P3 + the new T-MIG-21..30; T-MIG-20 corrected — see §6). |
| `deno test send_venue_sms.test.ts` (T-SMS-1..8) | **8 passed / 0 failed**. |
| `reservationViews.test.ts` (jest, T-RES-1..9) | **9 passed**. |
| Full venue jest suite (`src/components/venue`) | **48 passed / 48** (9 suites — incl. the 2.0 `venueSuiteLeakAndExit.tester.adversarial` + `venueModules` + `venueShellScroll` + 2.1a `capacityRules` all still green). |
| `orch-1148-booking-core-engine-and-money-seam.mjs` `--self-test` + live | **PASS** — engine sole-source held (no venue component names the RPC; slots flow via the existing `useAvailableSlots` owner hook) + money seam clean (zero checkout/pricing/Stripe/Paystack in any new venue file). |
| I-39 a11y (`i39-pressable-label.mjs`) | **PASS** — 469 .tsx scanned, **0 violations** (every new Pressable carries an a11y label). |
| `tsc --noEmit` (mingla-business) | **334 → 334 (DELTA 0)** — pre-existing baseline confirmed via stash-and-rerun; **0 errors in any new file**. |
| `eslint` (all 13 changed business files) | **0 errors** (the 2 initial warnings — unused import + exhaustive-deps — fixed → clean). |
| **Live full-chain migration apply** (Docker `supabase/postgres:17.4.1.075`) | **PASS** — all 236 prior migrations + the 4 new 2.1b applied in version order on a seeded container; the 2.1b probe fired its PASS NOTICE. |
| **Live behavioral (real fixtures)** | create→seat→complete works; illegal `seated→requested` + terminal `completed→seated` REJECTED (`check_violation`); atomic convert (waitlist converted+linked AND reservation created, both = 1); non-member create REJECTED (`42501`). |
| **Live RLS brand-scoping** | a stranger reads **0** reservations + **0** waitlist rows for a brand they don't belong to; the owner reads their own. |
| **Live grant boundary** | post-fix ACLs = `{postgres, authenticated, service_role}` only (no PUBLIC, no anon); `has_function_privilege('anon', biz_reservation_transition…)` = **false**. |

---

## 5. Fails-on-revert proofs (cited @ commit `4854e590d` / final `7eeb41d6f`)

| Invariant | Test | Revert applied | Result |
|-----------|------|----------------|--------|
| Client lifecycle guard rejects illegal transitions | `reservationViews.test.ts` T-RES-1/2/3/5/6 | made `isTransitionLegal` `return true` | **T-RES-1/2/3/5/6 FAIL**, happy-path T-RES-4/7/8/9 stay PASS (the test discriminates); restore → 9 pass. |
| Server legal-transition matrix locks terminal states | `T-MIG-22` (deno) | changed the matrix `ELSE false` → `ELSE true` | **FAIL**; restore → pass. |
| SMS uses the exact LOCKED copy | `T-SMS-1` (deno) | replaced the copy with `Table ready: … https://…` | **FAIL**; restore → pass. |
| SMS honors the opt-out ledger | `T-SMS-3` (deno) | replaced the `brand_id===null \|\| brand_id===brandId` match with `false` | **FAIL**; restore → pass. |

All reverts restored with zero residual diff.

---

## 6. Decisions / ambiguities flagged

1. **Pre-existing stale test T-MIG-20 corrected.** At branch HEAD (before my work), `T-MIG-20` already FAILED — it asserted the 2.1a P3 probe (`…002`) was the "highest" prefix, but a later 2.1a follow-up (`20261008000003_orch_1148_revoke_anon_turn_helper.sql`) sits above it. Proven pre-existing via stash-and-rerun against HEAD. I corrected it to assert **ordering** (P3 probe > engine-v2 + tz-column) rather than strict-max, preserving the original intent. This is a 2.1a-owned test; flag for the tester / 2.1a owner.
2. **Supabase PUBLIC auto-grant (same class as the 2.1a anon gotcha).** The live full-chain apply caught that the new RPCs were PUBLIC/anon-callable despite `REVOKE … FROM anon`, because the image auto-grants EXECUTE to **PUBLIC** on every new function. Fixed by adding `REVOKE ALL … FROM PUBLIC` before each anon revoke (mirrors the 2.1a engine). The 2.1b probe asserts the transition fn is not anon/PUBLIC-callable; tester should confirm on the prod project's default-privilege config.
3. **STOP handled by Twilio's Messaging Service natively (no inbound webhook added).** The consent loop = native carrier-level STOP + the edge fn's pre-send opt-out check + the `21610` defensive persistence + the `venue_sms_opt_out` ledger. No new inbound-message webhook was added (out of scope; Twilio's Messaging Service Advanced Opt-Out is the primary path). Flagged for the tester.
4. **`approval_required` / the `requested→approve` consumer UI is NOT in 2.1b** (PRD §9 Q2 deferred); the matrix supports `requested` as a starting state for completeness, and the operator can confirm a `requested` row, but no consumer-facing request flow is built (that's 2.2).
5. **Reservation `reason` note** is recorded in `audit_log.after` (no new column) — the 2.0 `reservations` table carries no cancellation-reason column and the directive forbade non-essential schema; the audit trail is the system of record for cancellation reasons.
6. **`no_show` fee enforcement** records the policy decision only (per the LOCKED auto-forfeit decision, the actual Stripe capture is 2.2's seam — no money path touched here, enforced by the strict-grep gate B).

---

## 7. Hard-guard compliance

- **Money seam HELD:** zero reference to `ticket-checkout-create` / `allInPricingEngine` / Stripe / Paystack in any 2.1b file (gate B + the migration no-money test + grep verified). Manual bookings are FREE; no charge path touched.
- **Engine FROZEN:** `pg_venue_available_slots` / `pg_venue_turn_minutes_for_party` READ only (via the existing `useAvailableSlots` owner hook); no venue component names the RPC (gate A verified). The manual-create + convert pickers reuse the 2.1a engine for slot truth.
- **DO-NOT-TOUCH respected:** `git show --stat` confirms NONE of the 2.1a engine migrations, Tables/Availability modules, `VenueSettingsModule`/`useVenueReservationSettings`/`venueFeeGate`/`venueModules`/`VenueModulePillRow`/`venueShellScroll`/`venueSuiteStore`, `VenueListingContent`, the hub nav (`hub/_layout`/`HubSubNav`/`useHubTabs`), `ticket-checkout-create`/`allInPricingEngine`, `app-mobile/`, buyer-web, or `mingla-admin/` were touched. Only `VenueSuiteShell.tsx` (the permitted dispatch swap), the migration test, `config.toml`, and the add-only 2.0 types file are modified existing files.
- **Realtime (locked Q4):** brand-scoped `postgres_changes` on `reservations` + `venue_waitlist`, filtered by `brand_id` (NOT a PK → no ORCH-0931 silent-drop), `event:'*'`, cleanup on unmount.
- **Android opaque glass:** all cards/sheets use `GlassCard`/`Sheet` (opaque Android fallback automatic). No bespoke translucent fills.
- **Tokens only · currency-aware:** spacing/radius/typography/text/accent/semantic; no money rendered in 2.1b (free bookings) → no GBP-fallback risk.
- **a11y / no dead taps:** every Pressable carries `accessibilityRole` + `accessibilityLabel` (I-39 = 0). Read-only (below-manager) states render explicit notes, not disabled mysteries. Destructive actions (no-show/cancel) require a reach + a second confirming tap.
- **`_hasHydrated`:** N/A — 2.1b adds no persisted Zustand store; all server data lives in React Query.
- **No native deps / runtime bump:** zero new `expo-*`/native modules; OTA-safe.
- **`[TRANSITIONAL]` exit conditions:** the 4 DRAFT invariants carry their flip-ACTIVE-on-CLOSE condition (the probe + tests are the anchors).

---

## 8. Pre-staged DRAFT invariants (flip ACTIVE on CLOSE)

- `I-PROPOSED-1148-RESERVATION-LIFECYCLE-TRANSITIONS-GUARDED-SERVER-SIDE` — illegal transitions rejected in the DB (the matrix + `biz_reservation_transition`), not just hidden in the client. Anchor: T-MIG-22/23 + T-RES-1/2/3 + the live behavioral proof + the 2.1b probe.
- `I-PROPOSED-1148-WAITLIST-CONVERT-ATOMIC` — convert creates the reservation AND marks the waitlist converted+linked in one txn. Anchor: T-MIG-25 + the live atomic proof + the probe.
- `I-PROPOSED-1148-SMS-FROM-APPROVED-TOLLFREE-ONLY` — `send-venue-sms` sends ONLY via `TWILIO_MESSAGING_SERVICE_SID` (the approved toll-free), never a raw `From`. Anchor: T-SMS-2.
- `I-PROPOSED-1148-SMS-OPT-OUT-HONORED` — never send to a phone with a matching opt-out row; the consent ledger exists + is RLS-protected. Anchor: T-SMS-3 + T-MIG-27 + the probe.

---

## 9. Downstream

NEXT = **mingla-tester** (business iOS + Android + web-desktop + web-phone device/sim proof of the Reservations + Waitlist modules + manual create + lifecycle actions + realtime + the SMS notify path on a Twilio test number; confirm the money seam + the engine-frozen contract held). Then **mingla-orchestrator CLOSE** — apply the 4 migrations via Management API from MERGED main, run `get_advisors`, set the Twilio secrets, deploy `send-venue-sms`, flip the 4 DRAFT invariants ACTIVE, register 2.1b on the World Map. Then **2.2** (consumer/web booking surface + the engine's `anon` GRANT seam).

*No deploy / no migration applied to prod / no edge-fn deploy / no merge performed by this implementor.*
