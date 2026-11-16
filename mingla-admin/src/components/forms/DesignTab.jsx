// #4452 §7.4 Design tab (design designTab, limits exact): layout, photo (the
// brand library or an upload), where the text sits (3 x 3), line alignment,
// text, backdrop and tick colours, the live contrast badge (warns, never
// blocks), the words, columns, phone steps, and the live desktop / phone
// preview drawn by the REAL marketing field kit (FormPreviewFrame).
import { useCallback, useRef, useState } from "react";
import { Eye, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { useServerRead } from "../../hooks/useServerRead";
import {
  ALIGNS, DESIGN_LIMITS, LAYOUTS, SCRIMS, TEXT_COLOURS, TEXT_COLS, TEXT_ROWS, TICKS, contrastBadge, designContrast, designOf, photoPrecheck,
} from "../../lib/formsModel";
import { libraryPhotos, uploadFormPhoto } from "../../services/formsService";
import { LimitedText, Panel, Seg, ToggleRow } from "./formsUi";
import { FormPreviewFrame } from "./FormPreviewFrame";

const TICK_NAMES = { orange: "Orange", white: "White", sand: "Sand" };

export function DesignTab({ def, edit, canEdit, form }) {
  const { addToast } = useToast();
  const d = designOf(def.design);
  const set = (patch) => edit({ ...def, design: { ...d, ...patch } });
  const [device, setDevice] = useState("desktop");
  const [visitor, setVisitor] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const loadLib = useCallback(() => libraryPhotos(), []);
  const lib = useServerRead(loadLib);
  const ratio = designContrast(d);
  const badge = contrastBadge(ratio);
  const [row, col] = d.text_pos.split("-");

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const problem = photoPrecheck(file);
    if (problem) { addToast({ variant: "error", title: problem }); return; }
    setUploading(true);
    try {
      const res = await uploadFormPhoto(file);
      set(res);
      addToast({ variant: "success", title: "Photo added." });
    } catch (err) {
      addToast({ variant: "error", title: err.message });
    } finally {
      setUploading(false);
    }
  };

  const swatch = (on) => `h-9 w-9 rounded-full border-2 ${on ? "border-[#eb7825] shadow-[0_0_0_3px_rgba(235,120,37,.18)]" : "border-[var(--a-line)]"} disabled:cursor-not-allowed`;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]" data-design-tab="">
      <Panel>
        <div className="flex flex-col gap-4">
          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Layout</span>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" disabled={!canEdit} aria-pressed={d.layout === l.id} onClick={() => set({ layout: l.id })} data-layout={l.id}
                  className={`rounded-xl border-[1.5px] p-2.5 text-left disabled:cursor-not-allowed ${d.layout === l.id ? "border-[#eb7825] shadow-[0_0_0_3px_rgba(235,120,37,.18)]" : "border-[var(--a-line)]"}`}>
                  <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{l.name}</span>
                  <span className="block text-xs text-[var(--color-text-tertiary)]">{l.id === "page" ? `/apply/${def.own_page?.slug || form.key}` : l.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div data-photo-picker="">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Photo</span>
            <div className="grid grid-cols-5 gap-1.5">
              {lib.status === "loading" ? [0, 1, 2, 3].map((i) => <Skeleton key={i} height={56} rounded="10px" />) : (lib.data || []).slice(0, 4).map((p) => (
                <button key={p.photo} type="button" disabled={!canEdit} aria-label={`Photo ${p.name}`} aria-pressed={d.photo === p.photo}
                  onClick={() => set({ photo: p.photo, photo_url: p.photo_url, photo_thumb_url: p.photo_thumb_url })}
                  className={`aspect-square rounded-[10px] border-2 bg-cover bg-center ${d.photo === p.photo ? "border-[#eb7825]" : "border-transparent"}`}
                  style={{ backgroundImage: `url(${p.photo_thumb_url})` }} />
              ))}
              {d.photo?.startsWith("upload:") && (
                <button type="button" aria-label="Your upload" aria-pressed="true" className="aspect-square rounded-[10px] border-2 border-[#eb7825] bg-cover bg-center" style={{ backgroundImage: `url(${d.photo_thumb_url || d.photo_url})` }} />
              )}
            </div>
            {lib.status === "error" && <p className="mt-1 text-xs text-[#b91c1c]">The brand library did not load. Upload a photo, or <button type="button" className="underline" onClick={lib.retry}>try again</button>.</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon={Plus} loading={uploading} disabled={!canEdit} onClick={() => fileRef.current?.click()}>Upload a photo</Button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} data-photo-upload="" />
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">From the brand library, or upload. Faces never sit under text.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Where the text sits on the photo</span>
            <div role="radiogroup" aria-label="Text position" className="grid w-[132px] grid-cols-3 gap-1.5 rounded-xl bg-[var(--a-soft)] p-1.5" data-text-grid="">
              {TEXT_ROWS.map((r) => TEXT_COLS.map((c) => {
                const on = r === row && c === col;
                return (
                  <button key={`${r}-${c}`} type="button" role="radio" aria-checked={on} aria-label={`${r} ${c}`} disabled={!canEdit} onClick={() => set({ text_pos: `${r}-${c}` })}
                    className={`grid h-9 place-items-center rounded-lg ${on ? "bg-[var(--a-text)]" : "bg-[var(--a-panel)]"}`}>
                    <i aria-hidden="true" className={`block h-1.5 w-4 rounded ${on ? "bg-[var(--a-panel)]" : "bg-[var(--a-line)]"}`} />
                  </button>
                );
              }))}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Middle is the default. Breathing room on every side is fixed, so text never touches an edge.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Line alignment</span>
            <Seg label="Line alignment" value={d.align} disabled={!canEdit} onChange={(v) => set({ align: v })}
              options={ALIGNS.map((a) => ({ id: a, label: a === "left" ? "Left (recommended)" : a === "centre" ? "Centre" : "Right" }))} />
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Left reads best for more than one line; centre suits short headlines.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Text colour</span>
            <div className="flex flex-wrap items-center gap-2">
              {TEXT_COLOURS.map((t) => (
                <button key={t.hex} type="button" title={t.name} aria-label={t.name} aria-pressed={d.text_color.toLowerCase() === t.hex} disabled={!canEdit} onClick={() => set({ text_color: t.hex })} className={swatch(d.text_color.toLowerCase() === t.hex)} style={{ background: t.hex }} />
              ))}
              <input type="color" aria-label="Custom text colour" value={d.text_color} disabled={!canEdit} onChange={(e) => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) set({ text_color: e.target.value.toLowerCase() }); }} className="h-9 w-12 cursor-pointer rounded-lg border border-[var(--a-line)] bg-transparent" />
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Backdrop behind the text</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SCRIMS).map(([k, sc]) => (
                <button key={k} type="button" title={sc.name} aria-label={sc.name} aria-pressed={d.backdrop === k} disabled={!canEdit} onClick={() => set({ backdrop: k })} className={swatch(d.backdrop === k)} style={{ background: `rgb(${sc.rgba[0]},${sc.rgba[1]},${sc.rgba[2]})` }} />
              ))}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">A brand-colour wash so text always reads, whatever the photo.</p>
          </div>

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Tick colour</span>
            <div className="flex gap-2">
              {Object.entries(TICKS).map(([k, hex]) => (
                <button key={k} type="button" title={TICK_NAMES[k]} aria-label={TICK_NAMES[k]} aria-pressed={d.tick === k} disabled={!canEdit} onClick={() => set({ tick: k })} className={swatch(d.tick === k)} style={{ background: hex }} />
              ))}
            </div>
          </div>

          <p data-contrast-badge={badge.ok ? "ok" : "low"} role="status"
            className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${badge.ok ? "bg-[#dcfce7] text-[#166534]" : "bg-[#fee2e2] text-[#991b1b]"}`}>{badge.text}</p>

          <LimitedText label="Title bar" value={d.title} limit={DESIGN_LIMITS.title} disabled={!canEdit} onChange={(v) => set({ title: v })} />
          <div className="grid grid-cols-2 gap-2">
            <LimitedText label="Headline" value={d.head} limit={DESIGN_LIMITS.head} disabled={!canEdit} onChange={(v) => set({ head: v })} />
            <LimitedText label="Italic ending" value={d.em} limit={DESIGN_LIMITS.em} disabled={!canEdit} onChange={(v) => set({ em: v })} />
          </div>
          <div className="grid gap-2">
            <span className="text-[12.5px] font-semibold text-[var(--a-text2)]">Three reasons (on the photo)</span>
            {d.reasons.map((r, i) => (
              <LimitedText key={i} label={`Reason ${i + 1}`} value={r} limit={DESIGN_LIMITS.reason} disabled={!canEdit} onChange={(v) => set({ reasons: d.reasons.map((x, j) => (j === i ? v : x)) })} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LimitedText label="Send button" value={d.send} limit={DESIGN_LIMITS.send} disabled={!canEdit} onChange={(v) => set({ send: v })} />
            <LimitedText label="Dismiss link" value={d.dismiss} limit={DESIGN_LIMITS.dismiss} disabled={!canEdit} onChange={(v) => set({ dismiss: v })} />
          </div>
          <LimitedText label="Small print by the button" value={d.small} limit={DESIGN_LIMITS.small} disabled={!canEdit} onChange={(v) => set({ small: v })} />

          <div>
            <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--a-text2)]">Fields on desktop</span>
            <Seg label="Fields on desktop" value={String(d.columns)} disabled={!canEdit} onChange={(v) => set({ columns: Number(v) })} options={[{ id: "1", label: "One column" }, { id: "2", label: "Two columns" }]} />
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Phones always use one column, full width.</p>
          </div>
          <ToggleRow title="One question per screen on phones" hint="Continue moves to the next question; the last one sends." checked={d.phone_steps} disabled={!canEdit} onChange={(v) => set({ phone_steps: v })} />
          <p className="text-xs text-[var(--color-text-tertiary)]">Fonts, colours, corners and spacing are fixed to the brand, so every form looks premium whoever builds it.</p>
        </div>
      </Panel>

      <div className="flex min-w-0 flex-col gap-2.5 xl:sticky xl:top-4 xl:self-start">
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Preview size" value={device} onChange={setDevice} options={[{ id: "desktop", label: "Desktop" }, { id: "phone", label: "Phone" }]} />
          <span className="text-xs text-[var(--color-text-tertiary)]">Live preview with your fields. {device === "desktop" ? "1100px wide, scaled to fit." : "iPhone size."}</span>
          <span className="flex-1" />
          <Button variant="secondary" size="sm" icon={Eye} onClick={() => setVisitor(true)}>Try it as a visitor</Button>
        </div>
        <FormPreviewFrame form={form} def={def} device={device} />
      </div>

      {visitor && (
        <div role="dialog" aria-modal="true" aria-label="Try it as a visitor" className="fixed inset-0 z-50 flex flex-col bg-[rgba(15,15,14,.6)] p-4">
          <div className="mb-2 flex justify-end"><Button variant="secondary" onClick={() => setVisitor(false)}>Close the preview</Button></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-[var(--a-panel)]">
            <FormPreviewFrame form={form} def={def} device="visitor" />
          </div>
        </div>
      )}
    </div>
  );
}
