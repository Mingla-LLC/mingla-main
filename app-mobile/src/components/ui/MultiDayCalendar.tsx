import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Icon } from './Icon';
import { colors, radius, spacing, typography, fontWeights, shadows } from '../../constants/designSystem';

interface MultiDayCalendarProps {
  selectedDates: string[];
  onDatesChange: (dates: string[]) => void;
  minDate?: Date;
  maxDate?: Date;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getMonthGrid(year: number, month: number): (number | null)[][] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rows: (number | null)[][] = [];
  let row: (number | null)[] = new Array(firstDay).fill(null);

  for (let day = 1; day <= daysInMonth; day++) {
    row.push(day);
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    while (row.length < 7) row.push(null);
    rows.push(row);
  }
  return rows;
}

export const MultiDayCalendar: React.FC<MultiDayCalendarProps> = ({
  selectedDates,
  onDatesChange,
  minDate,
  maxDate,
}) => {
  const today = new Date();
  const effectiveMin = minDate ?? today;
  const effectiveMax = maxDate ?? new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());

  const [displayMonth, setDisplayMonth] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const selectedSet = new Set(selectedDates);
  const todayStr = toISODateString(today);

  const canGoPrev = displayMonth.getFullYear() > today.getFullYear()
    || (displayMonth.getFullYear() === today.getFullYear() && displayMonth.getMonth() > today.getMonth());
  const canGoNext = displayMonth < new Date(effectiveMax.getFullYear(), effectiveMax.getMonth(), 1);

  const navigateMonth = useCallback((direction: -1 | 1): void => {
    if (direction === -1 && !canGoPrev) return;
    if (direction === 1 && !canGoNext) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (reduceMotion) {
      setDisplayMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start(() => {
        setDisplayMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    }
  }, [canGoPrev, canGoNext, fadeAnim, reduceMotion]);

  const handleDayPress = useCallback((day: number): void => {
    const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
    const dateStr = toISODateString(date);

    // Check if date is in the past
    if (date < new Date(effectiveMin.getFullYear(), effectiveMin.getMonth(), effectiveMin.getDate())) return;
    if (date > effectiveMax) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (selectedSet.has(dateStr)) {
      onDatesChange(selectedDates.filter(d => d !== dateStr));
    } else {
      onDatesChange([...selectedDates, dateStr].sort());
    }
  }, [displayMonth, selectedDates, selectedSet, onDatesChange, effectiveMin, effectiveMax]);

  const grid = getMonthGrid(displayMonth.getFullYear(), displayMonth.getMonth());
  const monthLabel = `${MONTH_NAMES[displayMonth.getMonth()]} ${displayMonth.getFullYear()}`;

  return (
    <View style={calStyles.container}>
      {/* Month header */}
      <View style={calStyles.monthHeader}>
        <Pressable
          onPress={() => navigateMonth(-1)}
          style={calStyles.navButton}
          accessibilityLabel="Previous month"
          accessibilityRole="button"
          disabled={!canGoPrev}
        >
          <Icon name="chevron-back" size={24} color={canGoPrev ? colors.text.secondary : colors.gray[300]} />
        </Pressable>
        <Text style={calStyles.monthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={() => navigateMonth(1)}
          style={calStyles.navButton}
          accessibilityLabel="Next month"
          accessibilityRole="button"
          disabled={!canGoNext}
        >
          <Icon name="chevron-forward" size={24} color={canGoNext ? colors.text.secondary : colors.gray[300]} />
        </Pressable>
      </View>

      {/* Day-of-week headers */}
      <View style={calStyles.dayHeaderRow}>
        {DAY_LABELS.map(label => (
          <View key={label} style={calStyles.dayHeaderCell}>
            <Text style={calStyles.dayHeaderText}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      <Animated.View style={{ opacity: fadeAnim }}>
        {grid.map((row, rowIdx) => (
          <View key={rowIdx} style={calStyles.dayRow}>
            {row.map((day, colIdx) => {
              if (day === null) {
                return <View key={`empty-${colIdx}`} style={calStyles.dayCell} />;
              }

              const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
              const dateStr = toISODateString(date);
              const isToday = dateStr === todayStr;
              const isSelected = selectedSet.has(dateStr);
              const isPast = date < new Date(effectiveMin.getFullYear(), effectiveMin.getMonth(), effectiveMin.getDate()) && !isSameDay(date, effectiveMin);
              const isFuture = date > effectiveMax;
              const isDisabled = isPast || isFuture;

              const dayLabel = `${MONTH_NAMES[date.getMonth()]} ${day}, ${date.getFullYear()}`;

              return (
                <Pressable
                  key={day}
                  style={calStyles.dayCell}
                  onPress={() => !isDisabled && handleDayPress(day)}
                  disabled={isDisabled}
                  accessibilityLabel={dayLabel}
                  accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  accessibilityRole="button"
                >
                  <View
                    style={[
                      calStyles.dayCircle,
                      isToday && !isSelected && calStyles.dayCircleToday,
                      isSelected && calStyles.dayCircleSelected,
                    ]}
                  >
                    <Text
                      style={[
                        calStyles.dayText,
                        isToday && !isSelected && calStyles.dayTextToday,
                        isSelected && calStyles.dayTextSelected,
                        isDisabled && calStyles.dayTextDisabled,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Animated.View>

      {/* Selected count badge */}
      {selectedDates.length > 0 && (
        <Text style={calStyles.selectedCount}>
          {selectedDates.length} date{selectedDates.length !== 1 ? 's' : ''} selected
        </Text>
      )}
    </View>
  );
};

const calStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    marginBottom: spacing.sm,
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    fontSize: typography.lg.fontSize,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
  },
  dayHeaderText: {
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  dayRow: {
    flexDirection: 'row',
    height: 44,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: {
    backgroundColor: colors.primary[50],
  },
  dayCircleSelected: {
    backgroundColor: colors.accent,
    shadowColor: '#eb7825',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  dayText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.regular,
    color: colors.text.primary,
  },
  dayTextToday: {
    fontWeight: fontWeights.semibold,
    color: colors.primary[600],
  },
  dayTextSelected: {
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  dayTextDisabled: {
    color: colors.gray[300],
    opacity: 0.4,
  },
  selectedCount: {
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.medium,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
