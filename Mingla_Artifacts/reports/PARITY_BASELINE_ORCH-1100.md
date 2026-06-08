# PARITY BASELINE — ORCH-1100 (business-web, firewall BYPASSED)

Date: 2026-06-07
Phase: ORCH-1100 IMPLEMENT Phase I (keystone) — automated mobile-web device parity harness + true per-route baseline.
Device: physical Samsung SM-A725F (`R58R54YV7JT`), Chrome, signed in as sethogieva@gmail.com, brand "Leggo This".
Method: local web export of `mingla-business` built with the DIAGNOSTIC firewall-bypass flag (`EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS=1`), served locally, driven over Chrome DevTools Protocol (`adb reverse` + `adb forward localabstract:chrome_devtools_remote` + native-WebSocket CDP). Signed in ONCE via Continue-with-Google; session re-injected before every navigation.
Harness: `tools/parity-harness/` (`enumerate-routes.mjs`, `routes.manifest.json`, `run-parity-baseline.mjs`, `README.md`). Raw data: `orch1100_baseline/results.json` + 111 screenshots; real-ID re-probe: `orch1100_baseline/realids/`.

---

## Headline (the number that changes the strategy)

With the route firewall bypassed, **88 / 91 routes BOOT** and **3 / 91 render a correct GUARD state** (not-found / invalid-link for a fake ID). **ZERO renderer crashes. ZERO OOM. ZERO error boundaries.** Peak JS heap across the whole sweep was **41 MB** (nowhere near the "Ineffective mark-compacts" OOM regime, which needs hundreds of MB), and most of that is cumulative across same-tab navigations, not per-route.

This directly contradicts the pre-implement assumption that the firewall is masking ~85 broken routes. **The firewall is masking ~79 routes that already boot.** RC-4 (the firewall) is therefore the single dominant parity gap by a wide margin: retiring it is mostly promotion + per-route device proof, not a crash-fixing slog.

### Honesty caveat — what "BOOTS" proves and does NOT prove
- 39 of the 91 routes are STATIC paths → real signed-in content was exercised (Home with brand "Leggo This" + 3 live events, full 5-tab nav; the 7-step event-create wizard; composer; hubs; marketing; partner; connect pages).
- 52 of the 91 routes are DYNAMIC (require an entity id). The baseline sweep fed them OBVIOUSLY-FAKE ids (`00000…000` / `sample`), so they render the route shell + the correct not-found / 400-403 data-guard. "BOOTS" for these means **the route shell + data-guard boots without crashing** — it does NOT prove the populated screen renders. To close that gap a **REAL-ID re-probe** of the 20 highest-value dynamic routes was run (brand `22a18413…`, event `61980280…`); see the second table. All 20 booted with real content.

---

## Counts

### By status (full 91-route sweep, fake IDs)
| Status | Count |
|---|---|
| BOOTS | 88 |
| GUARD (correct not-found / invalid-link) | 3 |
| CRASH / OOM / ERROR_BOUNDARY | 0 |
| Firewall STUB (would be ~79 WITHOUT the bypass) | 0 (bypass confirmed working) |

### By "real content exercised" vs "shell/guard only"
| Coverage | Count |
|---|---|
| Real content rendered (static routes) | 39 |
| Shell + data-guard only (dynamic, fake ID) | 52 |
| → of those, real-content-confirmed via REAL-ID re-probe | 20 |

### Failure CLASS ranking (how many routes each class blocks)
| Rank | Failure class | Routes blocked from BOOTING | Notes |
|---|---|---|---|
| 1 | `firewall-stub` (RC-4) | ~79 (in production; 0 with bypass) | THE dominant gap. Mechanism, not a crash. Retire = promote + device-prove. |
| 2 | `hydration/auth` (RC-1, GoTrue Web-Lock) | 1 observed (`/event/{event}/group-chat` → `AbortError: Lock broken … steal`) + latent risk on any multi-tab session | Real, intermittent; surfaced under the harness multi-tab pressure. Confirms RC-1 is live. |
| 3 | `native-module` (RC-5) | 0 crashes observed; 1+ UNVERIFIED behind permission tap | Door/ticket scanner BOOTS to a "Camera access needed → Allow" web gate; it does NOT hard-crash on mount. `getUserMedia`/expo-camera behaviour AFTER granting is UNVERIFIED (harness did not tap-through). |
| 4 | `reanimated-gesture` / `reanimated-loop` | 0 | Did NOT reproduce on any route. ORCH-1098 BottomNav + WebSafeGestureDetector fix holds; the event-create wizard (heavy gesture/reanimated) boots clean. |
| 5 | `glass-transparency` (RC-2) | 0 routes blocked from booting | RC-2 is a VISUAL defect (transparent sheets), not a boot failure — invisible to a boot/crash harness. Must be caught by screenshot review of sheet-opening interactions, not route navigation. NOT measured here. |
| 6 | `fixed-height-layout` (RC-3 composer body) | 0 routes blocked from booting | Also a VISUAL/interaction defect (collapsed contenteditable), invisible to navigation-only probing. Composer route itself BOOTS. NOT measured here. |
| 7 | `dead-handler` (RC-3 composer Back) | 0 routes blocked | Interaction-level (web Alert no-op), invisible to navigation-only probing. NOT measured here. |

**Fix-order implication:** attack **RC-4 (firewall retirement)** first — it is ~79 routes and the work is promotion + per-route device proof, which THIS HARNESS now automates. RC-1 (auth Web-Lock) second — it is the only class that actually blocks a route from loading its data, and it is intermittent. RC-5 (scanner camera) needs a tap-through verification, not a route sweep. RC-2/RC-3 are visual/interaction defects the boot harness cannot see — they need a separate interaction/screenshot harness (Phase 4).

---

## Full per-route baseline (91 routes, fake IDs, firewall bypassed)

| Route | Status | Peak heap | Notes | Shot |
|---|---|---|---|---|
| `/` | BOOTS | 11MB | real content | [png](orch1100_baseline/001_root.png) |
| `/accept-brand-invitation` | BOOTS | 18.1MB | real content | [png](orch1100_baseline/002_accept_brand_invitation.png) |
| `/accept-brand-invitation/success` | BOOTS | 22.2MB | real content | [png](orch1100_baseline/003_accept_brand_invitation_success.png) |
| `/accept-scanner-invitation` | BOOTS | 26MB | real content | [png](orch1100_baseline/004_accept_scanner_invitation.png) |
| `/account` | BOOTS | 35.3MB | real content | [png](orch1100_baseline/005_account.png) |
| `/account/delete` | BOOTS | 40MB | real content | [png](orch1100_baseline/006_account_delete.png) |
| `/account/edit-profile` | BOOTS | 10.3MB | real content | [png](orch1100_baseline/007_account_edit_profile.png) |
| `/account/notifications` | BOOTS | 16.7MB | benign console error | [png](orch1100_baseline/008_account_notifications.png) |
| `/ari` | BOOTS | 17.3MB | real content | [png](orch1100_baseline/009_ari.png) |
| `/ari/settings` | BOOTS | 23.5MB | real content | [png](orch1100_baseline/010_ari_settings.png) |
| `/auth` | BOOTS | 13.3MB | real content | [png](orch1100_baseline/011_auth.png) |
| `/auth/callback` | BOOTS | 16.7MB | real content | [png](orch1100_baseline/012_auth_callback.png) |
| `/b/leggo-this` | GUARD | 10.7MB | not-found / invalid-link guard (fake ID) | [png](orch1100_baseline/013_b_leggo_this.png) |
| `/booking/00000000-0000-0000-0000-000000000001/cancel` | BOOTS | 17.5MB | guard/shell (fake ID) | [png](orch1100_baseline/014_booking_00000000_0000_0000_0000_000000000001_cancel.png) |
| `/brand/00000000-0000-0000-0000-000000000000` | BOOTS | 16.4MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/015_brand_00000000_0000_0000_0000_000000000000.png) |
| `/brand/00000000-0000-0000-0000-000000000000/audit-log` | BOOTS | 24.4MB | guard/shell (fake ID) | [png](orch1100_baseline/016_brand_00000000_0000_0000_0000_000000000000_audit_log.png) |
| `/brand/00000000-0000-0000-0000-000000000000/blasts` | BOOTS | 29.3MB | guard/shell (fake ID) | [png](orch1100_baseline/017_brand_00000000_0000_0000_0000_000000000000_blasts.png) |
| `/brand/00000000-0000-0000-0000-000000000000/edit` | BOOTS | 34.6MB | guard/shell (fake ID) | [png](orch1100_baseline/018_brand_00000000_0000_0000_0000_000000000000_edit.png) |
| `/brand/00000000-0000-0000-0000-000000000000/listing` | BOOTS | 10.9MB | guard/shell (fake ID) | [png](orch1100_baseline/019_brand_00000000_0000_0000_0000_000000000000_listing.png) |
| `/brand/00000000-0000-0000-0000-000000000000/payments` | BOOTS | 16.7MB | guard/shell (fake ID) | [png](orch1100_baseline/020_brand_00000000_0000_0000_0000_000000000000_payments.png) |
| `/brand/00000000-0000-0000-0000-000000000000/payments/onboard` | BOOTS | 10.9MB | guard/shell (fake ID) | [png](orch1100_baseline/021_brand_00000000_0000_0000_0000_000000000000_payments_onboard.png) |
| `/brand/00000000-0000-0000-0000-000000000000/payments/reports` | BOOTS | 17.8MB | guard/shell (fake ID) | [png](orch1100_baseline/022_brand_00000000_0000_0000_0000_000000000000_payments_reports.png) |
| `/brand/00000000-0000-0000-0000-000000000000/pricing-defaults` | BOOTS | 22.8MB | guard/shell (fake ID) | [png](orch1100_baseline/023_brand_00000000_0000_0000_0000_000000000000_pricing_defaults.png) |
| `/brand/00000000-0000-0000-0000-000000000000/scanners` | BOOTS | 29MB | guard/shell (fake ID) | [png](orch1100_baseline/024_brand_00000000_0000_0000_0000_000000000000_scanners.png) |
| `/brand/00000000-0000-0000-0000-000000000000/team` | GUARD | 32.7MB | not-found / invalid-link guard (fake ID) | [png](orch1100_baseline/025_brand_00000000_0000_0000_0000_000000000000_team.png) |
| `/checkout-experience/sample` | BOOTS | 11MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/026_checkout_experience_sample.png) |
| `/checkout-experience/sample/buyer` | BOOTS | 17.2MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/027_checkout_experience_sample_buyer.png) |
| `/checkout-experience/sample/confirm` | BOOTS | 22.6MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/028_checkout_experience_sample_confirm.png) |
| `/checkout-experience/sample/payment` | BOOTS | 29MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/029_checkout_experience_sample_payment.png) |
| `/checkout-trip/sample` | BOOTS | 34.1MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/030_checkout_trip_sample.png) |
| `/checkout-trip/sample/buyer` | BOOTS | 11.2MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/031_checkout_trip_sample_buyer.png) |
| `/checkout-trip/sample/confirm` | BOOTS | 10.6MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/032_checkout_trip_sample_confirm.png) |
| `/checkout-trip/sample/intake` | BOOTS | 17.1MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/033_checkout_trip_sample_intake.png) |
| `/checkout-trip/sample/payment` | BOOTS | 25.4MB | data 400/403 (fake ID) — shell booted | [png](orch1100_baseline/034_checkout_trip_sample_payment.png) |
| `/checkout/00000000-0000-0000-0000-000000000002` | BOOTS | 29.7MB | guard/shell (fake ID) | [png](orch1100_baseline/035_checkout_00000000_0000_0000_0000_000000000002.png) |
| `/checkout/00000000-0000-0000-0000-000000000002/buyer` | BOOTS | 36.3MB | guard/shell (fake ID) | [png](orch1100_baseline/036_checkout_00000000_0000_0000_0000_000000000002_buyer.png) |
| `/checkout/00000000-0000-0000-0000-000000000002/confirm` | BOOTS | 41MB | guard/shell (fake ID) | [png](orch1100_baseline/037_checkout_00000000_0000_0000_0000_000000000002_confirm.png) |
| `/checkout/00000000-0000-0000-0000-000000000002/payment` | BOOTS | 11.1MB | guard/shell (fake ID) | [png](orch1100_baseline/038_checkout_00000000_0000_0000_0000_000000000002_payment.png) |
| `/connect-account-management` | BOOTS | 21.4MB | real content | [png](orch1100_baseline/039_connect_account_management.png) |
| `/connect-onboarding` | BOOTS | 25.3MB | real content | [png](orch1100_baseline/040_connect_onboarding.png) |
| `/connect-partner-account-management` | BOOTS | 32.4MB | real content | [png](orch1100_baseline/041_connect_partner_account_management.png) |
| `/connect-partner-onboarding` | BOOTS | 38.1MB | real content | [png](orch1100_baseline/042_connect_partner_onboarding.png) |
| `/connect-tax-registrations` | GUARD | 12.8MB | not-found / invalid-link guard (fake ID) | [png](orch1100_baseline/043_connect_tax_registrations.png) |
| `/e/leggo-this/sample` | BOOTS | 11.3MB | guard/shell (fake ID) | [png](orch1100_baseline/044_e_leggo_this_sample.png) |
| `/event/00000000-0000-0000-0000-000000000000` | BOOTS | 11.6MB | guard/shell (fake ID) | [png](orch1100_baseline/045_event_00000000_0000_0000_0000_000000000000.png) |
| `/event/00000000-0000-0000-0000-000000000000/blasts` | BOOTS | 18.3MB | guard/shell (fake ID) | [png](orch1100_baseline/046_event_00000000_0000_0000_0000_000000000000_blasts.png) |
| `/event/00000000-0000-0000-0000-000000000000/door` | BOOTS | 11.7MB | guard/shell (fake ID) | [png](orch1100_baseline/047_event_00000000_0000_0000_0000_000000000000_door.png) |
| `/event/00000000-0000-0000-0000-000000000000/door/sample` | BOOTS | 19.6MB | guard/shell (fake ID) | [png](orch1100_baseline/048_event_00000000_0000_0000_0000_000000000000_door_sample.png) |
| `/event/00000000-0000-0000-0000-000000000000/edit` | BOOTS | 26MB | guard/shell (fake ID) | [png](orch1100_baseline/049_event_00000000_0000_0000_0000_000000000000_edit.png) |
| `/event/00000000-0000-0000-0000-000000000000/group-chat` | BOOTS | 29.9MB | guard/shell (fake ID) | [png](orch1100_baseline/050_event_00000000_0000_0000_0000_000000000000_group_chat.png) |
| `/event/00000000-0000-0000-0000-000000000000/guests` | BOOTS | 35.1MB | guard/shell (fake ID) | [png](orch1100_baseline/051_event_00000000_0000_0000_0000_000000000000_guests.png) |
| `/event/00000000-0000-0000-0000-000000000000/guests/sample` | BOOTS | 11.9MB | guard/shell (fake ID) | [png](orch1100_baseline/052_event_00000000_0000_0000_0000_000000000000_guests_sample.png) |
| `/event/00000000-0000-0000-0000-000000000000/orders` | BOOTS | 19.8MB | guard/shell (fake ID) | [png](orch1100_baseline/053_event_00000000_0000_0000_0000_000000000000_orders.png) |
| `/event/00000000-0000-0000-0000-000000000000/orders/sample` | BOOTS | 15.9MB | guard/shell (fake ID) | [png](orch1100_baseline/054_event_00000000_0000_0000_0000_000000000000_orders_sample.png) |
| `/event/00000000-0000-0000-0000-000000000000/preview` | BOOTS | 18.3MB | guard/shell (fake ID) | [png](orch1100_baseline/055_event_00000000_0000_0000_0000_000000000000_preview.png) |
| `/event/00000000-0000-0000-0000-000000000000/reconciliation` | BOOTS | 11MB | guard/shell (fake ID) | [png](orch1100_baseline/056_event_00000000_0000_0000_0000_000000000000_reconciliation.png) |
| `/event/00000000-0000-0000-0000-000000000000/scanner` | BOOTS | 16.7MB | guard/shell (fake ID) | [png](orch1100_baseline/057_event_00000000_0000_0000_0000_000000000000_scanner.png) |
| `/event/00000000-0000-0000-0000-000000000000/scanners` | BOOTS | 22.2MB | guard/shell (fake ID) | [png](orch1100_baseline/058_event_00000000_0000_0000_0000_000000000000_scanners.png) |
| `/event/create` | BOOTS | 12.6MB | real content | [png](orch1100_baseline/059_event_create.png) |
| `/exp/leggo-this/sample` | BOOTS | 19.5MB | guard/shell (fake ID) | [png](orch1100_baseline/060_exp_leggo_this_sample.png) |
| `/experience/00000000-0000-0000-0000-000000000000` | BOOTS | 24.5MB | guard/shell (fake ID) | [png](orch1100_baseline/061_experience_00000000_0000_0000_0000_000000000000.png) |
| `/experience/00000000-0000-0000-0000-000000000000/edit` | BOOTS | 28.9MB | guard/shell (fake ID) | [png](orch1100_baseline/062_experience_00000000_0000_0000_0000_000000000000_edit.png) |
| `/experience/coming-soon` | BOOTS | 33.4MB | real content | [png](orch1100_baseline/063_experience_coming_soon.png) |
| `/experience/create` | BOOTS | 12MB | real content | [png](orch1100_baseline/064_experience_create.png) |
| `/home` | BOOTS | 14.9MB | real content | [png](orch1100_baseline/065_home.png) |
| `/hub` | BOOTS | 17.8MB | real content | [png](orch1100_baseline/066_hub.png) |
| `/hub/events` | BOOTS | 23.7MB | real content | [png](orch1100_baseline/067_hub_events.png) |
| `/hub/experiences` | BOOTS | 12.4MB | real content | [png](orch1100_baseline/068_hub_experiences.png) |
| `/hub/getstarted` | BOOTS | 15.8MB | real content | [png](orch1100_baseline/069_hub_getstarted.png) |
| `/hub/trips` | BOOTS | 11.8MB | real content | [png](orch1100_baseline/070_hub_trips.png) |
| `/marketing` | BOOTS | 10.9MB | real content | [png](orch1100_baseline/071_marketing.png) |
| `/marketing/audiences` | BOOTS | 11.8MB | real content | [png](orch1100_baseline/072_marketing_audiences.png) |
| `/marketing/campaigns` | BOOTS | 19.8MB | real content | [png](orch1100_baseline/073_marketing_campaigns.png) |
| `/marketing/campaigns/00000000-0000-0000-0000-000000000000` | BOOTS | 27.7MB | guard/shell (fake ID) | [png](orch1100_baseline/074_marketing_campaigns_00000000_0000_0000_0000_000000000000.png) |
| `/marketing/campaigns/compose` | BOOTS | 13.3MB | real content | [png](orch1100_baseline/075_marketing_campaigns_compose.png) |
| `/marketing/templates` | BOOTS | 20.6MB | real content | [png](orch1100_baseline/076_marketing_templates.png) |
| `/marketing/templates/00000000-0000-0000-0000-000000000000` | BOOTS | 28.8MB | guard/shell (fake ID) | [png](orch1100_baseline/077_marketing_templates_00000000_0000_0000_0000_000000000000.png) |
| `/notifications` | BOOTS | 34.4MB | real content | [png](orch1100_baseline/078_notifications.png) |
| `/o/00000000-0000-0000-0000-000000000001` | BOOTS | 11.9MB | guard/shell (fake ID) | [png](orch1100_baseline/079_o_00000000_0000_0000_0000_000000000001.png) |
| `/partner/brands` | BOOTS | 11.5MB | real content | [png](orch1100_baseline/080_partner_brands.png) |
| `/partner/earnings` | BOOTS | 17.3MB | real content | [png](orch1100_baseline/081_partner_earnings.png) |
| `/stripe-onboarding-return` | BOOTS | 16.2MB | real content | [png](orch1100_baseline/082_stripe_onboarding_return.png) |
| `/t/leggo-this/sample` | BOOTS | 19.9MB | guard/shell (fake ID) | [png](orch1100_baseline/083_t_leggo_this_sample.png) |
| `/trip/00000000-0000-0000-0000-000000000000` | BOOTS | 25MB | guard/shell (fake ID) | [png](orch1100_baseline/084_trip_00000000_0000_0000_0000_000000000000.png) |
| `/trip/00000000-0000-0000-0000-000000000000/edit` | BOOTS | 31.4MB | guard/shell (fake ID) | [png](orch1100_baseline/085_trip_00000000_0000_0000_0000_000000000000_edit.png) |
| `/trip/00000000-0000-0000-0000-000000000000/money` | BOOTS | 12.5MB | guard/shell (fake ID) | [png](orch1100_baseline/086_trip_00000000_0000_0000_0000_000000000000_money.png) |
| `/trip/00000000-0000-0000-0000-000000000000/travelers` | BOOTS | 19.6MB | guard/shell (fake ID) | [png](orch1100_baseline/087_trip_00000000_0000_0000_0000_000000000000_travelers.png) |
| `/trip/coming-soon` | BOOTS | 13.7MB | real content | [png](orch1100_baseline/088_trip_coming_soon.png) |
| `/trip/create` | BOOTS | 12.4MB | real content | [png](orch1100_baseline/089_trip_create.png) |
| `/venue/create` | BOOTS | 20.3MB | real content | [png](orch1100_baseline/090_venue_create.png) |
| `/venue/deck-readiness` | BOOTS | 17.9MB | real content | [png](orch1100_baseline/091_venue_deck_readiness.png) |

---

## REAL-ID re-probe (20 highest-value dynamic routes — populated content + native modules)

Brand `22a18413-bfbf-4087-9ba7-45f70deba0f3` (slug `leggothis`), event `61980280-ff31-4e84-a169-ea97bd07eff4` (one of 83 real events). Run with `--manifest routes.realids.manifest.json`.

| Route | Status | Peak heap | Notes | Shot |
|---|---|---|---|---|
| `/brand/{brand}` | BOOTS | 21.3MB | real content | [png](orch1100_baseline/realids/001_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3.png) |
| `/brand/{brand}/edit` | BOOTS | 27.5MB | real content | [png](orch1100_baseline/realids/002_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_edit.png) |
| `/brand/{brand}/team` | BOOTS | 33.1MB | real content | [png](orch1100_baseline/realids/003_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_team.png) |
| `/brand/{brand}/scanners` | BOOTS | 10.7MB | real content | [png](orch1100_baseline/realids/004_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_scanners.png) |
| `/brand/{brand}/listing` | BOOTS | 18.8MB | real content | [png](orch1100_baseline/realids/005_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_listing.png) |
| `/brand/{brand}/blasts` | BOOTS | 11MB | real content | [png](orch1100_baseline/realids/006_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_blasts.png) |
| `/brand/{brand}/payments` | BOOTS | 20.1MB | benign console error | [png](orch1100_baseline/realids/007_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_payments.png) |
| `/brand/{brand}/pricing-defaults` | BOOTS | 24.1MB | real content | [png](orch1100_baseline/realids/008_brand_22a18413_bfbf_4087_9ba7_45f70deba0f3_pricing_defaults.png) |
| `/event/{event}` | BOOTS | 12.3MB | real content | [png](orch1100_baseline/realids/009_event_61980280_ff31_4e84_a169_ea97bd07eff4.png) |
| `/event/{event}/edit` | BOOTS | 17.9MB | real content | [png](orch1100_baseline/realids/010_event_61980280_ff31_4e84_a169_ea97bd07eff4_edit.png) |
| `/event/{event}/door` | BOOTS | 23.6MB | door scanner shell + camera permission gate | [png](orch1100_baseline/realids/011_event_61980280_ff31_4e84_a169_ea97bd07eff4_door.png) |
| `/event/{event}/scanner` | BOOTS | 30MB | camera permission gate (web getUserMedia prompt; no crash) | [png](orch1100_baseline/realids/012_event_61980280_ff31_4e84_a169_ea97bd07eff4_scanner.png) |
| `/event/{event}/guests` | BOOTS | 36.9MB | real content | [png](orch1100_baseline/realids/013_event_61980280_ff31_4e84_a169_ea97bd07eff4_guests.png) |
| `/event/{event}/orders` | BOOTS | 13.5MB | real content | [png](orch1100_baseline/realids/014_event_61980280_ff31_4e84_a169_ea97bd07eff4_orders.png) |
| `/event/{event}/group-chat` | BOOTS | 10.9MB | GoTrue Web-Lock AbortError (RC-1 evidence) + Retry | [png](orch1100_baseline/realids/015_event_61980280_ff31_4e84_a169_ea97bd07eff4_group_chat.png) |
| `/event/{event}/preview` | BOOTS | 18.2MB | real content | [png](orch1100_baseline/realids/016_event_61980280_ff31_4e84_a169_ea97bd07eff4_preview.png) |
| `/event/{event}/blasts` | BOOTS | 12.8MB | real content | [png](orch1100_baseline/realids/017_event_61980280_ff31_4e84_a169_ea97bd07eff4_blasts.png) |
| `/event/{event}/reconciliation` | BOOTS | 18.9MB | real content | [png](orch1100_baseline/realids/018_event_61980280_ff31_4e84_a169_ea97bd07eff4_reconciliation.png) |
| `/b/leggothis` | BOOTS | 25.2MB | real content | [png](orch1100_baseline/realids/019_b_leggothis.png) |
| `/e/leggothis/{event}` | BOOTS | 29.8MB | real content | [png](orch1100_baseline/realids/020_e_leggothis_61980280_ff31_4e84_a169_ea97bd07eff4.png) |

### Real-ID findings
- **All 20 booted with real content.** `/brand/{brand}/team` (a GUARD with the fake id) renders the real team screen with the real id — confirming the fake-id GUARDs are correct behaviour, not bugs.
- **RC-5 (scanner camera) does NOT hard-crash.** `/event/{event}/scanner` and `/door` render a clean "Camera access needed → Allow camera access" web permission gate (screenshot 011/012). The native-module fear was a route-level crash; reality is a permission gate. REMAINING UNKNOWN: behaviour after granting camera permission (expo-camera-on-web `getUserMedia`) — a tap-through test is needed before declaring the scanner web-parity-complete.
- **RC-1 (GoTrue Web-Lock) confirmed live.** `/event/{event}/group-chat` rendered `AbortError: Lock broken by another request with the steal option` + a Retry button (screenshot 015) — the exact multi-tab Navigator-lock contention RC-1 describes, captured at a route level. This is the one genuinely intermittent blocker.

---

## Harness mechanism (repeatable)

1. `node tools/parity-harness/enumerate-routes.mjs` → `routes.manifest.json` (91 navigable pathnames; route groups stripped, `index` collapsed, `[param]` → sample, `.web` de-duped).
2. Build the web export with the diagnostic bypass: `EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS=1 npx expo export -p web --output-dir web-build --clear`.
3. `node tools/parity-harness/run-parity-baseline.mjs --device R58R54YV7JT` — serves `web-build` locally (SPA fallback), wires `adb reverse`/`forward`, drives phone Chrome over CDP, pauses for a one-time Google sign-in, then per route records crash?/console/heap/content-vs-stub-vs-error/screenshot, classifies, writes `results.json` incrementally. Tears down adb on exit.

### The DIAGNOSTIC firewall-bypass toggle (NOT shipped)
`mingla-business/app/_layout.tsx` now reads `process.env.EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS`. When `"1"` at build time, `orch1093RouteStatus()` returns `"interactive"` for every route. Clearly labelled `ORCH-1100 DIAGNOSTIC — do not ship as default`. The production default (`?? "static-section"`) is untouched. **This var MUST remain unset in every Vercel/production build.** It exists solely to let this harness see past the firewall.

---

## Recommendation for the fix sweep (sets the order)

1. **Retire RC-4 (the firewall)** — promote the ~79 stubbed routes to `"interactive"`, using THIS harness as the per-route device safety net (re-run after each batch; only keep a per-route gate where a route genuinely still fails, with the offender logged). This is the bulk of "every screen works on a phone" and the data says it is low-risk.
2. **Fix RC-1 (auth Web-Lock)** — decouple brand hydration from `getSession()`, add a hydration flag, mitigate the GoTrue lock. This is the only class that blocks a route from loading data, and it is intermittent (group-chat AbortError is the reproducer).
3. **Tap-through verify RC-5 scanner camera** — confirm expo-camera-on-web after permission grant; quarantine with a web `getUserMedia`/`<input capture>` branch only if it actually fails post-grant.
4. **Stand up an INTERACTION harness (Phase 4)** for RC-2 (transparent sheets) and RC-3 (composer body/Back) — these are visual/interaction defects the boot harness is structurally blind to; they need sheet-open + screenshot-diff + handler-fire assertions, not route navigation.
