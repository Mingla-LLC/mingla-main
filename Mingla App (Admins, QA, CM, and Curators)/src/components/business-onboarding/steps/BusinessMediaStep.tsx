import React, { useRef } from 'react';
import { Image, Upload, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import { BusinessOnboardingStepProps } from '../types';

export default function BusinessMediaStep({ data, onUpdate }: BusinessOnboardingStepProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const newPhotos = [...data.photos, reader.result as string];
        // Limit to 15 photos
        if (newPhotos.length <= 15) {
          onUpdate({ photos: newPhotos });
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      onUpdate({ logo: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      onUpdate({ coverImage: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index: number) => {
    const newPhotos = data.photos.filter((_, i) => i !== index);
    onUpdate({ photos: newPhotos });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
          <Image className="w-7 h-7 text-[#eb7825]" />
        </div>
        <h2 className="text-2xl text-black">
          Showcase Your Business
        </h2>
        <p className="text-gray-600">
          Add photos to help customers discover you
        </p>
      </div>

      {/* Logo Upload */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-3">
        <Label>Business Logo (Optional)</Label>
        {data.logo ? (
          <div className="relative w-32 h-32">
            <img
              src={data.logo}
              alt="Logo"
              className="w-full h-full object-cover rounded-lg border-2 border-gray-200"
            />
            <button
              onClick={() => onUpdate({ logo: '' })}
              className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => logoInputRef.current?.click()}
            className="w-full h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-[#eb7825] hover:bg-[#eb7825]/5 transition-colors"
          >
            <Upload className="w-6 h-6 text-gray-400" />
            <span className="text-sm text-gray-600">Click to upload logo</span>
          </button>
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          onChange={handleLogoUpload}
          className="hidden"
        />
      </div>

      {/* Cover Image Upload */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-3">
        <Label>Cover Image (Optional)</Label>
        {data.coverImage ? (
          <div className="relative w-full h-48">
            <img
              src={data.coverImage}
              alt="Cover"
              className="w-full h-full object-cover rounded-lg border-2 border-gray-200"
            />
            <button
              onClick={() => onUpdate({ coverImage: '' })}
              className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => coverInputRef.current?.click()}
            className="w-full h-48 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-[#eb7825] hover:bg-[#eb7825]/5 transition-colors"
          >
            <Upload className="w-6 h-6 text-gray-400" />
            <span className="text-sm text-gray-600">Click to upload cover image</span>
            <span className="text-xs text-gray-500">Recommended: 1200x400px</span>
          </button>
        )}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          onChange={handleCoverUpload}
          className="hidden"
        />
      </div>

      {/* Photo Gallery Upload */}
      <div className="bg-white rounded-xl p-6 border border-gray-200 space-y-3">
        <div className="flex items-center justify-between">
          <Label>Business Photos * (At least 1 required)</Label>
          <span className="text-sm text-gray-500">
            {data.photos.length}/15
          </span>
        </div>

        {/* Photo Grid */}
        {data.photos.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {data.photos.map((photo, index) => (
              <div key={index} className="relative aspect-square">
                <img
                  src={photo}
                  alt={`Photo ${index + 1}`}
                  className="w-full h-full object-cover rounded-lg border-2 border-gray-200"
                />
                <button
                  onClick={() => removePhoto(index)}
                  className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload Button */}
        {data.photos.length < 15 && (
          <button
            onClick={() => photoInputRef.current?.click()}
            className="w-full h-32 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center gap-2 hover:border-[#eb7825] hover:bg-[#eb7825]/5 transition-colors"
          >
            <Upload className="w-6 h-6 text-gray-400" />
            <span className="text-sm text-gray-600">
              {data.photos.length === 0 ? 'Add your first photo' : 'Add more photos'}
            </span>
            <span className="text-xs text-gray-500">
              JPG, PNG or WebP (max 5MB each)
            </span>
          </button>
        )}

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handlePhotoUpload}
          className="hidden"
        />
      </div>

      {/* Tips */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          📸 <strong>Photo Tips:</strong> Use high-quality images that showcase your space, products, or services. Include photos of your team, ambiance, and signature offerings.
        </p>
      </div>
    </div>
  );
}
