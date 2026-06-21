/**
 * ORCH-1186-D — happy-path + round-trip regression for the composer deep-link
 * builder. This is the §9 regression anchor for the venue blasts entry point:
 * the helper is the ONE place the composer URL is constructed, and its output
 * MUST round-trip through `parseAudienceParam` (I-PROPOSED-BU).
 *
 * Fails-on-revert: if `buildComposeAudienceHref` is reverted to a malformed /
 * changed shape (drops `audience=`, changes the `{kind}:{id}` separator, or
 * changes the path), T-1/T-3 fail on the exact string and T-2 fails the
 * round-trip through the parser.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 */

import { buildComposeAudienceHref } from "../composeAudienceHref";
import { parseAudienceParam } from "../../hooks/marketing/parseAudienceParam";

const BRAND_ID = "11111111-2222-3333-4444-555555555555";
const EVENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("buildComposeAudienceHref (ORCH-1186-D)", () => {
  it("T-1 — builds the brand-audience composer href exactly", () => {
    expect(buildComposeAudienceHref("brand", BRAND_ID)).toBe(
      `/marketing/campaigns/compose?audience=brand:${BRAND_ID}`,
    );
  });

  it("T-3 — builds the event-audience composer href exactly", () => {
    expect(buildComposeAudienceHref("event", EVENT_ID)).toBe(
      `/marketing/campaigns/compose?audience=event:${EVENT_ID}`,
    );
  });

  it("T-2 — brand href round-trips back through parseAudienceParam", () => {
    const href = buildComposeAudienceHref("brand", BRAND_ID);
    // Pull out the `audience=...` value the composer reads from the route.
    const param = href.split("audience=")[1];
    expect(parseAudienceParam(param)).toEqual({ kind: "brand", id: BRAND_ID });
  });

  it("T-2b — event href round-trips back through parseAudienceParam", () => {
    const href = buildComposeAudienceHref("event", EVENT_ID);
    const param = href.split("audience=")[1];
    expect(parseAudienceParam(param)).toEqual({ kind: "event", id: EVENT_ID });
  });
});
