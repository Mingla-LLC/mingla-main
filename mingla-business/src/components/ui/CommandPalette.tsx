/**
 * CommandPalette — native passthrough stub.
 *
 * On native (iOS / Android), the ⌘K command palette is N/A — touchscreens
 * have no keyboard shortcut surface. Metro picks this file on native;
 * `CommandPalette.web.tsx` is the truth on web.
 *
 * Per SPEC_ORCH-0891 §3.5.6.
 */

import React from "react";

export const CommandPalette: React.FC = () => null;

export default CommandPalette;
