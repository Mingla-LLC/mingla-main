// issue #868 [cover-gallery] Pass 2 (§M.1/M.2/M.3) — implementor regression for
// the consumer app + trip/experience authoring + initial-publish + providers-into-
// gallery wiring. These surfaces are RN-heavy screens / plpgsql RPCs, so — the
// package house style — they are pinned as SOURCE contracts (read the file →
// assert the wiring). Bare Deno.test + @std/assert.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Remove `<CoverGalleryPager` from ConsumerEventDetailScreen → T-EVENT FAILS.
//   • Drop the coverGallery mapper add in useConsumerTripDetail → T-READ-TRIP FAILS.
//   • Drop cover_media_gallery from business_publish_trip_draft (M.2 migration) →
//     T-PUBLISH FAILS.
//
// Run: deno test --allow-read packages/offering-rendering/__tests__/pass2ConsumerAuthoringWiring.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const EVENT = await read("../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
const TRIP = await read("../../../app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx");
const EXP = await read("../../../app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx");

const screenWiring = (src: string, label: string): void => {
  // Pager over [cover] ++ gallery ONLY in gallery mode; single cover otherwise.
  assert(/galleryActive \? \(\s*\n\s*<CoverGalleryPager/.test(src), `${label}: pager when galleryActive`);
  assert(/coverNode=\{coverMediaNode\}/.test(src), `${label}: page 0 = the EXISTING cover node`);
  assert(/\) : \(\s*\n\s*coverMediaNode\s*\n\s*\)/.test(src), `${label}: single cover node when empty (byte-identical)`);
  // nativeCover pointerEvents flips to auto in gallery mode.
  assert(/pointerEvents=\{galleryActive \? "auto" : "none"\}/.test(src), `${label}: nativeCover pointerEvents`);
  // Row is the body's first child; null when empty.
  assert(/\{galleryRow\}/.test(src), `${label}: galleryRow injected`);
  assert(/const galleryRow = galleryActive \? \(/.test(src), `${label}: galleryRow null when empty`);
  assert(/<CoverGalleryRow/.test(src), `${label}: CoverGalleryRow`);
  // Spacer pointerEvents none in gallery mode (swipe reaches the pinned pager).
  assert(/pointerEvents=\{galleryActive \? "none" : undefined\}/.test(src), `${label}: coverSpacer pointerEvents`);
  // Single owner of the shown item + tap→scrollTo.
  assert(/coverPagerRef\.current\?\.scrollTo/.test(src), `${label}: tap drives scrollTo`);
};

Deno.test("T-EVENT consumer event/RSVP screen wires the pager + row (byte-identical when empty)", () => {
  screenWiring(EVENT, "event");
});
Deno.test("T-TRIP consumer trip screen wires the pager + row (byte-identical when empty)", () => {
  screenWiring(TRIP, "trip");
});
Deno.test("T-EXP consumer experience screen wires the pager + row (byte-identical when empty)", () => {
  screenWiring(EXP, "experience");
});

// ── Consumer READ threading (M.1d) ─────────────────────────────────────────
Deno.test("T-READ-TRIP useConsumerTripDetail maps coverGallery from the RPC", async () => {
  const src = await read("../../../app-mobile/src/hooks/useConsumerTripDetail.ts");
  assert(/coverGallery:\s*Array\.isArray\(p\.coverGallery\)\s*\?\s*p\.coverGallery\s*:\s*\[\]/.test(src));
});
Deno.test("T-READ-EXP useConsumerExperienceDetail maps coverGallery from the RPC", async () => {
  const src = await read("../../../app-mobile/src/hooks/useConsumerExperienceDetail.ts");
  assert(/coverGallery:\s*Array\.isArray\(p\.coverGallery\)\s*\?\s*p\.coverGallery\s*:\s*\[\]/.test(src));
});
Deno.test("T-READ-EVENT event deck-seed threads coverGallery (select + map + foundation)", async () => {
  const seed = await read("../../../app-mobile/src/services/publicEventSeedService.ts");
  assert(/cover_media_gallery/.test(seed), "seed selects cover_media_gallery");
  assert(/coverGallery:\s*Array\.isArray\(row\.cover_media_gallery\)/.test(seed), "seed maps coverGallery");
  const fnd = await read("../../../app-mobile/src/hooks/useConsumerEventFoundation.ts");
  assert(/coverGallery:\s*Array\.isArray\(card\.coverGallery\)/.test(fnd), "foundation maps coverGallery");
});

// ── Trip/experience AUTHORING + initial publish (M.2) ───────────────────────
Deno.test("T-AUTHOR-TRIP trip create + edit forward coverGallery", async () => {
  const step = await read("../../../mingla-business/src/components/trip/TripCreatorStep1Basics.tsx");
  assert(/coverGallery:\s*patch\.coverGallery \?\? \[\]/.test(step), "step forwards coverGallery");
  const wiz = await read("../../../mingla-business/src/components/trip/TripCreatorWizard.tsx");
  assert(/coverGallery:\s*step1Draft\.coverGallery \?\? \[\]/.test(wiz), "autosave patch carries coverGallery");
  const edit = await read("../../../mingla-business/src/components/trip/EditPublishedTripScreen.tsx");
  assert(/patch\.cover_media_gallery = state\.coverGallery \?\? \[\]/.test(edit), "live-edit patch carries cover_media_gallery");
});
Deno.test("T-AUTHOR-EXP experience publish payload carries cover.coverGallery", async () => {
  const wiz = await read("../../../mingla-business/src/components/experience/ExperienceCreatorWizard.tsx");
  assert(/coverGallery:\s*cover\.coverGallery \?\? \[\]/.test(wiz));
});
Deno.test("T-PUBLISH trip + experience initial-publish RPCs persist cover_media_gallery (M.2 migration)", async () => {
  const mig = await read("../../../supabase/migrations/20270116000871_issue_868_cover_gallery_trip_exp_publish.sql");
  assert(/business_publish_trip_draft/.test(mig));
  assert(/biz_publish_experience/.test(mig));
  // trip flat key + experience camelCase key.
  assert(/v_cover_media_gallery := COALESCE\(p_draft_payload->'cover_media_gallery'/.test(mig), "trip reads flat key");
  assert(/v_cover_media_gallery := COALESCE\(v_cover->'coverGallery'/.test(mig), "experience reads camelCase key");
  assert((mig.match(/cover_media_gallery\s*=\s*v_cover_media_gallery/g) ?? []).length >= 2, "both RPCs write the gallery");
});

// ── Providers-into-gallery (M.3) ────────────────────────────────────────────
Deno.test("T-PROVIDERS CoverPicker GIF/Photos can append to the gallery (Cover default unchanged)", async () => {
  const src = await read("../../../mingla-business/src/components/ui/CoverPicker.tsx");
  assert(/providerAddTarget/.test(src), "add-target state");
  assert(/setProviderAddTarget\("cover" \| "gallery">\(\s*\n?\s*"cover",/.test(src) || /useState<"cover" \| "gallery">\(\s*\n\s*"cover",/.test(src), "default Cover");
  assert(/if \(providerAddTarget === "gallery"\) \{\s*\n\s*appendGalleryItem\(/.test(src), "gallery mode appends the provider pick");
  assert(/const appendGalleryItem = useCallback/.test(src), "shared append path");
});
