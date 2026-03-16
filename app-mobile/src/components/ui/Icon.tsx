/**
 * Unified Icon component — drop-in replacement for Ionicons & Feather.
 *
 * Maps legacy icon-name strings to Lucide components so that every file
 * in the codebase can switch with a single import change:
 *
 *   BEFORE:  import { Ionicons } from '@expo/vector-icons';
 *            <Ionicons name="heart-outline" size={20} color="#fff" />
 *
 *   AFTER:   import { Icon } from '../ui/Icon';
 *            <Icon name="heart-outline" size={20} color="#fff" />
 *
 * All rendering is delegated to lucide-react-native SVG components.
 */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

// ── Lucide imports (tree-shakeable — only what we use) ──────────────
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  Banknote,
  BarChart3,
  Bell,
  BellOff,
  Bike,
  Bookmark,
  Briefcase,
  Bus,
  Calendar,
  Camera,
  Car,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CirclePlay,
  CircleUser,
  CircleX,
  Clapperboard,
  Clock,
  Cloud,
  CloudOff,
  Crown,
  CloudUpload,
  Coffee,
  Compass,
  Copy,
  CreditCard,
  Diamond,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Flag,
  Flame,
  Footprints,
  Gamepad2,
  Gift,
  Globe,
  Grid3x3,
  Hamburger,
  Heart,
  Hourglass,
  Image,
  Images,
  Inbox,
  Info,
  Key,
  Layers,
  Leaf,
  Link,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  Mail,
  Map,
  MapPin,
  Menu,
  MessageCircle,
  MessageCircleMore,
  MessageSquare,
  MessagesSquare,
  Mic,
  Minus,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Music,
  Navigation,
  Palette,
  Paperclip,
  Pen,
  PenLine,
  Pencil,
  PersonStanding,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Star,
  Store,
  Sun,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  Trash2,
  Trophy,
  Type,
  Undo2,
  User,
  UserMinus,
  UserPlus,
  UserX,
  Users,
  UsersRound,
  UtensilsCrossed,
  Video,
  VolumeX,
  Wifi,
  Wine,
  X,
  Zap,
} from 'lucide-react-native';

// ── Master mapping: every Ionicons / Feather name → Lucide component ─
// Ionicons "-outline" variants map to the same Lucide icon (Lucide uses
// stroke-only icons by default, so filled vs outline is just strokeWidth).

const ICON_MAP: Record<string, LucideIcon> = {
  // ─── A ───
  'add':                        Plus,
  'add-circle-outline':         CirclePlus,
  'albums-outline':             Grid3x3,
  'alert-circle':               CircleAlert,
  'alert-circle-outline':       CircleAlert,
  'analytics':                  BarChart3,
  'archive-outline':            Archive,
  'arrow-back':                 ArrowLeft,
  'arrow-forward':              ArrowRight,
  'arrow-undo-outline':         Undo2,
  'arrow-up':                   ArrowUp,
  'attach':                     Paperclip,

  // ─── B ───
  'bag':                        ShoppingBag,
  'ban':                        Ban,
  'ban-outline':                Ban,
  'basket-outline':             ShoppingBasket,
  'bicycle-outline':            Bike,
  'body-outline':               PersonStanding,
  'bookmark':                   Bookmark,
  'bookmark-outline':           Bookmark,
  'briefcase-outline':          Briefcase,
  'bus-outline':                Bus,

  // ─── C ───
  'cafe-outline':               Coffee,
  'calendar':                   Calendar,
  'calendar-outline':           Calendar,
  'call':                       Phone,
  'call-outline':               Phone,
  'camera':                     Camera,
  'car':                        Car,
  'car-outline':                Car,
  'card':                       CreditCard,
  'card-outline':               CreditCard,
  'cart-outline':               ShoppingCart,
  'cash-outline':               Banknote,
  'chatbubble':                 MessageCircle,
  'chatbubble-ellipses':        MessageCircleMore,
  'chatbubble-outline':         MessageCircle,
  'chatbubbles':                MessagesSquare,
  'chatbubbles-outline':        MessagesSquare,
  'checkmark':                  Check,
  'checkmark-circle':           CircleCheck,
  'checkmark-circle-outline':   CircleCheck,
  'checkmark-done':             CheckCheck,
  'checkmark-done-outline':     CheckCheck,
  'chevron-back':               ChevronLeft,
  'chevron-down':               ChevronDown,
  'chevron-forward':            ChevronRight,
  'chevron-right':              ChevronRight,
  'chevron-up':                 ChevronUp,
  'clock':                      Clock,
  'close':                      X,
  'close-circle':               CircleX,
  'close-outline':              X,
  'cloud-offline-outline':      CloudOff,
  'cloud-upload-outline':       CloudUpload,
  'cloudy':                     Cloud,
  'color-palette-outline':      Palette,
  'compass':                    Compass,
  'compass-outline':            Compass,
  'copy':                       Copy,
  'copy-outline':               Copy,
  'create-outline':             SquarePen,
  'credit-card':                CreditCard,
  'crown-outline':              Crown,

  // ─── D ───
  'diamond':                    Diamond,
  'diamond-outline':            Diamond,
  'document-text':              FileText,
  'download':                   Download,

  // ─── E ───
  'earth-outline':              Globe,
  'edit-2':                     PenLine,
  'edit-3':                     Pen,
  'ellipsis-horizontal':        MoreHorizontal,
  'ellipsis-vertical':          MoreVertical,
  'enter-outline':              LogIn,
  'exit-outline':               LogOut,
  'eye':                        Eye,

  // ─── F ───
  'fast-food-outline':          Hamburger,
  'file-text':                  FileText,
  'film-outline':               Clapperboard,
  'filter':                     Filter,
  'flag':                       Flag,
  'flag-outline':               Flag,
  'flame':                      Flame,
  'flash':                      Zap,

  // ─── G ───
  'game-controller-outline':    Gamepad2,
  'gift-outline':               Gift,
  'globe':                      Globe,
  'globe-outline':              Globe,
  'grid':                       Grid3x3,
  'grid-outline':               Grid3x3,

  // ─── H ───
  'heart':                      Heart,
  'heart-outline':              Heart,
  'hourglass':                  Hourglass,
  'hourglass-outline':          Hourglass,

  // ─── I ───
  'image':                      Image,
  'image-outline':              Image,
  'images':                     Images,
  'images-outline':             Images,
  'inbox':                      Inbox,
  'info':                       Info,
  'information-circle':         Info,
  'information-circle-outline': Info,

  // ─── K ───
  'key':                        Key,

  // ─── L ───
  'layers-outline':             Layers,
  'leaf-outline':               Leaf,
  'link':                       Link,
  'link-outline':               Link,
  'location':                   MapPin,
  'location-outline':           MapPin,
  'location-sharp':             MapPin,
  'lock-closed':                Lock,
  'lock-open-outline':          LockOpen,
  'log-out':                    LogOut,
  // Brand logos (logo-apple, logo-instagram, logo-twitter, logo-whatsapp)
  // are handled by BrandIcons.tsx — import those directly, not via this wrapper.

  // ─── M ───
  'mail':                       Mail,
  'mail-outline':               Mail,
  'map':                        Map,
  'map-outline':                Map,
  'menu':                       Menu,
  'message-square':             MessageSquare,
  'mic-outline':                Mic,
  'moon':                       Moon,
  'moon-outline':               Moon,
  'music':                      Music,
  'musical-notes':              Music,
  'musical-notes-outline':      Music,

  // ─── N ───
  'navigate':                   Navigation,
  'navigate-outline':           Navigation,
  'notifications':              Bell,
  'notifications-off':          BellOff,
  'notifications-outline':      Bell,

  // ─── O ───
  'open-outline':               ExternalLink,
  'options-outline':            SlidersHorizontal,

  // ─── P ───
  'paper-plane':                Send,
  'pencil':                     Pencil,
  'people':                     Users,
  'people-outline':             Users,
  'people-circle-outline':      UsersRound,
  'person':                     User,
  'person-add':                 UserPlus,
  'person-add-outline':         UserPlus,
  'person-circle':              CircleUser,
  'person-outline':             User,
  'person-remove':              UserMinus,
  'person-remove-outline':      UserMinus,
  'play-circle':                CirclePlay,
  'pricetag':                   Tag,
  'pricetag-outline':           Tag,

  // ─── Q ───
  'qr-code':                    QrCode,
  'qr-code-outline':            QrCode,

  // ─── R ───
  'refresh':                    RefreshCw,
  'refresh-outline':            RefreshCw,
  'remove':                     Minus,
  'remove-circle':              CircleMinus,
  'restaurant-outline':         UtensilsCrossed,

  // ─── S ───
  'search':                     Search,
  'search-outline':             Search,
  'send':                       Send,
  'send-outline':               Send,
  'settings':                   Settings,
  'settings-outline':           Settings,
  'share':                      Share,
  'share-2':                    Share2,
  'share-outline':              Share,
  'share-social-outline':       Share2,
  'shield':                     Shield,
  'shield-checkmark':           ShieldCheck,
  'shield-checkmark-outline':   ShieldCheck,
  'shuffle-outline':            Shuffle,
  'sliders':                    SlidersHorizontal,
  'sparkles':                   Sparkles,
  'sparkles-outline':           Sparkles,
  'star':                       Star,
  'stats-chart':                BarChart3,
  'stop':                       Minus,
  'storefront':                 Store,
  'sunny-outline':              Sun,

  // ─── T ───
  'tag':                        Tag,
  'text':                       Type,
  'thumbs-down':                ThumbsDown,
  'thumbs-up':                  ThumbsUp,
  'ticket-outline':             Ticket,
  'time':                       Clock,
  'time-outline':               Clock,
  'trash':                      Trash2,
  'trash-outline':              Trash2,
  'trophy':                     Trophy,
  'trophy-outline':             Trophy,

  // ─── U ───
  'user-minus':                 UserMinus,
  'user-plus':                  UserPlus,
  'user-x':                     UserX,
  'users':                      Users,

  // ─── V ───
  'videocam':                   Video,
  'volume-mute':                VolumeX,

  // ─── W ───
  'walk-outline':               Footprints,
  'warning':                    AlertTriangle,
  'wifi-outline':               Wifi,
  'wine-outline':               Wine,

  // ─── X ───
  'x':                          X,
};

// ── Dev-time integrity check ────────────────────────────────────────

if (__DEV__) {
  Object.entries(ICON_MAP).forEach(([name, component]) => {
    if (!component) {
      console.error(`[Icon] Broken mapping: "${name}" maps to undefined`);
    }
  });
}

// ── Public API ──────────────────────────────────────────────────────

export type IconName = keyof typeof ICON_MAP;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Renders a Lucide icon by its legacy Ionicons / Feather name.
 * Falls back to null if the name is unknown — no crash, just invisible.
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color = '#000000',
  strokeWidth,
  style,
}) => {
  const IconComponent = ICON_MAP[name];
  if (!IconComponent) {
    if (__DEV__) {
      console.warn(`[Icon] Unknown icon name: "${name}"`);
    }
    return null;
  }
  return (
    <IconComponent
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      style={style}
    />
  );
};

export default Icon;
