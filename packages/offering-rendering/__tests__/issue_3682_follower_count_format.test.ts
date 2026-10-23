import {
  formatCompactCount,
  formatExactCount,
  formatExactFollowers,
  formatFollowerCountA11y,
  formatFollowerCountLine,
} from "../followerCount.ts";

const cases = [
  [0, "0", "Be the first to follow", "0 followers", "No followers yet"],
  [1, "1", "1 follower", "1 follower", "1 follower"],
  [2, "2", "2 followers", "2 followers", "2 followers"],
  [842, "842", "842 followers", "842 followers", "842 followers"],
  [999, "999", "999 followers", "999 followers", "999 followers"],
  [1_000, "1k", "1k followers", "1,000 followers", "about 1 thousand followers"],
  [1_050, "1k", "1k followers", "1,050 followers", "about 1 thousand followers"],
  [1_100, "1.1k", "1.1k followers", "1,100 followers", "about 1.1 thousand followers"],
  [1_204, "1.2k", "1.2k followers", "1,204 followers", "about 1.2 thousand followers"],
  [1_999, "1.9k", "1.9k followers", "1,999 followers", "about 1.9 thousand followers"],
  [9_999, "9.9k", "9.9k followers", "9,999 followers", "about 9.9 thousand followers"],
  [10_000, "10k", "10k followers", "10,000 followers", "about 10 thousand followers"],
  [12_480, "12k", "12k followers", "12,480 followers", "about 12 thousand followers"],
  [999_999, "999k", "999k followers", "999,999 followers", "about 999 thousand followers"],
  [1_000_000, "1M", "1M followers", "1,000,000 followers", "about 1 million followers"],
  [1_240_000, "1.2M", "1.2M followers", "1,240,000 followers", "about 1.2 million followers"],
  [12_500_000, "12M", "12M followers", "12,500,000 followers", "about 12 million followers"],
  [1_000_000_000, "1B", "1B followers", "1,000,000,000 followers", "about 1 billion followers"],
] as const;

Deno.test("#3682 follower formatter truncates compact values and preserves exact/a11y copy", () => {
  for (const [count, compact, line, exact, a11y] of cases) {
    if (formatCompactCount(count) !== compact) throw new Error(`compact ${count}`);
    if (formatFollowerCountLine(count) !== line) throw new Error(`line ${count}`);
    if (formatExactFollowers(count) !== exact) throw new Error(`exact ${count}`);
    if (formatFollowerCountA11y(count) !== a11y) throw new Error(`a11y ${count}`);
  }
});

Deno.test("#3682 follower formatter rejects invalid counts", () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    if (formatCompactCount(value) !== null) throw new Error(`accepted ${value}`);
    if (formatExactCount(value) !== null) throw new Error(`exact accepted ${value}`);
  }
});
