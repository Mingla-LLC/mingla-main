// #4452 §7.6 — the Website pages editor's side panel: add a block to a spot
// (Form, Button row or Banner; the pop-up spot takes a Form, the details step
// "Questions from a form"), edit it within the limits, the pop-up's settings
// with "See it as a visitor", Move up / Move down to the next free spot,
// Remove, and the hero's words (48 / 24 / 200 / 28 with counters, Reset).
import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Input";
import { useToast } from "../../context/ToastContext";
import { LabelPill, LimitedText, Panel, ToggleRow } from "../forms/formsUi";
import { FormPreviewFrame } from "../forms/FormPreviewFrame";
import { getForm } from "../../services/formsService";
import {
  ADDED_TOAST, ARCHIVED_BLOCK, BRAND_STYLE_NOTE, CODED_HEROES, DEST_KINDS, HERO_LIMITS_NOTE, HOST_TEMPLATE_KEY, LIMITS, POPUP_ALWAYS,
  POPUP_CHOICES, REMOVED_TOAST, blockAt, contentKeyFor, heroOf, heroProblems, moveBlock, newBlock, patchBlock, putBlock, removeBlock, resetHero,
} from "../../lib/sitePagesModel";

function DestPicker({ value, onChange, forms, disabled, label = "Goes to" }) {
  const formPages = forms.filter((f) => f.own_page);
  return (
    <div className="grid gap-1.5">
      <Select label={label} value={value?.kind || "schedule"} disabled={disabled}
        onChange={(e) => onChange(e.target.value === "form_page" ? { kind: "form_page", form_id: formPages[0]?.id } : e.target.value === "url" ? { kind: "url", href: "https://usemingla.com" } : { kind: e.target.value })}
        options={DEST_KINDS.filter(([k]) => k !== "form_page" || formPages.length).map(([k, l]) => ({ value: k, label: l }))} />
      {value?.kind === "form_page" && (
        <Select aria-label="Which form page" value={value.form_id} disabled={disabled} onChange={(e) => onChange({ kind: "form_page", form_id: e.target.value })}
          options={formPages.map((f) => ({ value: f.id, label: `/apply/${f.own_page}` }))} />
      )}
      {value?.kind === "url" && (
        <input aria-label="Link" value={value.href || ""} disabled={disabled} maxLength={300} onChange={(e) => onChange({ kind: "url", href: e.target.value })}
          className="h-11 rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm outline-none focus:border-[var(--a-text)]" placeholder="https://" />
      )}
    </div>
  );
}

function FormSelect({ value, onChange, forms, disabled, details }) {
  const usable = forms.filter((f) => f.status !== "archived" && (details ? f.template === "book_call_extra" : f.template !== "book_call_extra"));
  return (
    <Select label={details ? "Questions from a form" : "Form"} value={value || ""} disabled={disabled} placeholder="Pick a form"
      onChange={(e) => { if (e.target.value === "__new") { window.location.hash = "#/forms"; return; } onChange(e.target.value); }}
      options={[...usable.map((f) => ({ value: f.id, label: f.name })), { value: "__new", label: "+ Make a new form" }]} />
  );
}

export function PageSidePanel({ page, panel, setPanel, canEdit, doc, tpl, onEdit, forms }) {
  const { addToast } = useToast();
  const [allHost, setAllHost] = useState(false);
  const [visitor, setVisitor] = useState(null); // the form definition being previewed
  const spots = [...(page.spots || []), { key: "popup", label: "Pop-up form", kind: "popup" }];
  const spotLabel = (key) => spots.find((s) => s.key === key)?.label || key.replace(/-/g, " ");
  const isTemplate = page.template === "host";
  // The block in a spot: the page's own first, else the shared host-template one.
  const findBlock = (spot) => {
    const own = blockAt(doc.content, spot);
    if (own) return { block: own, key: page.key };
    const shared = tpl ? blockAt(tpl.content, spot) : null;
    return shared ? { block: shared, key: HOST_TEMPLATE_KEY } : null;
  };
  const contentOf = (key) => (key === HOST_TEMPLATE_KEY ? tpl.content : doc.content);
  const apply = (key, next) => onEdit(key, next);

  if (!panel) {
    return (
      <Panel title="Edit this page">
        <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
          <p>Click an orange <b>Add here</b> marker on the page to add a form, a button row or a banner there.</p>
          {page.hero && <p>Click the hero to change its words.</p>}
          <p>Every page can also have a pop-up form: use the bar at the top of the page.</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{BRAND_STYLE_NOTE}</p>
        </div>
      </Panel>
    );
  }

  if (panel.kind === "hero") {
    const hero = heroOf(doc.content, page.key);
    const set = (patch) => apply(page.key, { ...doc.content, hero: { ...hero, ...patch } });
    const problems = heroProblems(hero);
    return (
      <Panel title="Hero words" action={<Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Done</Button>} data-hero-editor="">
        <div className="flex flex-col gap-3">
          <LimitedText label="Headline" value={hero.h1} limit={LIMITS.heroH1} disabled={!canEdit} onChange={(v) => set({ h1: v })} />
          <LimitedText label="Italic ending" value={hero.em} limit={LIMITS.heroEm} disabled={!canEdit} onChange={(v) => set({ em: v })} />
          <LimitedText label="Lead" value={hero.lead} limit={LIMITS.heroLead} multiline disabled={!canEdit} onChange={(v) => set({ lead: v })} />
          {hero.buttons.map((b, i) => (
            <div key={i} className="grid gap-1.5 rounded-xl border border-[var(--a-line)] p-2.5">
              <LimitedText label={`Button ${i + 1}`} value={b.text} limit={LIMITS.heroButton} disabled={!canEdit} onChange={(v) => set({ buttons: hero.buttons.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
              <DestPicker value={b.to} forms={forms} disabled={!canEdit} onChange={(to) => set({ buttons: hero.buttons.map((x, j) => (j === i ? { ...x, to } : x)) })} />
            </div>
          ))}
          {problems.length > 0 && <ul className="text-xs text-[#b91c1c]">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <p className="text-xs text-[var(--color-text-tertiary)]">{HERO_LIMITS_NOTE}</p>
          <Button variant="secondary" disabled={!canEdit || !doc.content.hero} onClick={() => apply(page.key, resetHero(doc.content))}>Reset to the designed words</Button>
          <p className="text-xs text-[var(--color-text-tertiary)]">Designed: “{CODED_HEROES[page.key]?.h1} {CODED_HEROES[page.key]?.em}”</p>
        </div>
      </Panel>
    );
  }

  const spot = panel.spot;
  const found = findBlock(spot);
  const isPopup = spot === "popup";
  const isDetails = spot === "details-step";

  if (!found) {
    const add = (type) => {
      try {
        const key = allHost && isTemplate ? HOST_TEMPLATE_KEY : page.key;
        const block = newBlock(type, spot, { formId: null, allHostPages: key === HOST_TEMPLATE_KEY });
        apply(key, putBlock(contentOf(key), block));
        addToast({ variant: "success", title: ADDED_TOAST });
        setPanel({ kind: "block", spot, block: block.id });
      } catch (e) { addToast({ variant: "error", title: e.message }); }
    };
    return (
      <Panel title={`Add · ${spotLabel(spot)}`} action={<Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Cancel</Button>} data-add-panel={spot}>
        <div className="flex flex-col gap-2">
          {isDetails ? (
            <Button variant="secondary" disabled={!canEdit} onClick={() => add("form")}>Questions from a form</Button>
          ) : isPopup ? (
            <Button variant="secondary" disabled={!canEdit} onClick={() => add("form")}>Form</Button>
          ) : (
            <>
              <Button variant="secondary" disabled={!canEdit} onClick={() => add("form")}>Form</Button>
              <Button variant="secondary" disabled={!canEdit} onClick={() => add("buttons")}>Button row</Button>
              <Button variant="secondary" disabled={!canEdit} onClick={() => add("banner")}>Banner</Button>
            </>
          )}
          {isTemplate && <ToggleRow title="Use on all host pages" hint="Every host landing page shows it, unless a page has its own block there." checked={allHost} disabled={!canEdit} onChange={setAllHost} />}
          <p className="text-xs text-[var(--color-text-tertiary)]">{BRAND_STYLE_NOTE}</p>
        </div>
      </Panel>
    );
  }

  const { block, key } = found;
  const set = (patch) => apply(key, patchBlock(contentOf(key), block.id, patch));
  const form = forms.find((f) => f.id === block.form_id);
  const move = (dir) => {
    const res = moveBlock(contentOf(key), block.id, dir, page.spots);
    if (res.error) { addToast({ variant: "error", title: res.error }); return; }
    apply(key, res.content);
    setPanel({ kind: "block", spot: res.content.blocks.find((b) => b.id === block.id).spot, block: block.id });
  };
  const remove = () => {
    apply(key, removeBlock(contentOf(key), block.id));
    addToast({ variant: "success", title: REMOVED_TOAST });
    setPanel(null);
  };
  const title = { form: "Form block", popup: "Pop-up form", buttons: "Button row", banner: "Banner" }[block.type];

  return (
    <Panel title={`${title} · ${spotLabel(block.spot)}`} action={<Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Done</Button>} data-block-editor={block.type}>
      <div className="flex flex-col gap-3">
        {key === HOST_TEMPLATE_KEY && <p className="rounded-xl bg-[var(--a-soft)] px-3 py-2 text-xs text-[var(--a-text2)]">On all host pages.</p>}
        {(block.type === "form" || block.type === "popup") && (
          <>
            <FormSelect value={block.form_id} forms={forms} disabled={!canEdit} details={isDetails} onChange={(id) => set({ form_id: id })} />
            {form && <p className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]"><LabelPill label={form.audience} /> {form.status === "live" ? `Live v${form.live_version}` : "Draft: publish the form before the page."}</p>}
            {form?.status === "archived" && <p role="alert" className="rounded-xl bg-[var(--a-stop-bg)] px-3 py-2 text-xs text-[var(--a-stop-ink)]"><b>Paused.</b> {ARCHIVED_BLOCK}</p>}
            {!isDetails && (
              <>
                <LimitedText label="Heading" value={block.head} limit={LIMITS.formHead} disabled={!canEdit} onChange={(v) => set({ head: v })} />
                <LimitedText label="Italic ending" value={block.em} limit={LIMITS.formEm} disabled={!canEdit} onChange={(v) => set({ em: v })} />
                <LimitedText label="Line" value={block.sub} limit={LIMITS.formSub} disabled={!canEdit} onChange={(v) => set({ sub: v })} />
              </>
            )}
            {block.type === "popup" && (
              <div className="grid gap-2 rounded-xl border border-[var(--a-line)] p-2.5" data-popup-settings="">
                {Object.entries(POPUP_CHOICES).map(([k, opts]) => (
                  <Select key={k} label={{ trigger: "Show it", freq: "How often", devices: "Devices", style: "Style" }[k]} value={block.popup?.[k]} disabled={!canEdit}
                    onChange={(e) => set({ popup: { ...block.popup, [k]: e.target.value } })} options={opts.map(([v, l]) => ({ value: v, label: l }))} />
                ))}
                <p className="text-xs text-[var(--color-text-tertiary)]">{POPUP_ALWAYS}</p>
                <Button variant="secondary" size="sm" icon={Eye} disabled={!form} onClick={async () => {
                  try {
                    const f = await getForm(form.id);
                    setVisitor(f.live_version?.definition || f.draft);
                  } catch (e) { addToast({ variant: "error", title: e.message }); }
                }}>See it as a visitor</Button>
              </div>
            )}
            {form && <a href={`#/forms/${form.id}?tab=fields`} className="text-sm font-medium text-[var(--a-chip-ink)] hover:underline">Edit this form's fields and emails</a>}
          </>
        )}
        {block.type === "buttons" && (
          <>
            {(block.buttons || []).map((b, i) => (
              <div key={i} className="grid gap-1.5 rounded-xl border border-[var(--a-line)] p-2.5">
                <LimitedText label={`Button ${i + 1}`} value={b.text} limit={LIMITS.buttonText} disabled={!canEdit} onChange={(v) => set({ buttons: block.buttons.map((x, j) => (j === i ? { ...x, text: v } : x)) })} />
                <DestPicker value={b.to} forms={forms} disabled={!canEdit} onChange={(to) => set({ buttons: block.buttons.map((x, j) => (j === i ? { ...x, to } : x)) })} />
                {block.buttons.length > 1 && <Button variant="ghost" size="sm" disabled={!canEdit} onClick={() => set({ buttons: block.buttons.filter((_, j) => j !== i) })}>Remove this button</Button>}
              </div>
            ))}
            {(block.buttons || []).length < 2 && <Button variant="secondary" size="sm" disabled={!canEdit} onClick={() => set({ buttons: [...block.buttons, { text: "Get the app", to: { kind: "app" } }] })}>+ Second button</Button>}
          </>
        )}
        {block.type === "banner" && (
          <>
            <LimitedText label="Line" value={block.text} limit={LIMITS.bannerText} disabled={!canEdit} onChange={(v) => set({ text: v })} />
            <LimitedText label="Button" value={block.btn} limit={LIMITS.bannerBtn} disabled={!canEdit} onChange={(v) => set({ btn: v })} />
            <DestPicker value={block.to} forms={forms} disabled={!canEdit} onChange={(to) => set({ to })} />
            <label className="block text-[12.5px] font-semibold text-[var(--a-text2)]">Show until
              <input type="date" value={block.show_until || ""} disabled={!canEdit} onChange={(e) => set({ show_until: e.target.value || null })}
                className="mt-1.5 h-11 w-full rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm font-normal" />
            </label>
          </>
        )}
        {!isPopup && !isDetails && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ArrowUp} disabled={!canEdit} onClick={() => move(-1)}>Move up</Button>
            <Button variant="secondary" size="sm" icon={ArrowDown} disabled={!canEdit} onClick={() => move(1)}>Move down</Button>
          </div>
        )}
        <Button variant="ghost" icon={Trash2} disabled={!canEdit} onClick={remove}>Remove</Button>
        <p className="text-xs text-[var(--color-text-tertiary)]">{BRAND_STYLE_NOTE}</p>
        {contentKeyFor(page.key, block) === HOST_TEMPLATE_KEY && <p className="text-xs text-[var(--color-text-tertiary)]">Shared blocks are published with this page.</p>}
      </div>
      {visitor && form && (
        <div role="dialog" aria-modal="true" aria-label="See it as a visitor" className="fixed inset-0 z-50 flex flex-col bg-[rgba(15,15,14,.6)] p-4">
          <div className="mb-2 flex justify-end"><Button variant="secondary" onClick={() => setVisitor(null)}>Close the preview</Button></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-[var(--a-panel)]">
            <FormPreviewFrame form={{ id: form.id, key: form.key, name: form.name }} def={{ ...visitor, design: { ...(visitor.design || {}), layout: block.popup?.style === "side" ? "side" : "centre" } }} device="visitor" />
          </div>
        </div>
      )}
    </Panel>
  );
}
