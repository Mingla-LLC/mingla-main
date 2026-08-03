import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { pauseAdminStayOffering } from "../../services/stayAdminService";

export function StayPauseOfferingModal({ action, onClose, onReload }) {
  return (
    <HighRiskActionModal
      open={action?.kind === "stayPauseOffering"}
      onClose={onClose}
      title={`Pause ${action?.label || "Stay offering"}`}
      description="Stops new reservations for this Room or Place. It does not alter existing holds, commitments, prices, or money records."
      confirmLabel="Pause offering"
      destructive
      confirmPhrase="PAUSE"
      successMessage="Stay offering paused."
      onConfirm={async ({ reason }) => {
        await pauseAdminStayOffering({
          offeringId: action.targetId,
          expectedVersion: action.expectedVersion,
          reason,
        });
        onClose();
        await onReload();
      }}
    />
  );
}
