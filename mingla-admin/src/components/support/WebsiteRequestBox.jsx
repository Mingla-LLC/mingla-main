// #4453 — a website change request inside the ticket panel: what the owner
// asked for, where on the site, why, what Ari could not do, the draft they
// were looking at, the 24-hour clock, a link to the brand's website in Admin,
// and "Ready for review" (with an optional note) which tells the owner.
import { useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatDateTime } from "../../lib/formatters";
import {
  READY_NOTE_MAX,
  adminSiteHref,
  readyButtonState,
  websiteRequestClock,
  websiteRequestDueAt,
  websiteRequestWhere,
} from "../../lib/websiteRequestModel";

function Fact({ label, children }) {
  if (!children) return null;
  return (
    <>
      <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-[var(--color-text-primary)]">{children}</dd>
    </>
  );
}

/**
 * Props: ticket (with ticket.website_request), profilesById, onReady(note)
 * → Promise<{ ok, error? }>. The parent reloads the inbox on success.
 */
export function WebsiteRequestBox({ ticket, profilesById = {}, onReady }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const request = ticket.website_request;
  const clock = websiteRequestClock(ticket);
  const ready = readyButtonState(ticket, { sending, note });
  const siteHref = adminSiteHref(request);
  const dueAt = websiteRequestDueAt(ticket);
  const readyBy = request?.ready_by ? profilesById[request.ready_by] : null;
  const noteId = `website-ready-note-${ticket.id}`;
  const reasonId = `website-ready-reason-${ticket.id}`;

  async function press() {
    if (!ready.ok) return;
    setSending(true);
    setError(null);
    const result = await onReady?.(note.trim());
    setSending(false);
    if (result?.ok) setNote("");
    else setError(result?.error || "Couldn't mark this ready");
  }

  return (
    <section
      aria-label="Website change request"
      data-testid="website-request-box"
      className="space-y-3 border-b border-[var(--gray-200)] bg-[var(--gray-50)] px-4 py-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-[var(--color-text-primary)]">Website change request</strong>
        <Badge variant={clock.tone}>{clock.label}</Badge>
      </div>

      {request ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <Fact label="What">{request.what}</Fact>
          <Fact label="Where">{websiteRequestWhere(request)}</Fact>
          <Fact label="Why">{request.why}</Fact>
          <Fact label="Ari could not">{request.missing_capability}</Fact>
          <Fact label="Draft version">
            {request.draft_digest ? <span className="break-all font-mono">{request.draft_digest}</span> : null}
          </Fact>
          <Fact label={request.ready_at ? "Was due" : "Due"}>{dueAt ? formatDateTime(dueAt) : null}</Fact>
          {request.ready_at ? (
            <Fact label="Marked ready">
              {`${formatDateTime(request.ready_at)}${readyBy ? ` by ${readyBy.display_name || readyBy.email || "Support"}` : ""}`}
              {request.ready_note ? `\n${request.ready_note}` : ""}
            </Fact>
          ) : null}
        </dl>
      ) : (
        <p role="status" className="text-[var(--color-text-secondary)]">
          This ticket has the website topic but no request details. Read the thread for what was asked.
        </p>
      )}

      {siteHref ? (
        <a
          href={siteHref}
          className="inline-flex min-h-8 items-center gap-1 font-semibold text-[var(--color-brand-700)] underline-offset-2 hover:underline"
        >
          Open this brand's website
          <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
        </a>
      ) : null}

      {request ? (
        <div className="space-y-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3">
          <label htmlFor={noteId} className="block font-medium text-[var(--color-text-primary)]">
            Note to the owner <span className="font-normal text-[var(--color-text-tertiary)]">(optional)</span>
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={READY_NOTE_MAX + 200}
            disabled={sending}
            placeholder="What you changed, and anything they should check."
            aria-describedby={ready.ok ? undefined : reasonId}
            className="w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={reasonId} className="min-w-0 flex-1 text-[var(--color-text-tertiary)]">
              {ready.ok
                ? "Sends the owner a notification, a push and an email, and sets this ticket to Waiting. Nothing is published."
                : ready.reason}
            </p>
            <Button size="sm" variant="primary" icon={CheckCircle2} loading={sending} disabled={!ready.ok} onClick={() => void press()}>
              Ready for review
            </Button>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg bg-[var(--color-error-50)] px-2.5 py-1.5 text-[var(--color-error-700)]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
