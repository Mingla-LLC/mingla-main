# IMPLEMENTATION — META-ORCH-1161 Sub-A slice "a" — Consumer notification-preferences matrix

**ORCH:** META-ORCH-1161 Sub-A, slice "a" (the final consumer prefs-matrix UI)
**Phase:** IMPLEMENT (single bounded pass; self-verified; no deploy/merge)
**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-20
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[prefs-matrix]/` on branch `ORCH-1161-prefs-matrix`
**Commit:** `84663fe95fa5eae87edfb77808f6871f2553bcf7`
**Status:** implemented and verified (logic + type + lint + happy-path test + fails-on-revert). UNVERIFIED on device — Seth eyeballs at QA (consumer-facing UI).
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md` §5.1/§5.2/§5.3/§10 surface 1
**Design:** `Mingla_Artifacts/design/ORCH-1161/DESIGN_META-ORCH-1161_SUBA_CONSENT_AND_PREFS_UX.md` (S1 only)

---

## 1. Summary (plain English)

In the consumer app, Settings → Notifications used to show 5 flat on/off toggles. It now shows a
proper grid: every notification type (grouped under Purchases, Reservations, Reminders, Marketing,
Social) with a small on/off chip per delivery channel (in-app, push, email, text). The text/SMS chip
only appears for the types that are actually allowed to send a text. Receipts and the in-app inbox are
locked on (legal/system-of-record). Tapping a chip saves instantly; if the save fails it flips back and
shows a "couldn't save — tap to retry" bar. The master Push toggle still sits on top and dims the push
chips when off. The whole grid is built from the live category list in the database — nothing about
which types or channels exist is hardcoded.

Scope was S1 ONLY. The consent gates (S2 onboarding, S3 buyer checkout) in the design are explicitly
NOT in this slice.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `84663fe9`) |
|----|-----------|--------|------------------------------|
| SC-1 | Per-category × per-channel matrix grouped by section, in consumer order | ✓ | `buildNotificationMatrix` + `CONSUMER_SECTION_ORDER`; rendered in AccountSettings notif AccordionCard |
| SC-2 | Channels shown = the category's `default_channels` (SMS only for sms-eligible) | ✓ | core `supported` filter + `categorySupportsSms`; test "SMS chip renders ONLY for sms-eligible categories" |
| SC-3 | Transactional ON by default; user may turn off a (cat,channel) → writes enabled=false | ✓ | `defaultChannelEnabled` + `buildChannelPrefUpsert`; tests "toggle OFF/ON writes correct upsert" |
| SC-4 | Marketing OFF by default; toggle on → enabled=true | ✓ | core marketing default; test "marketing channels default OFF until enabled=true" |
| SC-5 | Legally/UX-locked channels (inapp always; transactional email) locked-on, write no row | ✓ | `isChannelLocked`; test "locked chip NEVER writes a pref row" |
| SC-6 | Reads `notification_categories` (active) + user `notification_channel_prefs`; absent row = default | ✓ | `fetchNotificationMatrix`; coalesce in core; test "effective state = coalesce(...)" |
| SC-7 | Writes upsert to `notification_channel_prefs` PK(user,cat,channel) on toggle | ✓ | `upsertChannelPref` onConflict `user_id,category_key,channel` |
| SC-8 | Hook + service; React Query keyed by factory; optimistic + error toast (no silent fail) | ✓ | `useNotificationPrefs` + `notificationPrefsKeys` + onMutate/onError rollback + error bar |
| SC-9 | States: loading skeleton / empty (never blank) / saving (optimistic) / error (bar + revert) | ✓ | AccountSettings: `prefSkeleton*`, optimistic flip, `prefSaveErrorBar` |
| SC-10 | Keep master `push_enabled` (and `email_enabled`-style) global gate above the matrix | ✓ | master row + `updateNotifPref('push_enabled',…)` untouched; push chips dim when master off |
| SC-11 | Shared RN → Android parity automatic; no glass introduced | ✓ | opaque chip fills only; `ANDROID_GLASS_USES_OPAQUE_FALLBACK` not triggered |

## 3. Files changed (10; +1011 / −61)

| File | Δ | What |
|------|---|------|
| `app-mobile/src/components/profile/notificationPrefsMatrix.ts` | NEW +237 | pure decision core (matrix build, coalesce/lock/default, upsert payload, sms-eligibility) |
| `app-mobile/src/services/notificationPrefsService.ts` | NEW +94 | `fetchNotificationMatrix` + `upsertChannelPref` (throws on error) |
| `app-mobile/src/hooks/useNotificationPrefs.ts` | NEW +146 | React Query hook; optimistic toggle + rollback + onError |
| `app-mobile/src/components/profile/AccountSettings.tsx` | +318/−61 | matrix UI replaces flat sub-toggles; master push kept; states; chips |
| `app-mobile/src/hooks/queryKeys.ts` | +9 | `notificationPrefsKeys` factory |
| `app-mobile/src/components/ui/Icon.tsx` | +2 | `'phone-portrait'`→Smartphone push glyph |
| `app-mobile/src/i18n/locales/en/settings.json` | +58 | section/channel/category labels + a11y/copy keys |
| `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.test.ts` | NEW +172 | happy-path regression (7 tests) |
| `app-mobile/scripts/ci/orch-1161-notif-prefs-matrix-check.mjs` | NEW +35 | CI wrapper |
| `app-mobile/package.json` | +1 | `test:orch-1161` script |

## 4. Data-model changes applied

NONE. Tables (`notification_categories`, `notification_channel_prefs`) + `can_send()` already live on
origin/main (foundation merged). RLS on `notification_channel_prefs` verified owner-only
(`user_id = auth.uid()` for USING and WITH CHECK), so the client upsert is safe. No migration written.

## 5. Edge functions touched

NONE.

## 6. Regression tests added

- Path: `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.test.ts` (7 tests, Node built-in runner).
- Runner: `npm run test:orch-1161` → `scripts/ci/orch-1161-notif-prefs-matrix-check.mjs`. Result: 7/7 PASS.
- **fails-on-revert verified at `84663fe95fa5eae87edfb77808f6871f2553bcf7`**: deleted (true line deletion,
  not comment-out) the `default_channels` gate in `buildNotificationMatrix` (replaced `supported` with
  ALL channels) → test "SMS chip renders ONLY for sms-eligible categories" FAILED (1 fail / 6 pass).
  Restored the gate → 7/7 PASS again.
- Test is visible in `git diff origin/main...HEAD --name-only`. Append-only respected (no existing test modified).

## 7. Old → New receipt

### app-mobile/src/components/profile/AccountSettings.tsx
**Before:** Notifications accordion = master `push_enabled` toggle + 5 flat full-Toggle rows
(friend_requests, link_requests, messages, collaboration_invites, marketing) written to the legacy
`notification_preferences` table via local-state `updateNotifPref`. No channel granularity, no SMS, no
transactional/reservation/reminder categories.
**Now:** master `push_enabled` toggle kept (still local-state, still the global gate); the 5 flat rows
REMOVED and replaced by a data-driven matrix — section headers + one row per live `notification_categories`
row + compact 28×28 channel chips for each supported channel. Loading skeleton, optimistic toggle, save-error
bar, and push-chips-dimmed-when-master-off all handled. Reads/writes `notification_channel_prefs` via the new
React Query hook.
**Why:** SC-1..SC-11 (granular per-channel control; the legacy flat booleans stay only for the master push/email + legacy category mapping per §5.7).
**Lines:** ~+318/−61.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS | YES | the matrix screen; primary target |
| Consumer Android | YES | shared RN → automatic parity; opaque chip fills (no glass delta) |
| Buyer/anon Web | NO | this is the consumer app Settings sheet only |
| Business iOS | NO | business prefs out of scope |
| Business Android | NO | " |
| Admin Web | NO | n/a |
| Business Web preview | NO | n/a |

Parity consumer iOS↔Android is automatic (one RN codebase). No manual parity owed.

## 9. Smoke result

- `npm run test:orch-1161` → 7/7 PASS (logic core).
- `npx tsc --noEmit` → ZERO new type errors in all 6 source files I touched (the only error in my files is
  the intentional `.ts` runtime-import on the test, suppressed with `@ts-expect-error` exactly per the
  `useLaunchCityGate.test.ts` precedent). Repo baseline (~641 pre-existing errors) unchanged.
- `npx eslint` on the 4 new TS files → clean.
- CI gates that scan AccountSettings (ORCH-0749, meta-orch-1002-sub-b, clip-adv): same failures with my
  changes STASHED as with them applied → all failures are pre-existing baseline in unrelated files
  (`IncomingPairRequestCard.tsx`, `PairingInfoCard.tsx`, a persistence-predicate check); NOT introduced here.
- NOT run: on-device render. UNVERIFIED — Seth eyeballs at QA per dispatch.

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- The legacy flat keys in `settings.json` (`friends_pairing`, `link_requests`, etc.) are now unused by the
  matrix but left in place (harmless; legacy `updateNotifPref` master path may still reference push copy).
- Live seed reality differs from the design's §S1.3 table (see Discoveries) — the UI is correct because it
  reads live, but the design's hardcoded category list/lock-rule table is stale.

## 11. Operator action required

- NONE for DB/edge (no migration, no edge fn).
- Route to orchestrator → REVIEW → tester (adversarial test) → CLOSE.
- At CLOSE, orchestrator flips the relevant `I-PROPOSED-1161-*` invariants ACTIVE (the SMS-eligibility one is
  now also enforced in the consumer UI).

## 12. Discoveries for Orchestrator

1. **Live seed ≠ design/spec category table (no blocker — UI reads live, by design).** The DB today has:
   Purchases {buyer_order_cancelled, buyer_purchase_confirmation, buyer_refund_issued, waitlist_spot_open};
   Reservations {buyer_reservation_cancelled, buyer_reservation_changed, buyer_reservation_confirmed};
   Reminders {buyer_event_reminder, buyer_reservation_reminder} (ALREADY collapsed to 2 rows — OQ-1 is
   resolved in data, no `_24h`/`_2h` split exists); Marketing {marketing ({inapp,push,email}),
   marketing_blast ({email,sms})}; Social {collaboration_invites, friend_requests, messages, reminders}
   (all {inapp,push}, is_transactional=true). The design's `buyer_payment_failed`, `waitlist_table_ready`,
   and `social_*` keys are NOT in the live seed. Because the matrix is fully data-driven, the UI is correct
   regardless — but flag for the orchestrator that the design's S1.3 table is stale vs the shipped seed.
2. **OQ for Seth — marketing chips default state.** At the prefs layer, marketing channels default OFF
   (mirrors §5.3 can_send: marketing off-by-default unless an enabled=true pref row exists). The design
   §S1.3 says "Marketing — default ON because DEC-186 auto-enrolls." Those reconcile via consent capture
   (S2/S3 write the marketing GRANT), which is OUT of this slice. If Seth wants the marketing chips to
   render ON by default to visually reflect the auto-enroll, that's a one-line flip in
   `defaultChannelEnabled` — left OFF for now to match the can_send source of truth. Flagged.
3. **Category display labels** were added to `en/settings.json` keyed by `category_key` with a humanized
   fallback in-component for any unkeyed category. These are descriptive UI labels for REAL seeded
   categories (not fabricated categories). mingla-product owns final verbatim copy per the design's
   `{COPY:*}` contract — current strings are sensible placeholders, easy to swap.
4. **Comms ledger:** read on entry. No BLOCK addressed to this skill/ORCH/ALL. Closest WARN is COMMS-0035
   (ORCH-1119 ExpoImageManipulator native drift) — notification domain but unrelated to prefs; no action.
   COMMS-0038/0040 (RSVP/event public-page standardization, ALL) do not touch AccountSettings or the
   notification tables — no conflict.
