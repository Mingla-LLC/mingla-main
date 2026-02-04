import React from 'react';

interface CardEditorModalProps {
  isOpen?: boolean;
  card?: any;
  onClose: () => void;
  onSave?: (cardData: any) => void;
}

// Simplified placeholder - Card editing is not supported in Explorer/Business-only mode
export default function CardEditorModal({ 
  onClose 
}: CardEditorModalProps) {
  React.useEffect(() => {
    console.warn('CardEditorModal: This feature is not available in the current version');
    onClose();
  }, [onClose]);

  return null;
}
