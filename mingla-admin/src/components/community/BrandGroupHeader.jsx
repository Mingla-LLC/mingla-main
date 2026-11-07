// Issue #4270 (Wave 7) — the thread header: who the brand is, where its host
// card stands, who on the team owns it, and the staff actions (Assign to me,
// Host card, Mute). Staff without Hosts and Creators access see the name, the
// team line and Mute only. Every button stays on this page.
import { Bell, BellOff, PanelRight } from "lucide-react";
import { useCrmConfig } from "../../hooks/useCrmConfig";
import { setOwners } from "../../services/crmService";
import { icpLabel, regionName, stageLabel } from "../../lib/crmModel";
import { BRAND_ROLE_WORDS } from "../../lib/opsModel";
import { teammatesWords } from "../../lib/brandGroupInbox";
import { GroupAvatar } from "./BrandGroupList";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const CHIP = "rounded-md px-1.5 py-0.5 text-[11px]";
const BUTTON = `inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 text-[13px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] disabled:opacity-50 ${FOCUS}`;

/** Stage and "Lagos · Event organizer" (needs the Hosts and Creators config). */
function HostChips({ host }) {
  const { config } = useCrmConfig();
  const def = config?.pipelines?.hosts || null;
  const stage = stageLabel(def, host.stage);
  const where = [regionName(config?.regions, host.region_id), icpLabel(def, host.icp)].filter(Boolean).join(" · ");
  return (
    <>
      {stage && <span data-header-stage="" className={`${CHIP} font-semibold bg-[var(--color-success-50)] text-[var(--color-success-700)]`}>{stage}</span>}
      {where && <span className={`${CHIP} bg-[var(--gray-100)] text-[var(--color-text-secondary)]`}>{where}</span>}
    </>
  );
}

/**
 * Assign to me: add me to the host card's owners (the same crm path the host
 * card uses). Kept here, beside the button, so the Brand groups tab itself
 * reaches only Support RPCs (#3988 capability contract).
 */
export async function assignHostToMe(host, myEmail) {
  const emails = [...new Set([...(host?.owners || []).map((o) => String(o.email || "").toLowerCase()).filter(Boolean), String(myEmail || "").toLowerCase()].filter(Boolean))].sort();
  return setOwners(host.record_id, emails);
}

/** "1 teammate · info (Owner)". */
export function teamLine(memberCount, people) {
  const named = (Array.isArray(people) ? people : []).slice(0, 2)
    .map((p) => `${p.display_name} (${BRAND_ROLE_WORDS[p.role] || "Team"})`);
  return [teammatesWords(memberCount), ...named].join(" · ");
}

export function BrandGroupHeader({
  group, host, canHosts, people, hostCard, online,
  canAssign, assigning, onAssign, onToggleMute, onRailButton, railButtonLabel,
}) {
  if (!group) return null;
  const owners = Array.isArray(host?.owners) ? host.owners : [];
  const showHost = canHosts && !!host;
  return (
    <div data-thread-header="" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--gray-100)] px-4 py-3 sm:px-[18px]">
      <GroupAvatar group={group} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id="brand-group-thread-title" tabIndex={-1} className="truncate text-[16px] font-bold text-[var(--color-text-primary)] outline-none">{group.brand_name}</h2>
          {showHost && <HostChips host={host} />}
        </div>
        <p className="truncate text-[12px] text-[var(--color-text-tertiary)]">
          {teamLine(group.member_count, people)}
          {showHost && (
            <>
              {" · Mingla owner: "}
              {owners.length
                ? <span className="text-[var(--color-text-secondary)]">{owners.map((o) => o.name).join(", ")}</span>
                : <span data-no-owner="" className="font-semibold text-[var(--color-error-700)]">No owner</span>}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {showHost && canAssign && (
          <button type="button" className={BUTTON} disabled={!online || assigning} onClick={onAssign}>
            {assigning ? "Assigning…" : "Assign to me"}
          </button>
        )}
        {hostCard}
        {onRailButton && (
          <button type="button" data-rail-button="" className={BUTTON} onClick={onRailButton}>
            <PanelRight aria-hidden="true" className="h-4 w-4" />{railButtonLabel}
          </button>
        )}
        <button type="button" aria-label={group.muted ? "Unmute this Brand group" : "Mute this Brand group"} aria-pressed={group.muted ? "true" : "false"}
          onClick={onToggleMute}
          className={`flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>
          {group.muted ? <BellOff aria-hidden="true" className="h-4 w-4" /> : <Bell aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
