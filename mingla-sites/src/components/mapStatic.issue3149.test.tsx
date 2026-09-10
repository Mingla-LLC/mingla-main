// @vitest-environment jsdom
/*
 * #3149 wave 4 — the map is DRAWN on mount, and drawing it contacts nobody.
 *
 * Wave 3's suite mounted this component and proved the DOM held no iframe
 * before anyone pressed anything. That promise is unchanged and still asserted
 * there. What changed is that the panel is no longer empty: a visitor sees the
 * street the moment the page paints.
 *
 * Both halves have to be runtime claims rather than source claims. The panel
 * could regress to an eager third-party frame without a single class name
 * changing, and the tiles could regress to a third-party host the same way —
 * so the component is mounted, the DOM is read before any interaction, every
 * URL in it is inspected, the control is pressed, and the DOM is read again.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAP_TILE_ORIGIN, MapEmbed } from "./MapEmbed";
import { MAP_STATIC_ZOOM, planStaticMap } from "../lib/staticMap";

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

const press = (label: string) => {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => {
    button!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
};

describe("#3149 wave 4 a map is on the page before anyone asks", () => {
  it("draws tiles on mount, with no interaction at all", () => {
    mount();
    const tiles = [...host.querySelectorAll<HTMLImageElement>(".map-static img")];
    expect(tiles.length).toBeGreaterThan(4);
    expect(host.querySelector(".map-static-pin")).not.toBeNull();
  });

  it("asks ONLY this origin for them", () => {
    mount();
    /*
     * The measurement that matters: every URL the browser would resolve, in
     * the DOM as mounted. A relative path is answered by this app's own route,
     * which is what makes "zero third-party requests on page load" true.
     */
    const urls = [...host.querySelectorAll("[src], [href]")].map(
      (element) =>
        element.getAttribute("src") ?? element.getAttribute("href") ?? "",
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("/")).toBe(true);
      expect(url).not.toContain("openstreetmap");
      expect(url).not.toContain("google");
    }
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("asks for exactly the squares the plan named, and no others", () => {
    mount();
    const planned = new Set(
      planStaticMap(LAT, LON)!.tiles.map((tile) => tile.path),
    );
    const asked = [...host.querySelectorAll<HTMLImageElement>(".map-static img")]
      .map((image) => image.getAttribute("src")!);
    expect(new Set(asked)).toEqual(planned);
    for (const path of asked) {
      expect(path.startsWith(`/map/${MAP_STATIC_ZOOM}/`)).toBe(true);
    }
  });

  it("reads as ONE map to a screen reader, not as fifteen pictures", () => {
    mount();
    const figure = host.querySelector(".map-static")!;
    expect(figure.getAttribute("role")).toBe("img");
    expect(figure.getAttribute("aria-label")).toBe(`Map of ${LABEL}`);
    for (const image of host.querySelectorAll(".map-static img")) {
      expect(image.getAttribute("alt")).toBe("");
    }
  });

  it("keeps the interactive map behind the control that names the host", () => {
    mount();
    expect(host.querySelector("iframe")).toBeNull();
    press("Show the map");
    const frame = host.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toContain(MAP_TILE_ORIGIN);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    // And the drawn map is put away while the live one is up, rather than
    // both being on the page at once.
    expect(host.querySelector(".map-static")).toBeNull();
  });

  it("comes back to the drawn map when the live one is dismissed", () => {
    mount();
    press("Show the map");
    press("Hide the map");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelectorAll(".map-static img").length).toBeGreaterThan(4);
  });

  it("renders NOTHING for coordinates that are not usable", () => {
    mount(Number.NaN, LON);
    expect(host.innerHTML).toBe("");
    mount(LAT, Number.POSITIVE_INFINITY);
    expect(host.innerHTML).toBe("");
  });
});
