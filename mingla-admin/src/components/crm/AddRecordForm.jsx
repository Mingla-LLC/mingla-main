import { useId, useMemo, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, Field, Select } from "./fields";
import { OwnersField } from "./OwnersField";
import { displayOwners, findDuplicates, stageLabel } from "../../lib/crmModel";
import { newRequestKey } from "../../services/crmService";

/**
 * The add form (shown in the drawer at ?card=new). Only the name is required;
 * a new record always starts in the pipeline's first stage. While the name is
 * typed, records already in the pipeline that look like it are shown with a
 * way to open them, and an exact match cannot be submitted.
 */
export function AddRecordForm({
  pipeline,
  def,
  config,
  records,
  defaults,
  disabled = false,
  onCreate,
  onOpenExisting,
  onCancel,
}) {
  const isHosts = pipeline === "hosts";
  const singular = def.singular;
  const first = def.stages[0];
  const id = useId();
  const nameRef = useRef(null);
  const [values, setValues] = useState(() => ({
    name: "",
    icp: defaults?.icp || "",
    region_id: defaults?.regionId || "",
    owners: defaults?.me ? [defaults.me] : [],
    contact: "",
    channel: "",
    source: "",
    next_action: "",
    due_on: "",
    followers: "",
    agreement: "",
    rate: "",
  }));
  const [error, setError] = useState("");
  const [serverDuplicate, setServerDuplicate] = useState(null);
  const [busy, setBusy] = useState(false);
  // Same key for the same form contents: a second press, or a retry after a
  // dropped connection, cannot add the record twice.
  const keyRef = useRef(newRequestKey());

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setValues((v) => ({ ...v, [key]: value }));
    keyRef.current = newRequestKey();
    if (error) setError("");
    if (key === "name") setServerDuplicate(null);
  };

  const name = values.name.trim();
  const dupes = useMemo(
    () => (name.length >= 3 ? findDuplicates(records, name) : { exact: null, similar: [] }),
    [records, name]
  );
  const exact = serverDuplicate || dupes.exact;
  const lookalikes = exact ? [exact] : dupes.similar;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || disabled) return;
    if (!name) {
      setError("Add a name first.");
      nameRef.current?.focus();
      return;
    }
    if (exact) {
      nameRef.current?.focus();
      return;
    }
    const followers = values.followers.trim();
    if (!isHosts && followers !== "" && !/^\d{1,9}$/.test(followers)) {
      setError("Followers must be a whole number, 0 or more.");
      return;
    }
    const fields = { name, owners: values.owners };
    for (const key of ["icp", "region_id", "contact", "channel", "source", "next_action", "due_on"]) {
      const v = String(values[key] || "").trim();
      if (v) fields[key] = v;
    }
    if (!isHosts) {
      if (followers !== "") fields.followers = Number(followers);
      if (values.agreement) fields.agreement = values.agreement;
      if (values.rate.trim()) fields.rate = values.rate.trim();
    }
    setError("");
    setBusy(true);
    const result = await onCreate(fields, keyRef.current);
    setBusy(false);
    if (result?.duplicate) {
      setServerDuplicate(result.duplicate);
      nameRef.current?.focus();
    } else if (result?.message) {
      // The form keeps everything that was typed.
      setError(result.message);
    }
  };

  const opt = (list) => (list || []).map((o) => ({ value: o.id, label: o.label }));
  const regionOptions = (config.regions || []).map((r) => ({
    value: r.id,
    label: r.is_live ? r.name : `${r.name} (not live yet)`,
  }));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          htmlFor={`${id}-name`}
          full
          error={error === "Add a name first." ? error : ""}
        >
          <input
            id={`${id}-name`}
            ref={nameRef}
            type="text"
            autoFocus
            required
            maxLength={160}
            value={values.name}
            disabled={disabled || busy}
            onChange={set("name")}
            aria-describedby={lookalikes.length ? `${id}-dupes` : undefined}
            placeholder={isHosts ? "Venue or organizer name" : "@handle"}
            className={CONTROL_CLASS}
          />
          {lookalikes.length > 0 && (
            <div
              id={`${id}-dupes`}
              role="status"
              className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--color-warning-500)] bg-[var(--color-warning-50)] p-2.5 text-sm text-[var(--color-warning-700)]"
            >
              {exact && <p className="font-semibold">That name is already in {def.label}. Open it instead.</p>}
              {lookalikes.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    Already in the pipeline: <b>{r.name}</b> ({stageLabel(def, r.stage)},{" "}
                    {displayOwners(r, config.team)}).
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="max-sm:h-11"
                    onClick={() => onOpenExisting(r.id)}
                  >
                    Open it
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Field>
        <Field label="ICP" htmlFor={`${id}-icp`}>
          <Select id={`${id}-icp`} value={values.icp} disabled={disabled || busy} placeholder="Pick later" options={opt(def.icps)} onChange={set("icp")} />
        </Field>
        <Field label="Region" htmlFor={`${id}-region`}>
          <Select id={`${id}-region`} value={values.region_id} disabled={disabled || busy} placeholder="Pick later" options={regionOptions} onChange={set("region_id")} />
        </Field>
        <OwnersField
          labelId={`${id}-owners`}
          team={config.team}
          value={values.owners}
          disabled={disabled || busy}
          onChange={set("owners")}
        />
        <Field label={isHosts ? "Contact" : "Handle and reach"} htmlFor={`${id}-contact`} full>
          <input id={`${id}-contact`} type="text" maxLength={300} value={values.contact} disabled={disabled || busy} onChange={set("contact")} placeholder="Who to talk to" className={CONTROL_CLASS} />
        </Field>
        <Field label="Channel" htmlFor={`${id}-channel`}>
          <Select id={`${id}-channel`} value={values.channel} disabled={disabled || busy} placeholder="Pick later" options={opt(config.channels)} onChange={set("channel")} />
        </Field>
        <Field label="Source" htmlFor={`${id}-source`}>
          <Select id={`${id}-source`} value={values.source} disabled={disabled || busy} placeholder="Pick later" options={opt(config.sources)} onChange={set("source")} />
        </Field>
        <Field label="Next action" htmlFor={`${id}-next`}>
          <input id={`${id}-next`} type="text" maxLength={200} value={values.next_action} disabled={disabled || busy} onChange={set("next_action")} placeholder="What happens next" className={CONTROL_CLASS} />
        </Field>
        <Field label="Due" htmlFor={`${id}-due`}>
          <input id={`${id}-due`} type="date" value={values.due_on} disabled={disabled || busy} onChange={set("due_on")} className={CONTROL_CLASS} />
        </Field>
        {!isHosts && (
          <>
            <Field label="Followers" htmlFor={`${id}-followers`}>
              <input id={`${id}-followers`} type="text" inputMode="numeric" maxLength={9} value={values.followers} disabled={disabled || busy} onChange={set("followers")} placeholder="For example 12000" className={CONTROL_CLASS} />
            </Field>
            <Field label="Agreement" htmlFor={`${id}-agreement`}>
              <Select id={`${id}-agreement`} value={values.agreement} disabled={disabled || busy} placeholder="Pick later" options={opt(config.agreements)} onChange={set("agreement")} />
            </Field>
            <Field label="Rate" htmlFor={`${id}-rate`} full>
              <input id={`${id}-rate`} type="text" maxLength={120} value={values.rate} disabled={disabled || busy} onChange={set("rate")} placeholder="What they charge, in their words" className={CONTROL_CLASS} />
            </Field>
          </>
        )}
      </div>
      {error && error !== "Add a name first." && (
        <p role="alert" className="text-sm text-[var(--color-error-700)]">
          {error}
        </p>
      )}
      {disabled && (
        <p className="text-sm text-[var(--color-warning-700)]">
          You&apos;re offline. What you typed is kept here; add it once you&apos;re back.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={busy} disabled={disabled || !!exact}>
          Add {singular}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">
        Only the name is required. It starts in {first.label}.
      </p>
    </form>
  );
}
