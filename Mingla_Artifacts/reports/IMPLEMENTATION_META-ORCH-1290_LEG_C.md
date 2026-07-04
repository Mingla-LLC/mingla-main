# IMPLEMENTATION — META-ORCH-1290 LEG C (consumer swipe card + public venue page) [venue authoring: consumer-facing pitch]

**Phase:** IMPLEMENT — Leg C ONLY (client rendering of the pitch). Legs A (backend) + B (business wizard/listing) are separate.
**Worktree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]` @ branch `orch-1290-venue-authoring-one-submission` (rebased on origin/main; one additive rebase conflict in the CI workflow resolved — see §11).
**Binding:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1290_AUTHORING_ONE_SUBMISSION.md` §Leg C (§4.4 + §3 row 1/3 + SC-8/SC-9) + `Mingla_Artifacts/specs/DESIGN_META-ORCH-1290_AUTHORING_UX.md` §5 + §6 (binding for pixels).
**Leg A base:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1290_LEG_A.md` — verified as-built (§2 below).
**Status:** `implemented and verified` — all Leg-C client seams built + self-verified; jest 13/13; fails-on-revert proven at `527a154d5`; tsc zero-new; web export exit 0; all cross-ORCH gates green.

---

## 1. Summary (plain English)

The owner's pitch now shows up where explorers and buyers actually see it. On the consumer swipe deck, a venue's pitch appears as a two-line "one-taste" hook under the name (the full pitch opens in the expanded card). On the public venue page (`/b/{brand}/v/{venue}`), the pitch becomes an "About" section right under the venue name (with a Read more toggle), the page's search/preview description leads with the pitch instead of a mechanical line, and desktop viewers get a two-line pitch in the sticky side panel. A venue with no pitch shows nothing extra anywhere — no fake text.

This is pure CLIENT rendering; Leg A already surfaced the pitch through `discover-cards`, `venue_public_view.pitch`, and both servable RPCs.

---

## 2. Leg A as-built verification (the field names I bound to)

Per the dispatch, I verified the Leg-A response key / view column against the SPEC sketch — they match the SPEC and I used the as-built names:

- **`discover-cards/index.ts`** (as-built): `description: (row.generative_summary ?? '')` (`:909`) and `oneLiner: (row.generative_summary ?? null)` (`:913`) — the FULL pitch text lands in BOTH slots; the app is responsible for clamping the face `oneLiner`. ✓ matches SPEC §4.2.D.
- **`venue_public_view`** (M1, as-built): `pp.generative_summary AS pitch` — the public view column is **`pitch`**. ✓ matches SPEC §4.1 M1.
- **`deckService.ts`** (as-built): already maps `description: card.description` (`:213`), `fullDescription: card.description` (`:224`), `oneLiner: card.oneLiner || null` (`:248`) straight through — so per SPEC §4.4 "no mapper change is strictly required." **deckService NOT changed** (allowlist item was "map ONLY if the card type doesn't already carry it" — it does).

---

## 3. SPEC success-criteria coverage (Leg C rows)

| SC | What | Verified | Commit |
|----|------|----------|--------|
| **SC-8-Web** (public page pitch + meta) | `venue_public_view.pitch` → `PublicVenue.pitch`; About section renders the pitch body; meta = pitch (≤155) with mechanical fallback; pending/rejected still absent (verified-only view unchanged) | ✓ mapper behavioral test (populated/null/whitespace) + page source seams (about/meta/fallback); anon-safe gate green | `527a154d5` |
| **SC-9-iOS / SC-9-Android** (card pitch) | servable venue's pitch renders on the swipe face as a 2-line `oneLiner`; full pitch in the expanded modal `description`; empty pitch → name-only (no blank artifact) | ✓ card source seams (numberOfLines={2}, scoped title tighten, honest-empty guard) + expanded-modal/CardInfoSection passthrough; shared RN → iOS+Android parity automatic | `527a154d5` |

SC-1/2/3/4/5/6/7/10/11 are Leg A/B (backend + business app) — out of Leg C scope.

---

## 4. Files changed (4 files, +384 / −8)

| File | Δ | Note |
|------|---|------|
| `app-mobile/src/components/SwipeableCards.tsx` | +21/−2 (26 ±) | place-card face: `oneLiner` 2-line clamp + scoped title tighten + `cardTitleWithBlurb` style + `oneLiner` margins |
| `mingla-business/src/services/publicEventsService.ts` | +11 | `pitch` on `VenuePublicViewRow` + `PublicVenue` + mapper (`asStringOrNull(row.pitch)`) |
| `mingla-business/src/components/venue/PublicVenuePage.tsx` | +88/−6 (94 ±) | About section (4-line clamp + Read more), pitch-first meta (≤155), desktop 2-line clamp, `clampPitchForMeta` helper, expand state + styles |
| `mingla-business/__tests__/metaOrch1290LegC.happy.test.ts` | +253 (NEW) | 13 regression tests (mapper behavioral + both-surface source seams) |

NOT changed (verified already-wired): `app-mobile/src/services/deckService.ts`, `ExpandedCardModal.tsx`, `expandedCard/CardInfoSection.tsx` — the pitch already flows through `description`/`oneLiner`, and the expanded modal already renders `{description && …}` (honest empty). No new component, no new layout (per SPEC §4.4).

---

## 5. Data-model changes
None. Leg A owns all migrations. The public resolve query uses `.select("*")`, so `pitch` arrives without a query change; I only typed + mapped it.

## 6. Edge functions touched
None (Leg A owns `discover-cards` + RPCs + view).

---

## 7. Regression tests added (append-only) + fails-on-revert

**`mingla-business/__tests__/metaOrch1290LegC.happy.test.ts`** — 13 tests, all PASS (run: `cd mingla-business && npx jest metaOrch1290LegC --runInBand` → `Tests: 13 passed`). Modelled on `metaOrch1255LegC.happy.test.ts` (mocked `supabase` + virtual `@mingla/offering-rendering`; PublicVenuePage/SwipeableCards carry heavy native/themed deps the default node/ts-jest config cannot mount — no RTL installed here, so render seams are asserted structurally, exactly as the 1255 Leg C precedent reads app-mobile source as text). Coverage: service mapper (pitch populated / null / whitespace-null); public page (About honest-empty gate, 4-line clamp + working Read-more toggle, block ordering under identity/before map, pitch-first meta ≤155 + fallback, desktop 2-line clamp); consumer card (deckService passthrough, 2-line clamp, scoped title tighten, expanded-modal full-pitch passthrough).

**fails-on-revert verified at `527a154d5`** (TRUE line reverts, each restored):
- Delete the mapper line `pitch: asStringOrNull(row.pitch)` → **suite fails to compile** (the `PublicVenue.pitch` type contract is load-bearing) — service half revert-protected at the type level.
- Revert the card `numberOfLines={2}` → `{1}` → test **"place card blurb = the pitch clamped to 2 lines" FAILS**.
- Revert `metaDescription` to the mechanical-only line → test **"meta description is pitch-first…" FAILS**.
- All three restored → `Tests: 13 passed, 13 total`; working tree clean.

Append-only: NEW file only; no existing test modified (`git diff origin/main...HEAD` test-file list shows only this new file among my changes).

---

## 8. Old → New receipts

### app-mobile/src/components/SwipeableCards.tsx
**Before:** the place-card face rendered `oneLiner` (always `null` for places) at `numberOfLines={1}`; title `marginBottom: 16` fixed; `oneLiner` margins `marginTop 4 / marginBottom 8`.
**Now:** the place pitch (from `discover-cards` `oneLiner`) renders as a **2-line** clamp; when a blurb is present the title tightens to `marginBottom 6` via a scoped `[styles.cardTitle, currentRec.oneLiner ? styles.cardTitleWithBlurb : null]` array (the behind-card title, shared style, is untouched); `oneLiner` margins → `marginTop 0 / marginBottom 10`. Empty pitch → the existing `currentRec.oneLiner &&` guard renders nothing (today's look).
**Why:** SC-9 / DESIGN §5a — one-taste hook, +56pt inside the existing 45% hero gradient, photo never buried.
**Lines:** ~26.

### mingla-business/src/services/publicEventsService.ts
**Before:** `VenuePublicViewRow` + `PublicVenue` + `venuePublicViewRowToPublicVenue` had no pitch.
**Now:** `pitch: string | null` on both types; mapper adds `pitch: asStringOrNull(row.pitch)` (null-normalizes empty/whitespace → honest empty). The `.select("*")` resolve query surfaces the column automatically.
**Why:** SC-8-Web / DESIGN §6 — feed the public page real pitch data.
**Lines:** +11.

### mingla-business/src/components/venue/PublicVenuePage.tsx
**Before:** no About section; `metaDescription` was the fixed mechanical line; desktop panel had no pitch.
**Now:** an `aboutBlock` (themed prose, `numberOfLines={aboutExpanded ? undefined : 4}` + a real `Read more`/`Show less` Pressable wired to `toggleAboutExpanded`) inserted under the identity block, before the map; `metaDescription` is pitch-first via `clampPitchForMeta` (whitespace collapsed, ≤155, ellipsis) with the mechanical fallback preserved (OG/Twitter/Share follow it automatically); the desktop sticky panel gains a 2-line `deskPitch` clamp under the address. Every pitch surface is gated on `hasPitch` (empty → omitted).
**Why:** SC-8-Web / DESIGN §6.1/§6.2/§6.3.
**Lines:** ~94.

---

## 9. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| **Consumer iOS** | YES | Swipe face 2-line pitch blurb + expanded-modal full pitch. **Ships on the next CONSUMER native build** (consumer OTA blocked, COMMS-0047/ORCH-1171) — NOT via `eas update`. |
| **Consumer Android** | YES | Same (shared RN → automatic parity). Text sits on the gradient, no glass, so Android opaque-frost policy is not implicated. |
| **Buyer/anon Web** (public venue page) | YES | About section + pitch-first meta + desktop clamp. Anon-safe unchanged (reads `venue_public_view`, never `venue_listings`, no `useAuth`). **Ships via Vercel `[deploy]`.** |
| Business iOS/Android | NO | Wizard/listing = Leg B. |
| Admin Web | NO | Untouched. |
| Business Web preview | YES (same bundle as public page) | Rides the Vercel `[deploy]` with the public page. |

Parity: card (RPC/edge → `deckService` → SwipeableCards) and public page (view → service → PublicVenuePage) are **separate render paths** — both wired here. iOS↔Android parity is automatic (shared RN in each app).

---

## 10. Smoke result (self-verify gates)

- **jest** (business): `metaOrch1290LegC` → **13 passed / 13**. Existing `metaOrch1255LegC` → 12 passed (its suite green). `publicEventsService.ve4.test.ts` suite-fails on a **pre-existing** `Cannot find module '@mingla/offering-rendering'` (it doesn't mock the workspace pkg; fails identically on origin/main — untouched by me).
- **tsc zero-new:** business `npx tsc --noEmit` → 0 errors in my touched files (baseline 729 unchanged; the mapper is the only `PublicVenue` literal builder, so the new required field breaks nothing). app-mobile `npx tsc --noEmit` → 0 errors in `SwipeableCards` (baseline 837).
- **strict-grep gates (all PASS):** `i-proposed-1290-pitch-consumer-facing` (Leg A, + self-test), `i-proposed-1290-no-business-signal-scores-pre-approve`, `orch-1255-public-venue-anon-safe`, `orch-1255-venue-approval-per-venue-row`, `orch-1255-no-hidden-brand-on-venue-create`, `orch-1263-claim-stage-only-preapprove`, `i-ai-signal-scores-column-sole-owner`, `orch-1218-venue-authoring-no-vendor-leak`, `i-proposed-1232-f-public-paths-ungated`, `i-proposed-orch-0945-dead-end-reason-coverage`, `orch-1147-allin-single-owner`.
- **`npx expo export -p web --clear`** (mingla-business): **exit 0** — `Web Bundled … (2406 modules)`, `Exported: dist` (the public-page bundle builds clean).
- **Runtime (device/sim):** UNVERIFIED here — see §12; the swipe-card face + public-page interaction need the tester's live-fire (SC-9 on the consumer sim; SC-8 on the buyer web page). The clamp/expand wiring is proven structurally + type-safe; no dead tap (the Read-more Pressable is wired to `setAboutExpanded`).

---

## 11. Known issues / deferred + rebase note

- **Rebase conflict (resolved):** rebasing onto origin/main hit ONE additive conflict in `.github/workflows/strict-grep-mingla-business.yml` — origin/main's new `orch-1277-offerings-admin-write` job landed at the same spot as Leg A's `meta-orch-1290-venue-authoring-one-submission` job. Resolved by keeping BOTH jobs (each with its own `runs-on`/`steps`). YAML re-validated (the 1277 + both 1290 gate jobs run). This is a CI-infra file (Leg A's lane), touched only to complete the mandated rebase.
- **Consumer native-build-only:** the swipe-card change reaches phones only on the next CONSUMER native build (COMMS-0047). Noted, not a blocker.
- No `[TRANSITIONAL]` code added.

---

## 12. Operator action required
- **Public page:** ships via **Vercel `[deploy]`** (business web) once merged — no extra step.
- **Consumer card:** rides the **next consumer native build** — NO `eas update` (COMMS-0047). No action beyond the standard build cadence.
- No migrations, no edge deploys from Leg C (Leg A owns those).

## 13. Discoveries for Orchestrator
- **D-C1 (allowlist gap — SwipeableCards.tsx).** The SPEC's Scoped Allowlist lists only `app-mobile/src/services/deckService.ts` for app-mobile, but the binding DESIGN §5a + §10 (declared binding-for-pixels by the SPEC) explicitly require the `numberOfLines={1}→{2}` + scoped title/blurb gap edits in **`app-mobile/src/components/SwipeableCards.tsx`**, and the dispatch orders the swipe-card clamp. deckService needed no change (already passes the pitch through), so the clamp is the ONLY place the 2-line hook can live. I implemented per the binding DESIGN + dispatch and flag the allowlist omission here for the record — it is an oversight in the SPEC allowlist, not a scope widening (SwipeableCards is not on the DO-NOT-TOUCH list).
- **D-C2 (test runner).** The Leg-C card assertions live in the mingla-business jest suite (reading app-mobile source as text) because SwipeableCards can't mount under app-mobile's Deno/node source-text harness and mingla-business has no RTL. This mirrors the 1255 Leg C pattern (which also reads app-mobile source from the business suite). If the orchestrator wants a consumer-side CI home, the file already runs under `mingla-business` `testMatch`.
- **D-C3 (pre-existing).** `publicEventsService.ve4.test.ts` fails to run on the default config (`@mingla/offering-rendering` not resolvable) — pre-existing on origin/main, unrelated to Leg C; noted in the 1255 test's own header.

---

**Downstream:** back to **mingla-orchestrator** for REVIEW → **mingla-tester** (live-fire SC-9 on the consumer sim swipe face + SC-8 on the buyer web public page; verify honest-empty on a pitch-less venue). Orchestrator owns: Vercel `[deploy]`, the consumer native-build cadence, and CLOSE (Leg A/B/C together).

**Working tree:** `~/Desktop/mingla-orchs/orch-1290-[venue-authoring-one-submission]/` on branch `orch-1290-venue-authoring-one-submission`.
