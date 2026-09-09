// @vitest-environment jsdom
/*
 * #3149 — the map, and the promise attached to it.
 *
 * The reference site drops a Google Maps iframe into its Visit page on load,
 * which hands a third party every visitor's address and the page they are
 * reading before anyone has asked to see a map. This does not, and "does not"
 * is a runtime claim: the panel could regress to an eager iframe without a
 * single class name changing.
 *
 * So the component is mounted, the DOM is read before any interaction, the
 * control is pressed, and the DOM is read again.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAP_TILE_ORIGIN, MapEmbed, mapEmbedUrl } from "./MapEmbed";
import { MAP_FRAME_ORIGIN, buildCsp } from "../lib/csp";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LAT = 6.4471033;
const LON = 3.4680182;
const LABEL = "Admiralty Way, Lekki Phase 1, Lagos";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (latitude = LAT, longitude = LON) => {
  act(() => {
    root.render(
      <MapEmbed latitude={latitude} longitude={longitude} label={LABEL} />,
    );
  });
};

const frame = () => host.querySelector("iframe");
const loadButton = () =>
  [...host.querySelectorAll("button")].find((button) =>
    button.textContent === "Show the map"
  );

describe("#3149 nothing is requested until a visitor asks", () => {
  it("mounts with NO iframe and NO reference to the map host", () => {
    mount();
    expect(frame()).toBeNull();
    expect(host.innerHTML).not.toMatch(/(?:src|href)="[^"]*openstreetmap/);
  });

  it("says who will be contacted, before the control is pressed", () => {
    mount();
    const button = loadButton()!;
    expect(button).toBeDefined();
    const note = host.querySelector<HTMLElement>(
      `#${button.getAttribute("aria-describedby")}`,
    );
    // The control is described BY the sentence naming the third party, so a
    // screen reader hears it as part of the control rather than after it.
    expect(note?.textContent ?? "").toContain("openstreetmap.org");
    expect(note?.textContent ?? "").toContain("until you press this");
  });

  it("prints the place it is about to show", () => {
    mount();
    expect(host.textContent).toContain(LABEL);
  });

  it("loads the frame ONLY after the control is pressed", () => {
    mount();
    expect(frame()).toBeNull();
    act(() => {
      loadButton()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toContain(MAP_TILE_ORIGIN);
    expect(iframe!.getAttribute("title")).toBe(`Map of ${LABEL}`);
    expect(iframe!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe!.getAttribute("loading")).toBe("lazy");
  });

  it("can be put away again", () => {
    mount();
    act(() => {
      loadButton()!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const hide = [...host.querySelectorAll("button")].find((button) =>
      button.textContent === "Hide the map"
    )!;
    act(() => {
      hide.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(frame()).toBeNull();
  });

  it("renders NOTHING when the coordinates are not usable", () => {
    mount(Number.NaN, LON);
    expect(host.innerHTML).toBe("");
    mount(LAT, Number.POSITIVE_INFINITY);
    expect(host.innerHTML).toBe("");
  });
});

describe("#3149 the frame URL is built from the two numbers", () => {
  it("centres a bounding box on the point and marks it", () => {
    const url = mapEmbedUrl(LAT, LON);
    expect(url.startsWith(`${MAP_TILE_ORIGIN}/export/embed.html?bbox=`))
      .toBe(true);
    expect(url).toContain("marker=6.447103%2C3.468018");
    // west, south, east, north — the point, plus and minus the fixed span.
    expect(url).toContain("bbox=3.462018%2C6.441103%2C3.474018%2C6.453103");
  });

  it("carries no query, no address and no API key", () => {
    const url = mapEmbedUrl(LAT, LON);
    expect(url).not.toMatch(/[?&]q=/);
    expect(url).not.toMatch(/key=/i);
    expect(url).not.toContain("Admiralty");
  });

  it("stays on the globe at the poles and the antimeridian", () => {
    expect(mapEmbedUrl(90, 180)).toContain("marker=90.000000%2C180.000000");
    const url = mapEmbedUrl(90, 180);
    // The box cannot run past 90N or 180E, so it is clamped rather than
    // emitting a bbox the tile server will reject or silently reinterpret.
    expect(url).toContain("bbox=179.994000%2C89.994000%2C180.000000%2C90.000000");
  });
});

describe("#3149 the runtime policy names that host and nothing else", () => {
  const csp = buildCsp({ nonce: "test-nonce", pathname: "/" });
  const directive = (name: string) =>
    csp.split("; ").find((entry) => entry.startsWith(`${name} `)) ?? "";

  it("permits the map host to be FRAMED, and only framed", () => {
    /*
     * `frame-src` has no entry of its own without this, so it falls back to
     * `default-src 'self'` and the map is blocked — the panel would resolve to
     * an empty box with an error only the console sees.
     */
    expect(directive("frame-src")).toBe(`frame-src 'self' ${MAP_FRAME_ORIGIN}`);
    expect(MAP_FRAME_ORIGIN).toBe(MAP_TILE_ORIGIN);
  });

  it("adds the host to NOTHING else", () => {
    for (const name of ["script-src", "connect-src", "style-src", "img-src"]) {
      expect(directive(name)).not.toContain("openstreetmap");
    }
    expect(directive("default-src")).toBe("default-src 'self'");
  });

  it("keeps every published page unframable, preview aside", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    const preview = buildCsp({ nonce: "test-nonce", pathname: "/preview" });
    // frame-src is about what the page may EMBED; frame-ancestors is about who
    // may embed the page. Widening one must not have moved the other.
    expect(preview).toContain(`frame-src 'self' ${MAP_FRAME_ORIGIN}`);
    expect(preview).not.toContain("frame-ancestors 'none'");
  });
});
