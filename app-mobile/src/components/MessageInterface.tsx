import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  Alert,
  Platform,
  Animated,
  Linking,
  Modal,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Icon } from "./ui/Icon";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
// TODO: Uncomment after rebuilding app with expo-av native module
// import { Video, ResizeMode } from "expo-av";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { supabase } from "../services/supabase";
import { useKeyboard } from "../hooks/useKeyboard";
import { useChatPresence } from "../hooks/useChatPresence";
import { useBroadcastReceiver } from "../hooks/useBroadcastReceiver";
import { MessageBubble } from "./chat/MessageBubble";
import { ChatStatusLine } from "./chat/ChatStatusLine";
import { groupMessages, GroupedMessage } from "../utils/messageGrouping";
import { DirectMessage } from "../services/messagingService";
import { HapticFeedback } from "../utils/hapticFeedback";
import { colors as dsColors, spacing as dsSpacing } from "../constants/designSystem";
import { useAppLayout } from "../hooks/useAppLayout";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Lowers the composer vs raw keyboard math (still clears keyboard on most devices). */
const COMPOSER_KEYBOARD_LIFT_TRIM_PX = 130;

/** Vertical gap between composer border and input row; match bottom when keyboard is closed. */
const INPUT_AREA_VERTICAL_PADDING = 6;

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: "text" | "image" | "video" | "file";
  fileUrl?: string;
  fileName?: string;
  fileSize?: string;
  isMe: boolean;
  unread?: boolean;
  failed?: boolean;
  isRead?: boolean;
}

interface Friend {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen?: string;
}

interface MessageInterfaceProps {
  friend: Friend;
  onBack: () => void;
  onSendMessage: (
    content: string,
    type: "text" | "image" | "video" | "file",
    file?: File
  ) => void;
  messages: Message[];
  onSendCollabInvite?: (friend: Friend) => void;
  onAddToBoard?: (
    sessionIds: string[],
    friend: any,
    suppressNotification?: boolean
  ) => void;
  onShareSavedCard?: (friend: any, suppressNotification?: boolean) => void;
  onRemoveFriend?: (friend: any, suppressNotification?: boolean) => void;
  onBlockUser?: (friend: any, suppressNotification?: boolean) => void;
  onReportUser?: (friend: any, suppressNotification?: boolean) => void;
  boardsSessions?: any[];
  currentMode?: "solo" | string;
  onModeChange?: (mode: "solo" | string) => void;
  onUpdateBoardSession?: (updatedBoard: any) => void;
  onCreateSession?: (newSession: any) => void;
  availableFriends?: Friend[];
  isBlocked?: boolean;
  conversationId?: string | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  broadcastSeenIds?: React.MutableRefObject<Set<string>>;
  isOffline?: boolean;
}

export default function MessageInterface({
  friend,
  onBack,
  onSendMessage,
  messages,
  onSendCollabInvite,
  onAddToBoard,
  onShareSavedCard,
  onRemoveFriend,
  onBlockUser,
  onReportUser,
  boardsSessions = [],
  currentMode = "solo",
  onModeChange,
  onUpdateBoardSession,
  onCreateSession,
  availableFriends = [],
  isBlocked = false,
  conversationId = null,
  currentUserId = null,
  currentUserName = null,
  broadcastSeenIds: broadcastSeenIdsProp,
  isOffline = false,
}: MessageInterfaceProps) {
  // Helper function to clean email-like names
  const cleanName = (name: string): string => {
    if (!name) return "Unknown";
    // Remove @domain part if present (e.g., "john@gmail.com" -> "john")
    const atIndex = name.indexOf("@");
    if (atIndex !== -1) {
      return name.substring(0, atIndex).trim();
    }
    return name.trim();
  };

  const [newMessage, setNewMessage] = useState("");
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [showMoreOptionsMenu, setShowMoreOptionsMenu] = useState(false);
  const [showBoardSelection, setShowBoardSelection] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [selectedBoards, setSelectedBoards] = useState<string[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const { bottomNavTotalHeight } = useAppLayout();

  // ── Keyboard handling via useKeyboard hook ─────────────────
  const { keyboardHeight, isVisible: keyboardVisible, dismiss: dismissKeyboard } = useKeyboard({
    disableLayoutAnimation: true, // We use animated values instead
  });

  // Animated keyboard height (for smooth input bar transitions)
  const animatedKeyboardHeight = useRef(new Animated.Value(0)).current;
  /** IMEs often re-fire keyboard show with a smaller frame once typing starts; keep lift stable. */
  const keyboardHeightMaxWhileOpenRef = useRef(0);
  /** Android: avoid re-running Animated.timing on every keyboard frame (fights softwareKeyboardLayoutMode "pan"). */
  const prevComposerLiftRef = useRef(0);
  useEffect(() => {
    // Keyboard height is screen-based; the composer already sits above the bottom tab.
    // Using the full keyboard height as marginBottom double-counts the tab strip (~64px+)
    // and lifts the bar too high. Only the part of the keyboard that overlaps content
    // above the tab needs to be offset.
    //
    // Android: softwareKeyboardLayoutMode "pan" — same manual lift (see app.json).
    if (keyboardHeight <= 0) {
      keyboardHeightMaxWhileOpenRef.current = 0;
    } else {
      keyboardHeightMaxWhileOpenRef.current = Math.max(
        keyboardHeightMaxWhileOpenRef.current,
        keyboardHeight
      );
    }
    const effectiveKeyboardHeight =
      keyboardHeight <= 0 ? 0 : keyboardHeightMaxWhileOpenRef.current;
    const penetrationAboveTab = Math.max(0, effectiveKeyboardHeight - bottomNavTotalHeight);
    const adjustedHeight = Math.max(0, penetrationAboveTab - COMPOSER_KEYBOARD_LIFT_TRIM_PX);
    const prevLift = prevComposerLiftRef.current;
    prevComposerLiftRef.current = adjustedHeight;

    if (Platform.OS === "android") {
      if (adjustedHeight === 0) {
        Animated.timing(animatedKeyboardHeight, {
          toValue: 0,
          duration: 220,
          useNativeDriver: false,
        }).start();
      } else if (prevLift === 0) {
        Animated.timing(animatedKeyboardHeight, {
          toValue: adjustedHeight,
          duration: 220,
          useNativeDriver: false,
        }).start();
      } else {
        animatedKeyboardHeight.setValue(adjustedHeight);
      }
    } else {
      Animated.timing(animatedKeyboardHeight, {
        toValue: adjustedHeight,
        duration: 250,
        useNativeDriver: false,
      }).start();
    }
  }, [keyboardHeight, bottomNavTotalHeight]);

  // ── Fallback broadcastSeenIds ref if not provided ─────────
  const localBroadcastSeenIds = useRef(new Set<string>());
  const broadcastSeenIds = broadcastSeenIdsProp || localBroadcastSeenIds;

  // ── Presence & typing ─────────────────────────────────────
  const {
    participants: presenceParticipants,
    typingUsers,
    startTyping,
    stopTyping,
  } = useChatPresence({
    conversationId,
    currentUserId,
  });

  // ── Broadcast receiver (receive-only) ─────────────────────
  // IMPORTANT: This hook subscribes to the `chat:{conversationId}` broadcast channel.
  // ConnectionsPage.handleSendMessage depends on this channel being subscribed
  // so that supabase.channel() returns the existing subscribed channel for sending.
  // Do NOT remove this hook without moving the channel subscription to ConnectionsPage.
  const handleBroadcastMessage = useCallback(
    (_msg: DirectMessage) => {
      // ConnectionsPage owns all message state — broadcast messages are deduplicated
      // there via broadcastSeenIds ref + postgres_changes backup delivery.
    },
    []
  );

  useBroadcastReceiver({
    conversationId,
    currentUserId,
    broadcastSeenIds,
    onBroadcastMessage: handleBroadcastMessage,
  });

  // ── Message grouping (memoized) ───────────────────────────
  // groupMessages returns chronological order (oldest first).
  // FlatList with inverted={true} renders data[0] at the BOTTOM,
  // so we reverse to put newest first → newest appears at bottom.
  const groupedMessages = useMemo(() => {
    if (!messages.length) return [];
    const grouped = groupMessages(messages);
    return [...grouped].reverse();
  }, [messages]);

  // ── Presence-derived state for header ─────────────────────
  // presenceParticipants is Record<userId, { isOnline, lastSeenAt }>
  // typingUsers is string[] of userIds
  const otherPresence = useMemo(() => {
    if (!currentUserId) return null;
    const entries = Object.entries(presenceParticipants);
    const other = entries.find(([uid]) => uid !== currentUserId);
    return other ? other[1] : null;
  }, [presenceParticipants, currentUserId]);

  const isOtherOnline = otherPresence?.isOnline ?? friend.isOnline;
  const otherLastSeen = otherPresence?.lastSeenAt ?? null;
  const isOtherTyping = currentUserId
    ? typingUsers.some((uid) => uid !== currentUserId)
    : false;

  const handleSendMessage = () => {
    if (newMessage.trim() || selectedFile) {
      if (selectedFile) {
        const fileType =
          selectedFile.type === "image"
            ? "image"
            : selectedFile.type === "video"
            ? "video"
            : "file";
        onSendMessage(
          newMessage.trim() || selectedFile.name || "Media",
          fileType,
          selectedFile
        );
        setSelectedFile(null);
        setPreviewUrl("");
      } else {
        onSendMessage(newMessage.trim(), "text");
      }
      setNewMessage("");
      stopTyping();
      HapticFeedback.light();
    }
  };

  const handleFileSelect = async (type: "image" | "video" | "file") => {
    try {
      setShowAttachmentMenu(false);

      // Request permissions
      if (type === "image" || type === "video") {
        const { status } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "We need access to your media library to select files."
          );
          return;
        }
      }

      // Show processing loader BEFORE opening image picker
      setIsProcessingFile(true);

      let result;

      if (type === "image") {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          allowsEditing: false, // Disabled to avoid white background and "Crop" button issues
          quality: 0.7, // Reduced quality for faster processing
          allowsMultipleSelection: false,
        });
      } else if (type === "video") {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'videos',
          allowsEditing: false, // Disabled to avoid UI issues
          quality: 0.7, // Reduced quality for faster processing
          allowsMultipleSelection: false,
        });
      } else {
        // For documents, use image picker with all types (fallback)
        // Note: For better document support, consider installing expo-document-picker
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          allowsEditing: false,
          allowsMultipleSelection: false,
        });
      }

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsProcessingFile(false);
        return;
      }

      const asset = result.assets[0];

      // Create file object matching what handleSendMessage expects
      const file = {
        uri: asset.uri,
        name:
          asset.fileName ||
          `file_${Date.now()}.${asset.uri.split(".").pop() || "jpg"}`,
        type: asset.type, // 'image' | 'video' | 'unknown'
        size: asset.fileSize || 0,
      };

      // Set file and prepare preview - loader stays visible
      setSelectedFile(file);
      setIsLoadingPreview(true);
      setPreviewUrl(""); // Clear preview URL initially

      // Set preview URL and hide processing loader only when preview is ready
      if (asset.type === "image" || asset.type === "video") {
        // Set preview URL
        setPreviewUrl(asset.uri);

        // Wait for image to load, then hide processing loader and preview loader
        setTimeout(() => {
          setIsLoadingPreview(false);
          setIsProcessingFile(false); // Hide processing loader only when preview is ready
        }, 500); // Delay to ensure image loads
      } else {
        // For non-image/video files, hide loaders immediately
        setIsLoadingPreview(false);
        setIsProcessingFile(false);
      }
    } catch (error) {
      console.error("Error selecting file:", error);
      setIsLoadingPreview(false);
      setIsProcessingFile(false);
      setSelectedFile(null);
      setPreviewUrl("");
      Alert.alert("Error", "Failed to select file. Please try again.");
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreviewUrl("");
    setIsLoadingPreview(false);
    setIsProcessingFile(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleViewDocument = async (url: string) => {
    try {
      // Check if URL is valid
      if (!url) {
        Alert.alert("Error", "Document URL is not available");
        return;
      }

      // Try to open in WebBrowser first (for PDFs and web-viewable documents)
      try {
        await WebBrowser.openBrowserAsync(url, {
          showTitle: true,
          toolbarColor: "#eb7825",
          enableBarCollapsing: false,
        });
      } catch (error) {
        // Fallback to Linking for native apps
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
        } else {
          Alert.alert(
            "Error",
            "Unable to open document. Please check your internet connection."
          );
        }
      }
    } catch (error) {
      console.error("Error opening document:", error);
      Alert.alert("Error", "Failed to open document. Please try again.");
    }
  };

  const handleOpenVideo = async (url: string) => {
    try {
      if (!url) {
        Alert.alert("Error", "Video URL is not available");
        return;
      }
      // Try to open video externally as fallback
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          "Error",
          "Unable to open video. Please check your internet connection."
        );
      }
    } catch (error) {
      console.error("Error opening video:", error);
      Alert.alert("Error", "Failed to open video. Please try again.");
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  // Notification management
  const showNotification = (
    title: string,
    message: string,
    type: "success" | "error" | "info" = "success"
  ) => {
    const notification = {
      id: `local-${Date.now()}`,
      title,
      message,
      type,
      timestamp: Date.now(),
    };
    setNotifications((prev) => [...prev, notification]);

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    }, 3000);
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // More options handlers

  const handleAddToBoard = () => {
    if (boardsSessions.length === 0) {
      showNotification(
        "No Boards Available",
        "Create a collaboration board first to add friends",
        "info"
      );
      setShowMoreOptionsMenu(false);
      return;
    }
    setShowBoardSelection(true);
    setShowMoreOptionsMenu(false);
  };

  const handleBoardSelection = (selectedBoards: string[]) => {
    if (selectedBoards.length > 0) {
      onAddToBoard?.(selectedBoards, friend, true);
      showNotification(
        "Added to Board!",
        `${friend.name} has been added to ${
          selectedBoards.length
        } collaboration board${selectedBoards.length > 1 ? "s" : ""}`
      );
    }
    setShowBoardSelection(false);
  };

  const handleShareSavedCard = () => {
    onShareSavedCard?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      "Card Shared!",
      `A saved experience has been shared with ${friend.name}`
    );
  };

  const handleRemoveFriend = () => {
    onRemoveFriend?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      "Friend Removed",
      `${friend.name} has been removed from your friends list`
    );
  };

  const handleBlockUser = () => {
    onBlockUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification("User Blocked", `${friend.name} has been blocked`);
  };

  const handleReportUser = () => {
    onReportUser?.(friend, true);
    setShowMoreOptionsMenu(false);
    showNotification(
      "User Reported",
      `Thank you for reporting ${friend.name}. Our team will review this report.`
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {/* Top Row: Back button, Avatar, Name and Status */}
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color="#6b7280" />
          </TouchableOpacity>

          <View style={styles.avatarContainer}>
            {friend.avatar ? (
              <ImageWithFallback
                source={{ uri: friend.avatar }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {cleanName(friend.name)
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </Text>
              </View>
            )}
            {isOtherOnline && <View style={styles.onlineIndicator} />}
          </View>

          <View style={styles.userInfo}>
            <Text style={styles.userName}>{cleanName(friend.name)}</Text>
            <ChatStatusLine
              isOnline={isOtherOnline}
              isTyping={isOtherTyping}
              lastSeenAt={otherLastSeen}
            />
          </View>
        </View>

        {/* Bottom Row: Action Icons */}
        {/* Commented out header icons temporarily */}
        {/* <View style={styles.headerActions}>
          <TouchableOpacity style={styles.actionButton}>
            <Icon name="call" size={16} color="#6b7280" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Icon name="videocam" size={16} color="#6b7280" />
          </TouchableOpacity>
          <View style={styles.moreOptionsContainer}>
            <TouchableOpacity
              onPress={() => setShowMoreOptionsMenu(!showMoreOptionsMenu)}
              style={styles.actionButton}
            >
              <Icon name="ellipsis-horizontal" size={16} color="#6b7280" />
            </TouchableOpacity>

            {showMoreOptionsMenu && (
              <View style={styles.moreOptionsMenu}>
                <TouchableOpacity
                  onPress={handleAddToBoard}
                  style={styles.menuItem}
                >
                  <Icon name="people" size={16} color="#6b7280" />
                  <Text style={styles.menuItemText}>Add to Board</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleShareSavedCard}
                  style={styles.menuItem}
                >
                  <Icon name="bookmark" size={16} color="#6b7280" />
                  <Text style={styles.menuItemText}>Share Saved Card</Text>
                </TouchableOpacity>
                <View style={styles.menuDivider} />
                <TouchableOpacity
                  onPress={handleRemoveFriend}
                  style={styles.menuItemDanger}
                >
                  <Icon name="person-remove" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Remove Friend</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBlockUser}
                  style={styles.menuItemDanger}
                >
                  <Icon name="shield" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Block User</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleReportUser}
                  style={styles.menuItemDanger}
                >
                  <Icon name="flag" size={16} color="#dc2626" />
                  <Text style={styles.menuItemTextDanger}>Report User</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View> */}
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={[styles.messagesContainer, { justifyContent: "center" }]}>
          <View style={styles.emptyState}>
            <View style={styles.emptyStateIcon}>
              <Icon name="chatbubble" size={32} color="#eb7825" />
            </View>
            <Text style={styles.emptyStateTitle}>Start your conversation</Text>
            <Text style={styles.emptyStateText}>
              Send a message to {cleanName(friend.name)}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          renderItem={({ item }) => (
            <MessageBubble
              message={{
                id: item.message.id,
                content: item.message.content,
                timestamp: item.message.timestamp,
                type: item.message.type,
                fileUrl: item.message.fileUrl,
                fileName: item.message.fileName,
                fileSize: item.message.fileSize,
                isMe: item.message.isMe,
                failed: item.message.failed,
              }}
              isMe={item.message.isMe}
              groupPosition={item.groupPosition}
              showTimestamp={item.showTimestamp}
              isRead={item.message.isMe && !item.message.id.startsWith("temp-") && (item.message.isRead === true)}
            />
          )}
          keyExtractor={(item) => item.message.id}
          inverted={true}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContentContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Processing File Loader */}
      <Modal visible={isProcessingFile} transparent={true} animationType="fade">
        <View style={styles.processingOverlay}>
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#eb7825" />
            <Text style={styles.processingText}>Processing file...</Text>
          </View>
        </View>
      </Modal>

      {/* File Preview */}
      {selectedFile && (
        <View style={styles.filePreview}>
          <View style={styles.filePreviewContent}>
            {isLoadingPreview ? (
              <View style={styles.filePreviewLoader}>
                <ActivityIndicator size="small" color="#eb7825" />
              </View>
            ) : previewUrl &&
              (selectedFile.type === "image" ||
                selectedFile.type?.startsWith("image/")) ? (
              <TouchableOpacity
                onPress={() => setShowImagePreview(true)}
                activeOpacity={0.8}
              >
                <ImageWithFallback
                  source={{ uri: previewUrl }}
                  style={styles.filePreviewImage}
                />
              </TouchableOpacity>
            ) : previewUrl && selectedFile.type?.startsWith("video/") ? (
              <View style={styles.filePreviewVideo}>
                <Icon name="play-circle" size={24} color="#eb7825" />
              </View>
            ) : (
              <View style={styles.filePreviewIcon}>
                <Icon name="document-text" size={24} color="#eb7825" />
              </View>
            )}

            <View style={styles.filePreviewInfo}>
              <Text style={styles.filePreviewName}>{selectedFile.name}</Text>
              <Text style={styles.filePreviewSize}>
                {formatFileSize(selectedFile.size)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleRemoveFile}
              style={styles.removeFileButton}
            >
              <Icon name="close" size={12} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Full Screen Image Preview Modal */}
      <Modal
        visible={showImagePreview}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowImagePreview(false)}
      >
        <View style={styles.imagePreviewModal}>
          <TouchableOpacity
            style={styles.imagePreviewCloseButton}
            onPress={() => setShowImagePreview(false)}
          >
            <Icon name="close" size={28} color="white" />
          </TouchableOpacity>
          {previewUrl && (
            <ImageWithFallback
              source={{ uri: previewUrl }}
              style={styles.imagePreviewFullscreen}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Offline Banner */}
      {isOffline && !isBlocked && (
        <View style={styles.offlineBanner}>
          <Icon name="cloud-offline-outline" size={16} color="#92400e" />
          <Text style={styles.offlineBannerText}>
            You're offline — showing saved messages
          </Text>
        </View>
      )}

      {/* Blocked User Banner */}
      {isBlocked && (
        <View style={styles.blockedBanner}>
          <Icon name="ban" size={18} color="#dc2626" />
          <Text style={styles.blockedBannerText}>
            Messaging is not available with this user
          </Text>
        </View>
      )}

      {/* Input Area - Hidden when blocked */}
      {!isBlocked && (
      <Animated.View
        style={[
          styles.inputArea,
          {
            // Match padding below the row to padding above (inputArea.paddingTop / border).
            paddingBottom: keyboardVisible ? 0 : INPUT_AREA_VERTICAL_PADDING,
            marginBottom: animatedKeyboardHeight,
          },
        ]}
      >
        <View style={styles.inputContainer}>
          {/* Attachment Menu */}
          <View style={styles.attachmentContainer}>
            <TouchableOpacity
              onPress={() => setShowAttachmentMenu(!showAttachmentMenu)}
              style={styles.attachmentButton}
            >
              <Icon name="attach" size={20} color="#6b7280" />
            </TouchableOpacity>

            {showAttachmentMenu && (
              <View style={styles.attachmentMenu}>
                <TouchableOpacity
                  onPress={() => handleFileSelect("image")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="image" size={16} color="#3b82f6" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>Photo</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      Share an image
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleFileSelect("video")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="videocam" size={16} color="#8b5cf6" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>Video</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      Share a video
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleFileSelect("file")}
                  style={styles.attachmentMenuItem}
                >
                  <View style={styles.attachmentMenuIcon}>
                    <Icon name="document-text" size={16} color="#10b981" />
                  </View>
                  <View>
                    <Text style={styles.attachmentMenuTitle}>Document</Text>
                    <Text style={styles.attachmentMenuSubtitle}>
                      Share a file
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Message Input */}
          <TouchableOpacity
            style={styles.messageInputContainer}
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
          >
            <TextInput
              ref={inputRef}
              value={newMessage}
              onChangeText={(text) => {
                setNewMessage(text);
                if (text.length > 0) {
                  startTyping();
                } else {
                  stopTyping();
                }
              }}
              onBlur={stopTyping}
              placeholder={
                selectedFile ? "Add a caption..." : "Type a message..."
              }
              placeholderTextColor="#9ca3af"
              style={styles.messageInput}
              multiline={false}
              maxLength={1000}
            />
          </TouchableOpacity>

          {/* Send Button */}
          <TouchableOpacity
            onPress={handleSendMessage}
            disabled={!newMessage.trim() && !selectedFile}
            style={[
              styles.sendButton,
              !newMessage.trim() && !selectedFile && styles.sendButtonDisabled,
            ]}
          >
            <Icon name="paper-plane" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </Animated.View>
      )}

      {/* Hidden File Input - Not supported in React Native */}
      {/* File selection will be handled through TouchableOpacity and native file picker */}

      {/* Board Selection Modal */}
      {showBoardSelection && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Board</Text>
              <TouchableOpacity
                onPress={() => setShowBoardSelection(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={12} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Select collaboration boards to add {friend.name} to:
            </Text>

            <ScrollView style={styles.boardList}>
              {boardsSessions.map((board) => (
                <TouchableOpacity
                  key={board.id}
                  onPress={() => {
                    const isSelected = selectedBoards.includes(board.id);
                    if (isSelected) {
                      setSelectedBoards((prev) =>
                        prev.filter((id) => id !== board.id)
                      );
                    } else {
                      setSelectedBoards((prev) => [...prev, board.id]);
                    }
                  }}
                  style={[
                    styles.boardItem,
                    selectedBoards.includes(board.id) &&
                      styles.boardItemSelected,
                  ]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selectedBoards.includes(board.id) &&
                        styles.checkboxSelected,
                    ]}
                  >
                    {selectedBoards.includes(board.id) && (
                      <Icon name="checkmark" size={12} color="white" />
                    )}
                  </View>
                  <View style={styles.boardInfo}>
                    <Text style={styles.boardName}>{board.name}</Text>
                    <Text style={styles.boardParticipants}>
                      {board.participants?.length || 0} participants
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setShowBoardSelection(false)}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleBoardSelection(selectedBoards)}
                style={styles.confirmButton}
              >
                <Text style={styles.confirmButtonText}>Add to Board</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Local Notifications */}
      {notifications.length > 0 && (
        <View style={styles.notificationsContainer}>
          {notifications.map((notification) => (
            <View key={notification.id} style={styles.notification}>
              <View
                style={[
                  styles.notificationIndicator,
                  {
                    backgroundColor:
                      notification.type === "success"
                        ? "#10b981"
                        : notification.type === "error"
                        ? "#ef4444"
                        : "#3b82f6",
                  },
                ]}
              />
              <View style={styles.notificationContent}>
                <Text style={styles.notificationTitle}>
                  {notification.title}
                </Text>
                <Text style={styles.notificationMessage}>
                  {notification.message}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => dismissNotification(notification.id)}
                style={styles.dismissButton}
              >
                <Icon name="close" size={12} color="#6b7280" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef3c7",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#fde68a",
    gap: 6,
  },
  offlineBannerText: {
    fontSize: 13,
    color: "#92400e",
    fontWeight: "500",
  },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef2f2",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: "#fecaca",
    gap: 8,
  },
  blockedBannerText: {
    fontSize: 14,
    color: "#dc2626",
    fontWeight: "500",
  },
  header: {
    paddingHorizontal: 0,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "white",
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    /*  backgroundColor: "#f3f4f6", */
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  avatarContainer: {
    position: "relative",
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    backgroundColor: "#eb7825",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "white",
    fontWeight: "500",
    fontSize: 14,
  },
  onlineIndicator: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    backgroundColor: "#10b981",
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "white",
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
  },
  userStatus: {
    fontSize: 14,
    color: "#6b7280",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingLeft: 48, // Align with content (back button + avatar width)
  },
  actionButton: {
    width: 32,
    height: 32,
    backgroundColor: "#f3f4f6",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  moreOptionsContainer: {
    position: "relative",
  },
  moreOptionsMenu: {
    position: "absolute",
    top: 40,
    right: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    paddingVertical: 8,
    minWidth: 220,
    zIndex: 20,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemDanger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 14,
    color: "#374151",
  },
  menuItemTextDanger: {
    fontSize: 14,
    color: "#dc2626",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 8,
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContentContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    backgroundColor: "#fef3e2",
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
  messagesList: {
    gap: 16,
  },
  messageContainer: {
    marginBottom: 16,
  },
  messageContainerLeft: {
    alignItems: "flex-start",
  },
  messageContainerRight: {
    alignItems: "flex-end",
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
    maxWidth: "70%",
  },
  messageBubbleLeft: {
    backgroundColor: "#f3f4f6",
  },
  messageBubbleRight: {
    backgroundColor: "#eb7825",
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  messageTextLeft: {
    color: "#111827",
  },
  messageTextRight: {
    color: "white",
  },
  messageCaption: {
    marginBottom: 8,
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
  },
  videoContainer: {
    width: 200,
    height: 150,
    borderRadius: 8,
    overflow: "hidden",
  },
  videoPlaceholder: {
    width: 200,
    height: 150,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  videoPlayer: {
    width: "100%",
    height: "100%",
  },
  videoText: {
    fontSize: 14,
    marginTop: 8,
  },
  videoTextLeft: {
    color: "#6b7280",
  },
  videoTextRight: {
    color: "white",
  },
  fileContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderRadius: 8,
  },
  fileContainerLeft: {
    backgroundColor: "white",
  },
  fileContainerRight: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  fileIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  fileIconLeft: {
    backgroundColor: "#f3f4f6",
  },
  fileIconRight: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "500",
  },
  fileNameLeft: {
    color: "#111827",
  },
  fileNameRight: {
    color: "white",
  },
  fileSize: {
    fontSize: 12,
    marginTop: 2,
  },
  fileSizeLeft: {
    color: "#6b7280",
  },
  fileSizeRight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  messageTimestamp: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 4,
  },
  messageTimestampLeft: {
    textAlign: "left",
  },
  messageTimestampRight: {
    textAlign: "right",
  },
  processingOverlay: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  processingContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
  },
  processingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  filePreview: {
    padding: 16,
    backgroundColor: "transparent",
  },
  filePreviewContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "white",
    padding: 12,
    borderRadius: 8,
  },
  filePreviewImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  filePreviewVideo: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewIcon: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewLoader: {
    width: 48,
    height: 48,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filePreviewInfo: {
    flex: 1,
    minWidth: 0,
  },
  filePreviewName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  filePreviewSize: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  removeFileButton: {
    width: 24,
    height: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreviewModal: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewCloseButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewFullscreen: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingTop: INPUT_AREA_VERTICAL_PADDING,
    paddingBottom: 0,
    backgroundColor: "white",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  attachmentContainer: {
    position: "relative",
  },
  attachmentButton: {
    width: 40,
    height: 40,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentMenu: {
    position: "absolute",
    bottom: 50,
    left: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    padding: 8,
    minWidth: 200,
    zIndex: 10,
  },
  attachmentMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 8,
  },
  attachmentMenuIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentMenuTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  attachmentMenuSubtitle: {
    fontSize: 12,
    color: "#6b7280",
  },
  messageInputContainer: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: "center",
  },
  messageInput: {
    fontSize: 16,
    color: "#111827",
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  sendButton: {
    width: 40,
    height: 40,
    backgroundColor: "#eb7825",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  modalContainer: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  modalCloseButton: {
    width: 24,
    height: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
  },
  boardList: {
    marginBottom: 24,
  },
  boardItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    marginBottom: 12,
  },
  boardItemSelected: {
    backgroundColor: "#fef3f2",
    borderColor: "#fecaca",
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: "#d1d5db",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  boardInfo: {
    flex: 1,
  },
  boardName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  boardParticipants: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    alignItems: "center",
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "white",
  },
  notificationsContainer: {
    position: "absolute",
    top: 80,
    left: 16,
    right: 16,
    zIndex: 50,
    gap: 8,
  },
  notification: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  notificationIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
    flexShrink: 0,
  },
  notificationContent: {
    flex: 1,
    minWidth: 0,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  notificationMessage: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 4,
  },
  dismissButton: {
    width: 24,
    height: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
});
