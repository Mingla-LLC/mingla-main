import React, { useState, useRef } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { processAvatarImage, validateImageFile } from '@/utils/imageUtils';

interface AvatarUploadProps {
  currentAvatarUrl?: string;
  userId: string;
  userInitials: string;
  onAvatarUpdate: (newAvatarUrl: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const AvatarUpload: React.FC<AvatarUploadProps> = ({
  currentAvatarUrl,
  userId,
  userInitials,
  onAvatarUpdate,
  size = 'md'
}) => {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'h-12 w-12',
    md: 'h-20 w-20',
    lg: 'h-32 w-32'
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast({
        title: "Invalid file",
        description: validation.error,
        variant: "destructive"
      });
      return;
    }

    setUploading(true);

    try {
      // Process the image (resize and crop to square)
      toast({
        title: "Processing image...",
        description: "Resizing and optimizing your profile picture"
      });

      const processedBlob = await processAvatarImage(file, {
        maxWidth: 512,
        maxHeight: 512,
        quality: 0.9,
        format: 'jpeg'
      });

      // Generate unique filename
      const fileExt = 'jpg'; // Always use jpg for processed images
      const fileName = `${userId}/avatar.${fileExt}`;

      // Upload processed file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, processedBlob, {
          cacheControl: '3600',
          upsert: true // Replace existing file
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with new avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) throw updateError;

      onAvatarUpdate(publicUrl);
      
      toast({
        title: "Avatar updated",
        description: "Your profile picture has been updated successfully"
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload your avatar. Please try again.",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative inline-block">
      <Avatar className={sizeClasses[size]}>
        {currentAvatarUrl && (
          <AvatarImage src={currentAvatarUrl} alt="Profile picture" />
        )}
        <AvatarFallback>{userInitials}</AvatarFallback>
      </Avatar>
      
      <Button
        size="sm"
        variant="outline"
        className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
    </div>
  );
};