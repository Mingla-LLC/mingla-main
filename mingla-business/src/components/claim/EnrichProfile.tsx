import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import WizardChrome from "../onboarding/WizardChrome";
import {
  updateBusinessProfile,
  uploadBusinessPhoto,
  generateDescription,
  type PlacePoolItem,
} from "../../services/placeService";
import {
  colors,
  spacing,
  radius,
  fontWeights,
  surface,
  border,
} from "../../constants/designSystem";

interface EnrichProfileProps {
  place: PlacePoolItem;
  businessProfileId: string;
  onContinue: () => void;
  onBack: () => void;
}

export default function EnrichProfile({
  place,
  businessProfileId,
  onContinue,
  onBack,
}: EnrichProfileProps): React.JSX.Element {
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiOptions, setAiOptions] = useState<string[]>([]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  const handlePickPhoto = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets?.[0]) return;

    try {
      const url = await uploadBusinessPhoto(
        businessProfileId,
        result.assets[0].uri
      );
      setUploadedPhotos((prev) => [...prev, url]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      Alert.alert("Upload failed", msg);
    }
  };

  const handleGenerateAI = async (): Promise<void> => {
    setGeneratingAI(true);
    try {
      const options = await generateDescription(
        place.name,
        place.category ?? "business",
        place.city ?? "your city"
      );
      setAiOptions(options);
    } catch {
      Alert.alert("Couldn't generate", "Try writing your own description.");
    } finally {
      setGeneratingAI(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await updateBusinessProfile(businessProfileId, {
        description: description || undefined,
        contact_email: contactEmail || undefined,
        contact_phone: contactPhone || undefined,
      });
      onContinue();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't save";
      Alert.alert("Save failed", msg);
    } finally {
      setSaving(false);
    }
  };

  const googlePhotos = place.photos ?? [];
  const allPhotos = [...uploadedPhotos, ...googlePhotos];

  return (
    <WizardChrome
      currentStep={3}
      totalSteps={4}
      onBack={onBack}
      onContinue={handleSave}
      continueLabel="Continue"
      continueLoading={saving}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={styles.title}>Make it yours</Text>
          <Text style={styles.subtitle}>
            This is what Mingla users near you will see.
          </Text>

          {/* Photos */}
          <Text style={styles.sectionLabel}>Photos</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.photosRow}
          >
            {allPhotos.map((url, i) => (
              <Image
                key={`${url}-${i}`}
                source={{ uri: url }}
                style={styles.photoThumb}
              />
            ))}
            <TouchableOpacity
              style={styles.addPhotoButton}
              onPress={handlePickPhoto}
              activeOpacity={0.7}
            >
              <Ionicons
                name="camera-outline"
                size={24}
                color={colors.primary[500]}
              />
              <Text style={styles.addPhotoText}>Add yours</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Description */}
          <Text style={styles.sectionLabel}>Your story</Text>
          <TextInput
            style={styles.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Tell guests what makes your place special..."
            placeholderTextColor={colors.text.tertiary}
            multiline
            maxLength={500}
            textAlignVertical="top"
            accessibilityLabel="Business description"
          />
          {description.length > 400 && (
            <Text style={styles.charCount}>
              {description.length}/500
            </Text>
          )}

          {/* AI help */}
          {aiOptions.length === 0 ? (
            <TouchableOpacity
              style={styles.aiButton}
              onPress={handleGenerateAI}
              disabled={generatingAI}
              activeOpacity={0.7}
            >
              {generatingAI ? (
                <ActivityIndicator size="small" color={colors.primary[500]} />
              ) : (
                <Ionicons
                  name="sparkles"
                  size={16}
                  color={colors.primary[500]}
                />
              )}
              <Text style={styles.aiButtonText}>
                {generatingAI ? "Writing..." : "Help me write"}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.aiOptionsContainer}>
              {aiOptions.map((opt, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.aiOptionCard}
                  onPress={() => {
                    setDescription(opt);
                    setAiOptions([]);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.aiOptionText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Contact */}
          <Text style={styles.sectionLabel}>Contact</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              style={styles.input}
              value={contactEmail}
              onChangeText={setContactEmail}
              placeholder="business@example.com"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              accessibilityLabel="Contact email"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="phone-pad"
              autoComplete="tel"
              accessibilityLabel="Contact phone"
            />
          </View>
        </Animated.View>
      </ScrollView>
    </WizardChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  photosRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    marginRight: spacing.sm,
    backgroundColor: colors.gray[100],
  },
  addPhotoButton: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoText: {
    fontSize: 11,
    color: colors.primary[500],
    marginTop: 2,
  },
  textarea: {
    height: 120,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
  },
  charCount: {
    fontSize: 12,
    color: colors.text.tertiary,
    textAlign: "right",
    marginTop: 4,
  },
  aiButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: spacing.sm,
  },
  aiButtonText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  aiOptionsContainer: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  aiOptionCard: {
    backgroundColor: surface.selected,
    borderWidth: 1,
    borderColor: border.selected,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  aiOptionText: {
    fontSize: 14,
    color: colors.text.primary,
    lineHeight: 20,
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginBottom: 6,
  },
  input: {
    height: 48,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
  },
});
