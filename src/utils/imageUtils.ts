// Image processing utilities for avatar uploads

interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

/**
 * Resize and crop an image file to a square format
 */
export const processAvatarImage = async (
  file: File,
  options: ImageProcessingOptions = {}
): Promise<Blob> => {
  const {
    maxWidth = 512,
    maxHeight = 512,
    quality = 0.9,
    format = 'jpeg'
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        // Create canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Calculate dimensions for square crop
        const minDimension = Math.min(img.naturalWidth, img.naturalHeight);
        const size = Math.min(minDimension, maxWidth);
        
        canvas.width = size;
        canvas.height = size;

        // Calculate crop position (center crop)
        const cropX = (img.naturalWidth - minDimension) / 2;
        const cropY = (img.naturalHeight - minDimension) / 2;

        // Draw the cropped and resized image
        ctx.drawImage(
          img,
          cropX, cropY, minDimension, minDimension, // Source rectangle (square crop from center)
          0, 0, size, size // Destination rectangle (resized)
        );

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to process image'));
            }
          },
          `image/${format}`,
          quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Start loading the image
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Validate image file before processing
 */
export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  // Check file type
  if (!file.type.startsWith('image/')) {
    return {
      valid: false,
      error: 'Please select an image file (JPG, PNG, etc.)'
    };
  }

  // Check file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return {
      valid: false,
      error: 'Please select an image smaller than 10MB'
    };
  }

  // Check for supported formats
  const supportedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!supportedFormats.includes(file.type)) {
    return {
      valid: false,
      error: 'Unsupported image format. Please use JPG, PNG, WebP, or GIF'
    };
  }

  return { valid: true };
};