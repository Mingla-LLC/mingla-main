/**
 * Ve1 wizard — Step 2: Display name + slug.
 *
 * META-ORCH-1009 Sub-E:
 *   B3 — slug auto-generates (kebab) from the venue name as you type, with
 *        tappable numbered suggestions; still editable.
 *   B5 — debounced live availability check that only reports "taken" for a real
 *        live conflict (not the caller's own brand, not soft-deleted rows).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Input } from "../ui/Input";
import { slugifyBrandSlug } from "../../utils/brandSlugify";
import {
  checkVenueSlugAvailable,
  suggestVenueSlugs,
} from "../../services/brandsService";

export interface VenueStep2NameSlugProps {
  showErrors: boolean;
  slugError: string | null;
  /** Caller account id — excludes the caller's own brand from "taken". */
  accountId?: string | null;
}

export const VenueStep2NameSlug: React.FC<VenueStep2NameSlugProps> = ({
  showErrors,
  slugError,
  accountId,
}) => {
  const displayName = useDraftVenueStore((s) => s.displayName);
  const slug = useDraftVenueStore((s) => s.slug);
  const patch = useDraftVenueStore((s) => s.patch);

  // Tracks whether the user has hand-edited the slug. While false, the slug
  // mirrors the name automatically (B3). Once they type in the slug field we
  // stop auto-overwriting so we never clobber a deliberate choice.
  const slugTouched = useRef(slug.trim().length > 0);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const checkSeq = useRef(0);

  // B3 — derive slug from name until the user takes over the slug field.
  const onChangeName = useCallback(
    (t: string): void => {
      if (slugTouched.current) {
        patch({ displayName: t });
      } else {
        patch({ displayName: t, slug: slugifyBrandSlug(t) });
      }
    },
    [patch],
  );

  const onChangeSlug = useCallback(
    (t: string): void => {
      slugTouched.current = true;
      patch({ slug: slugifyBrandSlug(t) });
    },
    [patch],
  );

  const onPickSuggestion = useCallback(
    (value: string): void => {
      slugTouched.current = true;
      patch({ slug: value });
    },
    [patch],
  );

  // B5 — debounced availability check; only the latest request wins.
  useEffect(() => {
    const value = slug.trim();
    if (value.length === 0) {
      setAvailable(null);
      return;
    }
    const seq = ++checkSeq.current;
    setChecking(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const ok = await checkVenueSlugAvailable(value, accountId);
          if (seq === checkSeq.current) setAvailable(ok);
        } catch {
          if (seq === checkSeq.current) setAvailable(null);
        } finally {
          if (seq === checkSeq.current) setChecking(false);
        }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [slug, accountId]);

  // B3 — fetch tappable numbered suggestions when the derived slug is taken.
  useEffect(() => {
    if (available !== false || displayName.trim().length === 0) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const picks = await suggestVenueSlugs(displayName, 3, accountId);
      if (!cancelled) setSuggestions(picks.filter((p) => p !== slug.trim()));
    })();
    return () => {
      cancelled = true;
    };
  }, [available, displayName, accountId, slug]);

  const nameErr =
    showErrors && displayName.trim().length === 0
      ? "Venue name is required."
      : undefined;
  const slugFieldErr =
    slugError ??
    (showErrors && slug.trim().length === 0 ? "Slug is required." : undefined);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Venue name & web address</Text>
      <Text style={styles.helper}>
        Your public page will use the slug in the URL. We fill it in from your
        name — tap a suggestion or edit it.
      </Text>
      <Input
        variant="text"
        value={displayName}
        onChangeText={onChangeName}
        placeholder="Venue name"
        accessibilityLabel="Venue display name"
      />
      {nameErr !== undefined ? (
        <Text style={styles.errText}>{nameErr}</Text>
      ) : null}
      <Input
        variant="text"
        value={slug}
        onChangeText={onChangeSlug}
        placeholder="your-venue-slug"
        accessibilityLabel="Venue URL slug"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {slugFieldErr !== undefined ? (
        <Text style={styles.errText}>{slugFieldErr}</Text>
      ) : null}

      {checking ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={accent.warm} />
          <Text style={styles.statusMuted}>Checking availability…</Text>
        </View>
      ) : available === true ? (
        <Text style={styles.statusOk}>Available</Text>
      ) : available === false ? (
        <Text style={styles.statusTaken}>This slug is taken</Text>
      ) : null}

      {suggestions.length > 0 ? (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestLabel}>Try one of these</Text>
          <View style={styles.suggestRow}>
            {suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => onPickSuggestion(s)}
                accessibilityRole="button"
                accessibilityLabel={`Use slug ${s}`}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusMuted: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  statusOk: {
    fontSize: typography.caption.fontSize,
    color: "#22C55E",
  },
  statusTaken: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  suggestWrap: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  suggestLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  suggestRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radiusTokens.full,
    borderWidth: 1,
    borderColor: "rgba(255,138,76,0.5)",
    backgroundColor: "rgba(255,138,76,0.12)",
  },
  chipText: {
    fontSize: typography.caption.fontSize,
    color: accent.warm,
    fontWeight: "600",
  },
  errText: {
    color: "#EF4444",
    fontSize: typography.caption.fontSize,
  },
});

export default VenueStep2NameSlug;
