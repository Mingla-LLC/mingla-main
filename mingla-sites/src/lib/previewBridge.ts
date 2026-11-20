import { businessPreviewFrameAncestor, MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN } from "./origins";
import { PREVIEW_SECTION_MARKER } from "../components/v2/PreviewSection";
import { previewParentAllowed, previewTokenDeclarations } from "./previewTokens";
import {
  parsePreviewParentMessage,
  PREVIEW_CHIP_TEXT,
  PREVIEW_MARKS_MESSAGE,
  PREVIEW_MODE_MESSAGE,
  PREVIEW_READY_MESSAGE,
  PREVIEW_RECTS_MESSAGE,
  PREVIEW_RESTORE_SCROLL_MESSAGE,
  PREVIEW_SCROLL_TO_MESSAGE,
  PREVIEW_SELECT_MESSAGE,
  PREVIEW_TEXT_MESSAGE,
  PREVIEW_TOKENS_MESSAGE,
  type PreviewFrameMessage,
  type PreviewMarksMessage,
  type PreviewParentMessage,
} from "./previewBridgeProtocol";

/*
 * #4453 website workspace (build contract D) — the private preview's side of
 * the workspace: it tells the window that frames it where each section is,
 * lets the owner pick a section, and draws the workspace's marks over the
 * page. Plain DOM code (no React), so it is tested as it runs.
 *
 * What it may touch, and what it never does:
 *   - It runs ONLY on the owner's private preview (`/preview`); no public
 *     page, share link or plan preview loads this module.
 *   - It draws in ONE layer it adds at the end of <body>: absolutely
 *     positioned, zero-sized, `pointer-events: none`. Nothing in the page's
 *     own tree is moved, wrapped or restyled, so the layer cannot shift a
 *     pixel of the design. Every style is set through the element's style
 *     object (never a <style> tag or a class the page could collide with).
 *   - On the page's own elements it sets two things: `data-mingla-section`
 *     on a section's outermost element(s), so the section can be found by id
 *     (no stylesheet selects it), and, in edit mode only, `inert` on the page
 *     so nothing in it can be clicked, focused or submitted.
 *   - It accepts a message only from its parent window on an origin that may
 *     frame the preview, or, in the Host app's WebView, only from the page's
 *     own window. It never posts to "*".
 */

export type PreviewBridgeSection = { id: string; type: string };

export type PreviewBridgeOptions = {
  /** Local development: loopback parents are allowed too (mirrors frame-ancestors). */
  localMode: boolean;
  /** The page shown ("" is Home). */
  pagePath: string;
  /** One entry per block of the page, in block order; "" for a block that cannot be selected. */
  sections: readonly PreviewBridgeSection[];
  /** Tests pass their own window. */
  window?: Window;
};

export const SECTION_ATTRIBUTE = "data-mingla-section";
export const OVERLAY_ATTRIBUTE = "data-mingla-preview-overlay";
export const MARK_ATTRIBUTE = "data-mingla-mark";
export const CHIP_ATTRIBUTE = "data-mingla-chip";
export const PROXY_ATTRIBUTE = "data-mingla-section-button";

type NativeBridge = { postMessage: (message: string) => void };
type BridgeWindow = Window & { ReactNativeWebView?: NativeBridge };

const NOT_SECTION_ROOTS = new Set(["SCRIPT", "TEMPLATE", "STYLE", "LINK", "META", "TITLE"]);
/** The text node the page writes before each section. */
const SECTION_MARKER = PREVIEW_SECTION_MARKER;
/** Room left above a section brought into view (a design's fixed header). */
const SCROLL_HEADROOM = 88;
/** "Ready" is said after two animation frames, or after this long when the browser gives the frame none. */
const READY_FALLBACK_MS = 400;
/** Above anything a design draws (its header, a sheet), below nothing. */
const OVERLAY_Z = "2147483000";

/** How many section markers a text node holds (0 for any other text; adjacent markers may share one node). */
function markersIn(text: string): number {
  if (text.length === 0 || text.length % SECTION_MARKER.length !== 0) return 0;
  const count = text.length / SECTION_MARKER.length;
  return text === SECTION_MARKER.repeat(count) ? count : 0;
}

/** The elements after each section marker of `container`, one list per marker. */
function markerSlots(container: Element): Element[][] {
  const slots: Element[][] = [];
  for (let node = container.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 3) {
      for (let count = markersIn((node as Text).data); count > 0; count -= 1) slots.push([]);
    } else if (node.nodeType === 1 && slots.length > 0 && !NOT_SECTION_ROOTS.has((node as Element).tagName)) {
      slots[slots.length - 1]!.push(node as Element);
    }
  }
  return slots;
}

/**
 * The outermost element(s) of each section of the page, in block order, or
 * null when the page's sections cannot be told apart with certainty: the page
 * writes exactly one marker per block (components/v2/PreviewSection.tsx), so
 * any other count means the markup is not what this code understands and
 * NOTHING is marked (a wrong section is worse than none).
 */
export function findSectionSlots(doc: Document, count: number): Element[][] | null {
  if (count <= 0) return null;
  const main = doc.getElementById("main");
  if (!main) return null;
  // Gallery and Voyage pages hold their sections in <main>; Atelier in its `.page-content`.
  const containers = [main, ...Array.from(main.children).filter((child) => child.classList.contains("page-content"))];
  for (const container of containers) {
    const slots = markerSlots(container);
    if (slots.length === count) return slots;
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };
type Measured = Box & { id: string; type: string; roots: Element[] };

const px = (value: number): string => `${Math.round(value)}px`;

function setStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value);
}

export function startPreviewBridge(options: PreviewBridgeOptions): () => void {
  const win = (options.window ?? window) as BridgeWindow;
  const doc = win.document;
  const policy = { localMode: options.localMode };
  const framed = win.parent !== win;
  const native = !framed && typeof win.ReactNativeWebView?.postMessage === "function";
  const stops: Array<() => void> = [];
  let stopped = false;

  // ------------------------------------------------------------------ sections

  const rootIds = new WeakMap<Element, string>();
  let marked: Element[] = [];
  let attributesAllowed = false;

  /** Pairs the page's sections with their ids (again on every measure: the page may still be hydrating). */
  function sectionRoots(): Array<{ id: string; type: string; roots: Element[] }> {
    const slots = findSectionSlots(doc, options.sections.length);
    if (!slots) return [];
    const out: Array<{ id: string; type: string; roots: Element[] }> = [];
    const seen = new Set<Element>();
    slots.forEach((roots, index) => {
      const section = options.sections[index]!;
      if (!section.id || roots.length === 0) return;
      for (const root of roots) {
        rootIds.set(root, section.id);
        seen.add(root);
        if (attributesAllowed && root.getAttribute(SECTION_ATTRIBUTE) !== section.id) root.setAttribute(SECTION_ATTRIBUTE, section.id);
      }
      out.push({ id: section.id, type: section.type, roots });
    });
    if (attributesAllowed) {
      for (const root of marked) if (!seen.has(root)) root.removeAttribute(SECTION_ATTRIBUTE);
      marked = [...seen];
    }
    return out;
  }

  const scrollY = (): number => Math.max(0, Math.round(win.scrollY || doc.documentElement.scrollTop || 0));
  const scrollX = (): number => Math.max(0, Math.round(win.scrollX || doc.documentElement.scrollLeft || 0));
  const docHeight = (): number => Math.round(Math.max(doc.documentElement.scrollHeight || 0, doc.body?.scrollHeight || 0));

  /**
   * The page's own box, in document pixels. A section can be wider than the
   * page (a ticker, a full-bleed row the design clips), and a mark drawn at
   * that size would give the page a sideways scroll it never had. So every
   * section's box is cut to the page: what is reported and drawn is the part
   * of the section that is on the page.
   */
  function pageBox(offsetX: number, offsetY: number): { left: number; top: number; right: number; bottom: number } | null {
    const wrapper = doc.querySelector('[data-preview="1"]');
    const width = doc.documentElement.clientWidth;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return { left: rect.left + offsetX, top: rect.top + offsetY, right: rect.right + offsetX, bottom: rect.bottom + offsetY };
    }
    return width > 0 ? { left: 0, top: 0, right: width, bottom: Infinity } : null;
  }

  function measure(): Measured[] {
    const offsetY = win.scrollY || doc.documentElement.scrollTop || 0;
    const offsetX = win.scrollX || doc.documentElement.scrollLeft || 0;
    const bounds = pageBox(offsetX, offsetY);
    return sectionRoots().map(({ id, type, roots }) => {
      let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
      let drawn = false;
      const rects = roots.map((root) => root.getBoundingClientRect());
      for (const rect of rects) {
        // A root that draws nothing (display: none, a script) does not stretch the section.
        if (rect.width === 0 && rect.height === 0 && rects.length > 1) continue;
        drawn = true;
        top = Math.min(top, rect.top);
        left = Math.min(left, rect.left);
        bottom = Math.max(bottom, rect.bottom);
        right = Math.max(right, rect.right);
      }
      if (!drawn) {
        const first = rects[0]!;
        top = first.top; left = first.left; bottom = first.bottom; right = first.right;
      }
      let boxTop = top + offsetY, boxLeft = left + offsetX, boxBottom = bottom + offsetY, boxRight = right + offsetX;
      if (bounds && boxRight > boxLeft && boxBottom > boxTop) {
        const cutLeft = Math.max(boxLeft, bounds.left), cutRight = Math.min(boxRight, bounds.right);
        const cutTop = Math.max(boxTop, bounds.top), cutBottom = Math.min(boxBottom, bounds.bottom);
        // A section wholly off the page keeps its own box (nothing sensible to cut it to).
        if (cutRight > cutLeft) { boxLeft = cutLeft; boxRight = cutRight; }
        if (cutBottom > cutTop) { boxTop = cutTop; boxBottom = cutBottom; }
      }
      return {
        id, type, roots,
        top: Math.round(boxTop),
        left: Math.round(boxLeft),
        width: Math.round(boxRight - boxLeft),
        height: Math.round(boxBottom - boxTop),
      };
    });
  }

  // ------------------------------------------------------------------ sending

  let parentOrigin: string | null = null;
  const readySentTo = new Set<string>();
  let readySent = false;

  /** Where a message may go before the parent has spoken: only origins that may frame the preview. */
  function candidateOrigins(): string[] {
    if (parentOrigin) return [parentOrigin];
    const ancestors = (win.location as Location & { ancestorOrigins?: { length: number; [index: number]: string } }).ancestorOrigins;
    if (ancestors && ancestors.length > 0) return previewParentAllowed(ancestors[0]!, policy) ? [ancestors[0]!] : [];
    try {
      const referrer = doc.referrer ? new URL(doc.referrer).origin : "";
      if (referrer && previewParentAllowed(referrer, policy)) return [referrer];
    } catch { /* not an address */ }
    // The browser does not say who the parent is: offer the message to each origin that may frame the
    // preview. `postMessage` delivers only to a window that IS on the named origin.
    const named = businessPreviewFrameAncestor(new URLSearchParams(win.location.search).get("fa"));
    return [MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN, ...(named ? [named] : [])];
  }

  function send(message: PreviewFrameMessage): string[] {
    if (stopped) return [];
    if (native) {
      try {
        win.ReactNativeWebView!.postMessage(JSON.stringify(message));
      } catch { /* the app closed the view */ }
      return ["native"];
    }
    if (!framed) return [];
    const targets = candidateOrigins();
    for (const origin of targets) {
      try {
        win.parent.postMessage(message, origin);
      } catch { /* a parent on another origin: nothing is delivered */ }
    }
    return targets;
  }

  let lastRects = "";
  const rectsKey = (sections: Measured[]): string => `${scrollY()}|${docHeight()}|${sections.map((s) => `${s.id}:${s.top}:${s.height}`).join(",")}`;

  function sendReady(): void {
    attributesAllowed = true;
    const sections = measure();
    lastRects = rectsKey(sections);
    for (const target of send({
      type: PREVIEW_READY_MESSAGE,
      page_path: options.pagePath,
      sections: sections.map(({ id, type, top, height }) => ({ id, type, top, height })),
      scroll_y: scrollY(),
      doc_height: docHeight(),
    })) readySentTo.add(target);
    readySent = true;
    layout(sections);
  }

  // ------------------------------------------------------------------ frames (rAF throttle)

  const raf: (callback: () => void) => number = typeof win.requestAnimationFrame === "function"
    ? (callback) => win.requestAnimationFrame(() => callback())
    : (callback) => win.setTimeout(callback, 16);
  const cancelRaf: (handle: number) => void = typeof win.cancelAnimationFrame === "function"
    ? (handle) => win.cancelAnimationFrame(handle)
    : (handle) => win.clearTimeout(handle);
  let pending: number | null = null;

  /** At most one measure per animation frame, however many scroll and resize events arrive. */
  function schedule(): void {
    if (stopped || pending !== null) return;
    pending = raf(() => {
      pending = null;
      if (stopped || !readySent) return;
      const sections = measure();
      layout(sections);
      const key = rectsKey(sections);
      if (key === lastRects) return;
      lastRects = key;
      send({
        type: PREVIEW_RECTS_MESSAGE,
        sections: sections.map(({ id, top, height }) => ({ id, top, height })),
        scroll_y: scrollY(),
        doc_height: docHeight(),
      });
    });
  }

  // ------------------------------------------------------------------ the layer

  let overlay: HTMLElement | null = null;
  let marksLayer: HTMLElement | null = null;
  let buttonsLayer: HTMLElement | null = null;
  let marks: PreviewMarksMessage = { type: PREVIEW_MARKS_MESSAGE, selected: null, ari: null, unread: [] };
  let edit = false;
  let focusedId: string | null = null;
  const frames = new Map<string, HTMLElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  const pulses = new Map<string, { cancel: () => void }>();

  const reducedMotion = (): boolean => {
    try {
      return typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  function ensureOverlay(): void {
    if (overlay || !doc.body) return;
    overlay = doc.createElement("div");
    overlay.setAttribute(OVERLAY_ATTRIBUTE, "");
    setStyles(overlay, {
      position: "absolute", top: "0", left: "0", width: "0", height: "0", margin: "0", padding: "0", border: "0",
      overflow: "visible", "pointer-events": "none", "z-index": OVERLAY_Z,
    });
    marksLayer = doc.createElement("div");
    marksLayer.setAttribute("aria-hidden", "true");
    buttonsLayer = doc.createElement("div");
    buttonsLayer.setAttribute("role", "group");
    buttonsLayer.setAttribute("aria-label", "Sections of this page");
    overlay.append(marksLayer, buttonsLayer);
    doc.body.appendChild(overlay);
  }

  /** What is drawn on a section: which rings, and the words in its corner. */
  function markFor(id: string): { kind: "ari" | "selected" | "unread" | "focus"; chip: string | null; selected: boolean; focused: boolean } | null {
    const unread = marks.unread.find((entry) => entry.id === id);
    const selected = marks.selected === id;
    const focused = focusedId === id;
    const chip = marks.ari === id
      ? PREVIEW_CHIP_TEXT.ari
      : unread ? (unread.by === "team" ? PREVIEW_CHIP_TEXT.unreadTeam : PREVIEW_CHIP_TEXT.unread) : null;
    if (marks.ari === id) return { kind: "ari", chip, selected, focused };
    if (selected) return { kind: "selected", chip, selected, focused };
    if (focused) return { kind: "focus", chip, selected, focused };
    if (unread) return { kind: "unread", chip, selected, focused };
    return null;
  }

  /*
   * Rings are two tones, one dark and one white, drawn just inside the
   * section's edge: on any design at least one of them stands out from what
   * is behind it, and a ring inside the edge is never cut off by the window.
   */
  const RINGS: Record<"ari" | "selected" | "unread" | "focus", string> = {
    selected: "inset 0 0 0 2px #111111, inset 0 0 0 4px #ffffff",
    ari: "inset 0 0 0 2px #111111, inset 0 0 0 4px #ffffff",
    unread: "inset 0 0 0 1px #111111, inset 0 0 0 2px #ffffff",
    focus: "inset 0 0 0 3px #ffffff, inset 0 0 0 6px #111111",
  };

  function layout(sections: Measured[] = measure()): void {
    const wanted = new Map<string, NonNullable<ReturnType<typeof markFor>>>();
    for (const section of sections) {
      const mark = markFor(section.id);
      if (mark) wanted.set(section.id, mark);
    }
    if (!wanted.size && !edit && !overlay) return;
    ensureOverlay();
    if (!overlay || !marksLayer || !buttonsLayer) return;
    const origin = overlay.getBoundingClientRect();
    const originTop = origin.top + (win.scrollY || 0);
    const originLeft = origin.left + (win.scrollX || 0);
    const place = (element: HTMLElement, box: Box): void => setStyles(element, {
      top: px(box.top - originTop), left: px(box.left - originLeft), width: px(box.width), height: px(box.height),
    });

    for (const [id, frame] of frames) {
      if (wanted.has(id)) continue;
      pulses.get(id)?.cancel();
      pulses.delete(id);
      frame.remove();
      frames.delete(id);
    }
    for (const section of sections) {
      const mark = wanted.get(section.id);
      if (!mark) continue;
      let frame = frames.get(section.id);
      if (!frame) {
        frame = doc.createElement("div");
        frame.setAttribute(MARK_ATTRIBUTE, section.id);
        setStyles(frame, { position: "absolute", "box-sizing": "border-box", "pointer-events": "none", margin: "0", padding: "0" });
        marksLayer.appendChild(frame);
        frames.set(section.id, frame);
      }
      place(frame, section);
      frame.setAttribute("data-mingla-mark-kind", mark.kind);
      // A selected or focused section keeps its ring while it also carries a "Read me".
      const ring = mark.focused && mark.kind !== "focus" ? `${RINGS.focus}` : RINGS[mark.kind];
      frame.style.setProperty("box-shadow", ring);
      let chip = frame.firstElementChild as HTMLElement | null;
      if (mark.chip) {
        if (!chip) {
          chip = doc.createElement("div");
          chip.setAttribute(CHIP_ATTRIBUTE, "");
          setStyles(chip, {
            position: "absolute", top: "10px", right: "10px", "max-width": "calc(100% - 20px)", "box-sizing": "border-box",
            padding: "5px 11px", "border-radius": "999px", border: "1px solid #ffffff", background: "#111111", color: "#ffffff",
            font: "600 12px/16px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", "letter-spacing": "0",
            "text-transform": "none", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis",
            "box-shadow": "0 1px 4px rgba(0, 0, 0, 0.35)", "pointer-events": "none",
          });
          frame.appendChild(chip);
        }
        if (chip.textContent !== mark.chip) chip.textContent = mark.chip;
      } else if (chip) chip.remove();
      // "Ari is changing this" breathes, unless the owner asked for less motion.
      const pulsing = pulses.has(section.id);
      if (mark.kind === "ari" && !pulsing && !reducedMotion() && typeof frame.animate === "function") {
        try {
          pulses.set(section.id, frame.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { duration: 1800, iterations: Infinity, easing: "ease-in-out" }));
        } catch { /* no animation: the mark is still there */ }
      } else if (mark.kind !== "ari" && pulsing) {
        pulses.get(section.id)?.cancel();
        pulses.delete(section.id);
      }
    }

    // Edit mode: one button per section, so the keyboard can reach and pick each one.
    const wantButtons = edit ? sections : [];
    for (const [id, button] of buttons) {
      if (wantButtons.some((section) => section.id === id)) continue;
      button.remove();
      buttons.delete(id);
    }
    wantButtons.forEach((section, index) => {
      let button = buttons.get(section.id);
      if (!button) {
        button = doc.createElement("button");
        button.type = "button";
        button.setAttribute(PROXY_ATTRIBUTE, section.id);
        setStyles(button, {
          position: "absolute", "box-sizing": "border-box", margin: "0", padding: "0", border: "0", background: "transparent",
          color: "transparent", outline: "none", appearance: "none", "-webkit-appearance": "none", "pointer-events": "none", cursor: "default",
        });
        button.addEventListener("focus", () => { focusedId = section.id; layout(); });
        button.addEventListener("blur", () => { if (focusedId === section.id) { focusedId = null; layout(); } });
        buttons.set(section.id, button);
      }
      // Kept in page order, so Tab moves down the page.
      if (buttonsLayer!.children[index] !== button) buttonsLayer!.insertBefore(button, buttonsLayer!.children[index] ?? null);
      button.setAttribute("aria-label", `Section ${index + 1} of ${wantButtons.length}. Press Enter to choose it.`);
      if (marks.selected === section.id) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      place(button, section);
    });
  }

  // ------------------------------------------------------------------ edit mode

  let inertSet: Element[] = [];
  const pageRoots = (): Element[] => {
    const wrapper = doc.querySelector('[data-preview="1"]');
    return wrapper ? Array.from(wrapper.children).filter((child) => !child.classList.contains("preview-banner")) : [];
  };
  function setInert(on: boolean): void {
    if (on) {
      inertSet = pageRoots().filter((element) => !element.hasAttribute("inert"));
      for (const element of inertSet) element.setAttribute("inert", "");
    } else {
      for (const element of inertSet) element.removeAttribute("inert");
      inertSet = [];
    }
  }

  const idOfElement = (start: Element | null): string | null => {
    for (let element = start; element; element = element.parentElement) {
      const id = rootIds.get(element);
      if (id) return id;
    }
    return null;
  };

  function sectionAt(event: MouseEvent): string | null {
    const target = (event.target as Element | null)?.nodeType === 1 ? (event.target as Element) : null;
    const direct = idOfElement(target);
    if (direct) return direct;
    const x = event.clientX, y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    // An inert page is not hit: look under the pointer with the page briefly live (same task, nothing paints).
    if (typeof doc.elementFromPoint === "function") {
      const held = inertSet;
      for (const element of held) element.removeAttribute("inert");
      let hit: Element | null = null;
      try {
        hit = doc.elementFromPoint(x, y);
      } finally {
        for (const element of held) element.setAttribute("inert", "");
      }
      if (hit) {
        const id = idOfElement(hit);
        if (id) return id;
        // Something of the page that is not a section (its header, its footer): nothing to pick.
        if (hit !== doc.documentElement && hit !== doc.body && !hit.hasAttribute("data-preview")) return null;
      }
    }
    const pageX = x + scrollX(), pageY = y + scrollY();
    let found: string | null = null;
    for (const section of measure()) {
      if (pageX >= section.left && pageX <= section.left + section.width && pageY >= section.top && pageY <= section.top + section.height) found = section.id;
    }
    return found;
  }

  function select(id: string): void {
    const section = measure().find((entry) => entry.id === id);
    if (!section) return;
    send({
      type: PREVIEW_SELECT_MESSAGE,
      section_id: id,
      rect: { top: section.top, left: section.left, width: section.width, height: section.height },
      scroll_y: scrollY(),
    });
  }

  /** Edit mode: nothing on the page acts. A click picks the section under it; everything else is swallowed. */
  const PASSIVE_KINDS = new Set(["pointerdown", "pointerup", "touchstart", "touchend"]);
  const onEditEvent = (event: Event): void => {
    if (!edit) return;
    const target = event.target as Element | null;
    const button = target && target.nodeType === 1 && typeof target.closest === "function" ? target.closest(`[${PROXY_ATTRIBUTE}]`) : null;
    if (event.type === "click") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = button ? button.getAttribute(PROXY_ATTRIBUTE) : sectionAt(event as MouseEvent);
      if (id) select(id);
      return;
    }
    if (button) return;
    event.stopImmediatePropagation();
    // Touch and pointer starts stay scrollable; everything else (focus, drag, submit, a second click) is refused.
    if (!PASSIVE_KINDS.has(event.type) && event.cancelable) event.preventDefault();
  };
  const EDIT_EVENTS = ["click", "auxclick", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "submit", "dragstart"] as const;
  for (const kind of EDIT_EVENTS) {
    const listenerOptions = PASSIVE_KINDS.has(kind) ? { capture: true, passive: true } : { capture: true };
    win.addEventListener(kind, onEditEvent, listenerOptions);
    stops.push(() => win.removeEventListener(kind, onEditEvent, listenerOptions));
  }

  function setEdit(next: boolean): void {
    if (edit === next) return;
    edit = next;
    if (!edit) focusedId = null;
    setInert(edit);
    layout();
  }

  // ------------------------------------------------------------------ parent → frame

  const appliedTokens = new Set<string>();
  function applyTokens(data: unknown): void {
    const root = doc.documentElement;
    for (const name of appliedTokens) root.style.removeProperty(name);
    appliedTokens.clear();
    for (const [name, value] of previewTokenDeclarations(data)) {
      root.style.setProperty(name, value);
      appliedTokens.add(name);
    }
    schedule();
  }

  function swapText(sectionId: string, from: string, to: string): void {
    const section = sectionRoots().find((entry) => entry.id === sectionId);
    if (!section) return;
    for (const root of section.roots) {
      const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue !== from) continue;
        const parent = node.parentElement;
        if (parent && NOT_SECTION_ROOTS.has(parent.tagName)) continue;
        node.nodeValue = to;
        schedule();
        return;
      }
    }
  }

  function scrollToSection(sectionId: string): void {
    const section = measure().find((entry) => entry.id === sectionId);
    if (!section) return;
    const top = Math.max(0, section.top - SCROLL_HEADROOM);
    try {
      win.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
    } catch {
      win.scrollTo(0, top);
    }
    schedule();
  }

  function handle(message: PreviewParentMessage): void {
    switch (message.type) {
      case PREVIEW_TOKENS_MESSAGE: return applyTokens(message);
      case PREVIEW_MODE_MESSAGE: return setEdit(message.edit);
      case PREVIEW_MARKS_MESSAGE: marks = message; return layout();
      case PREVIEW_SCROLL_TO_MESSAGE: return scrollToSection(message.section_id);
      case PREVIEW_TEXT_MESSAGE: return swapText(message.section_id, message.from, message.to);
      case PREVIEW_RESTORE_SCROLL_MESSAGE:
        try {
          win.scrollTo({ top: message.scroll_y, behavior: "auto" });
        } catch {
          win.scrollTo(0, message.scroll_y);
        }
        return schedule();
    }
  }

  const onMessage = (event: Event): void => {
    const message = event as MessageEvent;
    if (framed) {
      // Only the window that frames the preview, and only from an origin that may frame it.
      if (message.source !== win.parent || !previewParentAllowed(message.origin, policy)) return;
      const parsed = parsePreviewParentMessage(message.data);
      if (!parsed) return;
      if (parentOrigin !== message.origin) {
        parentOrigin = message.origin;
        // A parent the first "ready" could not reach (the browser did not name it) gets it now.
        if (readySent && !readySentTo.has(parentOrigin)) sendReady();
      }
      handle(parsed);
      return;
    }
    if (native) {
      /*
       * The Host app's WebView has no parent window: the app delivers a
       * message by running a line of script in THIS page, so it arrives from
       * the page's own window (`window.postMessage`) or as an event the
       * script dispatched (no source, no origin). A frame inside the page
       * (the map) or another window always has a different source, and is
       * refused.
       */
      const fromSelf = message.source === win && message.origin === win.location.origin;
      const dispatched = (message.source === null || message.source === undefined) && (message.origin === "" || message.origin === undefined);
      if (!fromSelf && !dispatched) return;
      const parsed = parsePreviewParentMessage(message.data);
      if (parsed) handle(parsed);
    }
  };
  win.addEventListener("message", onMessage);
  stops.push(() => win.removeEventListener("message", onMessage));
  if (native) {
    // Android's WebView hands an app message to `document`.
    doc.addEventListener("message", onMessage);
    stops.push(() => doc.removeEventListener("message", onMessage));
  }

  // ------------------------------------------------------------------ start

  const onLayoutEvent = (): void => schedule();
  win.addEventListener("scroll", onLayoutEvent, { passive: true });
  win.addEventListener("resize", onLayoutEvent);
  win.addEventListener("load", onLayoutEvent);
  stops.push(() => {
    win.removeEventListener("scroll", onLayoutEvent);
    win.removeEventListener("resize", onLayoutEvent);
    win.removeEventListener("load", onLayoutEvent);
  });
  const Observer = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  if (typeof Observer === "function") {
    // Late pictures, fonts and the owner's own token changes all move sections without a scroll.
    const observer = new Observer(onLayoutEvent);
    observer.observe(doc.documentElement);
    if (doc.body) observer.observe(doc.body);
    stops.push(() => observer.disconnect());
  }
  try {
    void doc.fonts?.ready?.then(onLayoutEvent, () => undefined);
  } catch { /* no font loading API */ }

  /*
   * Two frames after mount, so the first numbers are of the laid-out page. A
   * frame the browser is not painting (the workspace loads a rebuilt preview
   * out of sight before it swaps it in) may get no animation frames at all,
   * so a short timer says "ready" if they do not come.
   */
  let readyHandle: number | null = null;
  const readyOnce = (): void => {
    if (stopped || readySent) return;
    win.clearTimeout(readyTimer);
    sendReady();
  };
  const readyTimer = win.setTimeout(readyOnce, READY_FALLBACK_MS);
  readyHandle = raf(() => {
    readyHandle = raf(() => {
      readyHandle = null;
      readyOnce();
    });
  });

  return () => {
    stopped = true;
    win.clearTimeout(readyTimer);
    if (readyHandle !== null) cancelRaf(readyHandle);
    if (pending !== null) cancelRaf(pending);
    for (const stop of stops) stop();
    for (const pulse of pulses.values()) pulse.cancel();
    setInert(false);
    overlay?.remove();
    overlay = null;
    for (const name of appliedTokens) doc.documentElement.style.removeProperty(name);
    for (const root of marked) root.removeAttribute(SECTION_ATTRIBUTE);
  };
}
