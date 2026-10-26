// Issue #4130 (Wave 6) — "N of M pushes failed" on the Support page, with
// Retry. Admin-only: the delivery list and the retry are Admin RPCs
// (is_admin_user). Retry reuses the Announcements tab's path
// (retryAnnouncementDelivery -> issue_3720_admin_retry_announcement), which
// puts the failed notification jobs back in the queue; nothing new sends.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoadError } from "../ui/LoadError";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/formatters";
import { announcementsWithFailedPushes } from "../../lib/announcementDelivery";
import { listAnnouncementDeliveries, retryAnnouncementDelivery } from "../../services/communityService";

export function FailedPushBanner() {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: null, failed: [] });
  const [confirming, setConfirming] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const rows = await listAnnouncementDeliveries();
      setState({ loading: false, error: null, failed: announcementsWithFailedPushes(rows) });
    } catch (error) {
      setState({ loading: false, error: error?.message || "Try again in a moment.", failed: [] });
    }
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function retry() {
    if (!confirming) return;
    setRetrying(true);
    try {
      const requeued = await retryAnnouncementDelivery(confirming.campaignId);
      addToast({
        variant: "success",
        title: "Sending again",
        description: `${requeued} failed send${requeued === 1 ? "" : "s"} went back in the queue.`,
      });
      setConfirming(null);
      await load();
    } catch (error) {
      addToast({ variant: "error", title: "Couldn't retry", description: error?.message });
    } finally {
      setRetrying(false);
    }
  }

  if (state.loading) return null;
  if (state.error) {
    return (
      <LoadError
        title="Couldn't check announcement pushes"
        message={state.error}
        onRetry={() => void load()}
      />
    );
  }
  const latest = state.failed[0];
  if (!latest) return null;
  const others = state.failed.length - 1;

  return (
    <>
      <AlertCard
        variant="error"
        title={`${latest.failed} of ${latest.tried} pushes failed`}
        action={
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setConfirming(latest)}>
            Retry {latest.failed}
          </Button>
        }
      >
        On the {latest.sentAt ? `${formatDate(latest.sentAt)} ` : ""}announcement
        {latest.title ? ` "${latest.title}"` : ""}. Those hosts did not get it on their phone.
        {others > 0 ? ` ${others} older announcement${others === 1 ? " has" : "s have"} failed pushes too: see Community, Announcements.` : ""}
      </AlertCard>
      <Modal open={Boolean(confirming)} onClose={() => (retrying ? null : setConfirming(null))} title="Send the failed pushes again?">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {confirming?.failed} host{confirming?.failed === 1 ? "" : "s"} didn&apos;t get the push for
            {confirming?.title ? ` "${confirming.title}"` : " this announcement"}. Retry sends it to them again.
            Hosts whose push already arrived are not sent it again.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" disabled={retrying} onClick={() => setConfirming(null)}>Cancel</Button>
          <Button loading={retrying} onClick={() => void retry()}>Retry {confirming?.failed}</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
