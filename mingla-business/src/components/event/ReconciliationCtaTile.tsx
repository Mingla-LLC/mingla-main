/**
 * ReconciliationCtaTile — Permission-gated ActionTile for Event Detail action grid (Cycle 13).
 *
 * Per DEC-095 D-13-3: gated on MIN_RANK.VIEW_RECONCILIATION (finance_manager rank 30).
 *
 * Const #1 — no dead taps: returns null when permission missing (NOT disabled
 * with caption); the tile entirely disappears for sub-rank users to keep the
 * action grid clean. Sub-rank users navigating directly to the reconciliation
 * route via deep-link see a friendly NotAuthorizedShell (route-level gate).
 *
 * Per Cycle 13 SPEC §4.3.1.
 */

import React from "react";

import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction } from "../../utils/permissionGates";
import { ActionTile } from "./ActionTile";

export interface ReconciliationCtaTileProps {
  brandId: string | null;
  onPress: () => void;
}

export const ReconciliationCtaTile: React.FC<ReconciliationCtaTileProps> = ({
  brandId,
  onPress,
}) => {
  const { rank } = useCurrentBrandRole(brandId);
  if (!canPerformAction(rank, "VIEW_RECONCILIATION")) return null;
  return <ActionTile icon="chart" label="Reconciliation" onPress={onPress} />;
};

export default ReconciliationCtaTile;
