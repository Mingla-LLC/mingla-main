#!/usr/bin/env node
/**
 * Issue #2774 — public hero content equivalence.
 *
 * This guard pins the non-visual accessibility seam that is otherwise easy to
 * sever silently: exact safe label construction, one named media owner with
 * decorative descendants, index-only announcements, all five public journey
 * adapters, and the four additive anonymous RPC projections. Runtime and SQL
 * suites prove behavior; this gate proves those suites and seams stay wired.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd().endsWith("mingla-business") || process.cwd().endsWith("app-mobile")
  ? resolve(process.cwd(), "..")
  : process.cwd();

const PATHS = {
  helper: "packages/offering-rendering/heroMediaAccessibility.tsx",
  media: "packages/offering-rendering/EventCoverMedia.tsx",
  shell: "packages/offering-rendering/ParallaxCoverShell.tsx",
  pager: "packages/offering-rendering/CoverGalleryPager.tsx",
  venue: "packages/brand-rendering/PublicVenueScreen.tsx",
  event: "mingla-business/src/components/event/FoundationEventPreview.tsx",
  rsvp: "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
  trip: "mingla-business/src/components/trip/TripPreview.tsx",
  experience: "mingla-business/src/components/experience/ExperiencePreview.tsx",
  consumerEvent: "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  consumerTrip: "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
  consumerExperience: "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
  migration: "supabase/migrations/20270607002774_issue_2774_public_hero_alt.sql",
  sqlTest: "supabase/migrations/__tests__/issue_2774_public_hero_alt.test.sql",
  businessTest: "mingla-business/src/components/venue/__tests__/publicHeroAccessibility.issue2774.happy.render.test.tsx",
  nativeTest: "app-mobile/src/screens/__tests__/publicHeroAccessibility.issue2774.happy.test.tsx",
  workflow: ".github/workflows/issue-1486-dormant-render-suites.yml",
};

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1")
    .replace(/^\s*--[^\n]*/gm, "");

const count = (source, pattern) => (source.match(pattern) ?? []).length;

export function check(files) {
  const failures = [];
  for (const path of Object.values(PATHS)) {
    if (typeof files[path] !== "string") failures.push(`${path}: missing or unreadable`);
  }
  if (failures.length > 0) return failures;

  const helper = stripComments(files[PATHS.helper]);
  const media = stripComments(files[PATHS.media]);
  const shell = stripComments(files[PATHS.shell]);
  const pager = stripComments(files[PATHS.pager]);
  const migration = stripComments(files[PATHS.migration]);

  const requireMatch = (source, pattern, message) => {
    if (!pattern.test(source)) failures.push(message);
  };

  requireMatch(helper, /trim\(\)\.replace\(\/\\s\+\/gu, " "\)/, "H1_NORMALIZATION: trim and Unicode whitespace collapse are required");
  requireMatch(helper, /Array\.from\(normalized\)\.slice\(0, maximumCodePoints\)\.join\(""\)/, "H1_CODE_POINT_BOUND: description must cap at 300 Unicode code points without splitting a surrogate");
  requireMatch(helper, /const kind = mediaType === "video" \? "Video cover" : "Photo"/, "H1_KIND: exact Photo/Video cover kind mapping is required");
  requireMatch(helper, /`\$\{kind\} \$\{position\} of \$\{total\} for \$\{normalizedSubject\}`/, "H1_FALLBACK: exact kind/ordinal/total/subject fallback is required");
  requireMatch(helper, /`Now showing \$\{accessibleLabel\}`/, "H5_ANNOUNCEMENT_COPY: exact Now showing message is required");
  requireMatch(helper, /previousIndex === activeIndex \|\| accessibleLabel === null/, "H5_INDEX_ONLY: initial, same-index and metadata-only renders must stay silent");
  requireMatch(helper, /aria-live="polite"[\s\S]*aria-atomic=\{true\}/, "H5_WEB_LIVE_REGION: one polite atomic result is required");
  requireMatch(helper, /announceForAccessibilityWithOptions\(message, \{ queue: true \}\)/, "H4_NATIVE_QUEUE: native current changes must queue exactly once");

  requireMatch(media, /accessibleLabel\?: string \| null/, "H1_MEDIA_INPUT: EventCoverMedia must accept the optional accessible label");
  requireMatch(media, /accessibilityRole=\{normalizedAccessibleLabel !== null \? "image" : undefined\}/, "H1_ONE_IMAGE_OWNER: real media must expose one named image owner");
  requireMatch(media, /accessibilityLabel=\{normalizedAccessibleLabel \?\? undefined\}/, "H1_IMAGE_NAME: the image owner must receive the normalized label");
  if (count(media, /importantForAccessibility="no-hide-descendants"/g) < 3) {
    failures.push("H1_DECORATIVE_DESCENDANTS: image, poster and video descendants must stay hidden");
  }
  requireMatch(media, /<Pressable[\s\S]*accessibilityRole="button"[\s\S]*accessibilityLabel=\{`\$\{isMuted \? "Turn on" : "Mute"\}/, "H3_MUTE_INDEPENDENT: video audio remains a separately named button");
  requireMatch(media, /if \(!renderMedia\)[\s\S]*accessible=\{mediaUrl !== null && normalizedAccessibleLabel !== null\}/, "H7_COVERLESS: a missing media URL must never gain a fake image result");

  for (const [owner, source] of [["SHELL", shell], ["PAGER", pager]]) {
    requireMatch(source, /heroAccessibilitySubject\?: string \| null/, `${owner}_SUBJECT: shared owner must accept the canonical public subject`);
    requireMatch(source, /coverMediaAlt\?: string \| null/, `${owner}_PRIMARY_ALT: shared owner must accept primary cover alt`);
    requireMatch(source, /buildHeroMediaAccessibleLabel\(/, `${owner}_BUILDER: displayed hero must use the single label builder`);
    requireMatch(source, /HeroMediaChangeAnnouncer/, `${owner}_ANNOUNCER: gallery owner must mount the one change result`);
  }

  const journeyFiles = [PATHS.venue, PATHS.event, PATHS.rsvp, PATHS.trip, PATHS.experience];
  for (const path of journeyFiles) {
    const source = stripComments(files[path]);
    requireMatch(source, /heroAccessibilitySubject=/, `H8_JOURNEY_SUBJECT:${path} must pass its canonical public name/title`);
    requireMatch(source, /coverMediaAlt=/, `H8_JOURNEY_ALT:${path} must pass primary alt or the venue null sentinel`);
  }
  for (const path of [PATHS.consumerEvent, PATHS.consumerTrip, PATHS.consumerExperience]) {
    const source = stripComments(files[path]);
    requireMatch(source, /buildHeroMediaAccessibleLabel\(/, `H8_CONSUMER_LABEL:${path} must name page zero/single cover`);
    requireMatch(source, /heroAccessibilitySubject=/, `H8_CONSUMER_PAGER:${path} must pass subject into the controlled pager`);
    requireMatch(source, /coverMediaAlt=/, `H8_CONSUMER_ALT:${path} must pass primary alt into the controlled pager`);
  }

  const rpcNames = [
    "pg_public_event_by_slug",
    "pg_public_rsvp_by_slug",
    "pg_public_trip_by_slug",
    "pg_public_experience_by_slug",
  ];
  for (const rpc of rpcNames) {
    requireMatch(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\(`, "i"), `SQL_RPC:${rpc} latest definition is required`);
  }
  if (count(migration, /'coverMediaAlt'\s*,\s*(?:ev|tr|ex)\.cover_media_alt/g) !== 4) {
    failures.push("SQL_PROJECTION: each of four root payloads must expose exactly one coverMediaAlt from cover_media_alt");
  }
  if (count(migration, /SECURITY DEFINER/g) !== 4 || count(migration, /SET search_path TO /g) !== 4) {
    failures.push("SQL_SECURITY: all four SECURITY DEFINER and pinned search-path contracts must be preserved");
  }
  requireMatch(stripComments(files[PATHS.sqlTest]), /FOREACH v_name IN ARRAY/, "SQL_TEST: the four-function catalog proof must remain append-only");
  requireMatch(files[PATHS.businessTest], /H-1 builds exact truthful names/, "CI_HAPPY_WEB: named render proof missing");
  requireMatch(files[PATHS.nativeTest], /H-4 queues exactly one native message/, "CI_HAPPY_NATIVE: named native proof missing");
  const workflow = files[PATHS.workflow];
  if (count(workflow, /name: "#2774 — public hero content equivalence happy proofs"/g) !== 1 ||
      count(workflow, /if: always\(\)[\s\S]{0,260}jest\.issue2774\.render\.cjs/g) !== 1) {
    failures.push("CI_WIRING: workflow must contain exactly one if:always #2774 step invoking both configs");
  }
  return failures;
}

const loadLive = () => Object.fromEntries(
  Object.values(PATHS).map((path) => [path, readFileSync(resolve(ROOT, path), "utf8")]),
);

if (process.argv.includes("--self-test")) {
  const good = Object.fromEntries(Object.values(PATHS).map((path) => [path, "placeholder"]));
  Object.assign(good, loadLive());
  const liveFailures = check(good);
  if (liveFailures.length > 0) {
    console.error("#2774 self-test fixture baseline is not compliant:\n" + liveFailures.join("\n"));
    process.exit(2);
  }
  const mutants = [
    ["H1 exact label", PATHS.helper, '"Video cover" : "Photo"', '"Video" : "Photo"', "H1_KIND"],
    ["H5 same-index silence", PATHS.helper, "previousIndex === activeIndex || ", "", "H5_INDEX_ONLY"],
    ["H1 semantic owner", PATHS.media, 'accessibilityRole={normalizedAccessibleLabel !== null ? "image" : undefined}', "accessibilityRole={undefined}", "H1_ONE_IMAGE_OWNER"],
    ["SQL four projections", PATHS.migration, "'coverMediaAlt', ev.cover_media_alt", "'removedAlt', ev.cover_media_alt", "SQL_PROJECTION"],
    ["H8 venue subject", PATHS.venue, "heroAccessibilitySubject=", "removedSubject=", "H8_JOURNEY_SUBJECT"],
  ];
  for (const [name, path, from, to, expected] of mutants) {
    const mutated = { ...good, [path]: good[path].replace(from, to) };
    const result = check(mutated);
    if (!result.some((failure) => failure.includes(expected))) {
      console.error(`#2774 self-test failed: ${name} mutant did not trigger ${expected}`);
      process.exit(2);
    }
  }
  console.log("issue-2774-public-hero-accessibility self-test: PASS (5/5 named mutants RED)");
  process.exit(0);
}

const failures = check(loadLive());
if (failures.length > 0) {
  console.error("issue-2774-public-hero-accessibility: FAIL\n" + failures.join("\n"));
  process.exit(1);
}
console.log("issue-2774-public-hero-accessibility: PASS");
