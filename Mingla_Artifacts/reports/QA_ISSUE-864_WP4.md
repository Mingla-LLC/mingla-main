# QA — ISSUE-864 WP4 [Campaign Builder UI] — mingla-tester

**Under test:** commits `307c2d742..2ee6404f7` on `issue-864-campaign-builder-ui` (worktree `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui`)
**Contract:** `SPEC_ISSUE-864_CAMPAIGN_BUILDER_UI.md` body + **Amendment A4 (binding)** + blueprint §1/§1.6/§1.7/§1.8/§1.9b · implementor claims in `WP4-864-IMPLEMENTATION-REPORT.md` (independently re-derived)
**Environment:** TWO live-fire legs. (A) **Deployed PROD backend** — the real `admin-ad-*` edge fns on `gqnoajqerqhnvulmnyvv` (all six ACTIVE, `verify_jwt=true`: connect v15 · preflight v15 · create v15 · action v14 · sync v15 · creative-upload v7), driven from the worktree admin (`npm run dev`) through headless Chrome/CDP with a real minted admin session; **zero prod writes occurred** (proof below). (B) **LOCAL stack** (`supabase start`, full migration chain incl. `20270101000864`, after order-preserving temp renames of the 6 duplicate prefixes — restored byte-identical, git-clean verified; COMMS-0102 factored) + `supabase functions serve` with the engine's **real platform credentials** from master keys (values never echoed/committed, shredded at session end) + a cloudflared tunnel so the uploaded creative was **publicly fetchable by Meta**, driven through the REAL admin UI (password + Mailpit-OTP 2FA login) headless via CDP. Direct read-only/delete-only Graph v23 + Google Ads v21 calls for baseline/read-back/cleanup.

---

## 1. Verdict

## **FAIL — 0 × P0 · 1 × P1 · 1 × P2 · 1 × P3 · 3 × P4**

The wizard itself is real and holds up under live fire end-to-end: the full 10-step spine ran against real platform APIs, created **exactly ONE fully-PAUSED chain each on Meta and Google** (never ACTIVE at any level at any moment), rendered dual badges, synced real review state, showed the 175% launch confirm (cancelled — nothing launched), survived pause-on-paused as a 200 no-op, and both chains were deleted/REMOVED platform-side the same run with **residual-zero API-verified**. The A4 rule modules survived 46/46 adversarial boundary attacks. The 49-test happy suite's fails-on-revert claim re-derived exactly.

**What fails it: P1-1 — the builder shows the operator a destination URL that does not exist.** Every URL the wizard displays (`https://usemingla.com/e/{brand}/{slug}` — destination step, launch summary, preview rail) returns **HTTP 404 live**, while the server of record resolves and persists `https://business.usemingla.com/...` (HTTP 200 — and the REAL Google ad created in this QA carried `finalUrls:["https://business.usemingla.com/e/smokerhythm/fifa-grill-night"]`). SC-3 requires "the correct resolved URL"; the code comment claiming host parity with the server is false; the SPEC's own A4.0(3) literal carries the same wrong host (spec erratum flagged). No spend risk — the ad itself gets the right URL — but the operator reviews and confirms against a dead link.

Routing: **REWORK → mingla-implementor** (one-line constant fix + comment fix; my red host-parity pin turns green on the fix).

---

## 2. SC / A4 matrix (every row independently runtime/live-verified)

| Criterion | Verdict | Evidence |
|---|---|---|
| **SC-1** route + admin gate | **PASS — live both envs** | `#/campaign-builder` renders behind AuthContext after a REAL password+OTP 2FA login (local, Mailpit-captured code) and a real minted prod session; Growth nav carries Campaign Builder + Campaigns (shot 03/40). Deployed fns: no-JWT → **401**. |
| **SC-2 / A4.a fail-close** | **PASS — live** | Preflight gate blocks Continue until ≥1 green/amber row; Snapchat stub row = `not_connected` fail-close; prod wizard hard-blocked at creative when storage is missing (below). |
| **SC-3 destinations** | **FAIL (P1-1)** | Filtering itself PASSES live: seeded public **ended**, **cancelled**, and **past-dated-scheduled** events (all exposed by `business_public_events_view` — view WHERE proven to include them) are ALL excluded at runtime; search narrows; no-match → empty state; PROD leg lists the real live events (FIFA Grill Night, Vibe Check). But the resolved URL shown is `https://usemingla.com/e/…` = **live 404** (curl-proven), diverging from the server's `business.usemingla.com` (200). |
| **SC-4 / A4.c creative** | **PASS — live** | Real 1080×1080 JPG (220 KB) uploaded through the UI into `meta-ad-creatives` (admin-RLS write); per-channel byte caps in the dropzone (30 MB / 5,120 KB / 5 MB); `admin-ad-creative-upload action:'validate'` byte-probed the ACTUAL bytes → Meta `ready+warn image.recommended_res [OFFICIAL]`, Google `ready+warn` (shot 19); `action:'record'` persisted 1 `ad_creatives` row ("Recorded ✓"). |
| **SC-5 / A4.0(4) budget gates** | **PASS — live** | Real Meta floors from the live connect (`{imp:100, video_views:100, high_freq:500, low_freq:4000}`): **$4.99 → Meta excluded with the exact "$5.00/day minimum" message; $20 → $10/$10 Meta/Google split; $3 → Google-only + the learning-limited "est. 42/week … directional only" warning** (shots 14/15/16). Age inversion (45/25) → exact inline error + Next disabled; zero countries covered by module tests. Lifetime disabled-with-reason. |
| **SC-6 live preview** | **PASS** | AdPreview rail tracked primary/headline/CTA/image live during the drive (shots 25/29 show the typed copy + uploaded image + BUY TICKETS). |
| **SC-7 create (paused)** | **PASS — live, ONE chain per channel** | "Create campaign (paused)" → Meta chain `52584814435027/52584814438427/52584814444227` + creative `1711632006711848` — campaign/adset/ad ALL `PAUSED` read back from Graph; Google `24041591239` PAUSED SEARCH, budget `amountMicros:"10000000"` (=$10, cents×10,000 correct), ad PAUSED, ad group ENABLED (paused parent gates delivery — contract). DB: 2 `ad_campaigns` PAUSED/PAUSED @1000¢ + 2 `ad_sets` + 2 `ads` + 2 create audit rows. Per-session idempotency: `results[platform]?.campaign` guard held (no duplicate create observed). |
| **SC-8 error surfacing** | **PASS — live (prod leg)** | PROD upload failure surfaced verbatim in an AlertCard: **"Creative check failed — Upload failed: Bucket not found"** + Next disabled ("Upload an ad image first.") — honest fail-close, no silent failure (shot 44). Deep-link-back jumps code-verified (`destination_not_public` → Destination, `budget_below_minimum` → Budget). |
| **SC-9 a11y** | **PASS (with P3-1 note)** | Keyboard-operable controls driven programmatically end-to-end; stepper `aria-current`; radio-group semantics on lane/gender/strategy; uploader = hidden input + labeled button. P3-1: the shared `Input` primitive's label is not programmatically associated (pre-existing pattern, not WP4's). |
| **SC-10 / A4.0(2) create-PAUSED** | **PASS — live + adversarial** | Nothing was EVER ACTIVE on any platform at any moment (every read-back PAUSED → then DELETED/REMOVED). Builder cannot even reference the action service (my source-trap widens the implementor's: no `campaignAction`, no `admin-ad-campaign-action`, no `action:'launch'` in any builder file). Launch lives only on `#/campaigns` behind the §1.8 confirm modal — **opened live, verbatim "up to $10.00/day (Meta can spend up to 175% …)", CANCELLED** (shot 35). Pause-on-paused via the real fn → **200 no-op**, rows still PAUSED/PAUSED. |
| **A4.0(1) channel = output** | **PASS — live + adversarial** | No channel step exists; plan = preflight ∩ goal ∩ market ∩ budget rendered as an output at budget/review; Advanced allowlist narrow-only. Exclusion precedence (endpoint-gap > preflight-red) adversarially pinned. |
| **A4.0(5) honest goals** | **PASS — live + adversarial** | Only Traffic + Awareness cards render; Reservations/Retargeting **absent from the DOM** (runtime) AND unreachable through `planChannels` under any state (adversarial: both goal ids admit ZERO channels). Meta optimization = LINK_CLICKS (real adset read-back). |
| **A4.a preflight** | **PASS — live on the DEPLOYED fns** | PROD sweep: **meta amber (P4 pixel warn) · tiktok amber (P2 funding + P4 pixel + P6 GB) · snapchat not_connected stub · google GREEN · reddit GREEN.** Local per-channel **Recheck fired live** (Reddit not_connected → green after env fix; P1–P6 cards with live detail). Note: dispatch expected "Meta green" — actual is **amber**, which is the CONTRACT-correct state (pixel epoch-0 ⇒ warn; amber annotates, never excludes). |
| **A4.b copy caps** | **PASS — live + adversarial** | Live: >125-char+emoji primary → Meta **warn-only** ("See more"), zero hard; Google 31-char headline → cap error + Next disabled; keywords-required hard until chips added; truncation strip live (FB Feed [See more] / IG / Reels / "Google RSA H1 H2 (3 of 15 — add more)"). Adversarial: exact boundaries 100/101 (latin + CJK×2 + emoji-stripped semantics), 1024/1025, 125/126, 300/301, 80/81, 30/31, 90/91, 15/16 headlines, 4/5 descriptions, 80-char/10-word keywords, ALL-CAPS ratio edges (0.90 exact vs 10/11), whitespace-only entries don't satisfy minimums — **all hold**. TikTok counter/strip rows scope to funded channels only (TikTok excluded by the endpoint gap today) — rule module fully covered by tests. |
| **A4.d policy panel** | **PASS — live + adversarial** | Live: **"Are you tired of being alone?" → patterns 1+3 fire, warn-only, Next STAYS ENABLED**; clean copy → zero findings; rejected→compliant examples inline; HOUSING → full cascade preview before any Meta call; CREDIT not selectable (whitelist-only select) + module rejects it with the migration message. Adversarial: **"Meet people near you" → ZERO personal-attribute findings** (false-positive guard) while Reddit's DATING rule catches it only with reddit in the channel set; pattern-2 window = exactly 5 tokens; pattern 4 template-token-scoped. |
| **A4.e honest numbers** | **PASS — live** | 175%/7× + 2×/30.4 disclosures on budget; learning-limited at $3/day ("est. 42/week"); §1.8 summary verbatim shape: per-channel rows ($/day · Paused → will go live · goal), blocked channels with the reason INLINE, destination/creative/copy lines, pixel amber under "Heads-up" (shot 29). |
| **A4.f audience** | **PASS** | US/GB/NG prefilled; city+radius flag-gated OFF with the labeled explanation block (London,Canada hazard named); Advantage+ 25/26 boundary + Reddit passthrough note gated on reddit-eligible (correct honesty — hidden while Reddit can't receive the ad). Gender enum mapping adversarially pinned (women→[2], men→[1], all→omitted). |
| **A4.g gates** | **PASS** | `frequencyCapAllowed` exact-match REACH/THRUPLAY (case/null hostile inputs pinned); control ABSENT from the DOM; previews flag-gated OFF with the client safe-zone overlay drawn in StepPolicy. |
| **§1.8 validate-only** | **PASS — live BOTH platforms** | "Validate shapes (nothing created)" → Meta `validated_layers: campaign, creative (skipped: ad_set)` — the skip NAMED, never silent; Google `campaign_budget, campaign, geo_criteria, ad_group, ad, keywords` clean. Zero objects created (platform lists checked). |
| **§1.9b review detail** | **PASS — live + adversarial** | Real sync persisted Google's dual vocabulary and the page rendered it: ad badge `review: UNKNOWN` + raw verbatim JSON `{review_status: REVIEW_IN_PROGRESS, approval_status: UNKNOWN}` (shot 34). Adversarial: Reddit array-variant + DATING_*/ALCOHOL_* families + unknown-reason verbatim card; Meta HARD/SOFT severity + **recommendations NEVER read as rejections**; Google LIMITED→warning / FULLY_LIMITED→error / DestinationNotWorking→offer card; billing states (incl. NO_BUDGET) → not-a-rejection card; badge map covers all persisted states. |
| **Payload contracts** | **PASS — adversarial** | Google body carries NO `call_to_action_type` / `objective` / `optimization_goal` / `image_url` / `billing_event` / `genders` / ages / special categories (full negative-space scan); no `status` field, no `ACTIVE` anywhere; money = dollars-in/cents-at-rest, hostile inputs → 0, never micro. |
| **Migration (leg 4)** | **PASS — LOCAL only** | Applied via the full chain on `supabase start` + **re-applied twice by hand — idempotent** (1 bucket, 4 policies stable). Bucket exact: `public=t, 31457280, {image/jpeg,image/png}`. Policies exact: SELECT `public` (bucket-scoped) · INSERT/UPDATE/DELETE `authenticated` + `is_admin_user()`. **RLS live-fire:** non-admin authed INSERT → **400 RLS-denied, zero objects landed**; admin upload through the UI succeeded; **anon public read of the object → 200** (Meta-crawler-fetchable per COMMS-0102). Prod application untouched (orchestrator-owned; bucket confirmed still absent on prod). |

---

## 3. Findings

### P1-1 — Builder-displayed destination URLs 404: client host diverges from the server of record (SC-3, A4.0(3))
- **Evidence:** `mingla-admin/src/services/adDestinationsService.js:17` — `PUBLIC_WEB_ORIGIN = "https://usemingla.com"`, with a comment claiming it "Matches the server's BUSINESS_WEB_ORIGIN default (PRODUCTION_BUSINESS_WEB_ORIGIN)". It does not: `supabase/functions/_shared/businessWebOrigin.ts:1-2` = `"https://business.usemingla.com"`, and `admin-ad-create-campaign/index.ts:798` builds `dest_url` from it. Live: `curl https://usemingla.com/e/smokerhythm/fifa-grill-night` → **404**; same path on `business.usemingla.com` → **200**. The REAL Google ad created this run carried `finalUrls:["https://business.usemingla.com/e/smokerhythm/fifa-grill-night"]` and both DB `dest_url` rows carry the business host — while the wizard displayed the 404 host at the destination step, the launch summary ("Destination — FIFA Grill Night — https://usemingla.com/…", shot 29/31), and the preview rail ("USEMINGLA.COM").
- **Impact:** the operator picks, reviews, and confirms a campaign against a URL that doesn't exist; anyone verifying the ad pre-launch by clicking the displayed link concludes the destination is broken. The persisted rows are correct, so `#/campaigns`' destination link works — the lie is confined to the builder's display layer. The SPEC's A4.0(3)/blueprint §1.2 literal (`https://usemingla.com/e/…`) carries the same wrong host — spec erratum, route to forensics with the fix.
- **Required fix:** point the client constant at the live host (import parity with `PRODUCTION_BUSINESS_WEB_ORIGIN`'s value or read `dest_url` semantics from one shared constant), correct the false comment, and file the A4.0(3) erratum.
- **Retest:** my pin `P1-1 pin — destination display host parity with the server` (currently the suite's single red) goes green; re-drive the destination step and confirm the displayed URL returns 200.

### P2-1 — The Nigeria/Reddit market exclusion is not encoded anywhere in the eligibility computation (blueprint §1.3)
- **Evidence:** `channelPlan.js:58-62` — `MARKET_GAPS` contains only `tiktok:{unavailable:["GB"]}`; the comment says "the Nigeria LANE never routes to Reddit. Countries stay OK." But `planChannels()` takes NO lane term, and no NG/Reddit rule exists in any input. Blueprint §1.3: "Reddit cannot bill NGN… **Don't route the Nigeria lane to Reddit**" and "[DESIGN DECISION] Eligibility is `objective × lane × market × connection-health`". Adversarially confirmed: with Reddit hypothetically create-wired + green preflight, an NG-targeting plan keeps Reddit eligible.
- **Impact:** ZERO today — Reddit is excluded by the CREATE_WIRED endpoint gap first. The day `admin-ad-create-campaign` gains its Reddit branch (already flagged as the follow-up), a Lagos plan will silently route to Reddit with nothing enforcing the constraint.
- **Required fix:** when the Reddit create branch lands (or now, cheaply): encode the NG/Reddit exclusion (market or lane term) in `planChannels` with the blueprint's billing-currency reason.
- **Retest:** NG-plan × wired-Reddit → excluded with the no-NGN reason.

### P3-1 — Shared `Input` primitive renders labels without programmatic association (pre-existing, surfaced by SC-9)
- **Evidence:** `mingla-admin/src/components/ui/Input.jsx:15` — `<label>` with no `htmlFor`/`id` wiring (CurrencyInput, by contrast, passes `id`). Screen readers won't associate "Campaign name"/"Age min" etc. with their fields; my CDP `getByLabel` lookups failed for the same reason.
- **Impact:** SC-9's "labeled inputs" is visually true, programmatically false — for every admin form using the primitive, not just WP4.
- **Required fix:** repo-wide primitive fix (out of WP4's allowlist) — register as a small hygiene ORCH; not a WP4 rework item.

### P4-a (praise) — The rule-module layer is genuinely hard
46/46 adversarial boundary attacks passed on first run: every cap boundary exact (including CJK×2 AT the caps and emoji-stripped-length semantics), exclusion precedence exact, hidden goals unreachable through the planner, odd-cent conservation exact, linter window exact, payload negative space clean. The TikTok hard-cap revert was caught from THREE independent angles in my suite (44/47 on revert).

### P4-b (praise) — Create-PAUSED and residual-zero discipline held under live fire
One chain per platform, PAUSED at every level at every read, launch modal verbatim §1.8 + cancel, pause-on-paused 200 no-op, platform deletes same-run, final sync mapped rows to DELETED/REMOVED. Nothing was ever ACTIVE on any platform at any moment.

### P4-c (note) — Deployed-prod fail-closes are honest and loud
The prod wizard drive died exactly where it should ("Upload failed: Bucket not found", Next disabled) instead of anything silent; deployed fns 401 unauthenticated; sync-all over an empty prod set is safe.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Claimed at `5e2de49b0` (TikTok hard-cap TRUE LINE DELETION → 48/49). **Re-derived on this checkout:** deleted the 3-line `if (wl(stripped) > 100) { hard.push(…) }` block in `copyRules.js` → happy suite **`# tests 49 / # pass 48 / # fail 1`** (the A4.b TikTok test, exactly as claimed); my adversarial suite simultaneously fell to 44/47 (boundary + emoji-stripped tests). Restored via `git checkout --` → **49/49** green, working tree clean. Claim confirmed.

## 5. Tester adversarial test (added, on-branch, in-diff)

- **Path:** `mingla-admin/src/__tests__/issue864_campaign_builder_tester_adversarial.test.js` — **47 tests: 46 pass + 1 intentionally RED** (the P1-1 host-parity pin; goes green with the rework). Append-only; no existing test file touched.
- **Different angles than the implementor's 49:** exact cap boundaries incl. CJK-at-the-cap and stripped-length semantics · ALL-CAPS ratio edges · exclusion-precedence and the GB market gate exercised THROUGH a create-wired channel (proving the gate is real, not dead code) · hidden-goal unreachability via `planChannels` · $4.99/$5.00 floor framings + odd-cent split conservation · learning-formula boundary at exactly 50 events/week · unknown-goal → conservative low_freq floor · linter pattern-2 token-window edge + the "Meet people near you" false-positive guard · payload negative-space scans (7 banned fields on the Google body) · review-detail hostile shapes (array variants, prefix families, recommendations-never-read) · launch-summary blocked-reason-INLINE + unfunded-channel naming · destination-filter and SC-10 source traps.
- **fails-on-revert (tester anchor — different module than the implementor's):** TRUE line deletion of `blockedLines.push({ …reason: row.excludedReason })` in `launchSummary.js:57` → **45/47** (the inline-reason test fails); restored → 46/47 (only the P1 pin red). `fails-on-revert verified at 2ee6404f7 (working-tree line deletion, restored, git-clean verified)`.
- **CI wiring:** new job `issue-864-campaign-builder-tester-adversarial` appended to `strict-grep-mingla-business.yml` (append-only; YAML parse-verified, 343 jobs). The job is RED until the P1-1 rework lands — by design: this branch must not merge as-is.

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS (P1-1 adjacent)** | Every control fired live (Recheck, Next/Back gates, upload, validate, record, create, sync, launch-modal, cancel). The displayed 404 URL is a display-truth defect (P1-1), not a dead control — the anchor rendering it on `#/campaigns` uses the correct persisted `dest_url`. |
| 2 | One owner per truth | **FAIL → P1-1** | Two owners for the public-page origin: client `PUBLIC_WEB_ORIGIN` vs server `PRODUCTION_BUSINESS_WEB_ORIGIN`, disagreeing. |
| 3 | No silent failures | PASS | Prod upload failure loud + Next disabled; skipped validate layers NAMED; sync/action errors toast with parsed detail. |
| 4 | One query key per entity | N/A | No React Query in admin (house pattern: services + useState/useEffect). |
| 5 | Server state server-side | PASS | No client cache of platform state; every action re-reads. |
| 6 | Logout clears everything | PASS (unchanged) | Auth surface untouched; signOut clears the 2FA flag (pre-existing). |
| 7 | `[TRANSITIONAL]` labeled | PASS | Deferred endpoints are named flags (`flags.js`), each documenting its missing endpoint. |
| 8 | Subtract before adding | PASS | Rules-as-modules replace the WP1 raw form's assumptions; no duplicated rule logic found between steps and modules. |
| 9 | No fabricated data | PASS | Floors null-when-unknown (never guessed); empty review detail → no cards; split renders only entered budgets; "local estimate" labeled. |
| 10 | Currency-aware | PASS | Dollars-in/cents-at-rest; $10 → `amountMicros:"10000000"` server-side (×10,000 exact, live-verified); USD floors from the live account. |
| 11 | One auth instance | PASS | Single supabase client; `invokeWithRefresh` throughout. |
| 12 | Validate at the right time | PASS | Every step gate precedes create; server re-validates (fail-close proven at the prod boundary). |
| 13 | Exclusion consistency | **PASS w/ P2-1 caveat** | Client destination filter = server gate (scheduled|live + future, runtime-proven); the NG/Reddit market exclusion is missing from the plan (latent — P2-1). |
| 14 | Persisted-state startup | N/A | Wizard drafts are deliberately client-state-only (OD-3); no hydration surface. |

## 7. Device / parity matrix

| Surface | Result |
|---|---|
| **Admin Web (only shipping surface)** | **Driven live, two backends** — deployed PROD fns (auth-gated, preflight sweep, real destinations, honest storage fail-close) + LOCAL stack with real platform credentials (full wizard e2e, creates, campaigns surface, cleanup). Headless Chrome 149 via CDP, 1440×1000. Screenshots: `Mingla_Artifacts/reports/assets-qa-issue-864-wp4/` (12 curated). |
| Consumer iOS / Android · Business iOS / Android · Buyer web · Business web preview | **Skipped — the feature does not ship there** (admin-only; buyer web is read-only reference as the destination source, verified via the live event page 200s). |
| Physical iPhone HITL | **Skipped — no mobile surface ships in this WP.** |
| Edge-fn deploy state | Verified read-only: all six `admin-ad-*` fns ACTIVE with `verify_jwt=true` on prod (versions in the header). Nothing deployed from this session. |

**Prod-write audit:** zero. The prod leg performed reads + one storage upload attempt that failed BEFORE any object write ("Bucket not found"); no connect, no create, no sync-mutation (empty set), no migration applied. Prod `ad_connections`/`ad_campaigns` remain empty; prod `storage.buckets` still lacks `meta-ad-creatives`.

**Platform residual state (session end):** Meta `act_2393570861066813`: campaigns/adsets/ads/adcreatives all `[]`; the QA chain `52584814435027/52584814438427/52584814444227` + creative `1711632006711848` read back DELETED (terminal, $0 spend). Google `3623860476`: `WHERE status != 'REMOVED'` → `[]`; QA campaign `24041591239` REMOVED (terminal, $0 spend, created PAUSED → REMOVED same run) alongside the two pre-existing terminal campaigns (`24039386311` App-1, `24040843582` WP2). **Nothing was ever ACTIVE anywhere.**

## 8. Discoveries for Orchestrator

- **D-1 (CLOSE-blocker sequencing, not a code defect):** the feature is inoperable on prod as deployed until (a) the bucket migration `20270101000864` is applied (bucket probe-confirmed absent; the wizard fail-closes at creative), and (b) `admin-ad-connect` is run per platform (prod `ad_connections` is EMPTY — zero rows — so Meta's client floor gate degrades to unknown and create would 424 fail-close). Prod Function Secrets ARE provisioned (deployed preflight returned live rows for all five channels).
- **D-2:** deployed-prod preflight truth (2026-07-16): meta **amber** (pixel epoch-0 — the dispatch's "Meta green" expectation is stale; amber is the contract-correct state), tiktok **amber** (funding + pixel + GB), snapchat **stub**, google **GREEN**, reddit **GREEN**.
- **D-3 (spec erratum):** A4.0(3)/blueprint §1.2 write the canonical destination as `https://usemingla.com/e/…` — live 404; production reality is `business.usemingla.com`. Fix the spec text alongside P1-1 (or decide the marketing-domain rewrite is the real goal and file THAT as its own ORCH — the ads currently run on the business host either way).
- **D-4:** the P2-1 NG/Reddit market gap should be folded into the already-flagged "TikTok/Reddit create branch" follow-up ORCH as an acceptance criterion.
- **D-5:** the shared `Input` label-association gap (P3-1) is admin-wide — cheap hygiene ORCH.
- **D-6:** COMMS-0102's duplicate-prefix trap bit again; the order-preserving rename recipe (WP2 D-2) worked cleanly a third time — the hygiene ORCH remains worth registering.

---

**Routing:** FAIL → **REWORK (mingla-implementor)** — P1-1 (one-constant fix + false-comment fix; my red pin is the regression contract), P2-1 optionally now or with the Reddit-branch follow-up. P3-1/D-* to the orchestrator.
**Working tree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui` on branch `issue-864-campaign-builder-ui`.
