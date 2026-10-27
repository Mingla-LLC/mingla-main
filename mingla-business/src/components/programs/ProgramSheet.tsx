/**
 * #3872 round 2 follow-ups — the app's Sheet for program screens, closed when
 * its screen blurs or unmounts so it never stays on top of another route.
 */
import React from "react";

import { Sheet, type SheetProps } from "../ui/Sheet";
import { useCloseOnBlur } from "./useScreenLifecycle";

export function ProgramSheet(props: SheetProps): React.ReactElement {
  useCloseOnBlur(props.visible, props.onClose);
  return <Sheet {...props} />;
}
