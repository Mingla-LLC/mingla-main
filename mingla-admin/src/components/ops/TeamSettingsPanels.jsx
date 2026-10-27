// Issue #4130 (Wave 1) — the Team dashboard's one-time settings, moved out of
// the dashboard (it is about how the pipelines move, not configuration).
// Settings renders them (Wave 4b): AutomaticSteps (the owner's switches for
// the steps Mingla makes by itself and who owns marketing steps),
// BrandCardsBackfill ("Brands without a host card") and NextStepsToCards
// ("Turn next steps into cards"). Each shows nothing to someone who cannot
// change it; the server refuses them as well.
import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { PeopleField } from "../people/PeopleField";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { useOpsPoll } from "../../hooks/useOpsWork";
import * as ops from "../../services/opsService";
import {
  BRAND_CONFIRM_MAX, BRAND_PAGE_SIZE, brandActionChip, brandDecidedWords, brandDefaultPicked, brandFirstPicked, brandMergePage, brandMoreCount, brandNextCursor, brandResultWords,
  brandSelectable, brandShownWords, brandTogglePick, opsErrorWords, requestKey,
} from "../../lib/opsModel";
import { OpsChip } from "./OpsChip";
import { NextStepsToCards } from "./TeamOpsPanels";

export { NextStepsToCards };

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

// #3980 (R2, R4) — the owner's switches for the steps Mingla makes by itself
// and the host cards it makes for new brands, and who owns marketing steps.
// Off until the owner switches them on; turning one off stops new cards.
export function AutomaticSteps({ online }) {
  const { access } = useAuth();
  const { addToast } = useToast();
  const people = usePeopleDirectory();
  const read = useOpsPoll(() => ops.fetchOpsSettings(), { key: `${access?.email || ""}|ops-settings`, intervalMs: 0 });
  const [busy, setBusy] = useState("");
  const settings = read.data;
  if (!settings?.can_edit) return null;
  const set = async (key, value, words) => {
    setBusy(key);
    try { await ops.setOpsSetting(key, value); await read.refetch({ quiet: true }); addToast({ variant: "success", title: words }); }
    catch (error) { addToast({ variant: "error", title: "Not changed", description: opsErrorWords(error) }); }
    finally { setBusy(""); }
  };
  // A real switch (a track and a thumb), not a checkbox: role="switch" with
  // aria-checked, the whole row is the touch target.
  const switchRow = (id, label, on) => (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg px-1 py-1">
      <label htmlFor={id} id={`${id}-label`} className="min-w-0 cursor-pointer break-normal text-[13.5px] text-[var(--color-text-primary)]">{label}</label>
      <button id={id} type="button" role="switch" aria-checked={!!on} aria-labelledby={`${id}-label`} disabled={!online || !!busy}
        onClick={() => set(id === "switch-auto-steps" ? "auto_steps" : "brand_auto_cards", !on, !on ? "Switched on." : "Switched off. Cards already made stay.")}
        className={`group inline-grid min-h-11 min-w-14 shrink-0 cursor-pointer place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}>
        <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full transition-colors ${on ? "bg-[var(--color-brand-800)]" : "bg-[var(--gray-300)]"}`}>
          <span className={`absolute top-0.5 block h-5 w-5 rounded-full bg-[var(--color-background-primary)] shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
        </span>
      </button>
    </div>
  );
  return (
    <section aria-labelledby="automatic-steps-heading" className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <h3 id="automatic-steps-heading" className="border-b border-[var(--gray-200)] px-4 py-3.5 text-[15px] font-semibold text-[var(--color-text-primary)] sm:px-5">Automatic steps</h3>
      <div className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:px-5">
        {switchRow("switch-auto-steps", "Make steps from every host’s events", settings.auto_steps)}
        {switchRow("switch-brand-cards", "Make a host card for every new brand", settings.brand_auto_cards)}
        <div className="max-w-md">
          <PeopleField id="marketing-owner" label="Marketing owner" max={1} value={settings.marketing_owner?.email ? [settings.marketing_owner.email] : []}
            team={people.people} me={people.me} suggested={[people.me].filter(Boolean)} disabled={!online || !!busy}
            onChange={(next) => set("marketing_owner", next[0] || null, next[0] ? "Marketing owner saved." : "No marketing owner: marketing steps go to the host's owners.")} />
        </div>
        <p className="break-normal text-[12.5px] text-[var(--color-text-tertiary)]">Off until you switch it on. Turning it off stops new cards; cards already made stay.</p>
        <p className="break-normal text-[12.5px] text-[var(--color-text-tertiary)]">Engineering follow-through (merged but not live, release records, live checks) starts from the moment you first switch on automatic steps{settings.follow_through_since ? ` (that was ${new Date(settings.follow_through_since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })})` : ""}. Earlier merges and issues only show their status.</p>
      </div>
    </section>
  );
}
// #3980 Wave 4 (P3) — "Brands without a host card". The owner previews what
// brand auto-link would do for every brand that has no host card (nothing is
// written), ticks the brands to act on and confirms. The server runs the same
// brand auto-link for exactly those brands, once per confirm.
// Opening the page reads only the count; the preview runs on Preview, a page
// of 50 at a time, and never more than 100 brands are ticked (one confirm's
// limit).
export function BrandCardsBackfill({ online }) {
  const { access } = useAuth();
  const settingsRead = useOpsPoll(() => ops.fetchOpsSettings(), { key: `${access?.email || ""}|ops-settings`, intervalMs: 0 });
  const canEdit = !!settingsRead.data?.can_edit;
  const [count, setCount] = useState(null);
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState([]);
  const [state, setState] = useState("idle");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmKey, setConfirmKey] = useState(null);
  useEffect(() => {
    if (!canEdit) return undefined;
    let live = true;
    ops.countBrandCards().then((answer) => { if (live) setCount(Number(answer?.total ?? 0)); }).catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [canEdit]);
  if (!canEdit) return null;
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const chosen = picked.filter((id) => rows.some((r) => r.brand_id === id && brandSelectable(r)));
  const atCap = chosen.length >= BRAND_CONFIRM_MAX;
  const next = brandNextCursor(preview);
  const more = !!preview?.page?.more && !!next;
  const load = async () => {
    setState("loading"); setError(null); setResult(null);
    try {
      const answer = await ops.previewBrandCards();
      setPreview(answer);
      setCount(Number(answer?.totals?.total ?? 0));
      setPicked(brandDefaultPicked(answer?.rows));
      setState("preview");
    } catch (e) { setError(e); setState("idle"); }
  };
  const loadMore = async () => {
    if (!preview || !next) return;
    setState("more"); setError(null);
    try {
      // Read right after the last brand shown, never by how many are shown:
      // brands that gain a card meanwhile cannot make a brand be skipped.
      const answer = await ops.previewBrandCardsPage(next, BRAND_PAGE_SIZE);
      const { preview: merged, added } = brandMergePage(preview, answer);
      setPreview(merged);
      setCount(Number(answer?.totals?.total ?? 0));
      setPicked([...chosen, ...brandDefaultPicked(added, BRAND_CONFIRM_MAX - chosen.length)]);
      setState("preview");
    } catch (e) { setError(e); setState("preview"); }
  };
  const confirm = async () => {
    if (state !== "confirm" || chosen.length === 0) return;
    setState("working"); setError(null);
    try {
      const answer = await ops.confirmBrandCards(chosen, confirmKey);
      setResult(answer);
      setConfirmKey(null);
      const fresh = await ops.previewBrandCards();
      setPreview(fresh); setCount(Number(fresh?.totals?.total ?? 0)); setPicked([]);
      setState("preview");
    } catch (e) { setError(e); setState("confirm"); }
  };
  const busy = state === "working" || state === "loading" || state === "more";
  return (
    <section aria-labelledby="brand-cards-heading" className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
      <h3 id="brand-cards-heading" className="border-b border-[var(--gray-200)] px-4 py-3.5 text-[15px] font-semibold text-[var(--color-text-primary)] sm:px-5">
        Brands without a host card{count !== null ? ` (${count})` : ""}
      </h3>
      <div className="grid min-w-0 grid-cols-1 gap-4 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="break-normal text-[13px] text-[var(--color-text-secondary)]">Brands on Mingla with no host card yet. Preview shows what Mingla would do for each: link the one card with exactly its email, handle or phone, add a new card, or leave it for a person to pick. A brand a person already decided about is left as it is. Nothing changes until you confirm.</p>
          {error && <p role="alert" className="break-words text-[13px] text-[var(--color-error-700)]">{opsErrorWords(error)}</p>}
          {result && <p role="status" className="break-normal text-[13px] font-semibold text-[var(--color-text-primary)]">{brandResultWords(result)}</p>}
          {preview && (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <OpsChip tone="success">{rows.filter((r) => r.action === "link" && !r.decided).length} link</OpsChip>
              <OpsChip tone="info">{rows.filter((r) => r.action === "create" && !r.decided).length} add card</OpsChip>
              <OpsChip tone="warning">{rows.filter((r) => (r.action === "pick" || r.action === "reopen") && !r.decided).length} for a person</OpsChip>
              {rows.some((r) => r.decided) && <OpsChip tone="default">{rows.filter((r) => r.decided).length} decided</OpsChip>}
            </div>
          )}
          {preview && rows.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <p role="status" className="break-normal text-[13px] text-[var(--color-text-secondary)]">
                {brandShownWords({ chosen: chosen.length, shown: rows.length, more, left: preview?.page?.left })}{atCap ? ` One confirm takes at most ${BRAND_CONFIRM_MAX}.` : ""}
              </p>
              <span className="flex flex-wrap gap-2">
                <Button variant="ghost" className="min-h-11" disabled={busy || chosen.length === 0} onClick={() => setPicked([])}>Select none</Button>
                <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setPicked(brandFirstPicked(rows))}>First {BRAND_CONFIRM_MAX}</Button>
              </span>
            </div>
          )}
          {state === "confirm" || state === "working" ? (
            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] p-3">
              <p className="break-normal text-[13px] text-[var(--color-warning-700)]">Act on {chosen.length} {chosen.length === 1 ? "brand" : "brands"} now? Each is checked again first; links and new cards are logged on the host card.</p>
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11" disabled={!online || state === "working" || chosen.length === 0} onClick={confirm}>{state === "working" ? "Working…" : `Yes, confirm ${chosen.length}`}</Button>
                <Button variant="ghost" className="min-h-11" disabled={state === "working"} onClick={() => setState("preview")}>Not yet</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-11" disabled={!online || busy} onClick={load}>{state === "loading" ? "Loading…" : preview ? "Preview again" : "Preview"}</Button>
              {preview && <Button className="min-h-11" disabled={!online || busy || chosen.length === 0} onClick={() => { setConfirmKey(requestKey("brand_cards")); setState("confirm"); }}>Confirm selected ({chosen.length})</Button>}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          {!preview ? (
            <p className="break-normal text-[13px] text-[var(--color-text-tertiary)]">Press Preview to see each brand, what would happen and the matching card.</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Every brand has a host card.</p>
          ) : (
            <ul className="flex max-h-[440px] min-w-0 flex-col divide-y divide-[var(--gray-100)] overflow-y-auto rounded-lg border border-[var(--gray-200)]">
              {rows.map((r) => {
                const chip = brandActionChip(r.action);
                const can = brandSelectable(r);
                const on = can && picked.includes(r.brand_id);
                return (
                  <li key={r.brand_id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 px-3 py-2">
                    <label className="-my-2 -ml-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                      <input type="checkbox" className="h-5 w-5" disabled={!can || state === "working" || (!on && atCap)} checked={on}
                        aria-label={`${r.decided ? "Decided" : chip.label}: ${r.name}`}
                        onChange={(e) => setPicked(brandTogglePick(chosen, r.brand_id, e.target.checked))} />
                    </label>
                    <span className="min-w-0">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 break-normal text-[13px] font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{r.name}</span>
                        {r.decided ? <OpsChip tone="default">Decided</OpsChip> : <OpsChip tone={chip.tone}>{chip.label}</OpsChip>}
                      </span>
                      {r.decided ? (
                        <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{brandDecidedWords(r.decided)}. Mingla leaves this brand as it is.</span>
                      ) : (
                        <span className="block break-words text-[12px] text-[var(--color-text-secondary)]">{r.words}</span>
                      )}
                      {r.open_card && <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">A card already asks a person: {r.open_card.title}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {preview && more && (
            <Button variant="secondary" className="min-h-11 self-start" disabled={!online || busy} onClick={loadMore}>
              {state === "more" ? "Loading…" : `Show ${brandMoreCount(preview, BRAND_PAGE_SIZE)} more`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** All three, in the order the old Team dashboard showed them. */
export function TeamAutomationSettings({ online }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AutomaticSteps online={online} />
      <BrandCardsBackfill online={online} />
      <NextStepsToCards online={online} />
    </div>
  );
}
