import { Badge } from "../ui/Badge";
import { dueState, shortDate } from "../../lib/crmModel";

/** Overdue, Today, a short date, or nothing when there is no date. */
export function DueBadge({ dueOn, today }) {
  const state = dueState(dueOn, today);
  if (state === "none") return null;
  if (state === "overdue") {
    return (
      <Badge variant="error">
        <span title={`Was due ${shortDate(dueOn, today)}`}>Overdue</span>
      </Badge>
    );
  }
  if (state === "today") return <Badge variant="warning">Today</Badge>;
  return <Badge variant="default">{shortDate(dueOn, today)}</Badge>;
}
