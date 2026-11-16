// #4452 §7.4 — the builder's live preview: the REAL marketing field kit and
// pop-up (public/forms-kit/, built from mingla-marketing/components/forms by
// scripts/build-forms-kit.mjs) inside an iframe srcdoc, so the site's CSS stays
// isolated from Admin's. The frame is sandboxed (scripts only: an opaque
// origin, no cookies, no storage of Admin's) and its CSP allows no network
// connection, so a preview can never submit, track or fetch. Desktop is drawn
// 1100 px wide and scaled to fit; Phone is iPhone size (390 x 760).
import { useEffect, useMemo, useRef, useState } from "react";
import { previewForm, kitSrcDoc } from "../../lib/formsPreview";

const SIZES = { desktop: { w: 1100, h: 720 }, phone: { w: 390, h: 760 } };

export function FormPreviewFrame({ form, def, device = "desktop" }) {
  const ref = useRef(null);
  const box = useRef(null);
  const [ready, setReady] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  const srcDoc = useMemo(() => kitSrcDoc(typeof window === "undefined" ? "" : window.location.origin), []);
  const payload = useMemo(() => previewForm(form, def), [form, def]);

  useEffect(() => {
    const on = (e) => {
      if (e.source === ref.current?.contentWindow && e.data?.type === "mingla-forms-kit-ready") setReady(true);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => {
    if (!ready) return;
    // The frame has an opaque origin (sandbox without allow-same-origin), so "*" is the only target that reaches it.
    ref.current?.contentWindow?.postMessage({ type: "mingla-forms-kit", form: payload, device: device === "visitor" ? "desktop" : device }, "*");
  }, [ready, payload, device]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (device === "visitor") {
    return <iframe ref={ref} title="The form as a visitor sees it" sandbox="allow-scripts" srcDoc={srcDoc} className="h-full w-full border-0" data-form-preview="visitor" />;
  }
  const size = SIZES[device] || SIZES.desktop;
  const scale = device === "desktop" && boxWidth ? Math.min(1, boxWidth / size.w) : 1;
  return (
    <div ref={box} className="w-full overflow-hidden rounded-2xl border border-[var(--a-line)] bg-[var(--a-soft)]" data-form-preview={device}
      style={{ height: device === "desktop" ? size.h * scale : size.h + 24 }}>
      <div style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: "top left", margin: device === "phone" ? "12px auto" : 0 }}
        className={device === "phone" ? "overflow-hidden rounded-[36px] border-[8px] border-[#111110]" : ""}>
        <iframe ref={ref} title={`Live preview, ${device}`} sandbox="allow-scripts" srcDoc={srcDoc} width={size.w} height={size.h} className="block border-0" tabIndex={-1} />
      </div>
    </div>
  );
}
