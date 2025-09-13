import React, { useState, useRef, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Camera, Loader2, X, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { processAvatarImage, validateImageFile } from '@/utils/imageUtils';

interface AvatarPreviewProps {
  currentAvatarUrl?: string;
  userId: string;
  userInitials: string;
  onAvatarUpdate: (newAvatarUrl: string) => void;
  size?: 'sm' | 'md' | 'lg';
}

export const AvatarPreview: React.FC<AvatarPreviewProps> = ({
  currentAvatarUrl,
  userId,
  userInitials,
  onAvatarUpdate,
  size = 'md'
}) => {
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewImage(e.target?.result as string);
      setShowPreview(true);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);

    try {
      toast({
        title: "Processing image...",
        description: "Resizing and optimizing your profile picture"
      });

      const processedBlob = await processAvatarImage(selectedFile, {
        maxWidth: 512,
        maxHeight: 512,
        quality: 0.9,
        format: 'jpeg'
      });

      // Generate unique filename with timestamp to avoid caching issues
      const timestamp = Date.now();
      const fileName = `${userId}/avatar_${timestamp}.jpg`;

      // Upload processed file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, processedBlob, {
          cacheControl: '3600',
          upsert: false
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
      setShowPreview(false);
      setPreviewImage(null);
      setSelectedFile(null);
      
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

  const handleCancel = () => {
    setShowPreview(false);
    setPreviewImage(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
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

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Preview Profile Picture</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {previewImage && (
              <div className="flex justify-center">
                <div className="relative">
                  <img
                    src={previewImage}
                    alt="Avatar preview"
                    className="w-48 h-48 object-cover rounded-full border-4 border-muted"
                  />
                </div>
              </div>
            )}
            
            <p className="text-sm text-muted-foreground text-center">
              Your image will be automatically resized and cropped to fit perfectly as a profile picture.
            </p>
            
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={uploading}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Use This Photo
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};