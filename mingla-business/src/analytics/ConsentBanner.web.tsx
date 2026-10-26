/**
 * #2331 — the buyer-web privacy bar. One slim, full-width bar for analytics
 * and ads, fixed to the bottom of the viewport at every width.
 *
 * I-PRIVACY-BAR-NEVER-OCCLUDES: the bar measures its own live height into
 * `--mingla-privacy-inset` on the root element (0px while hidden). The app
 * root (`#root`) ends that far above the viewport bottom, so every
 * bottom-pinned action and every scroll area sits above the bar, and anything
 * fixed to the viewport adds the same inset to its own bottom offset.
 *
 * - Collapsed: one 53px row (1px line + 4px + 44px row + 4px) plus the bottom
 *   safe-area inset. The sentence never wraps; it shortens below 400px and
 *   ends in an ellipsis.
 * - Options expands the bar in place, upward, to at most 60% of the viewport,
 *   with the Analytics and Ads switches showing the live state.
 * - Any choice hides the bar. "Your privacy choices" (PrivacyChoicesLink)
 *   reopens it, already expanded. There is no floating control.
 * - Non-modal; above page content, below sheets and dialogs.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { PRIVACY_CHOICES_EVENT } from "./privacyChoices";
import { usePrivacyState } from "./usePrivacyState.web";
import { savePrivacyChoice } from "./webAnalytics.web";

export const PRIVACY_INSET_PROPERTY = "--mingla-privacy-inset";
export const PRIVACY_POLICY_URL = "https://usemingla.com/privacy-policy";
const STYLE_ID = "mingla-privacy-bar-style";
const PRIVACY_BAR_ATTRIBUTE = "data-mingla-privacy-bar";
const PANEL_ID = "mingla-privacy-panel";
const TOAST_MS = 1800;

/** The one toast line for a saved choice. */
export function privacyToastFor(choice: { analytics: boolean; ads: boolean }): string {
  if (choice.analytics && choice.ads) return "Saved";
  if (!choice.analytics && !choice.ads) return "Analytics and ads are off";
  return choice.analytics ? "Ads are off" : "Analytics is off";
}

// Below sheets and dialogs (react-native-web's Modal layer sits at 9999).
const BAR_CSS = `
#root{box-sizing:border-box;height:calc(100% - var(${PRIVACY_INSET_PROPERTY},0px))}
html[data-mingla-privacy-bar="shown"] #root{overflow-y:auto;overscroll-behavior:contain}
.mpb{position:fixed;left:0;right:0;bottom:0;z-index:9000;box-sizing:border-box;margin:0;background:#171a20;color:#fff;border-top:1px solid rgba(255,255,255,.14);padding:4px max(12px,env(safe-area-inset-right,0px)) calc(4px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));max-height:60vh;max-height:60dvh;overflow-y:auto;overscroll-behavior:contain;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.mpb *{box-sizing:border-box}
.mpb[hidden],.mpb [hidden]{display:none!important}
.mpb-row{max-width:1200px;height:44px;margin:0 auto;display:flex;align-items:center;gap:4px}
.mpb-text{flex:1;min-width:0;margin:0 4px 0 0;font-size:13px;line-height:18px;color:rgba(255,255,255,.78);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mpb-text b{color:#fff;font-weight:700}
.mpb-short{display:none}
@media (max-width:399.98px){.mpb-long{display:none}.mpb-short{display:inline}}
.mpb-hit{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 2px;margin:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.mpb-hit:focus{outline:none}
.mpb-hit:focus-visible .mpb-pill{outline:2px solid #eb7825;outline-offset:2px}
.mpb-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:700;line-height:1;white-space:nowrap}
.mpb-primary{background:#eb7825;color:#111}
.mpb-ghost{color:#fff;border:1px solid rgba(255,255,255,.32)}
.mpb-chev{width:7px;height:7px;border-right:2px solid currentColor;border-top:2px solid currentColor;transform:translateY(2px) rotate(-45deg);transition:transform .2s ease}
.mpb-chev-up{transform:translateY(-2px) rotate(135deg)}
@media (max-width:359.98px){.mpb-options-label{display:none}.mpb-options .mpb-pill{padding:0 11px}}
.mpb-panel{max-width:1200px;margin:0 auto;padding:2px 0 6px;display:grid;grid-template-columns:1fr;column-gap:24px;animation:mpb-in .2s ease-out}
@media (min-width:600px){.mpb-panel{grid-template-columns:1fr 1fr}}
.mpb-switch-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}
.mpb-switch-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.mpb-switch-title{font-size:14px;font-weight:700;color:#fff}
.mpb-switch-desc{font-size:13px;line-height:18px;color:rgba(255,255,255,.72)}
.mpb-switch{appearance:none;-webkit-appearance:none;flex-shrink:0;position:relative;width:44px;height:26px;margin:9px 0;border-radius:999px;background:rgba(255,255,255,.24);border:0;cursor:pointer;transition:background .2s ease}
.mpb-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s ease}
.mpb-switch:checked{background:#eb7825}
.mpb-switch:checked::after{transform:translateX(18px)}
.mpb-switch:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
.mpb-actions{grid-column:1/-1;display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding-top:4px}
.mpb-policy{margin-left:auto;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font-size:13px;color:rgba(255,255,255,.72);text-decoration:underline}
.mpb-policy:focus-visible{outline:2px solid #eb7825;outline-offset:2px}
.mpb-toast{position:fixed;z-index:9001;left:50%;transform:translateX(-50%);bottom:calc(16px + var(${PRIVACY_INSET_PROPERTY},0px));max-width:calc(100vw - 32px);padding:10px 16px;border-radius:999px;background:#171a20;color:#fff;border:1px solid rgba(255,255,255,.14);font:600 13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;pointer-events:none;white-space:nowrap}
@keyframes mpb-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mpb-panel{animation:none}.mpb-chev,.mpb-switch,.mpb-switch::after{transition:none}}
`;

function ensureBarStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BAR_CSS;
  document.head.appendChild(style);
}

function writeInset(px: number): void {
  const inset = Math.max(0, Math.round(px));
  document.documentElement.style.setProperty(PRIVACY_INSET_PROPERTY, `${inset}px`);
  // While the bar shows, the app root ends at the bar's top edge and clips
  // there, at every bar height (bottom-pinned actions rise with the bar). A
  // screen that cannot scroll on its own and no longer fits (a centred card,
  // a short landscape viewport with Options open) scrolls inside the root
  // instead of sliding under the bar.
  if (inset > 0) document.documentElement.setAttribute(PRIVACY_BAR_ATTRIBUTE, "shown");
  else document.documentElement.removeAttribute(PRIVACY_BAR_ATTRIBUTE);
}

export function ConsentBanner(): React.ReactElement | null {
  const privacy = usePrivacyState();
  const [mounted, setMounted] = useState<boolean>(false);
  const [reopened, setReopened] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [draft, setDraft] = useState({ analytics: true, ads: true });
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const visible = mounted && (!privacy.saved || reopened);

  useEffect(() => {
    ensureBarStyle();
    // The server-rendered public document carries its own copy of this bar
    // until the app takes over; only one may ever show.
    for (const node of Array.from(
      document.querySelectorAll("[data-mingla-ssr-privacy-bar]"),
    )) {
      node.remove();
    }
    setMounted(true);
    // The #922 invite shell carries only the collapsed bar: its Options boots
    // the app with this hand-off, so the choices open already expanded.
    const handoff = window as Window & { __minglaPrivacyOpenExpanded?: boolean };
    if (handoff.__minglaPrivacyOpenExpanded === true) {
      handoff.__minglaPrivacyOpenExpanded = false;
      setExpanded(true);
    }
    const open = (): void => {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      setReopened(true);
      setExpanded(true);
    };
    window.addEventListener(PRIVACY_CHOICES_EVENT, open);
    return () => {
      window.removeEventListener(PRIVACY_CHOICES_EVENT, open);
      writeInset(0);
    };
  }, []);

  // The switches always start from what is actually running.
  useEffect(() => {
    if (expanded) setDraft({ analytics: privacy.analytics, ads: privacy.ads });
  }, [expanded, privacy.analytics, privacy.ads]);

  // I-PRIVACY-BAR-NEVER-OCCLUDES — the live height is the page's bottom inset.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!visible || bar === null) {
      if (mounted) writeInset(0);
      return;
    }
    const measure = (): void => writeInset(bar.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [visible, mounted, expanded]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const close = useCallback((): void => {
    setExpanded(false);
    if (reopened) {
      setReopened(false);
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target !== null && target.isConnected) target.focus();
      return;
    }
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  }, [reopened]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, close]);

  const choose = useCallback(
    (choice: { analytics: boolean; ads: boolean }): void => {
      if (saving) return;
      setSaving(true);
      setExpanded(false);
      setReopened(false);
      setToast(privacyToastFor(choice));
      void savePrivacyChoice(choice)
        .catch((err: unknown) => {
          console.warn("[privacyBar] saving the privacy choice failed:", err);
        })
        .finally(() => setSaving(false));
    },
    [saving],
  );

  if (!mounted) return null;

  const toastNode =
    toast !== null ? (
      <div className="mpb-toast" role="status" aria-live="polite" data-testid="privacy-toast">
        {toast}
      </div>
    ) : null;

  if (!visible) return toastNode;

  const bar = (
    <section
      ref={(node) => {
        barRef.current = node;
      }}
      className="mpb ph-no-capture"
      role="region"
      aria-label="Privacy choices"
      data-testid="privacy-bar"
      data-expanded={expanded ? "true" : "false"}
    >
      {expanded ? (
        <div className="mpb-panel" id={PANEL_ID} data-testid="privacy-panel">
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
              <span className="mpb-switch-title">Ads</span>
              <span className="mpb-switch-desc">
                Lets Meta, TikTok, Snapchat and Reddit measure our ads.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="mpb-switch"
              aria-label="Ads"
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
              onClick={() => choose(draft)}
            >
              <span className="mpb-pill mpb-primary">Save</span>
            </button>
            <button
              type="button"
              className="mpb-hit"
              data-testid="privacy-bar-off-all"
              onClick={() => choose({ analytics: false, ads: false })}
            >
              <span className="mpb-pill mpb-ghost">Turn off all</span>
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
      ) : null}
      <div className="mpb-row">
        <p className="mpb-text">
          {expanded ? (
            <b>Your privacy choices</b>
          ) : (
            <>
              <span className="mpb-long">Mingla uses cookies for analytics and ads.</span>
              <span className="mpb-short">Cookies for analytics and ads.</span>
            </>
          )}
        </p>
        {expanded ? null : (
          <button
            type="button"
            className="mpb-hit"
            data-testid="privacy-bar-ok"
            onClick={() => choose({ analytics: privacy.analytics, ads: privacy.ads })}
          >
            <span className="mpb-pill mpb-primary">OK</span>
          </button>
        )}
        <button
          type="button"
          ref={toggleRef}
          className="mpb-hit mpb-options"
          data-testid="privacy-bar-options"
          aria-expanded={expanded}
          aria-controls={PANEL_ID}
          aria-label={expanded ? "Close privacy choices" : "Privacy options"}
          onClick={() => (expanded ? close() : setExpanded(true))}
        >
          <span className="mpb-pill mpb-ghost">
            {expanded ? (
              "Close"
            ) : (
              <span className="mpb-options-label">Options</span>
            )}
            <span className={expanded ? "mpb-chev" : "mpb-chev mpb-chev-up"} aria-hidden="true" />
          </span>
        </button>
      </div>
    </section>
  );

  // Rendered in place: `position: fixed` resolves against the viewport (no
  // transformed ancestor in the root stack), like ParallaxCoverShell's chrome.
  return (
    <>
      {bar}
      {toastNode}
    </>
  );
}
