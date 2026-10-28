export const STARTS_SOON_WINDOW_MS = 8 * 60 * 60 * 1000;

export interface PulseVisibilityInput {
  canViewMoney: boolean;
  captureStartedAt: string | null;
  pageViews: number;
  followerTotal: number;
}

export interface PulseVisibility {
  money: boolean;
  visits: boolean;
  followers: boolean;
}

export function businessPulseVisibility(
  input: PulseVisibilityInput,
): PulseVisibility {
  return {
    money: input.canViewMoney,
    visits: input.captureStartedAt !== null && input.pageViews >= 30,
    followers: input.followerTotal >= 1,
  };
}

export function businessPulseDesktopSpans(
  visibility: PulseVisibility,
): { money: number; visits: number; followers: number } {
  if (visibility.money && visibility.visits && visibility.followers) {
    return { money: 5, visits: 4, followers: 3 };
  }
  if (visibility.money && visibility.visits) {
    return { money: 7, visits: 5, followers: 0 };
  }
  if (visibility.money && visibility.followers) {
    return { money: 8, visits: 0, followers: 4 };
  }
  if (visibility.money) return { money: 12, visits: 0, followers: 0 };
  if (visibility.visits && visibility.followers) {
    return { money: 0, visits: 7, followers: 5 };
  }
  if (visibility.visits) return { money: 0, visits: 12, followers: 0 };
  if (visibility.followers) return { money: 0, visits: 0, followers: 12 };
  return { money: 0, visits: 0, followers: 0 };
}

export interface StartsSoonCandidate {
  status: string;
  startAtUtc: Date | null;
}

export function selectStartsSoon<T extends StartsSoonCandidate>(
  items: readonly T[],
  nowMs: number = Date.now(),
): T | null {
  const candidate = items
    .filter((item) => {
      if (item.status === "live" || item.startAtUtc === null) return false;
      const untilStart = item.startAtUtc.getTime() - nowMs;
      return untilStart >= 0 && untilStart <= STARTS_SOON_WINDOW_MS;
    })
    .sort(
      (left, right) =>
        left.startAtUtc!.getTime() - right.startAtUtc!.getTime(),
    )[0];
  if (candidate === undefined) return null;
  return candidate ?? null;
}

export function startsSoonCountdown(startAt: Date, nowMs = Date.now()): string {
  const minutes = Math.max(
    0,
    Math.ceil((startAt.getTime() - nowMs) / (60 * 1000)),
  );
  return `${Math.floor(minutes / 60)}H ${minutes % 60}M`;
}
