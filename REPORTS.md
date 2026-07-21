# Mingla Reports — Canonical Shipped-Work Log

This is the single running log of what has been fixed, implemented, and shipped. It is the
canonical record: if it shipped, it has a line here.

**Going-forward format:** when an issue on the Mingla Avengers board reaches Done, ONE entry is
appended at the top of the "Shipped" section:

```
- YYYY-MM-DD — <plain-English what changed for users/ops> (#<issue>, PR #<pr>)
```

Detail (evidence, root cause, test notes) lives in the issue, not here. One line per ship,
newest first, plain English first.

History before 2026-07-19 is archived in full at git tag `pre-avengers-archive`. Entries below
that date are a translated back-fill from the old ORCH/artifact system; old IDs are kept in
parentheses for traceability.

## Shipped
- 2026-07-21 — Android deep-link certificate registry fixed and made self-checking: published the one Explorer signing fingerprint that was missing (so App Links verify on release-signed test builds), wrote a runbook recording which of each app's three signing certificates is which and where each is registered, and replaced a test that checked a copy against itself with a daily probe that asks Google's own resolver whether every deep-link host actually vouches for our apps. Surfaced a real Android-11-and-below organiser bug in the process (now #1050) (#1042, PR #1045)
- 2026-07-21 — Repo un-blocked: main had drifted onto Expo SDK 57 (the version that broke native builds) in both apps for the third time, sneaked in by Dependabot PRs titled as postcss security patches and merged while the guard was red — which broke `npm ci` repo-wide. Re-pinned both apps to Expo 54, reconciled lockfiles, and closed the Dependabot hole that let a postcss bump carry a framework major (#1051, PR #1052)

- 2026-07-21 — Fixed: "Continue with Google" failed with DEVELOPER_ERROR for every organizer who installed Mingla Business from the Play Store. Google Cloud only had the app registered under our upload certificate, not the certificate Google re-signs store builds with — so sideloaded test builds worked and every real install was rejected before the account picker opened. Resolved by registering the Play app-signing fingerprint; no app release needed. Explorer audited and cleared (#1038)
- 2026-07-21 — Cleaned up the colour picker: removed the "AA · Crisp / Nudge to AA" contrast chip and its explainer line, which restated what the live preview already shows and fired false warnings on ordinary colours. The picker now reads spectrum → hue → hex → swatches, with the preview as the sole readability cue (#1036, PR #1041)
- 2026-07-21 — Fixed: the theme picker wouldn't open when editing an already-published event or RSVP — tapping the Theme row did nothing (a stale React memo held the sheet shut). One fix covers both edit screens; proven on real iPhone and Samsung, and it saved a colour to the database on device (#1035, PR #1040)
- 2026-07-21 — Organizers can now theme an event, RSVP, trip or experience while creating it, not only after publishing: a compact colour/font/motion control on the cover step of every wizard and both edit screens, with a rebuilt colour picker (spectrum + hue rail + hex, a live preview of the real public page, twelve named presets, and a contrast readout). Backed by a structural audit of all six surfaces that fixed a class of silent theme-loss bugs and a 63-sheet dead-tap regression before they shipped (#1022, PR #1033)
- 2026-07-20 — New brands can publish free events, RSVPs, and trips with zero payment setup (the currency guard now splits by money, not by onboarding); paid attempts get a real "Finish your payment setup" message with a route instead of a dead-end toast; Nigerian Paystack onboarding finally records NGN so NG brands can publish; four hidden fake-GBP/USD fallbacks removed (#1014, PR #1019)
- 2026-07-20 — Every Mingla logo now comes from one canonical source: emails and ticket PDFs resolve a live branded URL (four dead-404 fallbacks eliminated), the repo keeps one master copy per mark (7 duplicates deleted, CI-enforced), the admin tab icon is the proper square mark, and three screens faking the logo as text now show the real wordmark (#1001, PR #1012)
- 2026-07-20 — Nigeria's "Set up payments" (Paystack) onboarding page now scrolls on short phone screens, so its headings no longer collide with the top bar and the "Connect bank" button can't fall off-screen — the same scroll fix already live for the Stripe page, extended to the NG path (#971, PR #1011)
- 2026-07-20 — Scanner-invite failures now show the real reason (expired / revoked / already-used / wrong-account) instead of a generic error — the same parsing fix already live for partner invites, extended to the scanner path (#959, PR #1010)
- 2026-07-20 — Sign-in code emails are now fully Mingla-branded: sent from Mingla <noreply@usemingla.com> with the logo wordmark and a clean code card, replacing "Supabase Auth / Your Magic Link" with admin-dashboard copy that buyers and partners were receiving; auth email send limit raised 30→100/hr (#999)
- 2026-07-20 — The business-app To-Do toggle now remembers whether you left it open or collapsed — across Home/Hub, brand switches, and app restarts (#882, PR #1000)
- 2026-07-20 — Production business app un-bricked: a wrong-key OTA publish stuck iOS on the splash screen; republished with live payment keys via the canonical script, and crash reporting now actually ships in OTAs (#990)
- 2026-07-20 — Typing an event name in the business app no longer kicks you out of the field mid-word: draft promotion is single-owner, keystrokes survive, and duplicate draft rows are gone (#976, PR #988)
- 2026-07-19 — Repo + workflow migrated to the Mingla Avengers board as source of truth; artifact system retired (#974)
- 2026-07-19 — Ad-conversion reports now actually reach Reddit and Snap (wrong Reddit endpoint and a missing Snap field fixed); all ad-channel tokens consolidated into one secret (ORCH-1405, PR #973)
- 2026-07-19 — "Set up payments" page scrolls properly so its headings no longer pile on top of each other (ORCH-1403)
- 2026-07-19 — Ad attribution went live on the business site: browser pixels for four ad platforms plus server-side conversion senders, built to never block a signup if tracking fails (#865 WP-B+C, PR #970)
- 2026-07-18 — Accepting an invite that fails now shows the real reason, and signing in with the wrong account is recoverable instead of a dead end (ORCH-1404, PR #969)
- 2026-07-18 — CI safety checks can no longer silently go dark: coverage caps only shrink, 15 dead checks were re-lit, and any cap raise is surfaced for review (ORCH-1400 Phase 1)
- 2026-07-18 — CI consolidated from ~350 jobs to 10; every safety gate must register in a manifest or the PR fails (ORCH-1383)
- 2026-07-18 — The /links page records which bio/campaign sent each visitor, and every marketing call-to-action carries a working app-store link (ORCH-1399)
- 2026-07-18 — Invite funnel un-bricked: accepting a partner invite no longer hangs on an infinite loader — a batch of seven related invite-flow bugs fixed with it (ORCH-1373–1382, PR #938)
- 2026-07-18 — Ad Engine can now deliver ads on Instagram (#939, PR #942)
- 2026-07-18 — Repo-wide dependency install fixed: Expo re-pinned to SDK 54 with a CI gate that blocks accidental framework bumps (ORCH-1398, PR #941)
- 2026-07-18 — Conversion-tracking backend live: the database schema and capture endpoint that ad attribution reports into (#865 WP-A, PR #946)
- 2026-07-18 — Ad Engine: all five channels can complete ad creation end-to-end; channel credentials consolidated into stable secret slots (#927, PR #928)
- 2026-07-18 — Security sweep: anonymous visitors could execute privileged database functions (forge refunds, read QR data, wipe audit trails); every hole closed on prod, with a CI gate that keeps the whole class closed (ORCH-1392, PR #937)
- 2026-07-18 — Partners can finally manage brands from their phone: invite a second brand, open row details, cancel or disconnect — plus emergency permission hardening found during testing (ORCH-1384)
- 2026-07-18 — Apple Pay configuration made first-class in the business checkout, with regression nets for Apple's wallet-listing rule (ORCH-1387)
- 2026-07-18 — Checkouts stuck on "processing payment" now honestly expire via a 15-minute reconciler cron; nobody had been charged (ORCH-1388)
- 2026-07-17 — Repo-wide red web build fixed by declaring missing workspace dependencies, plus a CI guard against undeclared deps (ORCH-1385, PR #929)
- 2026-07-17 — Native app builds restored by reverting an accidental Expo 57 upgrade (ORCH-1386)
- 2026-07-16 — Ad Engine: campaign-builder wizard in the admin console (#864 WP4, PR #926)
- 2026-07-16 — Ad Engine: Snapchat channel, battle-tested against the live account (#867 WP5, PR #921)
- 2026-07-15 — Ad Engine: TikTok channel (#863 WP7, PR #919) and Reddit promoted-post channel (#916 WP6, PR #918)
- 2026-07-15 — Ad Engine: creative library + validator (#866 WP3, PR #915) and Google Search/RSA channel (#867 WP2, PR #914)
- 2026-07-15 — Ad Engine foundation shipped with the Meta channel and its admin surface — the start of the five-channel ad system (#862 WP1, PR #893)
- 2026-07-15 — Android business owners get a real "Get the app" path (live Play listing, not a dead link), and a bug that opened marketing links twice was killed at every call site (ORCH-1381)
- 2026-07-14 — Country picker now shows on iOS in Add friend and Pair by phone (ORCH-1371+1372, PR #883)
- 2026-07-14 — Both apps unified at version 1.1.2 and submitted to both stores, with CI gates enforcing version parity and correct store submit config (ORCH-1367 PR #847, ORCH-1369 PR #850)
- 2026-07-13 — Onboarding "Choose your city" uses the real place-search engine, so it works with GPS off (ORCH-1362, PR #842)
- 2026-07-13 — Location search finds real places — "lekki nigeria" and "atlanta georgia" now return the right results (ORCH-1365, PR #841)
- 2026-07-12 — Location search shows a proper multi-row result list biased toward where you are, instead of jumping to London (ORCH-1361, PR #837)
- 2026-07-12 — "Take a Stroll" no longer returns an empty deck (ORCH-1363, PR #839)
- 2026-07-12 — Guest-list upgrades: tap a guest to see their profile, cleaner card spacing, and confirm/cancel controls on friend requests (ORCH-1358–1360)
- 2026-07-11 — Event-create wizard keyboard bugs fixed (name field dropped the keyboard; guest limit snapped back); apps bumped to 1.1.0 (ORCH-1355, PR #831)
- 2026-07-11 — Nigerian partners can get paid: Paystack transfer rail with Nigerian bank onboarding and fail-soft revenue splits (ORCH-1331, PR #829)
- 2026-07-10 — Event pages show social proof: a who's-going momentum card with real avatars, a guest-list sheet, and a web install funnel for guests without the app (META-ORCH-1337, PR #828)
- 2026-07-10 — RSVP host console shows real guest identity — names, avatars, and where each guest came from (ORCH-1334, PR #823)
- 2026-07-10 — Consumer Android app stripped of the media/storage permissions Google flags (Play policy compliance) (ORCH-1322, PR #826)
- 2026-07-10 — City-wide venue scoring fixed — it had been silently saving nothing; now runs bounded and resumable, verified live on New York + Paris (ORCH-1333, PRs #821/#825)
- 2026-07-10 — Notifications sheet sits at the top of the screen (no floating gap), and the RSVP chip-in banner knows whether the host has a payout account (ORCH-1336 PR #819, ORCH-1335 PR #818)
- 2026-07-10 — Partner pages re-skinned to match the app, and a broken partner brand-creation route fixed (ORCH-1343+1344, PR #817)
- 2026-07-10 — Partner-invite email gets a device-aware app-download button and readable button contrast (ORCH-1329, PR #814)
- 2026-07-09 — /links "Get the app" opens the right store without stranding visitors on a blank page; the For-Business tab is device-aware (ORCH-1326–1328, PRs #809/#811)
- 2026-07-09 — Business site "Get the app" is device-aware: iOS goes to the App Store, Android/desktop to the web app (ORCH-1324, PR #806)
- 2026-07-07 — Links from ads and emails now carry through a fresh app install to the right screen (deferred deep-linking) (ORCH-1318, PR #803)
- 2026-07-07 — Business app: Google Play media-permissions rejection fixed, and the Account-tab crash blocking Apple's re-review fixed (ORCH-1321 PR #801, ORCH-1320 PR #800)
- 2026-07-06 — Link-in-bio page live at /links: tabbed Explorer / For Business with all seven social profiles, fits one screen (ORCH-1317)
- 2026-07-06 — Explorer "Get the app" points at the live store listings by device, with a QR code on desktop (ORCH-1319)
- 2026-07-06 — Paywall opens on top of the preferences sheet instead of hidden behind it (ORCH-1314+1315, PR #792)
- 2026-07-05 — Ad-click attribution measures correctly from the web with no app rebuild needed (ORCH-1313 Phase 1, PR #790)
- 2026-07-05 — Picking a gallery video as an event cover works on Android web — duration reads made robust with spaced retries (ORCH-1311+1312, PRs #786/#787)
- 2026-07-04 — Brand edit and team deep links no longer show "Brand not found" on a cold open (ORCH-1309+1310, PRs #782/#784)
- 2026-07-04 — Video covers can be uploaded from mobile web browsers — three stacked bugs fixed (disabled button, fractional durations, revoked retry blobs) (ORCH-1307+1308, PRs #779/#781)
- 2026-07-04 — Venue settings shows one "Edit photos & details" button instead of two doing the same thing (ORCH-1306, PR #777)
- 2026-07-04 — Approving a venue automatically generates its consumer-facing pitch (ORCH-1304, PR #775)
- 2026-07-04 — RSVP chip-in shipped: guests can voluntarily contribute money to an event via Stripe or Paystack, with gift receipts to guest and host, safe post-payment return, and full edit-after-publish parity (ORCH-1291 + chip-in cluster, PRs #749–#768)
- 2026-07-04 — Venue authoring is a single submission — scoring and pitch happen at admin approval, not before (META-ORCH-1290, PR #750)
- 2026-07-04 — RSVP page fixed on phone browsers: the phone country picker no longer freezes the page, and taps are no longer starved (ORCH-1299/1300/1303, PRs #759/#762/#766/#773)
- 2026-07-04 — Cover-video uploads to Bunny made reliable (auth/offset headers on resumable uploads), and video covers render in trip and brand previews (PRs #752/#758/#760/#761)
- 2026-07-03 — Business app no longer hangs on the boot spinner (loading gate released before an un-timed network chain) (ORCH-1294, PR #748)
- 2026-07-03 — App Store rejection fixes: profile spinner + findable account deletion; public pages show friendly tag names instead of raw slugs (ORCH-1292, PR #745, v1.0.1)
- 2026-07-03 — Full admin console shipped: see and edit people, brands, offerings, and money (refunds, Connect, disputes, subscriptions) with forgery-proof audited writes (META-ORCH-1237 — ORCH-1271–1278)
- 2026-07-03 — Marketing texts got a real composer: photo/MMS support, live preview, quiet-hours deferral, honest campaign status, and double-send guards (META-ORCH-1281 PR #733, ORCH-1289 PR #740, ORCH-1270 PR #725)
- 2026-07-03 — Cover videos moved off Cloudinary onto Bunny Stream, ending the bandwidth-overage bills (META-ORCH-1270)
- 2026-07-03 — Venue AI step no longer flashes and closes on web create; broken "Manage tax" link now points at the business site; false "notifications off" dialog fixed (ORCH-1285 PR #734, ORCH-1284 PR #732, ORCH-1264 PR #718)
- 2026-07-02 — Claiming a Mingla-seeded venue pre-fills the whole wizard with everything we already know about it (ORCH-1263, PR #716)
- 2026-07-02 — Businesses can run multiple venues under one brand, each with its own approval and public page (META-ORCH-1255)
- 2026-07-02 — iOS tracking-consent prompt fires first and reliably (fixed an Apple rejection); brand profiles show one to-do per missing field (ORCH-1257/1258 PRs #711/#713, ORCH-1256 PR #707)
- 2026-07-01 — App Review account actually works: reviewer sign-in no longer deadlocks while loading brands (ORCH-1254, PRs #706/#708)
- 2026-07-01 — Cold-start reliability: brands load on a fresh native app open instead of hanging, on both apps (ORCH-1249/1251, PRs #697/#700)
- 2026-07-01 — Store-compliance batch: honest push-permission popup on business, Meet Ari closable, iOS location purpose string, checkout keyboard over-scroll, Android App Links signing key (ORCH-1247/1248/1250/1252/1253, PRs #694–#703)
- 2026-06-30 — Apple-compliance batch across both apps: push optional, Apple Pay listed as a product line, subscription titles, ATT + Meet Ari fixed on iPad, and the App Review account seeded with content (ORCH-1244/1245/1246, PRs #691–#693)
- 2026-06-28 — Launch-blocker cleanup: false "notifications off" dialog tied to the real OS permission; precise iOS camera/photo purpose strings; card swipe no longer hangs mid-gesture; Mingla Plus pairing paywall leak closed (ORCH-1239/1241/1242/1243, PRs #684–#689)
- 2026-06-27 — Account deletion works on both apps, and a support-inbox privacy leak was closed (#668, PR #682)
- 2026-06-27 — Live money bug fixed: a US-dollar brand was being charged in pounds — brand pricing currency now always tracks its default currency (META-ORCH-1236, PR #674)
- 2026-06-27 — Business web no longer freezes on its loading screen (META-ORCH-1235, PR #675); Stripe key routed through a mode-validated resolver so test keys can't reach prod (ORCH-1238, PR #678); ticket addresses deep-link to Google Maps in full (ORCH-1237, PR #677)
- 2026-06-26 — Stripe Connect onboarding no longer hangs at the return redirect, and its webhook audit failure was fixed (META-ORCH-1234, PR #673)
- 2026-06-26 — Explorer first-run polish (value-prop slides, skippable inner circle, Discover spotlight), and fresh signups can create a brand immediately — the app now waits for a real session token (META-ORCH-1233 PR #671, META-ORCH-1232 PRs #669/#670)
- 2026-06-25 — Consumer Apple App Review rejections fixed, rounds one and two (ORCH-1228/1230, PRs #666/#667)
- 2026-06-24 — Business app store name corrected to "Mingla Business", and dead login legal links fixed (ORCH-1227, PR #661)
- 2026-06-23 — Nigeria SMS delivery built on Termii behind a country switch (shipped dark, ready to flip) (ORCH-1227, PR #659)
- 2026-06-22 — Go-live day sweep, shipped as a batch:
  - Careers site live at career.usemingla.com, linked from both surfaces, with applicant emails (META-ORCH-1222 + ORCH-1225/1226, PRs #650–#657)
  - Marketing site cleanup: footer business-only, /organisers renamed /business, nine dead links removed with a CI link check (ORCH-1223/1224, PRs #649/#653)
  - Explorer signup form: multi-select interests, "All of it" select-all, TestFlight lead capture with an always-emailed link (ORCH-1216/1219/1221, PRs #640/#644/#647)
  - App Review email-login bypass for the business app (ORCH-1220, PR #646)
  - AI vendor names scrubbed from all user-facing copy — it's "Mingla's AI" (ORCH-1217/1218, PRs #639/#641)
  - Business mobile-web reliability: notifications crash, sheet sizing + swipe-to-dismiss, brand-switcher wedge fixed via synchronous auth hydration, edge CORS unblocking team/scanner invites (ORCH-1204–1211, PRs #618–#635)
  - Every "going" RSVP always gets a signed QR pass, and passes are only delivered after approval (ORCH-1203/1206, PRs #619/#624)
  - Off-hours "today" deck no longer collapses — open hours are counted from now onward (ORCH-1212, PR #634)
  - Cover-video bandwidth leak stopped (ORCH-1209, PR #629)
  - Admin API-health hub with three-layer monitoring and email alerts (ORCH-1201, PRs #612/#620/#622)
- 2026-06-21 — Product analytics live end-to-end: PostHog + GA4 behind consent on marketing, buyer web, and both native apps (META-ORCH-1187, PRs #584–#601)
- 2026-06-21 — Venue creation and management unified into one flow, plus a venue-suite polish batch and a desktop command-center layout (META-ORCH-1186 PR #588; ORCH-1184/1190/1196, PRs #580–#610)
- 2026-06-21 — Trips checkout: always shows the cart step, installment-aware cart, per-tile installment notes, and "Due today" scales with quantity (ORCH-1174–1182, PRs #571–#577)
- 2026-06-21 — Confirmation-email pipeline fixed (PDF character sanitize, reservation emails on insert, experience itineraries) with regression tests (ORCH-1195/1200, PRs #609/#613)
- 2026-06-21 — Web sheets anchor to the true visible screen bottom on iOS Safari and Samsung browsers (ORCH-1193/1197/1199, PRs #603/#611/#614)
- 2026-06-20 — Public trip page standardized into one shared body with multi-tier packages; RSVP edit reaches full parity with create and never clobbers untouched settings (META-ORCH-1174 PRs #567–#571; ORCH-1172 PRs #559–#566)
- 2026-06-20 — SMS compliance shipped: consent capture, marketing opt-out default-ON, recipient-timezone quiet hours, /sms-terms + /unsubscribe pages, and buyer transactional notifications (META-ORCH-1161, PRs #544–#558)
- 2026-06-20 — Keyboard "Done" bar everywhere in the business app — including inside sheets and modals — with consumer parity following (ORCH-1165/1170/1171, PRs #548/#555/#575)
- 2026-06-19 — One canonical public event page across web, business, and consumer, with autoplaying video covers fixed on Safari/WebKit (ORCH-1167 R1–R8, PRs #534–#541)
- 2026-06-19 — "Where you'll be" map renders on all surfaces via a server proxy that hides the map vendor; public event + cart polish; anonymous trip page restored (ORCH-1162/1164/1165, PRs #528/#530/#533)
- 2026-06-18 — Public RSVP page standardized with address privacy honored until ticketed; Sentry live on edge functions plus disaster-recovery and incident-drill runbooks (ORCH-1157/1163 PRs #526/#546; G3/G4/G5 PRs #529/#531/#532)
- 2026-06-17 — Venue reservations end-to-end: tables + availability + slot engine, reservation lifecycle with waitlist + SMS, guest booking for anonymous buyers, consumer reserve flow with a QR reservation pass in Calendar, and deposits refunded on cancel (META-ORCH-1148, PRs #498–#524)
- 2026-06-16 — RSVP events shipped — Partiful-style ticketless events with a host console, waitlist, and push/SMS/email invites (ORCH-1150 + R2, PRs #503/#511/#515)
- 2026-06-16 — Menu-snap creates curated experiences with menu items as priced stops; S0 checkout crash on empty carts fixed (ORCH-1151/1152, PRs #504/#505)
- 2026-06-15 — Cart shows the TRUE all-in price on both the selection and payment screens (ORCH-1147 + R2, PRs #497/#500)
- 2026-06-15 — Creation upgrades: universal in-sheet experience chooser, experience-parser completeness, venue tab in Hub, business Home live card with Scan on every live kind, tap-to-expand notifications (ORCH-1142–1146, PRs #485–#494)
- 2026-06-14 — Reliability batch: team-wide iOS build break fixed, business-web infinite render loop, shell bugs + blank icons, cold deep-link crash, false "booking not ready" gate, brand-profile redesign, public offering-page polish (ORCH-1116/1117/1121/1125/1129/1134/1136/1137, PRs #443–#476)
- 2026-06-13 — Trip authoring: editable refund tiers + booking deadlines after publish, per-day media galleries, Mapbox-validated locations; public trip page redesigned with a clear installments view (ORCH-1118/1119/1120/1130/1138, PRs #446/#457/#458/#461/#478)
- 2026-06-11 — P0 funnel restore: anonymous buyers can reach public pages again (no forced sign-in), public share buttons work on web, and curated decks work for remote/custom locations (ORCH-1113/1114/1115, PRs #440–#442)
- 2026-06-10 — Pending invites visible in-app, Ari reachable with no brand, and accounts with a blank stored email can be deleted again (ORCH-1110/1111/1112, PRs #436/#437)
- 2026-06-09 — Production-readiness foundation: load harnesses, structured logging on hot paths, hot-path database indexes, and Grade-A evidence harnesses for checkout and Hub (#426, PRs #427–#433)
- 2026-06-08 — Business support live-chat + tickets with admin segmentation; dead sessions self-heal to sign-in; ticket scanner web-gated with a clean "scan in the app" fallback (META-ORCH-1104 PR #423; ORCH-1106 PR #421; ORCH-1099 PR #419)
- 2026-06-08 — The REAL business app now runs on phone browsers: a two-week web-parity wave retired the static stand-in — auth routing, mobile parity, memory-safety, Marketing Composer + media pickers on web, sign-out white screen fixed (ORCH-1083–1103, PRs #376–#420)
- 2026-06-05 — Partner workflow polished across seven surfaces; Ari chat overhauled with smart brand editing and in-chat media (ORCH-1081/1101/1103, PRs #376/#411/#425)
- 2026-06-05 — Nigeria payouts groundwork: Paystack brand payout onboarding with Nigeria in the payout country picker; consumer + business location search moved off Google onto Mapbox (META-ORCH-1076 P2/2b PRs #368/#370; META-ORCH-1060/ORCH-1079 PRs #372/#375)
- 2026-06-01 — Launch-city gating (admin Launch Cities control + onboarding gate), notification deep-links unified onto one typed router, business venue supply feeding the consumer deck, and coach-mark determinism (ORCH-1027/1028/1030/1035/1036/1037; META-ORCH-1009 E/F, PRs #294–#301)

### Earlier history (compressed — full detail at git tag `pre-avengers-archive`)

**May 2026 — Payments go real; trips and venues become a platform.** Stripe cut over to live
mode (real money), embedded Stripe Connect onboarding + Stripe Tax, and the buyer checkout was
made bulletproof (synchronous confirm + realtime safety net + a fixed per-order revenue leak in
installment plans). Trips reached full parity with events: dashboards, refund tiers, traveler
intake forms, installment payments, waitlists, pay-in-full opt-out. The venue platform was born
— physical-venue onboarding, an admin claims/verification queue, public venue pages, and AI
menu/activity parsers that turn a menu snap into sellable experiences. Group chat shipped for
trips and events with collab decks living in chat; QR ticketing moved to server-side rendering
with scanner teams. Mobile web got a reliability overhaul (blur-crash kill, white screens,
anonymous public pages), plus public brand pages with theme customization, Universal/App Links,
and the marketing-site cutover to usemingla.com. The engineering backbone landed too:
worktree-per-ORCH workflow, the cross-session COMMS ledger, and append-only regression-test CI.
(ORCH-0777 – ORCH-1025 era, PRs #60–#291)

**April 2026 — Two births: the consumer relaunch and Mingla Business.** The consumer app got
its pre-launch overhaul: the big preferences/category simplification, 29-language i18n, deep
analytics, the guided coach-mark tour, Android performance waves, a 24k-line dead-code
demolition ("Great Demolition and Rebuild"), and the signal library (fine dining, drinks,
brunch, nature, movies, theatre…) powering signal-aware curated experiences. Mingla Business
was born mid-month and sprinted through Cycles 0–11: design-system foundation, brand accounts
and teams, the event-creator wizard, ticketing + checkout, guest lists, and QR scanner +
check-in, on a new business schema with RLS. Admin gained the AI validation pipeline and the
place-pool command center. (ORCH-0340 – ORCH-0707 era)

**January – March 2026 — From prototype to a real native app.** The React Native consumer app
took shape: swipeable place decks backed by the place pool and an AI card-quality gate, collab
sessions with invites and mutual-like consensus, the Discover map (friends on the map, privacy
and Go Dark), onboarding with name capture, subscriptions via RevenueCat, push via OneSignal,
and the first production crash and security hardening (PII lockdowns, sign-out data-leak fixes).
(ORCH-0004 – ORCH-0330 era)

**September – December 2025 — Prototype era.** Mingla started as a Lovable-built web prototype:
an AI social planner with card recommendations, boards, collaboration sessions, and preference
filtering on Supabase — the concept the native apps were later built on.
