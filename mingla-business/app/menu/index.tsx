import React, { useState } from "react";
import { Alert, ActivityIndicator, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import MenuCamera from "../../src/components/menu/MenuCamera";
import AIProcessing from "../../src/components/menu/AIProcessing";
import ReviewItems from "../../src/components/menu/ReviewItems";
import PurchaseOptionsScreen from "../../src/components/menu/PurchaseOptions";
import {
  uploadMenuPhoto,
  extractMenuItems,
  generatePurchaseOptions,
  saveMenuItems,
  savePurchaseOptions,
  type ExtractedMenuItem,
  type PurchaseOptionSuggestion,
} from "../../src/services/menuService";
import { getMyBusinessProfiles } from "../../src/services/placeService";
import { colors } from "../../src/constants/designSystem";

type MenuStep = "camera" | "processing" | "review" | "options";

export default function MenuScreen() {
  const router = useRouter();
  const { refreshAccountStatus } = useAuth();
  const [step, setStep] = useState<MenuStep>("camera");
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [extractedItems, setExtractedItems] = useState<ExtractedMenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<PurchaseOptionSuggestion[]>([]);
  const [businessProfileId, setBpId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const startProcessing = async (uris: string[]): Promise<void> => {
    setPhotoUris(uris);
    setStep("processing");
    setProcessing(true);

    try {
      // Get business profile ID
      const profiles = await getMyBusinessProfiles();
      if (profiles.length === 0) {
        Alert.alert("No place claimed", "Claim a place first before adding a menu.");
        router.back();
        return;
      }
      const bpId = profiles[0].id;
      setBpId(bpId);

      // Upload photos
      const uploadedUrls: string[] = [];
      for (let i = 0; i < uris.length; i++) {
        const url = await uploadMenuPhoto(bpId, uris[i], i + 1);
        uploadedUrls.push(url);
      }

      // Extract with AI
      const result = await extractMenuItems(bpId, uploadedUrls);
      setExtractedItems(result.items);
      setCategories(result.categories);
      setProcessing(false);

      // Short delay to show completion state, then advance
      setTimeout(() => setStep("review"), 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      Alert.alert("Extraction failed", msg);
      setStep("camera");
      setProcessing(false);
    }
  };

  const handleSaveItems = async (items: ExtractedMenuItem[]): Promise<void> => {
    if (!businessProfileId) return;
    try {
      await saveMenuItems(businessProfileId, items);

      // Generate purchase options
      const opts = await generatePurchaseOptions(
        businessProfileId,
        items.map((i) => ({ name: i.name, price: i.price, category: i.category })),
        "food"
      );
      setSuggestions(opts);
      setStep("options");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't save items";
      Alert.alert("Save failed", msg);
    }
  };

  const handlePublish = async (
    options: { name: string; description: string; price: number; price_unit: string }[]
  ): Promise<void> => {
    if (!businessProfileId) return;
    setPublishing(true);
    try {
      await savePurchaseOptions(businessProfileId, options);
      await refreshAccountStatus();
      Alert.alert("Published!", "Your menu and purchase options are now live.", [
        { text: "Go to dashboard", onPress: () => router.replace("/home" as never) },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't publish";
      Alert.alert("Publish failed", msg);
    } finally {
      setPublishing(false);
    }
  };

  switch (step) {
    case "camera":
      return (
        <MenuCamera
          onDone={startProcessing}
          onClose={() => router.back()}
        />
      );

    case "processing":
      return (
        <AIProcessing
          photoUri={photoUris[0] ?? ""}
          onItemsFound={() => {}}
          totalItems={extractedItems.length}
          categories={categories}
          isComplete={!processing}
        />
      );

    case "review":
      return (
        <ReviewItems
          items={extractedItems}
          onSave={handleSaveItems}
          onBack={() => setStep("camera")}
        />
      );

    case "options":
      return (
        <PurchaseOptionsScreen
          suggestions={suggestions}
          onPublish={handlePublish}
          onBack={() => setStep("review")}
          publishing={publishing}
        />
      );

    default:
      return null;
  }
}
