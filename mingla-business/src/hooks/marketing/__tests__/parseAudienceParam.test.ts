/**
 * T-B01 / I-PROPOSED-BU — pre-fill query param shape `{kind}:{uuid}`.
 */

import { parseAudienceParam } from "../parseAudienceParam";

describe("parseAudienceParam", () => {
  it("parses brand audience param", () => {
    const out = parseAudienceParam("brand:11111111-2222-3333-4444-555555555555");
    expect(out).toEqual({
      kind: "brand",
      id: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("parses event audience param", () => {
    const out = parseAudienceParam("event:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(out).toEqual({
      kind: "event",
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
  });

  it("rejects unknown kinds", () => {
    expect(parseAudienceParam("audience:11111111-2222-3333-4444-555555555555"))
      .toBeNull();
    expect(parseAudienceParam("brand_followers:11111111-2222-3333-4444-555555555555"))
      .toBeNull();
  });

  it("rejects bad UUIDs", () => {
    expect(parseAudienceParam("brand:not-a-uuid")).toBeNull();
    expect(parseAudienceParam("brand:")).toBeNull();
    expect(parseAudienceParam("brand")).toBeNull();
  });

  it("rejects null/undefined/empty input", () => {
    expect(parseAudienceParam(null)).toBeNull();
    expect(parseAudienceParam(undefined)).toBeNull();
    expect(parseAudienceParam("")).toBeNull();
  });

  it("rejects malformed delimiter", () => {
    expect(parseAudienceParam("brand|11111111-2222-3333-4444-555555555555"))
      .toBeNull();
    expect(parseAudienceParam("brand-11111111-2222-3333-4444-555555555555"))
      .toBeNull();
  });
});
