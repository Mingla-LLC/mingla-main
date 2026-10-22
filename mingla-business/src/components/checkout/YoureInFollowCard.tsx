/**
 * #3682 Wave 2.4 / design contract surface c — "You're in" follow card.
 * Renders between the QR card and DownloadMinglaCta on web confirm.
 *
 * Auth is read via supabase.auth.getSession (not AuthContext) so confirm
 * screens mounted in CartProvider-only tests do not throw. Follow state is
 * owned here via brandFollowsService.getFollowMeta — one read, no hook cache.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { brandFollowsService } from "../../services/brandFollowsService";
import { supabase } from "../../services/supabase";
import { Icon } from "../ui/Icon";
import { formatCompactCount } from "@mingla/offering-rendering/followerCount";

export function youreInFollowingDetail(count: number | null): string {
  if (count === null) return "New dates and offers first.";
  const others = count - 1;
  if (others <= 0) return "New dates and offers first.";
  if (others === 1) return "You and 1 other hear about new dates first.";
  return `You and ${formatCompactCount(others) ?? others} others hear about new dates first.`;
}

export function youreInOfferDetail(count: number | null): string {
  if (count === null || count === 0) return "Follow to hear about them first.";
  if (count === 1) return "Join 1 other. New dates and offers first.";
  return `Join ${formatCompactCount(count) ?? count} others. New dates and offers first.`;
}

export type YoureInFollowCardProps = {
  brandId: string | null;
  brandName: string;
  brandSlug: string | null;
  testID?: string;
};

type CardMode = "loading" | "following_undo" | "already" | "offer" | "hidden";

const AUTO_FOLLOW_SOURCES = new Set(["purchase", "rsvp", "booking"]);
/** Undo only when this confirm likely created the row (not an older follow). */
const UNDO_WINDOW_MS = 15 * 60 * 1000;

export function YoureInFollowCard({
  brandId,
  brandName,
  brandSlug,
  testID = "youre-in-follow-card",
}: YoureInFollowCardProps): React.ReactElement | null {
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<CardMode>("loading");
  const [count, setCount] = useState<number | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => supabase.auth?.getSession?.())
      .then((result) => {
        if (cancelled) return;
        setUserId(result?.data?.session?.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (): Promise<void> => {
      if (!brandId) {
        if (!cancelled) {
          setCount(null);
          setMode(brandName.trim().length > 0 ? "offer" : "hidden");
        }
        return;
      }
      const results = await Promise.allSettled([
        userId
          ? brandFollowsService.getFollowMeta(userId, brandId)
          : Promise.resolve(null),
        import("../../services/brandFollowerCountService").then((module) =>
          module.brandFollowerCountService.getCount(brandId),
        ),
      ]);
      if (cancelled) return;
      setCount(results[1].status === "fulfilled" ? results[1].value : null);

      const meta = results[0].status === "fulfilled" ? results[0].value : null;
      if (meta === null || !meta.following) {
        setMode("offer");
        return;
      }
      const freshAutoFollow =
        meta.source !== null &&
        AUTO_FOLLOW_SOURCES.has(meta.source) &&
        meta.createdAtMs !== null &&
        Date.now() - meta.createdAtMs <= UNDO_WINDOW_MS;
      setMode(freshAutoFollow ? "following_undo" : "already");
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [brandId, brandName, userId]);

  const onUndo = useCallback(async (): Promise<void> => {
    if (!userId || !brandId) return;
    setUndoError(null);
    setBusy(true);
    try {
      await brandFollowsService.unfollowBrand(userId, brandId);
      setCount((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
      setMode("offer");
    } catch {
      setUndoError("Couldn't undo. Try again, or unfollow from your email.");
    } finally {
      setBusy(false);
    }
  }, [brandId, userId]);

  const onFollow = useCallback(async (): Promise<void> => {
    if (!userId) {
      // Soft path: open brand page when signed out (sheet m is Wave 2.5).
      if (typeof window !== "undefined" && brandSlug && brandSlug.length > 0) {
        window.location.assign(`/b/${encodeURIComponent(brandSlug)}`);
      }
      return;
    }
    if (!brandId) return;
    setBusy(true);
    setUndoError(null);
    try {
      await brandFollowsService.followBrand(userId, brandId);
      setCount((current) => (current === null ? null : current + 1));
      setMode("following_undo");
    } catch {
      setUndoError(`Couldn't follow ${brandName}. Try again.`);
    } finally {
      setBusy(false);
    }
  }, [brandId, brandName, brandSlug, userId]);

  if (mode === "hidden" || mode === "loading") {
    return null;
  }

  const name = brandName.trim().length > 0 ? brandName.trim() : "this brand";
  const followingDetail = youreInFollowingDetail(count);
  const offerDetail = youreInOfferDetail(count);

  if (mode === "already") {
    return (
      <View
        style={styles.card}
        accessibilityLiveRegion="polite"
        testID={testID}
      >
        <View style={styles.row}>
          <Icon name="check" size={18} color="#4ade80" />
          <View style={styles.copy}>
            <Text style={styles.title}>You follow {name}</Text>
            <Text style={styles.detail}>{followingDetail}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (mode === "following_undo") {
    return (
      <View
        style={styles.card}
        accessibilityLiveRegion="polite"
        testID={testID}
      >
        <View style={styles.row}>
          <Icon name="check" size={18} color="#4ade80" />
          <View style={styles.copy}>
            <Text style={styles.title}>{"You're now following "}{name}</Text>
            <Text style={styles.detail}>{followingDetail}</Text>
          </View>
          <Pressable
            onPress={() => {
              void onUndo();
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Undo following ${name}`}
            style={styles.undoHit}
            testID={`${testID}-undo`}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#f59a55" />
            ) : (
              <Text style={styles.undo}>Undo</Text>
            )}
          </Pressable>
        </View>
        {undoError !== null ? (
          <Text style={styles.error} testID={`${testID}-error`}>
            {undoError}
          </Text>
        ) : null}
      </View>
    );
  }

  // offer
  return (
    <View
      style={styles.card}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>Want new dates from {name}?</Text>
          <Text style={styles.detail}>{offerDetail}</Text>
        </View>
        <Pressable
          onPress={() => {
            void onFollow();
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Follow ${name}`}
          style={styles.followHit}
          testID={`${testID}-follow`}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.followLabel}>Follow</Text>
          )}
        </Pressable>
      </View>
      {undoError !== null ? (
        <Text style={styles.error} testID={`${testID}-error`}>
          {undoError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1b1d22",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  detail: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    color: "#bfc0c1",
  },
  undoHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  undo: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: "#f59a55",
  },
  followHit: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#c2560f",
    alignItems: "center",
    justifyContent: "center",
  },
  followLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: "#fca5a5",
  },
});
