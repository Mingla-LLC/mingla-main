// #4541 R7.1 — Forms support for one brand (Admin, read only, plus the daily
// limit of Unknown Blast replies).
//
// Counts, statuses, failures and switches from `admin_brand_forms_support`
// (admins and support staff; anyone else is refused by the server). No answer
// content and no guest contacts are ever read or shown (spec §24 item D).
// States: loading, error with retry, no forms, data. Shown on a brand's detail
// in the Brands console.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { LoadError } from "../components/ui/LoadError";
import { Spinner } from "../components/ui/Spinner";
import {
  brandFormsSupportView,
  parseOpenReplyLimit,
  sendLine,
  supportErrorMessage,
} from "../lib/brandFormsSupport";

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[var(--a-line)] last:border-b-0">
    <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
    <span className="text-sm font-medium tabular-nums text-[var(--color-text-primary)]">{value}</span>
  </div>
);

function LimitEditor({ form, onSaved }) {
  const [value, setValue] = useState(String(form.openReplyLimitPerDay));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const save = async () => {
    const limit = parseOpenReplyLimit(value);
    if (limit === null) {
      setMessage("The limit must be a whole number from 0 to 5000.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc("admin_brand_form_set_open_reply_limit", { p_form_id: form.id, p_limit: limit });
    setSaving(false);
    if (error) {
      setMessage(supportErrorMessage(error));
      return;
    }
    setMessage("Saved.");
    onSaved();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <label className="text-sm text-[var(--color-text-secondary)]" htmlFor={`open-limit-${form.id}`}>
        Unknown replies a day
      </label>
      <input
        id={`open-limit-${form.id}`}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-24 rounded-lg border border-[var(--a-line)] bg-[var(--color-background-primary)] px-2 py-1 text-sm text-[var(--color-text-primary)]"
      />
      <Button variant="secondary" size="sm" loading={saving} onClick={save}>
        Save
      </Button>
      {message && <span role="status" className="text-xs text-[var(--color-text-tertiary)]">{message}</span>}
    </div>
  );
}

async function fetchSupportView(brandId) {
  const { data, error } = await supabase.rpc("admin_brand_forms_support", { p_brand_id: brandId });
  if (error) return { view: null, error: supportErrorMessage(error) };
  try {
    return { view: brandFormsSupportView(data), error: null };
  } catch (shapeError) {
    console.error("[forms-support] unreadable reply", shapeError);
    return { view: null, error: supportErrorMessage(shapeError) };
  }
}

export function BrandFormsSupportPage({ brandId }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!brandId) return undefined;
    let live = true;
    fetchSupportView(brandId).then((result) => {
      if (!live) return;
      setView(result.view);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [brandId, nonce]);

  const load = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  let body;
  if (loading && view === null) {
    body = (
      <div className="flex justify-center py-6" aria-label="Loading forms support">
        <Spinner />
      </div>
    );
  } else if (error) {
    body = <LoadError title="Couldn't load forms support" message={error} onRetry={load} retrying={loading} />;
  } else if (view === null || view.forms.length === 0) {
    body = <p className="text-sm text-[var(--color-text-secondary)]">This brand has no forms.</p>;
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <div>
          <h4 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Switches</h4>
          {view.switches.map((s) => (
            <Row key={s.key} label={s.label} value={s.value} />
          ))}
          <Row label="Form-ready apps" value={view.formReadyShare.replace("Form-ready app share (14 days): ", "")} />
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Forms</h4>
          {view.forms.map((f) => (
            <div key={f.id} className="mb-3 rounded-xl border border-[var(--a-line)] p-3">
              <div className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">{f.name}</div>
              <Row label="Status" value={`${f.status} · ${f.liveVersion}`} />
              <Row label="Door staff see full answers" value={f.doorFullAnswers} />
              <Row label="Invited door staff too" value={f.doorFullAnswersInvited} />
              <Row label="Blast replies (known · Unknown · hidden)" value={`${f.blastKnown} · ${f.blastUnknown} · ${f.hidden}`} />
              <LimitEditor form={f} onSaved={load} />
            </div>
          ))}
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Pages</h4>
          {view.pages.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No form is on a page.</p>
          ) : (
            view.pages.map((p) => (
              <Row
                key={`${p.eventId}-${p.formId}`}
                label={`${p.eventTitle} · ${p.mode}${p.autoRemind === "On" ? " · auto reminder" : ""}`}
                value={`${p.answered} answered · ${p.toAnswer} to answer · ${p.notAsked} not asked`}
              />
            ))
          )}
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Form requests, last 30 days</h4>
          {view.sends.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No form requests sent.</p>
          ) : (
            view.sends.map((r) => <Row key={`${r.status}-${r.reason ?? "none"}`} label={sendLine(r)} value="" />)
          )}
        </div>
        <div>
          <h4 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Failures</h4>
          <Row
            label="Checkout answers not saved to their order"
            value={view.stuckCheckout.count > 0 ? `${view.stuckCheckout.count} (oldest ${view.stuckCheckout.oldest ?? "unknown"})` : "0"}
          />
          <Row label="Full answers opened at the door, last 7 days" value={String(view.doorReads7d)} />
        </div>
      </div>
    );
  }

  return (
    <SectionCard title="Forms support" subtitle="Counts and switches only. Answers and guest contacts are never shown here.">
      {body}
    </SectionCard>
  );
}

export default BrandFormsSupportPage;
