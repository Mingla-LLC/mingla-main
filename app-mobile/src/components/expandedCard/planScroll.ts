/**
 * #4347 wave 3 — where the plan sheet is scrolled to, kept OUTSIDE React state.
 *
 * The sheet's scroll fires many times a second. Storing it in the modal's state
 * would re-render the whole sheet on every frame, so it lives in this tiny
 * store: the sheet writes to it, and only the two things that care subscribe —
 * the sticky stop navigator (shown / which stop is in view / how far the line
 * has filled) and the stop card that should pulse after a jump. The snapshot
 * only changes when one of those answers changes.
 *
 * Positions are scroll-content y. The plan body reports where it sits in the
 * content, where its route strip ends, where its stop list sits, and where each
 * stop row sits inside the list; this store adds them up.
 */
import { useSyncExternalStore } from 'react';

export const NAVIGATOR_HEIGHT = 52;
/** A stop counts as "in view" once its top is this far under the navigator. */
const IN_VIEW_BELOW_NAV = 90;
/** The navigator pins this far before the route strip has fully scrolled away. */
const PIN_EARLY = 10;

export interface PlanScrollSnapshot {
  readonly visible: boolean;
  readonly active: number;
  /** One fill (0..1, in tenths) per line between stops i and i+1. */
  readonly fills: readonly number[];
  readonly pulse: { readonly index: number; readonly seq: number } | null;
}

const EMPTY: PlanScrollSnapshot = { visible: false, active: 0, fills: [], pulse: null };

export class PlanScrollStore {
  private listeners = new Set<() => void>();
  private snapshot: PlanScrollSnapshot = EMPTY;
  private scrollY = 0;
  private bodyY = 0;
  private routeBottom: number | null = null;
  private planY = 0;
  private stopY: (number | null)[] = [];
  private pulseSeq = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlanScrollSnapshot => this.snapshot;

  reset(): void {
    this.scrollY = 0;
    this.bodyY = 0;
    this.routeBottom = null;
    this.planY = 0;
    this.stopY = [];
    this.publish({ ...EMPTY, pulse: null });
  }

  setBodyY(y: number): void {
    this.bodyY = y;
    this.recompute();
  }

  /** Bottom edge of the route strip, relative to the plan body. */
  setRouteBottom(y: number): void {
    this.routeBottom = y;
    this.recompute();
  }

  /** Top of the stop list, relative to the plan body. */
  setPlanY(y: number): void {
    this.planY = y;
    this.recompute();
  }

  setStopCount(count: number): void {
    if (this.stopY.length !== count) {
      this.stopY = Array.from({ length: count }, (_, i) => this.stopY[i] ?? null);
      this.recompute();
    }
  }

  /** Top of stop `index`'s row, relative to the stop list. */
  setStopY(index: number, y: number): void {
    this.stopY[index] = y;
    this.recompute();
  }

  onScroll(y: number): void {
    this.scrollY = y;
    this.recompute();
  }

  /** Scroll-content y of stop `index`, or null before it has been laid out. */
  stopTop(index: number): number | null {
    const y = this.stopY[index];
    return typeof y === 'number' ? this.bodyY + this.planY + y : null;
  }

  /** Where to scroll so stop `index` lands just under the navigator. */
  jumpTarget(index: number): number | null {
    const top = this.stopTop(index);
    return top === null ? null : Math.max(0, top - NAVIGATOR_HEIGHT - 8);
  }

  pulse(index: number): void {
    this.pulseSeq += 1;
    this.publish({ ...this.snapshot, pulse: { index, seq: this.pulseSeq } });
  }

  private recompute(): void {
    const visible =
      this.routeBottom !== null && this.scrollY > this.bodyY + this.routeBottom - PIN_EARLY;
    const line = this.scrollY + NAVIGATOR_HEIGHT + IN_VIEW_BELOW_NAV;
    let active = 0;
    const tops = this.stopY.map((_, i) => this.stopTop(i));
    tops.forEach((top, i) => {
      if (top !== null && top <= line) active = i;
    });
    const fills: number[] = [];
    for (let i = 0; i < tops.length - 1; i += 1) {
      const a = tops[i];
      const b = tops[i + 1];
      if (a === null || b === null || b <= a) {
        fills.push(i < active ? 1 : 0);
        continue;
      }
      const f = Math.max(0, Math.min(1, (line - a) / (b - a)));
      fills.push(Math.round(f * 10) / 10);
    }
    const prev = this.snapshot;
    const same =
      prev.visible === visible &&
      prev.active === active &&
      prev.fills.length === fills.length &&
      prev.fills.every((v, i) => v === fills[i]);
    if (!same) this.publish({ visible, active, fills, pulse: prev.pulse });
  }

  private publish(next: PlanScrollSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}

export function usePlanScroll(store: PlanScrollStore | null): PlanScrollSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : emptySnapshot,
    store ? store.getSnapshot : emptySnapshot,
  );
}

const noopSubscribe = (): (() => void) => () => undefined;
const emptySnapshot = (): PlanScrollSnapshot => EMPTY;
