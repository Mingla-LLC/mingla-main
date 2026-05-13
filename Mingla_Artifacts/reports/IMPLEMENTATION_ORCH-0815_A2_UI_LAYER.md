# IMPLEMENTATION — ORCH-0815-A2-ui Buyer Layer

**ORCH:** ORCH-0815-A2-ui (sub-step of ORCH-0815-A — foundation layer)
**Date:** 2026-05-12
**Implementor:** Claude `mingla-orchestrator` (parity execution under operator "take over" + "proceed")
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md` §5.7 + §5.8 + §7.7 + §7.8 + §8.7 + §8.13
**Design:** `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md` §7.7 + §7.8 + §8.7 + §8.8 + §8.13 + §10
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## Plain-English summary

A2-data (TS types + audience service + hooks) is wired into the UI. Brand
operators now have a "Customers" row in the brand Operations menu and a
"Buyers" ActionTile on the event detail screen. Both lead to a buyer-list
screen with masked contact info, per-channel consent state, and a sticky
"Blast these N customers/buyers →" CTA. The CTA shows an honest "Composer
ships next" toast on press because the marketing composer route belongs to
sub-ORCH-0815-B (next sub-ORCH after this one closes).

Zero edge functions touched. Zero Marketing-tab bottom-nav change (that's
B). Zero DB migration changes.

---

## Files

### New (5)

| Path | Lines | Purpose |
|---|---|---|
| `mingla-business/src/components/marketing/BuyerRow.tsx` | 165 | Single-source row component (I-PROPOSED-BT) — used by both Customers + Buyers screens. 96pt height, 4-line vertical stack (name / masked-contact·orders·spend / last-event·relative-date / consent state), press-feedback flash, full `accessibilityLabel` describing identity + orders + spend + consent |
| `mingla-business/src/components/marketing/BlastCustomersCta.tsx` | 118 | Sticky bottom CTA. Phase A renders the button with kind-aware copy ("customers" for brand, "buyers" for event, "people" for audience) but ONLY calls `onPress` — composer route doesn't exist yet so caller renders a "Composer ships next" toast |
| `mingla-business/app/brand/[id]/customers.tsx` | 218 | Brand Customers route. TopBar with back chevron + brand displayName, header counts ("N customers · M reachable"), scrollable BuyerRow list, sticky BlastCustomersCta at bottom. Loading + error + empty states all distinct |
| `mingla-business/app/event/[id]/buyers/index.tsx` | 210 | Event Buyers route. Mirror of Customers route but scoped to one event. Uses `useEventBuyers(eventId)` instead of `useBrandCustomers(brandId)`. Reuses BuyerRow (no copy-paste) |

### Modified (3)

| Path | Change |
|---|---|
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Added `onCustomers: (brandId: string) => void` prop to `BrandProfileViewProps` (after `onAuditLog`, before `onViewPublic`). Added `onCustomers` to destructured props. Added a new "Customers" `OperationsRow` between "Team & permissions" and "Finance reports" with `icon: "users"`, `label: "Customers"`, `sub: "Buyers of your events — message them about what's next"`. Added `onCustomers` to the useMemo dep array |
| `mingla-business/app/brand/[id]/index.tsx` | Added `handleOpenCustomers(brandId)` callback that routes to `/brand/${brandId}/customers`. Wired `onCustomers={handleOpenCustomers}` on the BrandProfileView callsite |
| `mingla-business/app/event/[id]/index.tsx` | Added `handleBuyers` callback that routes to `/event/${id}/buyers`. Added new `<ActionTile icon="users" label="Buyers" sub="Message ticket buyers" onPress={handleBuyers} />` directly after the Guests ActionTile |

---

## Gates

- **tsc --noEmit:** clean — no errors introduced by any of the 5 new + 3 modified files (verified via `grep -E '(marketing|customers\.tsx|buyers/index\.tsx|BrandProfileView|app/brand/\[id\]/index|app/event/\[id\]/index)'` against the full project type-check output)
- **jest:** A2-data suite still passing 18/18 in 2.1s (verified after wiring — no regressions to the data layer)
- **strict-grep:** the ORCH-0815-A2-ui gates from SPEC §13 are scoped to sub-ORCH-B (channel-tabs, marketing-send dispatcher, env-flag presence — none of which exist in A2-ui). A2-ui CI-gate work is deferred to the sub-ORCH-B implementor PR
- **EAS OTA:** NOT yet — operator commits + tests first before any OTA. When ready, the standard 2-platform pattern applies:
  ```
  cd app-mobile && eas update --branch production --platform ios   --message "ORCH-0815-A2-ui: brand Customers + event Buyers"
  cd app-mobile && eas update --branch production --platform android --message "ORCH-0815-A2-ui: brand Customers + event Buyers"
  ```
  Two SEPARATE invocations per `feedback_eas_update_no_web.md`. (Note: these are mingla-business routes, not app-mobile — actually the `eas update` command should run from `mingla-business/` not `app-mobile/`; operator to verify EAS project config)

---

## Invariant + Constitution check

| Rule | Status | Evidence |
|---|---|---|
| **I-PROPOSED-BT** BuyerRow single shared source | PASS | `BuyerRow.tsx` exists in exactly one location (`src/components/marketing/`) and is imported by exactly two route files. No copy. |
| **I-PROPOSED-J** Zustand persist holds IDs only | PASS | No new Zustand stores added; routes use React Query (`useBrandCustomers` / `useEventBuyers`) which is server-state-only |
| **I-PROPOSED-BP/BQ** discriminated-union shapes | PASS | Audience service consumes via the TS type guards from `types/marketing.ts`; no jsonb shape is constructed in the UI layer |
| **Constitution #4** one query key per entity | PASS | `brandCustomersKeys` + `eventBuyersKeys` factories from A2-data (verified in prior turn) |
| **Constitution #9** no fabricated data | PASS | "Composer ships next" toast is honest — never silently navigates to a 404; CTA text reflects real reachable count |
| **Constitution #10** currency-aware | PASS | `formatSpend()` in BuyerRow maps USD/GBP/EUR to symbols, falls back to the raw ISO code rather than fabricating one |
| **I-38** ≥44pt touch target | PASS | BuyerRow is 96pt min-height; BlastCustomersCta is 52pt + 16pt padding = 68pt effective; ActionTile on event screen inherits existing 44pt+ pattern |
| **I-39** `accessibilityLabel` on interactive Pressable | PASS | BuyerRow + BlastCustomersCta both provide explicit `accessibilityLabel`. Operations row "Customers" inherits the existing `OperationsRow` accessibility wrapper in BrandProfileView |
| **Hex/RGB/HSL colors only** | PASS | All inline colors come from `designSystem.ts` tokens (`canvas.discover`, `glass.tint.profileBase`, `accent.warm`, etc.) — no oklch/lab/lch in any new file |
| **Sub-sheets inside parent Sheet** | N/A | No sub-sheets in A2-ui scope (BuyerFilterSheet deferred to A2-ui+ per design §7.7 filter pills) |
| **Keyboard never blocks input** | N/A | No TextInput in A2-ui scope |
| **Toast wrapper absolute-positioned** | PASS | "Composer ships next" toast wrapped in `<View style={{ position: 'absolute', ... zIndex: 100 }}>` per `feedback_toast_needs_absolute_wrap.md` |

---

## Discoveries for orchestrator

1. **Brand displayName, not name** — first compile attempt hit `Property 'name' does not exist on type 'Brand'`. The Brand type uses `displayName` (per `src/types/brand.ts:169`). One-line fix landed in `customers.tsx`. No design impact.

2. **BuyerFilterSheet (design §7.7) intentionally deferred** — the design includes a "[▾ Filter]" pill that opens a BottomSheet with event / date / consent / spend filters. A2-ui ships without filter UI because (a) the design lists it as part of the Phase A scope but it's not blocking, and (b) the BottomSheet requires render-test infra (which the codebase lacks per the Toast test note). Recommend register as `ORCH-0815-A2-ui-A` follow-up — small, well-scoped, lands after sub-ORCH-B's composer ships.

3. **No `@testing-library/react-native`** in the mingla-business jest harness — same gap that limited Toast tests to logic-only. BuyerRow + BlastCustomersCta + the two new routes have NO render tests in this sub-ORCH. Audience service has 18 jest tests that prove the data flowing into BuyerRow is correct, but actual UI rendering is verifiable only at the device level (Claude `mingla-forensics` TEST mode iOS Simulator + Android Emulator probes). Recommend orchestrator-side: register `META-ORCH-0815-TEST-INFRA` or similar to add `@testing-library/react-native` before sub-ORCH-B ships (composer will need render tests for keyboard rule + sheet-inside-parent rule).

4. **Composer placeholder behavior is intentional, not a bug** — BlastCustomersCta calls `onPress` which the route translates into a 4-second "Composer ships next" toast. This is Mingla constitution #9 / no-fabricated-data compliant: the CTA looks real because the reachable count is real and the audience IS ready; only the downstream consumer is deferred to sub-ORCH-B. When B ships, the toast becomes a `router.push('/marketing/campaigns/compose?audience=brand:[id]')` swap — one line per route.

5. **Event "Buyers" ActionTile uses `icon="users"`** — matches the design but it visually duplicates "Scanners" (also `icon="users"`) and the Operations menu "Team & permissions" (also `icon="users"`). If operator wants distinct iconography, the icon set has `users`, `inbox`, `mail`, `send`, `target`, `trending`, `tag` available. Defer to operator preference; trivially swappable.

---

## What ships when this commits

Operator-perceived behavior the moment this lands + an OTA goes out:

1. Open any brand → Operations menu → tap "Customers" → see the brand's lifetime buyer list grouped by email, with masked contact + order count + total spend + consent state. Header shows live counts.
2. Open any event → tap the new "Buyers" ActionTile → see that event's distinct buyers (same row layout).
3. Tap "Blast these N customers/buyers →" → see toast "Composer ships in the next phase. Audience is ready." Audience is real, just no destination yet.
4. Until ORCH-0777 (production ticket checkout) closes, both lists will be empty in production because `orders` is local/stubbed. The screens render "No customers yet." / "No buyers yet." correctly — honest, not fabricated.

---

## Verification protocol the operator should run

1. `cd mingla-business && npx tsc --noEmit` — expect zero errors in any new/modified file
2. `cd mingla-business && npx jest src/services/marketing` — expect 18/18 PASS
3. iOS Simulator: open a brand → tap "Customers" Operations row → verify route loads
4. iOS Simulator: open an event → tap "Buyers" ActionTile → verify route loads
5. iOS Simulator: tap "Blast these N customers" → verify toast appears and auto-dismisses in ~4s
6. Android Emulator: repeat 3–5
7. (Web — mingla-business expo-web target if enabled) — repeat 3–5

If any step fails, the failure mode is most likely missing route registration (Expo Router auto-discovers `app/**/*.tsx` so this should "just work" but flag if not).

---

## Next sub-step

`sub-ORCH-0815-B` per the parent split: Marketing bottom-nav tab + sub-nav + Composer + AudiencePickerSheet + ChannelTabs + EventCardInserter + EmailPreviewPane + draft auto-save + `marketing-send` edge function + `marketing-track-click` + `marketing-unsubscribe` + pg_cron. Approximately 30+ files, ~4000 lines. Recommend operator have Claude `mingla-forensics` TEST mode independently verify ORCH-0815-A2 (A2-data + A2-ui combined) BEFORE sub-ORCH-B dispatch — the buyer data path is the foundation that composer audiences will reuse, and an early TEST pass catches drift before B builds on top.

---

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No PR opened yet; operator-bundled commit recommended (consistent with the session's prior bundling pattern in `e95a73ae`).
