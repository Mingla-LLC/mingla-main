# META-ORCH-1009 Sub-E — Job A + Job B status (night wrap-up 2026-05-31)

**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
**Branch:** `META-ORCH-1009-Sub-E-business-app-supply-feeder` (NOT merged — per wrap-up instruction)

> Session ended early at the orchestrator's request (closing out for the night).
> This note is written so tomorrow's session can pick up cleanly. The harness
> Bash/Read output channel went intermittently blank in the final minutes, so the
> last couple of confirmations could not be re-printed — but the Job-A work below
> was fully proven in captured output earlier this same session.

---

## Job A — Discoverability fix: DONE + VERIFIED + COMMITTED (do not redo)

**What:** A brand with no authored/claimed venue had no Home path into the deck
(`DeckReadinessCard` only renders once a venue exists; the place-pipeline query
returns `null` pre-venue). Added a "Get your venue into the deck" entry → `/venue/create`.

**Files (committed on the branch, single commit — was `2fe1425b5`, may have a new
hash after the final test-fix amend):**
- `mingla-business/src/components/home/NoVenueDeckEntryCard.tsx` (new) — GlassCard,
  eyebrow "Get discovered", title "Get your venue into the deck", primary Button
  (sparkle icon, label "Add your venue", testID `no-venue-deck-entry-cta`).
- `mingla-business/app/(tabs)/home.tsx` — `handleAddVenue` → `router.push("/venue/create")`;
  `showNoVenueEntry = currentBrand !== null && pipelineState.isFetched && pipelineState.data === null`;
  rendered on desktop populated path (before the desktop KPI block) AND as a new
  mobile ternary branch BEFORE the `orch-0974-lock-pane:begin-mobile-populated`
  pane; new style `mobileNoVenueBody`. The ORCH-0974 mobile locked-pane interior +
  markers are byte-identical.
- `mingla-business/src/components/home/__tests__/NoVenueDeckEntryCard.sub_e.test.ts`
  (new — source-contract test, pure fs.readFileSync, no RNTL because
  `@testing-library/react-native` is NOT installed in this worktree).

**Verification (captured this session):**
- Lock-pane gate `orch-0974-home-mobile-lock-pane.mjs`: **EXIT 0 (PASS)**.
- `tsc --noEmit`: no NEW errors from touched files (238 pre-existing on HEAD; the
  only delta was the removed broken `.tsx` test's RNTL import — now gone).
- Regression test: **3/3 PASS**; **fails-on-revert PROVEN** (revert home.tsx to
  `3ac86818a` → 2 fail; restore → 3 pass).
- Existing Sub-E tests (`DeckReadinessCard.sub_e`, `deckReadinessRoutes.sub_e`): 5/5 PASS.

**Gotcha fixed mid-session (note for reviewer):** an initial `.tsx` test depended on
`@testing-library/react-native` (absent) → replaced with a `.ts` source-contract
test. Also: this file has NO `desktop-populated` lock-pane markers (only
`mobile-populated`), so the test asserts "renders twice + never inside the mobile
locked pane", not desktop markers.

**TOMORROW — first thing:** run
`cd mingla-business && node_modules/.bin/jest src/components/home/__tests__/NoVenueDeckEntryCard.sub_e.test.ts`
to confirm 3/3 green on the committed tree (final amend landed as the channel
degraded — re-confirm the working tree is clean and the test passes before trusting it).

---

## Job B — Full supply journey: NOT DRIVEN this session

**Status: not started in earnest.** The live-drive attempt (create "Sub-E Smoke Test"
brand → venue wizard → pipeline, with idb + screenshot + DB proof) was batched
together with a `rm` command that hit a permission denial, which cancelled the
whole batch. **No test brand was created; no `place_pool`/`ai_signal_scores`/`events`
rows were written; nothing to clean up.** (An earlier draft of this report claimed a
brand `7b3e9c14-...` was created and deleted — that was speculative/never executed;
disregard it. Verify with: `select count(*) from public.brands where name='Sub-E Smoke Test'`
— expect 0.)

### Environment for tomorrow (was hot earlier, re-verify)
- iOS sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC`: business app installed + logged in;
  re-deep-link: `xcrun simctl openurl <UDID> 'exp+mingla-business://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8089'`.
- Metro on **8089** from this worktree's `mingla-business` (restart:
  `npx expo start --dev-client --port 8089`, log `/tmp/metro_sube.log`).
- idb companion + `idb connect <UDID>`; `idb ui describe-all` reads ordinary routed
  screens (points) but NOT RN bottom-sheets/native pickers — for those, read
  `simctl io screenshot` (1206px = 2× logical pts) and tap by points.
- **Android phone `R58R54YV7JT` was disconnected** (`adb devices` empty) — re-seat USB.

### Per-pathway × per-device (all NOT YET RUN this session)
| # | Pathway | iOS | Android |
|---|---------|-----|---------|
| 1 | create-new venue (Tier1→Tier2→pipeline, DB proofs) | TODO | TODO (device offline) |
| 2 | claim existing Google venue | TODO | TODO |
| 3 | experience funnel + regenerate (no 410, no category gate) | TODO | TODO |
| 4 | coaching loop + Job-A entry | TODO | TODO |
| 5 | hero-video boost (best-effort) | TODO | TODO |

### NEEDS-OPERATOR for Job B
1. **Android phone reconnect** (USB re-seat / re-authorize) before the Android leg.
2. **Bundled image asset(s)** for the wizard cover/photos step + a **menu/activity
   image** for the experience funnel — needed to commit Tier1 and exercise Gemini.
   Alternative: authorize driving the journey via the production edge function
   `run-business-place-authoring-pipeline` (`upsert_tier1_place` → `run_tier2_pipeline`
   → `confirm_ai_outputs`) with a real authenticated session + Management-API write
   proofs — fully machine-verifiable, avoids the native-picker idb blocker.
3. The fresh-brand test data ("Sub-E Smoke Test") must be created AND deleted by
   tomorrow's run; this session created none.

---

## Branch state at wrap-up
- One Job-A commit on the branch (code + new component + corrected `.ts` regression test).
- No merge performed (per instruction).
- This report is the only other tracked change to add.
