import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { MultiDayCalendar } from '../ui/MultiDayCalendar';
import { colors, radius, spacing, typography, fontWeights } from '../../constants/designSystem';

export type DateOptionId = 'today' | 'this_weekend' | 'pick_dates';

interface WhenSectionProps {
  dateOption: DateOptionId | null;
  onDateOptionChange: (option: DateOptionId) => void;
  selectedDates: string[];
  onDatesChange: (dates: string[]) => void;
}

const DATE_OPTIONS: { id: DateOptionId; labelKey: string }[] = [
  { id: 'today', labelKey: 'date_options.today' },
  { id: 'this_weekend', labelKey: 'date_options.this_weekend' },
  { id: 'pick_dates', labelKey: 'date_options.pick_dates' },
];

const SCREEN_WIDTH = Dimensions.get('window').width;
const PILL_GAP = 10;
const CONTAINER_PADDING = 20;
const PILL_WIDTH = (SCREEN_WIDTH - CONTAINER_PADDING * 2 - PILL_GAP * 2) / 3;

export const WhenSection = memo(({
  dateOption,
  onDateOptionChange,
  selectedDates,
  onDatesChange,
}: WhenSectionProps): React.JSX.Element => {
  const { t } = useTranslation(['preferences']);

  const handleOptionPress = (id: DateOptionId): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDateOptionChange(id);
  };

  return (
    <View style={whenStyles.container}>
      <Text style={whenStyles.sectionTitle}>{t('preferences:datetime.title')}</Text>
      <Text style={whenStyles.sectionSubtitle}>{t('preferences:datetime.question')}</Text>

      {/* Date option pills */}
      <View style={whenStyles.pillsRow}>
        {DATE_OPTIONS.map(option => {
          const isSelected = dateOption === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => handleOptionPress(option.id)}
              style={[
                whenStyles.pill,
                isSelected && whenStyles.pillSelected,
              ]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={t(`preferences:${option.labelKey}`)}
            >
              <Text
                style={[
                  whenStyles.pillText,
                  isSelected && whenStyles.pillTextSelected,
                ]}
              >
                {t(`preferences:${option.labelKey}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Weekend info card */}
      {dateOption === 'this_weekend' && (
        <View style={whenStyles.weekendCard}>
          <Icon name="calendar" size={20} color={colors.primary[600]} style={{ marginRight: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={whenStyles.weekendTitle}>{t('preferences:datetime.this_weekend')}</Text>
            <Text style={whenStyles.weekendDesc}>{t('preferences:datetime.friday_through_sunday')}</Text>
          </View>
        </View>
      )}

      {/* Multi-day calendar */}
      {dateOption === 'pick_dates' && (
        <View style={whenStyles.calendarWrapper}>
          <MultiDayCalendar
            selectedDates={selectedDates}
            onDatesChange={onDatesChange}
          />
        </View>
      )}
    </View>
  );
});

WhenSection.displayName = 'WhenSection';

const whenStyles = StyleSheet.create({
  container: {
    paddingHorizontal: CONTAINER_PADDING,
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginBottom: 14,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: PILL_GAP,
  },
  pill: {
    width: PILL_WIDTH,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: {
    backgroundColor: colors.accent,
  },
  pillText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  pillTextSelected: {
    color: colors.text.inverse,
    fontWeight: fontWeights.semibold,
  },
  weekendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary[50],
    marginTop: 12,
  },
  weekendTitle: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: 2,
  },
  weekendDesc: {
    fontSize: 13,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
  calendarWrapper: {
    marginTop: 14,
  },
});
