import React, { memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { MultiDayCalendar } from '../ui/MultiDayCalendar';
import { colors } from '../../constants/designSystem';

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

const PILL_GAP = 10;

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
    <View style={whenStyles.glassCard}>
      <Text style={whenStyles.question}>When are you heading out?</Text>

      {/* Date option pills */}
      <View style={whenStyles.pillsRow}>
        {DATE_OPTIONS.map(option => {
          const isSelected = dateOption === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => handleOptionPress(option.id)}
              style={[
                whenStyles.glassPill,
                isSelected && whenStyles.glassPillSelected,
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
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  question: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 14,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: PILL_GAP,
  },
  glassPill: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    shadowColor: 'rgba(0, 0, 0, 0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  glassPillSelected: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  pillTextSelected: {
    color: '#ffffff',
    fontWeight: '600',
  },
  calendarWrapper: {
    marginTop: 14,
  },
});
