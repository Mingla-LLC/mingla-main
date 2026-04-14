import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, fontWeights } from "../../constants/designSystem";

interface MenuCameraProps {
  onDone: (photoUris: string[]) => void;
  onClose: () => void;
}

export default function MenuCamera({
  onDone,
  onClose,
}: MenuCameraProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [photos, setPhotos] = useState<string[]>([]);
  const cameraRef = useRef<CameraView>(null);

  const handleCapture = async (): Promise<void> => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
      });
      if (photo?.uri) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setPhotos((prev) => [...prev, photo.uri]);
      }
    } catch (e: unknown) {
      Alert.alert("Capture failed", "Couldn't take photo. Try again.");
    }
  };

  const handleLibrary = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (!result.canceled && result.assets) {
      const uris = result.assets.map((a) => a.uri);
      setPhotos((prev) => [...prev, ...uris]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleRemove = (index: number): void => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Permission not granted yet
  if (!permission?.granted) {
    return (
      <View style={[styles.permissionContainer, { paddingTop: insets.top + 20 }]}>
        <Ionicons name="camera-outline" size={48} color={colors.text.tertiary} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          We need your camera to scan your menu. You can also upload from your photo library.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
          activeOpacity={0.85}
        >
          <Text style={styles.permissionButtonText}>Enable camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.libraryFallback}
          onPress={handleLibrary}
          activeOpacity={0.7}
        >
          <Text style={styles.libraryFallbackText}>Upload from library instead</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
      >
        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={styles.topButton}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {photos.length > 0 && (
            <TouchableOpacity
              onPress={() => onDone(photos)}
              style={styles.doneButton}
            >
              <Text style={styles.doneText}>Done ({photos.length}) →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Instruction overlay */}
        {photos.length === 0 && (
          <View style={styles.instructionOverlay}>
            <Text style={styles.instructionText}>Snap each menu page</Text>
          </View>
        )}
      </CameraView>

      {/* Bottom controls */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {/* Thumbnail strip */}
        {photos.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.thumbStrip}
            contentContainerStyle={styles.thumbStripContent}
          >
            {photos.map((uri, i) => (
              <View key={`${uri}-${i}`} style={styles.thumbWrapper}>
                <Image source={{ uri }} style={styles.thumb} />
                <TouchableOpacity
                  style={styles.thumbRemove}
                  onPress={() => handleRemove(i)}
                >
                  <Ionicons name="close-circle" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Capture + Library */}
        <View style={styles.captureRow}>
          <TouchableOpacity
            style={styles.libraryButton}
            onPress={handleLibrary}
            activeOpacity={0.7}
          >
            <Ionicons name="images-outline" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.captureButton}
            onPress={handleCapture}
            activeOpacity={0.7}
          >
            <View style={styles.captureInner} />
          </TouchableOpacity>

          <View style={styles.libraryButton} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  topButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  doneButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  doneText: {
    fontSize: 15,
    fontWeight: fontWeights.semibold,
    color: "#fff",
  },
  instructionOverlay: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  instructionText: {
    fontSize: 14,
    color: "#fff",
    fontWeight: fontWeights.medium,
  },
  bottomBar: {
    backgroundColor: "#000",
    paddingTop: 12,
  },
  thumbStrip: {
    maxHeight: 64,
    marginBottom: 12,
  },
  thumbStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  thumbWrapper: {
    position: "relative",
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
  },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#fff",
  },
  libraryButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // Permission screen
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.background.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  permissionBody: {
    fontSize: 14,
    color: colors.text.tertiary,
    textAlign: "center",
    lineHeight: 20,
  },
  permissionButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.lg,
    marginTop: 8,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: "#fff",
  },
  libraryFallback: {
    paddingVertical: 8,
  },
  libraryFallbackText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  closeButton: {
    paddingVertical: 8,
    marginTop: 8,
  },
  closeText: {
    fontSize: 14,
    color: colors.text.tertiary,
  },
});
