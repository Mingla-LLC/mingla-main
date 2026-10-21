// Who owns a host or creator card: the one people field (issue #3980, R9),
// with chips, type to find, me and the current owners suggested first, and
// invited teammates greyed. A thin wrapper so RecordDrawer and AddRecordForm
// keep their props; owners are still saved as addresses through the same
// crm_record_set_owners path.
// #3980 proof fix P2-5: a card that has owners keeps at least one (min 1),
// like a work card; the field explains why instead of sending, and the
// server refuses the same thing (last_owner).
import { PeopleField } from "../people/PeopleField";
import { usePeopleDirectory } from "../../hooks/usePeopleDirectory";
import { displayName } from "../../lib/crmModel";
import { normalizeTeam, suggestedPeople } from "../../lib/peopleField";

export function OwnersField({ team, value, onChange, disabled = false, labelId, min = 0 }) {
  const directory = usePeopleDirectory();
  const owners = Array.isArray(value) ? value.map((e) => String(e).toLowerCase()) : [];
  // The directory carries names, roles and open cards; until it loads, the
  // page's own team list is used.
  const people = directory.people.length
    ? directory.people
    : normalizeTeam((Array.isArray(team) ? team : []).map((p) => ({ ...p, name: p.display_name || displayName(p.email) })));
  return (
    <div className="sm:col-span-2">
      <PeopleField
        id={labelId}
        label="Owners"
        value={owners}
        team={people}
        suggested={suggestedPeople(directory.me, owners)}
        me={directory.me}
        disabled={disabled}
        min={min}
        onChange={(next) => onChange([...next].sort())}
        hint={owners.length === 0 ? "Nobody yet. Type a name, or Assign to me." : ""}
      />
    </div>
  );
}
