import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface PicnicShoppingListProps {
  items: string[];
}

export function PicnicShoppingList({ items }: PicnicShoppingListProps) {
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());

  const toggleItem = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const checkedCount = checkedItems.size;
  const totalCount = items.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="cart-outline" size={18} color="#eb7825" />
        <Text style={styles.title}>Shopping List</Text>
        <Text style={styles.counter}>{checkedCount}/{totalCount}</Text>
      </View>
      {items.map((item, index) => {
        const isChecked = checkedItems.has(index);
        return (
          <TouchableOpacity
            key={`${index}-${item}`}
            style={styles.itemRow}
            onPress={() => toggleItem(index)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
              {isChecked && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </View>
            <Text style={[styles.itemText, isChecked && styles.itemTextChecked]}>
              {item}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#FFF8F0',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0E6D9',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
    marginLeft: 8,
    flex: 1,
  },
  counter: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D1D6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  itemText: {
    fontSize: 14,
    color: '#1C1C1E',
    flex: 1,
  },
  itemTextChecked: {
    textDecorationLine: 'line-through',
    color: '#8E8E93',
  },
});
