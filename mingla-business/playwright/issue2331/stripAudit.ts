/**
 * #2331 — the edge-based audit behind I-PRIVACY-BAR-NEVER-OCCLUDES, shared by
 * the Host web gate (strip-clearance.spec.ts) and the usemingla.com gate
 * (../issue2331-marketing/strip-clearance.spec.ts). It replaces the retired
 * centre-point `auditOcclusion`, which only sampled the middle of each control
 * and so missed a 6px edge overlap (the desktop Buy bar).
 *
 * A snapshot FAILS when:
 *   1. the strip is missing, or its height is not the resolved
 *      `--mingla-privacy-strip`, or it does not sit on the viewport's bottom;
 *   2. any visible painted element other than the strip, the Options sheet and
 *      its scrim intersects the strip's rect by more than 0.5px after clipping
 *      by its overflow ancestors (marketing mid-scroll: static in-flow content
 *      may pass under the strip; fixed and sticky layers never may);
 *   3. (Host) any element inside #root ends below the strip's top edge
 *      (beyond the same 0.5px, after clipping);
 *   4. the strip is not the top element at 5 points along it.
 */
import type { Page } from "@playwright/test";

export interface StripAuditOptions {
  /** Host web: #root must end at the strip's top edge (rule 3). */
  host: boolean;
  /** Marketing mid-scroll: static in-flow content may pass under the strip. */
  allowStaticUnder: boolean;
}

export interface StripViolation {
  rule: 1 | 2 | 3 | 4;
  detail: string;
}

export interface StripAuditResult {
  stripHeight: number;
  expectedHeight: number;
  checked: number;
  violations: StripViolation[];
}

export async function auditStrip(page: Page, options: StripAuditOptions): Promise<StripAuditResult> {
  return page.evaluate((opts) => {
    const violations: Array<{ rule: 1 | 2 | 3 | 4; detail: string }> = [];
    const EPS = 0.5;
    const strip = document.querySelector<HTMLElement>(".mps");
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;height:var(--mingla-privacy-strip)";
    document.body.appendChild(probe);
    const expectedHeight = probe.getBoundingClientRect().height;
    probe.remove();
    if (strip === null) {
      return { stripHeight: -1, expectedHeight, checked: 0, violations: [{ rule: 1 as const, detail: "the strip is missing" }] };
    }
    const sr = strip.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (!(expectedHeight >= 28) || Math.abs(sr.height - expectedHeight) > EPS) {
      violations.push({ rule: 1, detail: `strip height ${sr.height} != --mingla-privacy-strip ${expectedHeight}` });
    }
    if (Math.abs(sr.bottom - viewportHeight) > EPS || sr.left > EPS || Math.abs(sr.right - window.innerWidth) > EPS) {
      violations.push({ rule: 1, detail: `strip rect ${JSON.stringify([sr.left, sr.top, sr.right, sr.bottom])} is not the full-width bottom band of ${window.innerWidth}x${viewportHeight}` });
    }

    const exempt = (node: Element): boolean =>
      node === strip || strip.contains(node) || node.closest(".mpb, .mpb-scrim") !== null || node === document.documentElement || node === document.body;

    const transparent = (value: string): boolean => value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value);
    const paints = (node: Element, style: CSSStyleDeclaration): boolean => {
      const tag = node.tagName;
      if (["IMG", "SVG", "VIDEO", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "IFRAME", "PICTURE", "svg"].includes(tag)) return true;
      if (!transparent(style.backgroundColor) || style.backgroundImage !== "none" || style.boxShadow !== "none") return true;
      if (["Top", "Right", "Bottom", "Left"].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none")) return true;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0) return true;
      }
      return false;
    };

    // Does this ancestor capture `position: fixed` descendants (it is their
    // containing block, so its overflow clips them)?
    const capturesFixed = (style: CSSStyleDeclaration): boolean =>
      /(layout|paint|strict|content)/.test(style.contain) ||
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.perspective !== "none" ||
      /transform|filter|perspective/.test(style.willChange);

    // A rect clipped by every overflow ancestor that really clips it: a fixed
    // layer escapes every scroller between it and the box that captures fixed
    // descendants (the viewport, or on Host the contained #root).
    const clipped = (node: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = node.getBoundingClientRect();
      let left = Math.max(r.left, 0);
      let top = Math.max(r.top, 0);
      let right = Math.min(r.right, window.innerWidth);
      let bottom = Math.min(r.bottom, viewportHeight);
      let escaping = getComputedStyle(node).position === "fixed";
      for (let parent = node.parentElement; parent !== null && parent !== document.body; parent = parent.parentElement) {
        const ps = getComputedStyle(parent);
        if (escaping) {
          if (!capturesFixed(ps)) continue;
          escaping = false;
        }
        if (ps.position === "fixed") escaping = true;
        if (/(hidden|auto|scroll|clip)/.test(ps.overflowX + ps.overflowY)) {
          const pr = parent.getBoundingClientRect();
          left = Math.max(left, pr.left);
          top = Math.max(top, pr.top);
          right = Math.min(right, pr.right);
          bottom = Math.min(bottom, pr.bottom);
        }
      }
      return { left, top, right, bottom };
    };

    const layered = (node: Element): string | null => {
      for (let n: Element | null = node; n !== null && n !== document.body; n = n.parentElement) {
        const position = getComputedStyle(n).position;
        if (position === "fixed" || position === "sticky") return position;
      }
      return null;
    };

    const describe = (node: Element): string => {
      const id = node.id ? `#${node.id}` : "";
      const testId = node.getAttribute("data-testid");
      const cls = typeof node.className === "string" && node.className.trim() ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${node.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ""}${cls}${text ? ` "${text}"` : ""}`;
    };

    const root = document.getElementById("root");
    let checked = 0;
    for (const node of Array.from(document.body.querySelectorAll("*"))) {
      if (exempt(node)) continue;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"].includes(node.tagName)) continue;
      const box = clipped(node);
      if (box.right - box.left <= EPS || box.bottom - box.top <= EPS) continue;
      checked += 1;
      // Rule 3 — on Host, nothing inside #root reaches below the strip's top edge.
      if (opts.host && root !== null && root.contains(node) && box.bottom > sr.top + EPS) {
        violations.push({ rule: 3, detail: `${describe(node)} ends at ${box.bottom.toFixed(1)}, below the strip top ${sr.top.toFixed(1)}` });
        continue;
      }
      if (!paints(node, style)) continue;
      const overlap = Math.min(box.bottom, sr.bottom) - Math.max(box.top, sr.top);
      const overlapX = Math.min(box.right, sr.right) - Math.max(box.left, sr.left);
      if (overlap <= EPS || overlapX <= EPS) continue;
      const layer = layered(node);
      if (opts.allowStaticUnder && layer === null) continue;
      violations.push({ rule: 2, detail: `${describe(node)} (${layer ?? "in-flow"}) overlaps the strip by ${overlap.toFixed(1)}px` });
    }

    // Rule 4 — nothing paints over the strip.
    const y = sr.top + sr.height / 2;
    for (const fraction of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const x = sr.left + sr.width * fraction;
      const hit = document.elementFromPoint(x, y);
      if (hit === null || !(hit === strip || strip.contains(hit))) {
        violations.push({ rule: 4, detail: `at (${Math.round(x)}, ${Math.round(y)}) the top element is ${hit === null ? "none" : describe(hit)}, not the strip` });
      }
    }
    return { stripHeight: sr.height, expectedHeight, checked, violations };
  }, options);
}

/** Scroll every scroll owner (and the document) to its end; return how many moved. */
export async function scrollEverythingToEnd(page: Page): Promise<number> {
  const moved = await page.evaluate(() => {
    let count = 0;
    const scroller = document.scrollingElement;
    if (scroller !== null && scroller.scrollHeight > scroller.clientHeight + 1) {
      // "instant": a page's `scroll-behavior: smooth` must not leave it mid-way.
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      count += 1;
    }
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      if (node.closest(".mpb")) continue;
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
        node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
        node.dispatchEvent(new Event("scroll"));
        count += 1;
      }
    }
    return count;
  });
  await page.waitForTimeout(700);
  return moved;
}

export const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

/** The two rotations the contract names: 375 and 1024 turned sideways. */
export const ROTATIONS = [
  { from: { width: 375, height: 667 }, to: { width: 667, height: 375 } },
  { from: { width: 1024, height: 768 }, to: { width: 768, height: 1024 } },
] as const;

export const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
