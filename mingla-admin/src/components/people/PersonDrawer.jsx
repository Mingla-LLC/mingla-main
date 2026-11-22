// Issue #4130 (Wave 3) and #4226 Phase 2 — one person, in a panel over the
// People list.
//
// #4226 Phase 2 (spec D5, D10, D11): the panel fits the person. Its tabs come
// from lib/peopleFilter.panelTabsFor(person_kind):
//   Explorer   Journey · Going · Social · Activity · Support
//   Host       Journey · Brands · Money · Activity · Support
//   Both       the union
//   Signing up Journey · Activity · Support
//   No account Details (what they bought, who added them, consent, place)
// A person who is not a host never sees Brands or Money. The Journey tab shows
// the Explorer stage ladder and/or the Host checklist with its next step, the
// source with its confidence, the place with its source, and the dated
// milestones (admin_person_journey). Activity lists recent screens across both
// apps from PostHog (admin-person-activity) and says plainly when tracking is
// not connected yet.
//
// Every number comes from the server; a failed load is a LoadError with
// Retry, never zeros. Writes (staff/test, ban, close business account) live
// here only, for accounts, each behind a confirmation with a reason.
import { useCallback, useEffect, useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Tabs } from "../ui/Tabs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { getPerson, getPersonActivity, getPersonAppActivity, getPersonJourney, personActions } from "../../services/peopleService";
import { CONFIRM_WORDS } from "../../lib/personActions";
import { brandRoleLabel, consentBasisLabel, marketingConsent, signInMethodLabel, spentLabel } from "../../lib/peopleSegments";
import {
  CITY_SOURCE_LABELS,
  COUNTRY_SOURCE_LABELS,
  activityLabel,
  confidenceLabel,
  explorerLadder,
  hostChecklistView,
  isHostKind,
  panelTabsFor,
  recipientHrefFor,
  sourceLabel,
  stageLabel,
} from "../../lib/peopleFilter";
import { formatDate, formatDateTime, timeAgo } from "../../lib/formatters";
import { listPersonSupportTickets } from "../../services/supportDeskService";
import { ticketNumberLabel } from "../../lib/supportTicketMetrics";

const SUPPORT_STATUS = {
  new: { label: "New", variant: "info" },
  open: { label: "Open", variant: "brand" },
  pending: { label: "Waiting", variant: "warning" },
  resolved: { label: "Resolved", variant: "success" },
  closed: { label: "Closed", variant: "default" },
};

const KIND_PILL = {
  explorer: { label: "Explorer", variant: "brand" },
  host: { label: "Host", variant: "info" },
  both: { label: "Explorer and host", variant: "info" },
  signing_up: { label: "Signing up", variant: "warning" },
  internal: { label: "Staff and test", variant: "default" },
  no_account_buyer: { label: "No account yet · bought a ticket", variant: "default" },
  no_account_contact: { label: "No account yet · host contact", variant: "default" },
};

const APP_NAMES = { explorer: "Explorer app", consumer: "Explorer app", host: "Host app", business: "Host app" };

// #4382 Wave 2 — this person's support tickets, each a link into the inbox.
function PersonSupportTickets({ userId }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    listPersonSupportTickets(userId)
      .then((rows) => { if (live) setState({ loading: false, error: null, rows }); })
      .catch((error) => { if (live) setState({ loading: false, error: error.message, rows: [] }); });
    return () => { live = false; };
  }, [userId, attempt]);
  if (state.loading) return <Skeleton height={18} width="60%" />;
  if (state.error) {
    return <LoadError title="Couldn't load support tickets" message={state.error} onRetry={() => { setState({ loading: true, error: null, rows: [] }); setAttempt((n) => n + 1); }} />;
  }
  if (state.rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">No support tickets from this person.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
      {state.rows.map((ticket) => {
        const status = SUPPORT_STATUS[ticket.status] || { label: ticket.status, variant: "default" };
        return (
          <li key={ticket.id} className="flex flex-col gap-1 py-2.5">
            <a href={`#/support?conversation=${encodeURIComponent(ticket.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
              {ticketNumberLabel(ticket)} · {ticket.subject}
            </a>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
              <Badge variant={status.variant}>{status.label}</Badge>
              <span>{ticket.requester_segment === "explorer" ? "Explorer" : "Host"}</span>
              {ticket.origin === "staff" && <span>· opened by staff</span>}
              <span>· {timeAgo(ticket.last_message_at || ticket.created_at)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// #4226 Phase 2 — recent screens across both apps (PostHog, server side).
function PersonAppActivity({ userId, person }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    getPersonAppActivity(userId)
      .then((data) => { if (live) setState({ loading: false, error: null, data }); })
      .catch((error) => { if (live) setState({ loading: false, error: error.message, data: null }); });
    return () => { live = false; };
  }, [userId, attempt]);
  const facts = (
    <KV
      rows={[
        ["Last active", person.last_active_at ? `${timeAgo(person.last_active_at)} · ${activityLabel(person)}` : "Never"],
        ["Signs in with", signInMethodLabel(person.sign_in_method)],
      ]}
    />
  );
  if (state.loading) return <div className="flex flex-col gap-3">{facts}<Skeleton height={18} width="70%" /></div>;
  if (state.error) {
    return (
      <div className="flex flex-col gap-3">
        {facts}
        <LoadError title="Couldn't load recent screens" message={state.error} onRetry={() => { setState({ loading: true, error: null, data: null }); setAttempt((n) => n + 1); }} />
      </div>
    );
  }
  if (!state.data?.configured) {
    return (
      <div className="flex flex-col gap-3">
        {facts}
        <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-3 py-3 text-sm text-[var(--color-text-secondary)]" data-activity-not-connected>
          Activity tracking not connected yet. Recent screens and sessions appear here once the PostHog read key is added.
        </p>
      </div>
    );
  }
  const screens = Array.isArray(state.data.screens) ? state.data.screens : [];
  return (
    <div className="flex flex-col gap-4">
      {facts}
      <KV
        rows={[
          ["Sessions (30 days)", Number(state.data.sessions_30d || 0).toLocaleString()],
          ["Last event", state.data.last_event_at ? formatDateTime(state.data.last_event_at) : "None recorded"],
        ]}
      />
      <section className="flex flex-col gap-2" aria-label="Recent screens">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Recent screens (both apps)</h3>
        {screens.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No screens in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
            {screens.map((s, i) => (
              <li key={`${s.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-[var(--color-text-tertiary)] tabular-nums">{formatDateTime(s.at)}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{s.name}</span>
                <Badge variant="outline">{APP_NAMES[s.app] || "App not tagged"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KV({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--color-text-secondary)]">{label}</dt>
          <dd className="min-w-0 break-words text-[var(--color-text-primary)] tabular-nums">
            {value === null || value === undefined || value === "" ? (
              <span className="text-[var(--color-text-muted)]">Not recorded</span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Timeline({ items, title = "Journey so far", empty = "No dated milestones yet." }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{empty}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-[var(--gray-200)]">
          {items.map((m, i) => (
            <li key={`${m.kind}-${m.at}-${i}`} className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 py-2 text-sm">
              <span className="text-[var(--color-text-tertiary)] tabular-nums">{formatDate(m.at)}</span>
              <span className="min-w-0 text-[var(--color-text-primary)]">
                {m.label}
                {m.detail && <span className="text-[var(--color-text-tertiary)]"> · {m.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Ladder({ items, title }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {items.map((item) => (
        <div
          key={item.key}
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${item.next || item.current ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : item.done ? "border-transparent bg-[var(--gray-50)] text-[var(--color-text-primary)]" : "border-transparent text-[var(--color-text-tertiary)]"}`}
        >
          <span aria-hidden="true" className="w-4 text-center">{item.done ? "✓" : item.next ? "→" : "·"}</span>
          <span className="flex-1">{item.label}</span>
          <span className="text-xs">{item.next ? "next step" : item.current ? "current stage" : item.at ? formatDate(item.at) : ""}</span>
        </div>
      ))}
    </section>
  );
}

function tierLabel(tier) {
  if (!tier) return "Free";
  return tier === "mingla_plus" ? "Mingla+" : tier;
}

function bankLabel(brand) {
  if (brand.stripe_payouts_enabled) return "Connected (Stripe payouts on)";
  if (brand.paystack_bank) return "Connected (bank account added)";
  return "Not connected";
}

export function PersonDrawer({ personKey, onClose, onChanged }) {
  const userId = typeof personKey === "string" && personKey.startsWith("u:") ? personKey.slice(2) : null;
  const [tab, setTab] = useState("journey");
  const [journey, setJourney] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null); // "ban" | "unban" | "deleteBusinessAccount" | "markInternal" | "unmarkInternal"

  const load = useCallback(async () => {
    if (!personKey) return;
    setLoading(true);
    setError(null);
    try {
      const [journeyRes, personRes, activityRes] = await Promise.all([
        getPersonJourney(personKey),
        userId ? getPerson(userId) : Promise.resolve(null),
        userId ? getPersonActivity(userId) : Promise.resolve(null),
      ]);
      if (personRes?.error) {
        const msg = personRes.error.message || "";
        throw new Error(
          msg.includes("not_found")
            ? "This person no longer exists."
            : msg.includes("not_authorized")
              ? "You don't have permission to see people."
              : msg || "Couldn't load this person."
        );
      }
      setJourney(journeyRes || null);
      setBundle(personRes?.data || null);
      setActivity(activityRes || null);
    } catch (err) {
      setJourney(null);
      setBundle(null);
      setActivity(null);
      setError(err?.message || "Couldn't load this person.");
    } finally {
      setLoading(false);
    }
  }, [personKey, userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    load();
  }, [load]);

  const person = journey?.person || {};
  const kind = person.person_kind || (userId ? "explorer" : "no_account_buyer");
  const tabs = panelTabsFor(kind);
  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
  const milestones = Array.isArray(journey?.milestones) ? journey.milestones : [];
  const brands = Array.isArray(journey?.brands) ? journey.brands : [];
  const counts = journey?.counts || {};
  const account = bundle?.account || null;
  const profile = bundle?.person || {};
  const pill = KIND_PILL[kind] || null;
  const name = person.name?.trim() || person.email || "No name yet";
  const banned = profile.active === false;
  const internalRow = activity?.internal || null;
  const isInternal = person.is_internal === true;
  const hasLiveBusinessAccount = !!account && !account.deleted_at;
  const teamBrands = Array.isArray(person.host_checklist?.team_brands) ? person.host_checklist.team_brands : [];

  // A new person opens on the first tab that fits them.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per person
    setTab("journey");
  }, [personKey]);

  const afterWrite = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const modal = (() => {
    if (!userId) return null;
    switch (action) {
      case "ban":
        return {
          title: "Ban this person",
          description: "They can't use Mingla until someone unbans them. Their data stays. This runs on the server and is recorded with your reason.",
          confirmLabel: "Ban",
          destructive: true,
          confirmPhrase: CONFIRM_WORDS.ban,
          run: (reason) => personActions.ban(userId, reason),
          success: "Banned.",
        };
      case "unban":
        return {
          title: "Unban this person",
          description: "They can use Mingla again.",
          confirmLabel: "Unban",
          run: (reason) => personActions.unban(userId, reason),
          success: "Unbanned.",
        };
      case "deleteBusinessAccount":
        return {
          title: "Close this business account",
          description: "Their business account is closed and stops counting them as a host. It can be restored from the full record. Their Explorer account is not touched.",
          confirmLabel: "Close business account",
          destructive: true,
          confirmPhrase: CONFIRM_WORDS.deleteBusinessAccount,
          run: (reason) => personActions.deleteBusinessAccount(userId, reason),
          success: "Business account closed.",
        };
      case "markInternal":
        return {
          title: "Mark as staff or test",
          description: "They move to Staff and test and are left out of every count in admin and the Data room.",
          confirmLabel: "Mark as staff or test",
          run: (reason) => personActions.setInternal(userId, true, reason),
          success: "Marked as staff or test.",
        };
      case "unmarkInternal":
        return {
          title: "Not staff or test",
          description: "They go back into the counts, in the segment their account fits.",
          confirmLabel: "Count them again",
          run: (reason) => personActions.setInternal(userId, false, reason),
          success: "Counted again.",
        };
      default:
        return null;
    }
  })();

  const header = (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{loading ? "Loading…" : name}</p>
      {!loading && !error && (
        <div className="flex flex-wrap gap-1.5">
          {pill && <Badge variant={pill.variant}>{pill.label}</Badge>}
          {stageLabel(person) && kind !== "internal" && <Badge variant="outline">{stageLabel(person)}</Badge>}
          <Badge variant="outline">{sourceLabel(person)} · {confidenceLabel(person).split(" · ")[0]}</Badge>
          {person.country && <Badge variant="outline">{person.country}</Badge>}
          {banned && <Badge variant="error" dot>Banned</Badge>}
        </div>
      )}
    </div>
  );

  const placeRows = [
    ["City", person.city ? `${person.city} · ${CITY_SOURCE_LABELS[person.city_source] || person.city_source || "source not recorded"}` : "No city yet"],
    ["Country", person.country ? `${person.country} · ${COUNTRY_SOURCE_LABELS[person.country_source] || person.country_source || "source not recorded"}` : null],
  ];

  const goingItems = milestones.filter((m) => m.kind === "ticket" || m.kind === "rsvp" || m.kind === "experience");

  return (
    <Drawer open={!!personKey} onClose={onClose} title={name} header={header} suspended={!!action}>
      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton height={36} />
          <Skeleton height={18} width="70%" />
          <Skeleton height={18} width="55%" />
          <Skeleton height={18} width="60%" />
        </div>
      ) : error ? (
        <LoadError title="Couldn't load this person" message={error} onRetry={load} />
      ) : (
        <div className="flex flex-col gap-5">
          <Tabs tabs={tabs} activeTab={activeTab} onChange={setTab} />

          <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex flex-col gap-5">
            {activeTab === "journey" && (
              <>
                {person.explorer_stage && (
                  <Ladder
                    title={person.explorer_stage === "signing_up"
                      ? `Explorer sign-up: ${person.explorer_stopped_step === null || person.explorer_stopped_step === undefined ? "step not recorded" : `stopped at step ${person.explorer_stopped_step}`}${person.explorer_stopped_step_key ? ` (${person.explorer_stopped_step_key})` : ""}`
                      : "Explorer stage"}
                    items={explorerLadder(person.explorer_stage)}
                  />
                )}
                {isHostKind(kind) && (
                  person.host_next_step === "team_member" ? (
                    <p className="text-sm text-[var(--color-text-primary)]">
                      Team member at {teamBrands.map((b) => `${b.name} (${brandRoleLabel(b.role)})`).join(", ") || "a brand"}. They don't own a brand, so there's no host checklist.
                    </p>
                  ) : (
                    <Ladder title="Host checklist" items={hostChecklistView(person.host_checklist)} />
                  )
                )}
                <KV
                  rows={[
                    ["Joined", person.joined_at ? `${formatDate(person.joined_at)}${person.sign_in_method ? ` · ${signInMethodLabel(person.sign_in_method)}` : ""}` : null],
                    ["Source", `${sourceLabel(person)} · ${confidenceLabel(person)}`],
                    ...(person.signup_surface ? [["Signed up in", person.signup_surface === "host_app" ? "Host app" : person.signup_surface === "web" ? "Web" : "Explorer app"]] : []),
                    ...placeRows,
                    ["Last active", person.last_active_at ? `${timeAgo(person.last_active_at)} · ${activityLabel(person)}` : "Never"],
                    ...(isHostKind(kind) && person.brand_setup_furthest_step !== null && person.brand_setup_furthest_step !== undefined
                      ? [["Brand setup reached", `Step ${person.brand_setup_furthest_step}${person.brand_setup_furthest_step_key ? ` (${person.brand_setup_furthest_step_key})` : ""}`]]
                      : []),
                    ...(userId ? [["Subscription", tierLabel(bundle?.subscription?.effective_tier)], ["Beta tester", profile.is_beta_tester ? "Yes" : "No"]] : []),
                  ]}
                />
                <Timeline items={milestones} />
              </>
            )}

            {activeTab === "going" && (
              <>
                <KV
                  rows={[
                    ["Tickets", Number(counts.tickets ?? person.ticket_count ?? 0).toLocaleString()],
                    ["RSVPs", Number(counts.rsvps ?? person.rsvp_count ?? 0).toLocaleString()],
                    ["Experiences", Number(counts.experiences ?? person.experience_count ?? 0).toLocaleString()],
                    ["Spent", person.spent ? spentLabel(person.spent) : "Nothing yet"],
                  ]}
                />
                <Timeline items={goingItems} title="Tickets, RSVPs and experiences" empty="Nothing booked yet. Tickets, RSVPs and experiences appear here." />
              </>
            )}

            {activeTab === "social" && (
              <KV
                rows={[
                  ["Friends", Number(counts.friends ?? 0).toLocaleString()],
                  ["Collab sessions", Number(counts.collab_sessions ?? 0).toLocaleString()],
                  ["Chats", Number(counts.chats ?? 0).toLocaleString()],
                  ["Brands followed", Number(counts.brands_followed ?? 0).toLocaleString()],
                  ["Saves", Number(counts.saves ?? 0).toLocaleString()],
                ]}
              />
            )}

            {activeTab === "brands" && (
              <div className="flex flex-col gap-4">
                {account && (
                  <KV
                    rows={[
                      ["Business account", account.deleted_at ? `Closed ${formatDate(account.deleted_at)}` : account.business_name || "Open, no business name yet"],
                      ["Host since", formatDate(account.created_at)],
                      ["Mingla partner", account.partner_enabled ? `Yes${account.partner_country ? ` · ${account.partner_country}` : ""}` : "No"],
                    ]}
                  />
                )}
                {brands.length === 0 && teamBrands.length === 0 && (
                  <p className="text-sm text-[var(--color-text-secondary)]">No brand yet. Their next step is creating one.</p>
                )}
                {brands.length > 0 && (
                  <ul className="flex flex-col gap-3">
                    {brands.map((b) => (
                      <li key={b.id} className="flex flex-col gap-1 rounded-lg border border-[var(--gray-200)] px-3 py-2.5 text-sm">
                        <a href={`#/brands?brandId=${encodeURIComponent(b.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                          {b.name || "Unnamed brand"}
                        </a>
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          Created {formatDate(b.created_at)} · {b.payout_country || "no payout country"} · {b.currency || "no currency"} · bank {bankLabel(b).toLowerCase()} · {Number(b.published || 0)} published{Number(b.drafts) ? ` · ${b.drafts} draft${Number(b.drafts) === 1 ? "" : "s"}` : ""} · {b.first_sale_at ? `first sale ${formatDate(b.first_sale_at)}` : "no sale yet"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {teamBrands.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {teamBrands.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <a href={`#/brands?brandId=${encodeURIComponent(b.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">{b.name}</a>
                        <Badge variant="outline">{brandRoleLabel(b.role)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === "money" && (
              brands.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">No brand, so nothing to be paid yet.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {brands.map((b) => (
                    <section key={b.id} className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{b.name}</h3>
                      <KV
                        rows={[
                          ["Payout country", b.payout_country ? `${b.payout_country}${b.currency ? ` · ${b.currency}` : ""}` : "Not set"],
                          ["Payment setup", b.payment_provider ? (b.payment_provider === "paystack" ? "Paystack" : "Stripe") : null],
                          ["Setup started", b.payments_setup_started_at ? formatDate(b.payments_setup_started_at) : "Not started"],
                          ["Bank", `${bankLabel(b)}${b.bank_added_at ? ` · ${formatDate(b.bank_added_at)}` : ""}`],
                          ["First sale", b.first_sale_at ? formatDate(b.first_sale_at) : "None yet"],
                        ]}
                      />
                    </section>
                  ))}
                </div>
              )
            )}

            {activeTab === "activity" && userId && <PersonAppActivity userId={userId} person={person} />}

            {activeTab === "support" && userId && <PersonSupportTickets userId={userId} />}

            {activeTab === "details" && (
              <>
                <KV
                  rows={[
                    ["Email", person.email],
                    ["Phone", person.phone_e164],
                    ["Emails OK", `${marketingConsent(person.marketing_consent).label}${consentBasisLabel(person.consent_basis) ? ` · ${consentBasisLabel(person.consent_basis)}` : ""}`],
                    ["Source", `${sourceLabel(person)} · ${confidenceLabel(person)}`],
                    ...placeRows,
                    ["Bought", Number(person.tickets_count) ? `${person.tickets_count} ${Number(person.tickets_count) === 1 ? "ticket" : "tickets"} · ${spentLabel(person.spent)}` : "Nothing yet"],
                    ["Bought from", (Array.isArray(person.brands) ? person.brands : []).map((b) => b.name).filter(Boolean).join(", ") || null],
                    ["Added by", (Array.isArray(person.host_brands) ? person.host_brands : []).map((b) => `${b.name}${b.added_at ? ` (${b.source === "import" ? "contact upload" : "added by hand"}, ${formatDate(b.added_at)})` : ""}`).join("; ") || null],
                    ["In the contacts of", Array.isArray(person.host_brands) && person.host_brands.length > 1 ? `${person.host_brands.length} brands` : null],
                  ]}
                />
                <Timeline items={milestones} />
              </>
            )}
          </div>

          {person.email && (
            <a
              href={recipientHrefFor(person.email)}
              className="text-sm font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline"
            >
              Email this person
            </a>
          )}

          {userId && (
            <section className="flex flex-col gap-2 border-t border-[var(--gray-200)] pt-4" aria-label="Staff and test">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Staff and test</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {isInternal
                  ? internalRow?.is_internal
                    ? `Left out of every count. ${internalRow.marked_by === "rule" ? "Matched the staff and test email rule" : `Marked by ${internalRow.marked_by}`}: ${internalRow.reason}.`
                    : "Left out of every count: their email matches the staff and test rule."
                  : "Counted as a real person."}
              </p>
              <div>
                <Button variant="secondary" size="sm" onClick={() => setAction(isInternal ? "unmarkInternal" : "markInternal")}>
                  {isInternal ? "Count them again…" : "Mark as staff or test…"}
                </Button>
              </div>
            </section>
          )}

          {userId && (
            <details className="border-t border-[var(--gray-200)] pt-4">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--color-error-700)]">Ban or delete this person</summary>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {banned ? (
                    <Button variant="secondary" size="sm" onClick={() => setAction("unban")}>Unban…</Button>
                  ) : (
                    <Button variant="danger" size="sm" onClick={() => setAction("ban")}>Ban…</Button>
                  )}
                  {hasLiveBusinessAccount && (
                    <Button variant="danger" size="sm" onClick={() => setAction("deleteBusinessAccount")}>Close business account…</Button>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Runs on the server only, with your reason recorded. If the server refuses, nothing is changed.
                  Deleting a whole account for good isn't available from admin yet; ban them and ask engineering.
                </p>
                <a
                  href={`#/people?view=record&userId=${encodeURIComponent(userId)}`}
                  className="text-sm font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline"
                >
                  Open the full record (edit details, beta, partner)
                </a>
              </div>
            </details>
          )}
        </div>
      )}

      {modal && (
        <HighRiskActionModal
          open={!!modal}
          onClose={() => setAction(null)}
          title={modal.title}
          description={modal.description}
          confirmLabel={modal.confirmLabel}
          destructive={!!modal.destructive}
          confirmPhrase={modal.confirmPhrase}
          successMessage={modal.success}
          onConfirm={async ({ reason }) => {
            await modal.run(reason);
            await afterWrite();
          }}
        />
      )}
    </Drawer>
  );
}
