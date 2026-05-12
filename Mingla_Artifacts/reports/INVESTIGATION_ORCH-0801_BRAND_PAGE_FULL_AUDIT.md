# INVESTIGATION — ORCH-0801: Brand Page + Edit Brand Page Full Forensic Audit

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-11
**Branch:** Seth · Working tree `/Users/sethogieva/Desktop/mingla-main`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md`
**Operator items:** 8 (covered)
**Verdict:** root cause proven on items 1–7; item 8 is the umbrella sweep

---

## 1. Executive Summary (Layman-First)

The Mingla Business brand surface is **partially live and full of "coming soon" placeholders that are no longer honest**. Of the 8 operator-reported issues, 2 are **S0 launch-blockers** for revenue (Stripe Connect management UI gap + tax/VAT entirely absent), 1 is a near-S0 (finance reports run on **fabricated stub data** with no live Stripe wiring + no timezone correctness), 3 are S1–S2 feature gaps (cover image upload missing, hue presets to be removed, audit-log slugs unreadable), 1 is a trivial cleanup (username on event tile), and 1 is the umbrella audit itself (covered by this report).

**Biggest surprises beyond the operator's framing:**

1. **The "Tax & VAT" row on the brand page is a known dead tap** that fires `"Tax settings land in a later cycle"` — but tax/VAT is **completely unimplemented anywhere in the stack**: no Stripe Tax integration, no `tax_*` columns on events/tickets/orders, no buyer receipt tax breakdown, no organiser report tax line item. The `brands.tax_settings` JSON column exists but is **always written as `{}`**. This is a far deeper compliance gap than the operator framed.
2. **The Disconnect Stripe edge function is fully implemented server-side but has no UI button** — operator literally cannot self-service disconnect without an engineer.
3. **`STUB_PAST_EVENTS` fakes brand history** — hardcoded fake event rows like `"228 / 240"` sold render LIVE on brand profiles for specific brand IDs (`lm`, `tll`, `sl`, `hr`). Anyone whose brand ID matches sees fabricated data per Constitution #9.
4. **ORCH-0796 stub fixture leak is still present** — `BrandPaymentsView.tsx:175-187` still reads `brand.payouts` / `brand.refunds` from Zustand. ORCH-0796 was registered but never closed.
5. **Audit log shows raw slugs (28 distinct values) with zero label mapping** — verified by direct grep.

**Strongest finding strength:** Items #1, #4, #6, #7 are HIGH confidence (file:line + grep proofs). Items #2/#3/#5 (cover image) HIGH confidence. Item #5 (finance reports stub + tax absence) HIGH confidence.

---

## 2. Investigation Manifest

Files read or grep-traced during this investigation:

**Routes:**
- `mingla-business/app/event/[id]/index.tsx:660-672` (item #1 — brand tile)
- `mingla-business/app/brand/[id]/index.tsx` (148 lines)
- `mingla-business/app/brand/[id]/edit.tsx` (129 lines)
- `mingla-business/app/brand/[id]/audit-log.tsx` (237 lines)
- `mingla-business/app/brand/[id]/team.tsx` (488 lines)
- `mingla-business/app/brand/[id]/payments/index.tsx` (71 lines)
- `mingla-business/app/brand/[id]/payments/onboard.tsx` (69 lines)
- `mingla-business/app/brand/[id]/payments/reports.tsx` (55 lines)

**Components (`mingla-business/src/components/brand/`):**
- `BrandProfileView.tsx` (992 lines)
- `BrandEditView.tsx` (999 lines)
- `BrandPaymentsView.tsx` (689 lines)
- `BrandFinanceReportsView.tsx` (859 lines)
- `BrandOnboardView.tsx` (1079 lines)
- `BrandStripeBankSection.tsx`, `BrandStripeCountryPicker.tsx`, `BrandStripeDeadlineBanner.tsx`, `BrandStripeKycRemediationCard.tsx`, `BrandStripeOrphanedRefundsSection.tsx`
- `BrandSwitcherSheet.tsx`, `BrandDeleteSheet.tsx`
- `PublicBrandPage.tsx` (1017 lines)

**Services / hooks:**
- `brandsService.ts`, `brandMapping.ts`, `brandStripeService.ts`, `brandStripeBalancesService.ts`, `brandStripeDetachService.ts`, `brandStripeOrphanedRefundsService.ts`
- `useBrand.ts`, `useUpdateBrand.ts`, `useBrandStripeStatus.ts`, `useBrandStripeBalances.ts`, `useBrandStripeDetach.ts`, `useAuditLog.ts`
- `currentBrandStore.ts` (Zustand persist)

**Edge functions (`supabase/functions/`):**
- `brand-stripe-onboard/index.ts`, `brand-stripe-refresh-status/index.ts`, `brand-stripe-balances/index.ts`, `brand-stripe-detach/index.ts`
- `_shared/audit.ts`, `_shared/stripeWebhookRouter.ts`
- Greps across all functions for `tax`, `vat`, `automatic_tax`, `tax_rates`, `createLoginLink`, `login_links`, `pexels`, `giphy`

**Migrations (`supabase/migrations/`):**
- `20260505000000_baseline_squash_orch_0729.sql` (baseline)
- `20260506000000_brand_kind_address_cover_hue_media.sql` (cover columns)
- `20260507000000_*.sql` (ORCH-0734 RLS policies)
- `20260513000002_b2a_v3_audit_log_target_id_text.sql` (audit_log text widening)
- Grep for `tax`, `vat` across all migrations

---

## 3. Findings Inventory (Severity-Ranked)

### F-01 🔴 ROOT CAUSE [P0/S0] — Tax + VAT is completely unimplemented across the entire stack

- **File:** `mingla-business/src/services/brandMapping.ts:39, 68, 263` + every grep target below
- **Exact code:** `brandMapping.ts:263 — tax_settings: {},` (always written as empty object on insert)
- **What it does:** The `brands.tax_settings` JSONB column exists in the schema but is **never populated**. No UI editor in `BrandEditView` or `BrandProfileView`. No tax rate columns on `events`, `ticket_types`, `orders`, or `order_line_items` (verified by migration grep). No Stripe Tax integration: zero matches for `automatic_tax`, `tax_rates`, `tax_behavior`, `tax_id_collection` across `supabase/functions/`. No tax line item in buyer checkout (`CartContext.tsx` `OrderResult` has only `total` / `totalGbp`, no tax fields). No tax breakdown in confirmation emails (`ticket-confirmation-dispatch` has 0 grep hits for "tax"). No tax line in organiser finance reports (`BrandFinanceReportsView` breakdown is "Gross sales / Refunds / Mingla fee / Stripe processing / Net to bank" — no tax row). The `BrandProfileView` "Tax & VAT" Operations row (line 309) fires `fireToast("Tax settings land in a later cycle.")` (dead tap).
- **What it should do:** Brand-level tax registration (VAT number, country of registration), event-or-ticket-level tax rates (or Stripe Tax `automatic_tax: { enabled: true }` on PaymentIntents), tax line items shown to buyer at checkout and on receipt, tax-collected KPI on organiser finance report, optional Stripe Tax registration view on Payments screen.
- **Causal chain:** Brand pays for Stripe Connect onboarding → accepts buyer payments → no tax is calculated or collected → brand is liable for VAT remittance with no Mingla-side accounting → audit risk on first EU/UK transaction → legal exposure for the brand AND for Mingla as platform.
- **Verification step:** `grep -rn "automatic_tax\|tax_rates\|tax_behavior" supabase/functions/` returns zero. `grep -rn "tax" supabase/migrations/ | grep -v "audit\|relax\|extracted"` shows only the inert `tax_settings` JSONB column and a GDPR comment. `grep -rn "tax" mingla-business/src/store/cart/CartContext.tsx` returns zero.
- **Maps to:** **ORCH-0804** (and significant scope expansion — operator must decide merchant-of-record posture; see Open Questions §8).
- **Confidence:** HIGH.

### F-02 🔴 ROOT CAUSE [P0/S0] — Stripe Connect management UI gap; multiple critical capabilities absent

- **File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx` (689 lines) + entire `supabase/functions/brand-stripe-*` set
- **Exact gaps:** For a brand with `status='connected'`, the UI offers:
  - ✅ Live balance (available + pending) via `brand-stripe-balances` edge fn
  - ✅ KYC remediation card (when status ≠ "active")
  - ❌ View the connected `acct_…` account ID (server-side only; never rendered)
  - ❌ Deep-link to Stripe Express Dashboard — **zero matches for `createLoginLink`, `login_links`, `loginLinks`** across the entire `supabase/functions/` tree
  - ❌ Payout schedule (daily/weekly/monthly) — never queried or displayed
  - ❌ Live payout history from Stripe — only Zustand stub `brand.payouts ?? []` (see F-03)
  - ❌ Live refund history from Stripe — only Zustand stub `brand.refunds ?? []` (orphaned-refunds section only renders post-detach via `BrandStripeOrphanedRefundsSection`)
  - ❌ **Disconnect button** — `brand-stripe-detach` edge function fully implemented; `useBrandStripeDetach` hook fully implemented; **NO UI surface invokes it.** Grep `BrandPaymentsView.tsx` for "detach/disconnect" returns only conditional rendering of the orphaned-refunds section (lines 344, 382), no CTA.
  - ❌ Switch to a different Stripe account — only via country-change replacement during onboarding re-entry
  - ❌ Stripe Tax registration view
  - ⚠️ Bank account edit — re-routes to full onboarding flow rather than dedicated bank-edit surface
- **What it should do:** A "Manage Stripe" section with: account ID display, "Open Stripe Dashboard" CTA (login link), payout schedule view + edit, recent payouts (live from Stripe API not Zustand), Disconnect CTA with confirmation sheet, optional switch-account flow.
- **Causal chain:** Operator-witnessed: "Payments and stripe shows connected, but no way to manage the stripe connection or access the details." All admin operations require a Mingla engineer to either: (a) run direct edge function calls, (b) instruct the brand to manage from Stripe's own dashboard via their own login (Mingla has no link), or (c) re-onboard from scratch.
- **Verification step:** `grep -rn "createLoginLink\|login_links\|loginLinks" supabase/functions/` → 0 matches. `grep -n "Disconnect\|detach" mingla-business/src/components/brand/BrandPaymentsView.tsx` → only conditional mount of orphaned-refunds section (no CTA). `brand-stripe-detach/index.ts` exists, exports a working POST handler at line 80 emitting `stripe_connect.detach_completed` audit event.
- **Maps to:** **ORCH-0802** (and bundles ORCH-0796 stub fixture cleanup — see F-03).
- **Confidence:** HIGH.

### F-03 🔴 ROOT CAUSE [P0/S1] — Finance reports run entirely on Zustand stub data + hardcoded fee constants + no timezone correctness

- **File:** `mingla-business/src/components/brand/BrandFinanceReportsView.tsx:11, 23-25, 27-30, 98, 129-137, 151, 195-203, 233-238, 464`
- **What it does:**
  - **Data source:** All KPIs (gross sales, refunds, Mingla fee, Stripe fee, net to bank) computed client-side via `summarizeLegacyBrandFinance()` reading `brand.events: BrandEventStub[]` and `brand.refunds: BrandRefund[]` — **both are Zustand-persisted stubs**, NOT live Supabase queries. `BrandFinanceReportsView.tsx:11` literally says `[TRANSITIONAL]` and `:23-25` says "Per-event records are a Brand-level stub array… Real events ship Cycle 3".
  - **Fees:** `STRIPE_PERCENT`, `STRIPE_FLAT_GBP`, `MINGLA_PERCENT`, `MINGLA_FLAT_GBP` are **hardcoded constants** at line 98 — not pulled from Stripe Connect account or platform config (`:27-30`: "Mingla fee + Stripe processing rates are hard-coded… Real Stripe rates land in B2").
  - **Currency:** `summarizeLegacyBrandFinance()` returns a `currency` field hardcoded to `"GBP"` regardless of brand `defaultCurrency` (mismatch banner displayed at lines 354-372 when brand isn't GBP, but the display still renders GBP figures).
  - **Time-zone:** `computeCutoffMs()` (lines 129-137) uses **device-local** `new Date(new Date().getFullYear(), 0, 1).getTime()` for YTD and `Date.now() - days * 24*60*60*1000` for 7d/30d/90d. NYC organiser and London organiser see different period boundaries for "same logical today" — Constitution #12 violation (validate at the right time, in user/brand timezone).
  - **Export:** 3 export rows (Stripe payouts CSV, UK VAT quarterly, all transactions) at lines 110-114; `handleExportTap` fires Toast `"${label} export lands in B2."` — **stub only.**
- **What it should do:** Live queries against `payouts` + `refunds` + `orders` tables with refund-aware aggregation, brand-currency-aware formatting, brand-timezone-aware period cutoffs, real Stripe fee retrieval from Connect account, real CSV/PDF export.
- **Causal chain:** Organiser opens "Finance reports" → sees stub data dressed as real → makes business decisions on fabricated numbers (Const #9) → reconciliation gap when matched against Stripe dashboard.
- **Verification step:** Read `BrandFinanceReportsView.tsx:11, 175-180, 233-238` directly. Grep `payouts` + `refunds` for any service-layer query: no React Query hook fetches `payouts` or `refunds` for the finance reports view. RLS for `public.payouts` and `public.refunds` is enforced server-side (per ORCH-0787 + baseline migration), so even if wired correctly the data isolation would be safe; the gap is that no wiring exists.
- **Maps to:** **ORCH-0803** (this is the same scope as the long-deferred B2b/B3 finance migration the comments reference).
- **Confidence:** HIGH.

### F-04 🟠 CONTRIBUTING FACTOR [P0/S1] — ORCH-0796 Zustand stub fixture leak still present in BrandPaymentsView

- **File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx:170-187`
- **Exact code:**
  ```
  // [TRANSITIONAL] payouts + refunds still read from Zustand stub
  // (brand.payouts, brand.refunds). B2a does NOT migrate these to real
  // payouts + refunds table queries — that ships in B2b/B3…
  const sortedPayouts = useMemo<BrandPayout[]>(() => {
    return (brand.payouts ?? []).slice().sort(...);
  }, [brand]);
  const sortedRefunds = useMemo<BrandRefund[]>(() => {
    return (brand.refunds ?? []).slice().sort(...);
  }, [brand]);
  ```
- **What it does:** "Last payout" KPI + RECENT PAYOUTS table rows on the Payments screen are sourced from Zustand persist, not live Stripe data — exact issue ORCH-0796 was registered for and never closed.
- **What it should do:** Read from `payouts` table via React Query hook against the live `payouts` Stripe-sync edge function (does not exist yet) OR fetch from Stripe API via a new `brand-stripe-payouts` edge function.
- **Causal chain:** Same as F-03 but on Payments screen rather than Finance reports.
- **Verification step:** Verified directly — see "verify ORCH-0796 stub fixture still present" command output in investigation transcript. NB: the comment says "persist migration v12→v13 will drop them" — `currentBrandStore.ts` is now at v14 and per the brand-page sweep audit, **only `currentBrandId` persists** (no Brand snapshot, no payouts/refunds arrays in the partialize payload). So the **persist payload has been cleaned (✓)**, BUT the component still reads `brand.payouts` from the in-memory React Query Brand object, which carries empty arrays today by virtue of those fields not being populated on read. The DISPLAYED data is therefore empty rather than fabricated — but the COMPONENT WIRING still points at non-existent server data, meaning when real payouts arrive in some other code path they will not flow through this view.
- **Maps to:** **ORCH-0802** (Stripe management UI). Note: ORCH-0796 itself can be marked partially closed (persist cleanup done) with the remaining read-path migration folded into ORCH-0802.
- **Confidence:** HIGH.

### F-05 🔴 ROOT CAUSE [P1/S1] — Audit log renders 28 raw slug values with zero human-readable label mapping

- **File:** `mingla-business/app/brand/[id]/audit-log.tsx:157` (`<Text style={styles.rowAction}>{r.action}</Text>` — monospace, no label) + `mingla-business/src/hooks/useAuditLog.ts:51` (selects raw `action` column with no transform)
- **Slug inventory (28 distinct values):**
  - 14 static `stripe_connect.*` slugs (`onboard_initiated`, `reactivated`, `country_change_locked`, `country_change_replaced_before_completion`, `detach_completed`, `detach_local_success_stripe_rejected`, `balance_retrieved`, `status_refreshed`, `account_updated`, `account_deauthorized`, `detached_refund_updated`, `webhook_ip_soft_fail`, `webhook_unhandled`, `kyc_stall_reminder_sent`)
  - Dynamic `stripe_connect.deadline_warning_{N}d_sent` (N ∈ {7,3,1})
  - Dynamic `stripe.{event.type}.reconciled`, `stripe.{event.type}.{refundStatus}`, `stripe.{event.type}.orphan`, `stripe_connect.{event.type}` (4 templates)
  - Static: `order_cancelled`, `order_refund_issued`, `mingla_tos_accept`, `ops.webhook_silence_check_fired`
- **What it does:** Slugs render verbatim in monospace font (UI looks like a developer log). Examples seen: `stripe_connect.detach_local_success_stripe_rejected`, `ops.webhook_silence_check_fired`.
- **What it should do:** Each slug should map to a human-readable label + (optional) icon + (optional) plain-English detail line. E.g. `stripe_connect.detach_completed` → "Disconnected Stripe account" + "Disconnected by Seth · 2 hours ago".
- **Causal chain:** Audit log is brand-admin-facing compliance surface → raw slugs make it incomprehensible → trust loss + support tickets.
- **Verification step:** Direct grep across `supabase/functions/` for `writeAudit` calls confirmed 28 distinct slug emissions. UI source verified.
- **Other audit-log UX issues bundled (P2):** hardcoded 100-row limit / no pagination (`useAuditLog.ts:24`); no filter by action type; actor truncated to last-6-of-uuid (`audit-log.tsx:62, 161`); target truncated similarly; timestamp shown as relative-only (no absolute on hover); RLS shows banner about admin-can-read-all but RLS policy is self-only (mismatch).
- **Maps to:** **ORCH-0806** (slug-label map). Other audit-log P2 issues can either bundle here or be a follow-up (recommend: bundle the label map + pagination + filter together as the audit-log gets seen so rarely it's cheaper to do at once).
- **Confidence:** HIGH.

### F-06 🟠 CONTRIBUTING FACTOR [P1/S2] — Brand cover image: hue presets are the only option; image/GIF/Pexels/Giphy entirely absent

- **File:** `mingla-business/src/components/brand/BrandEditView.tsx:75 (COVER_HUE_TILES = [25,100,180,220,290,320]), :305-307 (handlePhotoEdit Toast), :441-479 (hue swatch UI), :476-478 ("Photo and video uploads coming soon" caption)`
- **What it does:**
  - Schema has `brands.cover_hue` (integer 0-359, default 25), `brands.cover_media_url` (text, NULL), `brands.cover_media_type` (`'image'|'video'|'gif'|NULL`) — added in `20260506000000_brand_kind_address_cover_hue_media.sql`. Media columns are **schema-ready but never populated** by any code path today.
  - UI only renders 6 hue swatch picks; cover image upload affordance (pencil icon) fires deferral toast `"Photo upload lands in a later cycle."`
  - `PublicBrandPage.tsx:250-261` renders cover as `<View style={{backgroundColor: \`hsl(${brand.coverHue}, 60%, 45%)\`}} />` — never checks `coverMediaUrl`, so even if the URL were set by some other path it would not display.
  - **Zero references to "pexels" or "giphy" in brand code paths.** Both APIs are integrated for **event covers** only (`giphyEventCoverService.ts`, `pexelsEventCoverService.ts`, `CreatorStep4Cover.tsx:113-168`).
- **What it should do:** Remove hue presets (or repurpose as a fallback when no media is set), add custom-upload pipeline mirroring the avatar pattern from ORCH-0786 (`creatorAvatarService` + `creatorAvatarFileReader` + `creatorAvatarRules`), allow image/GIF MIME types (avatar pipeline currently rejects GIF — relax for brand cover only), integrate Pexels + Giphy library pickers as a third source (already-built event-cover services can be generalised). Public page render must check `coverMediaUrl` first, fall back to hue.
- **Causal chain:** Brand cannot put their actual brand identity on the cover → cover is generic colour swatch → public brand pages look templated.
- **GIF Android caveat:** RN `<Image>` auto-animates GIFs on iOS but **freezes on first frame on Android**. The existing event-cover code (`eventCoverMediaRules.ts:395`) classifies GIFs but uses `<Image>` — same caveat. Implementor will need either a GIF-aware wrapper (e.g. `expo-image` with `contentFit="cover"` + animated decoding) OR limit GIFs to iOS only.
- **Verification step:** Migration `20260506000000_brand_kind_address_cover_hue_media.sql` direct read confirms schema-ready columns. `grep -rn "pexels\|giphy" mingla-business/ | grep -i brand` returns zero. `PublicBrandPage.tsx:250-261` direct read confirms hue-only render.
- **Maps to:** **ORCH-0805** (cover overhaul — bundles operator items #2 and #3).
- **Confidence:** HIGH.

### F-07 🟠 CONTRIBUTING FACTOR [P1/S2] — `STUB_PAST_EVENTS` hardcoded fake event history violates Constitution #9

- **File:** `mingla-business/src/components/brand/BrandProfileView.tsx:69-87, 265-268, 404`
- **Exact code:** `const STUB_PAST_EVENTS: Record<string, StubPastEventRow[]> = { lm: [...], tll: [...], sl: [...], hr: [...] };` Each row has fabricated `sold` counts like `"228 / 240"`, `"12 / 12"`, etc.
- **What it does:** When a brand has `id` matching `"lm"`, `"tll"`, `"sl"`, or `"hr"`, BrandProfileView renders **invented past-event rows** as "Recent events" with fake attendance figures. For any other brand ID, the lookup returns `[]` (empty array → empty state). Per Constitution #9 (no fabricated data — missing = hidden, never fake), this is a clear violation. The code comment at line 66 marks it `[TRANSITIONAL]` pending Cycle 3 real-event fetch, but the fake data renders live.
- **What it should do:** Remove the stub entirely; either show empty state for all brands until Cycle 3 real events ship, OR wire to live events query via `useBrandEvents(brandId)` and show real history.
- **Causal chain:** Specific test/demo brand IDs see fake attendance → trust loss when reconciling with real ticketing data.
- **Verification step:** Direct read of BrandProfileView.tsx:69-87 confirmed.
- **Maps to:** **ORCH-0801 audit close-out** (single-line fix; recommend bundling into ORCH-0801 itself rather than spawning a new ORCH).
- **Confidence:** HIGH.

### F-08 🟠 CONTRIBUTING FACTOR [P2/S2] — Empty-bio CTA dead tap with stale "coming soon" honesty issue

- **File:** `mingla-business/src/components/brand/BrandProfileView.tsx:245-247, 403-413`
- **Exact code:** `handleEmptyBio = useCallback(() => { fireToast("Editing lands in J-A8."); }, [...])`. Tapped via empty-bio CTA in profile body.
- **What it does:** Tapping the empty-bio prompt CTA shows toast `"Editing lands in J-A8."` However, the brand edit screen IS shipped (sticky shelf "Edit brand" button at the top of the same page routes to `/brand/{id}/edit` — same screen that would land here if J-A8 were complete). The empty-bio specific CTA path was never wired, even though the destination screen exists.
- **What it should do:** Either wire the CTA to `onEdit(brand.id)` (same handler as sticky shelf), or remove the toast and disable the affordance.
- **Verification step:** Direct grep confirmed `handleEmptyBio` and the J-A8 toast. Sticky shelf edit handler at `index.tsx:78` routes correctly today.
- **Maps to:** **ORCH-0801 audit close-out** (single-line fix; bundle into 0801 close).
- **Confidence:** HIGH.

### F-09 🟠 CONTRIBUTING FACTOR [P2/S3] — Photo-edit pencil dead tap on Edit Brand page

- **File:** `mingla-business/src/components/brand/BrandEditView.tsx:305-307, 386-392`
- **Exact code:** `handlePhotoEdit = () => fireToast("Photo upload lands in a later cycle.")`. Pencil icon overlay on avatar invokes it.
- **What it does:** Pencil affordance suggests editability but firing a "coming soon" toast is dishonest UX. Should either disable the affordance + visibly grey it out, OR ship the upload (which is what ORCH-0805 will do for the cover; avatar upload itself already shipped via ORCH-0786 for the creator account — brand-avatar upload is a separate path not yet wired).
- **What it should do:** Wire to a brand-avatar upload service mirroring the creator-avatar pattern, OR remove the pencil entirely until shipped.
- **Verification step:** Direct read confirmed.
- **Maps to:** **ORCH-0805** (since the same UI fix touches cover; bundle avatar upload as a small extra) OR a small ORCH-0805-A.
- **Confidence:** HIGH.

### F-10 🔵 OBSERVATION [P3/S3] — Brand tile on event page shows `@${brand.slug}` as subtitle

- **File:** `mingla-business/app/event/[id]/index.tsx:666-672`
- **Exact code:** `<ActionTile icon="user" label="Brand page" sub={\`@\${brand.slug}\`} onPress={handleBrandPage} />`
- **What it does:** Renders the brand's slug (handle) prefixed with `@` as the subtitle of the "Brand page" ActionTile on the event detail screen. The operator describes this as the "username" — strictly it's the brand slug, but visually it reads as a `@handle` ornament that adds no information beyond "Brand page" (the tile already says that).
- **What it should do:** Either remove `sub` entirely (clean tile), or replace with brand name if different from event header.
- **Causal chain:** Trivial UX clutter.
- **Verification step:** Direct read + grep for all `brand.` renders on the event detail screen confirmed this is the ONLY site of brand-handle display.
- **Maps to:** **ORCH-0807** (trivial one-line fix).
- **Confidence:** HIGH.

### F-11 🟡 HIDDEN FLAW [P2/M] — `brand.contact.phoneCountryIso` edited in form but not persisted to DB

- **File:** `mingla-business/src/components/brand/BrandEditView.tsx:585-589` + `mingla-business/src/services/brandMapping.ts:7`
- **Exact code:** `brandMapping.ts:7 — "Brand.contact.phoneCountryIso is not stored on brands; it is lost on save unless you add a column or JSON convention later."`
- **What it does:** User can pick a country code in the phone country picker, but on save the country resets to "GB" default at next cold-start. Per-session only.
- **What it should do:** Persist `phoneCountryIso` either as a new `brands.contact_phone_country` column or as a nested field inside the existing `brands.contact_phone` JSON (or string with E.164 prefix).
- **Verification step:** Direct read confirmed.
- **Maps to:** **ORCH-0808** umbrella verification (or its own micro-ORCH if operator wants it called out).
- **Confidence:** HIGH.

### F-12 🟡 HIDDEN FLAW [P2/M] — `useBrand` query error renders as "Brand not found"

- **File:** `mingla-business/src/components/brand/BrandProfileView.tsx:40-46, 344`
- **What it does:** Network/RLS errors collapse into the same not-found code path as a genuinely missing brand. User cannot distinguish "couldn't load" from "doesn't exist."
- **What it should do:** Branch on `brandQuery.isError` and render an error card with retry.
- **Maps to:** **ORCH-0808** umbrella verification.
- **Confidence:** HIGH.

### F-13 🔵 OBSERVATION [P3/M] — Silent error swallow on `BrandStripeBankSection`

- **File:** `mingla-business/src/components/brand/BrandStripeBankSection.tsx:86-90`
- **What it does:** `if (verification.isError || !verification.data) { return null; }` — hides bank verification errors silently. Per Constitution #3 (no silent failures), errors should surface.
- **Maps to:** **ORCH-0802** (Stripe management UI) — bundle the fix.
- **Confidence:** HIGH.

### F-14 🔵 OBSERVATION [P4] — Brand persist payload is clean (post-ORCH-0796 partial cleanup)

- **File:** `mingla-business/src/store/currentBrandStore.ts` partialize → `{ currentBrandId }` only.
- **What it does:** Brand snapshot, payouts, refunds, etc. are NO LONGER in the persist payload (v14). Per I-PROPOSED-J this is compliant. Earlier versions (pre-v14) carried server-record arrays; those were dropped. The remaining ORCH-0796 issue is the COMPONENT WIRING (F-04), not the persist payload.
- **Maps to:** N/A — note for ORCH-0796 partial-close.
- **Confidence:** HIGH.

### F-15 🔵 OBSERVATION [P3/L] — Slug immutability enforced + RLS-RETURNING-OWNER-GAP fixed

- **Files:** `mingla-business/src/components/brand/BrandEditView.tsx:395-402` (slug locked UI) + `supabase/migrations/20260507000000_*.sql` ORCH-0734 policies.
- **What it does:** Slug edits are blocked by DB trigger `trg_brands_immutable_slug`. RLS direct-predicate owner policies (per ORCH-0734) pair correctly with mutations — no RLS-RETURNING-OWNER-GAP risk on the brand surface.
- **Maps to:** N/A — positive observation.
- **Confidence:** HIGH.

---

## 4. Operator-Item Reconciliation

| # | Operator item | Verdict | Mapped finding(s) | Mapped ORCH |
|---|---------------|---------|-------------------|-------------|
| 1 | Username on event-page brand tile irrelevant | **CONFIRMED** (it's the brand slug rendered as `@handle`, not actual auth username) | F-10 | ORCH-0807 |
| 2 | Edit brand page should allow custom image/GIF upload | **CONFIRMED** (handlePhotoEdit fires deferral toast; no upload service for brand cover or brand avatar) | F-06, F-09 | ORCH-0805 |
| 3 | Remove hue options, add custom + Pexels + Giphy | **CONFIRMED** (hue presets exist as 6-swatch picker; zero pexels/giphy integration for brand covers; event-cover services exist and can be generalised) | F-06 | ORCH-0805 |
| 4 | Audit log shows unfriendly slugs | **CONFIRMED + EXPANDED** (28 distinct slugs, zero label mapping; bonus: hardcoded 100-row limit, no filter, truncated actor, no absolute timestamp, RLS-mismatch banner) | F-05 | ORCH-0806 |
| 5 | Finance reports production-ready audit | **CONFIRMED + EXPANDED** (entirely Zustand-stub; hardcoded fees; UTC-only timezone math; CSV/PDF export stubbed) | F-03 | ORCH-0803 |
| 6 | Tax + VAT audited and configured | **REFINED & EXPANDED** — operator framed as "audit"; reality is **complete absence across the entire stack** (brand config, event/ticket config, Stripe Tax integration, buyer receipt, organiser report, buyer checkout — all zero). Decision needed on merchant-of-record posture before scoping. | F-01 | ORCH-0804 |
| 7 | Stripe connected but no management UI | **CONFIRMED + EXPANDED** (10 missing capabilities: account ID display, dashboard login link, payout schedule, payout history, refund history for active accounts, disconnect CTA, switch-account, Stripe Tax view, bank-edit-only surface, country change post-onboard) + ORCH-0796 wiring partially remediated (F-04) | F-02, F-04, F-13 | ORCH-0802 (bundles ORCH-0796 close-out) |
| 8 | Full brand + edit brand audit | **CONFIRMED** — this report IS the audit. Findings inventory above. Additional discoveries: F-07 (STUB_PAST_EVENTS), F-08 (empty-bio dead CTA), F-11 (phoneCountryIso not persisted), F-12 (useBrand error path), F-14 (persist clean), F-15 (RLS clean). | F-07–F-15 | ORCH-0801 close-out (bundle F-07 + F-08 single-line fixes) + ORCH-0808 verification umbrella |

---

## 5. ORCH Mapping Table

| ORCH | Findings | Severity | Pre-spec confidence | Notes |
|------|----------|----------|---------------------|-------|
| ORCH-0801 (this audit close-out) | F-07 STUB_PAST_EVENTS, F-08 empty-bio CTA, F-14 persist observation | S2 + S2 + N/A | HIGH | Single-commit cleanup; bundle as ORCH-0801 close note |
| ORCH-0802 Stripe management UI | F-02, F-04, F-13 | **S0** | HIGH on capability inventory; MEDIUM on chosen implementation surface (modal vs section vs new screen — needs UX direction) | Bundles ORCH-0796 close-out. Decide whether to add Disconnect + Switch Account flows or just Dashboard deep-link MVP. |
| ORCH-0803 Finance reports | F-03 | **S0** for fabricated-data violation; S1 for the rest | HIGH | Implementation = a deep migration cycle (real payouts query + real Stripe fee retrieval + brand-tz period math + export pipeline). Likely splits into ORCH-0803-A (data wiring), ORCH-0803-B (timezone correctness), ORCH-0803-C (export). Operator should decide whether to split. |
| ORCH-0804 Tax + VAT | F-01 | **S0** for legal/compliance | LOW until operator answers Open Questions §8 | Cannot spec without merchant-of-record decision. Recommend SPEC blocked until operator decision. |
| ORCH-0805 Cover overhaul | F-06, F-09 | S1 | HIGH | Bundles ops items 2+3. Mirror ORCH-0786 avatar pipeline. Decide on Android GIF strategy. Generalise event-cover Pexels/Giphy services to brand. |
| ORCH-0806 Audit log labels + UX | F-05 | S1 | HIGH for label map; MEDIUM on whether to bundle pagination + filter | Cheapest fix is a `auditActionToLabel(slug, params)` helper in `mingla-business/src/utils/`. Pagination + filter are larger; recommend bundling since the screen is rarely visited. |
| ORCH-0807 Username on event tile | F-10 | S3 | HIGH | One-line fix. |
| ORCH-0808 Verification umbrella | F-11, F-12 + retest of 0802-0807 | S1 (verification) | HIGH | Folds into final retest after all sub-ORCHs close. May fold into ORCH-0801 close note. |

---

## 6. Five-Truth-Layer Contradictions

| Topic | Docs | Schema | Code | Runtime | Data | Resolution |
|-------|------|--------|------|---------|------|------------|
| Brand cover media | PRD implies brand cover is media-rich | `cover_media_url`, `cover_media_type` columns exist (`20260506000000`) | UI offers hue only; render path never checks media columns | N/A (no media ever uploaded) | All rows have `cover_media_url = NULL` | Schema ready; code never honors it. Fix: ORCH-0805. |
| Brand tax | No PRD section on tax flow (gap) | `brands.tax_settings` JSONB column exists | UI has no editor; mapper writes `{}` always; zero Stripe Tax integration | Buyers pay tax-free everywhere | All `tax_settings = {}` | Implementation entirely absent. Fix: ORCH-0804 + operator decision. |
| Brand payouts on Payments screen | Comment in code says payouts ship "in B2b/B3" | `payouts` + `refunds` tables exist with RLS | Component reads `brand.payouts` from React Query Brand object (which has empty arrays today) | UI shows empty list | Real Stripe payouts arrive at webhook → recorded in `payouts` table (per ORCH-0787) BUT never read by Payments screen | Wiring gap. Fix: ORCH-0802. |
| Audit log slugs | No PRD on labels | `audit_log.action text` (no enum) | UI renders raw `action` in monospace | User sees `stripe_connect.detach_local_success_stripe_rejected` | All slug values valid; just unmapped | Pure UI fix: ORCH-0806. |
| Empty-bio CTA | Comment `// exit when J-A8 lands` | N/A | Toast `"Editing lands in J-A8"` | User taps, sees deferral toast even though edit page exists | N/A | Drift between code-comment and reality. Fix: ORCH-0801 close-out. |

---

## 7. Invariant Violations

| Invariant | Violated by | Finding | Severity |
|-----------|-------------|---------|----------|
| Constitution #9 — No fabricated data | `STUB_PAST_EVENTS` renders fake event history for specific brand IDs | F-07 | P1 |
| Constitution #9 — No fabricated data | `BrandFinanceReportsView` renders stub data dressed as real KPIs | F-03 | P0 |
| Constitution #9 — No fabricated data | `BrandPaymentsView` reads `brand.payouts`/`brand.refunds` stub paths (currently rendering empty, but the wiring violates the principle) | F-04 | P1 |
| Constitution #3 — No silent failures | `BrandStripeBankSection.tsx:86-90` swallows verification errors with `return null` | F-13 | P3 |
| Constitution #3 — No silent failures | `useBrand` error renders as not-found | F-12 | P2 |
| Constitution #12 — Validate at the right time | Finance period cutoffs use device-local time, not brand timezone | F-03 | P1 |
| I-PROPOSED-J — Zustand persist no server snapshots | ✅ **NO ACTIVE VIOLATION** — v14 partialize is clean. F-04 is a component-wiring drift, not a persist violation. | F-14 | N/A |

---

## 8. Open Questions for Operator (Decision-Required Before SPEC)

These are decisions only the operator/business can make. ORCH-0804 SPEC is blocked on Q1–Q3; ORCH-0802 SPEC needs Q4–Q5; ORCH-0805 SPEC needs Q6.

1. **Tax — Merchant of record:** Is Mingla the merchant of record for tax purposes (collects + remits tax on behalf of brands), or is the brand always the merchant of record (responsible for their own tax)? This is a fundamental Stripe Connect architecture question (separate vs destination charges + Stripe Tax behavior).
2. **Tax — Geographic scope:** UK + EU only at MVP? Or global day-one? Stripe Tax supports many jurisdictions but pricing/complexity scales.
3. **Tax — Inclusive vs exclusive pricing:** Are ticket prices tax-inclusive (UK norm) or tax-exclusive (US norm)? Affects buyer checkout display and refund math.
4. **Stripe management surface — Scope of MVP:** Should ORCH-0802 ship as (a) a thin "Open Stripe Dashboard" deep-link button only, OR (b) full management with account ID display + payout list + Disconnect + Switch Account? Bundle a/b/c choices for the operator.
5. **Stripe Disconnect — Confirmation flow:** Disconnect is irreversible at the Stripe end (must re-onboard). Should the UX require typing the brand name to confirm, or a single tap-through dialog?
6. **Cover image — GIF on Android:** RN `<Image>` does not auto-animate GIFs on Android. Should we (a) limit GIF uploads to iOS only, (b) ship `expo-image` with animated decoding, or (c) transcode GIFs to MP4 server-side?
7. **Audit log labels — Granularity:** For dynamic slugs like `stripe.charge.refund.updated.pending`, should the label be a single "Refund updated" or include the status? Affects map size.
8. **STUB_PAST_EVENTS removal:** Confirm the 4 specific brand IDs (`lm`, `tll`, `sl`, `hr`) are demo brands; we'll remove the stub entirely. If any of those IDs are production brands seeing the fake history, escalate.

---

## 9. Out-of-Scope Discoveries

These were noticed during the audit but fall outside ORCH-0801 scope. Registering for orchestrator triage:

- **`ops.webhook_silence_check_fired` writes to `audit_log` from `stripe-webhook-health-check`** (`stripe-webhook-health-check/index.ts:52`). This is an ops-internal event polluting the user-facing audit log; should write to a separate `system_audit_log` table or be filtered out at read time. Severity P3.
- **`useAuditLog` hard-codes `limit(100)`** without offset/cursor support. After ~100 lifecycle events on a busy brand, older history becomes inaccessible. Severity P2.
- **Audit log RLS banner-vs-policy mismatch:** Banner says "Brand admins see all team actions; team members see their own" but `useAuditLog.ts:5-6` notes RLS is self-only with the admin-can-read-all path "queued for B-cycle." Mismatch is a P2 honesty issue.
- **`brandStripeOrphanedRefundsSection` exists but only renders post-detach** — could surface earlier for partial-fail detach states. P3 polish.
- **`brand-stripe-balances` returns balance with no caching** — every visit hits Stripe API directly. P3 cost optimization.

---

## 10. Confidence Levels

- F-01 (Tax/VAT absent): **HIGH** — grep returned zero matches across all checked patterns
- F-02 (Stripe management gap): **HIGH** on capability inventory; **MEDIUM** on operator UX intent (Q4 above)
- F-03 (Finance reports stub): **HIGH** — code comments and direct read confirm stub data + hardcoded fees + device-local time
- F-04 (ORCH-0796 wiring): **HIGH** — verified by direct read at lines 170-187; partial cleanup status verified via persist file
- F-05 (Audit log slugs): **HIGH** — direct grep produced 28 slug values; UI render path verified
- F-06 (Cover image): **HIGH** — schema + UI + render path all directly verified
- F-07 (STUB_PAST_EVENTS): **HIGH** — directly verified
- F-08 (Empty-bio CTA): **HIGH** — directly verified
- F-09 (Photo edit pencil): **HIGH** — directly verified
- F-10 (Username on tile): **HIGH** — directly verified
- F-11 (phoneCountryIso): **HIGH** — directly verified
- F-12 (useBrand error path): **MEDIUM** — verified but no runtime probe
- F-13 (Bank section silent error): **HIGH** — directly verified
- F-14 (Persist clean): **HIGH**
- F-15 (RLS clean): **HIGH** — verified against ORCH-0734 migration

---

## 11. Fix Strategy (Direction Only — Not Spec)

**Recommended sequencing after this audit:**

1. **Decide on Open Questions §8 first** — particularly Q1-Q3 (tax merchant of record + scope) since ORCH-0804 cannot be specced without them. The orchestrator should pause and surface these to the operator before dispatching any SPEC.
2. **Quick wins first (bundle into ORCH-0801 close-out):** F-07 STUB_PAST_EVENTS removal + F-08 empty-bio CTA wiring + F-10 brand-tile username removal (ORCH-0807). Three single-line fixes; can ship as one commit.
3. **ORCH-0805 cover overhaul** can SPEC independently of operator decisions on tax/stripe (only needs Q6 Android GIF strategy).
4. **ORCH-0806 audit log labels** can SPEC independently (only needs Q7 granularity).
5. **ORCH-0802 Stripe management** SPEC after Q4-Q5 decisions.
6. **ORCH-0803 finance reports** SPEC after Q1-Q3 decisions (tax affects what the report shows).
7. **ORCH-0804 tax** SPEC last, blocked on Q1-Q3.

**Regression prevention requirements (to be carried into SPECs):**

- Constitution #9 strict-grep CI gate: ban new `STUB_*` arrays in `BrandProfileView` / `BrandFinanceReportsView` / `BrandPaymentsView`.
- Constitution #12 strict-grep: ban `new Date().getFullYear()` for period cutoffs in finance code.
- Constitution #3 strict-grep: ban `return null` on `isError` branches in Stripe component files.
- New invariant **I-PROPOSED-BB BRAND_TAX_SETTINGS_HONORED**: every brand-page edit that touches money MUST read `brands.tax_settings` and surface it. Promoted ACTIVE on ORCH-0804 close.
- New invariant **I-PROPOSED-BC AUDIT_LOG_HUMAN_READABLE**: every new `writeAudit` slug MUST be added to the label map in the same commit. CI gate to enforce.

---

**End of investigation report.**
