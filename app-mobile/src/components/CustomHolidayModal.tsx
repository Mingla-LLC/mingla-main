import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAwareView } from "./ui/KeyboardAwareView";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";

interface CustomHolidayModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (holiday: {
    name: string;
    month: number;
    day: number;
    description: string | null;
    categories: string[];
  }) => void;
}

const CATEGORIES = [
  { label: "Fine Dining", slug: "fine_dining" },
  { label: "Play", slug: "play" },
  { label: "Nature", slug: "nature" },
  { label: "Drink", slug: "drink" },
  { label: "Wellness", slug: "wellness" },
  { label: "Watch", slug: "watch" },
];

const MONTHS_LIST = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getDaysInMonth(month: number): number {
  // month is 1-indexed
  return new Date(2024, month, 0).getDate();
}

const CustomHolidayModal: React.FC<CustomHolidayModalProps> = ({
  visible,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState("");
  const [month, setMonth] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [errors, setErrors] = useState<{
    name?: string;
    date?: string;
    categories?: string;
  }>({});

  useEffect(() => {
    if (!visible) {
      setName("");
      setMonth(null);
      setDay(null);
      setDescription("");
      setSelectedCategories([]);
      setErrors({});
    }
  }, [visible]);

  const maxDay = month ? getDaysInMonth(month) : 31;

  useEffect(() => {
    if (day && month && day > getDaysInMonth(month)) {
      setDay(getDaysInMonth(month));
    }
  }, [month]);

  const toggleCategory = (slug: string) => {
    setSelectedCategories((prev) =>
      prev.includes(slug)
        ? prev.filter((c) => c !== slug)
        : [...prev, slug]
    );
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = "Give this day a name";
    if (!month || !day) newErrors.date = "Pick a date";
    if (selectedCategories.length === 0)
      newErrors.categories = "Choose at least one category";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave({
      name: name.trim(),
      month: month!,
      day: day!,
      description: description.trim() || null,
      categories: selectedCategories,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <KeyboardAwareView
          style={styles.centeredView}
          dismissOnTap={false}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>Add a Special Day</Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={s(24)} color={colors.gray[400]} />
                </TouchableOpacity>
              </View>

              {/* Name */}
              <View style={styles.field}>
                <Text style={styles.label}>Day Name</Text>
                <TextInput
                  style={[styles.textInput, errors.name && styles.inputError]}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
                  }}
                  placeholder="e.g. Our Anniversary"
                  placeholderTextColor={colors.gray[400]}
                  maxLength={50}
                />
                {errors.name ? (
                  <Text style={styles.errorText}>{errors.name}</Text>
                ) : null}
              </View>

              {/* Date */}
              <View style={styles.field}>
                <Text style={styles.label}>Date</Text>
                <View style={styles.dateRow}>
                  {/* Month picker */}
                  <View style={styles.monthPicker}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.monthScrollContent}
                    >
                      {MONTHS_LIST.map((m, i) => (
                        <TouchableOpacity
                          key={m}
                          style={[
                            styles.monthPill,
                            month === i + 1 && styles.monthPillSelected,
                          ]}
                          onPress={() => {
                            setMonth(i + 1);
                            if (errors.date)
                              setErrors((e) => ({ ...e, date: undefined }));
                          }}
                        >
                          <Text
                            style={[
                              styles.monthPillText,
                              month === i + 1 && styles.monthPillTextSelected,
                            ]}
                          >
                            {m.slice(0, 3)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                {/* Day picker */}
                {month ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dayScrollContent}
                    style={styles.dayPicker}
                  >
                    {Array.from({ length: maxDay }, (_, i) => i + 1).map(
                      (d) => (
                        <TouchableOpacity
                          key={d}
                          style={[
                            styles.dayPill,
                            day === d && styles.dayPillSelected,
                          ]}
                          onPress={() => {
                            setDay(d);
                            if (errors.date)
                              setErrors((e) => ({ ...e, date: undefined }));
                          }}
                        >
                          <Text
                            style={[
                              styles.dayPillText,
                              day === d && styles.dayPillTextSelected,
                            ]}
                          >
                            {d}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </ScrollView>
                ) : null}
                {errors.date ? (
                  <Text style={styles.errorText}>{errors.date}</Text>
                ) : null}
              </View>

              {/* Description */}
              <View style={styles.field}>
                <Text style={styles.label}>Description (optional)</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What makes this day special?"
                  placeholderTextColor={colors.gray[400]}
                  multiline
                  maxLength={200}
                />
              </View>

              {/* Categories */}
              <View style={styles.field}>
                <Text style={styles.label}>Categories</Text>
                <View style={styles.categoriesWrap}>
                  {CATEGORIES.map((cat) => {
                    const selected = selectedCategories.includes(cat.slug);
                    return (
                      <TouchableOpacity
                        key={cat.slug}
                        style={[
                          styles.categoryPill,
                          selected && styles.categoryPillSelected,
                        ]}
                        onPress={() => {
                          toggleCategory(cat.slug);
                          if (errors.categories)
                            setErrors((e) => ({
                              ...e,
                              categories: undefined,
                            }));
                        }}
                      >
                        {selected ? (
                          <Ionicons
                            name="checkmark"
                            size={s(14)}
                            color="#FFFFFF"
                          />
                        ) : null}
                        <Text
                          style={[
                            styles.categoryPillText,
                            selected && styles.categoryPillTextSelected,
                          ]}
                        >
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {errors.categories ? (
                  <Text style={styles.errorText}>{errors.categories}</Text>
                ) : null}
              </View>

              {/* Save */}
              <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                <Text style={styles.saveButtonText}>Save Day</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </KeyboardAwareView>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  centeredView: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: s(20),
    padding: s(24),
    marginHorizontal: s(24),
    maxHeight: SCREEN_HEIGHT * 0.8,
    width: SCREEN_WIDTH - s(48),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: vs(20),
  },
  title: {
    fontSize: s(20),
    fontWeight: "700",
    color: colors.gray[800],
  },
  field: {
    marginBottom: vs(18),
  },
  label: {
    fontSize: s(14),
    fontWeight: "600",
    color: colors.gray[700],
    marginBottom: vs(8),
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: s(12),
    paddingHorizontal: s(14),
    paddingVertical: vs(12),
    fontSize: s(15),
    color: colors.gray[800],
    backgroundColor: colors.gray[50] ?? "#F9FAFB",
  },
  textArea: {
    minHeight: vs(80),
    textAlignVertical: "top",
  },
  inputError: {
    borderColor: "#E53935",
  },
  errorText: {
    fontSize: s(12),
    color: "#E53935",
    marginTop: vs(4),
  },
  dateRow: {
    flexDirection: "row",
  },
  monthPicker: {
    flex: 1,
  },
  monthScrollContent: {
    gap: s(6),
  },
  monthPill: {
    paddingHorizontal: s(12),
    paddingVertical: vs(8),
    borderRadius: s(10),
    backgroundColor: colors.gray[100],
  },
  monthPillSelected: {
    backgroundColor: "#eb7825",
  },
  monthPillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  monthPillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  dayPicker: {
    marginTop: vs(10),
  },
  dayScrollContent: {
    gap: s(6),
  },
  dayPill: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: colors.gray[100],
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillSelected: {
    backgroundColor: "#eb7825",
  },
  dayPillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  dayPillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  categoriesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: s(8),
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    paddingHorizontal: s(14),
    paddingVertical: vs(8),
    borderRadius: s(20),
    backgroundColor: colors.gray[100],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  categoryPillSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  categoryPillText: {
    fontSize: s(13),
    fontWeight: "500",
    color: colors.gray[600],
  },
  categoryPillTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  saveButton: {
    backgroundColor: "#eb7825",
    borderRadius: s(14),
    paddingVertical: vs(16),
    alignItems: "center",
    marginTop: vs(8),
  },
  saveButtonText: {
    fontSize: s(16),
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

export default CustomHolidayModal;
