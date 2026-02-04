import { AvailabilityData } from '../AvailabilityBuilder';

export interface CardCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (cardData: any) => void;
  existingCard?: any;
  preSelectedBusinessId?: string;
  preSelectedBusinessName?: string;
  businesses?: any[];
}

export interface ImageGalleryItem {
  id: string;
  url: string;
  file?: File;
  isHero: boolean;
}

export interface RouteStep {
  id: string;
  order: number;
  name: string;
  address: string;
  description: string;
  dwellTime: number;
  notes: string;
  isPassThrough: boolean;
}

export interface PurchaseOption {
  id: string;
  title: string;
  description: string;
  price: string;
  includes: string[];
  duration: string;
  popular: boolean;
  savings: string;
  capacity?: number;
  availability: AvailabilityData;
}

export interface FormStepProps {
  // Common props passed to all step components
  isMultiStopExperience: boolean;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

export interface PriceRangeCategory {
  id: string;
  label: string;
  min: number;
  max: number | null; // null means no upper limit
  description: string;
}
