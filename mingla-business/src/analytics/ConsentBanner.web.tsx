/**
 * #2331 → #4318 — the buyer-web privacy strip. One thin full-width button,
 * "Privacy & ad choices", 28px plus the bottom safe area, at the very bottom of
 * every Host web page. It is there from the first paint and never changes size
 * or position. There is no first-visit banner, no OK prompt and no toast:
 * analytics and ads are on unless this visitor turned them off
 * (I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF, #4128).
 *
 * I-PRIVACY-BAR-NEVER-OCCLUDES: the strip owns a constant band at the bottom,
 * `--mingla-privacy-strip` (28px plus the bottom safe area), set once in CSS.
 * The app root (`#root`) is a fixed, layout-contained box that ends at the
 * strip's top edge, so it is the containing block of every `position: fixed`
 * layer inside the app: `bottom: 0` there sits just above the strip. The
 * strip renders outside #root, on the top z-layer; nothing paints over it.
 *
 * Tapping the strip opens the choices (Analytics, Ads measurement, Save) as a
 * sheet above it. The sheet traps focus, closes on Escape and returns focus to
 * the strip. After Save the strip reads "Saved" for 1.8s (aria-live). The one
 * reopen event (`mingla:privacy-choices`) opens the same sheet.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { openPrivacyChoices, PRIVACY_CHOICES_EVENT } from "./privacyChoices";
import { usePrivacyState } from "./usePrivacyState.web";
import { savePrivacyChoice } from "./webAnalytics.web";

export const PRIVACY_STRIP_PROPERTY = "--mingla-privacy-strip";
export const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";
export const PRIVACY_STRIP_LABEL = "Privacy & ad choices";
export const PRIVACY_SAVED_LABEL = "Saved";
const STYLE_ID = "mingla-privacy-bar-style";
const PANEL_ID = "mingla-privacy-panel";
const SAVED_MS = 1800;

// I-PRIVACY-BAR-NEVER-OCCLUDES — the shell box plus the strip. Byte-for-byte
// the server copy (server/publicPrivacyRuntime.js privacyBarCss; parity test
// privacyBarCssParity.issue2331.test.ts). `--mingla-privacy-strip` is a CSS
// constant: nothing measures the strip or writes the variable.
const BAR_CSS = `
:root{--mingla-privacy-strip:calc(28px + env(safe-area-inset-bottom,0px))}
html,body{height:100%;overflow:hidden}
#root{position:fixed;top:0;left:0;right:0;bottom:var(--mingla-privacy-strip);box-sizing:border-box;height:auto!important;contain:layout;overflow-y:auto;overscroll-behavior:contain}
body>div:has(>div>[aria-modal="true"]){position:fixed;top:0;left:0;right:0;bottom:var(--mingla-privacy-strip);contain:layout;z-index:9999;pointer-events:none}
:where(body>div:has(>div>[aria-modal="true"]))>div{pointer-events:auto}
body>[aria-modal="true"]{bottom:var(--mingla-privacy-strip)!important}
.mps{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:var(--mingla-privacy-strip);margin:0;padding:0 12px env(safe-area-inset-bottom,0px);border:0;border-radius:0;background:#15171c;color:rgba(255,255,255,.9);font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}
.mps span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.mps svg{display:block;flex:none;width:14px;height:14px}
.mps:focus{outline:none}
.mps:focus-visible{outline:2px solid #eb7825;outline-offset:-3px}
.mps-saved{color:#8fd3a8}
.mpb-scrim{position:fixed;left:0;right:0;top:0;bottom:var(--mingla-privacy-strip);z-index:2147483001;background:rgba(0,0,0,.45)}
.mpb{position:fixed;left:0;right:0;bottom:var(--mingla-privacy-strip);z-index:2147483002;box-sizing:border-box;margin:0;background:#15171c;color:#fff;border-radius:18px 18px 0 0;padding:16px max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));max-height:80vh;max-height:80dvh;overflow-y:auto;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;animation:mpb-in .2s ease-out}
.mpb *{box-sizing:border-box}
.mpb[hidden],.mpb [hidden],.mpb-scrim[hidden]{display:none!important}
.mpb-panel{max-width:640px;margin:0 auto;display:flex;flex-direction:column}
.mpb-title{margin:0 0 4px;font-size:15px;line-height:20px;font-weight:700;color:#fff}
.mpb-switch-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}
.mpb-switch-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mpb-switch-title{font-size:14px;font-weight:700;color:#fff}
.mpb-switch-desc{font-size:13px;line-height:18px;color:rgba(255,255,255,.72)}
.mpb-switch{appearance:none;-webkit-appearance:none;flex-shrink:0;position:relative;width:44px;height:26px;margin:9px 0;border-radius:999px;background:rgba(255,255,255,.24);border:0;cursor:pointer;transition:background .2s ease}
.mpb-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s ease}
.mpb-switch:checked{background:#eb7825}
.mpb-switch:checked::after{transform:translateX(18px)}
.mpb-switch:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
.mpb-actions{display:flex;align-items:center;gap:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.1)}
.mpb-hit{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mpb-hit:focus{outline:none}
.mpb-hit:focus-visible .mpb-pill{outline:2px solid #eb7825;outline-offset:2px}
.mpb-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}
.mpb-primary{background:#eb7825;color:#111}
.mpb-policy{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font-size:13px;color:rgba(255,255,255,.72);text-decoration:underline}
.mpb-policy:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
@keyframes mpb-in{from{transform:translateY(12px)}to{transform:none}}
@media (prefers-reduced-motion:reduce){.mpb{animation:none}.mpb-switch,.mpb-switch::after{transition:none}}
`;

function ensureBarStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BAR_CSS;
  document.head.appendChild(style);
}

const SSR_PRIVACY_SELECTOR =
  "[data-mingla-ssr-privacy-bar],[data-mingla-ssr-privacy-strip],[data-mingla-ssr-privacy-scrim]";

/**
 * #4318 — when the server-rendered sheet is open at takeover, the switch
 * values the visitor sees there (null when it is closed or absent).
 */
function takeoverSheet(): { analytics: boolean; ads: boolean } | null {
  const sheet = document.querySelector<HTMLElement>("[data-mingla-ssr-privacy-bar]");
  if (sheet === null || sheet.hidden) return null;
  const value = (kind: "analytics" | "ads"): boolean | null => {
    const input = sheet.querySelector<HTMLInputElement>(`[data-mpb-switch="${kind}"]`);
    return input === null ? null : input.checked;
  };
  const analytics = value("analytics");
  const ads = value("ads");
  return analytics === null || ads === null ? null : { analytics, ads };
}

/** Hide, then remove, every server-rendered copy of the strip, sheet and scrim. */
function removeServerPrivacyBar(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(SSR_PRIVACY_SELECTOR))) {
    node.hidden = true;
    node.remove();
  }
}

/** The small sliders icon of the strip. */
function SlidersIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M2 4h7M12 4h2M2 12h2M7 12h7" />
      <circle cx="10.5" cy="4" r="1.5" />
      <circle cx="5.5" cy="12" r="1.5" />
    </svg>
  );
}

export function ConsentBanner(): React.ReactElement | null {
  const privacy = usePrivacyState();
  const [mounted, setMounted] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState({ analytics: true, ads: true });
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const stripRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const adoptedDraftRef = useRef<{ analytics: boolean; ads: boolean } | null>(null);

  useEffect(() => {
    ensureBarStyle();
    // #4318 — the server-rendered public document carries its own strip and
    // sheet until the app takes over. A sheet the visitor already opened there
    // stays open: the app opens its own with the switches as the visitor left
    // them, and the server copy (strip, sheet AND scrim) goes in the same
    // frame the app's copy appears (see the layout effect below).
    const ssrSheet = takeoverSheet();
    if (ssrSheet !== null) {
      adoptedDraftRef.current = ssrSheet;
      setOpen(true);
    }
    setMounted(true);
    // The #922 invite shell carries only the strip: tapping it boots the app
    // with this hand-off, so the choices open straight away.
    const handoff = window as Window & { __minglaPrivacyOpenExpanded?: boolean };
    if (handoff.__minglaPrivacyOpenExpanded === true) {
      handoff.__minglaPrivacyOpenExpanded = false;
      setOpen(true);
    }
    const reopen = (): void => setOpen(true);
    window.addEventListener(PRIVACY_CHOICES_EVENT, reopen);
    return () => {
      window.removeEventListener(PRIVACY_CHOICES_EVENT, reopen);
    };
  }, []);

  // The switches always start from what is actually running (or, once, from
  // the server sheet the visitor already had open).
  useEffect(() => {
    if (!open) return;
    const adopted = adoptedDraftRef.current;
    adoptedDraftRef.current = null;
    setDraft(adopted ?? { analytics: privacy.analytics, ads: privacy.ads });
  }, [open, privacy.analytics, privacy.ads]);

  // #4318 — the server copy leaves before the browser paints the app's copy,
  // so there is never a frame with two strips, an orphaned scrim, or none.
  useLayoutEffect(() => {
    if (mounted) removeServerPrivacyBar();
  }, [mounted]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), SAVED_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const close = useCallback((): void => {
    setOpen(false);
    window.requestAnimationFrame(() => stripRef.current?.focus());
  }, []);

  // Focus moves into the sheet, stays there (Tab wraps) and Escape closes it.
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const focusables = (): HTMLElement[] =>
      sheet === null
        ? []
        : Array.from(sheet.querySelectorAll<HTMLElement>("input, button, a[href]"));
    window.requestAnimationFrame(() => focusables()[0]?.focus());
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sheet?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sheet?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const save = useCallback((): void => {
    if (saving) return;
    setSaving(true);
    setSaved(true);
    close();
    void savePrivacyChoice(draft)
      .catch((err: unknown) => {
        console.warn("[privacyStrip] saving the privacy choice failed:", err);
      })
      .finally(() => setSaving(false));
  }, [close, draft, saving]);

  if (!mounted) return null;

  // Portalled to <body>, a sibling of #root: #root is the contained box that
  // ends at the strip's top edge, and the strip, sheet and scrim live outside
  // it so they resolve against the viewport and sit on the top z-layer.
  return createPortal(
    <>
      {open ? (
        <>
          <div className="mpb-scrim" data-testid="privacy-scrim" onClick={close} />
          <section
            ref={(node) => {
              sheetRef.current = node;
            }}
            className="mpb ph-no-capture"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mingla-privacy-title"
            id={PANEL_ID}
            data-testid="privacy-sheet"
          >
            <div className="mpb-panel" data-testid="privacy-panel">
              <h2 className="mpb-title" id="mingla-privacy-title">
                {PRIVACY_STRIP_LABEL}
              </h2>
              <label className="mpb-switch-row">
                <span className="mpb-switch-copy">
                  <span className="mpb-switch-title">Analytics</span>
                  <span className="mpb-switch-desc">
                    Helps us see which pages work and fix what doesn&apos;t.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="mpb-switch"
                  aria-label="Analytics"
                  data-testid="privacy-switch-analytics"
                  checked={draft.analytics}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, analytics: event.target.checked }))
                  }
                />
              </label>
              <label className="mpb-switch-row">
                <span className="mpb-switch-copy">
                  <span className="mpb-switch-title">Ads measurement</span>
                  <span className="mpb-switch-desc">
                    Lets Meta, TikTok, Snapchat and Reddit measure our ads.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="mpb-switch"
                  aria-label="Ads measurement"
                  data-testid="privacy-switch-ads"
                  checked={draft.ads}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, ads: event.target.checked }))
                  }
                />
              </label>
              <div className="mpb-actions">
                <button
                  type="button"
                  className="mpb-hit"
                  data-testid="privacy-bar-save"
                  onClick={save}
                >
                  <span className="mpb-pill mpb-primary">Save</span>
                </button>
                <a
                  className="mpb-policy"
                  href={PRIVACY_POLICY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy policy
                </a>
              </div>
            </div>
          </section>
        </>
      ) : null}
      <button
        type="button"
        ref={stripRef}
        className="mps ph-no-capture"
        data-testid="privacy-strip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        onClick={() => (open ? close() : openPrivacyChoices())}
      >
        <SlidersIcon />
        <span aria-live="polite" className={saved ? "mps-saved" : undefined}>
          {saved ? PRIVACY_SAVED_LABEL : PRIVACY_STRIP_LABEL}
        </span>
      </button>
    </>,
    document.body,
  );
}
