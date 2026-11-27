// #4636 — the right rail when no section is selected: a page's settings
// (staff-made pages: name, address before the first publish, search and share
// description, share picture, hide from search, show in the menu, delete), and
// the site-wide menu and footer (the reserved 'site-settings' page).
import { useState } from "react";
import { ArrowDown, ArrowUp, ImageIcon, Plus, Trash2, X } from "lucide-react";
import { Toggle } from "../ui/Input";
import { Button } from "../ui/Button";
import { CODED_SETTINGS, mediaLabel, publicUrl, setAt } from "../../lib/siteEditorModel";
import { FIELD, FIELD_BAD, Hint, MiniButton, Note, TextField } from "./editorUi";

export function PageMetaPanel({ page, custom, canEdit, media, supabaseUrl, onMeta, openMedia, onDelete, metaErrors = {} }) {
  const [name, setName] = useState(custom?.name ?? "");
  const [path, setPath] = useState(custom?.path ?? "");
  const [desc, setDesc] = useState(custom?.seo_description ?? "");
  if (!custom) {
    return (
      <div data-page-settings="">
        <h3 className="text-sm font-semibold">{page.title}</h3>
        <Hint className="mt-0.5">usemingla.com{page.path}</Hint>
        <Note className="mt-3">Click a section on the page to change it. This page's address, title and search description are set in code.</Note>
      </div>
    );
  }
  const share = custom.share_media_id ? mediaLabel(`m:${custom.share_media_id}`, media) : null;
  const locked = custom.ever_published;
  return (
    <div data-page-settings="">
      <h3 className="text-sm font-semibold">Page settings</h3>
      <Hint className="mt-0.5">Click a section on the page to change it. These apply to the whole page and save straight away.</Hint>
      <TextField id="pm-name" label="Page name (the browser tab title)" max={70} value={name} disabled={!canEdit} error={metaErrors.name}
        onChange={setName} inputRef={null} />
      {canEdit && name.trim() && name !== custom.name ? <MiniButton className="mt-1" onClick={() => onMeta({ name: name.trim() })}>Save name</MiniButton> : null}
      <TextField id="pm-path" label="Address" max={80} value={path} disabled={!canEdit || locked} error={metaErrors.path}
        hint={locked ? "A published page keeps its address." : "You can change it until the first publish."} onChange={(v) => setPath(v.startsWith("/") ? v : `/${v}`)} />
      {canEdit && !locked && path !== custom.path ? <MiniButton className="mt-1" onClick={() => onMeta({ path })}>Save address</MiniButton> : null}
      <TextField id="pm-desc" label="Search and share description" max={160} multiline value={desc} disabled={!canEdit} error={metaErrors.seo_description} onChange={setDesc} />
      {canEdit && desc !== (custom.seo_description ?? "") ? <MiniButton className="mt-1" onClick={() => onMeta({ seo_description: desc.trim() || null })}>Save description</MiniButton> : null}
      <span className="mb-1 mt-3 block text-xs font-medium text-[var(--a-text2)]">Share picture</span>
      <button type="button" disabled={!canEdit} onClick={() => openMedia(["photo"], (ref) => onMeta({ share_media_id: ref ? ref.slice(2) : null }))}
        className="flex w-full items-center gap-2 rounded-xl border border-[var(--a-line)] bg-[var(--a-bg)] p-1.5 text-left disabled:cursor-default" data-share-picture="">
        <span className="grid h-10 w-16 place-items-center overflow-hidden rounded-lg bg-[var(--a-soft)]">
          {share?.item ? <img src={publicUrl(supabaseUrl, "site-media", share.item.thumb_path)} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={16} aria-hidden="true" />}
        </span>
        <span className="text-sm">{share ? share.label : "The site's default picture"}</span>
      </button>
      {canEdit && custom.share_media_id ? <button type="button" className="mt-1 text-xs underline text-[var(--a-dim)]" onClick={() => onMeta({ share_media_id: null })}>Use the default picture</button> : null}
      <div className="mt-4 space-y-3">
        <Toggle label="Hide from search engines" checked={Boolean(custom.hide_from_search)} disabled={!canEdit} onChange={(v) => onMeta({ hide_from_search: v })} />
        <Toggle label="Show in the menu" checked={Boolean(custom.show_in_menu)} disabled={!canEdit} onChange={(v) => onMeta({ show_in_menu: v })} />
      </div>
      {metaErrors.form ? <Note tone="bad" className="mt-3">{metaErrors.form}</Note> : null}
      {canEdit ? <Button className="mt-5" size="sm" variant="danger" icon={Trash2} onClick={onDelete} data-delete-open="">{custom.ever_published ? "Delete page" : "Delete this draft page"}</Button> : null}
    </div>
  );
}

function LinkRows({ links, at, max, errors, onChange, disabled, maxLinks, labelMax }) {
  const set = (i, k, v) => onChange(links.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const move = (i, d) => { const n = links.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div>
      {errors[at] ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{errors[at]}</p> : null}
      <ol className="space-y-1.5">
        {links.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-1">
            <input aria-label="Link words" className={`${FIELD} text-xs ${errors[`${at}[${i}].label`] ? FIELD_BAD : ""}`} value={l.label} maxLength={labelMax} disabled={disabled} onChange={(e) => set(i, "label", e.target.value)} />
            <input aria-label="Link address" className={`${FIELD} text-xs ${errors[`${at}[${i}].to`] ? FIELD_BAD : ""}`} value={l.to} disabled={disabled} onChange={(e) => set(i, "to", e.target.value)} />
            <span className="flex gap-0.5">
              <MiniButton aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp size={11} /></MiniButton>
              <MiniButton aria-label="Move down" disabled={disabled || i === links.length - 1} onClick={() => move(i, 1)}><ArrowDown size={11} /></MiniButton>
              <MiniButton aria-label="Remove link" disabled={disabled || links.length <= 1} onClick={() => onChange(links.filter((_, j) => j !== i))}><X size={11} /></MiniButton>
            </span>
            {errors[`${at}[${i}].label`] || errors[`${at}[${i}].to`] ? <p role="alert" className="col-span-3 text-[11px] text-[var(--color-error-700)]">{errors[`${at}[${i}].label`] || errors[`${at}[${i}].to`]}</p> : null}
          </li>
        ))}
      </ol>
      <MiniButton className="mt-1" disabled={disabled || links.length >= (maxLinks ?? max)} onClick={() => onChange([...links, { label: "New link", to: "/" }])}><Plus size={11} /> Add link</MiniButton>
    </div>
  );
}

function Groups({ groups, at, maxGroups, maxLinks, errors, onChange, disabled, noun }) {
  return (
    <div className="space-y-3">
      {errors[at] ? <p role="alert" className="text-xs text-[var(--color-error-700)]">{errors[at]}</p> : null}
      {groups.map((g, i) => (
        <fieldset key={i} className="rounded-xl border border-[var(--a-line)] p-2">
          <div className="flex items-center gap-1">
            <input aria-label={`${noun} title`} className={`${FIELD} text-xs font-semibold ${errors[`${at}[${i}].title`] ? FIELD_BAD : ""}`} maxLength={24} value={g.title} disabled={disabled} onChange={(e) => onChange(groups.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <MiniButton aria-label={`Remove ${noun}`} disabled={disabled || groups.length <= 1} onClick={() => onChange(groups.filter((_, j) => j !== i))}><Trash2 size={11} /></MiniButton>
          </div>
          <div className="mt-1.5">
            <LinkRows links={g.links} at={`${at}[${i}].links`} maxLinks={maxLinks} labelMax={40} errors={errors} disabled={disabled} onChange={(links) => onChange(groups.map((x, j) => (j === i ? { ...x, links } : x)))} />
          </div>
        </fieldset>
      ))}
      <MiniButton disabled={disabled || groups.length >= maxGroups} onClick={() => onChange([...groups, { title: "New group", links: [{ label: "Home", to: "/" }] }])}><Plus size={11} /> Add {noun}</MiniButton>
    </div>
  );
}

export function SiteSettingsPanel({ content, onChange, canEdit, errors }) {
  const nav = content?.nav ?? null;
  const footer = content?.footer ?? null;
  const set = (path, v) => onChange(setAt(content || {}, path, v));
  return (
    <div data-site-settings="">
      <h3 className="text-sm font-semibold">Menu and footer</h3>
      <Hint className="mt-0.5">Shown on every page. Publish to put changes live. A part you don't edit stays as coded.</Hint>
      <section className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--a-dim)]">Menu</h4>
        {!nav ? (
          <Note className="mt-2">The site shows its coded menu. {canEdit ? <button type="button" className="font-semibold underline" onClick={() => set("nav", structuredClone(CODED_SETTINGS.nav))} data-edit-nav="">Edit the menu</button> : null}</Note>
        ) : (
          <>
            <p className="mb-1 mt-2 text-xs font-medium text-[var(--a-text2)]">Top links (1–6)</p>
            <LinkRows links={nav.top} at="nav.top" maxLinks={6} labelMax={24} errors={errors} disabled={!canEdit} onChange={(v) => set("nav.top", v)} />
            <p className="mb-1 mt-3 text-xs font-medium text-[var(--a-text2)]">Menu groups (1–4, up to 12 links each)</p>
            <Groups groups={nav.menu} at="nav.menu" maxGroups={4} maxLinks={12} errors={errors} disabled={!canEdit} noun="group" onChange={(v) => set("nav.menu", v)} />
            {canEdit ? <button type="button" className="mt-2 text-xs underline text-[var(--a-dim)]" onClick={() => set("nav", undefined)}>Go back to the coded menu</button> : null}
          </>
        )}
      </section>
      <section className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--a-dim)]">Footer</h4>
        {!footer ? (
          <Note className="mt-2">The site shows its coded footer. {canEdit ? <button type="button" className="font-semibold underline" onClick={() => set("footer", structuredClone(CODED_SETTINGS.footer))} data-edit-footer="">Edit the footer</button> : null}</Note>
        ) : (
          <>
            <TextField id="ss-tagline" label="Tagline" max={80} value={footer.tagline ?? ""} disabled={!canEdit} error={errors["footer.tagline"]} onChange={(v) => set("footer.tagline", v === "" ? undefined : v)} />
            <p className="mb-1 mt-3 text-xs font-medium text-[var(--a-text2)]">Columns (1–4, up to 6 links each)</p>
            <Groups groups={footer.columns} at="footer.columns" maxGroups={4} maxLinks={6} errors={errors} disabled={!canEdit} noun="column" onChange={(v) => set("footer.columns", v)} />
            {canEdit ? <button type="button" className="mt-2 text-xs underline text-[var(--a-dim)]" onClick={() => set("footer", undefined)}>Go back to the coded footer</button> : null}
          </>
        )}
      </section>
    </div>
  );
}
