/**
 * issue #3237 [after Publish, land on the manage screen] — implementor
 * structural contract for the routes. Append-only: NEW file.
 *
 * The publish routes and manage screens sit on Expo Router + several stores and
 * are too heavy to mount under node/ts-jest (the same reason the sibling
 * app/rsvp/[id]/__tests__/index.test.tsx reads source). The behaviour of the
 * signal, the banner, the trip menu and the draft rule is proven by render and
 * unit tests in:
 *   src/utils/__tests__/issue_3237_just_published_signal.implementor.test.ts
 *   src/components/offering/__tests__/issue_3237_published_banner.implementor.test.tsx
 *   src/components/trip/__tests__/issue_3237_trip_manage_menu_draft.implementor.test.tsx
 * This file pins the WIRING those tests cannot see.
 *
 * Comments are stripped before matching, so a commented-out line cannot keep a
 * test green.
 *
 * FAILS-ON-REVERT (true line deletion), one per behaviour:
 *  - event:      restore `router.replace(`/e/${...}`)` in app/event/[id]/edit.tsx
 *  - RSVP:       restore the `rsvpPostPublishRoute` call in app/rsvp/[id]/edit.tsx
 *  - trip:       delete `markJustPublished(published.id)` in app/trip/[id]/edit.tsx
 *  - experience: restore the unconditional Hub-list replace in create.tsx, or
 *                delete `onPublished?.(savedId)` in the wizard
 *  - banner:     delete a `<LazyPublishedBanner` mount from a manage screen
 *  - drafts:     restore `trip.brandSlug !== null && ...` / `hasPublicPage` as the
 *                Share guard, or `hasBrandSlug` in the Hub menu
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const APP = join(__dirname, "..");
const SRC = join(__dirname, "..", "..", "src");

/** Source with block and line comments removed (JSX `{/* *\/}` included). */
const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const eventEdit = code(join(APP, "event", "[id]", "edit.tsx"));
const eventManage = code(join(APP, "event", "[id]", "index.tsx"));
const rsvpEdit = code(join(APP, "rsvp", "[id]", "edit.tsx"));
const rsvpManage = code(join(APP, "rsvp", "[id]", "index.tsx"));
const tripEdit = code(join(APP, "trip", "[id]", "edit.tsx"));
const tripManage = code(join(APP, "trip", "[id]", "index.tsx"));
const experienceCreate = code(join(APP, "experience", "create.tsx"));
const experienceEdit = code(join(APP, "experience", "[id]", "edit.tsx"));
const experienceManage = code(join(APP, "experience", "[id]", "index.tsx"));
const hubExperiences = code(join(APP, "(tabs)", "hub", "experiences.tsx"));
const experienceWizard = code(
  join(SRC, "components", "experience", "ExperienceCreatorWizard.tsx"),
);

/** The `mode === "published"` branch of a wizard route's handleExit. */
const publishedBranch = (source: string): string => {
  const start = source.indexOf('if (mode === "published")');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("} else {", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("#3237 publishing lands on the item's manage screen", () => {
  test("event: publish goes to /event/{id} with the just-published signal", () => {
    const branch = publishedBranch(eventEdit);
    expect(branch).toMatch(/markJustPublished\(publishedEventId\)/);
    expect(branch).toMatch(
      /router\.replace\(\s*`\/event\/\$\{encodeURIComponent\(publishedEventId\)\}`/,
    );
    // The signal is set before the navigation that consumes it.
    expect(branch.indexOf("markJustPublished(")).toBeLessThan(
      branch.indexOf("`/event/${"),
    );
    // ...and the buyer's page is no longer the destination.
    expect(branch).not.toMatch(/`\/e\/\$\{/);
    expect(eventEdit).not.toMatch(/router\.replace\(\s*`\/e\/\$\{/);
  });

  test("event: the id comes from what the publish actually wrote", () => {
    expect(eventEdit).toMatch(
      /publishedEventIdRef\.current\s*=\s*published\.event\.serverEventId \?\? published\.event\.id/,
    );
  });

  test("RSVP: every visibility goes to /rsvp/{id} with the just-published signal", () => {
    const branch = publishedBranch(rsvpEdit);
    expect(branch).toMatch(/markJustPublished\(publishedEventId\)/);
    expect(branch).toMatch(
      /router\.replace\(\s*`\/rsvp\/\$\{encodeURIComponent\(publishedEventId\)\}`/,
    );
    expect(branch.indexOf("markJustPublished(")).toBeLessThan(
      branch.indexOf("`/rsvp/${"),
    );
    // No visibility fork and no public-page destination any more.
    expect(branch).not.toMatch(/visibility/);
    expect(rsvpEdit).not.toMatch(/rsvpPostPublishRoute/);
    expect(rsvpEdit).not.toMatch(/router\.replace\(\s*`\/e\/\$\{/);
  });

  test("trip: publish marks the trip just-published before opening /trip/{id}", () => {
    expect(tripEdit).toMatch(
      /onPublished=\{\(published\) => \{\s*markJustPublished\(published\.id\);\s*router\.replace\(`\/trip\/\$\{published\.id\}` as never\);/,
    );
  });

  test("experience wizard: reports a PUBLISH, and only a publish, before completing", () => {
    // Inside the `if (publish) {` block of the draft/create submit path…
    const start = experienceWizard.indexOf(
      'postHogService.capture("offering_published"',
    );
    expect(start).toBeGreaterThan(-1);
    const complete = experienceWizard.indexOf("onComplete(savedId);", start);
    const published = experienceWizard.indexOf("onPublished?.(savedId);", start);
    expect(published).toBeGreaterThan(start);
    expect(published).toBeLessThan(complete);
    // …and nowhere else: a draft save and a live edit are not a publish.
    expect(experienceWizard.match(/onPublished\?\.\(/g)).toHaveLength(1);
    const publishBlock = experienceWizard.slice(
      experienceWizard.lastIndexOf("if (publish) {", published),
      published,
    );
    expect(publishBlock.split("{").length - publishBlock.split("}").length).toBe(1);
  });

  test("experience create: a publish opens /experience/{id}; a draft save keeps the Hub list", () => {
    expect(experienceCreate).toMatch(/onPublished=\{markJustPublished\}/);
    expect(experienceCreate).toMatch(
      /if \(isJustPublishedPending\(newExperienceId\)\) \{\s*router\.replace\(`\/experience\/\$\{newExperienceId\}` as never\);\s*return;\s*\}\s*router\.replace\("\/\(tabs\)\/hub\/experiences" as never\);/,
    );
  });

  test("experience edit: a publish marks the experience before opening /experience/{id}", () => {
    expect(experienceEdit).toMatch(/onPublished=\{markJustPublished\}/);
    expect(experienceEdit).toMatch(
      /router\.replace\(`\/experience\/\$\{id\}` as never\)/,
    );
  });
});

describe("#3237 experience saves refresh the list and the manage screen", () => {
  test.each([
    ["create", () => experienceCreate],
    ["edit", () => experienceEdit],
  ])("%s route invalidates list + detail through the key factories", (_name, read) => {
    const source = read();
    expect(source).toMatch(
      /invalidateQueries\(\{\s*queryKey: experienceKeys\.listByBrand\(/,
    );
    expect(source).toMatch(
      /invalidateQueries\(\{\s*queryKey: experienceDetailKeys\.detail\(/,
    );
    // Key factories only — no hand-written key arrays.
    expect(source).not.toMatch(/queryKey:\s*\[/);
  });
});

describe("#3237 the manage screens show the banner once, with their own handlers", () => {
  const banner = (source: string): string => {
    const start = source.indexOf("<LazyPublishedBanner");
    expect(start).toBeGreaterThan(-1);
    // Exactly one mount per screen.
    expect(source.indexOf("<LazyPublishedBanner", start + 1)).toBe(-1);
    return source.slice(start, source.indexOf("/>", start));
  };
  const gatedOnArrival = (source: string): void => {
    expect(source).toMatch(/useJustPublishedArrival\(/);
    expect(source).toMatch(
      /\{publishedArrival\.justPublished \? \(\s*<LazyPublishedBanner/,
    );
  };

  test("event: banner uses the header Share handler and the Public page tile handler", () => {
    gatedOnArrival(eventManage);
    const b = banner(eventManage);
    expect(b).toMatch(/onShare=\{shareability\.shareable \? handleShareOpen : undefined\}/);
    expect(b).toMatch(/onViewPublic=\{\s*shareability\.shareable \? handleViewPublic : undefined\s*\}/);
    expect(b).toMatch(/onDismiss=\{publishedArrival\.dismiss\}/);
    expect(b).toMatch(/kind=\{publishedEventBannerKind\(event\.tickets\)\}/);
    // The same handlers the screen's existing controls use.
    expect(eventManage).toMatch(/icon="share"\s*size=\{36\}\s*onPress=\{handleShareOpen\}/);
    expect(eventManage).toMatch(/label="Public page"\s*onPress=\{handleViewPublic\}/);
  });

  test("RSVP: banner uses the screen's handlers; a private RSVP gets neither button", () => {
    gatedOnArrival(rsvpManage);
    const b = banner(rsvpManage);
    expect(b).toMatch(/kind="rsvp"/);
    // offeringShareability is false for a private RSVP, so both are withheld.
    expect(b).toMatch(/onShare=\{shareability\.shareable \? handleShareOpen : undefined\}/);
    expect(b).toMatch(/onViewPublic=\{\s*shareability\.shareable \? handleViewPublic : undefined\s*\}/);
    expect(b).toMatch(/onDismiss=\{publishedArrival\.dismiss\}/);
    expect(rsvpManage).toMatch(/icon="share"\s*size=\{36\}\s*onPress=\{handleShareOpen\}/);
    expect(rsvpManage).toMatch(/label="Public page"\s*onPress=\{handleViewPublic\}/);
  });

  test("trip: banner, header Share and the options menu share one pair of handlers", () => {
    gatedOnArrival(tripManage);
    const b = banner(tripManage);
    expect(b).toMatch(/kind="trip"/);
    expect(b).toMatch(/onShare=\{canOpenPublic \? handleShareOpen : undefined\}/);
    expect(b).toMatch(/onViewPublic=\{canOpenPublic \? handleViewPublic : undefined\}/);
    expect(b).toMatch(/onDismiss=\{publishedArrival\.dismiss\}/);
    expect(tripManage).toMatch(/icon="share"\s*size=\{36\}\s*onPress=\{handleShareOpen\}/);
    expect(tripManage).toMatch(/<TripManageMenu[\s\S]*?onShare=\{handleShareOpen\}[\s\S]*?onViewPublic=\{handleViewPublic\}/);
    // One share sheet on the screen — the banner did not bring a second.
    expect(tripManage.match(/<ShareModal/g)).toHaveLength(1);
  });

  test("experience: banner, header Share and the options menu share one pair of handlers", () => {
    gatedOnArrival(experienceManage);
    const b = banner(experienceManage);
    expect(b).toMatch(/kind="experience"/);
    expect(b).toMatch(/onShare=\{canOpenPublic \? handleShareOpen : undefined\}/);
    expect(b).toMatch(/onViewPublic=\{canOpenPublic \? handleViewPublic : undefined\}/);
    expect(b).toMatch(/onDismiss=\{publishedArrival\.dismiss\}/);
    expect(experienceManage).toMatch(/icon="share"\s*size=\{36\}\s*onPress=\{handleShareOpen\}/);
    expect(experienceManage).toMatch(/onViewPublic: canOpenPublic \? handleViewPublic : undefined/);
    expect(experienceManage).toMatch(/onShare: canOpenPublic \? handleShareOpen : undefined/);
    expect(experienceManage.match(/<ShareModal/g)).toHaveLength(1);
  });

  test.each([
    ["event", () => eventManage],
    ["RSVP", () => rsvpManage],
  ])("%s: one share sheet on the screen", (_name, read) => {
    expect(read().match(/<ShareModal/g)).toHaveLength(1);
  });
});

describe("#3237 drafts do not offer links that open 'not found'", () => {
  test("trip manage: Share, the Public page tile, the menu rows and the sheet follow canOpenPublic", () => {
    expect(tripManage).toMatch(
      /const canOpenPublic = canOfferPublicLinks\(\{\s*status: trip\.status,\s*brandSlug: trip\.brandSlug,\s*\}\);/,
    );
    expect(tripManage).toMatch(/&& canOpenPublic \? \(\s*<IconChrome\s*icon="share"/);
    expect(tripManage).toMatch(/if \(tile\.key === "public" && !canOpenPublic\) \{\s*return null;/);
    expect(tripManage).toMatch(/canOpenPublicPage=\{canOpenPublic\}/);
    expect(tripManage).toMatch(/&& canOpenPublic \? \(\s*<ShareModal/);
    // The old guard looked at the brand address ONLY, so a draft passed it. The
    // brand-address check stays (an older test pins it); the draft rule is added.
    expect(tripManage).not.toMatch(
      /\{trip\.brandSlug !== null && trip\.brandSlug\.length > 0 \? \(\s*<(IconChrome|ShareModal)/,
    );
  });

  test("trip manage: a draft reads 'Draft', not 'Upcoming'", () => {
    expect(tripManage).toMatch(
      /\{trip\.status === "draft" \? \(\s*<Pill variant="draft">Draft<\/Pill>\s*\) : \(\s*<TripDetailHeroStatusPill status=\{tripLifecycleStatus\} \/>/,
    );
  });

  test("experience manage: Share, the Public page tile, the menu rows and the sheet follow canOpenPublic", () => {
    expect(experienceManage).toMatch(
      /const canOpenPublic = canOfferPublicLinks\(\{\s*status: experience\.status,\s*brandSlug: experience\.brandSlug,\s*\}\);/,
    );
    expect(experienceManage).toMatch(/\{canOpenPublic \? \(\s*<IconChrome\s*icon="share"/);
    expect(experienceManage).toMatch(/if \(tile\.key === "public" && !canOpenPublic\) return null;/);
    expect(experienceManage).toMatch(/\{canOpenPublic \? \(\s*<ShareModal/);
    expect(experienceManage).not.toMatch(/\{hasPublicPage \? \(\s*<(IconChrome|ShareModal)/);
    expect(experienceManage).not.toMatch(/on(Share|ViewPublic): hasPublicPage/);
  });

  test("Hub experiences menu: View public page and Share follow the draft rule", () => {
    expect(hubExperiences).toMatch(
      /onViewPublic: canOfferPublicLinks\(\{\s*status: manageExp\.status,\s*brandSlug,\s*\}\)\s*\?/,
    );
    expect(hubExperiences).toMatch(
      /onShare: canOfferPublicLinks\(\{\s*status: manageExp\.status,\s*brandSlug,\s*\}\)\s*\?/,
    );
    expect(hubExperiences).not.toMatch(/on(Share|ViewPublic): hasBrandSlug/);
  });
});
