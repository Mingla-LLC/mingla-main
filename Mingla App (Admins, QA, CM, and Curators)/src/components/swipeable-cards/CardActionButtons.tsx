import React from 'react';
import { X, Heart } from 'lucide-react';

interface CardActionButtonsProps {
  onDiscard: () => void;
  onLike: () => void;
  disabled?: boolean;
}

export default function CardActionButtons({ onDiscard, onLike, disabled = false }: CardActionButtonsProps) {
  return null;
}
