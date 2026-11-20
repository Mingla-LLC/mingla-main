// #4518: the notice's prop types live here so the lazy full card can import
// them without importing the eager shell (no require cycle).
export type BuyerConnectionNoticeVariant = "connection" | "server" | "accessCheck";
export type BuyerConnectionNoticeLayout = "page" | "checkout" | "inline";

export interface BuyerConnectionNoticeProps {
  variant: BuyerConnectionNoticeVariant;
  onRetry: () => Promise<unknown> | void;
  onBack?: () => void;
  layout?: BuyerConnectionNoticeLayout;
  testID?: string;
  /** Defaults to `${testID}-retry` (the #2101 notice keeps its own id). */
  retryTestID?: string;
}

/** What either layer draws: the shell's copy and retry state. */
export interface BuyerConnectionNoticeViewProps
  extends Omit<BuyerConnectionNoticeProps, "onRetry"> {
  title: string;
  body: string;
  retrying: boolean;
  fails: number;
  onTryAgain: () => void;
}
