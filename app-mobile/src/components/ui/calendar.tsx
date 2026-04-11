import React from 'react';
import { View, Text } from 'react-native';

interface CalendarProps {
  selected?: Date;
  onSelect?: (date: Date) => void;
}

export const Calendar: React.FC<CalendarProps> = ({ selected, onSelect }) => {
  return (
    <View style={{ padding: 16, alignItems: 'center' }}>
      <Text style={{ color: '#666' }}>Calendar placeholder</Text>
    </View>
  );
};
