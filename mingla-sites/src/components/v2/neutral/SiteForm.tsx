"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";

/*
 * #2829 W5 — a site's contact form or newsletter box, in the browser.
 *
 * The server renders a complete HTML form that works with no JavaScript (a
 * plain POST and a 303 back to the page with the outcome). When JavaScript
 * runs, this component sends the same fields as JSON, keeps the visitor on
 * the page, disables the button while sending (no double sends), and shows
 * the real outcome in a live region: the thank-you line, or the plain reason
 * and what to do. Nothing is ever shown as sent unless Mingla accepted it.
 */
export type SiteFormField = {
  name: "name" | "email" | "phone" | "message";
  label: string;
  type: "text" | "email" | "tel" | "textarea";
  required: boolean;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
};

export type SiteFormProps = {
  kind: "contact" | "newsletter";
  anchor: string;
  action: string;
  hidden: Readonly<Record<string, string>>;
  fields: readonly SiteFormField[];
  submitLabel: string;
  /** The outcome of a no-JavaScript send, rendered by the server. */
  initialNotice: { ok: boolean; message: string } | null;
  /** Shown instead of sending (a private preview never sends). */
  disabledReason?: string;
  /**
   * #2829 W7 — the markup a design draws: `neutral` (the default) or
   * `voyage` (pill fields in rows, the arrow-disc button, the notice plate).
   * The sending behaviour is identical.
   */
  skin?: "neutral" | "voyage";
};

type Notice = { ok: boolean; message: string } | null;

export function SiteForm({ kind, anchor, action, hidden, fields, submitLabel, initialNotice, disabledReason, skin = "neutral" }: SiteFormProps) {
  const [notice, setNotice] = useState<Notice>(initialNotice);
  const [sending, setSending] = useState(false);
  const statusRef = useRef<HTMLElement | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || disabledReason) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      const result = (await response.json().catch(() => null)) as { ok?: unknown; message?: unknown } | null;
      const message = typeof result?.message === "string"
        ? result.message
        : "We couldn't send that just now. Please check your connection and try again.";
      const ok = response.ok && result?.ok === true;
      setNotice({ ok, message });
      if (ok) {
        for (const field of fields) {
          const input = form.elements.namedItem(field.name);
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = "";
        }
      }
    } catch {
      setNotice({ ok: false, message: "We couldn't send that just now. Please check your connection and try again." });
    } finally {
      setSending(false);
      requestAnimationFrame(() => statusRef.current?.focus());
    }
  }

  if (skin === "voyage") {
    const status = (
      <div
        ref={statusRef as RefObject<HTMLDivElement>}
        className={notice || disabledReason ? `form-notice ${notice?.ok ? "form-notice--ok" : "form-notice--error"} v-form-status` : "v-form-status v-form-status--idle"}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-form-outcome={notice ? (notice.ok ? "sent" : "error") : undefined}
      >
        {disabledReason ?? notice?.message ?? ""}
      </div>
    );
    const button = (
      <button type="submit" className={kind === "newsletter" ? "btn btn--primary v-newsletter__button" : "btn btn--primary"} disabled={sending || Boolean(disabledReason)}>
        {sending ? "Sending…" : submitLabel}
        {kind === "contact" ? (
          <span className="btn__ic" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </span>
        ) : null}
      </button>
    );
    const trap = (
      <div className="form-trap" aria-hidden="true">
        <label htmlFor={`${anchor}-website`}>Leave this field empty</label>
        <input id={`${anchor}-website`} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
    );
    const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
    if (kind === "newsletter") {
      const field = fields[0]!;
      return (
        <form id={anchor} className="v-newsletter__form" method="post" action={action} onSubmit={onSubmit} aria-busy={sending} data-site-form={kind}>
          {hiddenInputs}
          {trap}
          <label htmlFor={`${anchor}-${field.name}`} className="sr-only">{field.label}</label>
          <input id={`${anchor}-${field.name}`} name={field.name} type={field.type === "textarea" ? "text" : field.type} required={field.required} autoComplete={field.autoComplete} placeholder={field.placeholder ?? field.label} maxLength={field.maxLength} className="field v-grow" />
          {button}
          {status}
        </form>
      );
    }
    return (
      <form id={anchor} className="form-grid" method="post" action={action} onSubmit={onSubmit} aria-busy={sending} data-site-form={kind}>
        {hiddenInputs}
        {trap}
        {fields.map((field) => {
          const id = `${anchor}-${field.name}`;
          return (
            <div key={field.name} className="form-row">
              <label htmlFor={id} className="form-label">{field.label}{field.required ? null : <span className="form-optional"> (optional)</span>}</label>
              {field.type === "textarea" ? (
                <textarea id={id} name={field.name} required={field.required} placeholder={field.placeholder} maxLength={field.maxLength} minLength={field.minLength} rows={5} className="field field--area" />
              ) : (
                <input id={id} type={field.type} name={field.name} required={field.required} autoComplete={field.autoComplete} placeholder={field.placeholder} maxLength={field.maxLength} className="field" />
              )}
            </div>
          );
        })}
        <div className="form-row form-row--submit">{button}</div>
        {status}
      </form>
    );
  }

  return (
    <form
      id={anchor}
      className={`site-form site-form-${kind}`}
      method="post"
      action={action}
      onSubmit={onSubmit}
      noValidate={false}
      aria-busy={sending}
      data-site-form={kind}
    >
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {/* Left empty by people; filled by form-filling bots. Hidden from everyone. */}
      <div className="site-form-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {fields.map((field) => (
        <label key={field.name} className="site-form-field">
          <span>{field.label}{field.required ? null : <span className="site-form-optional"> (optional)</span>}</span>
          {field.type === "textarea" ? (
            <textarea
              name={field.name}
              required={field.required}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              minLength={field.minLength}
              rows={5}
            />
          ) : (
            <input
              type={field.type}
              name={field.name}
              required={field.required}
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
            />
          )}
        </label>
      ))}
      <button type="submit" className="button accent site-form-submit" disabled={sending || Boolean(disabledReason)}>
        {sending ? "Sending…" : submitLabel}
      </button>
      <p
        ref={statusRef as RefObject<HTMLParagraphElement>}
        className={notice ? `site-form-status ${notice.ok ? "is-ok" : "is-error"}` : "site-form-status"}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-form-outcome={notice ? (notice.ok ? "sent" : "error") : undefined}
      >
        {disabledReason ?? notice?.message ?? ""}
      </p>
    </form>
  );
}
