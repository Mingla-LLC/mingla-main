// #4452 §7.4 Publish tab (design publishTab / checks()): the five checks, each
// ✓ or !, plus every R / F error listed by field; "Publish version <n>" is
// disabled while anything fails ("Fix the items marked ! to publish."). The
// server runs the same checks again and refuses with the list (22023
// publish_check_failed), which is shown the same way.
import { useState } from "react";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import { Panel } from "./formsUi";
import { serverCheckLines } from "../../lib/formsModel";
import { formsErrorWords, publishForm, siteRefreshWarning } from "../../services/formsService";

export function PublishTab({ form, def, flow, review, canEdit, meta, rev, dirty, flush, reload }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [serverLines, setServerLines] = useState([]);
  const next = (meta?.versions || 0) + 1;
  const publish = async () => {
    setBusy(true);
    setServerLines([]);
    try {
      if (dirty) await flush();
      const { result: res, refreshed } = await publishForm(form.id, rev);
      if (refreshed) addToast({ variant: "success", title: `Published version ${res.version}. It updates everywhere it already shows.` });
      else siteRefreshWarning(addToast, `Published version ${res.version}.`);
      await reload();
    } catch (e) {
      if (/publish_check_failed/.test(e.message || "")) setServerLines(serverCheckLines(e.detail, def, flow));
      addToast({ variant: "error", title: formsErrorWords(e) });
    } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-publish-tab="">
      <Panel>
        <ul className="flex flex-col gap-2" data-publish-checks="">
          {review.checks.map((c) => (
            <li key={c.id} data-check={c.id} data-ok={c.ok ? "yes" : "no"} className="flex items-start gap-3">
              <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${c.ok ? "bg-[var(--a-live-bg)] text-[var(--a-live-ink)]" : "bg-[var(--a-stop-bg)] text-[var(--a-stop-ink)]"}`}>{c.ok ? "✓" : "!"}</span>
              <span className="text-sm"><span className="sr-only">{c.ok ? "Passes: " : "Needs fixing: "}</span>{c.title}<small className="block text-xs text-[var(--color-text-tertiary)]">{c.detail}</small></span>
            </li>
          ))}
          {review.errors.map((e, i) => (
            <li key={`e${i}`} data-check-error={e.code} className="flex items-start gap-3">
              <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--a-stop-bg)] text-xs font-bold text-[var(--a-stop-ink)]">!</span>
              <span className="text-sm"><span className="sr-only">Needs fixing: </span>{e.line}</span>
            </li>
          ))}
          {serverLines.map((l, i) => (
            <li key={`s${i}`} className="flex items-start gap-3 text-sm text-[#991b1b]"><span aria-hidden="true">!</span> {l}</li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <div className="flex flex-col gap-3">
          <p className="text-[15px] font-semibold">Publish version {next}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">Publishing the form updates it everywhere it already shows. To show it somewhere new, use the page editor.</p>
          <Button onClick={publish} loading={busy} disabled={!canEdit || !review.ok} data-publish-button="">Publish version {next}</Button>
          {!review.ok && <p className="text-xs text-[var(--a-stop-ink)]">Fix the items marked ! to publish.</p>}
        </div>
      </Panel>
    </div>
  );
}
