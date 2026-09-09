// @vitest-environment jsdom
/*
 * #3149 — the lightbox, PROVEN BY DRIVING IT.
 *
 * Every claim in the brief is a runtime claim: focus moves in, Escape closes,
 * focus returns to the photograph that opened it, and Tab cannot escape while
 * it is open. None of that is visible in a class name, and all four fail
 * silently — a keyboard visitor is dropped at the top of the document and a
 * screen-reader visitor is left reading a page they cannot see.
 *
 * So this mounts the real component into a real document, dispatches real
 * clicks and real key events, and reads `document.activeElement`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GalleryLightbox } from "./GalleryLightbox";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IMAGES = [
  { url: "/media/a/960.webp", alt: "Coconut rice" },
  { url: "/media/b/960.webp", alt: "" },
  { url: "/media/c/960.webp", alt: "Late night" },
];

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
  document.body.style.overflow = "";
});

const mount = (images = IMAGES) => {
  act(() => {
    root.render(<GalleryLightbox images={images} className="gallery" />);
  });
};

const anchors = () => [...host.querySelectorAll("a.gallery-item")] as HTMLAnchorElement[];
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttons = () =>
  [...(dialog()?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];

const click = (element: HTMLElement, init: MouseEventInit = {}) => {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
    );
  });
};

/*
 * Clicks an anchor and reports whether the component cancelled the navigation,
 * READ AFTER the component's own handler has run.
 *
 * React 19 listens on the root container, so a listener on `document` sees the
 * event once the component is done with it. It then cancels the event itself:
 * a click this component deliberately lets through is a REAL navigation, and
 * jsdom answers a real navigation with an async "Not implemented" trace after
 * the test has already finished — noise that reads as a failure in CI.
 */
const clickAnchor = (
  element: HTMLElement,
  init: MouseEventInit = {},
): boolean => {
  let prevented = false;
  const observe = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", observe);
  try {
    click(element, init);
  } finally {
    document.removeEventListener("click", observe);
  }
  return prevented;
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
};

describe("#3149 a photograph opens larger", () => {
  it("renders an anchor per photograph, pointing at the full image", () => {
    mount();
    expect(anchors().length).toBe(3);
    expect(anchors()[0]!.getAttribute("href")).toBe("/media/a/960.webp");
  });

  it("opens nothing until a photograph is clicked", () => {
    mount();
    expect(dialog()).toBeNull();
  });

  it("opens a modal dialog on a plain click, and does NOT navigate", () => {
    mount();
    // Not navigating is the whole point of intercepting the anchor.
    expect(clickAnchor(anchors()[0]!)).toBe(true);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.getAttribute("aria-label")).toBe("Coconut rice");
  });

  it("LETS A MODIFIED CLICK THROUGH — a new tab is still a new tab", () => {
    mount();
    expect(clickAnchor(anchors()[1]!, { metaKey: true })).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("names a photograph with no alternative text by its position", () => {
    mount();
    click(anchors()[1]!);
    expect(dialog()!.getAttribute("aria-label")).toBe("Photograph 2 of 3");
  });
});

describe("#3149 the lightbox is operable from a keyboard", () => {
  it("MOVES FOCUS into the dialog when it opens", () => {
    mount();
    click(anchors()[0]!);
    const active = document.activeElement as HTMLElement;
    expect(dialog()!.contains(active)).toBe(true);
    expect(active.className).toContain("lightbox-close");
  });

  it("closes on Escape", () => {
    mount();
    click(anchors()[0]!);
    press("Escape");
    expect(dialog()).toBeNull();
  });

  it("RETURNS FOCUS to the photograph that opened it", () => {
    mount();
    const opener = anchors()[2]!;
    click(opener);
    press("Escape");
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus after the close control is used too", () => {
    mount();
    const opener = anchors()[1]!;
    click(opener);
    click(buttons()[0]!);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("TRAPS Tab: the last control wraps to the first", () => {
    mount();
    click(anchors()[0]!);
    const controls = buttons();
    expect(controls.length).toBeGreaterThan(1);
    const last = controls[controls.length - 1]!;
    act(() => last.focus());
    press("Tab");
    expect(document.activeElement).toBe(controls[0]);
  });

  it("traps Shift+Tab: the first control wraps to the last", () => {
    mount();
    click(anchors()[0]!);
    const controls = buttons();
    act(() => controls[0]!.focus());
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(controls[controls.length - 1]);
  });

  it("PULLS FOCUS BACK when it has escaped the dialog entirely", () => {
    /*
     * The case a naive trap misses. Focus can end up on the page behind — a
     * click on the backdrop, or a browser moving it — and then every Tab walks
     * further into a page the dialog claims to have blocked.
     */
    mount();
    click(anchors()[0]!);
    act(() => anchors()[2]!.focus());
    press("Tab");
    expect(dialog()!.contains(document.activeElement as HTMLElement)).toBe(true);
  });

  it("stops the page behind it from scrolling, and gives that back", () => {
    mount();
    click(anchors()[0]!);
    expect(document.body.style.overflow).toBe("hidden");
    press("Escape");
    expect(document.body.style.overflow).toBe("");
  });
});

describe("#3149 stepping between photographs", () => {
  it("moves to the next and wraps around the end", () => {
    mount();
    click(anchors()[2]!);
    expect(dialog()!.querySelector("img")!.getAttribute("src"))
      .toBe("/media/c/960.webp");
    const next = buttons().find((button) => button.textContent === "Next")!;
    click(next);
    expect(dialog()!.querySelector("img")!.getAttribute("src"))
      .toBe("/media/a/960.webp");
  });

  it("moves to the previous and wraps around the start", () => {
    mount();
    click(anchors()[0]!);
    const previous = buttons().find((b) => b.textContent === "Previous")!;
    click(previous);
    expect(dialog()!.querySelector("img")!.getAttribute("src"))
      .toBe("/media/c/960.webp");
  });

  it("offers no steps at all for a single photograph", () => {
    mount([IMAGES[0]!]);
    click(anchors()[0]!);
    expect(buttons().length).toBe(1);
    expect(dialog()!.querySelector(".lightbox-steps")).toBeNull();
  });

  it("keeps the trap working when there is only a close control", () => {
    mount([IMAGES[0]!]);
    click(anchors()[0]!);
    const only = buttons()[0]!;
    press("Tab");
    expect(document.activeElement).toBe(only);
  });
});

describe("#3149 the backdrop closes, the panel does not", () => {
  it("closes when the backdrop itself is clicked", () => {
    mount();
    click(anchors()[0]!);
    click(dialog()!);
    expect(dialog()).toBeNull();
  });

  it("stays open when the photograph inside it is clicked", () => {
    mount();
    click(anchors()[0]!);
    click(dialog()!.querySelector("img")!);
    expect(dialog()).not.toBeNull();
  });
});
