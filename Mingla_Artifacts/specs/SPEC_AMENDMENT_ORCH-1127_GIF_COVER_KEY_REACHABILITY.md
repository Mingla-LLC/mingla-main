# SPEC AMENDMENT — ORCH-1127 (ex-1116) [Cover picker GIF tab "This source is taking a break"]

**Skill:** mingla-forensics · **Phase:** INVESTIGATE(confirm) → SPEC(correct) · **Date:** 2026-06-12
**Amends / partially supersedes:** `SPEC_ORCH-1116_GIF_COVER_PICKER.md` (2026-06-11).
**Working tree:** `~/Desktop/mingla-orchs/ORCH-1116-[gif-cover-key]/` on branch `ORCH-1116-gif-cover-key` (renumber to **ORCH-1127** pending at CLOSE; ID collides with `SPEC_ORCH-1116_BOOKING_GATE_RLS.md`).
**Comms:** acknowledges + factors in **COMMS-0028** (WARN, ALL) — this amendment is the forensic confirmation that COMMS-0028's deeper finding is correct.

---

## A0. Why this amendment exists (one paragraph)

The shipped ORCH-1116 fix (provision the GIPHY key in EAS dev/preview + Vercel, add a config-eval fail-loud guard, add telemetry + a strict-grep gate) is **necessary but INSUFFICIENT**. After provisioning the key the orchestrator tried to serve a dev-channel OTA and found the GIF tab STILL broken: the key value is **absent from the actual app bundle**. The original SPEC's core technical premise — §4.B line 91 and §11 DO-NOT-TOUCH line 201, which assert *"the services already read `process.env.EXPO_PUBLIC_*` directly (which EAS inlines)"* and therefore mark the two GIPHY services as DO-NOT-TOUCH — is **factually wrong**. The services read the key **dynamically** (`process.env[name]` with a variable key), which `babel-preset-expo` does **not** inline, so in any Hermes standalone / OTA / production build the value is `undefined` regardless of how the env is provisioned. This amendment records the corrected root cause with live evidence and specifies the actual code fix (read from `Constants.expoConfig.extra` first, mirroring `supabase.ts`), while keeping everything the original SPEC got right (the build-time guard, the `.env.example` doc, the telemetry, the strict-grep gate).

---

## A1. Corrected root cause (CONFIRMED — live evidence, supersedes the "missing env var alone" framing)

### A1.1 What the original SPEC concluded (now superseded)
> §1: *"the public GIPHY key is provisioned in the EAS `production` environment ONLY … dev/preview builds and local Metro have no key."*
> §4.B line 91: *"the services already read `process.env.EXPO_PUBLIC_*` directly (which EAS inlines), so the guard's PRIMARY job is to FAIL THE BUILD, not to plumb the value."*
> §11 line 201: *"DO-NOT-TOUCH: `coverProviderBrowseService.ts` / `giphyEventCoverService.ts` … (correct as-is)."*

The "key absent from dev/preview" sub-fact is TRUE and the provisioning step was correct. The premise that the services would then pick the key up — i.e. that `process.env.EXPO_PUBLIC_*` is inlined into these services — is FALSE. That is the gap that left the bug live after provisioning.

### A1.2 The deeper root cause (CONFIRMED)

**F-CORRECT-1 — the GIPHY services read the key via DYNAMIC `process.env` access, which is never inlined.**
- **Symptom:** GIF tab shows "This source is taking a break." on every non-Metro build even with the key provisioned in EAS dev env + local `.env` + shell env.
- **Layer:** code (bundler/transform) + runtime.
- **Probe / Evidence (file:line, verbatim):**
  - `mingla-business/src/services/giphyEventCoverService.ts:29-40` and `mingla-business/src/services/coverProviderBrowseService.ts:56-67` — identical reader:
    ```ts
    const envValue = (name: string): string | null => {
      const maybeProcess = globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      };
      const value = maybeProcess.process?.env?.[name];   // DYNAMIC bracket access
      ...
    };
    const publicGiphyKey = (): string | null =>
      envValue("EXPO_PUBLIC_GIPHY_API_KEY") ?? envValue("EXPO_PUBLIC_GIPHY_KEY");
    ```
  - `grep -rn "Constants" giphyEventCoverService.ts coverProviderBrowseService.ts` → **0 matches** (exit 1). Neither service imports `expo-constants` or reads `Constants.expoConfig.extra`.
- **Mechanism:** `babel-preset-expo` only inlines **static** `process.env.EXPO_PUBLIC_X` member expressions. A dynamic `process.env[name]` / `globalThis.process?.env?.[name]` (variable key) is left as a runtime lookup. A Hermes standalone bundle has no populated `process.env` object → resolves `undefined` → `publicGiphyKey()` returns `null` → both paths fail-close to `not_configured` → friendly copy.
- **Severity:** **CONFIRMED ROOT CAUSE**.

**F-CORRECT-2 — babel inlining contrast, PROVEN.**
- **Probe:** transformed a 4-line probe with `babel-preset-expo` (`caller: {name:'metro', platform:'ios', isDev:false}`), `EXPO_PUBLIC_GIPHY_API_KEY="ZZZSENTINEL…"` in env.
- **Evidence (verbatim transform output):**
  - `const a = process.env.EXPO_PUBLIC_GIPHY_API_KEY;` → `var a="ZZZSENTINEL12345678901234567890Z";` (**inlined**, sentinel count = 1).
  - `process.env[name]` → `var b=process.env[name];` (**NOT inlined**).
  - `globalThis.process?.env?.[name]` → `…globalThis.process…[name]` (**NOT inlined** — the exact service pattern).
- **Mechanism:** confirms only the static member form is replaced at build time; the services use the non-inlinable dynamic form.
- **Severity:** CONFIRMED (supporting F-CORRECT-1).

**F-CORRECT-3 — standalone export grep: key ABSENT; JS bundle content invariant to the var.**
- **Probe:** `npx expo export --platform ios --output-dir /tmp/withkey --clear` with `EXPO_PUBLIC_GIPHY_API_KEY` (32-char value) + `EXPO_PUBLIC_GIPHY_KEY` set in shell env AND present in local `.env`; then `grep -ral "<key>" /tmp/withkey/`.
- **Evidence:**
  - GIPHY key value across the **entire** dist (Hermes `.hbc` + `metadata.json` + all files): **0 matches** (grep exit 1).
  - `JSON.stringify(metadata.json).includes("GIPHY")` → `false`.
  - Re-exported WITHOUT the var → JS bundle **filename identical** (`index-4e144ddc0245e6ce0d0b5588910ec9c2.hbc` in both — Metro's content hash of the JS source is unchanged). (`cmp` shows the two files differ at byte 33 only — the Hermes header's build/source-map hash, NOT the key, which grep proves absent from both. The COMMS-0028 phrase "byte-identical" is slightly imprecise; the load-bearing fact — **the GIPHY env var changes nothing in the JS bundle and the key never lands in the export** — holds.)
- **Mechanism:** the var is genuinely not part of the JS bundle. The original SPEC's "EAS inlines it" assumption is refuted at the bundle layer.
- **Severity:** CONFIRMED ROOT CAUSE.

**F-CORRECT-4 — the CORRECT plumbing path is already provisioned but unread.**
- **Probe:** `npx expo config --json` with the key set; inspect `extra`.
- **Evidence:** `extra.EXPO_PUBLIC_GIPHY_API_KEY present: true` (length 32). The guard IIFE at `app.config.ts:187-225` returns `fromEnv` into `expo.extra` (sibling to `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`). `extra` is baked into the app manifest (`Constants.expoConfig.extra`) at build time — the channel/standalone/OTA-safe path.
- **Mechanism:** the manifest CAN carry the key; the services just never read `extra`. The fix is to make them read it.
- **Severity:** CONFIRMED (this is the fix vector).

**F-CORRECT-5 — why it ever "worked" (and why unit tests missed it).**
- Metro dev injects a live `process.env`, so the dynamic lookup resolves in dev-via-Metro. Seth historically ran Metro dev builds; the 2026-05-25 channel flip (`4c3bdfe8f`) made his dev build run standalone off the keyless `development` channel, exposing it.
- The existing jest test `giphyEventCoverService.test.ts:8-9,20-21,43-44` sets `process.env.EXPO_PUBLIC_GIPHY_API_KEY` and the dynamic reader resolves it because **Node/jest has a populated `process.env`** — the same illusion as Metro. This is exactly why no unit test caught the standalone failure (see A4 regression note).
- **Severity:** CONFIRMED (explains the history; no code impact beyond the regression-test gap).

### A1.3 The established codebase pattern the fix must mirror
- `mingla-business/src/services/supabase.ts:6-19` — `import Constants from "expo-constants"; const extra = Constants.expoConfig?.extra; … extra?.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "<fallback>"`. **STATIC** `process.env.X` member access, `extra` first.
- Same pattern: `src/constants/platformUrl.ts:17-22` (whose comment at line 8 even states the `extra` block is *"baked into"* the bundle/manifest — the correct mental model) and `src/services/stripeModeHandshake.ts`.
- These are 3 sibling precedents; the GIPHY services are the deviation (F-CORRECT-1) and the SUSPECTED-CONTRIBUTOR-by-pattern that became the proven root cause.

---

## A2. Corrected fix decision — **Fix (A): read `Constants.expoConfig.extra` first, mirror `supabase.ts`.**

Both services must be fixed **identically**.

### A2.1 Chosen fix (A)
Replace the `envValue` reader in BOTH `giphyEventCoverService.ts` and `coverProviderBrowseService.ts` with an `extra`-first reader that mirrors `supabase.ts`:
```ts
// illustrative — implementor writes the real code; ≤ shown for the contract
import Constants from "expo-constants";
const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
const envValue = (name: "EXPO_PUBLIC_GIPHY_API_KEY" | "EXPO_PUBLIC_GIPHY_KEY"): string | null => {
  const value = extra?.[name] ?? readStaticProcessEnv(name); // see A2.2
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};
```
- `extra?.[name]` is dynamic, but that is FINE — `extra` is a runtime object actually populated from the manifest at runtime (proven F-CORRECT-4); it does not depend on babel inlining.
- The `process.env` fallback (A2.2) MUST be **static member access** so it still works under Metro dev / web export where `extra` may be absent but `process.env.X` is inlined.

### A2.2 The `process.env` fallback must be STATIC, not dynamic
Because dynamic `process.env[name]` is never inlined (F-CORRECT-2), the fallback cannot keep using the variable-key form. Use explicit static reads, e.g.:
```ts
const readStaticProcessEnv = (name: ...): string | undefined =>
  name === "EXPO_PUBLIC_GIPHY_API_KEY"
    ? process.env.EXPO_PUBLIC_GIPHY_API_KEY        // static → inlined
    : process.env.EXPO_PUBLIC_GIPHY_KEY;           // static → inlined
```
This preserves the existing dual-name fallback (`EXPO_PUBLIC_GIPHY_API_KEY` then `EXPO_PUBLIC_GIPHY_KEY`) AND the Metro-dev / web-export path, while the `extra` read carries standalone/OTA/production.

### A2.3 Why NOT fix (B) (static-only, no `extra`)
Fix (B) (replace the dynamic reads with static `process.env.EXPO_PUBLIC_GIPHY_*` only) would also inline correctly, but:
1. It does NOT use the `extra` plumbing `app.config.ts` already added (wasted, divergent from `supabase.ts`).
2. It requires the key present in the env at **every** export — including every `eas update` OTA — or the inlined value is empty; `extra` is more robust because it is materialized from the resolved `app.config.ts` (which has the env at build time) and carried in the manifest.
3. It diverges from the 3-sibling house pattern (A1.3), re-introducing a maintenance deviation.
Fix (A) subsumes (B)'s correctness (it keeps a static `process.env` fallback) while adding the `extra` path. **Decision: A.** No open question — A is strictly better and matches house convention.

### A2.4 Original SPEC sections that are CORRECT and RETAINED unchanged
- §4.A (provision the key in EAS dev/preview + `.env.example`) — still required (the `extra` path needs the env present at build time to populate `extra`). KEEP.
- §4.B (config-eval fail-loud guard in `app.config.ts`) — KEEP. It already emits the key into `extra` (F-CORRECT-4); only its line-91 comment ("services read process.env directly… EAS inlines it… guard is not a plumbing path") is now WRONG and must be corrected: the guard's emission into `extra` IS the plumbing path the services will read.
- §4.C (telemetry: `reportNonFatal` on `not_configured`) — KEEP.
- §4.D (strict-grep gate) — KEEP, with one addition (A3.4).
- §5 SC-3..SC-7, §6 invariants, §10 open questions — KEEP (SC-1/SC-2 retest criterion is hardened in A3).

---

## A3. Corrected / added acceptance criteria (hard gates)

### A3.1 SC-CORRECT-1 (replaces the implicit "provision = fixed" assumption) — STANDALONE EXPORT carries the key
On a standalone export built with the key provisioned, the key value MUST be reachable to the runtime. Verify by **at least one** of:
- (preferred) Build a `development`/`preview` standalone/dev-client build with the key in the matching EAS env and confirm on-device the GIF tab renders trending GIFs (not the friendly copy); OR
- (bundle-level proof) After the fix, `Constants.expoConfig.extra.EXPO_PUBLIC_GIPHY_API_KEY` resolves to the key at runtime in a standalone build — assert via a runtime log / a temporary `__DEV__`-guarded probe, or via the regression test in A4 simulating empty `process.env`.

### A3.2 SC-CORRECT-2 (HARD — call out the prior tester's mistake) — verify on the RIGHT bundle type
The fix MUST be verified on a **STANDALONE export AND a dev-channel OTA pulled by a real installed build** — **NOT** on the Metro dev bundle. **The prior TEST verdict's runtime-path proof was against a Metro/jest-populated `process.env`, which masks this exact bug** (F-CORRECT-5). A green Metro/jest result is NOT acceptance for this ORCH. The tester must:
1. Run `npx expo export --platform ios` (and android) and confirm the GIF path works against that bundle (or against an installed dev-client/standalone build), and
2. Pull a dev-channel `eas update` into a real installed build and confirm the GIF tab renders.
Source-only / Metro-only verification is capped at "suspected" for this ORCH per Prime Directive 7.

### A3.3 SC-CORRECT-3 — both services fixed identically
Grep proof: after the fix, BOTH `giphyEventCoverService.ts` and `coverProviderBrowseService.ts` import `expo-constants` and read `Constants.expoConfig?.extra` before any `process.env` fallback; neither retains the dynamic `process.env?.[name]` variable-key form as its only/primary read.

### A3.4 SC-CORRECT-4 — strict-grep gate extended
Extend the §4.D gate (or add a sibling rule) to assert the services read `Constants.expoConfig.extra` and do NOT regress to dynamic-only `process.env[<var>]` access for the GIPHY key. Fails-on-revert: removing the `extra` read (reverting to the dynamic-only reader) FAILS the gate.

---

## A4. Regression-test contract (corrected — the load-bearing addition)

**The prior tests do not catch this class of bug** because Node/jest and Metro both populate `process.env` (F-CORRECT-5). Add a test that simulates the STANDALONE condition:

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-CORRECT-1 | Standalone simulation: empty `process.env`, key only in `extra` | mock `expo-constants` so `Constants.expoConfig.extra.EXPO_PUBLIC_GIPHY_API_KEY = "k"`; delete `process.env.EXPO_PUBLIC_GIPHY_*` | `publicGiphyKey()` (both services) resolves `"k"` (NOT null); `searchGiphyEventCovers`/`trendingGiphyCovers` do NOT throw `not_configured` | code |
| T-CORRECT-2 (fails-on-revert) | Same input, reader reverted to dynamic-only `process.env[name]` | as above | reader returns null → `not_configured` thrown → **test FAILS** (proves the fix is load-bearing) | code |
| T-CORRECT-3 | Metro/dev path still works | key only in `process.env.EXPO_PUBLIC_GIPHY_API_KEY` (static), `extra` empty | reader resolves the key (static `process.env` fallback intact) | code |
| T-CORRECT-4 | dual-name fallback preserved | only `EXPO_PUBLIC_GIPHY_KEY` set (in `extra` or static env) | reader resolves it | code |

**Fails-on-revert contract:** T-CORRECT-2 MUST FAIL when the `extra`-first read is reverted to the dynamic-only `globalThis.process?.env?.[name]` reader, and PASS when restored. This is the structural safeguard against re-introducing the non-inlinable dynamic read.

**Protective comment to carry in both services:**
`// ORCH-1127: read the GIPHY key from Constants.expoConfig.extra FIRST (mirror supabase.ts). Dynamic process.env[name] is NOT inlined by babel-preset-expo and is undefined in Hermes standalone/OTA builds — extra is the manifest-backed, build-safe path. Do NOT revert to process.env[<var>].`

---

## A5. Corrected allowlist / DO-NOT-TOUCH (overrides original §11)

**ADDED to the allowlist (the original §11 wrongly excluded these):**
- `mingla-business/src/services/giphyEventCoverService.ts` — env reader only (A2).
- `mingla-business/src/services/coverProviderBrowseService.ts` — env reader only (A2).
- A regression test file for T-CORRECT-1..4 (e.g. extend `giphyEventCoverService.test.ts` + `coverProviderBrowseService.test.ts`, or a new focused test).
- `mingla-business/app.config.ts` — **comment-only** correction of the now-wrong lines 184-186/91 ("services read process.env directly… not a plumbing path"); the guard LOGIC stays.

**Still allowlisted (from original §11, retained):** `.env.example`, `app.config.ts` guard block, `CoverPicker.tsx` telemetry call-site, the strict-grep gate (+ A3.4 extension).

**DO-NOT-TOUCH (corrected — REMOVE the two GIPHY services from the original DO-NOT-TOUCH list; their network/normalization/clamping/fail-close LOGIC is still untouchable, only the env reader changes):**
- GIPHY services' network/normalization/clamping/fail-close guards (UNCHANGED — only `envValue`/`publicGiphyKey` change).
- `eas.json` values, the Pexels edge path, the Stripe `pk_live` guard, consumer/admin/buyer-web files, the friendly UI copy / error-state layout.

**Stop-and-amend** before touching anything outside this corrected allowlist.

---

## A6. Downstream routing

**Next handoff:** mingla-implementor (business side) — apply Fix (A) to both services (A2), add the comment-correction in `app.config.ts`, add the T-CORRECT regression tests (A4) + the §4.D gate extension (A3.4). Then mingla-tester verifies under SC-CORRECT-1..4 — **explicitly NOT on the Metro bundle** (A3.2): a standalone export grep/runtime + a dev-channel OTA on a real build. Then orchestrator REVIEW → CLOSE (flip the three DRAFT invariants from the original §6 ACTIVE; optionally add an I-PROPOSED for the extra-first read).

**Open question for Seth (single):** none blocking — Fix (A) is the clear choice. FYI only: the renumber to ORCH-1127 should happen at CLOSE (the 1116 ID already carries `SPEC_ORCH-1116_BOOKING_GATE_RLS.md`); keep the worktree path/branch as-is until then.
