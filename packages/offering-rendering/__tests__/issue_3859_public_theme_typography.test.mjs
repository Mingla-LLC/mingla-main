import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const offeringSources = [
  ["event", read("../EventOfferingBody.tsx")],
  ["rsvp", read("../RsvpOfferingBody.tsx")],
  ["trip", read("../TripOfferingBody.tsx")],
  ["experience", read("../ExperienceOfferingBody.tsx")],
];

const styleBlock = (source, styleName) => {
  const multiline = new RegExp(`${styleName}: \\{([\\s\\S]*?)\\n  \\},`);
  const inline = new RegExp(`${styleName}: \\{([^}]*)\\}`);
  return source.match(multiline)?.[0] ?? source.match(inline)?.[0] ?? "";
};

test("#3859 public offering titles defer to the selected font's native metrics", () => {
  for (const [surface, source] of offeringSources) {
    const title = styleBlock(source, "title");
    assert.notEqual(title, "", `${surface} must keep one title style`);
    assert.doesNotMatch(
      title,
      /lineHeight/,
      `${surface} must not force Inter-sized line metrics onto host fonts such as Anton`,
    );
  }
});

test("#3859 public venue themed text does not use undersized fixed line boxes", () => {
  const venue = read("../../brand-rendering/PublicVenueScreen.tsx");
  for (const styleName of [
    "venueName",
    "answerValue",
    "refreshMessage",
    "deskName",
    "deskPitch",
  ]) {
    const style = styleBlock(venue, styleName);
    assert.notEqual(style, "", `venue must keep ${styleName}`);
    assert.doesNotMatch(
      style,
      /lineHeight/,
      `${styleName} must defer to the selected font's metrics`,
    );
  }
});

test("#3859 currency values stay out of host fonts that may omit their glyphs", () => {
  const event = offeringSources[0][1];
  const trip = offeringSources[2][1];
  const experience = offeringSources[3][1];
  const reserveBar = read("../TripReserveBar.tsx");

  assert.match(event, /moneyText: \{ fontVariant: \["tabular-nums"\] \}/);
  assert.match(
    event,
    /styles\.tierPrice,[\s\S]*?surface\.primaryText,[\s\S]*?styles\.moneyText/,
  );
  assert.match(
    event,
    /styles\.totalValue,[\s\S]*?surface\.primaryText,[\s\S]*?styles\.moneyText/,
  );

  assert.match(
    experience,
    /style=\{\[styles\.pricingPrice, surface\.primaryText\]\}/,
  );
  assert.doesNotMatch(
    experience,
    /styles\.pricingPrice, surface\.primaryText, \{ fontFamily: boldFamily \}/,
  );

  assert.match(
    trip,
    /styles\.selectPrice, surface\.primaryText, styles\.moneyText/,
  );
  assert.match(
    trip,
    /styles\.pkgPrice, surface\.primaryText, styles\.moneyText/,
  );

  for (const styleName of [
    "floatPrice",
    "segmentAmount",
    "segmentAmountCompact",
    "rPrice",
  ]) {
    assert.match(
      styleBlock(reserveBar, styleName),
      /fontVariant: \["tabular-nums"\]/,
    );
  }
  assert.doesNotMatch(
    reserveBar,
    /styles\.(?:floatPrice|rPrice)[^\n]*fontStyle/,
  );
});
