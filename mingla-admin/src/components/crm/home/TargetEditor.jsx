import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { CONTROL_CLASS, Field, Select } from "../fields";
import { parseTarget } from "../../../lib/crmModel";

const NUMBER_HELP = "A whole number from 1 to 1000.";
const EMPTY_HELP = "Type a whole number from 1 to 1000. To take the target away, press Cancel and then Remove.";
const OFFLINE = "You're offline";

/**
 * "Add a target" (issue #3802): a region, an ICP and a monthly number.
 *   onSave(regionId, icp, number) -> Promise<{ ok, message }>
 * A failed save keeps what was typed and says why; the button then reads
 * "Try again". A region and ICP that already have a target cannot be added
 * twice: the number is changed in the table instead.
 */
export function TargetAddForm({ regions, icps, targets, offline = false, onSave }) {
  const uid = useId();
  const [regionId, setRegionId] = useState("");
  const [icp, setIcp] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const number = parseTarget(typed);
  const taken = !!regionId && !!icp && (targets || []).some((t) => t.region_id === regionId && t.icp === icp);
  const numberError = touched && typed.trim() !== "" && number === null ? NUMBER_HELP : "";
  const ready = !!regionId && !!icp && number !== null && !taken;

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (!ready || busy || offline) return;
    setBusy(true);
    setError("");
    const res = await onSave(regionId, icp, number);
    if (!mounted.current) return;
    setBusy(false);
    if (res?.ok) {
      setRegionId("");
      setIcp("");
      setTyped("");
      setTouched(false);
    } else {
      setError(res?.message || "That didn't save. Try again.");
    }
  };

  const regionOptions = (regions || []).map((r) => ({ value: r.id, label: r.is_live ? r.name : `${r.name} (not live yet)` }));
  const icpOptions = (icps || []).map((i) => ({ value: i.id, label: i.label }));
  const clear = () => setError("");

  return (
    <form onSubmit={submit} noValidate aria-label="Add a target" className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Add a target</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto] sm:items-start">
        <Field label="Region" htmlFor={`${uid}-region`}>
          <Select
            id={`${uid}-region`}
            value={regionId}
            disabled={busy || offline}
            placeholder="Pick a region"
            options={regionOptions}
            onChange={(e) => {
              setRegionId(e.target.value);
              clear();
            }}
          />
        </Field>
        <Field label="ICP" htmlFor={`${uid}-icp`}>
          <Select
            id={`${uid}-icp`}
            value={icp}
            disabled={busy || offline}
            placeholder="Pick an ICP"
            options={icpOptions}
            onChange={(e) => {
              setIcp(e.target.value);
              clear();
            }}
          />
        </Field>
        <Field label="Hosts a month" htmlFor={`${uid}-number`} error={numberError}>
          <input
            id={`${uid}-number`}
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="For example 10"
            value={typed}
            disabled={busy || offline}
            onChange={(e) => {
              setTyped(e.target.value);
              clear();
            }}
            onBlur={() => setTouched(true)}
            className={CONTROL_CLASS}
          />
        </Field>
        <div className="sm:pt-[22px]">
          <Button type="submit" disabled={!ready || busy || offline} className="w-full max-sm:h-11 sm:w-auto">
            {busy ? "Saving…" : error ? "Try again" : "Add target"}
          </Button>
        </div>
      </div>
      {taken ? (
        <p role="status" className="text-xs text-[var(--color-warning-700)]">
          There is already a target for this. Change its number in the table.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-error-700)]">
          {error}
        </p>
      ) : null}
      {offline ? <p className="text-xs text-[var(--color-text-tertiary)]">{OFFLINE}. Targets can be changed once you&apos;re back.</p> : null}
    </form>
  );
}

/**
 * The controls beside one target row: the number (a button that turns into a
 * field with Save and Cancel) and Remove (asked once, inline).
 *   onSave(number) / onRemove() -> Promise<{ ok, message }>
 */
export function TargetRowControls({ target, offline = false, onSave, onRemove }) {
  const [mode, setMode] = useState("view"); // view | edit | confirm
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const numberRef = useRef(null);
  const removeRef = useRef(null);
  const keepRef = useRef(null);
  const returnTo = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Keyboard: focus goes into the field or the question, and back to the
  // button that opened it when it closes.
  useEffect(() => {
    if (mode === "edit") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (mode === "confirm") {
      keepRef.current?.focus();
    } else if (returnTo.current) {
      const el = returnTo.current === "remove" ? removeRef.current : numberRef.current;
      returnTo.current = null;
      el?.focus();
    }
  }, [mode]);

  const where = `${target.region_name || "a region no longer in the list"}, ${target.icp_label}`;
  const number = parseTarget(typed);
  const unchanged = number === target.monthly_target;

  const run = async (work) => {
    setBusy(true);
    setError("");
    const res = await work();
    if (!mounted.current) return;
    setBusy(false);
    if (res?.ok) setMode("view");
    else setError(res?.message || "That didn't save. Try again.");
  };
  const save = () => {
    if (busy || offline) return;
    if (number === null) {
      // Enter on an empty or unusable number is never silent.
      setError(typed.trim() === "" ? EMPTY_HELP : NUMBER_HELP);
      inputRef.current?.focus();
      return;
    }
    if (unchanged) {
      returnTo.current = "number";
      setMode("view");
      return;
    }
    returnTo.current = "number";
    run(() => onSave(number));
  };
  const cancel = (from) => {
    returnTo.current = from;
    setError("");
    setMode("view");
  };

  if (busy) {
    return (
      <span role="status" className="text-xs text-[var(--color-text-tertiary)]">
        Saving&hellip;
      </span>
    );
  }
  if (mode === "edit") {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={4}
          aria-label={`Hosts a month for ${where}`}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel("number");
            }
          }}
          className={`${CONTROL_CLASS} !w-20`}
        />
        <Button size="sm" className="max-sm:h-11" disabled={offline} onClick={save}>
          {error && number !== null ? "Try again" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => cancel("number")}>
          Cancel
        </Button>
        {typed.trim() !== "" && number === null && !error ? (
          <span role="alert" className="basis-full text-xs text-[var(--color-error-700)]">
            {NUMBER_HELP}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="basis-full text-xs text-[var(--color-error-700)]">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  if (mode === "confirm") {
    return (
      <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Remove the target for ${where}`}>
        <span className="text-xs text-[var(--color-text-primary)]">Remove this target?</span>
        <Button
          size="sm"
          variant="danger"
          className="max-sm:h-11"
          disabled={offline}
          onClick={() => {
            returnTo.current = null;
            run(onRemove);
          }}
        >
          {error ? "Try again" : "Remove"}
        </Button>
        <Button ref={keepRef} size="sm" variant="ghost" className="max-sm:h-11" onClick={() => cancel("remove")}>
          Keep
        </Button>
        {error ? (
          <span role="alert" className="basis-full text-xs text-[var(--color-error-700)]">
            {error}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        ref={numberRef}
        size="sm"
        variant="secondary"
        className="tabular-nums max-sm:h-11"
        disabled={offline}
        title={offline ? OFFLINE : undefined}
        aria-label={`Change the target for ${where}. It is ${target.monthly_target} a month`}
        onClick={() => {
          setTyped(String(target.monthly_target));
          setError("");
          setMode("edit");
        }}
      >
        {target.monthly_target} a month
      </Button>
      <Button
        ref={removeRef}
        size="sm"
        variant="ghost"
        className="max-sm:h-11"
        disabled={offline}
        title={offline ? OFFLINE : undefined}
        aria-label={`Remove the target for ${where}`}
        onClick={() => {
          setError("");
          setMode("confirm");
        }}
      >
        Remove
      </Button>
    </span>
  );
}
