/**
 * ProfileInterestsSection — ORCH-0627 glass re-skin.
 *
 * Chips:
 *   - Intent chips (ONBOARDING_INTENTS): orange-glow tokens (profile.chip.intent)
 *   - Category chips (categories):       neutral glass tokens (profile.chip.category)
 *
 * Header uses the card-title small-caps style; edit pencil is a white-6% circle button.
 * Empty state CTA is contained inside the card with white-10% hairline.
 *
 * Stagger entrance preserved, with Reduce Motion fallback (all chips fade together).
 *
 * Tokens: designSystem.ts → glass.profile.chip / .text.cardTitle
 * Spec:   DESIGN_ORCH-0627_PROFILE_GLASS_REFRESH_SPEC.md §4.2
 */
import React, { useRef, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Animated, AccessibilityInfo } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Pencil, Sparkles } from 'lucide-react-native';
import { ONBOARDING_INTENTS } from '../../types/onboarding';
import { categories as allCategories } from '../../constants/categories';
import { INTENT_ICON_MAP, CATEGORY_ICON_MAP } from '../../constants/interestIcons';
import { useTranslation } from 'react-i18next';
import { glass } from '../../constants/designSystem';

interface ProfileInterestsSectionProps {
  intents: string[];
  categories: string[];
  isOwnProfile: boolean;
  onEditPress?: () => void;
  /** Overrides default header title. */
  sectionTitle?: string;
}

const STAGGER_DELAY = 30;
const PILL_DURATION = 200;

const ProfileInterestsSection: React.FC<ProfileInterestsSectionProps> = ({
  intents,
  categories,
  isOwnProfile,
  onEditPress,
  sectionTitle,
}) => {
  const { t } = useTranslation(['profile', 'common']);
  const hasInterests = intents.length > 0 || categories.length > 0;
  const headerTitle = sectionTitle ?? (isOwnProfile
    ? t('profile:interests.your_interests')
    : t('profile:interests.interests'));
  const intentData = ONBOARDING_INTENTS.filter((i) => intents.includes(i.id));
  const categoryData = allCategories.filter((c) => categories.includes(c.name));
  const totalPills = intentData.length + categoryData.length;

  const intentsKey = useMemo(() => intents.join(','), [intents]);
  const categoriesKey = useMemo(() => categories.join(','), [categories]);

  // Reduce-motion preference
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(enabled),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Stagger animation refs
  const pillAnims = useRef<Animated.Value[]>([]);
  const pillTranslates = useRef<Animated.Value[]>([]);

  useEffect(() => {
    if (totalPills === 0) return;
    pillAnims.current = Array.from({ length: totalPills }, () => new Animated.Value(0));
    pillTranslates.current = Array.from({ length: totalPills }, () => new Animated.Value(reduceMotion ? 0 : 8));

    const animations = pillAnims.current.map((anim, i) =>
      Animated.parallel([
        Animated.timing(anim, {
          toValue: 1,
          duration: PILL_DURATION,
          delay: reduceMotion ? 0 : i * STAGGER_DELAY,
          useNativeDriver: true,
        }),
        Animated.timing(pillTranslates.current[i], {
          toValue: 0,
          duration: PILL_DURATION,
          delay: reduceMotion ? 0 : i * STAGGER_DELAY,
          useNativeDriver: true,
        }),
      ]),
    );
    Animated.parallel(animations).start();
  }, [intentsKey, categoriesKey, totalPills, reduceMotion]);

  // Empty state — viewer's profile (no edit affordances)
  if (!hasInterests && !isOwnProfile) {
    return (
      <View>
        <View style={styles.header}>
          <Text style={styles.title}>{headerTitle}</Text>
        </View>
        <Text style={styles.friendInterestsEmpty}>{t('profile:interests.not_shared')}</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{headerTitle}</Text>
        {isOwnProfile && (
          <TrackedTouchableOpacity
            logComponent="ProfileInterestsSection"
            onPress={onEditPress}
            style={styles.editButton}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel={t('profile:interests.edit_accessibility')}
            accessibilityRole="button"
          >
            <Pencil size={14} color="rgba(255, 255, 255, 0.80)" strokeWidth={2.5} />
          </TrackedTouchableOpacity>
        )}
      </View>

      {!hasInterests && isOwnProfile ? (
        <TrackedTouchableOpacity
          logComponent="ProfileInterestsSection"
          onPress={onEditPress}
          style={styles.emptyState}
          activeOpacity={0.8}
        >
          <Sparkles size={24} color="#eb7825" strokeWidth={2} />
          <Text style={styles.emptyText}>
            {t('profile:interests.empty_text')}
          </Text>
          <View style={styles.addButton}>
            <Text style={styles.addButtonText}>{t('profile:interests.add_interests')}</Text>
          </View>
        </TrackedTouchableOpacity>
      ) : (
        <View style={styles.pillsWrap}>
          {intentData.map((intent, i) => {
            const opacity = pillAnims.current[i] || new Animated.Value(1);
            const translateY = pillTranslates.current[i] || new Animated.Value(0);
            const IconComponent = INTENT_ICON_MAP[intent.id];
            return (
              <Animated.View
                key={intent.id}
                style={[
                  styles.intentPill,
                  { opacity, transform: [{ translateY }] },
                ]}
              >
                {IconComponent && (
                  <IconComponent size={glass.profile.chip.iconSize} color={glass.profile.chip.intent.iconColor} strokeWidth={2.5} />
                )}
                <Text style={styles.intentText}>{t(`common:intent_${intent.id.replace(/-/g, '_')}`)}</Text>
              </Animated.View>
            );
          })}
          {categoryData.map((cat, i) => {
            const idx = intentData.length + i;
            const opacity = pillAnims.current[idx] || new Animated.Value(1);
            const translateY = pillTranslates.current[idx] || new Animated.Value(0);
            const CatIcon = CATEGORY_ICON_MAP[cat.slug];
            return (
              <Animated.View
                key={cat.slug}
                style={[
                  styles.categoryPill,
                  { opacity, transform: [{ translateY }] },
                ]}
              >
                {CatIcon && (
                  <CatIcon size={glass.profile.chip.iconSize} color={glass.profile.chip.category.iconColor} strokeWidth={2} />
                )}
                <Text style={styles.categoryText}>{t(`common:category_${cat.slug}`)}</Text>
              </Animated.View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    ...glass.profile.text.cardTitle,
  },
  friendInterestsEmpty: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 14,
    fontWeight: '400',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  editButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Empty-state CTA card
  emptyState: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  addButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#eb7825',
    borderRadius: 999,
    marginTop: 14,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  // Pills row
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: glass.profile.chip.rowGap,
    columnGap: glass.profile.chip.columnGap,
  },
  // Intent (orange glow)
  intentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: glass.profile.chip.iconLabelGap,
    backgroundColor: glass.profile.chip.intent.bg,
    borderWidth: glass.profile.chip.intent.borderWidth,
    borderColor: glass.profile.chip.intent.border,
    borderRadius: glass.profile.chip.radius,
    height: glass.profile.chip.height,
    paddingHorizontal: glass.profile.chip.paddingHorizontal,
    // Soft orange glow on iOS
    shadowColor: glass.profile.chip.intent.shadowColor,
    shadowOpacity: glass.profile.chip.intent.shadowOpacity,
    shadowRadius: glass.profile.chip.intent.shadowRadius,
    shadowOffset: glass.profile.chip.intent.shadowOffset,
    elevation: 3,
  },
  intentText: {
    fontSize: glass.profile.chip.labelFontSize,
    fontWeight: glass.profile.chip.labelFontWeight,
    color: glass.profile.chip.intent.textColor,
    letterSpacing: 0.2,
  },
  // Category (neutral glass)
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: glass.profile.chip.iconLabelGap,
    backgroundColor: glass.profile.chip.category.bg,
    borderWidth: glass.profile.chip.category.borderWidth,
    borderColor: glass.profile.chip.category.border,
    borderRadius: glass.profile.chip.radius,
    height: glass.profile.chip.height,
    paddingHorizontal: glass.profile.chip.paddingHorizontal,
  },
  categoryText: {
    fontSize: glass.profile.chip.labelFontSize,
    fontWeight: '500',
    color: glass.profile.chip.category.textColor,
  },
});

export default ProfileInterestsSection;
