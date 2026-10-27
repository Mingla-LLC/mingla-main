// Issue #4130 (Wave 3) — one person, in a drawer over the People list.
//
// Tabs: Activity, Tickets, Business, Subscription (the approved design). Every
// number comes from the server (admin_get_person + admin_get_person_activity);
// a failed load is a LoadError with Retry, never zeros.
//
// Writes live here and only here, each behind a confirmation with a reason:
//   - Staff and test: mark / unmark (audited).
//   - Ban / unban (typed BAN), close the business account (typed DELETE).
// Every write is one audited server call (lib/personActions.js). If the server
// refuses, the modal shows why and nothing else happens. Permanent deletion of a
// whole account is not offered from admin (no server step for it exists yet).
import { useCallback, useEffect, useState } from "react";
import { Drawer } from "../ui/Drawer";
import { Tabs } from "../ui/Tabs";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { getPerson, getPersonActivity, personActions } from "../../services/peopleService";
import { CONFIRM_WORDS } from "../../lib/personActions";
import { brandRoleLabel, signInMethodLabel } from "../../lib/peopleSegments";
import { formatDate, formatDateTime, timeAgo } from "../../lib/formatters";
import { formatMoneyMinor } from "../../lib/moneyFormat";

const DRAWER_TABS = [
  { id: "activity", label: "Activity" },
  { id: "tickets", label: "Tickets" },
  { id: "business", label: "Business" },
  { id: "subscription", label: "Subscription" },
];

const SEGMENT_PILL = {
  explorer: { label: "Explorer", variant: "brand" },
  host: { label: "Host", variant: "info" },
  both: { label: "Explorer and host", variant: "info" },
  incomplete: { label: "Didn't finish sign-up", variant: "warning" },
  internal: { label: "Staff and test", variant: "default" },
};

const ORDER_STATUS = {
  paid: { label: "Paid", variant: "success" },
  pending: { label: "Waiting for payment", variant: "warning" },
  failed: { label: "Failed", variant: "error" },
  refunded: { label: "Refunded", variant: "default" },
  partial_refund: { label: "Part refunded", variant: "default" },
  cancelled: { label: "Cancelled", variant: "default" },
};

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

function tierLabel(tier) {
  if (!tier) return "Free";
  return tier === "mingla_plus" ? "Mingla+" : tier;
}

export function PersonDrawer({ userId, onClose, onChanged }) {
  const [tab, setTab] = useState("activity");
  const [bundle, setBundle] = useState(null);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null); // "ban" | "unban" | "deleteBusinessAccount" | "markInternal" | "unmarkInternal"

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [personRes, activityRes] = await Promise.all([getPerson(userId), getPersonActivity(userId)]);
      if (personRes.error) {
        const msg = personRes.error.message || "";
        throw new Error(
          msg.includes("not_found")
            ? "This person no longer exists."
            : msg.includes("not_authorized")
              ? "You don't have permission to see people."
              : msg || "Couldn't load this person."
        );
      }
      setBundle(personRes.data || null);
      setActivity(activityRes || {});
    } catch (err) {
      setBundle(null);
      setActivity(null);
      setError(err?.message || "Couldn't load this person.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    setTab("activity");
    load();
  }, [load]);

  const person = bundle?.person || {};
  const account = bundle?.account || null;
  const segment = activity?.segment || null;
  const pill = segment ? SEGMENT_PILL[segment] : null;
  const name =
    person.display_name?.trim() ||
    [person.first_name, person.last_name].filter(Boolean).join(" ").trim() ||
    account?.business_name ||
    person.email ||
    "No name yet";
  const banned = person.active === false;
  const internalRow = activity?.internal || null;
  const isInternal = segment === "internal";
  const hasLiveBusinessAccount = !!account && !account.deleted_at;

  const afterWrite = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  const modal = (() => {
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
          {person.country && <Badge variant="outline">{person.country}</Badge>}
          {person.created_at && <Badge variant="outline">Joined {formatDate(person.created_at)}</Badge>}
          {banned && <Badge variant="error" dot>Banned</Badge>}
        </div>
      )}
    </div>
  );

  return (
    <Drawer open={!!userId} onClose={onClose} title={name} header={header} suspended={!!action}>
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
          <Tabs tabs={DRAWER_TABS} activeTab={tab} onChange={setTab} />

          <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "activity" && (
              <KV
                rows={[
                  ["Last active", activity?.last_activity_at || activity?.last_sign_in_at
                    ? timeAgo([activity?.last_activity_at, activity?.last_sign_in_at].filter(Boolean).sort().pop())
                    : null],
                  ["Signs in with", signInMethodLabel(activity?.sign_in_method)],
                  ["Saves", Number(activity?.saves ?? 0).toLocaleString()],
                  ["Friends", Number(activity?.friends ?? 0).toLocaleString()],
                  ["Email", person.email],
                  ["Phone", person.phone],
                ]}
              />
            )}

            {tab === "tickets" && (
              Array.isArray(activity?.orders) && activity.orders.length > 0 ? (
                <ul className="flex flex-col divide-y divide-[var(--gray-200)]">
                  {activity.orders.map((o) => {
                    const status = ORDER_STATUS[o.payment_status] || { label: o.payment_status || "Unknown", variant: "default" };
                    const free = Number(o.total_cents) === 0;
                    return (
                      <li key={o.id} className="flex flex-col gap-1 py-2.5">
                        <span className="font-medium text-[var(--color-text-primary)]">{o.event_title || "An offering that was removed"}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <span>{Number(o.ticket_count || 0).toLocaleString()} {Number(o.ticket_count) === 1 ? "ticket" : "tickets"}</span>
                          <span>{free ? "Free" : formatMoneyMinor(o.total_cents, o.currency)}</span>
                          {o.event_start_at && <span>· {formatDateTime(o.event_start_at)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-[var(--color-text-secondary)]">No tickets or RSVP orders yet. Tickets they buy or claim will appear here.</p>
              )
            )}

            {tab === "business" && (
              <div className="flex flex-col gap-4">
                {account ? (
                  <KV
                    rows={[
                      ["Business account", account.deleted_at ? `Closed ${formatDate(account.deleted_at)}` : account.business_name || "Open, no business name yet"],
                      ["Business email", account.email],
                      ["Mingla partner", account.partner_enabled ? `Yes${account.partner_country ? ` · ${account.partner_country}` : ""}` : "No"],
                    ]}
                  />
                ) : (
                  <p className="text-sm text-[var(--color-text-secondary)]">No business account.</p>
                )}
                {(() => {
                  const owned = (bundle?.brands_owned || []).filter((b) => !b.deleted_at).map((b) => ({ id: b.id, name: b.name, role: "brand_owner" }));
                  const member = (bundle?.brands_member || [])
                    .filter((m) => m.accepted_at && !m.removed_at && !owned.some((o) => o.id === m.brand_id))
                    .map((m) => ({ id: m.brand_id, name: m.brand_name, role: m.role }));
                  const brands = [...owned, ...member];
                  if (brands.length === 0) return <p className="text-sm text-[var(--color-text-secondary)]">Not on any brand's team.</p>;
                  return (
                    <ul className="flex flex-col gap-2">
                      {brands.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <a href={`#/brands?brandId=${encodeURIComponent(b.id)}`} className="font-medium text-[var(--color-brand-600)] underline-offset-2 hover:underline">
                            {b.name || "Unnamed brand"}
                          </a>
                          <Badge variant="outline">{brandRoleLabel(b.role)}</Badge>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}

            {tab === "subscription" && (
              <KV
                rows={[
                  ["Has now", tierLabel(bundle?.subscription?.effective_tier)],
                  ["Pays for", tierLabel(bundle?.subscription?.raw?.tier)],
                  ...(bundle?.active_override
                    ? [
                        ["Given by an admin", tierLabel(bundle.active_override.tier)],
                        ["Until", formatDateTime(bundle.active_override.expires_at)],
                      ]
                    : []),
                  ["Beta tester", person.is_beta_tester ? "Yes" : "No"],
                ]}
              />
            )}
          </div>

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

