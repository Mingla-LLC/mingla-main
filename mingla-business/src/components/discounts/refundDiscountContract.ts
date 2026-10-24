export interface RefundSubmitReadiness {
  submitting: boolean;
  reasonValid: boolean;
  canRefund: boolean;
  hasCurrency: boolean;
  previewPending: boolean;
  previewFetching: boolean;
  previewDebouncing: boolean;
  previewError: boolean;
  previewLoaded: boolean;
  withinRemaining: boolean;
  previewAmountCents: number;
  hasSelection: boolean;
}

export const canSubmitRefundPreview = (
  readiness: RefundSubmitReadiness,
): boolean =>
  !readiness.submitting &&
  readiness.reasonValid &&
  readiness.canRefund &&
  readiness.hasCurrency &&
  !readiness.previewPending &&
  !readiness.previewFetching &&
  !readiness.previewDebouncing &&
  !readiness.previewError &&
  readiness.previewLoaded &&
  readiness.withinRemaining &&
  readiness.previewAmountCents > 0 &&
  readiness.hasSelection;
