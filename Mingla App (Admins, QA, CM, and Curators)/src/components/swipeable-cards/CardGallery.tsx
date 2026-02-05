import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ImageWithFallback } from '../figma/ImageWithFallback';

interface CardGalleryProps {
  images: string[];
  currentIndex: number;
  title: string;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}

export default function CardGallery({ 
  images, 
  currentIndex, 
  title, 
  onPrevious, 
  onNext,
  className = 'h-64'
}: CardGalleryProps) {
  if (images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div className={`relative ${className}`}>
        <ImageWithFallback
          src={images[0]}
          alt={title}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <ImageWithFallback
        src={images[currentIndex]}
        alt={title}
        className="w-full h-full object-cover"
      />
      
      <button
        onClick={onPrevious}
        disabled={currentIndex === 0}
        className={`absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center transition-all ${
          currentIndex === 0 ? 'opacity-50' : 'hover:bg-white hover:scale-110'
        }`}
      >
        <ChevronLeft className="w-4 h-4 text-gray-700" />
      </button>
      
      <button
        onClick={onNext}
        disabled={currentIndex === images.length - 1}
        className={`absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center transition-all ${
          currentIndex === images.length - 1 ? 'opacity-50' : 'hover:bg-white hover:scale-110'
        }`}
      >
        <ChevronRight className="w-4 h-4 text-gray-700" />
      </button>
      
      {/* Pagination dots */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {images.map((_, index) => (
          <div
            key={index}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentIndex ? 'bg-white w-6' : 'bg-white/60'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
