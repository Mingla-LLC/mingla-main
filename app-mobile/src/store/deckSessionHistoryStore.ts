import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppState,
  InteractionManager,
  type AppStateStatus,
} from 'react-native';
import { create } from 'zustand';
import type { Recommendation } from '../types/recommendation';

export const DECK_SESSION_HISTORY_STORAGE_KEY = 'mingla-deck-session-history-v1';
export const LEGACY_APP_STORAGE_KEY = 'mingla-mobile-storage';
export const DECK_SESSION_HISTORY_CAP = 200;
export const DECK_SESSION_HISTORY_TRAILING_MS = 750;
export const DECK_SESSION_HISTORY_MAX_AGE_MS = 5_000;

interface DeckSessionHistorySnapshot {
  version: 1;
  generation: number;
  cards: Recommendation[];
}

interface DeckSessionHistoryState {
  cards: Recommendation[];
  generation: number;
  hasHydrated: boolean;
  append: (card: Recommendation) => void;
  rollback: (cardId: string) => void;
  reset: () => void;
}

interface DeckSessionHistoryDiagnostics {
  serializations: number;
  writes: number;
  migrations: number;
}

let pendingSnapshot: DeckSessionHistorySnapshot | null = null;
let trailingTimer: ReturnType<typeof setTimeout> | null = null;
let maxAgeTimer: ReturnType<typeof setTimeout> | null = null;
let interactionHandle: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let persistenceDrain: Promise<void> | null = null;
let hydrationPromise: Promise<void> | null = null;
let hydrationSettled = false;
let lastPersistedGeneration = -1;
let resetIntentVersion = 0;
let queuedResetIntentVersion = 0;
let legacyCleanupAfterGeneration: number | null = null;
let persistenceErrorReported = false;
let migrationErrorReported = false;
let persistenceBlocked = false;
let deferredDrainRequested = false;
const diagnostics: DeckSessionHistoryDiagnostics = {
  serializations: 0,
  writes: 0,
  migrations: 0,
};

function reportHistoryError(kind: 'migration' | 'persistence'): void {
  if (kind === 'migration') {
    if (migrationErrorReported) return;
    migrationErrorReported = true;
  } else {
    if (persistenceErrorReported) return;
    persistenceErrorReported = true;
  }
  console.error(`[DeckSessionHistory] ${kind} failed`);
}

function isValidHistoryCard(value: unknown): value is Recommendation {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function capHistory(cards: Recommendation[]): Recommendation[] {
  return cards.length > DECK_SESSION_HISTORY_CAP
    ? cards.slice(cards.length - DECK_SESSION_HISTORY_CAP)
    : cards;
}

function parseDedicatedSnapshot(raw: string): DeckSessionHistorySnapshot {
  const parsed = JSON.parse(raw) as Partial<DeckSessionHistorySnapshot>;
  if (
    parsed.version !== 1 ||
    !Number.isSafeInteger(parsed.generation) ||
    (parsed.generation ?? -1) < 0 ||
    !Array.isArray(parsed.cards) ||
    !parsed.cards.every(isValidHistoryCard)
  ) {
    throw new Error('invalid dedicated history snapshot');
  }
  return {
    version: 1,
    generation: parsed.generation as number,
    cards: capHistory(parsed.cards),
  };
}

function parseLegacyHistory(raw: string): Recommendation[] | null {
  const parsed = JSON.parse(raw) as { state?: { sessionSwipedCards?: unknown } };
  const legacy = parsed?.state?.sessionSwipedCards;
  if (legacy === undefined) return null;
  if (!Array.isArray(legacy) || !legacy.every(isValidHistoryCard)) {
    throw new Error('invalid legacy history');
  }
  return capHistory(legacy);
}

async function removeLegacyHistoryAfterMigration(): Promise<void> {
  const raw = await AsyncStorage.getItem(LEGACY_APP_STORAGE_KEY);
  if (!raw) return;
  const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
  if (
    !parsed.state ||
    !Object.prototype.hasOwnProperty.call(parsed.state, 'sessionSwipedCards')
  ) return;
  delete parsed.state.sessionSwipedCards;
  await AsyncStorage.setItem(LEGACY_APP_STORAGE_KEY, JSON.stringify(parsed));
}

function clearSchedule(): void {
  if (trailingTimer) clearTimeout(trailingTimer);
  if (maxAgeTimer) clearTimeout(maxAgeTimer);
  interactionHandle?.cancel();
  trailingTimer = null;
  maxAgeTimer = null;
  interactionHandle = null;
}

async function drainPendingSnapshot(force = false): Promise<void> {
  if (persistenceBlocked && !force) {
    deferredDrainRequested = true;
    return;
  }
  if (persistenceDrain) return persistenceDrain;
  clearSchedule();
  const drain = async (): Promise<void> => {
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      if (snapshot.generation < lastPersistedGeneration) continue;
      try {
        diagnostics.serializations += 1;
        const serialized = JSON.stringify(snapshot);
        await AsyncStorage.setItem(DECK_SESSION_HISTORY_STORAGE_KEY, serialized);
        diagnostics.writes += 1;
        lastPersistedGeneration = snapshot.generation;
      } catch {
        reportHistoryError('persistence');
        const newerPending = pendingSnapshot as DeckSessionHistorySnapshot | null;
        if (!newerPending || newerPending.generation < snapshot.generation) {
          pendingSnapshot = snapshot;
        }
        break;
      }
    }
    if (
      legacyCleanupAfterGeneration !== null &&
      lastPersistedGeneration >= legacyCleanupAfterGeneration
    ) {
      try {
        await removeLegacyHistoryAfterMigration();
        legacyCleanupAfterGeneration = null;
      } catch {
        // The durable dedicated reset already exists. Retain legacy truth and
        // retry cleanup on a later flush instead of risking both copies.
        reportHistoryError('migration');
      }
    }
  };
  persistenceDrain = drain().finally(() => {
    persistenceDrain = null;
  });
  return persistenceDrain;
}

function requestScheduledDrain(): void {
  if (persistenceBlocked) {
    deferredDrainRequested = true;
    return;
  }
  interactionHandle?.cancel();
  interactionHandle = InteractionManager.runAfterInteractions(() => {
    interactionHandle = null;
    void drainPendingSnapshot();
  });
}

function scheduleSnapshot(snapshot: DeckSessionHistorySnapshot): void {
  pendingSnapshot = snapshot;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = setTimeout(() => {
    trailingTimer = null;
    requestScheduledDrain();
  }, DECK_SESSION_HISTORY_TRAILING_MS);
  // Continuous 520ms swiping keeps moving the trailing edge. This fixed
  // checkpoint bounds durability without turning every swipe into stringify + I/O.
  if (!maxAgeTimer) {
    maxAgeTimer = setTimeout(() => {
      maxAgeTimer = null;
      requestScheduledDrain();
    }, DECK_SESSION_HISTORY_MAX_AGE_MS);
  }
}

export const useDeckSessionHistoryStore = create<DeckSessionHistoryState>((set, get) => ({
  cards: [],
  generation: 0,
  hasHydrated: false,
  append: (card): void => {
    const state = get();
    const cards = capHistory([...state.cards, card]);
    const generation = state.generation + 1;
    set({ cards, generation });
    scheduleSnapshot({ version: 1, generation, cards });
  },
  rollback: (cardId): void => {
    const state = get();
    const rollbackIndex = state.cards.map((card) => card.id).lastIndexOf(cardId);
    if (rollbackIndex < 0) return;
    const cards = state.cards.filter((_, index) => index !== rollbackIndex);
    const generation = state.generation + 1;
    set({ cards, generation });
    scheduleSnapshot({ version: 1, generation, cards });
    void flushDeckSessionHistory();
  },
  reset: (): void => {
    resetIntentVersion += 1;
    const generation = get().generation + 1;
    const cards: Recommendation[] = [];
    set({ cards, generation });
    if (hydrationSettled) {
      queuedResetIntentVersion = resetIntentVersion;
      scheduleSnapshot({ version: 1, generation, cards });
    } else {
      // Do not write a generation derived from defaults over a possibly newer
      // durable snapshot. Hydration rebases this reset above durable truth.
      void hydrateDeckSessionHistory();
    }
  },
}));

function hasPendingHydrationReset(): boolean {
  return queuedResetIntentVersion < resetIntentVersion;
}

async function settleHydrationResets(durableGeneration: number): Promise<void> {
  let knownDurableGeneration = durableGeneration;
  while (hasPendingHydrationReset()) {
    const intentVersion = resetIntentVersion;
    const current = useDeckSessionHistoryStore.getState();
    const generation = Math.max(
      current.generation,
      knownDurableGeneration,
      lastPersistedGeneration,
    ) + 1;
    const cards: Recommendation[] = [];
    useDeckSessionHistoryStore.setState({ cards, generation, hasHydrated: true });
    queuedResetIntentVersion = intentVersion;
    legacyCleanupAfterGeneration = generation;
    scheduleSnapshot({ version: 1, generation, cards });
    await drainPendingSnapshot(true);
    knownDurableGeneration = Math.max(
      knownDurableGeneration,
      lastPersistedGeneration,
    );
  }
}

export function hydrateDeckSessionHistory(): Promise<void> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    let durableGeneration = -1;
    try {
      const dedicatedRaw = await AsyncStorage.getItem(DECK_SESSION_HISTORY_STORAGE_KEY);
      if (dedicatedRaw) {
        const snapshot = parseDedicatedSnapshot(dedicatedRaw);
        durableGeneration = snapshot.generation;
        lastPersistedGeneration = Math.max(lastPersistedGeneration, snapshot.generation);
        if (!hasPendingHydrationReset()) {
          useDeckSessionHistoryStore.setState({
            cards: snapshot.cards,
            generation: snapshot.generation,
            hasHydrated: true,
          });
          try {
            await removeLegacyHistoryAfterMigration();
          } catch {
            reportHistoryError('migration');
          }
        }
      } else {
        const legacyRaw = await AsyncStorage.getItem(LEGACY_APP_STORAGE_KEY);
        const legacyCards = legacyRaw ? parseLegacyHistory(legacyRaw) : null;
        if (!hasPendingHydrationReset()) {
          const cards = legacyCards ?? [];
          const snapshot: DeckSessionHistorySnapshot = { version: 1, generation: 0, cards };

          // The dedicated copy is durable before the legacy field is touched.
          await AsyncStorage.setItem(
            DECK_SESSION_HISTORY_STORAGE_KEY,
            JSON.stringify(snapshot),
          );
          diagnostics.serializations += 1;
          diagnostics.writes += 1;
          if (legacyCards) diagnostics.migrations += 1;
          durableGeneration = 0;
          lastPersistedGeneration = Math.max(lastPersistedGeneration, 0);
          // A reset may have arrived while the dedicated migration write was
          // pending. Never apply the older cards after that newer intent.
          if (!hasPendingHydrationReset()) {
            useDeckSessionHistoryStore.setState({ cards, generation: 0, hasHydrated: true });
            if (legacyCards) await removeLegacyHistoryAfterMigration();
          }
        }
      }
    } catch {
      // Never remove the legacy value unless the dedicated write succeeded.
      reportHistoryError('migration');
    } finally {
      if (hasPendingHydrationReset()) {
        await settleHydrationResets(durableGeneration);
      } else {
        useDeckSessionHistoryStore.setState({ hasHydrated: true });
      }
      hydrationSettled = true;
    }
  })();
  return hydrationPromise;
}

export function appendDeckSessionHistory(card: Recommendation): void {
  useDeckSessionHistoryStore.getState().append(card);
}

export function resetDeckSessionHistory(): void {
  useDeckSessionHistoryStore.getState().reset();
  void hydrateDeckSessionHistory().then(() => flushDeckSessionHistory());
}

export function rollbackDeckSessionHistory(cardId: string): void {
  useDeckSessionHistoryStore.getState().rollback(cardId);
}

export function flushDeckSessionHistory(): Promise<void> {
  return drainPendingSnapshot(true);
}

/** Prevent normal history serialization while the native swipe transaction is active. */
export function setDeckSessionHistoryPersistenceBlocked(blocked: boolean): void {
  persistenceBlocked = blocked;
  if (!blocked && deferredDrainRequested) {
    deferredDrainRequested = false;
    requestScheduledDrain();
  }
}

export async function resetAndFlushDeckSessionHistory(): Promise<void> {
  resetDeckSessionHistory();
  await hydrateDeckSessionHistory();
  await flushDeckSessionHistory();
}

export function getDeckSessionHistoryDiagnostics(): DeckSessionHistoryDiagnostics {
  return { ...diagnostics };
}

AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state === 'background' || state === 'inactive') {
    void flushDeckSessionHistory();
  }
});
