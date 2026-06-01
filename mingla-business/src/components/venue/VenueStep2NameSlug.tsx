/**
 * Ve1 wizard — Step 2: Venue name (+ auto-selected web address / slug).
 *
 * META-ORCH-1009 Sub-E:
 *   B3 (operator-directed) — the slug is AUTO-SELECTED from the venue name and
 *        shown read-only as the public-URL preview. It is NOT a typeable field.
 *        Alternate slug PILLS appear only when the auto slug is already taken;
 *        tapping a pill selects it. The name field is the only text input here.
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

  // True once the operator has picked an alternate slug pill. While false the
  // slug auto-mirrors the name; after an explicit pick we stop overwriting so a
  // deliberate choice is never clobbered by further name edits.
  const slugChosen = useRef(false);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const checkSeq = useRef(0);

  // B3 — derive the slug from the name automatically (until an alternate pill
  // is explicitly chosen). No typeable slug field exists.
  const onChangeName = useCallback(
    (t: string): void => {
      if (slugChosen.current) {
        patch({ displayName: t });
      } else {
        patch({ displayName: t, slug: slugifyBrandSlug(t) });
      }
    },
    [patch],
  );

  const onPickSuggestion = useCallback(
    (value: string): void => {
      slugChosen.current = true;
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
    const timer = setTimeout(() => {
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
    return () => clearTimeout(timer);
  }, [slug, accountId]);

  // B3 — fetch tappable alternate slugs only when the auto slug is taken.
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
    (showErrors && slug.trim().length === 0
      ? "Enter a venue name to generate your web address."
      : undefined);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>What's your venue called?</Text>
      <Text style={styles.helper}>
        We create your web address automatically from the name — no typing a slug.
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

      {/* B3 (operator-directed): slug auto-selected + read-only URL preview. */}
      {slug.trim().length > 0 ? (
        <View style={styles.urlPreview}>
          <Text style={styles.urlLabel}>Your public page</Text>
          <Text style={styles.urlValue}>
            business.usemingla.com/b/
            <Text style={styles.urlSlug}>{slug}</Text>
          </Text>
          {checking ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={accent.warm} />
              <Text style={styles.statusMuted}>Checking availability…</Text>
            </View>
          ) : available === true ? (
            <Text style={styles.statusOk}>✓ Available — auto-selected</Text>
          ) : available === false ? (
            <Text style={styles.statusTaken}>
              That address is taken — pick one below
            </Text>
          ) : null}
        </View>
      ) : null}
      {slugFieldErr !== undefined ? (
        <Text style={styles.errText}>{slugFieldErr}</Text>
      ) : null}

      {/* Alternate slug PILLS — only when the auto slug is taken. Tap to select;
          no manual typing anywhere in this step. */}
      {available === false && suggestions.length > 0 ? (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestLabel}>Available alternatives</Text>
          <View style={styles.suggestRow}>
            {suggestions.map((s) => (
              <Pressable
                key={s}
                onPress={() => onPickSuggestion(s)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${s} as your web address`}
                style={[styles.chip, slug === s ? styles.chipSelected : null]}
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
  chipSelected: {
    borderColor: accent.warm,
    backgroundColor: "rgba(255,138,76,0.22)",
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
  urlPreview: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  urlLabel: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  urlValue: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  urlSlug: {
    color: accent.warm,
    fontWeight: "700",
  },
});

export default VenueStep2NameSlug;
