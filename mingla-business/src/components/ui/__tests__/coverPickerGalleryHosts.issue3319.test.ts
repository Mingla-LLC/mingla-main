/**
 * Issue #3319 — Additional photos on a screen that cannot save them.
 *
 * The shared cover sheet rendered "Additional photos" (and the GIF/Photos
 * "Add to: Gallery" option) on EVERY host. Venue listing, venue claim, venue
 * deck readiness, brand edit, brand creation and both Ari proposal-card mounts
 * never read `coverGallery` from the emitted patch: a photo added there
 * uploaded, showed "Photo added.", and was never saved. Only event rows have an
 * additional-photos column.
 *
 * Decision (#3318 spec S7): hide it. `galleryEnabled` defaults to false on
 * CoverPickerSheet and CoverPicker; hosts that save the gallery opt in.
 *
 * SOURCE WIRING (CoverPicker cannot mount under jest). Each assertion reads the
 * host's actual `<CoverPickerSheet …/>` element(s).
 *
 * FAILS-ON-REVERT: proven in the #3318 implementation record.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

const SRC = join(__dirname, "..", "..", "..");
const read = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** Every `<CoverPickerSheet …/>` element in a file, comments stripped. */
const sheetMounts = (relative: string): string[] => {
  const source = executable(read(relative));
  const mounts: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<CoverPickerSheet", from);
    if (start === -1) break;
    const end = source.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    mounts.push(source.slice(start, end));
    from = end;
  }
  return mounts;
};

/** The host saves the gallery: these hosts' `onCoverChange` reads `coverGallery`. */
const SAVING_HOSTS: Array<[string, number, RegExp]> = [
  // event wizard, RSVP wizard and published-event edit all render this step
  ["components/event/CreatorStep4Cover.tsx", 1, /coverGallery:\s*\n?\s*draft\.coverGallery === undefined/],
  ["components/experience/ExperienceCoverStep.tsx", 1, /onCoverChange=\{onCoverChange\}/],
  ["components/trip/TripCreatorStep1Basics.tsx", 1, /coverGallery: patch\.coverGallery \?\? \[\]/],
  ["components/trip/EditPublishedTripScreen.tsx", 1, /coverGallery: patch\.coverGallery \?\? \[\]/],
];

/** The host does NOT save the gallery. */
const NON_SAVING_HOSTS: Array<[string, number]> = [
  ["components/venue/VenueCoverStep.tsx", 1],
  ["components/venue/claim/ClaimStepCover.tsx", 1],
  ["components/venue/VenueDeckReadinessSetup.tsx", 1],
  ["components/brand/BrandEditView.tsx", 1],
  ["components/brand/BrandCreationFlow.tsx", 1],
  ["components/ari/ToolProposalCard.tsx", 2],
];

describe("issue #3319 — Additional photos only where they are saved", () => {
  test.each(SAVING_HOSTS)("%s saves the gallery and opts in on every mount", (file, count, savesGallery) => {
    const mounts = sheetMounts(file);
    expect(mounts).toHaveLength(count);
    for (const mount of mounts) expect(mount).toMatch(/\bgalleryEnabled\b(?!=\{false\})/);
    expect(executable(read(file))).toMatch(savesGallery);
  });

  test("the experience wizard publishes the gallery the step's patch carries", () => {
    expect(executable(read("components/experience/ExperienceCreatorWizard.tsx"))).toContain(
      "coverGallery: cover.coverGallery ?? [],",
    );
  });

  test.each(NON_SAVING_HOSTS)("%s does not save a gallery and does not opt in", (file, count) => {
    const mounts = sheetMounts(file);
    expect(mounts).toHaveLength(count);
    for (const mount of mounts) expect(mount).not.toMatch(/galleryEnabled/);
    expect(executable(read(file))).not.toMatch(/coverGallery|cover_media_gallery/);
  });

  test("every CoverPickerSheet mount in the app is classified above", () => {
    const classified = new Set([...SAVING_HOSTS.map(([file]) => file), ...NON_SAVING_HOSTS.map(([file]) => file)]);
    const found: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(SRC, relative), { withFileTypes: true })) {
        const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(child);
        } else if (entry.name.endsWith(".tsx") && executable(read(child)).includes("<CoverPickerSheet")) {
          found.push(child);
        }
      }
    };
    walk("");
    const mounts = found.filter((file) => file !== "components/ui/CoverPickerSheet.tsx");
    expect(mounts.length).toBeGreaterThanOrEqual(SAVING_HOSTS.length + NON_SAVING_HOSTS.length);
    for (const file of mounts) expect(classified).toContain(file);
  });

  test("the sheet and the picker default the gallery OFF and forward the flag", () => {
    const sheet = executable(read("components/ui/CoverPickerSheet.tsx"));
    expect(sheet).toContain("galleryEnabled = false,");
    expect(sheet).toContain("galleryEnabled={galleryEnabled}");
    const picker = executable(read("components/ui/CoverPicker.tsx"));
    expect(picker).toContain("galleryEnabled = false,");
  });

  test("the picker renders neither the section nor the Add-to row without the flag", () => {
    const picker = executable(read("components/ui/CoverPicker.tsx"));
    expect(picker).toMatch(/\{galleryEnabled \? \(\s*<AdditionalPhotosSection\b/);
    expect((picker.match(/<AdditionalPhotosSection\b/g) ?? []).length).toBe(1);
    expect(picker).toMatch(
      /\{galleryEnabled && \(activeTab === "gif" \|\| activeTab === "stock"\) \? \(\s*<View style=\{styles\.addTargetRow\}/,
    );
    expect((picker.match(/styles\.addTargetRow\}/g) ?? []).length).toBe(1);
  });
});
