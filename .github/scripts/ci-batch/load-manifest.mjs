import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const BOOTSTRAP_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
// #3281: re-sealed after the four affected live providers added the reviewed,
// input-free exact-current-main recovery trigger to their metadata.
// #4037: re-sealed after the #922 business-web actionability provider gained
// the same input-free recovery trigger.
// #4084: re-sealed after the existing deploy-functions provider gained its
// exact supersession regression consumer.
// #2331: re-sealed after the #905 /links and #922 actionability providers
// gained the privacy-bar owners in their path scope (the /links route
// suppression module is retired).
// #4111: re-sealed after the #679 brand-page suite gained the brand page foot
// render proof and the message-sheet rework proof (issue_4111_*.render.test.tsx).
// #4111: re-sealed after the #2272 workflow escaped `+` in its +native-intent.tsx
// path filter (GitHub reads `+` as a pattern operator), updating its pathScope and sourceSha256.
// #3643: re-sealed after 39 per-issue providers dropped the Host jest steps that
// only re-ran files the required full suite already runs (new sourceSha256 and,
// where a whole job went, jobKeys/runtimeVersions/setupActions). Six sourceSha256
// patches for those rows are folded into the bootstrap and deleted.
// #3643 Phase 3D: re-sealed after 20 no-database Deno/Node workflows were folded
// in as primary suites of two new Deno hosts (20 suites, 93 commands, 2 classes
// and profiles, 20 legacy rows flipped to batched-historical, 4 provider records
// to batched-provider). The #2240 sourceSha256 patch is folded in and deleted.
// #3643 Wave 4: re-sealed after the 88 live workflow rows dropped their byte
// fingerprint (sourceSha256) and gained their per-job timeouts; the validator
// now checks those rows by property.
// #3643 Phase 3E: re-sealed after PostgreSQL workflows moved behind the one
// replay / one template-copy-per-suite execution class; Wave 1 also widens
// #2269 routing to the two retained #871 assertions it executes and makes every
// Phase 3E suite watch the shared PostgreSQL setup/contract it depends on.
// The four sourceSha256-only patches are deleted and that patch op is refused.
// [TEST-MOD-APPROVED #3643] Re-sealed once for the terminal 48-suite Phase 3E fold.
// #3643: re-sealed after retaining #1403/#1421's complete pre-fold routing.
// #3643: isolate the foundation migration fixture and retire the stale discovery rewind.
// #3643: keep the retained attendance TypeScript tests on Node 22.
// #2829 W7c: re-sealed after the Sites goldens test became one reviewed
// reference on the retained arm64 web-build provider.
// #3872: re-sealed after the census prerequisite migration and its two
// self-registering SQL proofs entered the preserved replay inventories, with
// the exact repair excluded from the deliberately filtered pre-#1931 replay.
// #4137: re-sealed again after the four Blog migrations and both executable
// PostgreSQL suites entered the same preserved full-history inventories, with
// exact historical exclusions in the deliberately pre-#1931 replay.
// #1318: re-sealed once more after the VAT migration entered those three
// preserved replay authorities on top of the #4137 Blog additions.
// #2829 / #3645: re-sealed after the two reviewed activation migrations and
// their local proofs entered the same three preserved replay inventories.
// #2829 / #3872: re-sealed after the Sites and Creator Program general-
// availability migrations and their local proofs entered those inventories.
// #4037: re-sealed after the Home Pulse lifetime-sales and analytics listing-
// type migrations and their executable proofs entered those replay inventories.
// #4167: re-sealed after the #1532 route timeout widened from five to ten
// minutes following two consecutive checkout/router timeouts.
// #4173: re-sealed after the Brand group roster migration and its local
// PostgreSQL proof entered the three preserved full-history inventories.
// #4174: re-sealed after the Explorer internal-brand isolation migration
// entered the same three preserved full-history inventories, with exact
// exclusions beside #4073 in the deliberately filtered historical replays.
// #4179: re-sealed after the Feature Guide reconciliation migration and its
// PostgreSQL and structural proofs entered the preserved inventories.
// #4179: re-sealed after the release-reason repair entered the same three
// preserved historical replay inventories.
// #4179: re-sealed after the explicit JSON-null repair and its proofs entered
// those inventories without changing any preserved commands.
// #4182 / #4187 / #4188: re-sealed after the Local/Creator media lifecycle,
// Admin program-messaging, and Stay staff-reservation migrations plus their
// registered PostgreSQL proofs entered the preserved replay inventories.
// #3355: re-sealed after Ari's improvement-system migration and registered
// PostgreSQL proof entered those same preserved inventories, including its
// exact exclusion from the deliberately pre-#1931 historical replay.
// #3643: re-sealed after renaming tests-append-only.yml → pre-merge-main-health.yml
// (display name already Pre-merge main health; path + provider registry catch up).
// #3281: re-sealed after PR8 door scan day-label migration entered the three
// preserved full-history inventories (1857/1931/2117).
// #3281: re-sealed after PR9 cancel-date migration entered the same inventories.
// #3281: re-sealed after PR10 byDate quantities migration entered the same inventories.
// #3281: re-sealed after PR7 public schedule-card migrations and structural
// proofs entered the preserved inventories, with exact exclusions from the
// deliberately pre-#1931 historical replay.
// #4202 / #4203: re-sealed after the retained-purchase and hidden-event read
// migration plus its registered PostgreSQL proof entered the three preserved
// full-history inventories.
// #3281 / #3645: re-sealed after the terminal by-date + Paystack finalizer
// re-emit entered those inventories and their filtered historical replays.
// #3281: re-sealed after the production-order repair and its proofs entered
// those inventories and the same filtered historical replays.
// #4202: re-sealed after the Explorer phone-identity release migration entered
// the three preserved full-history inventories. Its executable proof stays in
// the already-registered #4202/#4203 PostgreSQL suite.
// #4202: re-sealed after the Local audit-row auth detach entered the same
// inventories with its self-registered PostgreSQL retention proof.
// #4202: re-sealed after the retry-safe auth.users phone-release migration
// and its self-registered PostgreSQL proof entered those inventories.
// #4202: re-sealed after the GoTrue pending-phone sentinel repair entered the
// same inventories and extended the existing phone-release proof.
// #4202: re-sealed after retained shared identities gained the reviewed
// already-owned event-chat repair in those same inventories and proof suite.
// #2830: re-sealed after the Ari brand-completeness migration and registered
// PostgreSQL proof entered the three preserved inventories, with the migration
// excluded by exact filename from the pre-#1931 replay that omits its #3355
// control-plane prerequisite.
// #4216: re-sealed after the Creator rights migration entered the same three
// full-history replay inventories and gained an exact-file exclusion from the
// deliberately pre-#1931 replay that has no Creator/gig schema.
// #3281: re-sealed after the per-date maximum migration entered the same
// inventories and filtered replays.
// #3281: re-sealed after the day-limited tickets migration and its PostgreSQL
// proof entered the same inventories and filtered replays.
// #3281: re-sealed after the door active date migration followed them.
// #4226: re-sealed after the ticket buyer people migration and its proof followed them.
// #3281: re-sealed after the Extras schema migration joined the same replays.
// #4226: re-sealed after the host contacts people migration and its proof followed them,
// and the #1995 blast suite watches the one email footer line instead of the retired
// per-reason module.
// #3281: re-sealed after the webhook fee migration joined the same replays.
// #3281: re-sealed after the Extras checkout migration joined the same replays.
// #3355: re-sealed after the renumbered #3355/#2830 migrations and proofs entered
// the preserved inventories, and brand readiness, paid-tier terms and event seed
// truth joined the deliberately pre-#1931 replay's skip list by exact filename (#2492).
// #3355: re-sealed after the Ari flow runs migration joined that skip list by exact
// filename (it links runs to ari_agent_jobs from the skipped control-plane migration).
// #3281: register the Extras authoring migration and its proof the same way.
// #3281: register the public Extras migration and its proof the same way.
// #3355: register the Ari flow engine flag migration and its proof the same way.
// #4238: re-sealed after the list-audience migration, its proof and the tester's adversarial proof joined the same replays.
// #4250: re-sealed after the profiles admin-flag drop, its proof and its adversarial proof joined the same replays.
// #3281: register the Explorer buyable-date migration and its proof the same way.
// #4251: register the going-RSVPs cover type migration and its proof the same way.
// #4256: register the no-auto-promo-cards migration the same way.
// #4255: register the admin access and Work closed-range migrations the same way.
// #3281: register the fast Explorer listing rule migration and its proof the same way.
// #3281: register the per-date Explorer listing rule migration and its proof the same way.
// #4261: register the friend-share, plan, place-vote, referral and repin migrations.
// #4261: register the friend-request decline fix migration and its proof the same way.
// #3682: register the follow closeout migrations (waves 1-3) and their proofs the same way.
// #3682: register the tester send-time switch migration and adversarial proofs the same way.
// #3682: the roster suite runs the closeout subject and empty-roster proofs.
// #3281: register the Discover card price and bookable experiences migration (20280402004265) and its proof the same way.
// #4273: register the Invite step sources-and-methods migration and its proofs the same way.
// #4273: register the Blast combined-audience migration and its proofs the same way.
// #4273: register the tester adversarial proofs the same way.
// #4273: register the rework proofs the same way.
// #4261: renumber the #4261 migrations after #3682, then after #4265 and #4270, before #4273 (20280403034261-20280403084261).
// #4261: the #1880 expanded-share suite also runs when PlansSheet or PlanMatchesSheet change (they own the two collab mounts now).
// #4273: register the tester retest proofs the same way.
// #4273: register the segment-count proofs the same way.
// #3281: register the door extras migration and test
// #3281: register the private link dates migration and test
// #3281: skip the private link dates migration on the pre-feature lanes
// #3281: skip the private link dates migration on the pre-feature lanes
// #4275: register the signal batch and cron stagger migrations and their proofs the same way.
// #4283: register the accept single-member-row migration and its proofs
// #4276: register the place-pipeline migrations and their proofs.
// #4276: skip the conductor, score-hold and unparseable-date migrations on the pre-#1931 replay
// (the conductor re-emits the #3872 Local picker typed on public.locals, which that replay skips).
// #2830: register the Website setup takeover migration and its proof; the recovery workflow names the Studio migration guard.
// #4271: re-sealed after the door pay migration and proof entered the preserved
// inventories and the migration joined the pre-#1931 replay skip list by exact filename.
// #4271: register the tester adversarial PostgreSQL proof the same way.
// #4271: register the rework implementor PostgreSQL proof the same way.
// #4271: register the Apple build PostgreSQL proof the same way.
// #4271: register the final tester PostgreSQL proof the same way.
// #4271: re-sealed after merging origin/main (#4261/#4273/#4275/#4276/#4283/#2830 rows kept beside the #4271 rows).
// #3645: register the stay flat-net migration the same way.
// #4271: register the resumable stuck-refund migration and its PostgreSQL proof.
// #4271: register the resumable stuck-refund tester PostgreSQL proof (PR #4303).
// #4271: PR #4303 rework renamed the migration and both proofs (failed-refund guard).
// #4276: re-sealed after merging origin/main (#4271/#2830 rows kept beside the #4276 rows).
// #4294: re-sealed after the Mingla connector migration entered the preserved inventories
// and joined the pre-#1931 replay skip list by exact filename.
// #4294: re-sealed after the connector's tester PostgreSQL proof joined the pre-#1931 template suites' inventories.
// #4294: re-sealed after merging origin/main (#4303 and #4296 rows kept beside the #4294 rows).
// #4273: register the buyer/follower auto opt-in, honest-quote and account-opt-out migrations and their proofs.
// #4270: register the brand plan migrations (20280427004270-20280427024270) and their proofs the same way.
// #3645: register the unpaid-release-holds migration and its PostgreSQL proof the same way.
// #4294: re-sealed after the company sign-in migration and its PostgreSQL proof entered the preserved inventories
// and the migration joined the pre-#1931 replay's exact-file exclusion.
// #4294 (tester): re-sealed after the company sign-in tester proof entered the preserved inventories.
// #4271: register the tap buyer-name migration and its PostgreSQL proofs the same way.
// #4271: the tap buyer-name migration joins the pre-#1931 replay's exact-file exclusion beside door pay.
// #3645: register the sell-and-publish integrity migration, its PostgreSQL proof and its re-emit guard.
// #3645: the sell-and-publish migration joins the pre-#1931 and pre-#2117 replay skip lists by exact filename.
// #4304: register the Brand group live migration and its PostgreSQL proof the same way.
// #4270 W7: register the admin Brand group inbox suites; migration 20280502004270; re-sealed after merging origin/main (#4322).
// #4273 polish: register the sent-previews migration, its PostgreSQL proofs (implementor + tester) and the campaign-screen render proof.
// #1023: skip the wave 2 theme migration (20280430011023) in the #1931 and #2117 filtered replays.
// #1023: re-sealed after merging origin/main (#3645, #4294, #4271, #4304, #4270 W7 rows kept beside the #1023 rows).
// #1023: re-sealed after merging origin/main 4ace6deafa (#4331 rows kept beside the #1023 rows).
// #1023: re-sealed after merging origin/main 5dd7f103ca (#4273 polish rows kept beside the #1023 rows).
// #1023: re-sealed after merging origin/main 6038982e1a.
// #4318: register the /links migration (20280508004318) and its implementor and tester PostgreSQL proofs; it joins the pre-#1931 replay skip list by exact filename.
// #4318: register the /links live-cities (20280514004318) and strip end-date (20280515004318) migrations and their PostgreSQL proofs; the end-date migration joins the pre-#1931 replay skip list by exact filename.
// #4318: register the /links per-city places migration (20280516004318) and its PostgreSQL proof the same way.
// #4273 unpriced country: register the sms-unpriced-country migration and its PostgreSQL proofs (implementor + tester); re-sealed after merging origin/main.
// #4273 all countries: register the all-countries / automatic-prices PostgreSQL proof.
// #4273 all countries (tester): register the tester adversarial PostgreSQL proof.
// #4273: re-sealed for the SMS opt-out link suite.
// #4273: re-sealed after merging origin/main (#4318) and moving the migration to 20280522004273.
// #4273 tester retest 3: register the SMS opt-out scope PostgreSQL proof.
// #4273: re-sealed after moving the migration to 20280522004273 (above production's 20280521004334).
// #4273: re-sealed after merging origin/main (#4350).
// #4339: register the Ari draft hand-off migration (20280512004339) and its implementor PostgreSQL proof in the #1857, #1931 and #2117 replay lanes, after merging origin/main 2e6e331749 (#4318).
// #4339: the #1931 lane skips 20280512004339_issue_4339_site_prompt_drafts.sql by exact filename (#2492 closure guard: CREATE TABLE columns are not credited as definitions).
// #4339 round A: register the Book a call leads migration (20280520004339) and its implementor PostgreSQL proof in the #1857, #1931 and #2117 replay lanes (the #2492 closure guard passes without a skip).
// #4339 round B: register the ad marketing destinations migration (20280522004339) and its implementor PostgreSQL proof in the #1857, #1931 and #2117 replay lanes.
// #4339: re-sealed after merging origin/main 85dba1f14e (#4349 /links rows kept beside the #4339 rows).
// #4339: re-sealed after merging origin/main 28f88fea6d (#4334 and #4273 rows kept beside the #4339 rows) and adding marketing-capture.ts to the issue-905 path scope.
// #4347: drop the deleted expanded hero and busyness service from the #1880 and #1605 originPaths (both files are gone; the patterns matched nothing).
// #4347: re-sealed after merging origin/main 671964a09e (#4339 and #4273 rows kept beside the #4347 originPath removals).
// #4255: register the work card email migration (20280524004255) and its implementor PostgreSQL proof in the #1857, #1931 and #2117 replay lanes.
// #4334: register the tester place-id re-pick PostgreSQL proof (issue_4334_place_id_repick.tester.pg17) in the #1931 and #2117 replay lanes.
// #4273 country switches: register the sms-country-switches migration and its PostgreSQL proof.
// #4273: re-sealed after merging origin/main be7ffb3fbd (#4255 and #4353 rows kept beside the #4273 rows).
// #4273: re-sealed after renumbering the country switches migration 20280523004273 -> 20280526004273 (above #4255's 20280524004255 and #4334's reserved 20280525004334).
// #4273: re-sealed after merging origin/main fff9cf9e16 (#4334 tester proof rows kept beside the #4273 rows).
// #4273: re-sealed after merging origin/main cb00e54bf8 (#4360 rows kept beside the #4273 rows).
// #4334: register the place-id follow-ups migration (20280526004334) in the #1857, #1931 and #2117 replay lanes, and its implementor PostgreSQL proof in the #1931 and #2117 lanes.
// #4334: re-sealed after merging origin/main d27f8b82c0 (#4273 country switch rows kept beside the #4334 follow-up rows).
// #4334: re-sealed after registering the tester follow-ups PostgreSQL proof (issue_4334_place_id_followups.tester) beside the implementor proof in the #1931 and #2117 lanes.
// #4334: re-sealed after merging origin/main b9d9ba3bab (#3645 payout ledger rows kept beside the #4334 follow-up rows).
// #4382: drop the deleted FeedbackHistorySheet.tsx from the #1540 pathScope (the file is gone; the path matched nothing); re-sealed.
// #4382: register the ticket Product stage migration (20280613044382) in the #1857, #1931 and #2117 replay lanes; re-sealed.
// #4382: register the tester adversarial PostgreSQL proof in the #1931 and #2117 lanes; re-sealed after merging origin/main b805c52b1d.
// #4382: register the support write guards migration (20280613054382) in the replay lanes; re-sealed.
// #4383: re-sealed after registering the Communications scheduling migration and its PostgreSQL proof in the #1857, #1931 and #2117 lanes.
// #4383: re-sealed after registering the tester adversarial PostgreSQL proof in the #1931 and #2117 lanes.
// #4382: re-sealed after merging origin/main 2aa45c6da1 (#4383 rows kept beside the #4382 rows).
// #4382: re-sealed after renumbering the Support Desk migrations to 20280613*4382.
// #3355 Wave B: re-sealed after registering the Feature Guide search and Wave B content migrations and the search PostgreSQL proof.
// #3355 Wave D: re-sealed after registering the memory, gap-logging and Wave D Feature Guide migrations and their PostgreSQL proofs.
// #3355 Wave D step 0: re-sealed after adding the two Wave A migrations to the #1931 replay lane skip list (issue-2492 closure).
// #3355 rework 1: re-sealed after merging origin/main 1d23fd97e8 (#4383 rows kept) and renaming the nine #3355 migrations out of the 20280606xx3355 range (since renumbered to 20280628xx3355, rework 3).
// #3355 rework 1: register 20280628103355 (discount-codes Feature Guide sync) in the #1857, #1931 and #2117 replay lanes (skipped by exact filename in #1931), and the rework and tester adversarial PostgreSQL proofs in #1931 and #2117.
// #3355 rework 2: register 20280628113355 (memory brand voice at read; skipped by exact filename in #1931) and 20280628123355 (quality panel follow-up runs) in the #1857, #1931 and #2117 lanes, and the rework 2 PostgreSQL proof in #1931 and #2117.
// #3355 rework 2: re-sealed after merging origin/main 62aabbdc6d (#4382 rows kept beside the #3355 rows).
// #3355 rework 3: register 20280628133355 (a follow-up setup run never cancels a parked or live one) in the #1857, #1931 and #2117 lanes, and the rework 3 PostgreSQL proof in #1931 and #2117.
// #3355 rework 3: merged origin/main 4ba9ec5ec3 (#4382 retire-beta-feedback rows kept) and renumbered the thirteen #3355 migrations into 20280628xx3355 (after production's 20280622004382); re-sealed.
// #4382: register the retire-beta-feedback migration (20280622004382) in the #1857, #1931 and #2117 replay lanes; re-sealed.
// #4255: re-sealed after registering the Work board v2 and Mingla team migrations and their PostgreSQL proofs in the #1857, #1931 and #2117 lanes.
// #4255: re-sealed after registering the tester adversarial PostgreSQL proof in the #1931 and #2117 lanes.
// #4255: re-sealed after registering the rework migration (20280624054255) and its PostgreSQL proof in the #1857, #1931 and #2117 lanes.
// #4255: re-sealed after registering the rework tester adversarial PostgreSQL proof in the #1931 and #2117 lanes.
// #4255: re-sealed after merging origin/main 62aabbdc6d (#4382 rows kept beside the #4255 rows).
// #4255: re-sealed after renumbering the Work board v2 and Mingla team migrations to 20280624*4255 (above production's applied 20280613054382).
// #4255: re-sealed after registering the rework 2 migration (20280624064255) and its PostgreSQL proof in the #1857, #1931 and #2117 lanes.
// #4255: re-sealed after registering the rework 2 tester adversarial PostgreSQL proof in the #1931 and #2117 lanes.
// #4255: re-sealed after merging origin/main 4ba9ec5ec3 (#4382 retire-beta-feedback rows kept beside the #4255 rows).
// #4255: re-sealed after renumbering the seven Work board v2 and Mingla team migrations to 20280624*4255 (above production's applied 20280622004382).
// #3355 rework 4: re-sealed after merging origin/main 3dc6c44093 (#4255 rows kept beside the #3355 rows).
// #3355 rework 6: re-sealed after merging origin/main 559e3e6902 (#3281 rows kept beside the #3355 rows).
// #3355 rework 6: register 20280628143355 (payout readiness for brand members) in the #1857, #1931 and #2117 replay lanes, and its PostgreSQL proof in #1931 and #2117; re-sealed.
// #3355 rework 7: register the retest 7 payout readiness callers PostgreSQL proof in the #1931 and #2117 replay lanes; re-sealed.
// #3355 rework 8: merged origin/main 811c033211 (#4398 rows kept) and renumbered the fourteen #3355 migrations to 20280628013355 … 20280628143355 (above main's 20280626044398), in order; re-sealed.
// #3355 final fix: register 20280628153355 (Ari understands first on for all brands, idempotent) in the #1857, #1931 (skipped by exact filename) and #2117 replay lanes, and its PostgreSQL proof in #1931 and #2117; re-sealed.
// #4389: re-sealed after registering the four #4389 migrations (renumbered 20280629*4389, above main's 20280626*4398) and their PostgreSQL proofs in the #1857, #1931 and #2117 lanes, skipping the brand setup migration in the #1931 template replay, and merging origin/main 811c033211.
// #4389: re-sealed after skipping the brand setup and Ari brand operation migrations in the #2117 pre-landing replay (they re-emit #2117-gated readers before #2117 lands there).
// #4389: re-sealed after merging origin/main b638986fc0 (#4402 rows kept beside the #4389 rows) and renumbering the four #4389 migrations to 20280701*4389 (above main's 20280630004402).
// #4402: re-sealed after registering the shared payee bank account migration (20280701904402) and its PostgreSQL proof in the #1857, #1931 and #2117 lanes, and skipping it in the #1931 template replay.
// #4402: register the creator review migration (20280702004402) and its pg17 suite in the #1857, #1931 and #2117 replay lanes; re-sealed.
// #4402 rework: register the tester's creator review pg17 proof beside the implementor's; re-sealed.
// #4402: register the admin band-change migration (20280702104402, skipped in the #1931 template replay) and its pg17 proof; re-sealed.
// #4402: re-sealed after merging origin/main 87e922d58f (the shared payee bank rows kept beside the creator review and band-change rows).
// #3355 merge of #4404 (origin/main 7ace80fa0a; #4389 and #4402 rows kept beside the #3355 rows): renumbered the fifteen #3355 migrations to 20280702013355 … 20280702153355 (above main's 20280701304389), in order; re-sealed.
// #3355 rework 9: register 20280702163355 (deleting a chat closes its Ari flow runs) in the #1857, #1931 (skipped by exact filename) and #2117 replay lanes, and its PostgreSQL proof in #1931 and #2117; re-sealed.
// #3355 merge of origin/main c6941aac31 (#4402 payee_shared_bank_account rows kept beside the #3355 rows); re-sealed.
// #3355 CI fix 1: skip 20280702133355 (flow follow-up never cancels, typed on the skipped ari_flow_runs) by exact filename in the #1931 pre-landing replay, and M2 in the #2117 one; re-sealed.
// #4402 merge of origin/main d116790964 (#4422 rows and #1931 skips kept beside the #4402 ones); re-sealed.
// #3355 CI fix 1b: withdraw 20280702103355 (discount codes Feature Guide sync) from the #1857, #1931 skip and #2117 lanes; re-sealed.
// #4402: register 20280704504402 (NGN minimum creator fee is ₦100) in the #1857, #1931 and #2117 replay lanes; re-sealed.
// #4402: register 20280704604402 (upload deadline follows the agreed due) and its PostgreSQL proof; re-sealed.
// #4402 merge of origin/main a5a5c59094 (#4419 20280706004419 rows kept after the #4402 rows); re-sealed.
// #4402 CI fix: skip the seven polish migrations (gig tables from skipped #3872) by exact filename in the #1931 pre-landing replay, and M2 in the #2117 one; re-sealed.
// #4402 merge of origin/main d116790964 (#4422 rows and #1931 skips kept beside the #4402 ones); re-sealed.
// #4423 Wave 2: register the four set-based ops/team_inbox migrations in the #1857, #1931 and #2117 lanes, and their two PostgreSQL proofs in #1931 and #2117; re-sealed.
// #4423 Wave 3: register the pre-request limit and database health migrations in the #1857, #1931 and #2117 lanes, and their PostgreSQL proof in #1931 and #2117; re-sealed.
// #4423 Wave 4a: register the hot-table index and cron hygiene migration in the #1857, #1931 and #2117 lanes, and its PostgreSQL proof in #1931 and #2117; re-sealed.
// #4423 Wave 4a CI fix: skip 20280707204423 (indexes on order_attributions, order_add_on_line_items, conversations.program_target_user_id) by exact filename in the #1931 and #2117 filtered replays, which never create them; re-sealed.
// #4423 integration: merged origin/main a5a5c59094 (#4419 20280706004419 rows kept beside the #4423 rows) and renamed the thirteen #4423 migrations 20280705*4423 to 20280707*4423 (after 20280706004419), in order; re-sealed.
// #4423 integration 2: merged origin/main ce482c996c; re-sealed.
// #4238 Wave 4: registered M-3 (checkout_surface) and its pg17 proof in the 1857/1931/2117 suites; re-sealed.
// #4238 Wave 3: registered M-2 (host funnel: ad_match_contexts, host event types, sign-up and first-publish triggers) and its pg17 proof in the 1857/1931/2117 suites; re-sealed.
// #4238 integration: merged origin/main 10ffda1eb5 (#4430 20280707424430 kept before the three #4238 rows); re-sealed.
// #4339 strip time zones: register 20280708004339 in the #1857, #1931 and #2117 lanes (skipped by exact filename in the #1931 filtered replay, which never creates links_strips) and its PostgreSQL proof in #1931 and #2117; re-sealed.
// #4339 tester: register issue_4339_links_strip_time_zone.tester.pg17.test.sql (and its .ci-suite.json) beside the implementor proof in #1931 and #2117; re-sealed.
// #4238 integration 2: merged origin/main ad97118a28 (#4339 20280708004339 and its implementor/tester proofs kept after the three #4238 rows); re-sealed.
// #4238 order after production: renamed the three #4238 migrations (M-1, M-3, M-2) from 20280707*4238 to 20280708014238/20280708024238/20280708034238 (after 20280708004339, already applied in production), same relative order, in the #1857, #1931 and #2117 lanes; re-sealed.
// #4430 Local review owner-read RLS test (after merging origin/main ad97118a28): listed the new pg17 suite and its sidecar in the #1931 and #2117 replay inventories; re-sealed.
// #4238 integration 3: merged origin/main f512401461 (#4438: the #4430 local review owner-read pg17 suite and sidecar kept in the #1931 and #2117 inventories beside the #4238 rows); re-sealed.
// #4420 filtered replay lanes (#1931, #2117) skip the experience venue-line privacy migration by exact filename; re-sealed.
// #4435 Phase 0 characterization: listed the four new pg17 suites and their sidecars in the #1931 and #2117 replay inventories beside the #4436 rows; re-sealed.
// #4436 follow-up 20280708046436 (invited self-join, own prefs): listed the migration after the #4436 guard migration in the #1857, #1931 and #2117 lanes and its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4435 W2: listed migrations 20280708054435 (group lifecycle) and 20280708064435 (chat reopen and clear) after 20280708046436 in the #1857, #1931 and #2117 lanes, and their four pg17 suites and sidecars in the #1931 and #2117 inventories; re-sealed.
// #4435 W3c: registered the concurrent-add cap race suite (issue_4435_group_cap_race) and its sidecar in the #1931 and #2117 inventories; re-sealed.
// #4435 CI fix: skip 20280708054435 (group lifecycle; re-emits the plan RPCs over chat_plans, chat_plan_place_options and chat_plan_place_votes, which only the skipped #4261 migrations create) by exact filename in the #1931 filtered replay; re-sealed.
// #4435 QA follow-up: listed migration 20280709004435 (group QA fixes) after 20280708064435 in the #1857, #1931 and #2117 lanes, skipped it by exact filename in the #1931 filtered replay (it re-emits functions over chat_plans, which only the skipped #4261 migrations create), and registered the group-edges tester suite and the group QA fixes suite with their sidecars in the #1931 and #2117 inventories; re-sealed.
// #4238 W4c: listed the three W2/W3/W4b migrations after 20280709004435 in the #1857, #1931 and #2117 lanes and registered their three pg17 proofs with sidecars in the #1931 and #2117 inventories; re-sealed.
// #4238 W6a: merged origin/4420-host-graphite-glass (its MANIFEST row change kept beside the #4238 W2/W3/W4b rows); re-sealed.
// #4238 rework 1 (tester P1-4): skipped the three #4238 W2/W3/W4b migrations by exact filename in the #1931 filtered replay (the #2492 closure guard keys on the plan_id and platform column names, which only skipped migrations also define on that lane) and registered the tester's host_ad_roles adversarial pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4435 leftovers: listed migration 20280710004435 (leftovers) after 20280709004435 in the #1857, #1931 and #2117 lanes (the #1931 filtered replay runs it: it passes there), and registered the group QA fixes tester suite, the leftovers suite and the leftovers tester suite with their sidecars in the #1931 and #2117 inventories; re-sealed.
// #4238 rework 2: merged origin/main 3c6bbd0d81 (#4435 leftovers row 20280710004435 kept in filename order between the #4238 rows); re-sealed.
// #4238 rework 3: renumbered the three #4238 migrations to 20280715004238 / 20280716004238 / 20280717004238 (after origin/main 20280710004435 and the sibling #4452 20280714004452) in the #1857, #1931 and #2117 lanes and the #1931 exact-filename skip list; re-sealed.
// #4452 retest 1: registered the tester rework adversarial pg17 suite and its sidecar in the #1931 and #2117 inventories; re-sealed.
// #4452 merge of main after #4454: kept the #4435 leftovers migration ahead of the #4452 migrations in the #1857, #1931 and #2117 lanes; re-sealed.
// #4452 PR checks: skipped the five #4452 migrations the #2492 closure gate cannot prove on the filtered #1931 template replay, by exact filename; re-sealed.
// #4452 PR checks round 2: also skipped the #4452 tool follow-ups migration (it seeds the skipped forms tables at run time) on the #1931 template replay, by exact filename; re-sealed.
// #4238 rework 5: merged origin/main e4cb2564bd (#4452 rows kept in filename order ahead of the #4238 rows; both #1931 exact-filename skip blocks kept); re-sealed.
// #4238 W7: merged origin/4420-host-graphite-glass a196ecfd7a (its 20280719004420 migration row kept after the #4238 rows in the #1857, #1931 and #2117 lanes); re-sealed.
// #4420 filtered replay lanes (#1931, #2117) skip the experience venue-line privacy migration by exact filename; re-sealed.
// #4238 W8: merged origin/4420-host-graphite-glass c37722672d (its 20280718004420 row and the #1931 filtered-replay skip for 20280719004420 kept beside the #4238 rows); re-sealed.
// #4420 merge of main after #4455: kept the #4420 Stay other-contact and experience venue-line privacy migrations after the #4452 migrations in the #1857, #1931 and #2117 lanes, and the #4420 venue-line privacy skip after the #4452 skips in the #1931 filtered replay; re-sealed.
// #4420 Stay other-contact recovery: listed migration 20280721004420 (recovery view + rate-limited resend) after 20280719004420 in the #1857, #1931 and #2117 lanes, and its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4420 experience stop-detail visibility migration and pg17 suite listed in the #1857, #1931 and #2117 replay inventories; the filtered #1931 and #2117 lanes skip it by exact filename; re-sealed.
// #4420 discovery coarse-point migration and pg17 suite listed in the #1857, #1931 and #2117 replay inventories; the filtered #1931 and #2117 lanes skip it by exact filename; re-sealed.
// #4238 rework 7: merged origin/4420-host-graphite-glass 33f59ce94a (its 20280721/22/23004420 rows and the #1931 filtered-replay skips for 20280722/23004420 kept beside the #4238 and #4452 B8 rows); re-sealed.
// #4452 follow-up B8: registered the dashboard last-lead migration in the #1857, #1931 and #2117 lanes and its pg17 suite (with sidecar) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 template replay by exact filename; re-sealed.
// #4452 follow-up B21/B22/B25: registered the flow-validator migration in the #1857, #1931 and #2117 lanes and its pg17 suite (with sidecar) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 template replay by exact filename; re-sealed.
// #4238 rework 8: merged origin/main 09a16113f2 (#4452 B21/B22/B25 flow-validator row and #1931 skip kept beside the #4238/#4420 rows) and origin/4420-host-graphite-glass; re-sealed.
// #4420 event location migration and pg17 suite listed in the #1857, #1931 and #2117 replay inventories; the filtered #1931 and #2117 lanes skip it by exact filename; re-sealed.
// #4452 follow-up B8: registered the dashboard last-lead migration in the #1857, #1931 and #2117 lanes and its pg17 suite (with sidecar) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 template replay by exact filename; re-sealed.
// #4453 6a: added the 6a design-keys migration to the post-replay lanes and its pg17 suite; re-sealed.
// #4453 milestone 3 + 6a merge: both milestones' migrations and pg17 suites (proof part implementor + tester) registered; re-sealed.
// #4453 6b: added the 6b design-keys migration to the post-replay lanes and its pg17 suite; re-sealed.
// #4453 6c: added the 6c design-keys migration to the post-replay lanes and its pg17 suite; re-sealed.
// #4453 milestone 5 (after the 6c merge): booking-reads (implementor + tester) and stay-feed-kind migrations and pg17 suites registered; re-sealed.
// #4453 milestone 5 (after the 6c merge): booking-reads (implementor + tester) and stay-feed-kind migrations and pg17 suites registered; re-sealed.
// #4453 milestone 7: ari-design-pass migration and its pg17 suite registered; re-sealed.
// #4453 milestone 7 tester: adversarial design-pass pg17 suite registered; re-sealed.
// #4453 milestone 9: offering-detail migration and pg17 suites (implementor + tester) registered; re-sealed.
// #4453 milestone 7 merged with milestone 9 (0b096f08f0): union of both registrations; re-sealed.
// #4453 milestone 10: plan-preview migration and pg17 suite registered; re-sealed.
// #4453 milestone 11: ari-add-page flag migration and its pg17 suite registered; re-sealed after merging milestone 10.
// #4453 milestone 11 tester: the ari_add_page tester pg17 suite registered; re-sealed.
// #4453 final pass: renamed design_keys, website_proof_part and design_keys_6a to 20280807004453, 20280807014453 and 20280807024453 so they sort after main's 20280725004452; re-sealed.
// #4452 follow-up B21/B22/B25: registered the flow-validator migration in the #1857, #1931 and #2117 lanes and its pg17 suite (with sidecar) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 template replay by exact filename; re-sealed.
// #4456: listed migration 20280721004456 (unsend and delete for me) after 20280720004452 in the #1857, #1931 and #2117 lanes, and registered its pg17 suites and sidecars in the #1931 and #2117 inventories; re-sealed.
// #4456 merge of main after #4461: kept 20280721004456 (unsend and delete for me) ahead of 20280725004452 (flow validator) in the #1857, #1931 and #2117 lanes; re-sealed.
// #4420 merge of main after #4462: kept the #4420 migrations and #4420 filtered-replay skips alongside 20280720004452, 20280721004456 and 20280725004452 in the #1857, #1931 and #2117 lanes; re-sealed.
// #4420 Stay pay link brand theme: listed migration 20280731104420 after 20280725004452 in the #1857, #1931 and #2117 lanes (plpgsql body, no filtered-replay skip needed; both filtered replays verified) and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4238 pre-PR merge of origin/main b855affc45 (#4420 merged): took main's rows and #1931 filtered-replay skips, renumbered the #4238 migrations to 20280801004238 / 20280802004238 / 20280803004238 (after main's 20280731104420) in the #1857, #1931 and #2117 lanes and the #1931 skip list; re-sealed.
// #3645 bundle 2A: registered the per-stop paid-price migration in the #1857, #1931 and #2117 lanes and its pg17 suite, live-patch declarations and structural suite (with sidecars) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 temp replay and the #2117 phase-1 chain (its precondition needs source migrations those lanes skip).
// #4459 merge of main after #4466: listed migration 20280805004459 (brand Guest chat, renamed from 20280730004459 to sort after main's 20280803004238 and #4473's 20280804004473) after 20280803004238 in the #1857, #1931 and #2117 lanes and the #1931 exact-filename skip list, kept its pg17 suites and sidecars in the #1931 and #2117 inventories; re-sealed.
// #3281 bundle 3: registered the Ari experience parity pg17 tester suite (with sidecar) in the #1931 and #2117 inventories.
// #4453 final rework: skipped the booking-reads migration (20280807044453) on the filtered #1931 and #2117 template replays by exact filename (it calls #3313 helpers and reads #3827 ticket_type_links, which those replays skip; #2492 closure); re-sealed.
// #4453 final rework 2: the design_keys migration (20280807004453) skipped on the filtered #1931 template replay by exact filename (its CHECK reads brand_site_plans.design_key, added only by the skipped #2830 migrations); re-sealed.
// #4453 merge of main after #4481: renumbered the eleven #4453 migrations to 20280807004453..20280807104453 so they sort after #4473's 20280806004473 (production head), listed after main's rows in the #1857, #1931 and #2117 lanes, and kept main's plus the #4453 filtered-replay skips; re-sealed.
// #4389 implementor (764896f3c0): listed migration 20280808004389 (setup polish: brand terms record, hold rail, derived free-only) after 20280806004473 in the #1857, #1931 and #2117 lanes and registered its implementor pg17 suite (with sidecar) in the #1931 and #2117 inventories; re-sealed. Rework 2 changes the migration's contents only (no new files); seal unchanged.
// #4389 tester: registered the setup-polish tester adversarial pg17 suite (with sidecar) in the #1931 and #2117 inventories; re-sealed.
// #4389 setup polish: skipped 20280808004389 in the #1931 pre-landing template replay (it re-emits brand_readiness_internal, which needs brand_readiness_catalog from the skipped 20280307003355); re-sealed.
// #4389 merge of main after #4453: kept main's eleven #4453 rows and skip lines, listed 20280808004389 after them and kept its #1931 skip line; re-sealed.
// #4238 merge of main after #4453 and #4389: kept main's #4453 and #4389 rows, listed 20281118004238 and 20281118014238 after them; re-sealed.
// #3645 payout gaps: listed migration 20280809003645 in the #1857, #1931 and #2117 lanes (after main's #4453 and #4389 rows), registered its pg17 suite and sidecars in the #1931 and #2117 inventories, and skipped it by exact filename on the #1931 and #2117 filtered template replays (#2492 closure); re-sealed.
// #3645 merge of main after #4238: listed 20280809003645 before main's 20281118004238 and 20281118014238 rows (filename order); re-sealed.
// #3645 bundle 2C: registered the paid/free choice migration in the #1857, #1931 and #2117 lanes and its pg17 suite and declared patches (with sidecar) in the #1931 and #2117 inventories, and skipped it on the filtered #1931 temp replay and the #2117 phase-1 chain (its precondition needs 20280801003645, which those lanes skip).
// #4453 Website workspace (team requests): listed migrations 20281119004453 (website team requests) and 20281119014453 (workspace content ranks, audit vocabulary, Ari step events) after 20281118014238 in the #1857, #1931 and #2117 lanes and registered their two implementor pg17 suites (with sidecars) in the #1931 and #2117 inventories; re-sealed. The unmerged #4490 branch also adds rows and re-seals: whichever merges second re-seals again.
// #4226 tester suites: registered the people journey tester and retest pg17 suites (with sidecars) in the #1931 and #2117 inventories; re-sealed.
// #4508: registered the bring-a-friend RSVP migrations and their pg17 suites in the #1857, #1931 and #2117 inventories.
// #4508 tester: register issue_4508_bring_a_friend.tester.adversarial.pg17.test.sql (and its .ci-suite.json) beside the implementor proof in #1931 and #2117; re-sealed.
// #4508 tester retest: register issue_4508_one_place.tester.retest.pg17.test.sql (and its .ci-suite.json) beside the other #4508 proofs in #1931 and #2117; re-sealed.
// #4508 merge of main after #4226: listed the two #4508 migrations after main's 20281118024226 row and kept both lanes' skip lines; re-sealed.
// #4453 merge of main after #4226: kept main's 20281118024226 row before the two #4453 rows in the #1857, #1931 and #2117 lanes; re-sealed.
// #4490 P1-1 implementor: listed migrations 20281203004490 (venue spaces + features) and 20281203054490 (#2099 pin owner) after 20280808004389 in the #1857, #1931 and #2117 lanes, registered the P1 features pg17 suite (with sidecar) in the #1931 and #2117 inventories, skipped the pin owner on the filtered #1931 template replay, and added both migrations to the #2099 provider path scope; re-sealed.
// #4490 P1-2 implementor: listed migration 20281203014490 (hours: windows, special days) between 20281203004490 and the #2099 pin owner in the #1857, #1931 and #2117 lanes, registered the P1 hours pg17 suite (with sidecar) in the #1931 and #2117 inventories, and added the migration to the #2099 provider path scope; re-sealed.
// #4490 P1-3 implementor: listed migration 20281203024490 (events.venue_id/space_id/space_use + issue_4490_set_event_venue) before the #2099 pin owner in the #1857, #1931 and #2117 lanes, registered the P1 event-venue pg17 suite (with sidecar) in the #1931 and #2117 inventories, and added the migration to the #2099 provider path scope; re-sealed.
// #4490 P1-4 implementor: listed migration 20281203034490 (experience creator fixes) before the #2099 pin owner in the #1857, #1931 and #2117 lanes, registered its pg17 suite (with sidecar) in the #1931 and #2117 inventories, and skipped it by exact filename on the filtered #1931 and #2117 template replays; re-sealed.
// #4490 P1-5 implementor: listed migration 20281203044490 (pg_public_venue_page, Host preview, admin read) before the #2099 pin owner in the #1857, #1931 and #2117 lanes and registered its pg17 suite (with sidecar) in the #1931 and #2117 inventories; re-sealed.
// #4490 P1 venue grants implementor: listed migration 20281203064490 (issue_4188_set_member_venue_grants widened to venue.* capabilities and every non-stay venue type) and registered its pg17 suite (with sidecar); re-sealed.
// #4490 P2-1 implementor: listed migration 20281203074490 (venue offer engine: offer kinds on stay_offerings, pools, price options, booking settings, Stays isolation guards) and registered its pg17 suite (with sidecar); re-sealed.
// #4490 P2-2/P2-3 implementor: listed migrations 20281203084490 (venue offer checkout and cancel), 20281203094490 (check-in) and the #2099 pin owner 20281203104490 (skipped by exact filename on the filtered #1931 replay, like the P1 pin owner), registered their pg17 suites (with sidecars) and added them to the #2099 provider path scope; re-sealed.
// #4490 P2 implementor: skipped the P2 venue offer migrations (and, on the #2117 lane, the P2 pin owner) by exact filename on the filtered #1931 and #2117 template replays (issue-2492 C-1 closure); re-sealed.
// #4490 P2-7 implementor: listed migration 20281203114490 (admin_list_venue_offers, Admin venue offer list) after the P2 pin owner in the same lanes and registered its pg17 suite (with sidecar); re-sealed.
// issue #4490 P3 booking access: migration 20281203124490 and its pg17 suite registered; re-sealed.
// issue #4490 P3 collect online: migration 20281203134490 and its pg17 suite registered; re-sealed.
// issue #4490 P3-1 packages and deposits: migration 20281203144490 and its pg17 suite registered; re-sealed.
// #4490 P4-1 private hire registered; re-sealed.
// issue #4490 P5-1 tables, floor plan, waitlist, by the hour; re-sealed.
// issue #4490 P4 follow-up: hours you set, hire changes, damage deposit; re-sealed.
// issue #4490 P3 follow-up money fixes; re-sealed.
// issue #4490 P5 test pins follow the new guest writer; re-sealed.
// issue #4490 P5 follow-ups: hour pricing contract, flexible too-soon, calendar party; re-sealed.
// issue #4490 P6-1: memberships migration + pg17 suite registered; re-sealed.
// issue #4490 fix round 1: past-midnight service windows; re-sealed; re-sealed.
// issue #4490 fix round 1: features at create, presets, restore, member payments, hours flag, collected today; re-sealed; re-sealed.
// issue #4490 fix round 2: copy an offer as a draft, runs until, schedule saves keep selling; re-sealed.
// issue #4490 fix round 3: an event takes its space, combinations, calendar part in use; re-sealed.
// #4490 merge of main (#3645, #4238, #4226, #4453 rows): kept main's rows and skip lines beside the #4490 rows in filename order; re-sealed.
// issue #4490 gap list 07-A: party type optional at a venue; re-sealed.
// issue #4490 gap list 07-D: menu ordering mode; re-sealed.
// issue #4490 gap list 07-E: Today money; re-sealed.
// issue #4490 gap list 07-L: venue cover for an event; re-sealed.
// issue #4490 07 round 1 tester suites (N130); re-sealed.
// issue #4490 N147: finalize refuses a foreign payment reference; re-sealed.
// issue #4490 explorer W1: handoff and app-only pass; re-sealed.
// issue #4490 round 3: coworking requests, yearly plans, member door codes, multi-day passes and their pg17 proofs registered; re-sealed.
// issue #4490 rounds 2 and 3: remaining venue gap migrations and pg17 proofs registered; re-sealed.
// toward #4490 guest list registration; re-sealed.
// toward #4490 guest list filtered-lane registration; re-sealed.
// toward #4490 guest list filtered-lane registration; re-sealed.
// toward #4490 Stay venue features and filtered-lane registration; re-sealed.
// toward #4490 Stay venue features expectedFiles registration; re-sealed.
// issue #4490 explorer W2: purchases sweep, reads and visit reminders; re-sealed.
// issue #4490 W2 fix 1: guest list pin owner 20281203424490 registered; re-sealed.
// issue #4490 explorer W3: registered migration 20281203434490 (deck card facts) and its pg17 suite with sidecar, exact-filename skip lines in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 W3 fix 1: registered migration 20281203444490 (one grant decision per venue function) and its pg17 suite with sidecar, exact-filename skip lines in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 explorer W5: hosted deck wrappers migration + suite registered; re-sealed.
// issue #4490 explorer W6a: Discover venues migration + suite registered; re-sealed.
// issue #4490 explorer W6b: deck venue-type chips migration + suite registered; re-sealed.
// issue #4490 06-W4 fix 1: 20281203484490 (plan charges, one live payment page) + its pg17 suite registered; re-sealed.
// issue #4490 06-W4 fix 2: 20281203494490 (why everything is due now) + its pg17 suite registered; re-sealed.
// issue #4490 ops O1: Till core migration and suite registered; re-sealed.
// issue #4490 ops O1: #2099 repin over the Till lanes registered; re-sealed.
// issue #4490 ops O1 part 2: Till receipts and the held-round sweep / card refund migrations + suites registered; re-sealed.
// issue #4490 ops O1 fix 1: one-bill migration 20281203554490 + its pg17 suite registered; re-sealed.
// issue #4490 ops O1 fix 2: money-and-door migration 20281203544490 + its pg17 suite registered; re-sealed.
// issue #4490 ops O2: till-pay migration 20281203564490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O2 fix 1: o2-fix1 migration 20281203574490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O3 part A: stations migration 20281203584490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O3 part A: #2099 repin 20281203594490 (pin owner) registered, the 1931 baseline skips it by exact filename, the #2099 path scope lists 600490 and 602490; re-sealed.
// issue #4490 ops O3 part A: the #2117 phase-1 lane skips the #2099 repin 20281203594490 by exact filename; re-sealed.
// issue #4490 ops O3 part A2: floor-alerts migration 20281203604490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O3 fix 1: migration 20281203614490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O3 fix 5: migration 20281203624490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O4: split 20281203634490 + tables/hour 20281203644490 and their pg17 suites registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O4 fix 1: migration 20281203654490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O4 fix 2: migration 20281203664490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O4 fix 3: migration 20281203674490 + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O5 part A: PIN migration 20281203684490 + #2099 repin 20281203694490 + the PIN pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O5 part B: daily close migration 20281203704490 + #2099 repin 20281203714490 + the close pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O5 part C: stock migration 20281203724490 + the stock pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 ops O5 fix 1: migration 20281203734490 (O5-T3 sold-out lines; O5-T1 a day decided once; O5-T4 the no-screen void restock) + #2099 repin 20281203744490 (pin owner) + the fix 1 pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes, the #2099 path scope lists both; re-sealed.
// issue #4490 ops O5 fix 3: migration 20281203754490 + the fix 3 pg17 suite and the O5 tester adversarial suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// #3645 bundle 2e-1 (merge of main): registered the payout claim snapshots migration in the #1857, #1931 and #2117 lanes and its pg17 suite (with sidecar) in the #1931 and #2117 inventories; re-sealed.
// #4508 merge of main after #3645 2e-1 and #4453: listed the #3645, #4453 and #4508 migrations in filename order in the #1857, #1931 and #2117 lanes; re-sealed.
// #4420 merge of main after #4453: kept main's two #4453 rows before the three #4420 rows (filename order) in the #1857, #1931 and #2117 lanes; re-sealed.
// #4420 merge of main after #3645 bundle 2e-1: kept main's 20281119003645 row before the three #4420 rows (filename order); re-sealed.
// #4420 1931 replay: skipped 20281120014420_issue_4420_brand_guest_activity.sql by exact filename on the filtered #1931 temp replay (it calls issue_4459_is_brand_team, defined only by the skipped 20280805004459; #2492 closure); re-sealed.
// #4508 merge of main after #4420: kept main's three #4420 migration rows and its #1931 skip line beside the #4508 rows (filename order); re-sealed.
// #4514 merge of main after #4420: kept the three #4420 rows before the 20281120034514 row (filename order) and #4420's 20281120014420 skip;
// #4514 brand forms: the #1931 filtered template replay no longer skips the brand forms migration (the #2492 gate credits CREATE TABLE columns of applied migrations); re-sealed.
// #4514 CI fix: #1995's full mingla-business type-check (step 28) runs tsc with its own 6144 MB heap (node --max-old-space-size=6144 node_modules/typescript/bin/tsc), as #1403's delta script does: the runner strips NODE_OPTIONS and the graph outgrew 4 GB; re-sealed.
// #4508 merge of main after #4514: kept the #4508 and #4514 migration and pg17 rows in filename order, plus both filtered-replay decisions; re-sealed.
// #4541 RSVP brand forms: registered 20281121004541 and its pg17 proof (with sidecar) in the #1857, #1931 and #2117 inventories; skipped it by exact filename on the filtered #1931 template replay (#4508, which it builds on, is skipped there); re-sealed.
// #4420 tickets on the Work board: listed migration 20281121034420 after 20281121023281 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4420 rework: registered the tester's tickets-on-Work-board pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4541 forms fixes and Blast push: registered 20281122004541 and 20281122014541 in the #1857, #1931 and #2117 inventories and their two pg17 suites (with sidecars) in the #1931 and #2117 inventories; skipped both by exact filename on the filtered #1931 and #2117 template replays; re-sealed.
// #4541 merge of main after #4420 tickets on the Work board: kept main's 20281121034420 row and its pg17 suites before the two #4541 rows (filename order) and both #4541 filtered-replay skips; re-sealed.
// #4548 guest pack: registered 20281122024548 and its three pg17 proofs (implementor happy, implementor adversarial, tester adversarial; with sidecars) in the #1857, #1931 and #2117 inventories after #4541's rows; skipped it by exact filename on the filtered #1931 template replay (#4508 and #4459, which it reads, are skipped there); re-sealed.
// #4549 Host push repair: listed migration 20281124004549 after 20281121034420 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4549 tester: registered the tester adversarial host push device health pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4549 merge of main after #4541 forms fixes and Blast push: kept main's #4541 rows and skips and the #4549 migration and both #4549 pg17 suites (filename order); re-sealed.
// #4549 tester retest: registered the tester report-bounds pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4549 merge of main after #4548 guest pack: kept main's #4548 rows and filtered-replay skip, re-added the #4549 migration and its three pg17 suites (with sidecars) in filename order; re-sealed.
// #4571 W1 people and goals: listed migration 20281130014571 after 20281124004549 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 W2 links and call outcomes: listed migration 20281130024571 after 20281130014571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 W3 host and creator card: listed migration 20281130034571 after 20281130024571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 W4 demo bookings and the stage rule: listed migration 20281130044571 after 20281130034571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 W5 Calendar week: listed migration 20281130054571 after 20281130044571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 rework: listed migration 20281130094571 after 20281130084571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 W7: listed migration 20281130104571 after 20281130094571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4571 leftovers: also listed migration 20281130124571 and its pg17 suite and sidecar. #4571 final gate: listed migration 20281130114571 after 20281130104571 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4573 form request safeupdate: listed migration 20281127004573 after 20281124004549 in the #1857, #1931 and #2117 lanes, registered its pg17 suite and sidecar in the #1931 and #2117 inventories, and skipped it by exact filename on the filtered #1931 and #2117 template replays (it replaces functions from the skipped 20281122014541); re-sealed.
// #4574 Sites backup budget: listed migration 20281128004574 after 20281124004549 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4574 tester adversarial: registered the tester budget-boundary pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #4574 merge of main after #4573 form request safeupdate: kept main's 20281127004573 rows, its pg17 suite and its filtered-replay skips before the #4574 migration and its two pg17 suites (filename order); re-sealed.
// #4572 events: listed migrations 20281129504572, 20281129604572 and 20281129704572 in the #1857, #1931 and #2117 lanes, skipped them on the #1931 and #2117 filtered replays, and registered their three pg17 suites and sidecars in the #1931 and #2117 inventories; re-sealed.
// #4572 website items: listed migrations 20281129004572 and 20281129104572 after 20281128004574 in the #1857, #1931 and #2117 lanes and registered their two pg17 suites and sidecars in the #1931 and #2117 inventories; re-sealed.
// #4572 one PR: merged the events and website halves (both lanes' rows kept, filename order); re-sealed.
// #4572 tester: registered issue_4572_one_pr.tester.adversarial.pg17 (and its sidecar) in the #1931 and #2117 inventories; re-sealed.
// #3969 step 2 profile access: listed migration 20281201003969 after 20281128004574 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #3969 step 2 ordering: renamed the migration to 20281201003969 (after the #4571 versions already applied in production), same lane position; re-sealed.
// #4572 rework after QA: merged main after #3969 step 2 (kept main's 20281201003969 rows after the #4572 migrations, filename order) and skipped 20281129004572 by exact filename on the #1931 and #2117 filtered replays; re-sealed.
// #4571 merge of main after #4573 and #4574: kept main's 20281127004573 and 20281128004574 rows and suites, renumbered the twelve #4571 migrations to 20281130014571 to 20281130124571 (same order) and listed them after 20281128004574 in the #1857, #1931 and #2117 lanes; re-sealed.
// #4571 pre-#1931 replay fix: skipped 20281130044571 (W4, reads book_call_leads.phone_e164 that only the skipped 20280712034452 adds) and the seven later #4571 migrations that build on it or on W6a (20281130064571 to 20281130124571, every one after W5) by exact filename in the #1931 SC-47 filtered replay; W1, W2, W3 and W5 still apply; re-sealed.
// #3969 step 2 profile access: listed migration 20281201003969 after 20281128004574 in the #1857, #1931 and #2117 lanes and registered its pg17 suite and sidecar in the #1931 and #2117 inventories; re-sealed.
// #3969 step 2 ordering: renamed the migration to 20281201003969 (after the #4571 versions already applied in production), same lane position; re-sealed.
// #4571 merge of main after #3969 step 2: kept main's 20281201003969 rows and suites after the twelve #4571 migrations in the #1857, #1931 and #2117 lanes, and the pre-#1931 #4571 skips; re-sealed.
// #4580 release sync timeouts: listed migrations 20281202004580 and 20281202014580 after 20281201003969 in the #1857, #1931 and #2117 lanes and registered their two pg17 suites and sidecars in the #1931 and #2117 inventories; neither needs a filtered-replay skip (nothing they read is skipped); re-sealed.
// #4580 tester adversarial suite: registered issue_4580_release_sync.tester.adversarial.pg17.test.sql and its sidecar in the #1931 and #2117 inventories; re-sealed.
// #4572 merge of main after #4584: kept both sides' rows (filename order); re-sealed.
// #4572 restore: re-added main's eight #4571 pre-#1931 template-replay skips that the #4584 merge resolution dropped (our four #4572 skips kept); re-sealed.
// #4579 Mingla admin brand access: listed migration 20281202024579 after 20281201003969 in the #1857, #1931 and #2117 lanes, registered its implementor and tester adversarial pg17 suites (with sidecars) in the #1931 and #2117 inventories, and skipped it by exact filename on the filtered #1931 and #2117 template replays (it re-emits readers from skipped migrations behind a drift guard); re-sealed.
// #4579 merge of main after #4571, #4572 and #3969 step 2: took main's manifest and re-applied only the #4579 rows and skips (both duplicate #1931 templateReplay run keys carry the skip); re-sealed.
// #4579 renumber: renamed the migration to 20281202024579 (above production's 20281202014580, #4580) in the #1857, #1931 and #2117 lanes and the filtered-replay skips, same lane position; re-sealed.
// #4580 merge of main after #4590: kept both sides' rows (filename order) and main's #4571/#4572 skips; re-sealed.
// issue #4490 merge of origin/main 886723868d: kept both sides\' inventory rows (filename order) and both sides\' exact-filename skips in the #1931 baseline and #2117 phase-1 lanes (main\'s duplicate "run" key in the #1931 baseline replay collapsed to its effective, later value); re-sealed.
// issue #4490 renumber: the 76 #4490 migrations moved from 20280809004490..20280809618490 to 20281203004490..20281203754490 (same relative order, after every main migration); every lane row, exact-filename skip and suite reference follows; the three sorted expectedFiles inventories re-sorted; re-sealed.
// issue #4490 08-O5 fix 4: registered the fix 3 tester adversarial suite (issue_4490_o5_fix3.tester.adversarial.pg17.test.sql + sidecar) beside the O5 tester suite in the #1931 and #2117 inventories; re-sealed.
// issue #4490 retest P1/P3: registered the two fix 4 tester adversarial suites (issue_4490_o5_fix4 / issue_4490_p1_fix4 .tester.adversarial.pg17.test.sql + sidecars) in the #1931 and #2117 inventories; re-sealed.
// issue #4490 merge of origin/main 68a54f2f30 (#4580, #4592): kept both sides' rows (filename order; main's two #4580 migrations before the #4490 block); re-sealed.
// issue #4490 08-O5 fix 4: migration 20281203764490 + the fix 4 pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// #4579 merge of main after #4580 (#4591) and #4592: kept both sides' rows (filename order: 20281202004580, 20281202014580, then 20281202024579; #4579 suites before #4580 suites); re-sealed.
// #4522 slice 12 integration: kept #4508/#4514's rows and filtered-replay
// decisions, restored #3281/#4522 rows and proofs, then re-sealed.
// #4522 slice 13 switch on: registered 20281121014522_issue_4522_switch_on.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281120104522 and 20281121014522 on the filtered #1931 replay and for all #4522 migrations on the filtered #2117 replay (their md5 drift guards need bodies those lanes skip); re-sealed.
// #3281 S4 free parents and add-on refunds: registered 20281121023281_issue_3281_add_on_free_parent_refunds.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281121023281 on the filtered #1931 and #2117 replays
// #4522 merge of main after #4541: kept the #4541 migration, pg17 rows and #1931 skip beside the #3281/#4522 rows and skips; re-sealed.
// #3281 S5 add-on plan choice: registered 20281121033281_issue_3281_add_on_plan_choice.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281121033281 on the filtered #1931 and #2117 replays
// #3281 S3 add-on authoring: registered 20281121043281_issue_3281_add_on_authoring.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281121043281 on the filtered #1931 and #2117 replays (it needs the S1 links those replays skip); re-sealed.
// #3281 S2+S6 readers and RSVP add-ons: registered 20281121053281_issue_3281_add_on_readers_and_rsvp.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281121053281 on the filtered #1931 and #2117 replays (it needs the S1 links those replays skip); re-sealed.
// #4522 merge of main after #4420 polish pass: kept the #4420 migration and pg17 rows beside the #3281/#4522 rows and skips; re-sealed.
// #3281 gap E RSVP add-on picks stay: registered 20281122023281_issue_3281_rsvp_add_on_picks_stay.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281122023281 on the filtered #1931 and #2117 replays; re-sealed.
// #3281 S6 checkpoint 16 my RSVP add-ons: registered 20281122033281_issue_3281_my_rsvp_add_ons.sql and its pg17 proof (with sidecar) in the replay inventories; exact-filename skips for 20281122033281 on the filtered #1931 and #2117 replays; resealed.
// #4522 checkpoint 22 renumbering: moved the branch's 14 migrations (20281120043281..20281122033281) to 20281123013281..20281123143281 above main's 20281121004541 and 20281121034420, same relative order; expectedFiles re-sorted in the #1857, #1931 and #2117 lanes and the filtered #1931/#2117 exact-filename skips renamed; re-sealed.
// #4522 rework after tester FAIL (F1-F10): registered the three #4522 tester adversarial pg17 suites (flex_inflight_race, flex_alloc_rollover, discount_plan, with sidecars) in the #1931 and #2117 replay inventories and the #4523 calendar suite's same-day range test; no migration added; re-sealed.
// #4522 second rework after retest FAIL (N1-N10): registered three #4522 implementor pg17 suites (safeupdate_lifecycle, overpayment_return, custom_discount_exact, with sidecars) in the #1931 and #2117 replay inventories; no migration added; re-sealed.
// #4522 merge of main after #4541 Explorer forms: kept main's 20281122004541 and 20281122014541 rows, their two pg17 suites and their exact-filename skips on the filtered #1931 and #2117 replays beside the #3281/#4522 rows and skips; re-sealed.
// #4522 merge of main after #4548 guest pack: kept main's 20281122024548 row, its three pg17 suites and its exact-filename #1931 skip beside the #3281/#4522 rows and skips; re-sealed.
// #4522 third rework after retest FAIL (T3-1..T3-10): registered the #4522 implementor pg17 suite overpayment_refund_once (with sidecar) in the #1931 and #2117 replay inventories; no migration added; re-sealed.
// #4522 merge of main after #4549 Host push repair and #3645 provider minimums: kept main's 20281124004549 row and its three pg17 suites (with sidecars) beside the #3281/#4522 rows and skips (filename order); #3645 adds no MANIFEST rows (its Deno suites register by sidecar); re-sealed.
// #4522 renumbering after #4549: moved the branch's 14 migrations (20281123013281..20281123143281) to 20281125013281..20281125143281 above main's 20281124004549, same relative order and slugs; expectedFiles re-sorted in the #1857, #1931 and #2117 lanes (main's rows first) and the filtered #1931/#2117 exact-filename skips renamed; re-sealed.
// #4522 merge of main after #4573 form request safeupdate and #4574 Sites backup budget: kept main's 20281127004573 and 20281128004574 rows, their pg17 suites and filtered-replay skips beside the #3281/#4522 rows and skips; moved the branch's 14 migrations (20281125013281..20281125143281) to 20281129013281..20281129143281 above main's 20281128004574, same relative order and slugs; expectedFiles re-sorted; re-sealed.
// #4522 merge of main after #4571 Work cards, #3969 account access and #4575 Grid cover: kept main's twelve #4571 migrations (20281130014571 to 20281130124571), 20281201003969, their pg17 suites and the pre-#1931 #4571 skips beside the #3281/#4522 rows and skips; moved the branch's 14 migrations (20281129013281..20281129143281) to 20281202013281..20281202143281 above main's 20281201003969, same relative order and slugs; expectedFiles re-sorted; re-sealed.
// #4522 merge of main after #4572 Sites feed poster and event types (6093e949c4): kept main's five #4572 migrations (20281129004572..20281129704572), their pg17 suites and filtered-replay skips beside the #3281/#4522 rows and skips; the branch's 14 migrations stay at 20281202013281..20281202143281 above them; re-sealed.
// toward #4522: migrations renumbered 2028120203…16 above #4579
// #4522 merge of main after #4591 release sync and #4592 venue order (68a54f2f30): kept main's 20281202004580 and 20281202014580 rows before the branch's 14 migrations (20281202033281..20281202163281 stay above them); re-sealed.
// #4522 pass 10 rework (P10-1..P10-3): registered the #4522 implementor pg17 suite p10_late_sign_below_min (with sidecar) in the #1931 and #2117 replay inventories; no migration added; re-sealed.
// #4522 pass 11 rework (P11-1..P11-4): registered the #4522 implementor pg17 suite p11_outside_refund_books (with sidecar) in the #1931 and #2117 replay inventories; no migration added; re-sealed.
// #4522 pass 12 rework (P12-1, P12-2): registered the #4522 implementor pg17 suite p12_outside_refund_once (with sidecar) in the #1931 and #2117 replay inventories; no migration added; re-sealed.
// #4522 merge of main after #4579 (#4593, d3527e3b93): kept main's 20281202024579 rows, its two pg17 suites and its filtered-replay skips before the branch's 14 migrations (20281202033281..20281202163281 stay above it) and the #3281/#4522 rows and skips; re-sealed.
// issue #4490 merge of origin/main d3527e3b93 (#4579): kept both sides' rows (main's 20281202024579 and its two #4579 pg17 suites before the #4490 block, filename order; the #4579 exact-filename skips in the #1931 baseline and #2117 phase-1 lanes); re-sealed.
// issue #4490 after #4579: migration 20281203774490 (Till staff names follow #4579's public-name rule; Mingla admins may hold a Till PIN) + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 08-O5 fix 5: migration 20281203784490 (a cheaper sold-out swap follows the refund rule) + its pg17 suite registered, exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// issue #4490 merge of origin/main 97a75873e2 (#4594, #4595): kept both sides' rows (main's fourteen 20281202033281..20281202163281 migrations and their pg17 suites before the #4490 block, filename order) and both sides' exact-filename skips in the #1931 baseline and #2117 phase-1 lanes; re-sealed.
// #4571 Hosts board speed (merge of main after #4594, #4595 and #4597): listed migration 20281202174571 after main's 20281202163281 in the #1857, #1931 and #2117 lanes, registered its pg17 suite and sidecar in the #1931 and #2117 inventories, and added an EXACT filtered-replay skip beside the other #4571 skips; re-sealed.
// issue #4490 merge of origin/main 60e3e235d2 (#4598 Hosts board speed): kept both sides' rows (main's 20281202174571 after 20281202163281 and before the #4490 block, filename order; its pg17 suite and sidecar in the #1931 and #2117 inventories; its EXACT filtered-replay skip beside the #4490 skips); re-sealed.
// issue #4596 merge of origin/main 9289878e2a (#4490): kept main's 79 #4490 migration rows before 20281205004596, plus both #4596 pg17 suites and sidecars; re-sealed.
// issue #1493: registered the accepted-brand-member Venue Overview pg17 proof and sidecar in both filtered replay inventories; re-sealed.
// issue #4618: registered migration 20281205034618 in the #1857, #1931 and #2117 replay inventories and its implementor pg17 suite with sidecar in the #1931 and #2117 inventories; re-sealed.
// issue #4618 tester: registered the tester adversarial pg17 suite with sidecar in the #1931 and #2117 inventories; re-sealed.
// issue #4490 demo venue cleanup: registered migration 20281205044490 in the #1857, #1931 and #2117 replay inventories and its implementor pg17 suite with sidecar in the #1931 and #2117 inventories; re-sealed.
// issue #4572 venue offer Sites feed: registered 20281205054572 in the three preserved replay inventories and exact-skipped it from the #1931/#2117 historical replays whose filtered chains omit its #4572/#4490 prerequisites; re-sealed.
// issue #4624 offering discounts: registered migration 20281206004624 in the #1857, #1931 and #2117 replay inventories, its implementor pg17 suite with sidecar in the #1931 and #2117 inventories, and an EXACT filtered-replay skip in the #1931 template replay; re-sealed.
export const BOOTSTRAP_SHA256 = "6573d98a380b83b4e81c1a56b149bf2ab52fa702b34740ab6352a917934f1773";
export const DESCRIPTOR_SUFFIX = ".ci-batch.json";
export const PATCH_SUFFIX = ".ci-batch.patch.json";
export const PATCH_DIRECTORY = ".github/ci-batch/patches";

// Loader-owned provenance is deliberately not a JSON field. A descriptor cannot
// make itself trusted by spelling `localDescriptor` in its suite payload: only
// this module can attach the private symbol after the sealed bootstrap, patches,
// descriptors and derived capabilities have all been reconciled.
const TRUSTED_REGISTRY_VIEWS = Symbol("ci-batch-trusted-registry-views");

const SHA256 = /^[0-9a-f]{64}$/;
const ISSUE = /^#[1-9][0-9]*$/;
const DEPENDENT_SEAL_PATHS = Object.freeze({
  suites: [
    "/class", "/setupProfile", "/lifecycle", "/runtime", "/timeoutSeconds", "/steps",
    "/expectedFiles", "/envNames", "/generatedPaths", "/shadowContract", "/triggerContract",
    "/migrationWave", "/hostClass", "/executionClass", "/isolation",
  ],
  legacyOrigins: [
    "/disposition", "/providerWorkflow", "/replacementSuite", "/replacementSuites", "/routing",
    "/workflowMetadata/triggers", "/workflowMetadata/pathScope", "/workflowMetadata/jobKeys",
    "/workflowMetadata/runners", "/workflowMetadata/runtimeVersions", "/workflowMetadata/setupActions",
    "/workflowMetadata/concurrency", "/workflowMetadata/trustBoundary",
  ],
});

function fail(code, detail = "") {
  throw new Error(`ci-batch:effective-registry:${code}${detail ? `:${detail}` : ""}`);
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...keys].sort());
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function repositoryRelative(value, { allowPattern = false, allowRoot = false } = {}) {
  if (allowRoot && value === ".") return true;
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !path.isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.includes("\\") &&
    !value.includes("\0") && !value.split("/").some((part) => !part || part === "." || part === "..") &&
    (allowPattern || !/[?*\[\]{}]/.test(value));
}

export function trustedRegistryViews(manifest) {
  return manifest?.[TRUSTED_REGISTRY_VIEWS] || null;
}

export function bootstrapRowSha256(row) {
  return sha256(JSON.stringify(row));
}

function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export function loadBootstrap({ manifestPath = BOOTSTRAP_PATH, expectedSha = BOOTSTRAP_SHA256 } = {}) {
  const raw = fs.readFileSync(manifestPath);
  const actual = sha256(raw);
  if (actual !== expectedSha) fail("bootstrap_seal_mismatch", `${actual}:expected=${expectedSha}`);
  return JSON.parse(raw.toString("utf8"));
}

function targetIdentity(collection, selector) {
  return collection === "suites"
    ? `suites:id=${selector.id}`
    : `legacyOrigins:stem=${selector.stem}:extension=${selector.extension}`;
}

function selectedBootstrapRows(bootstrap, collection, selector) {
  const rows = bootstrap[collection];
  if (!Array.isArray(rows)) fail("bootstrap_collection_missing", collection);
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => collection === "suites"
    ? row.id === selector.id
    : row.stem === selector.stem && row.extension === selector.extension);
}

function semanticDiffPaths(before, after, pointer = "") {
  if (same(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after) || !before || !after ||
      typeof before !== "object" || typeof after !== "object") return [pointer || "/"];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) => semanticDiffPaths(before[key], after[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}

function protectedSealPath(collection, pointer) {
  return DEPENDENT_SEAL_PATHS[collection].some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`));
}

function validatePatchEnvelope(descriptorPath, declaration) {
  const topLevel = ["schemaVersion", "kind", "ownerIssue", "target", "operations", "dependentSeals", "reason"];
  if (!exactKeys(declaration, topLevel) || declaration.schemaVersion !== 1 ||
      declaration.kind !== "ci-batch-bootstrap-patch" || !ISSUE.test(declaration.ownerIssue) ||
      typeof declaration.reason !== "string" || declaration.reason.trim().length < 12 ||
      !Array.isArray(declaration.dependentSeals)) {
    fail("malformed_patch", descriptorPath);
  }
  if (declaration.dependentSeals.length !== 0) fail("dependent_seal_change", descriptorPath);
  if (!Array.isArray(declaration.operations) || declaration.operations.length === 0) {
    fail("malformed_patch_operations", descriptorPath);
  }
  if (/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml/.test(JSON.stringify(declaration))) {
    fail("workflow_name_forbidden", descriptorPath);
  }
}

function validatePatchTarget(descriptorPath, target) {
  if (!exactKeys(target, ["collection", "selector", "baseRowSha256"]) ||
      !["suites", "legacyOrigins"].includes(target.collection) || !SHA256.test(target.baseRowSha256)) {
    if (target?.collection && !["suites", "legacyOrigins"].includes(target.collection)) {
      fail("unknown_patch_collection", `${descriptorPath}:${target.collection}`);
    }
    fail("malformed_patch_target", descriptorPath);
  }
  const selectorKeys = target.collection === "suites" ? ["id"] : ["stem", "extension"];
  if (!exactKeys(target.selector, selectorKeys) ||
      (target.collection === "suites" && (typeof target.selector.id !== "string" || !target.selector.id)) ||
      (target.collection === "legacyOrigins" &&
        (typeof target.selector.stem !== "string" || !/^[A-Za-z0-9_.-]+$/.test(target.selector.stem) ||
         !["yml", "yaml"].includes(target.selector.extension)))) {
    fail("malformed_patch_selector", descriptorPath);
  }
}

function validateOperationShape(descriptorPath, operation) {
  if (!exactKeys(operation, ["op", "path", "expected", "value"]) ||
      typeof operation.op !== "string" || typeof operation.path !== "string") {
    fail("malformed_patch_operation", descriptorPath);
  }
  if (["", "/"].includes(operation.path) || ["add", "remove", "move", "copy"].includes(operation.op)) {
    fail("row_mutation_forbidden", `${descriptorPath}:${operation.op}:${operation.path}`);
  }
  if (operation.path.split("/").slice(1).some((part) => /^[0-9]+$/.test(part))) {
    fail("index_target_forbidden", `${descriptorPath}:${operation.path}`);
  }
}

function applyOperation({ descriptorPath, root, collection, selector, original, patched, operation }) {
  validateOperationShape(descriptorPath, operation);
  if (protectedSealPath(collection, operation.path)) {
    fail("dependent_seal_change", `${descriptorPath}:${operation.path}`);
  }
  // [#3643 Wave 4] Live workflow rows no longer carry a byte fingerprint: the
  // validator checks their triggers, paths, jobs, runtimes, actions and trust
  // boundary against the YAML instead. A patch that re-banks a fingerprint
  // therefore has nothing to re-bank, and is refused by name rather than
  // silently accepted.
  if (collection === "legacyOrigins" && operation.path === "/workflowMetadata/sourceSha256") {
    fail("source_digest_patch_retired", `${descriptorPath}: live workflows are checked by property, not by byte fingerprint; edit the workflow and drop this patch`);
  }
  if (collection === "suites" && ["/originPaths", "/externalReferenceFiles"].includes(operation.path) &&
      operation.op !== "append-unique") {
    fail("provenance_mutation_forbidden", `${descriptorPath}:${operation.path}`);
  }
  if (collection === "suites" && ["/originPaths", "/externalReferenceFiles"].includes(operation.path)) {
    if (!Array.isArray(operation.expected) ||
        !operation.expected.every((entry) => typeof entry === "string") ||
        typeof operation.value !== "string" || !operation.value || path.isAbsolute(operation.value) ||
        operation.value.split("/").includes("..")) {
      fail("malformed_provenance_patch", `${descriptorPath}:${operation.path}`);
    }
    const key = operation.path.slice(1);
    const current = original[key];
    if (!same(current, operation.expected)) fail("patch_cas_mismatch", `${descriptorPath}:${operation.path}`);
    if (current.includes(operation.value)) fail("patch_noop", `${descriptorPath}:${operation.path}`);
    if (!fs.existsSync(path.join(root, operation.value))) fail("appended_path_missing", `${descriptorPath}:${operation.value}`);
    patched[key].push(operation.value);
    return;
  }
  fail("unknown_patch_path", `${descriptorPath}:${operation.path}`);
}

function readPatchDeclarations(root, allFiles) {
  const patchFiles = allFiles.filter((file) => file.endsWith(PATCH_SUFFIX));
  for (const descriptorPath of patchFiles) {
    if (path.posix.dirname(descriptorPath) !== PATCH_DIRECTORY) {
      fail("patch_location_forbidden", descriptorPath);
    }
  }
  return patchFiles.sort().map((descriptorPath) => {
    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(path.join(root, descriptorPath), "utf8"));
    } catch (error) {
      fail("malformed_patch", `${descriptorPath}:${error.message}`);
    }
    return { descriptorPath, declaration };
  });
}

function applyBootstrapPatches({ root, bootstrap, allFiles }) {
  const effective = structuredClone(bootstrap);
  const targeted = new Set();
  for (const { descriptorPath, declaration } of readPatchDeclarations(root, allFiles)) {
    validatePatchEnvelope(descriptorPath, declaration);
    validatePatchTarget(descriptorPath, declaration.target);
    const { collection, selector, baseRowSha256 } = declaration.target;
    const identity = targetIdentity(collection, selector);
    if (targeted.has(identity)) fail("duplicate_patch_target", identity);
    targeted.add(identity);
    const matches = selectedBootstrapRows(bootstrap, collection, selector);
    if (matches.length !== 1) fail("patch_target_cardinality", `${identity}:matches=${matches.length}`);
    const { row: original, index } = matches[0];
    const actualBaseSha = bootstrapRowSha256(original);
    if (actualBaseSha !== baseRowSha256) {
      fail("stale_base_row", `${descriptorPath}:${actualBaseSha}:expected=${baseRowSha256}`);
    }
    const paths = new Set();
    const patched = structuredClone(original);
    for (const operation of declaration.operations) {
      if (paths.has(operation?.path)) fail("duplicate_patch_path", `${descriptorPath}:${operation?.path}`);
      paths.add(operation?.path);
      applyOperation({ descriptorPath, root, collection, selector, original, patched, operation });
    }
    const actualDiff = semanticDiffPaths(original, patched).sort();
    const declaredDiff = [...paths].sort();
    if (!same(actualDiff, declaredDiff)) {
      fail("patch_semantic_diff_mismatch", `${descriptorPath}:${JSON.stringify(actualDiff)}:declared=${JSON.stringify(declaredDiff)}`);
    }
    effective[collection][index] = patched;
  }
  return effective;
}

function validateLocalSuite({ descriptorPath, declaration, root, bootstrap }) {
  if (!exactKeys(declaration, ["schemaVersion", "kind", "ownerIssue", "suite"]) ||
      declaration.schemaVersion !== 1 || declaration.kind !== "ci-batch-suite" ||
      !ISSUE.test(declaration.ownerIssue)) {
    fail("malformed_descriptor", descriptorPath);
  }
  const suite = declaration.suite;
  const suiteKeys = [
    "id", "class", "originPaths", "steps", "lifecycle", "ownerIssue", "runtime",
    "setupProfile", "cwd", "envNames", "isolation", "expectedFiles",
    "externalReferenceFiles", "requiredContext", "timingSeconds", "generatedPaths",
    "exceptionRationale", "timeoutSeconds",
  ];
  if (!exactKeys(suite, suiteKeys)) fail("malformed_suite", descriptorPath);
  const requiredStrings = [
    "id", "class", "lifecycle", "ownerIssue", "setupProfile", "cwd", "isolation",
    "requiredContext", "exceptionRationale",
  ];
  for (const key of requiredStrings) {
    if (typeof suite[key] !== "string" || suite[key].length === 0) fail("missing_field", `${descriptorPath}:${key}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(suite.id) || suite.ownerIssue !== declaration.ownerIssue) {
    fail("descriptor_owner_mismatch", descriptorPath);
  }
  if (!Array.isArray(suite.steps) || suite.steps.length === 0 ||
      !Array.isArray(suite.expectedFiles) || suite.expectedFiles.length === 0 ||
      !Array.isArray(suite.originPaths) || suite.originPaths.length === 0 ||
      !Array.isArray(suite.envNames) || !Array.isArray(suite.generatedPaths) ||
      !Array.isArray(suite.externalReferenceFiles)) fail("missing_suite_arrays", descriptorPath);
  for (const key of ["originPaths", "envNames", "expectedFiles", "externalReferenceFiles", "generatedPaths"]) {
    if (!suite[key].every((entry) => typeof entry === "string") || new Set(suite[key]).size !== suite[key].length) {
      fail("malformed_suite_array", `${descriptorPath}:${key}`);
    }
  }
  if (!exactKeys(suite.runtime, ["name", "version"]) || suite.runtime.name !== "node" ||
      typeof suite.runtime.version !== "string" ||
      !Number.isInteger(suite.timeoutSeconds) || suite.timeoutSeconds < 1 || suite.timeoutSeconds > 1500) {
    fail("malformed_runtime_or_timeout", descriptorPath);
  }
  const validTiming = (value) => value === null || (Number.isFinite(value) && value >= 0);
  if (!exactKeys(suite.timingSeconds, ["p50", "p95", "evidence"]) ||
      !validTiming(suite.timingSeconds.p50) || !validTiming(suite.timingSeconds.p95) ||
      (suite.timingSeconds.p50 !== null && suite.timingSeconds.p95 !== null && suite.timingSeconds.p95 < suite.timingSeconds.p50) ||
      typeof suite.timingSeconds.evidence !== "string" || !suite.timingSeconds.evidence.trim()) {
    fail("malformed_timing", descriptorPath);
  }
  if (suite.lifecycle !== "batched-active" || suite.isolation !== "clean-worktree" || suite.envNames.length !== 0) {
    fail("unsupported_local_execution_contract", descriptorPath);
  }
  if (!bootstrap.classes.includes(suite.class) || !Object.hasOwn(bootstrap.setupProfiles, suite.setupProfile) ||
      bootstrap.setupProfiles[suite.setupProfile]?.classes?.includes(suite.class) !== true ||
      !same(bootstrap.setupProfiles[suite.setupProfile]?.runtime, suite.runtime)) {
    fail("unknown_class_or_setup", descriptorPath);
  }
  if (bootstrap.suites.some((entry) => entry.id === suite.id)) fail("bootstrap_shadow", suite.id);
  if (!repositoryRelative(suite.cwd, { allowRoot: true }) || !fs.existsSync(path.join(root, suite.cwd))) {
    fail("invalid_cwd", `${suite.id}:${suite.cwd}`);
  }
  for (const key of ["expectedFiles", "externalReferenceFiles"]) {
    for (const file of suite[key]) {
      if (!repositoryRelative(file) || !fs.existsSync(path.join(root, file))) {
        fail("missing_suite_path", `${suite.id}:${key}:${file}`);
      }
    }
  }
  for (const pattern of suite.originPaths) {
    if (!repositoryRelative(pattern, { allowPattern: true })) fail("invalid_origin_path", `${suite.id}:${pattern}`);
  }
  for (const generated of suite.generatedPaths) {
    if (!repositoryRelative(generated)) fail("invalid_generated_path", `${suite.id}:${generated}`);
  }
  if (!suite.expectedFiles.some((file) => path.posix.dirname(file) === path.posix.dirname(descriptorPath))) {
    fail("descriptor_not_local", descriptorPath);
  }
  const encoded = JSON.stringify(declaration);
  if (/\.github\/workflows\/[^"']+\.ya?ml/.test(encoded)) fail("workflow_name_forbidden", descriptorPath);
  for (const [index, step] of suite.steps.entries()) {
    if (!exactKeys(step, ["name", "cwd", "run", "commandId", "invocation", "exceptionRationale"]) ||
        typeof step.name !== "string" || !step.name.trim() || typeof step.run !== "string" || !step.run.trim() ||
        typeof step.commandId !== "string" || step.commandId !== `assert:${suite.id}:${String(index + 1).padStart(2, "0")}` ||
        !repositoryRelative(step.cwd, { allowRoot: true }) || !fs.existsSync(path.join(root, step.cwd)) ||
        typeof step.exceptionRationale !== "string" || !step.exceptionRationale.includes("legacy workflow") ||
        !exactKeys(step.invocation, ["kind", "command", "argv"]) || step.invocation.kind !== "raw-shell" ||
        step.invocation.command !== "bash" || !Array.isArray(step.invocation.argv) ||
        step.invocation.argv.length !== 2 || step.invocation.argv[0] !== "-c" || step.invocation.argv[1] !== step.run) {
      fail("malformed_step", `${suite.id}:${index}`);
    }
  }
  return {
    ...suite,
    origin: descriptorPath,
    originPaths: [...new Set([...suite.originPaths, descriptorPath])],
    localDescriptor: descriptorPath,
  };
}

export function loadEffectiveManifest({
  root = ROOT,
  manifestPath = BOOTSTRAP_PATH,
  expectedSha = BOOTSTRAP_SHA256,
  discover = manifestPath === BOOTSTRAP_PATH,
} = {}) {
  if (!discover) return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bootstrap = loadBootstrap({ manifestPath, expectedSha });
  const files = walk(root);
  const patchedBootstrap = applyBootstrapPatches({ root, bootstrap, allFiles: files });
  const locals = files.filter((file) => file.endsWith(DESCRIPTOR_SUFFIX) && !file.endsWith(PATCH_SUFFIX)).map((descriptorPath) => {
    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(path.join(root, descriptorPath), "utf8"));
    } catch (error) {
      fail("malformed_descriptor", `${descriptorPath}:${error.message}`);
    }
    return validateLocalSuite({ descriptorPath, declaration, root, bootstrap });
  });
  const ids = new Set(bootstrap.suites.map((suite) => suite.id));
  for (const suite of locals) {
    if (ids.has(suite.id)) fail("duplicate_suite_id", suite.id);
    ids.add(suite.id);
  }
  const effectiveBase = structuredClone(patchedBootstrap);
  const suites = [...effectiveBase.suites, ...locals.sort((a, b) => a.id.localeCompare(b.id))];
  const localCommands = locals.flatMap((suite) => suite.steps.map((step, stepIndex) => {
    const command = {
      id: step.commandId,
      suiteId: suite.id,
      stepIndex,
      cwd: step.cwd,
      executable: step.invocation.command,
      argv: step.invocation.argv,
    };
    return {
      ...command,
      payloadSha256: crypto.createHash("sha256").update(JSON.stringify({
        cwd: command.cwd,
        executable: command.executable,
        argv: command.argv,
      })).digest("hex"),
    };
  }));
  const commands = [...effectiveBase.commandCapabilities.commands, ...localCommands];
  const commandIds = new Set();
  for (const command of commands) {
    if (commandIds.has(command.id)) fail("duplicate_command_id", command.id);
    commandIds.add(command.id);
  }
  const effective = {
    ...effectiveBase,
    expectedExecutableSuites: suites.length,
    expectedSuites: suites.length,
    commandCapabilities: {
      ...bootstrap.commandCapabilities,
      expectedCommands: commands.length,
      registrySha256: crypto.createHash("sha256").update(JSON.stringify(commands)).digest("hex"),
      commands,
    },
    suites,
  };
  Object.defineProperty(effective, TRUSTED_REGISTRY_VIEWS, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: Object.freeze({
      rawBootstrap: deepFreeze(bootstrap),
      patchedBootstrap: deepFreeze(patchedBootstrap),
      localSuiteIds: Object.freeze(locals.map((suite) => suite.id)),
      localDescriptorClaims: Object.freeze(locals.map((suite) => Object.freeze({
        suiteId: suite.id,
        descriptorPath: suite.localDescriptor,
      }))),
      rawBootstrapSha256: expectedSha,
    }),
  });
  return effective;
}
