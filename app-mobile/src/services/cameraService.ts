import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Alert, Platform } from 'react-native';
import { supabase } from './supabase';

export interface ImageResult {
  uri: string;
  width: number;
  height: number;
  type: 'image' | 'video';
  size?: number;
  fileName?: string;
}

export interface CameraOptions {
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  compress?: boolean;
}

class CameraService {
  private isInitialized = false;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      // Request camera permissions
      const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
      
      if (cameraStatus !== 'granted') {
        Alert.alert(
          'Camera Permission Required',
          'Mingla needs camera access to capture photos for your experiences.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => {
              console.log('Please enable camera permissions in device settings');
            }}
          ]
        );
        return false;
      }

      // Request media library permissions
      const { status: mediaStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (mediaStatus !== 'granted') {
        console.warn('Media library permission not granted');
      }

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Error initializing camera service:', error);
      return false;
    }
  }

  async takePhoto(options: CameraOptions = {}): Promise<ImageResult | null> {
    try {
      const initialized = await this.initialize();
      if (!initialized) return null;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: options.allowsEditing || true,
        aspect: options.aspect || [4, 3],
        quality: options.quality || 0.8,
      });

      if (result.canceled) {
        return null;
      }

      const asset = result.assets[0];
      if (!asset) return null;

      // Process the image if needed
      let processedAsset = asset;
      if (options.compress && (options.maxWidth || options.maxHeight)) {
        processedAsset = await this.compressImage(asset, options);
      }

      return {
        uri: processedAsset.uri,
        width: processedAsset.width,
        height: processedAsset.height,
        type: 'image',
        size: processedAsset.fileSize,
        fileName: processedAsset.fileName,
      };
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
      return null;
    }
  }

  async pickFromLibrary(options: CameraOptions = {}): Promise<ImageResult | null> {
    try {
      const initialized = await this.initialize();
      if (!initialized) return null;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: options.allowsEditing || true,
        aspect: options.aspect || [4, 3],
        quality: options.quality || 0.8,
      });

      if (result.canceled) {
        return null;
      }

      const asset = result.assets[0];
      if (!asset) return null;

      // Process the image if needed
      let processedAsset = asset;
      if (options.compress && (options.maxWidth || options.maxHeight)) {
        processedAsset = await this.compressImage(asset, options);
      }

      return {
        uri: processedAsset.uri,
        width: processedAsset.width,
        height: processedAsset.height,
        type: 'image',
        size: processedAsset.fileSize,
        fileName: processedAsset.fileName,
      };
    } catch (error) {
      console.error('Error picking from library:', error);
      Alert.alert('Error', 'Failed to select image');
      return null;
    }
  }

  async takeVideo(options: { maxDuration?: number } = {}): Promise<ImageResult | null> {
    try {
      const initialized = await this.initialize();
      if (!initialized) return null;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
        videoMaxDuration: options.maxDuration || 30,
      });

      if (result.canceled) {
        return null;
      }

      const asset = result.assets[0];
      if (!asset) return null;

      return {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        type: 'video',
        size: asset.fileSize,
        fileName: asset.fileName,
      };
    } catch (error) {
      console.error('Error taking video:', error);
      Alert.alert('Error', 'Failed to take video');
      return null;
    }
  }

  async compressImage(asset: any, options: CameraOptions): Promise<any> {
    try {
      const manipulatorOptions: any = {
        compress: options.quality || 0.8,
        format: ImageManipulator.SaveFormat.JPEG,
      };

      if (options.maxWidth || options.maxHeight) {
        manipulatorOptions.resize = {};
        if (options.maxWidth) manipulatorOptions.resize.width = options.maxWidth;
        if (options.maxHeight) manipulatorOptions.resize.height = options.maxHeight;
      }

      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [],
        manipulatorOptions
      );

      return {
        ...asset,
        uri: result.uri,
        width: result.width,
        height: result.height,
        fileSize: result.size,
      };
    } catch (error) {
      console.error('Error compressing image:', error);
      return asset; // Return original if compression fails
    }
  }

  async uploadImage(imageUri: string, fileName?: string): Promise<string | null> {
    try {
      // Create form data
      const formData = new FormData();
      formData.append('file', {
        uri: imageUri,
        type: 'image/jpeg',
        name: fileName || 'image.jpg',
      } as any);

      // Upload to Supabase Storage
      const fileExt = imageUri.split('.').pop() || 'jpg';
      const fileNameWithExt = `${Date.now()}.${fileExt}`;
      const filePath = `experience-images/${fileNameWithExt}`;

      const { data, error } = await supabase.storage
        .from('experience-images')
        .upload(filePath, formData, {
          contentType: 'image/jpeg',
        });

      if (error) {
        console.error('Error uploading image:', error);
        return null;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('experience-images')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      return null;
    }
  }

  async deleteImage(imageUrl: string): Promise<boolean> {
    try {
      // Extract file path from URL
      const urlParts = imageUrl.split('/');
      const fileName = urlParts[urlParts.length - 1];
      const filePath = `experience-images/${fileName}`;

      const { error } = await supabase.storage
        .from('experience-images')
        .remove([filePath]);

      if (error) {
        console.error('Error deleting image:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error deleting image:', error);
      return false;
    }
  }

  // Show image picker options
  showImagePickerOptions(
    onTakePhoto: (result: ImageResult) => void,
    onPickFromLibrary: (result: ImageResult) => void,
    onCancel?: () => void
  ): void {
    Alert.alert(
      'Select Image',
      'Choose how you want to add an image',
      [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        { text: 'Take Photo', onPress: () => this.takePhoto().then(onTakePhoto) },
        { text: 'Choose from Library', onPress: () => this.pickFromLibrary().then(onPickFromLibrary) },
      ]
    );
  }

  // Get image dimensions
  async getImageDimensions(uri: string): Promise<{ width: number; height: number } | null> {
    try {
      const result = await ImageManipulator.manipulateAsync(uri, [], { format: ImageManipulator.SaveFormat.JPEG });
      return {
        width: result.width,
        height: result.height,
      };
    } catch (error) {
      console.error('Error getting image dimensions:', error);
      return null;
    }
  }

  // Create thumbnail
  async createThumbnail(uri: string, size: number = 200): Promise<string | null> {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: size, height: size } }],
        { 
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );

      return result.uri;
    } catch (error) {
      console.error('Error creating thumbnail:', error);
      return null;
    }
  }
}

export const cameraService = new CameraService();
