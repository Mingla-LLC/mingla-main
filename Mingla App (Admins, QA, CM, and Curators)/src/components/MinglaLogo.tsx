import React from 'react';
import minglaLogo from 'figma:asset/7044ccb4b5d46530baeb74a29a6d95c6c8518d34.png';

interface MinglaLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function MinglaLogo({ className = '', size = 'md' }: MinglaLogoProps) {
  const sizeClasses = {
    sm: 'h-8',
    md: 'h-16',
    lg: 'h-20 md:h-24',
    xl: 'h-24 md:h-32'
  };

  return (
    <img 
      src={minglaLogo} 
      alt="Mingla" 
      className={`${sizeClasses[size]} object-contain scale-50 ${className}`}
    />
  );
}