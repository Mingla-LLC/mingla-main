/**
 * #3988 — People and roles.
 *
 * One Community & Support role per teammate: Off, Support teammate or Support
 * lead. A Support teammate works both Community and Support. Owners and Admins
 * are included and can opt into the Support rota for alerts and availability.
 *
 * Reads and writes go only through the Owner/Admin RPCs
 * issue_3988_admin_people / issue_3988_set_permissions /
 * issue_3988_remove_orphan_staff. "Invite teammate" is the real team invite
 * (admin-team-invite, Owner only); permissions are set after sign-in.
 */

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, MoreHorizontal, RefreshCw, UserPlus } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SectionCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { TableRowSkeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { invokeWithRefresh } from "../../lib/supabase";
import { ROLE_LABELS } from "../../lib/access";
import { timeAgo } from "../../lib/formatters";
import {
  ROLE_CHOICES,
  ROLE_EXPLAINER,
  ROLE_TABLE,
  groupPeople,
  initialRoleChoice,
  isIncludedRole,
  permissionsErrorMessage,
  roleChoiceDescription,
  roleChoiceDoes,
  roleLabel,
  savedMessage,
} from "../../lib/peopleAndRoles";
import {
  TEAM_INVITE_HELP,
  TEAM_INVITE_OWNER_ONLY,
  TEAM_INVITE_ROLE_OPTIONS,
  isInviteEmail,
  sendTeamInvite,
  teamInviteErrorMessage,
} from "../../lib/teamInvite";
import {
  listPeopleAndPermissions,
  removeOrphanStaff,
  setPeoplePermissions,
} from "../../services/communityService";

const ROLE_BADGE = {
  included: "brand",
  included_rota: "brand",
  teammate: "info",
  lead: "warning",
  off: "default",
};

function teamRoleLabel(row) {
  return ROLE_LABELS[row?.team_role] || "Not on the team";
}

function GroupHeading({ label, count }) {
  return (
    <tr>
      <th
        colSpan={6}
        scope="colgroup"
        className="bg-[var(--gray-50)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
      >
        {label} · {count}
      </th>
    </tr>
  );
}

function PersonCell({ row }) {
  return (
    <td className="p-3">
      <strong className="block text-[var(--color-text-primary)]">{row.display_name}</strong>
      <span className="text-xs text-[var(--color-text-tertiary)]">{row.email}</span>
    </td>
  );
}

function RoleSegments({ value, onChange, disabled }) {
  return (
    <div
      role="radiogroup"
      aria-label="Community & Support role"
      className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--gray-100)] p-1"
    >
      {ROLE_CHOICES.map((choice) => {
        const on = value === choice.id;
        return (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(choice.id)}
            className={`min-h-[44px] rounded-lg px-2 text-sm font-semibold transition-colors ${
              on
                ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function RolesTable() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Everyone on the team has a team role. On top of it, an Owner or Admin gives each
        person one Community &amp; Support role. Moderator and Agent are gone: a Support
        teammate does both jobs.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]">
              <th className="p-2">Tab or action</th>
              <th className="p-2">Owner / Admin</th>
              <th className="p-2">Support teammate</th>
              <th className="p-2">Support lead</th>
              <th className="p-2">Teammate, role Off</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_TABLE.map(([label, ...cells]) => (
              <tr key={label} className="border-b border-[var(--gray-100)]">
                <td className="p-2 text-[var(--color-text-primary)]">{label}</td>
                {cells.map((cell, index) => (
                  <td
                    key={index}
                    className={`p-2 ${
                      cell === "Yes"
                        ? "font-semibold text-[var(--color-success-700)]"
                        : cell === "—"
                          ? "text-[var(--color-text-tertiary)]"
                          : "font-semibold text-[var(--color-info-700)]"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManageSheet({ row, onClose, onSaved }) {
  const included = isIncludedRole(row);
  const [choice, setChoice] = useState(() => initialRoleChoice(row));
  const [explain, setExplain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const does = roleChoiceDoes(choice);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setPeoplePermissions({ userId: row.user_id, role: choice });
      onSaved(savedMessage(row.display_name));
    } catch (err) {
      setError(permissionsErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={saving ? () => {} : onClose} title="Manage teammate" size="md">
      <ModalBody className="space-y-4">
        <div>
          <p className="text-base font-semibold text-[var(--color-text-primary)]">{row.display_name}</p>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            {row.email} · {teamRoleLabel(row)}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {included ? "Support rota (alerts and availability)" : "Community & Support role"}
          </p>
          {included ? (
            <p className="text-xs text-[var(--color-text-secondary)]">
              Included with Admin: all Community and Support work is already on. The rota only
              adds alerts and availability.
            </p>
          ) : null}
          <RoleSegments value={choice} onChange={(next) => { setChoice(next); setError(null); }} disabled={saving} />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {included && choice === "off"
              ? "Off the rota: no alerts and not shown as available. Admin access is unchanged."
              : roleChoiceDescription(choice, ROLE_LABELS[row.team_role])}
          </p>
          {does.length > 0 ? (
            <ul className="grid grid-cols-1 gap-1 text-sm text-[var(--color-text-primary)] sm:grid-cols-2">
              {does.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-[var(--color-success-700)]">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="rounded-lg border border-[var(--gray-200)]">
          <button
            type="button"
            aria-expanded={explain}
            onClick={() => setExplain((value) => !value)}
            className="flex min-h-[44px] w-full items-center justify-between px-3 text-sm font-medium text-[var(--color-text-primary)]"
          >
            What can each role do?
            <span className="text-xs text-[var(--color-text-tertiary)]">{explain ? "Hide" : "Show"}</span>
          </button>
          {explain ? (
            <div className="space-y-2 border-t border-[var(--gray-200)] p-3 text-sm text-[var(--color-text-secondary)]">
              {ROLE_EXPLAINER.map((item) => (
                <p key={item.title}>
                  <strong className="text-[var(--color-text-primary)]">{item.title}</strong> {item.body}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[var(--color-error-700)]">{error}</p>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      </ModalFooter>
    </Modal>
  );
}

function InviteSheet({ onClose, onSent }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("growth");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const canSend = isInviteEmail(email) && !sending;

  async function send(event) {
    event?.preventDefault?.();
    if (!canSend) return;
    setSending(true);
    setError(null);
    const result = await sendTeamInvite(invokeWithRefresh, { email, role });
    setSending(false);
    if (result.outcome === "sent" || result.outcome === "not_sent") {
      onSent(result);
      return;
    }
    setError(teamInviteErrorMessage(result));
  }

  return (
    <Modal open onClose={sending ? () => {} : onClose} title="Invite teammate" size="sm">
      <form onSubmit={send}>
        <ModalBody className="space-y-3">
          <Input
            label="Email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(null); }}
          />
          <label className="block text-sm font-medium text-[var(--color-text-primary)]">
            Team role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"
            >
              {TEAM_INVITE_ROLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="text-sm text-[var(--color-text-secondary)]">{TEAM_INVITE_HELP}</p>
          {error ? <p role="alert" className="text-sm text-[var(--color-error-700)]">{error}</p> : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={sending} onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={sending} disabled={!canSend}>Send invite</Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

export function TeamRolesPanel({ canInvite = false }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [managing, setManaging] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setRows(await listPeopleAndPermissions());
    } catch (error) {
      setLoadError(permissionsErrorMessage(error) === "Sign in again" ? "Sign in again" : "Couldn't load people.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function removeOldAccess(row) {
    setRemoving(row.user_id);
    try {
      await removeOrphanStaff(row.user_id);
      addToast({ variant: "success", title: "Old access removed", description: row.display_name });
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't remove old access", description: permissionsErrorMessage(error) });
    } finally {
      setRemoving(null);
    }
  }

  const groups = groupPeople(rows);
  const inviteButton = (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" icon={HelpCircle} onClick={() => setRolesOpen(true)}>
          What can each role do?
        </Button>
        <Button size="sm" icon={UserPlus} disabled={!canInvite} onClick={() => setInviting(true)}>
          Invite teammate
        </Button>
      </div>
      {!canInvite ? (
        <span className="text-xs text-[var(--color-text-tertiary)]">{TEAM_INVITE_OWNER_ONLY}</span>
      ) : null}
    </div>
  );

  let body;
  if (loading) {
    body = (
      <table className="w-full text-sm"><tbody>
        {[0, 1, 2].map((index) => <TableRowSkeleton key={index} columns={6} />)}
      </tbody></table>
    );
  } else if (loadError) {
    body = (
      <div className="flex flex-col items-start gap-3 p-5">
        <p role="alert" className="text-sm text-[var(--color-error-700)]">{loadError}</p>
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="p-5 text-sm text-[var(--color-text-secondary)]">
        {canInvite ? "No teammates yet. Invite someone to get started." : "No teammates yet."}
      </p>
    );
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]">
              <th className="p-3">Person</th>
              <th className="p-3">Team role</th>
              <th className="p-3">Community &amp; Support</th>
              <th className="p-3">Available</th>
              <th className="p-3">Last active</th>
              <th className="p-3"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {groups.team.length > 0 ? <GroupHeading label="Team" count={groups.team.length} /> : null}
            {groups.team.map((row) => (
              <tr key={row.user_id || row.email} className="border-b border-[var(--gray-100)]">
                <PersonCell row={row} />
                <td className="p-3 text-[var(--color-text-secondary)]">{teamRoleLabel(row)}</td>
                <td className="p-3"><Badge variant={ROLE_BADGE[row.role] || "default"}>{roleLabel(row)}</Badge></td>
                <td className="p-3">
                  {row.role === "off" || row.role === "included"
                    ? <span className="text-[var(--color-text-tertiary)]">—</span>
                    : <Badge variant={row.available ? "success" : "default"}>{row.available ? "Yes" : "No"}</Badge>}
                </td>
                <td className="p-3 text-xs text-[var(--color-text-secondary)]">{row.last_active ? timeAgo(row.last_active) : "Never"}</td>
                <td className="p-3 text-right">
                  {row.user_id ? (
                    <Button size="sm" variant="secondary" icon={MoreHorizontal} onClick={() => setManaging(row)}>
                      Manage
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--color-text-tertiary)]">Set after they sign in</span>
                  )}
                </td>
              </tr>
            ))}
            {groups.invited.length > 0 ? <GroupHeading label="Invited" count={groups.invited.length} /> : null}
            {groups.invited.map((row) => (
              <tr key={`invited-${row.email}`} className="border-b border-[var(--gray-100)]">
                <PersonCell row={row} />
                <td className="p-3 text-[var(--color-text-secondary)]">{teamRoleLabel(row)}</td>
                <td colSpan={3} className="p-3 text-sm text-[var(--color-text-secondary)]">
                  Waiting for them to accept the invite. Set their role after they sign in.
                </td>
                <td className="p-3 text-right text-xs text-[var(--color-text-tertiary)]">Invite sent</td>
              </tr>
            ))}
            {groups.former.length > 0 ? <GroupHeading label="Not on the team" count={groups.former.length} /> : null}
            {groups.former.map((row) => (
              <tr key={`former-${row.user_id || row.email}`} className="border-b border-[var(--gray-100)]">
                <PersonCell row={row} />
                <td className="p-3 text-[var(--color-text-secondary)]">{teamRoleLabel(row)}</td>
                <td colSpan={3} className="p-3">
                  <p className="rounded-lg border border-[var(--color-error-200,var(--gray-300))] px-3 py-2 text-sm text-[var(--color-error-700)]">
                    Has old Support access that no longer works. They&apos;re not on the Mingla team,
                    so they can&apos;t see tickets or show as available.
                  </p>
                </td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={removing === row.user_id}
                    disabled={!row.user_id || Boolean(removing)}
                    onClick={() => void removeOldAccess(row)}
                  >
                    Remove old access
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <SectionCard
      title="People and roles"
      subtitle="Choose who works Community and Support. Owners and Admins have it already."
      action={inviteButton}
      noPadding
    >
      {body}
      {managing ? (
        <ManageSheet
          row={managing}
          onClose={() => setManaging(null)}
          onSaved={(message) => {
            addToast({ variant: "success", title: `Permissions saved for ${managing.display_name}`, description: message });
            setManaging(null);
            void load();
          }}
        />
      ) : null}
      {inviting ? (
        <InviteSheet
          onClose={() => setInviting(false)}
          onSent={(result) => {
            setInviting(false);
            addToast(result.outcome === "sent"
              ? { variant: "success", title: "Invite sent", description: `${result.email} will get an email to join Mingla Admin.` }
              : { variant: "warning", title: "Invited, but the email didn't send", description: "Use \"Resend invite\" in Admin → Team." });
            void load();
          }}
        />
      ) : null}
      <Modal open={rolesOpen} onClose={() => setRolesOpen(false)} title="What can each role do?" size="lg">
        <ModalBody><RolesTable /></ModalBody>
        <ModalFooter><Button variant="secondary" onClick={() => setRolesOpen(false)}>Done</Button></ModalFooter>
      </Modal>
    </SectionCard>
  );
}
