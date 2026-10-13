import { Badge } from "../ui/Badge";
import { stageBadgeVariant, stageLabel } from "../../lib/crmModel";

export function StageBadge({ def, stage }) {
  return <Badge variant={stageBadgeVariant(stage)}>{stageLabel(def, stage)}</Badge>;
}
