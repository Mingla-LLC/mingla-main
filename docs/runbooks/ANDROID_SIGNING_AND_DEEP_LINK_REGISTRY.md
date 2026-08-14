# Android Signing & Deep-Link Registry

**Status:** Reference registry + operator pre-release check. No code change resolves a signing mismatch.
**Authoritative source:** Play Console (`Test and release → Setup → App signing`) per app, `npx eas-cli credentials -p android` per app, and Google Cloud project `169132274606` / `mingla-dev` → APIs & Services → Credentials. This file is a WRITTEN-DOWN COPY of those consoles and is only as true as its last update.
**Owner:** Sethogieva, or whoever holds Play Console + Google Cloud admin for `mingla-dev`.
**Estimated time:** 20-30 min for the full pre-release check (Steps 1-5).

---

## Why this runbook exists

In #1038, Mingla Host's Android OAuth client in Google Cloud held the **upload-key** SHA-1 instead of the **Play app-signing** SHA-1. Every organiser who installed Mingla Host from the Play Store got `DEVELOPER_ERROR` on Google sign-in, for an unknown number of months. Every sideloaded EAS build worked perfectly, because sideloads are signed with the upload key that *was* registered — so every internal test passed and only real users failed.

Nothing in this repository could see the discrepancy. There was no file that said which certificate was which, no file that said where each one had to be registered, and the one test that asserted fingerprints compared a hardcoded array against the very JSON file that array had been copied from — and no workflow ever ran it (#1042 F-6).

This file is the artefact whose absence made that invisible. It exists so the next Android app, key rotation, upload-key reset, or branded-domain change starts from fact instead of rediscovery.

---

## Pre-flight

- [ ] Play Console admin access for **both** apps (Mingla Explorer and Mingla Host).
- [ ] Google Cloud access to project **`169132274606` / `mingla-dev`** (NOT `mingla-analytics`).
- [ ] `npx eas-cli` authenticated against the Mingla Expo account.
- [ ] AppsFlyer dashboard access (branded domains `go.usemingla.com` and `biz.usemingla.com` are served from there, not from this repo).
- [ ] Node 20+ available locally, to run `node scripts/probe-android-applinks.mjs`.

---

## 1. Each Android app has THREE signing identities, not two

This is the single most important line in this file. Reasoning about "the signing key" as one thing is what produced #1038, and what produced the eight-week misidentification of `90:28:F8:B1:…` as a "stale key" that #1042 F-2 corrected.

| Identity | Who holds it | What it signs | Where it must be registered |
|---|---|---|---|
| **Play app-signing** | Google, in Play Console | Every binary installed from Play — all tracks, including internal and closed testing | Google Cloud OAuth client (SHA-1) · `assetlinks.json` (SHA-256) · `google-services.json` `certificate_hash` (SHA-1) |
| **EAS upload / release** | EAS, in our Expo account | The AAB we upload to Play, **and** every `preview` / `production`-profile APK we sideload | Google Cloud OAuth client (SHA-1) · `assetlinks.json` (SHA-256) |
| **EAS debug** | EAS, in our Expo account | `development`-profile builds (`:app:assembleDebug` — see each app's `eas.json`) | Google Cloud OAuth client (SHA-1) · `assetlinks.json` (SHA-256) |

A binary is recognised by **exactly one** of these three at a time, decided by how it got onto the device. Registering two of the three and reasoning from the build in front of you is precisely how both #1038 and #1042 F-3 happened.

### 1.1 Mingla Explorer — `com.mingla.app.v2`

| Identity | SHA-1 | SHA-256 |
|---|---|---|
| Play app-signing | `44:10:56:99:EC:81:A9:47:0A:BD:45:58:CD:1F:A9:5E:D7:8B:82:D0` | `06:4E:20:DE:0E:A7:4E:AC:72:9D:D7:68:66:5E:B2:70:56:3E:5B:9C:65:C9:12:B5:AC:E5:D6:A0:84:47:7A:BC` |
| EAS upload / release | `D0:19:42:E6:25:0F:D1:30:D7:67:E3:CC:6A:4D:3B:9E:72:73:43:1F` | `6B:21:64:88:74:B9:3F:A4:7F:19:78:75:88:33:5F:64:C0:1D:21:7B:A9:F0:4E:71:6D:83:29:D0:AE:18:CC:DD` |
| EAS debug | `UNRESOLVED — awaiting OP-2` (#1042) | `90:28:F8:B1:A5:80:79:26:73:AE:DF:DE:00:C3:3D:C1:BC:0A:2A:C6:A3:B2:C0:5B:56:6F:97:67:53:48:0E:02` |

**`90:28:F8:B1:…` IS NOT STALE. DO NOT DELETE IT.** #1042 F-2 proved this from commit `b9be365a4` (2026-04-12, *"fix: use App Signing SHA-1 for Android OAuth (not upload key)"*): that commit swapped `google-services.json`'s `certificate_hash` from `d01942e6250fd130d767e3cc6a4d3b9e7273431f` to `44105699ec81a9470abd4558cd1fa95ed78b82d0` — which are byte-for-byte Explorer's **current** upload-key and app-signing SHA-1s. Both Play certificates have therefore been unchanged since at least 2026-04-12, so **no key rotation and no upload-key reset ever happened** and `90:28:F8:B1:…` cannot be a former upload cert. It is the EAS debug keystore, introduced at ORCH-0964 from an operator readback described in that close note as *"dev + production keystores"*. Deleting it breaks App Links on every `development`-profile dev-client build.

### 1.2 Mingla Host — `com.sethogieva.minglabusiness`

| Identity | SHA-1 | SHA-256 |
|---|---|---|
| Play app-signing | `F6:42:B1:8C:5F:DA:0B:F5:49:02:F2:EA:17:A6:37:A1:72:2C:53:1A` | `F7:5A:A7:54:67:6F:AE:0B:CE:2C:71:9B:A3:C3:8D:AD:96:EB:66:AD:1E:70:C7:9A:B5:AF:C4:3E:D0:A2:2F:6F` |
| EAS upload / release | `A5:DC:F9:60:B9:AD:7B:35:05:D9:3C:A6:2B:7F:55:9C:72:5A:DC:98` | `25:4F:86:64:00:44:5B:7F:EA:88:32:22:72:D1:39:B2:AB:DD:84:A9:58:E2:15:AC:51:F2:4F:F9:CD:F1:67:25` |
| EAS debug | `UNRESOLVED — awaiting OP-2` (#1042 F-5) | `UNRESOLVED — awaiting OP-2` (#1042 F-5) |

Business's Play and upload values are the #1038 operator readback (Play Console, 2026-07-21), quoted verbatim. Business's debug keystore fingerprint is **unknown to this repo**: `mingla-business/eas.json`'s `development` profile builds `:app:assembleDebug`, so those builds are debug-signed by a certificate published nowhere, and their App Links never verify (#1042 F-5). It was deliberately **not guessed** — run `npx eas-cli credentials -p android` in `mingla-business/` (Step 2) and fill this row in the same PR as the `assetlinks.json` addition.

---

## 2. Where each fingerprint must be registered

Three different systems consume these values, in **two different hash algorithms**, with **different cardinality rules**. Mixing them up is the #1038 bug.

| Consumer | Algorithm | Cardinality | Notes |
|---|---|---|---|
| Google Cloud **Android OAuth client** | **SHA-1** | **One package + one SHA-1 per client.** Covering N certificates requires N clients. | This is #1038's correction: the two Business fingerprints cannot share a client. Editing the existing client's SHA-1 trades one broken path for another — always create a second client. |
| `.well-known/assetlinks.json` | **SHA-256** | **N per package**, in one array. Google splits the array into independent statements. | Append-only in this repo — see the invariant below. |
| `google-services.json` `certificate_hash` | **SHA-1** | **One.** | Only `app-mobile/` has this file. `mingla-business` has none and needs none: it configures `@react-native-google-signin` with the **Web** client id only, and Play services matches the caller against any Android client in the same project. |

### 2.1 Google Cloud OAuth clients (project `169132274606` / `mingla-dev`)

| Client name | Client id | Package | SHA-1 it holds | Status |
|---|---|---|---|---|
| `mingla-business Android` | `169132274606-5cmvk27gpgr9dbhu5l2o2hgg4l53fc25` | `com.sethogieva.minglabusiness` | `A5:DC:F9:60:…` (upload key) | Verified #1038. Created 2026-04-13. Leave untouched — sideloaded EAS APK sign-in depends on it. |
| `mingla-business Android (Play app signing)` | `169132274606-phn3bp9b5dhk0kitg1lunlf2nl6ua4v1` | `com.sethogieva.minglabusiness` | `F6:42:B1:8C:…` (Play app-signing) | Created at #1038 as the fix. This is what makes Play-installed organiser sign-in work. |
| `Mingla Android Production` | `…-ibip…` | `com.mingla.app.v2` | `44:10:56:99:…` (Play app-signing) | Verified #1038 — byte-equal to `app-mobile/google-services.json`'s `certificate_hash`. |
| `Android Client Development` | `…-6k0i…` | **UNVERIFIED — OP-1** | **UNVERIFIED — OP-1** | Almost certainly created for ORCH-0428 (*"EAS debug keystore SHA-1 not registered"*, 2026-04-14), so it most likely holds Explorer's **debug** SHA-1. If so, Explorer's **upload** SHA-1 (`D0:19:42:E6:…`) is registered on no client and `preview`/`production` sideloads get `DEVELOPER_ERROR`. One click to confirm — see Step 3. |

### 2.2 App Links hosts

Every host either app declares `autoVerify: true` against. The parity gate reads both `app.json` files and fails if a declared host has no row here — a new App Links host cannot be added without being written down.

<!-- ISSUE-1042-HOSTS-TABLE:BEGIN -->

| Host | Package that declares it | Statement served by | Publishes a statement for that package? |
|---|---|---|---|
| `usemingla.com` | `com.mingla.app.v2` | This repo — `mingla-marketing/public/.well-known/assetlinks.json` (Vercel) | Yes |
| `host.usemingla.com` | `com.mingla.app.v2` | This repo — `mingla-business/public/.well-known/assetlinks.json` (Vercel) | Yes |
| `host.usemingla.com` | `com.sethogieva.minglabusiness` | This repo — `mingla-business/public/.well-known/assetlinks.json` (Vercel) | Yes |
| `go.usemingla.com` | `com.mingla.app.v2` | **AppsFlyer branded domain** — invisible to this repo | Yes |
| `biz.usemingla.com` | `com.sethogieva.minglabusiness` | **AppsFlyer branded domain** — invisible to this repo | Yes |

<!-- ISSUE-1042-HOSTS-TABLE:END -->

`www.usemingla.com` serves the same file as the apex but is declared by no intent filter; the probe checks it for deploy drift only. Per-app branded-domain split (ORCH-1346, completed in-config by #1050): the **Business** app declares `biz.usemingla.com` (which vouches for `com.sethogieva.minglabusiness`) and the **Explorer** app declares `go.usemingla.com` (which vouches for `com.mingla.app.v2`) — one branded domain per template, each declaring only the domain that vouches for it. The `go.` × Business pair that failed #1042 F-4 is gone: the Business binary no longer declares `go.` (ships at the next Business native build; the repo-read probe re-arms at #1050 merge). That asymmetry rule still holds: *"app declares a host that publishes nothing for it"* is a failure; *"host publishes a package no app declares"* is informational.

---

## 3. Where fingerprints are asserted (#1042 F-1 inventory)

**Five repo-resident assertions:**

| # | Path | Package(s) | Asserts |
|---|---|---|---|
| A-1 | `mingla-marketing/public/.well-known/assetlinks.json` | `com.mingla.app.v2` | 3 SHA-256 (app-signing, upload, debug) |
| A-2 | `mingla-business/public/.well-known/assetlinks.json` (entry 1) | `com.sethogieva.minglabusiness` | 2 SHA-256 (upload, app-signing); debug absent — F-5 |
| A-3 | `mingla-business/public/.well-known/assetlinks.json` (entry 2) | `com.mingla.app.v2` | byte-identical to A-1 |
| A-4 | `app-mobile/google-services.json` `certificate_hash` | `com.mingla.app.v2` | 1 SHA-1 (Play app-signing) — verified correct |
| A-5 | `mingla-business/__tests__/assetlinks.consumerAppLinks.test.ts` | both | hardcoded mirror of A-2 + A-3 |

**Five live-served assertions** — the last two have **no repo representation at all**:

| # | URL | Repo-backed? |
|---|---|---|
| S-1 | `https://usemingla.com/.well-known/assetlinks.json` | Yes — A-1 |
| S-2 | `https://www.usemingla.com/.well-known/assetlinks.json` | Yes — A-1 |
| S-3 | `https://host.usemingla.com/.well-known/assetlinks.json` | Yes — A-2 + A-3 |
| S-4 | `https://go.usemingla.com/.well-known/assetlinks.json` | **No — AppsFlyer dashboard** |
| S-5 | `https://biz.usemingla.com/.well-known/assetlinks.json` | **No — AppsFlyer dashboard** |

Neither `apple-app-site-association` file carries a fingerprint: Apple uses Team ID + bundle ID, a different mechanism entirely, and nothing in this runbook applies to iOS.

### 3.1 What CI can and cannot check

| Check | Proves | Does NOT prove |
|---|---|---|
| `scripts/ci/issue-1042-assetlinks-parity-check.mjs` (PR-blocking) | our two copies agree; no fingerprint was deleted; every value is a well-formed uppercase 32-byte SHA-256; every autoVerify host has a row in §2.2 | **that any fingerprint is the correct one.** The authority is a Play Console screen CI has no credential to read. That blindness is #1038's root cause. |
| `scripts/probe-android-applinks.mjs` (daily + `workflow_dispatch`) | that Google's own resolver returns a statement for every declared (host, package) pair, and that repo-backed hosts serve at least what the repo declares | that the fingerprints in those statements match the certificates Play actually signs with |

Neither replaces Step 1 below. A console readback by a human is the only thing that closes the loop.

---

## Procedure

Run **before any Android store submission** and **after any AppsFlyer branded-domain change**.

### Step 1 — Read both apps' Play certificates

Play Console → select the app → **Test and release → Setup → App signing**.

Two certificates are shown: **App signing key certificate** (Google's) and **Upload key certificate** (ours). For each, copy the SHA-1 **and** the SHA-256, and compare character-by-character against §1.1 / §1.2.

Do this for **both** apps. Do not assume the second app matches the first — #1038 was exactly the two apps being configured from opposite ends.

### Step 2 — Read both apps' EAS keystores

```bash
cd app-mobile      && npx eas-cli credentials -p android
cd ../mingla-business && npx eas-cli credentials -p android
```

Record the keystore SHA-1 and SHA-256 **per build profile**. `eas credentials` reports the release/build keystore by default — the `development` profile's debug keystore is the one this repo does not know (the `UNRESOLVED — awaiting OP-2` rows in §1.1 and §1.2). Read-only: no keystore file is downloaded or opened.

Compare against §1.1 / §1.2 and fill any `UNRESOLVED` row.

### Step 3 — Confirm one OAuth client per (package × SHA-1)

Google Cloud Console → project picker → **`mingla-dev` (169132274606)** → **APIs & Services → Credentials** → *OAuth 2.0 Client IDs*.

For every certificate that signs a binary anyone runs — shipping **or** sideloaded — there must be an Android client holding that package name and that SHA-1. An Android client holds exactly one of each, so covering three signing identities needs three clients.

Open **`Android Client Development`** (`…-6k0i…`) and record its *Package name*, *SHA-1*, *Creation date*, *Last used date* — this is OP-1, still open. The question to answer, exactly: **does it hold `com.mingla.app.v2` with SHA-1 `D0:19:42:E6:25:0F:D1:30:D7:67:E3:CC:6A:4D:3B:9E:72:73:43:1F`?** If not, Explorer's upload key is registered nowhere and Google sign-in returns `DEVELOPER_ERROR` on every `preview`/`production` sideload. The fix is a new client, never an edit to an existing one.

### Step 4 — Run the live probe

```bash
node scripts/probe-android-applinks.mjs
```

Or trigger **Android App Links Health Probe** → *Run workflow* on the Actions tab. Require green. (`KNOWN_FAILURES` is now empty — the sole prior entry, `go.usemingla.com` × `com.sethogieva.minglabusiness`, was retired by #1050 when the Business app stopped declaring `go.`; a fresh entry is only added if a new declared-but-unvouched pair is knowingly tolerated.)

A `DRIFT` result means the repo is right and a deployment is stale — check the latest Vercel production deployment. A `NO_STATEMENT` result on an AppsFlyer host means a branded domain lost an app target.

### Step 5 — If anything differs, update this file in the SAME PR as the fix

A drifted registry is worse than no registry: it launders a wrong value into "documented fact", which is how a single transposed byte becomes months of silent failure. If a value here no longer matches a console, correct it in the same pull request that corrects the console — never "later".

---

## 4. Known open items

**OP-1 — read the `Android Client Development` OAuth client.** Click-path and the exact question: Step 3 above. Expected answer per #1042 F-2 is that it holds the **debug** SHA-1, which would mean Explorer's upload key is registered on no client. Both outcomes are actionable; neither blocks repo work.

**OP-2 — read both apps' EAS Android credentials** (`npx eas-cli credentials -p android`, both app dirs). Seals #1042 F-2's identity claim for `90:28:F8:B1:…` and supplies the two `UNRESOLVED` rows in §1.1/§1.2. Until it returns, `mingla-business`'s `assetlinks.json` cannot gain its debug fingerprint (F-5) — and it must not be guessed.

**OP-3 — read the AppsFlyer branded-domain Android config** (AppsFlyer → OneLink → Branded domains). Informational only now (see F-4 below): confirm `biz.usemingla.com` carries `com.sethogieva.minglabusiness` + its two SHA-256s (it does — live-readback-confirmed at #1050) and that `go.usemingla.com` carries only `com.mingla.app.v2`. No longer blocks anything.

**F-4 — RESOLVED by #1050 (2026-07-21).** The shipped Business build declared `go.usemingla.com` (the CONSUMER OneLink domain, which never vouches for `com.sethogieva.minglabusiness`) as an autoVerify host. On Android 12+ each host verifies independently so only `go.` links were affected; on **Android 11 and below** the legacy verifier is all-or-nothing across an app's autoVerify hosts, so it un-verified `host.usemingla.com` for every Play-installed organiser on those devices — **tester-proven on an Android 11 (API 30) AVD** (`Verification 1 complete. Success:false. Failed hosts:go.usemingla.com` → `Status: ask`). Fix (#1050): the Business app now declares its OWN already-vouching domain `biz.usemingla.com` instead of `go.` — the swap covered the Android intentFilter, the iOS `associatedDomains`, and the AppsFlyer SDK's `setOneLinkCustomDomains` registration in lockstep. This was fix-direction (2) below (the ORCH-1346 branded-domain swap), not (1). **Ships at the next Business native build** (`autoVerify`/`associatedDomains`/SDK-domain bake into the binary; no OTA) — installed organisers stay affected until they update, even though the repo-read probe re-arms at merge.

Historical fix options (F-4's original framing, retained for the record — option 2 was taken):

1. Re-add `com.sethogieva.minglabusiness` to the `go.usemingla.com` branded domain in AppsFlyer — same-day operator fix, no build. NOT taken: it would re-muddle ORCH-1346's one-domain-one-template split by making the consumer domain vouch for the business app.
2. **Point the Business app at `biz.usemingla.com` instead of `go.` in `mingla-business` config at the next native build** — the ORCH-1346 direction; requires a native build, cannot ride an OTA. **This is what #1050 shipped.**

Interim mitigation while the native build is pending (Seth's decision, OQ-1 on #1050): option 1 above can un-break the currently-installed binary on Android ≤11 sooner, reversible once the native build lands. Weigh against the Android ≤11 organiser share in Play Console.

---

## Invariant

`I-PROPOSED-1042-ANDROID-FINGERPRINT-SET-APPEND-ONLY` (`docs/INVARIANT_REGISTRY.md`) — a fingerprint published in any `assetlinks.json` in this repo is **append-only**, and the `com.mingla.app.v2` array must be byte-identical, order included, across `mingla-marketing/` and `mingla-business/`. Removal requires a Play Console or `eas credentials` readback cited in the PR body. Enforced by `scripts/ci/issue-1042-assetlinks-parity-check.mjs`.

## Related

- `.github/workflows/issue-1042-assetlinks-tests.yml` — PR-blocking parity + ratchet gate.
- `.github/workflows/android-applinks-health-probe.yml` — daily live probe against Google's resolver.
- [`docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md`](B2_VERCEL_DEPLOY_RUNBOOK.md) — how the two `public/.well-known/` files reach production, and how to roll a bad one back.
- [`docs/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md) — `I-PROPOSED-DEEP-LINK-WELL-KNOWN-JSON-CONTENT-TYPE` (ORCH-0964) governs the `Content-Type` header these files must be served with.
