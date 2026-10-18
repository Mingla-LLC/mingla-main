// MINGLA-INVARIANT: I-3960-EXPLORER-HOST-FONT-NATIVE-METRICS | issue #3960 | Explorer text rendered with a host-selected font derives vertical metrics from that font instead of a fixed lineHeight.
//
// Source-structural coverage is intentional: these React Native surfaces cannot
// be imported by the Deno unit lane, while deleting any of the production fixes
// below must still fail in CI.

const read = async (relativePath: string): Promise<string> =>
  await Deno.readTextFile(new URL(relativePath, import.meta.url));

const sources = {
  rsvpMomentum: await read("../RsvpMomentumDecision.tsx"),
  offeringMomentum: await read("../OfferingMomentum.tsx"),
  chipIn: await read("../RsvpChipInPanel.tsx"),
  event: await read("../EventOfferingBody.tsx"),
  guestCluster: await read("../GuestAvatarCluster.tsx"),
  brand: await read("../../brand-rendering/PublicBrandPage.tsx"),
  menu: await read("../../brand-rendering/PublicMenuSections.tsx"),
  orderingMenu: await read(
    "../../brand-rendering/venueOrdering/VenueOrderingMenuList.tsx",
  ),
  venue: await read("../../brand-rendering/PublicVenueScreen.tsx"),
  reservePicker: await read(
    "../../../app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
  ),
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const styleBlock = (source: string, styleName: string): string => {
  const styleSheetStart = source.lastIndexOf("StyleSheet.create({");
  const styles = styleSheetStart >= 0 ? source.slice(styleSheetStart) : source;
  const block = new RegExp(`\\b${styleName}:\\s*\\{([^{}]*)\\}`);
  return styles.match(block)?.[0] ?? "";
};

const assertUsesNativeFontMetrics = (
  surface: string,
  source: string,
  styleName: string,
): void => {
  const style = styleBlock(source, styleName);
  assert(style.length > 0, `${surface} must keep styles.${styleName}`);
  assert(
    !/\blineHeight\s*:/.test(style),
    `${surface} styles.${styleName} must defer to the selected font metrics`,
  );
  assert(
    new RegExp(
      `styles\\.${styleName}[\\s\\S]{0,220}(?:fontFamily|themedFont|fontStyle)`,
    ).test(source),
    `${surface} styles.${styleName} must remain wired to the selected font`,
  );
};

Deno.test("#3960 reported momentum count and brand name use native font metrics", () => {
  assertUsesNativeFontMetrics(
    "RSVP momentum",
    sources.rsvpMomentum,
    "momCount",
  );
  assertUsesNativeFontMetrics(
    "cross-offering momentum",
    sources.offeringMomentum,
    "momCount",
  );
  assertUsesNativeFontMetrics(
    "public brand identity",
    sources.brand,
    "brandName",
  );
});

Deno.test("#3960 Explorer host-font sweep has no undersized fixed line boxes", () => {
  const cases: Array<[string, string, string]> = [
    ["public brand next-up teaser", sources.brand, "nextTeaserBody"],
    ["public brand offering card", sources.brand, "oCardTitle"],
    ["public brand tagline", sources.brand, "tagline"],
    ["public menu section", sources.menu, "menuSectionName"],
    ["venue ordering section", sources.orderingMenu, "sectionName"],
    ["public venue themed prose", sources.venue, "aboutBodyThemed"],
    ["RSVP chip-in heading", sources.chipIn, "heading"],
    ["RSVP chip-in success", sources.chipIn, "successHeading"],
    ["event acquisition heading", sources.event, "acquisitionHeading"],
    ["experience reserve picker", sources.reservePicker, "headerTitle"],
  ];

  for (const [surface, source, styleName] of cases) {
    assertUsesNativeFontMetrics(surface, source, styleName);
  }
});

Deno.test("#3960 See who's going CTA keeps an uncapped native-font line box", () => {
  assertUsesNativeFontMetrics(
    "guest cluster CTA",
    sources.guestCluster,
    "seeLabel",
  );
  const row = styleBlock(sources.guestCluster, "seeRow");
  assert(
    /\bminHeight\s*:/.test(row),
    "CTA row must retain tap-friendly minimum height",
  );
  assert(
    !/(?:^|[,\s])height\s*:/.test(row),
    "CTA row must not cap the selected font height",
  );
});
