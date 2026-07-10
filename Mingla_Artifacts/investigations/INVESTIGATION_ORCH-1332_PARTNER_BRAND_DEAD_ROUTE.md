# INVESTIGATION + SPEC — ORCH-1332 · Partner brand-creation dead route ("Brand not found")

- **ORCH-ID:** ORCH-1332 `[partner-brand-fixes]`
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1332-[partner-brand-fixes]/` on branch `ORCH-1332-partner-brand-fixes` (rebased on origin/main @ `898e403aa`)
- **Skill:** mingla-forensics (INVESTIGATE → SPEC; no product code produced here)
- **Surfaces:** business-iOS + business-Android only (`mingla-business`). NOT consumer/admin/buyer-web.
- **Confidence:** `proven` on the root cause (runtime-observed by Seth's "Brand not found" screenshot + source-deterministic expo-router file routing). One secondary latent race is `suspected` (source-traced, not sim-repro'd).
- **Comms honored:** COMMS-0052 (BLOCK/OPEN, ALL) + COMMS-0063 (WARN/OPEN) — business-app OTA is FROZEN; this pure-JS fix ships via the NEXT business NATIVE build, NOT `eas update`. See §Cross-Surface.

---

## 1. Symptom (expected vs actual)

- **Expected:** On `/partner/brands` (empty state) or `/partner/earnings` ("Ready to start earning?" nudge), tapping "Set up your first partner brand →" opens the brand-creation wizard pre-flagged for a client (partner) setup — landing on step 1 with `mode='client'`, terminating in an "Invite the owner" step that creates a `partner_brand_links` row and emails the owner.
- **Actual:** The tap lands on a **"Brand not found"** screen (Seth's screenshot). Dead route. No wizard, no invite, no `partner_brand_links` row can ever be created from these CTAs.

---

## 2. Investigation manifest (files read verbatim, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `mingla-business/app/partner/brands.tsx` | route/component | CTA #1 (`handleSetUpFirst`) + header-comment route contract |
| 2 | `mingla-business/app/partner/earnings.tsx` | route/component | CTA #2 (`ReadyToEarnNudge`) |
| 3 | `mingla-business/app/brand/[id]/index.tsx` | route | the dynamic segment that swallows `/brand/new` |
| 4 | `mingla-business/src/components/brand/BrandProfileView.tsx` | component | source of the "Brand not found" render |
| 5 | `mingla-business/src/components/brand/BrandCreationFlow.tsx` | component | the flow the CTA must reach; props/param/termination |
| 6 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | component | the ONLY current mount of BrandCreationFlow |
| 7 | `mingla-business/app/event/create.tsx` | route | canonical full-screen creation-flow-as-route pattern |
| 8 | `mingla-business/app/_layout.tsx` | route | how routes are registered (auto file-routing) |
| 9 | `mingla-business/src/services/brandInvitationsService.ts` | service | `inviteBrandMember` → invite edge fn |
| 10 | `supabase/functions/invite-brand-member/index.ts` | edge | `partner_brand_links` insert + Resend email (ORCH-1329) |
| 11 | `mingla-business/src/hooks/usePartnerStripe.ts` | hook | `isPartner` gate caching (race analysis) |
| 12 | `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` | test | harness convention for the regression test |

---

## 3. Q-scorecard

- **Q1. Why does the CTA land on "Brand not found"?** *Verdict:* No `/brand/new` route file exists; expo-router matches the dynamic `[id]` segment with `id="new"`, which resolves to a null brand and renders BrandProfileView's not-found branch. **CONFIRMED (proven).** (F-1)
- **Q2. Was this route ever built?** *Verdict:* No. `brands.tsx`'s own header comment (line 10-11) documents a `/brand/new?partner_mode=client` route "BrandCreationFlow reads partner_mode and lands on step 1 with mode='client'" — specced but never implemented. **CONFIRMED (proven).** (F-1)
- **Q3. Is BrandCreationFlow route-ready?** *Verdict:* Yes. It already reads `partner_mode` from `useLocalSearchParams` (line 255) — it is *designed* to be a route. Its props are minimal (`onComplete`, optional `onCancel`). **CONFIRMED (proven).** (F-3)
- **Q4. Does client-mode actually produce the partner-invite (`partner_brand_links` + email)?** *Verdict:* Yes, but ONLY if the flow reaches step 5. The row + email are created by step 5's `handleInviteOwner` → `inviteBrandMember({ role:'brand_owner', partnerSetup:true })` → the `invite-brand-member` edge fn (Resend email at index.ts:639, `partner_brand_links` insert at index.ts:668-671). **CONFIRMED (proven).** (F-3, F-4)
- **Q5. Can the sheet path (option b) honor `partner_mode=client`?** *Verdict:* No. The sheet mounts BrandCreationFlow with NO route params, so `partnerModeParam` is undefined and a flagged partner lands on step 0 (generic mode picker), not client step 1. Repointing to the sheet would NOT plumb `partner_mode=client` without modifying the flow's public API. **CONFIRMED (proven).** (F-5)
- **Q6. Are both CTAs covered by one route fix?** *Verdict:* Yes — both push the identical string `"/brand/new?partner_mode=client"` (brands.tsx:75, earnings.tsx:301). One route file answers both. **CONFIRMED (proven).** (F-1)
- **Q7. Does `partner_mode=client` land reliably on a cold/auth-warm tap?** *Verdict:* Not guaranteed. The client-mode preset is gated on `isPartner` (`usePartnerStripeStatus`, `enabled: isAuthReady`); if partner status resolves AFTER mount, the promote-effect does NOT re-apply client mode (it requires `partnerModeParam !== "client"`). Latent race. **SUSPECTED CONTRIBUTOR (source-traced).** (F-2)

---

## 4. Findings (six-field evidence)

### F-1 — CONFIRMED ROOT CAUSE: no `/brand/new` route → dynamic `[id]` swallows `new` → "Brand not found"
1. **Symptom:** CTA tap renders "Brand not found" (Seth's screenshot).
2. **Layer:** code / routing.
3. **Probe:** `find app/brand -type f` in the worktree; read `app/brand/[id]/index.tsx`, `BrandProfileView.tsx`; grep the CTA strings.
4. **Evidence:**
   - `app/brand/` contains ONLY the `[id]/` directory — verified: `ls -la app/brand/` → `[id]` only; no `new.tsx`, no `index.tsx`, no `_layout.tsx`.
   - `app/brand/[id]/index.tsx:41-45` — `const params = useLocalSearchParams<{id...}>(); const idParam = ...; const brandId = idParam.length>0 ? idParam : null; const brandQuery = useBrand(brandId);` → with URL `/brand/new`, `idParam === "new"`, so `brandId === "new"`.
   - `useBrand("new")` resolves null → `app/brand/[id]/index.tsx:46` `brand = brandQuery.data ?? null` → passed to `BrandProfileView`.
   - `BrandProfileView.tsx:552-556` — genuine not-found branch: `<Text style={styles.notFoundTitle}>Brand not found</Text>` / "The brand you tried to open doesn't exist or has been removed."
   - CTA sources: `app/partner/brands.tsx:75` `router.push("/brand/new?partner_mode=client" as never)`; `app/partner/earnings.tsx:301` same string. Header contract at `brands.tsx:10-11` promised the route but it was never built.
5. **Mechanism:** No static `/brand/new` route file exists → expo-router falls through to the dynamic `app/brand/[id]` route with `id="new"` → brand lookup returns null → BrandProfileView renders "Brand not found." Both partner CTAs are dead taps.
6. **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — SUSPECTED CONTRIBUTOR: `partner_mode=client` can be dropped if `isPartner` resolves after mount
1. **Symptom:** On a cold/auth-warm tap, the wizard could land in `mode='self'` step 1 (no client path → no step 5 → no invite), silently defeating the partner intent even once the route exists.
2. **Layer:** code (React state/effect race).
3. **Probe:** read `BrandCreationFlow.tsx:248-296`; read `usePartnerStripe.ts:33-50`.
4. **Evidence:**
   - `BrandCreationFlow.tsx:250-251` `const isPartner = partnerStatus.data?.partner_enabled === true;`
   - `BrandCreationFlow.tsx:260-271` initial state: `if (isPartner && partnerModeParam === "client") return { mode:'client', step:1 }` — requires `isPartner` **at mount**; otherwise falls to `BRAND_CREATION_INITIAL_STATE` (`step:1, mode:'self'`).
   - `BrandCreationFlow.tsx:278-296` promote-effect only fires when `partnerModeParam !== "client"` (line 285) — so a late `isPartner` **does not** re-apply client mode when the param IS `"client"`.
   - `usePartnerStripe.ts:38-49` `enabled: isAuthReady`, `staleTime:0`, `refetchOnMount:"always"` → when `isAuthReady` is false at mount, `data` is undefined → `isPartner === false`.
5. **Mechanism:** If partner status is not yet cached/ready at mount (cold start, direct deep-link, first auth-warm), `isPartner` is false → client preset skipped → the promote-effect will not recover it → the flow stays self-mode → the partner never reaches the invite step. In the warm/common case (tap from a `/partner/*` screen with React Query cache warm) `isPartner` is true at mount and the preset applies correctly.
6. **Severity:** SUSPECTED CONTRIBUTOR. In-scope because the mandate requires `partner_mode=client` to plumb **end-to-end**; this hardening is pure flow logic (not visual), so it stays inside ORCH-1332's navigation/flow charter.

### F-3 — BrandCreationFlow prop + termination trace (reference, not a defect)
- **Props** (`BrandCreationFlow.tsx:64-67`): `interface BrandCreationFlowProps { onComplete: (newBrandId: string) => void; onCancel?: () => void; }`.
- **`onComplete`** is fired at BOTH terminal paths: self-mode offering-select (`:456` `onComplete(brand.id); router.push(routeForOffering(offering))`) and client-mode invite success (`:498` `onComplete(brand.id)` with NO further nav inside the flow).
- **`onCancel`** is fired by the header close/back button only at entry (`:539` `if (isAtEntry) onCancel?.()`; `isAtEntry = step===0 || (step===1 && !isPartner)`, `:532`).
- **partner_mode consumption:** `useLocalSearchParams` (`:255`) → `partnerModeParam` → gated by `isPartner` into `mode:'client', step:1` (`:264`). Brand row is inserted at step 1 with `partnerSetup: state.mode === 'client'` (`:359`).
- **Client termination:** step 5 `handleInviteOwner` (`:470-511`) → `inviteBrandMember({ brandId, inviteeEmail, inviteeName, role:"brand_owner", personalNote, partnerSetup:true })` (`:479-488`) → success toast (`:492`) + `onComplete(brand.id)` (`:498`); error → `setToast(inviteErrorToast)` (`:501`). **No silent failures** — creation/invite errors surface via the inline error + Retry (steps 1/2, `:376-383`,`:436-443`) or the error Toast (step 5). Satisfies the no-silent-failure invariant.

### F-4 — CONFIRMED: partner-invite (`partner_brand_links` + email) is produced only via step 5 (ORCH-1329 path)
1. **Symptom:** n/a (chain confirmation).
2. **Layer:** service + edge.
3. **Probe:** read `brandInvitationsService.ts:133-164`; grep `invite-brand-member/index.ts`.
4. **Evidence:**
   - `brandInvitationsService.ts:141-151` forwards `partner_setup:true` to the `invite-brand-member` edge fn.
   - `invite-brand-member/index.ts:639` sends the Resend invite email (the ORCH-1329 "Get the Mingla Business app" partner-invite email) BEFORE the link insert.
   - `invite-brand-member/index.ts:668-671` inserts `partner_brand_links` **only** `if (effectivePartnerSetup && payload.role === "brand_owner")` — exactly the args step 5 sends.
5. **Mechanism:** The row `/partner/brands` lists (and the invite email) exist ONLY after the flow reaches step 5 and the partner completes the invite. Therefore the fix must guarantee the flow enters client mode (step 5 is unreachable in self-mode). This is why F-2 matters and why the sheet path (F-5) is rejected.
6. **Severity:** CONFIRMED (supporting).

### F-5 — CONFIRMED: the sheet mount cannot honor `partner_mode` (kills option b)
1. **Symptom:** n/a (design decision evidence).
2. **Layer:** code.
3. **Probe:** read `BrandSwitcherSheet.tsx:78-88`.
4. **Evidence:** `BrandSwitcherSheet.tsx:80-87` mounts `<BrandCreationFlow onComplete={() => onClose()} onCancel={...} />` inside a `TopSheet` — no route, no `partner_mode` param. BrandCreationFlow reads `partner_mode` ONLY from `useLocalSearchParams`; a sheet mount provides none, so a flagged partner lands on step 0 (generic mode picker), never pre-flagged client.
5. **Mechanism:** Repointing the CTAs to open this sheet would reach a working flow but would NOT plumb `partner_mode=client` — the partner would have to manually pick "I'm setting it up for a client." That fails the mandate's "correctly plumbs partner_mode=client end-to-end." Making it work would require adding an `initialPartnerMode` prop and threading it (new public API on shared code) — strictly more change than option (a).
6. **Severity:** CONFIRMED (rejects option b).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| Docs | `brands.tsx:10-11` header promises `/brand/new?partner_mode=client` mounting BrandCreationFlow in client mode. | **YES** — doc describes a route that does not exist. |
| Schema | `partner_brand_links` (partial-unique on `cancelled_at IS NULL`) + `brands.partner_setup` exist and are wired to the invite edge fn. | No — backend is complete. |
| Code | No `/brand/new` file; dynamic `[id]` swallows `new`; BrandCreationFlow already reads the param. | **YES** — code is missing the route the doc + CTAs assume. |
| Runtime | Seth's screenshot: "Brand not found". | Matches the code gap. |
| Data | A brand with id `"new"` never exists → `useBrand("new")` null. | Consistent. |

The gap between Docs/CTAs (assume the route) and Code (no route file) **is** the bug.

---

## 6. Repro evidence

- **Runtime observed:** Seth's "Brand not found" screenshot (dispatch), matching `BrandProfileView.tsx:553`.
- **Source-deterministic mechanism:** expo-router static-vs-dynamic file routing is not probabilistic; with no `app/brand/new.tsx`, `/brand/new` deterministically resolves to `app/brand/[id]` with `id="new"`. No fresh sim run was performed this session: (a) the mechanism is a missing-file routing fact, not a runtime hypothesis, and (b) the business app is OTA-frozen (COMMS-0052/0063) so a device repro requires a full EAS cloud dev build, which adds nothing over the already-observed screenshot + deterministic routing. **Tester must still runtime-verify the FIX** on a business dev build (see §11).

---

## 7. Chosen fix shape + rejected alternative

### CHOSEN — Option (a): create `mingla-business/app/brand/new.tsx` that mounts BrandCreationFlow honoring `partner_mode=client`
Justification against the three mandated criteria:
1. **Least duplication:** BrandCreationFlow already reads `partner_mode` via `useLocalSearchParams` (`:255`) and already implements the entire client path (steps 0/1→5, invite). The route file is a thin ~30-line wrapper (SafeArea + `onComplete`/`onCancel` nav) that mounts the existing component. Zero logic duplication.
2. **Matches how creation flows are launched elsewhere:** `app/event/create.tsx` is the canonical precedent — a flat full-screen creation-flow route file (not a sheet). `app/_layout.tsx:779` uses `<Stack screenOptions={{ headerShown:false }} />` (auto file-routing, no explicit screen allowlist), so a new file route auto-registers with no header — the flow renders its own header (`BrandCreationFlow.tsx:536-549`).
3. **Correctly plumbs `partner_mode=client` end-to-end:** the route's URL param flows straight into the component's existing `useLocalSearchParams` read → client mode → step 5 → `inviteBrandMember(partner_setup:true, role:'brand_owner')` → `partner_brand_links` + email (F-4). The F-2 hardening closes the cold-start race so this is robust, not just warm-path.

### REJECTED — Option (b): repoint both CTAs to open the existing sheet/flow in partner mode
Loses because (F-5): the sheet mounts BrandCreationFlow with no route params, so `partner_mode=client` is structurally unreachable through it. Making it honor client mode would require a NEW `initialPartnerMode` prop on the shared component + threading through `BrandSwitcherSheet` — strictly MORE change than option (a), it modifies shared code with a new public API, and it diverges from the established route-based creation-flow pattern (`event/create`). It also does not match the documented contract the CTAs already encode (`/brand/new?partner_mode=client`).

---

## 8. Executive summary (build contract)

Add one route file, `mingla-business/app/brand/new.tsx`, that mounts the existing `BrandCreationFlow` full-screen and honors the `partner_mode=client` query param the two partner CTAs already send. Add one tightly-scoped hardening to `BrandCreationFlow` so `partner_mode=client` still lands client mode if partner status resolves after mount. No visual/layout work on `brands.tsx`/`earnings.tsx` (owned by ORCH-1333). Pure-JS; ships on the next business native build (OTA frozen).

## 9. Scope & non-goals

**In scope:**
- Create `mingla-business/app/brand/new.tsx` (new file) mounting `BrandCreationFlow` with route-context `onComplete`/`onCancel`.
- Harden `BrandCreationFlow.tsx`'s partner-mode preset so `partner_mode=client` reliably lands client mode across the auth-warm race (F-2).
- One append-only regression test file.

**Non-goals (DO NOT TOUCH):**
- Any restyle/relayout/close-button change to `app/partner/brands.tsx` or `app/partner/earnings.tsx` — **ORCH-1333 (designer) owns those two pages' visual redesign.** ORCH-1332 changes ZERO lines in those two files (the CTA strings already point at `/brand/new?partner_mode=client`; leave them exactly as-is).
- No change to `BrandSwitcherSheet.tsx`, the invite edge fn, `partner_brand_links` schema, `usePartnerStripe`, or `BrandProfileView`.
- No change to the copy/steps of BrandCreationFlow other than the F-2 effect condition + initial-state.

**Assumption:** expo-router ranks the static segment `new.tsx` above the dynamic `[id]` directory for `/brand/new` (standard expo-router precedence; verify at runtime per SC-4).

## 10. Layered specification — exact files + functions

### 10.1 NEW FILE — `mingla-business/app/brand/new.tsx`
Route component (default export `BrandNewRoute`). Contract:
- Wrap in a top-safe container matching siblings — either `<SafeAreaView edges={["top","bottom"]} style={{flex:1, backgroundColor: canvas.discover}}>` (mirrors `brands.tsx:106`) or `<View style={{flex:1, paddingTop: insets.top, backgroundColor: canvas.discover}}>` (mirrors `event/create.tsx:208`, `brand/[id]/index.tsx:211`). BrandCreationFlow's host already sets `canvas.discover` and renders its own header — do NOT add another header or `<Stack.Screen>` header.
- Mount `<BrandCreationFlow onComplete={handleComplete} onCancel={handleCancel} />`. It reads `partner_mode` itself via `useLocalSearchParams`; the route does NOT need to read or pass the param.
- `handleComplete = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/account" as never); }, [router])`. Mirrors the sheet's `onComplete={() => onClose()}` semantics (pop this route). Client-mode step 5 relies on this to leave the wizard after the invite; self-mode's own `router.push(offeringRoute)` (flow `:457`) runs after and resolves to the offering route with `/brand/new` popped — same net UX as the sheet.
- `handleCancel = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)/account" as never); }, [router])`.
- Imports: `useRouter` (expo-router), `BrandCreationFlow` from `../../src/components/brand/BrandCreationFlow`, `canvas` from `../../src/constants/designSystem`, `SafeAreaView`/`useSafeAreaInsets` from `react-native-safe-area-context`.

### 10.2 CHANGE — `mingla-business/src/components/brand/BrandCreationFlow.tsx` (F-2 hardening, additive)
Make `partner_mode=client` survive a late-arriving `isPartner`. Minimal, additive; do not touch copy/steps/reducer.
- In the promote-effect (`:278-296`): add a sibling branch so that when `isPartner && partnerModeParam === "client" && state.step === 1 && state.mode === "self" && state.name === "" && state.bio === ""`, dispatch `setState(prev => ({ ...prev, mode: "client" }))` (stay on step 1). The existing branch (promote to step 0 when `partnerModeParam !== "client"`) is UNCHANGED. Both branches remain guarded by "user hasn't started typing," so they never override user intent. Illustrative shape only (≤3 lines) — implementor writes the exact code.
- Rationale comment must cite ORCH-1332 + F-2 (late `partner_enabled` must not silently demote the partner-invite intent).

### 10.3 Service / edge / DB
None. `inviteBrandMember` + `invite-brand-member` + `partner_brand_links` are complete and correct (F-4). No migration, no edge deploy.

## 11. Success criteria (per-surface where parity is manual)

- **SC-1 (both surfaces):** `mingla-business/app/brand/new.tsx` exists and its default export renders `BrandCreationFlow` (not `BrandProfileView`).
- **SC-2-iOS / SC-2-Android:** Runtime — on `/partner/brands` empty state, tapping "Set up your first partner brand →" opens the wizard on the client path (title "Create the client's brand" + "🤝 Client setup" chip / or step 0 → client), NOT "Brand not found". Proven on a business dev build per surface.
- **SC-3-iOS / SC-3-Android:** Runtime — same from `/partner/earnings` "Ready to start earning?" nudge (earnings.tsx:301).
- **SC-4:** Runtime — `/brand/new` resolves to the new route (static wins over dynamic `[id]`); the "Brand not found" screen is never shown for `/brand/new`.
- **SC-5:** End-to-end — completing the client path (step 5 invite with a valid owner email) creates exactly one `partner_brand_links` row (`status=awaiting_owner`) and sends the ORCH-1329 partner-invite email; the new row then appears on `/partner/brands`. (Live-fire / DB read.)
- **SC-6:** F-2 — a cold-start/direct open of `/brand/new?partner_mode=client` (partner status not pre-cached) still lands `mode='client'` once `isPartner` resolves; it never sticks in self-mode.
- **SC-7:** No-silent-failure preserved — an invite/create error still surfaces the inline Retry (steps 1/2) or the error Toast (step 5); no dead ends.

## 12. Invariants

- **I-CONSTITUTION rule 1 (no dead taps):** the CTA now reaches a working flow — verified at runtime (SC-2/SC-3/SC-4), not just source-wired.
- **No-silent-failure:** preserved (F-3 / SC-7) — existing inline error + Toast paths unchanged.
- **I-PROPOSED-1332-PARTNER-BRAND-NEW-ROUTE (DRAFT):** `app/brand/new.tsx` MUST exist and mount BrandCreationFlow; both partner CTAs MUST target `/brand/new?partner_mode=client`. Flips ACTIVE on CLOSE (orchestrator owns the flip). The append-only test (§13) is its pin.
- No invariant is violated by adding a static route ahead of the dynamic `[id]`.

## 13. Regression prevention — fails-on-revert contract (Step-0.5)

Add ONE append-only test file, harness = the repo's node/ts-jest source-contract convention (see `__tests__/components/BrandCreationFlow.test.tsx` — even `.test.tsx` files use `readFileSync`, no RN renderer). Proposed path: `mingla-business/__tests__/routes/orch1332PartnerBrandNewRoute.test.ts`. It MUST FAIL when the fix is reverted and PASS when restored (verify + record `// fails-on-revert verified at <sha>`):

1. **Route exists + mounts the flow (load-bearing):** `readFileSync("app/brand/new.tsx")` does not throw AND contains `"BrandCreationFlow"` AND does NOT contain `"BrandProfileView"`. → Deleting the route file (revert) makes `readFileSync` throw → RED.
2. **CTA↔route contract:** `brands.tsx` and `earnings.tsx` both contain `"/brand/new?partner_mode=client"` (documents the binding both sides depend on).
3. **Param plumbed:** `BrandCreationFlow.tsx` contains `useLocalSearchParams` + `partner_mode` + the client preset `mode: "client"`.
4. **F-2 hardening present:** `BrandCreationFlow.tsx` contains the added `partnerModeParam === "client"` re-apply branch (assert the new client-mode reapply condition exists so reverting the hardening goes RED).

**Adversarial angle for the tester (mingla-tester):**
- Confirm static-over-dynamic precedence at runtime — that `/brand/new` truly hits the new file and never flashes "Brand not found" (SC-4). Test with a slow/cold auth-warm.
- Drive the FULL client path on a business dev build (iOS + Android): tap from BOTH `/partner/brands` AND `/partner/earnings`, reach step 5, send an invite to a test email, and assert (a) a `partner_brand_links` row appears with `status=awaiting_owner`, (b) the invite email is sent (Resend/log), (c) the row shows on `/partner/brands`.
- Cold-start deep-link `/brand/new?partner_mode=client` with partner status NOT cached (SC-6) — prove it does not stick in self-mode.
- Back/cancel behavior: from step 1 (client), Back → step 0 mode picker; from step 0/entry, close → returns to the originating partner screen (not a blank stack).
- Negative: invite with an invalid email stays gated; an edge-fn error surfaces the Toast, no dead end (SC-7).

## 14. Cross-Surface Impact Declaration

| # | Surface | Covered | Behavior | Files | Parity |
|---|---------|---------|----------|-------|--------|
| 1 | Consumer iOS | No | n/a | — | Different app (`app-mobile`) |
| 2 | Consumer Android | No | n/a | — | Different app |
| 3 | Buyer/anon Web | No | n/a | — | Not a partner surface |
| 4 | Business iOS | **Yes** | CTA opens client-mode wizard; invite produces `partner_brand_links` + email | `app/brand/new.tsx` (new), `BrandCreationFlow.tsx` | Shared code → automatic with Android |
| 5 | Business Android | **Yes** | Same | Same | Shared code → automatic with iOS |
| 6 | Admin Web | No | n/a | — | Not involved |
| 7 | Business Web preview | Incidental | Route also renders on business web; not the target surface | Same | Shared route |

**Shipping mechanism (COMMS-0052 BLOCK + COMMS-0063):** Business-app OTA (`eas update` on the `mingla-business` production channel) is FROZEN — it empirically bricks the launch (splash hang). This is a pure-JS change but it **MUST NOT** ship via OTA. It rides the **next business NATIVE build** (`eas build` → TestFlight/Play). The dispatch's "OTAs on the business channel" note is superseded by the standing freeze — flag this to the orchestrator at CLOSE.

## 15. Implementation order (allowlist)

1. Create `mingla-business/app/brand/new.tsx` (§10.1).
2. Edit `mingla-business/src/components/brand/BrandCreationFlow.tsx` — F-2 promote-effect branch only (§10.2).
3. Add `mingla-business/__tests__/routes/orch1332PartnerBrandNewRoute.test.ts` (§13); prove fails-on-revert; stamp the sha.

**Allowlist (implementor may change ONLY these):**
- `mingla-business/app/brand/new.tsx` (new)
- `mingla-business/src/components/brand/BrandCreationFlow.tsx` (F-2 branch only)
- `mingla-business/__tests__/routes/orch1332PartnerBrandNewRoute.test.ts` (new)
- This investigation/spec doc.

**DO-NOT-TOUCH:** `app/partner/brands.tsx`, `app/partner/earnings.tsx` (ORCH-1333), `BrandSwitcherSheet.tsx`, `app/brand/[id]/**`, `BrandProfileView.tsx`, `supabase/functions/invite-brand-member/**`, `partner_brand_links` schema, `usePartnerStripe.ts`, `brandInvitationsService.ts`. Stop-and-amend before touching anything outside the allowlist.

## 16. Open questions

- **OQ-1 (non-blocking):** Post-invite success confirmation. In client mode, step 5 sets a success toast INSIDE BrandCreationFlow then calls `onComplete` (which pops the route), so the toast may not render on the destination — identical to the existing sheet behavior (pre-existing, ORCH-1081). Surfacing a success confirmation on `/partner/brands` after return is OUT OF SCOPE here (partner-page UX is ORCH-1333's). Flag for the orchestrator; do not fix in ORCH-1332.
- **OQ-2:** None blocking implementation.

## 17. Downstream routing

NEXT = **mingla-implementor** (build §10/§13 in this worktree). THEN = **mingla-tester** (§11 adversarial, business dev build iOS+Android — request an EAS cloud dev build; OTA is frozen). THEN = **mingla-orchestrator** CLOSE (flip I-PROPOSED-1332 ACTIVE, sync WORLD_MAP, note the OTA-freeze shipping constraint). Worktree: `~/Desktop/mingla-orchs/ORCH-1332-[partner-brand-fixes]/` on branch `ORCH-1332-partner-brand-fixes`.

---

**SPEC-COMPLETE** — root cause CONFIRMED (proven); chosen fix = add `app/brand/new.tsx` mounting BrandCreationFlow + F-2 partner-mode hardening; both CTAs covered; regression test is fails-on-revert; ready for mingla-implementor.
