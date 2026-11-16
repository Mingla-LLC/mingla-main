// #4452 A1.8 — one lead: labels, email, consent, the history timeline, emails
// and the ad line, with Email <first name> (a one-to-one reply), Add to
// pipeline / Open card and Stop emails (form runs only).
import { useCallback, useState } from "react";
import { Mail, UserPlus, ExternalLink, BellOff } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { useToast } from "../../context/ToastContext";
import { useServerRead } from "../../hooks/useServerRead";
import { formatDate, formatDateTime } from "../../lib/formatters";
import { adLine, consentLine, firstName, labelName, leadCardFields, leadsErrorWords, pipelineFor, sourceName } from "../../lib/leadsModel";
import { getLead, linkLeadToCard, stopFormEmails } from "../../services/leadsService";
import { CALL_STATUS_LABELS, callStatus, safeLink } from "../../lib/inboundLeads";
import { createRecord, newRequestKey } from "../../services/crmService";

/** #4339 kept: a booking's call time and Google Calendar status, social and website. */
function BookingLine({ booking }) {
  const status = callStatus(booking.status);
  const off = status === "cancelled" || status === "declined";
  const social = safeLink(booking.social_url, false);
  const website = safeLink(booking.website, true);
  const linkClass = "font-medium text-[var(--color-brand-700)] hover:underline";
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-secondary)]" data-booking-details="">
      {booking.call_at && <span className={off ? "line-through" : undefined}>Call: {formatDateTime(booking.call_at)}</span>}
      <span data-booking-status={status}>{CALL_STATUS_LABELS[status]}</span>
      {booking.city && <span>City: {booking.city}</span>}
      {social && <a href={social} target="_blank" rel="noopener noreferrer" className={linkClass} data-booking-social="">Social profile</a>}
      {website && <a href={website} target="_blank" rel="noopener noreferrer" className={linkClass} data-booking-website="">Website</a>}
    </div>
  );
}

const cardHash = (crm) => `#/outreach?tab=${crm.pipeline === "creators" ? "creators" : "hosts"}&card=${encodeURIComponent(crm.id)}`;

function eventTitle(e) {
  if (e.source === "form") return e.summary?.form_name ? `Sent the form "${e.summary.form_name}"` : "Sent a form";
  if (e.source === "book_a_call") return "Booked a call";
  if (e.source === "tool") return "Used a free tool";
  if (e.source === "beta") return "Asked for early access";
  return sourceName(e.source);
}

export function LeadDrawer({ leadId, onClose, onChanged }) {
  const { addToast } = useToast();
  const load = useCallback(() => getLead(leadId), [leadId]);
  const state = useServerRead(load);
  const [busy, setBusy] = useState("");
  const data = state.data;
  const lead = data?.lead;
  const can = data?.can || {};
  const crm = data?.crm || null;
  // Stop emails shows only on a form event whose follow-up run is still active.
  const runActive = (e) => e.answers?.run?.status === "active";

  const addToPipeline = async () => {
    setBusy("card");
    try {
      const res = await createRecord(pipelineFor(lead), leadCardFields(lead), newRequestKey());
      const record = res?.status === "duplicate" ? res.existing : res?.record;
      if (!record?.id) throw new Error("The server did not return the card.");
      await linkLeadToCard(lead.id, record.id);
      addToast({ variant: res?.status === "duplicate" ? "info" : "success", title: res?.status === "duplicate" ? "Already on a card: linked to it" : "Added to the pipeline" });
      state.retry();
      onChanged?.();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't add to the pipeline", description: leadsErrorWords(err) });
    } finally {
      setBusy("");
    }
  };

  const stop = async (submissionId) => {
    setBusy(`stop:${submissionId}`);
    try {
      await stopFormEmails(submissionId);
      addToast({ variant: "success", title: "Follow-up emails stopped" });
      state.retry();
      onChanged?.();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't stop the emails", description: leadsErrorWords(err) });
    } finally {
      setBusy("");
    }
  };

  return (
    <Drawer
      open={!!leadId}
      onClose={onClose}
      title={lead ? (lead.name || lead.email) : "Lead"}
      footer={lead ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={Mail} onClick={() => { window.location.hash = `#/email?lead=${encodeURIComponent(lead.id)}`; }}>
            Email {firstName(lead.name)}
          </Button>
          {crm ? (
            <Button variant="secondary" icon={ExternalLink} onClick={() => { window.location.hash = cardHash(crm); }}>Open card</Button>
          ) : can.add_to_pipeline ? (
            <Button variant="secondary" icon={UserPlus} loading={busy === "card"} onClick={addToPipeline}>Add to pipeline</Button>
          ) : null}
        </div>
      ) : null}
    >
      {state.status === "error" && !data ? (
        <LoadError title="Couldn't load this lead" message={leadsErrorWords(state.error)} onRetry={state.retry} />
      ) : !data ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the lead">
          <Skeleton height={20} /><Skeleton height={64} /><Skeleton height={160} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-5" data-lead-drawer="">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(lead.labels || []).map((l) => <Badge key={l} variant={l === lead.primary_label ? "brand" : "default"}>{labelName(l)}</Badge>)}
              {lead.is_test && <Badge variant="outline">Test</Badge>}
            </div>
            <a href={`mailto:${lead.email}`} className="break-all text-sm font-semibold text-[var(--color-text-primary)] hover:underline">{lead.email}</a>
            <p className="text-sm text-[var(--color-text-secondary)]" data-consent-line="">{consentLine(lead, formatDate)}</p>
          </div>

          <section aria-labelledby="lead-history" className="flex flex-col gap-2">
            <h3 id="lead-history" className="text-[13px] font-semibold uppercase tracking-[.12em] text-[var(--color-text-tertiary)]">History</h3>
            <ol className="flex flex-col gap-3">
              {(data.events || []).map((e) => (
                <li key={e.id} className="rounded-xl border border-[var(--a-line)] p-3 text-sm" data-lead-event={e.source}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--color-text-primary)]">{eventTitle(e)}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(e.occurred_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {[e.page_path, [e.utm_source, e.utm_campaign].filter(Boolean).join(" / ") || "direct", adLine(e.ad)].filter(Boolean).join(" · ")}
                  </p>
                  {Array.isArray(e.answers?.values) && e.answers.values.length > 0 && (
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      {e.answers.values.map((a) => (
                        <div key={a.key} className="contents">
                          <dt className="text-[var(--color-text-tertiary)]">{a.label}</dt>
                          <dd className="min-w-0 break-words text-[var(--color-text-primary)]">{typeof a.value === "object" && a.value !== null ? (a.value.label ?? JSON.stringify(a.value)) : String(a.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {e.booking && <BookingLine booking={e.booking} />}
                  {can.stop_emails && runActive(e) && (
                    <Button className="mt-2" variant="secondary" size="sm" icon={BellOff} loading={busy === `stop:${e.source_id}`} onClick={() => stop(e.source_id)}>
                      Stop emails
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="lead-emails" className="flex flex-col gap-2">
            <h3 id="lead-emails" className="text-[13px] font-semibold uppercase tracking-[.12em] text-[var(--color-text-tertiary)]">Emails</h3>
            {[...(data.emails?.automation || []), ...(data.emails?.campaigns || [])].length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">No emails yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {(data.emails?.automation || []).map((s) => (
                  <li key={s.send_id} className="flex flex-wrap justify-between gap-2">
                    <span>{s.kind === "confirmation" ? "Confirmation" : "Follow-up"} · {s.status}{s.opened ? " · opened" : ""}{s.clicked ? " · clicked" : ""}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(s.sent_at || s.due_at)}</span>
                  </li>
                ))}
                {(data.emails?.campaigns || []).map((c, i) => (
                  <li key={`c${i}`} className="flex flex-wrap justify-between gap-2">
                    <span>{c.subject} · {c.status}</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(c.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
