// Issue #3802 (Wave 4) — a record's emails, phone numbers and handles.
//
// A list of chips (what kind it is, the value as typed, a remove button) and
// one input. The kind is worked out from what is typed and shown before
// anything is added; "Change" picks another kind and, for a handle, where it
// is from. The server keeps one normal form of each, so a handle written as a
// profile address and the same handle with an @ are one identifier.
//
// `onChange(list)` is given the whole new list. It may return a promise of
// { ok } or { message, existingId }: on a refusal nothing is added and the
// server's sentence is shown under the input.
import { useId, useRef, useState } from "react";
import { AtSign, Mail, Phone, X } from "lucide-react";
import { Button } from "../ui/Button";
import { CONTROL_CLASS, LABEL_CLASS, Select } from "./fields";
import {
  IDENT_KINDS,
  IDENT_PLATFORMS,
  MAX_IDENTIFIERS,
  addIdentifier,
  detectIdentKind,
  detectPlatform,
  identLabel,
} from "../../lib/crmModel";

const ICONS = { email: Mail, phone: Phone, handle: AtSign };

export function IdentifiersField({ value, disabled = false, saving = false, onChange, onOpenRecord }) {
  const id = useId();
  const inputRef = useRef(null);
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState("");
  const [platform, setPlatform] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState({ message: "", existingId: "" });
  const [busy, setBusy] = useState(false);
  const list = Array.isArray(value) ? value : [];
  const guess = kind || detectIdentKind(typed);
  const full = list.length >= MAX_IDENTIFIERS;
  const locked = disabled || busy || saving;

  const send = async (next) => {
    setBusy(true);
    let result;
    try {
      result = await onChange(next);
    } finally {
      setBusy(false);
    }
    if (result && result.message) {
      setProblem({ message: result.message, existingId: result.existingId || "" });
      return false;
    }
    setProblem({ message: "", existingId: "" });
    return true;
  };

  const add = async () => {
    if (locked) return;
    if (!typed.trim()) {
      setProblem({ message: "Type an email, a phone number or a handle first.", existingId: "" });
      inputRef.current?.focus();
      return;
    }
    const made = addIdentifier(list, { kind: guess, value: typed, platform: platform || detectPlatform(typed) });
    if (made.message) {
      setProblem({ message: made.message, existingId: "" });
      inputRef.current?.focus();
      return;
    }
    if (await send(made.list)) {
      setTyped("");
      setKind("");
      setPlatform("");
      setChoosing(false);
    }
    inputRef.current?.focus();
  };

  const remove = async (item) => {
    if (locked) return;
    await send(list.filter((i) => i !== item));
    inputRef.current?.focus();
  };

  return (
    <div className="min-w-0 sm:col-span-2">
      <label htmlFor={`${id}-input`} className={LABEL_CLASS}>
        Handles, emails and phones
      </label>
      {list.length > 0 && (
        <ul className="mb-2 flex min-w-0 flex-wrap gap-2" aria-label="Handles, emails and phones on this record">
          {list.map((item) => {
            const Icon = ICONS[item.kind] || AtSign;
            return (
              <li
                key={`${item.kind}:${item.key || item.value}`}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--gray-200)] bg-[var(--gray-50)] pl-3 text-[13px] text-[var(--color-text-primary)]"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
                <span className="sr-only">{identLabel(item)}:</span>
                <span className="min-w-0 break-all py-1.5" title={identLabel(item)}>
                  {item.value}
                </span>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`Remove ${identLabel(item).toLowerCase()} ${item.value}`}
                  onClick={() => remove(item)}
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-input`}
          ref={inputRef}
          type="text"
          maxLength={200}
          value={typed}
          disabled={disabled || full}
          placeholder="Add an email, a phone number or a handle"
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            setTyped(e.target.value);
            if (problem.message) setProblem({ message: "", existingId: "" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={`${CONTROL_CLASS} min-w-0 flex-1`}
        />
        <Button type="button" variant="secondary" className="shrink-0 max-sm:h-11" loading={busy} disabled={disabled || full || saving} onClick={add}>
          Add
        </Button>
      </div>
      <div id={`${id}-help`} className="mt-1 flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
        {full ? (
          <span>A record holds at most {MAX_IDENTIFIERS} of these. Remove one to add another.</span>
        ) : typed.trim() ? (
          <>
            <span>
              Adds as: <b className="text-[var(--color-text-primary)]">{IDENT_KINDS.find((k) => k.id === guess)?.label || "Handle"}</b>
            </span>
            <button
              type="button"
              aria-expanded={choosing}
              onClick={() => setChoosing((c) => !c)}
              className="min-h-11 cursor-pointer rounded px-1 font-semibold text-[var(--color-brand-500)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
            >
              Change
            </button>
          </>
        ) : (
          <span>The kind is worked out from what you type. Press Add or Enter.</span>
        )}
      </div>
      {choosing && typed.trim() && (
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Select
            aria-label="Kind"
            value={guess}
            options={IDENT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
            onChange={(e) => setKind(e.target.value)}
          />
          {guess === "handle" && (
            <Select
              aria-label="Where the handle is from"
              value={platform || detectPlatform(typed)}
              placeholder="Not sure"
              options={IDENT_PLATFORMS.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(e) => setPlatform(e.target.value)}
            />
          )}
        </div>
      )}
      {problem.message && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-error-700)]">
          <span className="min-w-0 break-words">{problem.message}</span>
          {problem.existingId && onOpenRecord && (
            <Button type="button" variant="secondary" size="sm" className="max-sm:h-11" onClick={() => onOpenRecord(problem.existingId)}>
              Open that record
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
