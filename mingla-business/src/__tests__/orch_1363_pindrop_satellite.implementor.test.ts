/**
 * Issue #1363 (CHANGE 3 — satellite imagery in the pin-drop) — IMPLEMENTOR test.
 *
 * There are no street labels to rely on in un-indexed Nigerian areas, so the
 * PinDropSheet must OPEN on Mapbox satellite-streets imagery (aerial photography +
 * road/label overlay) so the brand can visually find their building/junction, with
 * a toggle down to the plain dark map. The `static-map` edge fn ALREADY allowlists
 * `satellite-streets-v12` and `buildStaticMapUrl`'s `style` param already threads
 * it end-to-end, so CHANGE 3 is purely additive on the client — NO proxy change.
 *
 * FAILS-ON-REVERT:
 *  - Flip PIN_DROP_DEFAULT_SATELLITE to false (open on the plain map) ⇒ the
 *    "defaults to satellite" assertion FAILS.
 *  - Break the satellite style id ⇒ pinDropMapStyle(true) + the threading
 *    assertion FAIL.
 *
 * Pure node-env test: `pinDropMapStyle` is react-free, and the proxy URL is built
 * via the react-free `buildProxyStaticMapUrl` (imported by source path, per the
 * sibling suites' note — the `@mingla/*` specifier resolves to the stale anchor).
 */

import { buildProxyStaticMapUrl } from "../../../packages/offering-rendering/mapboxStaticProxyUrl";
import {
  PIN_DROP_DEFAULT_SATELLITE,
  PIN_DROP_MAP_STYLE,
  PIN_DROP_SATELLITE_STYLE,
  pinDropMapStyle,
} from "../utils/pinDropMapStyle";

const BASE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1";

describe("Issue #1363 CHANGE 3 — satellite imagery in the pin-drop", () => {
  it("OPENS on satellite imagery by default (imagery-first for label-less NG areas)", () => {
    expect(PIN_DROP_DEFAULT_SATELLITE).toBe(true);
    expect(pinDropMapStyle(PIN_DROP_DEFAULT_SATELLITE)).toBe(
      "satellite-streets-v12",
    );
  });

  it("satellite-on → satellite-streets-v12 (imagery + road/label overlay)", () => {
    expect(pinDropMapStyle(true)).toBe("satellite-streets-v12");
    expect(PIN_DROP_SATELLITE_STYLE).toBe("satellite-streets-v12");
  });

  it("satellite-off → the plain dark vector map", () => {
    expect(pinDropMapStyle(false)).toBe("dark-v11");
    expect(PIN_DROP_MAP_STYLE).toBe("dark-v11");
  });

  it("threads the chosen style through buildStaticMapUrl's proxy query — no proxy change", () => {
    const satUrl = buildProxyStaticMapUrl(
      { lat: 6.4478, lng: 3.4723, style: pinDropMapStyle(true) },
      BASE,
    );
    expect(satUrl).not.toBeNull();
    expect(satUrl).toContain("/static-map?");
    expect(satUrl).toContain("style=satellite-streets-v12");

    const mapUrl = buildProxyStaticMapUrl(
      { lat: 6.4478, lng: 3.4723, style: pinDropMapStyle(false) },
      BASE,
    );
    expect(mapUrl).toContain("style=dark-v11");
  });
});
