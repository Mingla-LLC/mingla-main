import * as React from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';

interface CalendarProps {
  selected?: Date;
  onSelect?: (date: Date) => void;
  mode?: "single" | "range";
  style?: any;
}

function Calendar({
  selected,
  onSelect,
  mode = "single",
  style,
  ...props
}: CalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(selected);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    onSelect?.(date);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    if (direction === 'prev') {
      newMonth.setMonth(newMonth.getMonth() - 1);
    } else {
      newMonth.setMonth(newMonth.getMonth() + 1);
    }
    setCurrentMonth(newMonth);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isSelected = (date: Date) => {
    if (!selectedDate) return false;
    return date.toDateString() === selectedDate.toDateString();
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <View style={[styles.calendar, style]} {...props}>
      {/* Header */}
      <View style={styles.header}>
        <TrackedTouchableOpacity logComponent="Calendar"
          style={styles.navButton}
          onPress={() => navigateMonth('prev')}
        >
          <Ionicons name="chevron-back" size={16} color="#6b7280" />
        </TrackedTouchableOpacity>
        
        <Text style={styles.monthYear}>
          {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </Text>
        
        <TrackedTouchableOpacity logComponent="Calendar"
          style={styles.navButton}
          onPress={() => navigateMonth('next')}
        >
          <Ionicons name="chevron-forward" size={16} color="#6b7280" />
        </TrackedTouchableOpacity>
      </View>

      {/* Day names */}
      <View style={styles.dayNames}>
        {dayNames.map((dayName) => (
          <Text key={dayName} style={styles.dayName}>
            {dayName}
          </Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={styles.calendarGrid}>
        {days.map((day, index) => {
          if (!day) {
            return <View key={index} style={styles.dayCell} />;
          }

          const isTodayDate = isToday(day);
          const isSelectedDate = isSelected(day);

          return (
            <TrackedTouchableOpacity logComponent="Calendar"
              key={day.toISOString()}
              style={[
                styles.dayCell,
                isTodayDate && styles.todayCell,
                isSelectedDate && styles.selectedCell,
              ]}
              onPress={() => handleDateSelect(day)}
            >
              <Text
                style={[
                  styles.dayText,
                  isTodayDate && styles.todayText,
                  isSelectedDate && styles.selectedText,
                ]}
              >
                {day.getDate()}
              </Text>
            </TrackedTouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: {
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  monthYear: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  dayNames: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayName: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    paddingVertical: 8,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    marginBottom: 4,
  },
  todayCell: {
    backgroundColor: '#f3f4f6',
  },
  selectedCell: {
    backgroundColor: '#eb7825',
  },
  dayText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '400',
  },
  todayText: {
    color: '#111827',
    fontWeight: '600',
  },
  selectedText: {
    color: 'white',
    fontWeight: '600',
  },
});

export { Calendar };
