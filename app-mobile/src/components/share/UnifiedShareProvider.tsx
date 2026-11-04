import React, { createContext, memo, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Clipboard, findNodeHandle, Platform, Pressable, StyleSheet, Switch, Text, View, useColorScheme, useWindowDimensions, ActivityIndicator, type LayoutChangeEvent, type ListRenderItem } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Image as ExpoImage } from 'expo-image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { checkContentShareReadinessDetailed, normalizeContentShareNote, selectCompactPreviewFacts, shareKindLabel, statusLabel } from '@mingla/sharing';
import { BaseBottomSheet, BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/colors';
import {
  adoptContentShareVersion, prepareContentShare, sharePreparedContent,
  type ContentShareFailureReason, type PreparedContentShare,
  trackContentShareEvent,
} from '../../services/contentShareAdapter';
import {
  clearContentShareOperationId, listContentShareRecipients, loadContentShareOperation, reconcileContentShareOperation,
  sendContentShareToRecipients, subscribeContentShareRecipientInvalidation, type ContentShareRecipient,
} from '../../services/contentShareDeliveryService';
import { registerContentShareHandler, type ContentShareProducerSurface, type OpenContentShareInput } from '../../services/contentShareController';
import { HapticFeedback } from '../../utils/hapticFeedback';
import { contentShareRecipientKeys } from '../../hooks/queryKeys';
import { useAppStore } from '../../store/appStore';
import {
  SHARE_RECIPIENT_FIXED_ROW_MAX_FONT_SCALE, SHARE_RECIPIENT_PLACEHOLDER_WIDTHS,
  filterShareRecipients, indexShareRecipients, normalizeShareSearch,
  shareRecipientItemLayout, shareRecipientKeyExtractor, shareRecipientListPhase,
  type ShareRecipientRow,
} from './shareRecipientsModel';
import {
  beginShareSheetOpen, beginShareSheetScroll, endShareSheetScroll,
  markShareRecipientsRendered, markShareSheetFirstFrame, markShareSheetSettled,
} from './shareSheetPerf';

/**
 * #2589 — one string per cause. Byte-mirrored in
 * `mingla-business/src/components/ui/ShareModalContent.tsx`; the generic string
 * survives only for a genuinely unknown failure, and the two causes a Retry
 * cannot fix no longer offer one.
 */
const SHARE_FAILURE_COPY: Record<ContentShareFailureReason, string> = {
  not_public: "This isn't public yet. Publish it, then share.",
  unauthorized: 'Sign in to share this.',
  unavailable: "Sharing is briefly unavailable. Try again in a moment.",
  unknown: "Couldn't prepare this share",
};
/** Only these two can change on a second attempt. */
const RETRYABLE_SHARE_FAILURES = new Set<ContentShareFailureReason>(['unavailable', 'unknown']);

/**
 * Reads the reason the adapter attached to the rejection. Local and pure, and
 * byte-mirrored in `mingla-business/src/components/ui/ShareModalContent.tsx`:
 * the failure path must not depend on loading another module. Anything
 * unrecognised is `unknown`, which keeps the original generic copy and Retry.
 */
function shareFailureReasonOf(error: unknown): ContentShareFailureReason {
  const reason = (error as { reason?: unknown } | null | undefined)?.reason;
  return reason === 'not_public' || reason === 'unauthorized' || reason === 'unavailable' ? reason : 'unknown';
}

export type SharePresentationFailureClass =
  | 'parent_modal_still_presented'
  | 'presentation_timeout'
  | 'presentation_rejected';

export type SharePresentationObservation = {
  readonly correlationId: string;
  readonly presented: Promise<void>;
  readonly dismissalRequested: Promise<void>;
  readonly dismissed: Promise<void>;
  cancel: (failureClass: SharePresentationFailureClass) => void;
};

type PresentationDeferred = {
  readonly promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
};

type PresentationAttempt = {
  readonly correlationId: string;
  readonly producerSurface: ContentShareProducerSurface;
  readonly requestedAt: number;
  readonly presented: PresentationDeferred;
  readonly dismissalRequested: PresentationDeferred;
  readonly dismissed: PresentationDeferred;
  input: OpenContentShareInput | null;
  presentedAt: number | null;
  failureEmitted: boolean;
  finalized: boolean;
};

type UnifiedShareContextValue = {
  openContentShare: (input: OpenContentShareInput) => void;
  beginExpandedPresentation: (producerSurface: Exclude<ContentShareProducerSurface, 'direct'>) => SharePresentationObservation;
};
const UnifiedShareContext = createContext<UnifiedShareContextValue | null>(null);

export function useUnifiedShare(): UnifiedShareContextValue {
  const value = useContext(UnifiedShareContext);
  if (!value) throw new Error('UnifiedShareProvider is missing');
  return value;
}

function createPresentationDeferred(): PresentationDeferred {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  const deferred: PresentationDeferred = {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: () => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise?.();
    },
    reject: (error) => {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise?.(error);
    },
    settled: false,
  };
  // #1880: cancellation may win before the expanded caller attaches its real
  // waiter. Observe rejection internally without replacing the Promise exposed
  // to that waiter; later awaiters still receive the original rejection.
  void deferred.promise.then(undefined, () => undefined);
  return deferred;
}

type ShareStyles = ReturnType<typeof createStyles>;

/** #4265: how long to wait for the open animation's settle callback before applying results anyway. */
const OPEN_SETTLE_FALLBACK_MS = 450;
const EMPTY_ROWS: readonly ShareRecipientRow[] = [];

type RecipientRowProps = {
  recipient: ShareRecipientRow;
  active: boolean;
  sent: boolean;
  sending: boolean;
  fixedHeight: boolean;
  onToggle: (key: string) => void;
  styles: ShareStyles;
};

/**
 * #4265: one memoised row. Its props are primitives plus a row object that only
 * changes when the fetched list changes, so a keystroke or a tap on another row
 * does not re-render it.
 */
const RecipientRow = memo(function RecipientRow({ recipient, active, sent, sending, fixedHeight, onToggle, styles }: RecipientRowProps): React.ReactElement {
  const onPress = useCallback(() => onToggle(recipient.key), [onToggle, recipient.key]);
  const stateLabel = sent ? 'Sent' : active ? 'Selected' : 'Not selected';
  return <Pressable onPress={onPress} disabled={sent || sending} accessibilityRole="checkbox" accessibilityLabel={`${recipient.displayName}. ${stateLabel}`} accessibilityState={{ checked: active, disabled: sent || sending }} style={[styles.recipient, fixedHeight && styles.recipientFixed, active && styles.recipientSelected]}>
    {recipient.avatarUrl ? <ExpoImage source={{ uri: recipient.avatarUrl }} style={styles.avatar} cachePolicy="memory-disk" recyclingKey={recipient.key} contentFit="cover" transition={0} accessible={false} /> : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{recipient.initials}</Text></View>}
    <View style={styles.recipientCopy}><Text numberOfLines={1} style={styles.recipientName}>{recipient.displayName}</Text><Text numberOfLines={1} style={styles.recipientMeta}>{recipient.metaLabel}</Text></View>
    {sent ? <Text style={styles.sentLabel}>Sent</Text> : <View style={[styles.check, active && styles.checkActive]}><Text style={styles.checkText}>{active ? '✓' : ''}</Text></View>}
  </Pressable>;
});

/** #4265: first-ever open only — same 60pt layout as a real row (avatar circle + name bar). */
const RecipientPlaceholders = memo(function RecipientPlaceholders({ styles }: { styles: ShareStyles }): React.ReactElement {
  return <View accessibilityLabel="Loading people and chats" accessible>
    {SHARE_RECIPIENT_PLACEHOLDER_WIDTHS.map((width) => <View key={width} style={styles.placeholderRow}>
      <View style={styles.placeholderAvatar} />
      <View style={[styles.placeholderBar, { width }]} />
    </View>)}
  </View>;
});

export function UnifiedShareProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const dark = useColorScheme() === 'dark';
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const userId = useAppStore((state) => state.user?.id ?? null);
  const styles = useMemo(() => createStyles(dark), [dark]);
  const generation = useRef(0);
  const posterStartedAt = useRef(0);
  const actionInFlight = useRef(false);
  const presentationSequence = useRef(0);
  const pendingExpandedAttempt = useRef<PresentationAttempt | null>(null);
  const activePresentationAttempt = useRef<PresentationAttempt | null>(null);
  const inputRef = useRef<OpenContentShareInput | null>(null);
  const mountedRef = useRef(true);
  const shareHeadingRef = useRef<Text | null>(null);
  // #4265: results that land while the sheet is still animating open wait here
  // and are applied together once it settles, so the animation is not
  // interrupted by three or four separate re-renders.
  const openSettledRef = useRef(true);
  const afterOpenQueue = useRef<(() => void)[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listHeaderHeight = useRef(0);
  const [visible, setVisible] = useState(false);
  const [nativeCycleId, setNativeCycleId] = useState<string | null>(null);
  const [input, setInput] = useState<OpenContentShareInput | null>(null);
  const [prepared, setPrepared] = useState<PreparedContentShare | null>(null);
  // #2589 — WHY it failed, not just THAT it failed. `null` = no failure.
  const [prepFailure, setPrepFailure] = useState<ContentShareFailureReason | null>(null);
  // #4265: when this open started; recipients fetched at or after it are fresh.
  const [openedAt, setOpenedAt] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [deliveryState, setDeliveryState] = useState<Record<string, 'sent' | 'failed'>>({});
  const [posterFailed, setPosterFailed] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [showSharer, setShowSharer] = useState(false);
  // #4265: connectivity is only watched while the sheet is open (it used to be
  // useNetInfo at the app root, re-rendering this provider on every change).
  const [isOffline, setIsOffline] = useState(false);
  const [readiness, setReadiness] = useState<'idle' | 'pending' | 'retrying' | 'ready' | 'waiting' | 'transient' | 'terminal' | 'offline'>('idle');
  const [outcome, setOutcome] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; sent: number }
    | { kind: 'partial'; sent: number; failed: number }
    | { kind: 'failed'; failed: number }
  >({ kind: 'idle' });

  // #4265: people and chats live in React Query (persisted), so a reopen shows
  // the last list at once and the sheet refreshes it in the background. Nothing
  // fetches at app start (`enabled: false`); the open path calls fetchQuery.
  const recipientsKey = useMemo(() => contentShareRecipientKeys.list(userId ?? 'signed-out'), [userId]);
  const recipientsKeyRef = useRef(recipientsKey);
  recipientsKeyRef.current = recipientsKey;
  const recipientsQuery = useQuery({
    queryKey: recipientsKey,
    queryFn: listContentShareRecipients,
    select: indexShareRecipients,
    enabled: false,
    retry: false,
  });
  const recipients: readonly ShareRecipientRow[] = recipientsQuery.data ?? EMPTY_ROWS;
  const hasRecipientData = recipientsQuery.data !== undefined;
  const recipientsFetching = recipientsQuery.fetchStatus === 'fetching';
  const recipientsReady = openedAt > 0 && recipientsQuery.status === 'success' && recipientsQuery.dataUpdatedAt >= openedAt;
  const recipientError = openedAt > 0 && !recipientsFetching && recipientsQuery.errorUpdatedAt >= openedAt && recipientsQuery.errorUpdatedAt > recipientsQuery.dataUpdatedAt;

  const flushAfterOpen = useCallback((): void => {
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (openSettledRef.current) return;
    openSettledRef.current = true;
    const queued = afterOpenQueue.current;
    afterOpenQueue.current = [];
    for (const apply of queued) apply();
  }, []);
  const runAfterOpen = useCallback((apply: () => void): void => {
    if (openSettledRef.current) apply();
    else afterOpenQueue.current.push(apply);
  }, []);

  const loadShare = useCallback((nextInput: OpenContentShareInput, token: number): void => {
    const startedAt = Date.now();
    setPrepFailure(null);
    void prepareContentShare(nextInput.kind, nextInput.identity, 'generic', nextInput.messageContext)
      .then((value) => {
        const durationMs = Date.now() - startedAt;
        runAfterOpen(() => {
          if (generation.current === token) {
            setPrepared(value);
            trackContentShareEvent('share_link_ready', { kind: nextInput.kind, duration_ms: durationMs });
          }
        });
        console.info('[content-share] preparation', { result: 'ready', durationMs });
      })
      .catch((error: unknown) => {
        const reason = shareFailureReasonOf(error);
        runAfterOpen(() => { if (generation.current === token) setPrepFailure(reason); });
        trackContentShareEvent('share_failure', { kind: nextInput.kind, failure_type: 'prepare', failure_reason: reason, duration_ms: Date.now() - startedAt });
        console.info('[content-share] preparation', { result: 'failed', failureReason: reason, durationMs: Date.now() - startedAt });
      });
  }, [runAfterOpen]);

  const loadRecipients = useCallback((): void => {
    const startedAt = Date.now();
    // fetchQuery writes the cache; the sheet re-renders once, from the query.
    // Structural sharing keeps the same array when nothing changed, so an
    // unchanged list re-renders no rows at all.
    void queryClient.fetchQuery({ queryKey: recipientsKeyRef.current, queryFn: listContentShareRecipients, staleTime: 0, retry: false })
      .then((value) => {
        console.info('[content-share] recipients', { result: 'ready', durationMs: Date.now() - startedAt, count: value.length });
      })
      .catch(() => {
        console.info('[content-share] recipients', { result: 'failed', durationMs: Date.now() - startedAt });
      });
  }, [queryClient]);

  // A fresh list can drop chats the person had selected (from a cached row).
  // Prune them and say so; this only re-renders when something was removed.
  useEffect(() => {
    if (!recipientsReady) return;
    const availableKeys = new Set(recipients.map((recipient) => recipient.key));
    setSelected((current) => {
      const next = new Set(Array.from(current).filter((key) => availableKeys.has(key)));
      const removedCount = current.size - next.size;
      if (removedCount > 0) {
        AccessibilityInfo.announceForAccessibility(removedCount === 1
          ? 'That selected chat is no longer available.'
          : `${removedCount} selected chats are no longer available.`);
      }
      return removedCount > 0 ? next : current;
    });
  }, [recipients, recipientsReady]);

  const emitPresentationFailure = useCallback((
    attempt: PresentationAttempt,
    failureClass: SharePresentationFailureClass,
  ): void => {
    if (attempt.failureEmitted) return;
    attempt.failureEmitted = true;
    const kind = attempt.input?.kind ?? 'place';
    trackContentShareEvent('share_failure', {
      kind,
      producer_surface: attempt.producerSurface,
      platform: Platform.OS,
      duration_ms: Math.max(0, Date.now() - attempt.requestedAt),
      request_correlation: attempt.correlationId,
      failure_type: failureClass,
    });
  }, []);

  const beginExpandedPresentation = useCallback((
    producerSurface: Exclude<ContentShareProducerSurface, 'direct'>,
  ): SharePresentationObservation => {
    if (pendingExpandedAttempt.current !== null || activePresentationAttempt.current !== null || visible) {
      throw new Error('share_presentation_busy');
    }
    presentationSequence.current += 1;
    const attempt: PresentationAttempt = {
      correlationId: `expanded-${presentationSequence.current}`,
      producerSurface,
      requestedAt: Date.now(),
      presented: createPresentationDeferred(),
      dismissalRequested: createPresentationDeferred(),
      dismissed: createPresentationDeferred(),
      input: null,
      presentedAt: null,
      failureEmitted: false,
      finalized: false,
    };
    pendingExpandedAttempt.current = attempt;
    return {
      correlationId: attempt.correlationId,
      presented: attempt.presented.promise,
      dismissalRequested: attempt.dismissalRequested.promise,
      dismissed: attempt.dismissed.promise,
      cancel: (failureClass) => {
        const isPending = pendingExpandedAttempt.current === attempt;
        const isActive = activePresentationAttempt.current === attempt;
        if (!isPending && !isActive) return;
        emitPresentationFailure(attempt, failureClass);
        attempt.presented.reject(new Error(failureClass));
        if (isPending) {
          pendingExpandedAttempt.current = null;
          attempt.dismissalRequested.resolve();
          attempt.dismissed.resolve();
          return;
        }
        attempt.dismissalRequested.resolve();
        generation.current += 1;
        if (mountedRef.current) setVisible(false);
      },
    };
  }, [emitPresentationFailure, visible]);

  const openContentShare = useCallback((nextInput: OpenContentShareInput): void => {
    if (activePresentationAttempt.current !== null || visible) {
      throw new Error('share_presentation_busy');
    }
    beginShareSheetOpen();
    const shellStartedAt = Date.now();
    const token = generation.current + 1;
    generation.current = token;
    const pending = pendingExpandedAttempt.current;
    if (
      pending !== null &&
      nextInput.producerSurface !== pending.producerSurface
    ) {
      throw new Error('share_presentation_busy');
    }
    const attempt = pending ?? {
      correlationId: `direct-${token}`,
      producerSurface: nextInput.producerSurface ?? 'direct',
      requestedAt: shellStartedAt,
      presented: createPresentationDeferred(),
      dismissalRequested: createPresentationDeferred(),
      dismissed: createPresentationDeferred(),
      input: null,
      presentedAt: null,
      failureEmitted: false,
      finalized: false,
    };
    pendingExpandedAttempt.current = null;
    attempt.input = nextInput;
    activePresentationAttempt.current = attempt;
    inputRef.current = nextInput;
    // #4265: hold network results until the sheet has finished opening.
    openSettledRef.current = false;
    afterOpenQueue.current = [];
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(flushAfterOpen, OPEN_SETTLE_FALLBACK_MS);
    // One batched commit (React 18 automatic batching): every reset below and
    // visible=true render together. Cached recipients are part of this render.
    setNativeCycleId(attempt.correlationId);
    setInput(nextInput); setPrepared(null); setPrepFailure(null); setOpenedAt(shellStartedAt);
    setSelected(new Set()); setNote(''); setNoteExpanded(false);
    setSearch(''); setCopied(false); setSending(false);
    setDeliveryState({}); setPosterFailed(false); setExternalError(null);
    setShowSharer(nextInput.messageContext?.showSharer === true);
    setReadiness('idle');
    setOutcome({ kind: 'idle' });
    trackContentShareEvent('share_presentation_requested', {
      kind: nextInput.kind,
      producer_surface: attempt.producerSurface,
      platform: Platform.OS,
      duration_ms: 0,
      request_correlation: attempt.correlationId,
    });
    setVisible(true); // synchronous: never wait before opening.
    console.info('[content-share] shell', { result: 'committed', durationMs: Date.now() - shellStartedAt });
    // Both requests start now (nothing is awaited); their results are applied
    // after the open animation (prepare) or through the query cache (recipients).
    loadShare(nextInput, token);
    loadRecipients();
  }, [flushAfterOpen, loadRecipients, loadShare, visible]);

  useEffect(() => { registerContentShareHandler(openContentShare); return () => registerContentShareHandler(null); }, [openContentShare]);
  useEffect(() => () => {
    mountedRef.current = false;
    generation.current += 1;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const settleForUnmount = (attempt: PresentationAttempt | null): void => {
      if (attempt === null || attempt.finalized) return;
      attempt.finalized = true;
      attempt.presented.reject(new Error('presentation_rejected'));
      attempt.dismissalRequested.resolve();
      attempt.dismissed.resolve();
    };
    settleForUnmount(pendingExpandedAttempt.current);
    settleForUnmount(activePresentationAttempt.current);
    pendingExpandedAttempt.current = null;
    activePresentationAttempt.current = null;
    inputRef.current = null;
    registerContentShareHandler(null);
  }, []);
  useEffect(() => subscribeContentShareRecipientInvalidation(() => {
    if (visible) loadRecipients();
    // Closed: mark the cached list stale so the next open refreshes it.
    else void queryClient.invalidateQueries({ queryKey: contentShareRecipientKeys.all, refetchType: 'none' });
  }), [loadRecipients, queryClient, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    return NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, [visible]);

  useEffect(() => {
    if (visible) markShareSheetFirstFrame();
  }, [visible]);

  const verifyReadiness = useCallback((retrying = false): void => {
    if (!prepared?.media) { setReadiness('ready'); return; }
    if (isOffline) { setReadiness('offline'); return; }
    const token = generation.current;
    setReadiness(retrying ? 'retrying' : 'pending');
    void checkContentShareReadinessDetailed(prepared.shortCode, prepared.version).then((result) => {
      if (generation.current !== token || AppState.currentState !== 'active') return;
      // #2589 — the share page re-derives on read, so it can legitimately have
      // moved past the version create handed us. That is ready, not broken, and
      // the prepared share follows the server's version rather than pinning a
      // number the page has left behind. This is also what stops the
      // AppState-'active' re-check greying out Share AFTER a successful share.
      //
      // The adoption itself belongs to the adapter: this sheet previews the
      // COVER and must never handle the generated portrait card's URL.
      const served = result.version;
      if (result.state === 'ready' && served !== null) {
        setPrepared((current) => (current && current.shortCode === prepared.shortCode
          ? adoptContentShareVersion(current, served)
          : current));
      }
      setReadiness(result.state);
    });
  }, [isOffline, prepared]);

  useEffect(() => { if (prepared) verifyReadiness(false); }, [prepared, verifyReadiness]);
  useEffect(() => {
    // #4265: only while the sheet is open — a closed sheet has nothing to re-check.
    if (!visible) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && prepared?.media) verifyReadiness(true);
    });
    return () => subscription.remove();
  }, [prepared?.media, verifyReadiness, visible]);
  useEffect(() => {
    if (!prepared || !recipientsReady) return;
    const token = generation.current;
    void loadContentShareOperation(prepared.shortCode, prepared.version).then((operation) => {
      if (!operation || generation.current !== token) return;
      void reconcileContentShareOperation(operation, recipients).then((reconciled) => {
        if (generation.current !== token) return;
        setNote(reconciled.senderNote ?? '');
        setNoteExpanded(reconciled.senderNote !== null);
        setDeliveryState(Object.fromEntries(reconciled.targets.filter((target) => target.state !== 'pending').map((target) => [target.key, target.state as 'sent' | 'failed'])));
        setSelected(new Set(reconciled.targets.filter((target) => target.state !== 'sent').map((target) => target.key)));
      });
    });
  }, [prepared, recipients, recipientsReady]);

  useEffect(() => {
    posterStartedAt.current = prepared?.media?.posterUrl ? Date.now() : 0;
  }, [prepared?.media?.posterUrl]);

  const handleNativeShow = useCallback((correlationId: string | null): void => {
    const attempt = activePresentationAttempt.current;
    if (
      !mountedRef.current ||
      correlationId === null ||
      attempt === null ||
      attempt.correlationId !== correlationId ||
      attempt.input === null ||
      attempt.presented.settled ||
      attempt.dismissalRequested.settled ||
      attempt.finalized
    ) return;
    attempt.presentedAt = Date.now();
    const properties = {
      kind: attempt.input.kind,
      producer_surface: attempt.producerSurface,
      platform: Platform.OS,
      duration_ms: Math.max(0, attempt.presentedAt - attempt.requestedAt),
      request_correlation: attempt.correlationId,
    };
    const headingNode = findNodeHandle(shareHeadingRef.current);
    if (headingNode !== null) AccessibilityInfo.setAccessibilityFocus(headingNode);
    trackContentShareEvent('share_sheet_opened', { ...properties, result: 'presented' });
    trackContentShareEvent('share_sheet_presented', properties);
    attempt.presented.resolve();
  }, []);

  const handleNativeDismiss = useCallback((correlationId: string | null): void => {
    const attempt = activePresentationAttempt.current;
    if (
      correlationId === null ||
      attempt === null ||
      attempt.correlationId !== correlationId ||
      attempt.finalized
    ) return;
    attempt.finalized = true;
    attempt.dismissalRequested.resolve();
    attempt.dismissed.resolve();
    activePresentationAttempt.current = null;
    inputRef.current = null;
    if (mountedRef.current) {
      setInput(null);
      setNativeCycleId(null);
    }
  }, []);

  /** #4265: gorhom reports the snap index once the open animation settles. */
  const handleSheetChange = useCallback((index: number): void => {
    if (index < 0) return;
    markShareSheetSettled();
    flushAfterOpen();
  }, [flushAfterOpen]);

  const value = useMemo(
    () => ({ openContentShare, beginExpandedPresentation }),
    [beginExpandedPresentation, openContentShare],
  );
  const close = useCallback(() => {
    if (sending) return;
    const attempt = activePresentationAttempt.current;
    attempt?.dismissalRequested.resolve();
    if (attempt && !attempt.presented.settled) {
      attempt.presented.reject(new Error('presentation_rejected'));
    }
    generation.current += 1;
    afterOpenQueue.current = [];
    flushAfterOpen();
    setVisible(false);
  }, [flushAfterOpen, sending]);

  // #4265: stable for the life of the provider (reads the latest sending /
  // delivery state from refs), so memoised rows never re-render because of it.
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const deliveryStateRef = useRef(deliveryState);
  deliveryStateRef.current = deliveryState;
  const toggleRecipient = useCallback((key: string) => {
    if (sendingRef.current || deliveryStateRef.current[key] === 'sent') return;
    HapticFeedback.selection();
    setSelected((current) => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
    });
  }, []);

  const nativeShare = useCallback(async () => {
    if (!prepared || sending) return;
    if (actionInFlight.current || (prepared.media !== null && readiness !== 'ready')) return;
    actionInFlight.current = true;
    setExternalError(null); setSending(true);
    try {
      await sharePreparedContent(prepared);
      trackContentShareEvent('share_sheet_returned', { kind: prepared.kind, result: 'returned' });
    }
    catch {
      setExternalError('Couldn’t open sharing. Please try again.');
      trackContentShareEvent('share_failure', { kind: prepared.kind, failure_type: 'native_share' });
    }
    finally { actionInFlight.current = false; setSending(false); }
  }, [prepared, readiness, sending]);

  const copyLink = useCallback(async () => {
    if (!prepared) return;
    setExternalError(null);
    try {
      await Clipboard.setString(prepared.url);
      setCopied(true);
      AccessibilityInfo.announceForAccessibility('Link copied');
      setTimeout(() => setCopied(false), 1200);
    } catch { setExternalError('Couldn’t copy the link. Please try again.'); }
  }, [prepared]);

  const toggleSharerVisibility = useCallback((nextValue: boolean): void => {
    if (!input || sending) return;
    const nextInput: OpenContentShareInput = {
      ...input,
      messageContext: {
        ...input.messageContext,
        showSharer: nextValue,
      },
    };
    const token = generation.current + 1;
    generation.current = token;
    inputRef.current = nextInput;
    if (activePresentationAttempt.current) activePresentationAttempt.current.input = nextInput;
    setInput(nextInput);
    setShowSharer(nextValue);
    setPrepared(null);
    setPrepFailure(null);
    setPosterFailed(false);
    setReadiness('idle');
    setExternalError(null);
    loadShare(nextInput, token);
  }, [input, loadShare, sending]);

  const send = useCallback(async () => {
    if (!prepared || sending || selected.size === 0 || isOffline) return;
    if (actionInFlight.current) return;
    const targets = recipients.filter((recipient) => selected.has(recipient.key));
    if (targets.length === 0) {
      setSelected(new Set());
      AccessibilityInfo.announceForAccessibility('Those chats are no longer available. Choose someone else.');
      return;
    }
    actionInFlight.current = true;
    setSending(true); setOutcome({ kind: 'idle' });
    try {
      const result = await sendContentShareToRecipients({
        recipients: targets, shortCode: prepared.shortCode,
        shareVersion: prepared.version, senderNote: note, title: prepared.title,
        onSettled: (key, state) => setDeliveryState((current) => ({ ...current, [key]: state })),
      });
      if (result.failed === 0) {
        await clearContentShareOperationId(prepared.shortCode, prepared.version);
        HapticFeedback.success();
        setOutcome({ kind: 'success', sent: result.sent });
      } else {
        if (result.unavailableKeys.length > 0) {
          const unavailable = new Set(result.unavailableKeys);
          queryClient.setQueryData<ContentShareRecipient[]>(recipientsKeyRef.current, (current) => current?.filter((recipient) => !unavailable.has(recipient.key)));
          setExternalError('Some chats are no longer available. Choose another.');
          AccessibilityInfo.announceForAccessibility('Some chats are no longer available. Choose another.');
        }
        setSelected(new Set(result.failedKeys.filter((key) => !result.unavailableKeys.includes(key))));
        setOutcome(result.sent > 0
          ? { kind: 'partial', sent: result.sent, failed: result.failed }
          : { kind: 'failed', failed: result.failed });
      }
    } catch {
      setOutcome({ kind: 'failed', failed: selected.size });
    } finally { actionInFlight.current = false; setSending(false); }
  }, [isOffline, note, prepared, queryClient, recipients, selected, sending]);

  const finishSuccess = useCallback(() => {
    const attempt = activePresentationAttempt.current;
    attempt?.dismissalRequested.resolve();
    if (attempt && !attempt.presented.settled) {
      attempt.presented.reject(new Error('presentation_rejected'));
    }
    generation.current += 1;
    setSelected(new Set()); setNote(''); setVisible(false); setOutcome({ kind: 'idle' });
  }, []);

  // #4265: typing updates the field at once; the (cheap, pre-indexed) filter
  // runs on the deferred value and only when the list or that value changes.
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = useMemo(() => normalizeShareSearch(deferredSearch), [deferredSearch]);
  const visibleRecipients = useMemo(() => filterShareRecipients(recipients, normalizedSearch), [normalizedSearch, recipients]);
  const listPhase = shareRecipientListPhase({
    hasData: hasRecipientData,
    totalCount: recipients.length,
    visibleCount: visibleRecipients.length,
    fetching: recipientsFetching,
    failed: recipientError,
  });
  useEffect(() => {
    if (!visible || (listPhase !== 'list' && listPhase !== 'empty')) return;
    markShareRecipientsRendered(recipientsReady ? 'network' : 'cache');
  }, [listPhase, recipientsReady, visible]);
  const noteState = useMemo(() => {
    try { return normalizeContentShareNote(note); } catch { return { note: null, graphemeCount: 0 }; }
  }, [note]);
  const failedCount = Object.values(deliveryState).filter((state) => state === 'failed').length;
  const sendLabel = sending ? `Sending to ${selected.size}…` : failedCount > 0 ? `Retry ${selected.size}` : selected.size === 0 ? 'Select someone in Mingla' : `Send to ${selected.size} ${selected.size === 1 ? 'chat' : 'chats'}`;
  const facts = prepared ? selectCompactPreviewFacts(prepared.facts, 2).join(' · ') : '';
  const shareReady = Boolean(prepared && (prepared.media === null || readiness === 'ready'));
  const readinessCopy = readiness === 'pending' ? 'Preparing preview…'
    : readiness === 'retrying' ? 'Checking preview…'
    : readiness === 'waiting' ? 'Preview is still preparing.'
    : readiness === 'offline' ? 'Connect to finish preparing the preview.'
    : readiness === 'terminal' ? 'This share is no longer available.'
    : readiness === 'transient' ? "Couldn't prepare the preview."
    : '';
  const shareHeading = prepared && fontScale < 1.4 ? `Share ${prepared.title}` : 'Share';
  const fixedRows = fontScale <= SHARE_RECIPIENT_FIXED_ROW_MAX_FONT_SCALE;
  const header = useMemo(() => <View style={styles.header}><Text ref={shareHeadingRef} accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={styles.heading}>{shareHeading}</Text><Pressable style={styles.closeTarget} accessibilityRole="button" accessibilityLabel="Close share" disabled={sending} onPress={outcome.kind === 'success' ? finishSuccess : close}><Text style={styles.close}>×</Text></Pressable></View>, [close, finishSuccess, outcome.kind, sending, shareHeading, styles]);
  const footer = useMemo(() => (outcome.kind === 'success'
    ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}><Pressable accessibilityRole="button" onPress={finishSuccess} style={styles.sendButton}><Text style={styles.sendText}>Done</Text></Pressable></View>
    : <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>{prepared && isOffline ? <Text accessibilityLiveRegion="polite" style={styles.offlineCopy}>{"You're offline. Reconnect to send in Mingla."}</Text> : null}<Pressable accessibilityRole="button" disabled={!prepared || selected.size === 0 || sending || isOffline} onPress={() => void send()} style={[styles.sendButton, (!prepared || selected.size === 0 || sending || isOffline) && styles.disabled]}><Text style={styles.sendText}>{sendLabel}</Text></Pressable></View>
  ), [finishSuccess, insets.bottom, isOffline, outcome.kind, prepared, selected.size, send, sendLabel, sending, styles]);

  const onListHeaderLayout = useCallback((event: LayoutChangeEvent): void => {
    listHeaderHeight.current = event.nativeEvent.layout.height;
  }, []);

  // Everything above the people list: preview, share buttons, search. One
  // memoised element (ListHeaderComponent), rebuilt only when what it shows changes.
  const listHeader = useMemo(() => {
    if (outcome.kind === 'success') {
      return <View style={styles.successState} accessibilityLiveRegion="polite"><View style={styles.successCheck}><Text style={styles.successCheckText}>✓</Text></View><Text style={styles.successTitle}>Sent to {outcome.sent} {outcome.sent === 1 ? 'chat' : 'chats'}</Text></View>;
    }
    return <View style={styles.listHeader} onLayout={onListHeaderLayout}>
      <View style={styles.summary}>
        {!prepared && prepFailure === null ? <View accessibilityLabel="Preparing cover" style={styles.posterSkeleton} /> : prepared?.media?.posterUrl && !posterFailed ? <View style={styles.posterWrap}><ExpoImage source={{ uri: prepared.media.posterUrl }} style={styles.poster} cachePolicy="memory-disk" recyclingKey={prepared.shortCode} contentFit="cover" transition={0} onLoad={() => trackContentShareEvent('share_poster_result', { kind: prepared.kind, result_class: 'ready', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) })} onError={() => { setPosterFailed(true); trackContentShareEvent('share_poster_result', { kind: prepared.kind, result_class: 'failed', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) }); }} />{prepared.media.kind === 'gif' || prepared.media.kind === 'video' ? <View style={styles.mediaTag}><Text style={styles.mediaTagText}>{prepared.media.kind === 'gif' ? 'GIF' : 'Video'}</Text></View> : null}</View> : <View accessibilityLabel="No cover" style={styles.posterFallback}><Text style={styles.posterFallbackText}>{prepared ? shareKindLabel(prepared.kind).slice(0, 1) : 'M'}</Text></View>}
        <View style={styles.summaryCopy}><Text numberOfLines={1} style={styles.summaryMeta}>{prepared ? `${shareKindLabel(prepared.kind)}${statusLabel(prepared.facts.status) ? ` · ${statusLabel(prepared.facts.status)}` : ''}` : input ? shareKindLabel(input.kind) : 'Mingla'}</Text><Text numberOfLines={2} style={styles.title}>{prepared?.title ?? 'Preparing share…'}</Text>{facts ? <Text numberOfLines={2} style={styles.subtitle}>{facts}</Text> : null}</View>
      </View>
      {prepFailure !== null ? <View style={styles.errorRow} accessibilityLiveRegion="polite"><Text style={styles.errorText}>{SHARE_FAILURE_COPY[prepFailure]}</Text>{RETRYABLE_SHARE_FAILURES.has(prepFailure) ? <Pressable accessibilityRole="button" onPress={() => input && loadShare(input, generation.current)}><Text style={styles.retry}>Retry share</Text></Pressable> : null}</View> : null}
      <Text style={styles.sectionTitle}>Share elsewhere</Text>
      <View style={styles.sharerControl}>
        <View style={styles.sharerCopy}>
          <Text style={styles.sharerTitle}>Show my name when I share</Text>
          <Text style={styles.sharerBody}>Off by default. Turn it on only if you want your name on this public share.</Text>
        </View>
        <Switch
          accessibilityLabel="Show my name on this public share"
          accessibilityHint="Off by default"
          disabled={sending}
          onValueChange={toggleSharerVisibility}
          value={showSharer}
          trackColor={{ false: dark ? '#374151' : '#D1D5DB', true: colors.primary }}
        />
      </View>
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Share elsewhere" accessibilityHint={!shareReady && prepared?.media ? 'Preview is preparing. Copy link is available.' : undefined} accessibilityState={{ disabled: !shareReady || sending }} disabled={!shareReady || sending} onPress={() => void nativeShare()} style={[styles.action, (!shareReady || sending) && styles.disabled]}><Text style={styles.actionText}>Share</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Link copied' : 'Copy link'} disabled={!prepared || sending} onPress={() => void copyLink()} style={[styles.copyAction, (!prepared || sending) && styles.disabled]}><Text style={styles.actionText}>{copied ? '✓' : '⧉'}</Text></Pressable>
      </View>
      {prepared?.media && readiness !== 'ready' && readiness !== 'idle' ? <View style={styles.readinessRow} accessibilityLiveRegion="polite">
        <View style={styles.readinessStatus}>{readiness === 'pending' || readiness === 'retrying' ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name={readiness === 'terminal' ? 'alert-circle-outline' : 'time-outline'} size={18} color={readiness === 'terminal' || readiness === 'transient' ? (dark ? '#FCA5A5' : '#B91C1C') : (dark ? 'rgba(255,255,255,.72)' : '#6B7280')} />}<Text style={[styles.readinessText, (readiness === 'terminal' || readiness === 'transient') && styles.readinessError]}>{readinessCopy}</Text></View>
        {readiness === 'waiting' || readiness === 'transient' || readiness === 'terminal' || readiness === 'offline' ? <Pressable accessibilityRole="button" accessibilityLabel={readiness === 'terminal' ? 'Prepare again' : 'Retry preview'} disabled={readiness === 'offline'} onPress={() => { if (readiness === 'terminal' && input) { setPrepared(null); loadShare(input, generation.current); } else verifyReadiness(true); }} style={styles.readinessRetry}><Text style={styles.retry}>{readiness === 'terminal' ? 'Prepare again' : 'Retry'}</Text></Pressable> : null}
      </View> : null}
      {externalError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{externalError}</Text> : null}
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Send in Mingla</Text>{fontScale < 1.4 ? <Text style={styles.helper}>People and chats</Text> : null}</View>
      <View style={styles.searchWrap}><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="search-outline" size={19} color="#6B7280" /></View><BottomSheetTextInput accessibilityLabel="Search people and chats" value={search} onChangeText={setSearch} placeholder="Search people and chats" placeholderTextColor="#6B7280" style={styles.search} /></View>
      {recipientError ? <View style={styles.errorRow}><Text style={styles.errorText}>{"Couldn't load people and chats"}</Text><Pressable accessibilityRole="button" onPress={() => loadRecipients()}><Text style={styles.retry}>Retry list</Text></Pressable></View> : null}
      {outcome.kind === 'partial' ? <Text accessibilityLiveRegion="polite" style={styles.resultBanner}>Sent to {outcome.sent}; {"couldn't send to"} {outcome.failed}</Text> : null}
      {outcome.kind === 'failed' ? <Text accessibilityLiveRegion="polite" style={styles.errorBanner}>{"Couldn't send yet. Nothing was duplicated."}</Text> : null}
    </View>;
  }, [copied, copyLink, dark, externalError, facts, fontScale, input, loadRecipients, loadShare, nativeShare, onListHeaderLayout, outcome, posterFailed, prepFailure, prepared, readiness, readinessCopy, recipientError, search, sending, shareReady, showSharer, styles, toggleSharerVisibility, verifyReadiness]);

  const listEmpty = useMemo(() => {
    if (outcome.kind === 'success') return null;
    if (listPhase === 'placeholder') return <RecipientPlaceholders styles={styles} />;
    if (listPhase === 'empty') return <View style={styles.emptyWrap}><Text style={styles.emptyTitle}>No one available in Mingla yet</Text><Text style={styles.empty}>{"Chats and accepted connections appear here. Pending requests appear after they're accepted. You can still share elsewhere."}</Text></View>;
    if (listPhase === 'no-results') return <View style={styles.noResults}><Text style={styles.empty}>No people or chats match “{search}”</Text><Pressable accessibilityRole="button" onPress={() => setSearch('')}><Text style={styles.retry}>Clear search</Text></Pressable></View>;
    return null;
  }, [listPhase, outcome.kind, search, styles]);

  const listFooter = useMemo(() => {
    if (outcome.kind === 'success') return null;
    return <View style={styles.listFooter}>{!noteExpanded ? <Pressable accessibilityRole="button" onPress={() => setNoteExpanded(true)} style={styles.noteCollapsed}><Text style={styles.noteLabel}>Add a note (optional)</Text></Pressable> : <View><BottomSheetTextInput editable={!sending && Object.keys(deliveryState).length === 0} value={note} onChangeText={(value) => { try { setNote(normalizeContentShareNote(value).note ?? ''); } catch { /* unsupported engine: preserve prior note */ } }} multiline maxLength={480} placeholder="Add a note for the people you chose" placeholderTextColor="#6B7280" style={styles.note} />{noteState.graphemeCount >= 100 ? <Text accessibilityLiveRegion="polite" style={styles.counter}>{noteState.graphemeCount}/120</Text> : null}</View>}</View>;
  }, [deliveryState, note, noteExpanded, noteState.graphemeCount, outcome.kind, sending, styles]);

  const renderRecipient = useCallback<ListRenderItem<ShareRecipientRow>>(({ item }) => <RecipientRow
    recipient={item}
    active={selected.has(item.key)}
    sent={deliveryState[item.key] === 'sent'}
    sending={sending}
    fixedHeight={fixedRows}
    onToggle={toggleRecipient}
    styles={styles}
  />, [deliveryState, fixedRows, selected, sending, styles, toggleRecipient]);

  const getItemLayout = useCallback((_data: ArrayLike<ShareRecipientRow> | null | undefined, index: number) => shareRecipientItemLayout(index, listHeaderHeight.current), []);
  const listData = outcome.kind === 'success' || listPhase !== 'list' ? EMPTY_ROWS : visibleRecipients;

  const scrollProps = useMemo(() => ({
    data: listData,
    renderItem: renderRecipient,
    keyExtractor: shareRecipientKeyExtractor,
    getItemLayout: fixedRows ? getItemLayout : undefined,
    initialNumToRender: 12,
    maxToRenderPerBatch: 10,
    updateCellsBatchingPeriod: 32,
    windowSize: 7,
    ListHeaderComponent: listHeader,
    ListEmptyComponent: listEmpty,
    ListFooterComponent: listFooter,
    keyboardShouldPersistTaps: 'handled' as const,
    contentContainerStyle: styles.body,
    onScrollBeginDrag: beginShareSheetScroll,
    onScrollEndDrag: endShareSheetScroll,
    onMomentumScrollBegin: beginShareSheetScroll,
    onMomentumScrollEnd: endShareSheetScroll,
  }), [fixedRows, getItemLayout, listData, listEmpty, listFooter, listHeader, renderRecipient, styles.body]);

  return <UnifiedShareContext.Provider value={value}>
    {children}
    <BaseBottomSheet accessibilityLabel={`Share ${prepared?.title ?? input?.kind ?? ''}`} visible={visible} onClose={close} onChange={handleSheetChange} onNativeShow={() => handleNativeShow(nativeCycleId)} onNativeDismiss={() => handleNativeDismiss(nativeCycleId)} theme={dark ? 'dark' : 'light'} snapPoints={['90%']} enablePanDownToClose={!sending} scrollMode="flatlist" wrapInRNModal keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" header={header} stickyFooter={footer} scrollProps={scrollProps} />
  </UnifiedShareContext.Provider>;
}

const createStyles = (dark: boolean) => {
  const sheet = dark ? '#0C0E12' : '#FFFFFF';
  const surface = dark ? '#17191F' : '#F9FAFB';
  const selected = dark ? 'rgba(235,120,37,.18)' : '#FFF3E9';
  const border = dark ? 'rgba(255,255,255,.12)' : '#E5E7EB';
  const primary = dark ? 'rgba(255,255,255,.96)' : '#111827';
  const secondary = dark ? 'rgba(255,255,255,.72)' : '#6B7280';
  const error = dark ? '#FCA5A5' : '#B91C1C';
  const success = dark ? '#86EFAC' : '#166534';
  return StyleSheet.create({
    header:{minHeight:60,alignItems:'center',justifyContent:'center',paddingHorizontal:60,paddingVertical:8,position:'relative'},heading:{width:'100%',fontSize:18,lineHeight:28,fontWeight:'700',color:primary,textAlign:'center'},closeTarget:{position:'absolute',right:8,width:44,height:44,alignItems:'center',justifyContent:'center'},close:{fontSize:30,lineHeight:32,color:primary}, body:{paddingHorizontal:16,paddingBottom:28},listHeader:{gap:20,paddingBottom:12},listFooter:{paddingTop:20},
    summary:{minHeight:92,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,padding:10,flexDirection:'row',alignItems:'center',gap:12},posterWrap:{width:64,height:72,position:'relative'},poster:{width:64,height:72,borderRadius:12},posterSkeleton:{width:64,height:72,borderRadius:12,backgroundColor:dark?'#24272E':'#F3F4F6'},mediaTag:{position:'absolute',right:4,bottom:4,borderRadius:6,backgroundColor:'#0C0E12',paddingHorizontal:5,paddingVertical:2},mediaTagText:{fontSize:9,fontWeight:'700',color:'#fff'},posterFallback:{width:64,height:72,borderRadius:12,backgroundColor:'#0C0E12',alignItems:'center',justifyContent:'center'},posterFallbackText:{fontSize:28,fontWeight:'800',color:'#fff'},summaryCopy:{flex:1},summaryMeta:{fontSize:12,lineHeight:16,fontWeight:'700',color:secondary},title:{fontSize:17,lineHeight:22,fontWeight:'700',color:primary,marginTop:2},subtitle:{fontSize:13,lineHeight:18,fontWeight:'500',color:secondary,marginTop:3},
    actionRow:{height:52,flexDirection:'row',gap:8},action:{flex:1,minHeight:52,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,alignItems:'center',justifyContent:'center'},copyAction:{width:52,height:52,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,alignItems:'center',justifyContent:'center'},actionText:{fontSize:16,fontWeight:'700',color:primary},disabled:{opacity:.45},readinessRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},readinessStatus:{flex:1,flexDirection:'row',alignItems:'center',gap:8},readinessText:{flex:1,fontSize:13,lineHeight:18,fontWeight:'500',color:secondary},readinessError:{color:error},readinessRetry:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},sectionHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},sectionTitle:{fontSize:16,lineHeight:24,fontWeight:'600',color:primary},helper:{fontSize:12,lineHeight:16,fontWeight:'500',color:secondary},searchWrap:{minHeight:48,borderWidth:1,borderColor:border,borderRadius:12,paddingHorizontal:12,backgroundColor:surface,flexDirection:'row',alignItems:'center',gap:8},search:{flex:1,minHeight:46,paddingHorizontal:0,color:primary,backgroundColor:'transparent'},
    sharerControl:{minHeight:72,flexDirection:'row',alignItems:'center',gap:12,padding:12,borderRadius:14,borderWidth:1,borderColor:border,backgroundColor:surface},sharerCopy:{flex:1,gap:3},sharerTitle:{fontSize:14,lineHeight:19,fontWeight:'700',color:primary},sharerBody:{fontSize:12,lineHeight:17,fontWeight:'500',color:secondary},
    recipient:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8,paddingVertical:8,borderRadius:12,borderWidth:1,borderColor:'transparent'},recipientFixed:{height:60,minHeight:60,paddingVertical:0},recipientSelected:{backgroundColor:selected,borderColor:colors.primary},placeholderRow:{height:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8},placeholderAvatar:{width:44,height:44,borderRadius:22,backgroundColor:dark?'rgba(255,255,255,.07)':'#F3F4F6'},placeholderBar:{height:12,borderRadius:6,backgroundColor:dark?'rgba(255,255,255,.07)':'#F3F4F6'},avatar:{width:44,height:44,borderRadius:22},avatarFallback:{width:44,height:44,borderRadius:22,backgroundColor:dark?'#342A24':'#ece4dc',alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'700',color:dark?'#F7C49D':'#5f4939'},recipientCopy:{flex:1},recipientName:{fontSize:15,lineHeight:20,fontWeight:'600',color:primary},recipientMeta:{fontSize:12,lineHeight:16,fontWeight:'500',color:secondary,marginTop:2},check:{width:24,height:24,borderRadius:12,borderWidth:1.5,borderColor:dark?'rgba(255,255,255,.5)':'#9CA3AF',alignItems:'center',justifyContent:'center'},checkActive:{backgroundColor:colors.primary,borderColor:colors.primary},checkText:{fontSize:15,fontWeight:'800',color:'#0C0E12'},sentLabel:{fontSize:12,fontWeight:'700',color:success},
    noteCollapsed:{minHeight:48,borderRadius:12,borderWidth:1,borderColor:border,justifyContent:'center',paddingHorizontal:14},noteLabel:{fontSize:15,color:primary},note:{minHeight:64,maxHeight:96,borderWidth:1,borderColor:border,borderRadius:12,paddingHorizontal:14,paddingVertical:10,color:primary,backgroundColor:surface},counter:{alignSelf:'flex-end',fontSize:12,color:secondary,marginTop:4},
    footer:{paddingTop:12,paddingHorizontal:16,paddingBottom:12,backgroundColor:sheet,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:border,gap:8},offlineCopy:{fontSize:13,lineHeight:18,textAlign:'center',color:secondary},sendButton:{height:52,borderRadius:16,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},sendText:{fontSize:17,fontWeight:'800',color:'#0C0E12'},errorRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},errorText:{color:error},retry:{fontWeight:'700',color:dark?'#F7A15F':'#9A470A'},emptyWrap:{paddingVertical:8,gap:4},emptyTitle:{fontSize:15,lineHeight:20,fontWeight:'600',color:primary},empty:{fontSize:13,lineHeight:18,fontWeight:'500',color:secondary},noResults:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},resultBanner:{color:success,backgroundColor:dark?'#12321F':'#F0FDF4',padding:12,borderRadius:12},errorBanner:{color:error,backgroundColor:dark?'#351719':'#FEF2F2',padding:12,borderRadius:12},successState:{minHeight:260,alignItems:'center',justifyContent:'center',gap:16},successCheck:{width:64,height:64,borderRadius:32,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},successCheckText:{fontSize:32,fontWeight:'800',color:'#0C0E12'},successTitle:{fontSize:20,lineHeight:28,fontWeight:'700',color:primary},
  });
};
