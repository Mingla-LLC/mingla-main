// #4452 §7.4 Own page tab: "Give it its own page", the link (max 32, old links
// keep working), headline 28, italic ending 24, lead 160, background, "Show in
// Google search" and the old links list.
import { ExternalLink } from "lucide-react";
import { Select } from "../ui/Input";
import { LimitedText, Panel, ToggleRow } from "./formsUi";
import { OWN_LIMITS, slugProblem, slugify } from "../../lib/formsModel";

const SITE = "https://usemingla.com";

export function OwnPageTab({ def, edit, canEdit, form, meta }) {
  const own = def.own_page || { on: false, index: false, bg: "night" };
  const set = (patch) => edit({ ...def, own_page: { ...own, ...patch } });
  const problem = own.on ? slugProblem(own.slug || "") : null;
  const current = meta?.own_page?.current_slug;
  const old = meta?.own_page?.old_slugs || [];
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-ownpage-tab="">
      <Panel>
        <div className="flex flex-col gap-3">
          <ToggleRow title="Give it its own page" hint="A page in the /schedule layout with just this form." checked={Boolean(own.on)} disabled={!canEdit}
            onChange={(v) => set({ on: v, slug: own.slug || slugify(form.key || form.name) })} />
          {own.on && (
            <>
              <label className="block">
                <span className="mb-1.5 flex justify-between text-[12.5px] font-semibold text-[var(--a-text2)]"><span>Link</span><span className="font-mono text-[11px] font-medium text-[var(--a-dim)]">{(own.slug || "").length}/{OWN_LIMITS.slug}</span></span>
                <span className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap text-sm text-[var(--color-text-tertiary)]">usemingla.com/apply/</span>
                  <input value={own.slug || ""} maxLength={OWN_LIMITS.slug} disabled={!canEdit} aria-invalid={problem ? true : undefined}
                    onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-[var(--a-line)] bg-[var(--color-background-primary)] px-3 text-sm outline-none focus:border-[var(--a-text)]" />
                </span>
                <span className={`mt-1 block text-xs ${problem ? "text-[#b91c1c]" : "text-[var(--color-text-tertiary)]"}`}>{problem || "Lowercase letters, numbers and dashes. Changing it later keeps the old link working."}</span>
              </label>
              <LimitedText label="Headline" value={own.h} limit={OWN_LIMITS.h} disabled={!canEdit} onChange={(v) => set({ h: v })} />
              <LimitedText label="Italic ending" value={own.em} limit={OWN_LIMITS.em} disabled={!canEdit} onChange={(v) => set({ em: v })} />
              <LimitedText label="Lead" value={own.lead} limit={OWN_LIMITS.lead} disabled={!canEdit} multiline onChange={(v) => set({ lead: v })} />
              <Select label="Background" value={own.bg || "night"} disabled={!canEdit} onChange={(e) => set({ bg: e.target.value })}
                options={[{ value: "night", label: "Night" }, { value: "moss", label: "Moss" }, { value: "clay", label: "Clay" }, { value: "paper", label: "Paper" }]} />
              <ToggleRow title="Show in Google search" hint="Off for ad-only pages." checked={Boolean(own.index)} disabled={!canEdit} onChange={(v) => set({ index: v })} />
            </>
          )}
        </div>
      </Panel>
      <Panel title="Where it is used">
        {own.on ? (
          <div className="flex flex-col gap-2 text-sm">
            <span className="w-fit rounded-full bg-[var(--a-soft)] px-2 py-0.5 text-[var(--a-text2)]">usemingla.com/apply/{own.slug}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">Listed under Form pages in Website pages. Any button can point here with "Goes to: Form page". It goes live when you publish.</span>
            {current && <a className="inline-flex w-fit items-center gap-1 font-medium text-[var(--a-chip-ink)] hover:underline" href={`${SITE}/apply/${current}`} target="_blank" rel="noopener noreferrer">See the page <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>}
            {old.length > 0 && (
              <div data-old-links="">
                <p className="mt-2 text-xs font-semibold text-[var(--a-text2)]">Old links still work:</p>
                <ul className="text-xs text-[var(--color-text-tertiary)]">{old.map((s) => <li key={s}>/apply/{s} → /apply/{current || own.slug}</li>)}</ul>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-[var(--color-text-tertiary)]">Switch it on to get a link for ads, bios and buttons.</p>}
      </Panel>
    </div>
  );
}
