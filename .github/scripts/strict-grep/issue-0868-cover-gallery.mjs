#!/usr/bin/env node
// issue #868 [cover-gallery] — whole-feature revert guard.
//
// Asserts the ADDITIVE, INDEPENDENT cover-gallery feature stays wired end-to-end
// (I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT + -NO-VIDEO + -HERO-SEQUENCE):
//   (1) the additive column migration declares cover_media_gallery + the
//       array-shape CHECK;
//   (2) every additive WRITE path references cover_media_gallery
//       (setEventCoverGallery, tripsService, the 3 publish/live RPCs);
//   (3) event-cover-video-apply NEVER references cover_media_gallery (NEGATIVE —
//       proves the video-cover path stays INDEPENDENT of the gallery);
//   (4) each of the 4 anon hero RPCs projects the coverGallery json key;
//   (5) CoverGalleryRow.tsx exists AND ParallaxCoverShell.tsx wires galleryImages;
//   (6) the RSVP <Head> in the business PublicEventPage gained og:image.
//
// Reverting any leg → non-zero exit. Modeled on issue-890-web-sentry-lazy-only.mjs
// (pure `evaluate(bundle, failures)` exercised by --self-test with GOOD + per-leg
// BAD fixtures; the disk path feeds the SAME evaluate the real file contents).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Pure verdict over a bundle of named file contents (or null when absent).
function evaluate(b, failures) {
  // (1) additive column migration.
  if (b.columnMigration === null) {
    failures.push("issue-868: migration *issue_868*cover_gallery.sql not found (additive column).");
  } else {
    if (!/cover_media_gallery\s+jsonb/.test(b.columnMigration))
      failures.push("issue-868: column migration must declare cover_media_gallery jsonb.");
    if (!/events_cover_media_gallery_is_array/.test(b.columnMigration))
      failures.push("issue-868: column migration must add the events_cover_media_gallery_is_array CHECK.");
  }

  // (2) additive write paths reference cover_media_gallery.
  if (b.service === null || !/setEventCoverGallery/.test(b.service) || !/cover_media_gallery/.test(b.service))
    failures.push("issue-868: eventCoverMediaService.ts must export setEventCoverGallery writing cover_media_gallery.");
  if (b.trips === null || !/cover_media_gallery/.test(b.trips))
    failures.push("issue-868: tripsService.ts must write cover_media_gallery (updateTripBasics).");
  if (b.writeLayer === null) {
    failures.push("issue-868: write-layer migration (publish/live RPCs) not found.");
  } else {
    for (const fn of ["business_publish_event_draft", "business_publish_rsvp_draft", "biz_update_live_trip"]) {
      if (!b.writeLayer.includes(fn))
        failures.push(`issue-868: write-layer migration must re-publish ${fn}.`);
    }
    if ((b.writeLayer.match(/cover_media_gallery/g) || []).length < 3)
      failures.push("issue-868: write-layer migration must persist cover_media_gallery in all 3 RPCs.");
  }

  // (3) NEGATIVE — the video-apply edge fn stays independent of the gallery.
  if (b.videoApply !== null && /cover_media_gallery/.test(b.videoApply))
    failures.push(
      "issue-868: event-cover-video-apply/index.ts must NOT reference cover_media_gallery " +
        "(the video-cover path is INDEPENDENT and coexists with the gallery).",
    );

  // (4) the 4 anon hero RPCs project coverGallery.
  if (b.readLayer === null) {
    failures.push("issue-868: read-layer migration (anon hero RPCs) not found.");
  } else {
    for (const fn of [
      "pg_public_event_by_slug",
      "pg_public_rsvp_by_slug",
      "pg_public_trip_by_slug",
      "pg_public_experience_by_slug",
    ]) {
      if (!b.readLayer.includes(fn))
        failures.push(`issue-868: read-layer migration must re-publish ${fn}.`);
    }
    if ((b.readLayer.match(/'coverGallery'/g) || []).length < 4)
      failures.push("issue-868: read-layer migration must project 'coverGallery' in all 4 anon hero RPCs.");
  }

  // (5) renderer wiring.
  if (b.coverGalleryRow === null)
    failures.push("issue-868: packages/offering-rendering/CoverGalleryRow.tsx must exist.");
  if (b.parallaxShell === null || !/galleryImages/.test(b.parallaxShell))
    failures.push("issue-868: ParallaxCoverShell.tsx must wire the galleryImages prop.");

  // (6) RSVP og:image (mandate H). The event <Head> already had one; the RSVP
  // <Head> adds the second, so >= 2 og:image occurrences proves the fix landed.
  if (b.publicEventPage === null || (b.publicEventPage.match(/og:image/g) || []).length < 2)
    failures.push("issue-868: business PublicEventPage.tsx RSVP <Head> must add og:image (>= 2 total).");

  // ---- Pass 2 (Section M) ----
  // (7) consumer app: the shared pager exists + each of the 3 consumer detail
  // screens wires CoverGalleryPager + CoverGalleryRow (they don't mount the shell).
  if (b.coverGalleryPager === null)
    failures.push("issue-868 M.1: packages/offering-rendering/CoverGalleryPager.tsx must exist.");
  for (const [name, src] of [
    ["ConsumerEventDetailScreen", b.consumerEvent],
    ["ConsumerTripDetailScreen", b.consumerTrip],
    ["ConsumerExperienceDetailScreen", b.consumerExperience],
  ]) {
    if (src === null || !/CoverGalleryPager/.test(src) || !/CoverGalleryRow/.test(src))
      failures.push(`issue-868 M.1: ${name} must render CoverGalleryPager + CoverGalleryRow (gallery mode).`);
  }

  // (8) trip + experience INITIAL-publish RPCs persist cover_media_gallery.
  if (b.tripExpPublish === null) {
    failures.push("issue-868 M.2: trip/experience publish migration not found.");
  } else {
    for (const fn of ["business_publish_trip_draft", "biz_publish_experience"]) {
      if (!b.tripExpPublish.includes(fn))
        failures.push(`issue-868 M.2: publish migration must re-publish ${fn}.`);
    }
    if ((b.tripExpPublish.match(/cover_media_gallery\s*=\s*v_cover_media_gallery/g) || []).length < 2)
      failures.push("issue-868 M.2: both trip + experience publish RPCs must write cover_media_gallery.");
  }

  // (9) providers-into-gallery: CoverPicker can append a provider pick to the gallery.
  if (
    b.coverPicker === null ||
    !/providerAddTarget/.test(b.coverPicker) ||
    !/appendGalleryItem/.test(b.coverPicker)
  )
    failures.push("issue-868 M.3: CoverPicker must support appending a GIF/Photo provider pick to the gallery.");
}

const readOrNull = (rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
};

const findMigration = (matcher) => {
  const dir = path.join(root, "supabase/migrations");
  let file = null;
  try {
    file = fs.readdirSync(dir).find(matcher) ?? null;
  } catch {
    return null;
  }
  return file === null ? null : fs.readFileSync(path.join(dir, file), "utf8");
};

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const good = {
    columnMigration:
      "ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_media_gallery jsonb;\n" +
      "ADD CONSTRAINT events_cover_media_gallery_is_array CHECK (jsonb_typeof(cover_media_gallery)='array');",
    service: "export const setEventCoverGallery = async () => { update({ cover_media_gallery: g }); };",
    trips: "if (patch.coverGallery !== undefined) update.cover_media_gallery = patch.coverGallery;",
    writeLayer:
      "business_publish_event_draft cover_media_gallery\n" +
      "business_publish_rsvp_draft cover_media_gallery\n" +
      "biz_update_live_trip cover_media_gallery",
    videoApply: "update({ cover_media_type: 'video', cover_media_url: url });",
    readLayer:
      "pg_public_event_by_slug 'coverGallery'\npg_public_rsvp_by_slug 'coverGallery'\n" +
      "pg_public_trip_by_slug 'coverGallery'\npg_public_experience_by_slug 'coverGallery'",
    coverGalleryRow: "export const CoverGalleryRow = () => null;",
    parallaxShell: "galleryImages?: OfferingGalleryImage[];",
    publicEventPage: 'property="og:image"\nproperty="og:image"',
    // Pass 2 fixtures.
    coverGalleryPager: "export const CoverGalleryPager = () => null;",
    consumerEvent: "import { CoverGalleryPager, CoverGalleryRow } from '@mingla/offering-rendering';",
    consumerTrip: "import { CoverGalleryPager, CoverGalleryRow } from '@mingla/offering-rendering';",
    consumerExperience: "import { CoverGalleryPager, CoverGalleryRow } from '@mingla/offering-rendering';",
    tripExpPublish:
      "business_publish_trip_draft cover_media_gallery = v_cover_media_gallery\n" +
      "biz_publish_experience cover_media_gallery = v_cover_media_gallery",
    coverPicker: "const providerAddTarget = ...; const appendGalleryItem = useCallback(...)",
  };
  const self = [];
  let f = [];
  evaluate(good, f);
  if (f.length) self.push("GOOD bundle wrongly flagged: " + f.join("; "));

  // Per-leg BAD fixtures (each mutation must fire).
  const mutations = {
    "missing column": { ...good, columnMigration: "ALTER TABLE public.events ADD something_else jsonb;" },
    "missing write": { ...good, trips: "// no gallery write" },
    "video-apply leaks gallery": { ...good, videoApply: "update({ cover_media_gallery: [] });" },
    "read-layer drops coverGallery": {
      ...good,
      readLayer: "pg_public_event_by_slug\npg_public_rsvp_by_slug\npg_public_trip_by_slug\npg_public_experience_by_slug",
    },
    "shell drops galleryImages": { ...good, parallaxShell: "coverMediaUrl: string;" },
    "rsvp og:image missing": { ...good, publicEventPage: 'property="og:image"' },
    // Pass 2 BAD fixtures.
    "consumer event drops pager": { ...good, consumerEvent: "// no gallery wiring" },
    "trip/exp publish drops gallery": { ...good, tripExpPublish: "business_publish_trip_draft\nbiz_publish_experience" },
    "providers cannot reach gallery": { ...good, coverPicker: "// cover-only" },
  };
  for (const [name, bundle] of Object.entries(mutations)) {
    f = [];
    evaluate(bundle, f);
    if (f.length === 0) self.push(`BAD (${name}) not flagged`);
  }

  if (self.length) {
    console.error("issue-0868 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-0868 self-test PASS (10/10 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];
evaluate(
  {
    columnMigration: findMigration((n) => /issue_868.*cover_gallery\.sql$/.test(n) && !/read_layer|write_layer/.test(n)),
    readLayer: findMigration((n) => /issue_868.*cover_gallery_read_layer\.sql$/.test(n)),
    writeLayer: findMigration((n) => /issue_868.*cover_gallery_write_layer\.sql$/.test(n)),
    service: readOrNull("mingla-business/src/services/eventCoverMediaService.ts"),
    trips: readOrNull("mingla-business/src/services/tripsService.ts"),
    videoApply: readOrNull("supabase/functions/event-cover-video-apply/index.ts"),
    coverGalleryRow: readOrNull("packages/offering-rendering/CoverGalleryRow.tsx"),
    parallaxShell: readOrNull("packages/offering-rendering/ParallaxCoverShell.tsx"),
    publicEventPage: readOrNull("mingla-business/src/components/event/PublicEventPage.tsx"),
    // Pass 2 (Section M).
    coverGalleryPager: readOrNull("packages/offering-rendering/CoverGalleryPager.tsx"),
    consumerEvent: readOrNull("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx"),
    consumerTrip: readOrNull("app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx"),
    consumerExperience: readOrNull("app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx"),
    tripExpPublish: findMigration((n) => /issue_868.*cover_gallery_trip_exp_publish\.sql$/.test(n)),
    coverPicker: readOrNull("mingla-business/src/components/ui/CoverPicker.tsx"),
  },
  failures,
);

if (failures.length > 0) {
  console.error("issue-0868 cover-gallery feature gate failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("issue-0868 cover-gallery feature gate passed.");
