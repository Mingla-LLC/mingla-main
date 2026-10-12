import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { CONTROL_CLASS, Field, Select } from "./fields";
import { OwnersField } from "./OwnersField";
import { MinglaLinkField } from "./MinglaLinkField";
import { LogForm } from "./LogForm";
import { ActivityLog } from "./ActivityLog";
import {
  MOVE_BLOCK_COPY,
  clockTime,
  errorWords,
  nextStage,
  stageDef,
  stageNeedsSignedAgreement,
  terminalStage,
} from "../../lib/crmModel";
import { getRecord } from "../../services/crmService";

/**
 * Everything about one host or creator. Each field saves by itself when it
 * changes (selects, date, owners) or when focus leaves it (text); the header
 * shows "Saving…", then "Saved · time", or "Not saved" with "Try again". A
 * failed save keeps what was typed.
 */
export function RecordDrawer({
  pipeline,
  def,
  config,
  recordId,
  listRecord,
  pipe,
  online,
  canDelete,
  focusField,
  activityTick,
  suspended,
  onClose,
  onRequestMove,
  onDelete,
  onOpenCard,
}) {
  const { addToast } = useToast();
  const uid = useId();
  const fid = (key) => `${uid}-${key}`;
  const [detail, setDetail] = useState({ id: null, status: "loading", data: null, message: "" });
  const [reloadTick, setReloadTick] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [savingCount, setSavingCount] = useState(0);
  const [savedAt, setSavedAt] = useState("");
  const [failed, setFailed] = useState(null);
  const [nameNote, setNameNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The page gives each card its own `key`, so a different card starts clean.

  const { applyRecord } = pipe;
  useEffect(() => {
    let live = true;
    setDetail((d) => (d.id === recordId && d.status === "ready" ? d : { id: recordId, status: "loading", data: null, message: "" }));
    getRecord(recordId).then(
      (data) => {
        if (!live) return;
        if (!data?.record || data.record.pipeline !== pipeline) {
          setDetail({ id: recordId, status: "missing", data: null, message: "" });
          return;
        }
        applyRecord(data.record);
        setDetail({ id: recordId, status: "ready", data, message: "" });
      },
      (err) => {
        if (!live) return;
        if (err?.token === "not_found") {
          setDetail({ id: recordId, status: "missing", data: null, message: "" });
        } else {
          // A refresh that failed keeps the card that is already on screen.
          setDetail((d) =>
            d.id === recordId && d.status === "ready" ? d : { id: recordId, status: "error", data: null, message: errorWords(err) }
          );
        }
      }
    );
    return () => {
      live = false;
    };
  }, [recordId, pipeline, reloadTick, activityTick, applyRecord]);

  const current = detail.id === recordId ? detail : { status: "loading", data: null, message: "" };
  const record = listRecord || current.data?.record || null;
  const locked = !online;

  useEffect(() => {
    if (!focusField || !record) return undefined;
    const t = setTimeout(() => document.getElementById(`${uid}-${focusField}`)?.focus(), 60);
    return () => clearTimeout(t);
  }, [focusField, record?.id, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const markMissing = useCallback(() => {
    setDetail({ id: recordId, status: "missing", data: null, message: "" });
    pipe.dropRecord(recordId);
  }, [recordId, pipe]);

  /** Save one field. Returns true when the server took it. */
  const save = useCallback(
    async (key, value) => {
      if (!record) return false;
      setDrafts((d) => ({ ...d, [key]: value }));
      setFailed((f) => (f?.key === key ? null : f));
      setSavingCount((n) => n + 1);
      const before = record;
      try {
        let res;
        if (key === "owners") {
          res = await pipe.setOwners(record.id, value);
        } else {
          let sent = value === "" ? null : value;
          if (key === "followers" && sent !== null) sent = Number(sent);
          res = await pipe.update(record.id, { [key]: sent });
        }
        if (!mounted.current) return true;
        setDrafts((d) => {
          if (d[key] !== value) return d;
          const next = { ...d };
          delete next[key];
          return next;
        });
        setSavedAt(clockTime());
        if (key === "brand_id" || key === "place_pool_id") {
          if (res.moved_to === "live") {
            addToast({ variant: "success", title: `Linked. ${res.record.name} moved to Live.` });
          } else if (res.moved_to === "onboarded" && before.stage === "live") {
            addToast({
              variant: "warning",
              title: `${res.record.name} moved back to Onboarded`,
              description: "It is no longer linked to a brand with a public listing. Live sets itself again once it is.",
            });
          } else if (res.moved_to === "onboarded") {
            addToast({ variant: "success", title: `Linked. ${res.record.name} moved to Onboarded.` });
          }
          setReloadTick((n) => n + 1);
        }
        return true;
      } catch (err) {
        if (!mounted.current) return false;
        if (err?.token === "not_found") {
          markMissing();
          return false;
        }
        setFailed({ key, value, message: errorWords(err), existingId: err?.token === "duplicate_name" ? err.detail : "" });
        return false;
      } finally {
        if (mounted.current) setSavingCount((n) => Math.max(0, n - 1));
      }
    },
    [record, pipe, addToast, markMissing]
  );

  const val = (key) => {
    if (Object.hasOwn(drafts, key)) return drafts[key];
    const v = record?.[key];
    return v === null || v === undefined ? "" : String(v);
  };
  const setDraft = (key, value) => {
    setDrafts((d) => ({ ...d, [key]: value }));
    if (failed?.key === key) setFailed(null);
    if (key === "name") setNameNote("");
  };
  const clearDraft = (key) =>
    setDrafts((d) => {
      if (!Object.hasOwn(d, key)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });

  const commitText = (key) => {
    if (!Object.hasOwn(drafts, key) || !record) return;
    let typed = String(drafts[key]).trim();
    if (key === "name") typed = typed.replace(/\s+/g, " ");
    const was = record[key] === null || record[key] === undefined ? "" : String(record[key]);
    if (key === "name" && typed === "") {
      clearDraft("name");
      setNameNote("A name can't be empty, so the old one was kept.");
      return;
    }
    if (key === "followers" && typed !== "" && !/^\d{1,9}$/.test(typed)) {
      setFailed({ key, value: typed, message: "Followers must be a whole number, 0 or more.", local: true });
      return;
    }
    if (typed === was) {
      clearDraft(key);
      return;
    }
    save(key, typed);
  };

  const textProps = (key) => ({
    id: fid(key),
    value: val(key),
    disabled: locked,
    onChange: (e) => setDraft(key, e.target.value),
    onBlur: () => commitText(key),
    onKeyDown: (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
    className: CONTROL_CLASS,
  });
  const selectProps = (key) => ({
    id: fid(key),
    value: val(key),
    disabled: locked,
    onChange: (e) => save(key, e.target.value),
  });
  const fieldError = (key) => (failed?.key === key ? failed.message : "");

  const submitLog = async (entry, requestKey) => {
    try {
      const res = await pipe.log(record.id, entry, requestKey);
      if (mounted.current) {
        setDetail((d) =>
          d.id === recordId && d.data
            ? { ...d, data: { ...d.data, activity: [res.activity, ...(d.data.activity || []).filter((a) => a.id !== res.activity.id)] } }
            : d
        );
        setSavedAt(clockTime());
        addToast({ variant: "success", title: "Added to the log" });
      }
      return { ok: true };
    } catch (err) {
      if (err?.token === "not_found") markMissing();
      return { ok: false, message: errorWords(err), retryable: err?.token === "network" || err?.token === "unknown" };
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    const ok = await onDelete(record);
    if (mounted.current) {
      setDeleting(false);
      if (!ok) setConfirmDelete(false);
    }
  };

  const plural = def.label;
  const singular = def.singular;

  // ── States with no card to show ──────────────────────────────────────────
  if (!record) {
    const title =
      current.status === "missing"
        ? `That ${singular} is no longer here.`
        : current.status === "error"
          ? `Couldn't open this ${singular}`
          : `Opening ${singular}`;
    return (
      <Drawer open onClose={onClose} title={title}>
        {current.status === "loading" && (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
            <Skeleton height={40} />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
            <Skeleton height={72} />
            <Skeleton height={14} width="60%" />
          </div>
        )}
        {current.status === "missing" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              It may have been deleted, or this link is for something that was never in {plural}.
            </p>
            <Button variant="primary" onClick={onClose}>
              Back to {plural}
            </Button>
          </div>
        )}
        {current.status === "error" && (
          <div className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm text-[var(--color-text-secondary)]">{current.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setReloadTick((n) => n + 1)}>
                Try again
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Back to {plural}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    );
  }

  // ── The card ─────────────────────────────────────────────────────────────
  const pending = pipe.pendingIds.has(record.id);
  const next = nextStage(def, record);
  const closing = terminalStage(def);
  const here = stageDef(def, record.stage);
  const isHosts = pipeline === "hosts";
  const keepsAgreement = stageNeedsSignedAgreement(def, record.stage);
  const opt = (list) => (list || []).map((o) => ({ value: o.id, label: o.label }));
  const regionOptions = (config.regions || []).map((r) => ({
    value: r.id,
    label: r.is_live ? r.name : `${r.name} (not live yet)`,
  }));
  if (record.region_id && !regionOptions.some((r) => r.value === record.region_id)) {
    regionOptions.push({ value: record.region_id, label: "A region no longer in the list" });
  }
  const stageOptions = def.stages.map((s) => ({
    value: s.id,
    label: s.label,
    disabled: s.id !== record.stage && (!!s.auto || (!!here?.auto && !s.terminal)),
  }));
  let stageHelp = "";
  if (here?.auto) stageHelp = MOVE_BLOCK_COPY.stage_is_live;
  else if (isHosts) stageHelp = "Live sets itself when the linked brand has a public listing.";
  else if (record.agreement !== "signed" && !here?.terminal) stageHelp = "Booked and Posted need the agreement marked as signed.";

  const saving = savingCount > 0;
  const header = (
    <div className="min-w-0">
      <input
        id={fid("name")}
        aria-label="Name"
        type="text"
        maxLength={160}
        value={val("name")}
        disabled={locked}
        onChange={(e) => setDraft("name", e.target.value)}
        onBlur={() => commitText("name")}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-10 w-full rounded-lg border border-transparent bg-transparent px-2 text-lg font-semibold text-[var(--color-text-primary)] outline-none transition-colors duration-150 hover:border-[var(--gray-300)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="mt-1 flex min-h-8 flex-wrap items-center gap-2 px-2 text-xs" aria-live="polite">
        {saving ? (
          <span className="text-[var(--color-text-tertiary)]">Saving…</span>
        ) : failed ? (
          <>
            <span className="font-semibold text-[var(--color-error-700)]">Not saved</span>
            {!failed.local && (
              <Button variant="secondary" size="sm" disabled={locked} onClick={() => save(failed.key, failed.value)}>
                Try again
              </Button>
            )}
          </>
        ) : savedAt ? (
          <span className="text-[var(--color-success-700)]">Saved · {savedAt}</span>
        ) : (
          <span className="text-[var(--color-text-tertiary)]">Changes save as you make them</span>
        )}
      </div>
      {failed && !saving && (
        <p role="alert" className="px-2 text-xs text-[var(--color-error-700)]">
          {failed.message}{" "}
          {failed.existingId && (
            <button
              type="button"
              className="cursor-pointer font-semibold underline"
              onClick={() => onOpenCard(failed.existingId)}
            >
              Open it
            </button>
          )}
        </p>
      )}
      {nameNote && <p className="px-2 text-xs text-[var(--color-text-tertiary)]">{nameNote}</p>}
    </div>
  );

  const footer = canDelete ? (
    confirmDelete ? (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
        <span className="text-sm text-[var(--color-text-primary)]">Delete for everyone?</span>
        <Button variant="danger" size="sm" className="max-sm:h-10" loading={deleting} disabled={locked} onClick={doDelete}>
          Delete
        </Button>
        <Button variant="ghost" size="sm" className="max-sm:h-10" disabled={deleting} onClick={() => setConfirmDelete(false)}>
          Keep
        </Button>
      </div>
    ) : (
      <Button variant="ghost" size="sm" className="max-sm:h-10" disabled={locked || pending} onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
    )
  ) : closing && record.stage !== closing.id ? (
    <Button
      variant="ghost"
      size="sm"
      className="max-sm:h-10"
      disabled={locked || pending}
      onClick={() => onRequestMove(record, closing.id)}
    >
      Mark as {closing.label.toLowerCase()}
    </Button>
  ) : (
    <p className="text-xs text-[var(--color-text-tertiary)]">Only an owner or admin can delete.</p>
  );

  return (
    <Drawer open onClose={onClose} title={record.name} header={header} footer={footer} suspended={suspended}>
      <div className="flex flex-col gap-5">
        {locked && (
          <p className="rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
            You&apos;re offline. You can read this card, but changes won&apos;t save until you&apos;re back.
          </p>
        )}
        {next && (
          <div>
            <Button
              size="sm"
              className="max-sm:h-10"
              iconRight={ArrowRight}
              disabled={locked || pending}
              onClick={() => onRequestMove(record, next.id)}
            >
              Move to {next.label}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Stage"
            htmlFor={fid("stage")}
            full
            helper={
              record.stage_reason ? (
                <>
                  <span className="block text-[var(--color-text-secondary)]">Reason: {record.stage_reason}</span>
                  {stageHelp}
                </>
              ) : (
                stageHelp
              )
            }
          >
            <Select
              id={fid("stage")}
              value={record.stage}
              disabled={locked || pending}
              options={stageOptions}
              onChange={(e) => onRequestMove(record, e.target.value)}
            />
          </Field>
          <Field label="ICP" htmlFor={fid("icp")} error={fieldError("icp")}>
            <Select {...selectProps("icp")} placeholder="None yet" options={opt(def.icps)} />
          </Field>
          <Field label="Region" htmlFor={fid("region_id")} error={fieldError("region_id")}>
            <Select {...selectProps("region_id")} placeholder="None yet" options={regionOptions} />
          </Field>
          <OwnersField
            labelId={fid("owners")}
            team={config.team}
            value={Object.hasOwn(drafts, "owners") ? drafts.owners : record.owners}
            disabled={locked}
            onChange={(owners) => save("owners", owners)}
          />
          {fieldError("owners") && (
            <p role="alert" className="text-xs text-[var(--color-error-700)] sm:col-span-2">
              {fieldError("owners")}
            </p>
          )}
          <Field label={isHosts ? "Contact" : "Handle and reach"} htmlFor={fid("contact")} full error={fieldError("contact")}>
            <input type="text" maxLength={300} placeholder="Who to talk to" {...textProps("contact")} />
          </Field>
          <Field label="Channel" htmlFor={fid("channel")} error={fieldError("channel")}>
            <Select {...selectProps("channel")} placeholder="None yet" options={opt(config.channels)} />
          </Field>
          <Field label="Source" htmlFor={fid("source")} error={fieldError("source")}>
            <Select {...selectProps("source")} placeholder="None yet" options={opt(config.sources)} />
          </Field>
          <Field label="Next action" htmlFor={fid("next_action")} error={fieldError("next_action")}>
            <input type="text" maxLength={200} placeholder="What happens next" {...textProps("next_action")} />
          </Field>
          <Field label="Due" htmlFor={fid("due_on")} error={fieldError("due_on")}>
            <input
              type="date"
              id={fid("due_on")}
              value={val("due_on")}
              disabled={locked}
              onChange={(e) => save("due_on", e.target.value)}
              className={CONTROL_CLASS}
            />
          </Field>

          {isHosts ? (
            <MinglaLinkField
              record={record}
              links={current.data?.links}
              disabled={locked}
              saving={saving}
              onSave={(changes) => {
                const [key] = Object.keys(changes);
                return save(key, changes[key] === null ? "" : changes[key]);
              }}
            />
          ) : (
            <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--gray-200)] p-3 sm:col-span-2 sm:grid-cols-2">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Deal
              </legend>
              <Field label="Followers" htmlFor={fid("followers")} error={fieldError("followers")}>
                <input type="text" inputMode="numeric" maxLength={9} placeholder="For example 12000" {...textProps("followers")} />
              </Field>
              <Field
                label="Agreement"
                htmlFor={fid("agreement")}
                error={fieldError("agreement")}
                helper={
                  keepsAgreement
                    ? `${here.label} keeps a signed agreement. Move the card back to Negotiating to change it.`
                    : "Mark it Signed before moving to Booked."
                }
              >
                <Select
                  {...selectProps("agreement")}
                  disabled={locked || keepsAgreement}
                  placeholder="None yet"
                  options={opt(config.agreements)}
                />
              </Field>
              <Field label="Rate" htmlFor={fid("rate")} full error={fieldError("rate")}>
                <input type="text" maxLength={120} placeholder="What they charge, in their words" {...textProps("rate")} />
              </Field>
            </fieldset>
          )}
          {isHosts && (fieldError("brand_id") || fieldError("place_pool_id")) && (
            <p role="alert" className="text-xs text-[var(--color-error-700)] sm:col-span-2">
              {fieldError("brand_id") || fieldError("place_pool_id")}
            </p>
          )}
        </div>

        <div className="border-t border-[var(--gray-200)] pt-4">
          <LogForm key={record.id} record={record} config={config} disabled={locked} onSubmit={submitLog} />
        </div>

        <ActivityLog
          activity={current.data?.activity}
          def={def}
          config={config}
          loading={current.status === "loading"}
        />
        {current.status === "error" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-error-700)]" role="alert">
            <span>Couldn&apos;t load the activity. {current.message}</span>
            <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={() => setReloadTick((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
