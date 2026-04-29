import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Image,
  Text,
  ScrollView,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Icon } from '../ui/Icon';

const GALLERY_HEIGHT = 140;

interface StopImageGalleryProps {
  /** All available image URLs for this stop */
  images: string[];
  /** Called when an image is tapped — opens lightbox */
  onImagePress?: (index: number) => void;
}

/**
 * Compact horizontal image gallery for curated stop cards.
 * Paginated swipe with dot indicators — no arrows (touch-first on mobile).
 * Handles: 0 images (placeholder), 1 image (static), 2+ images (scrollable).
 */
export function StopImageGallery({ images, onImagePress }: StopImageGalleryProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set([0]));

  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== containerWidth) {
      setContainerWidth(width);
    }
  }, [containerWidth]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (containerWidth <= 0) return;
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / containerWidth);
    if (index !== currentIndex && index >= 0 && index < images.length) {
      setCurrentIndex(index);
      // Mark current + next as "should load" to prevent scroll-back flash
      setLoadedImages(prev => {
        const needed = [index];
        if (index + 1 < images.length) needed.push(index + 1);
        if (needed.every(i => prev.has(i))) return prev;
        const next = new Set(prev);
        for (const i of needed) next.add(i);
        return next;
      });
    }
  }, [containerWidth, currentIndex, images.length]);

  // Empty state — no images at all
  if (!images || images.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <Icon name="image-outline" size={32} color="rgba(255,255,255,0.50)" />
        </View>
      </View>
    );
  }

  // Single image — no scroll machinery needed
  if (images.length === 1) {
    return (
      <View style={styles.container}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => onImagePress?.(0)}>
          <Image
            source={{ uri: images[0] }}
            style={styles.singleImage}
            resizeMode="cover"
          />
        </TouchableOpacity>
      </View>
    );
  }

  // Multiple images — paginated horizontal scroll
  return (
    <View style={styles.container} onLayout={handleLayout}>
      {containerWidth > 0 && (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            decelerationRate="fast"
            bounces={false}
            nestedScrollEnabled
            style={styles.scrollView}
          >
            {images.map((uri, index) => (
              <TouchableOpacity
                key={`${uri}-${index}`}
                style={[styles.imageSlide, { width: containerWidth }]}
                activeOpacity={0.9}
                onPress={() => onImagePress?.(index)}
              >
                {(index === 0 || loadedImages.has(index) || Math.abs(index - currentIndex) <= 1) ? (
                  <Image
                    source={{ uri }}
                    style={styles.slideImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.placeholder}>
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.50)" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Dot indicators — positioned inside the image area */}
          <View style={styles.dotsRow}>
            {images.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index === currentIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>

          {/* Photo counter pill — top right */}
          <View style={styles.counterPill}>
            <Icon name="images-outline" size={10} color="#ffffff" />
            <Text style={styles.counterText}>{currentIndex + 1}/{images.length}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: GALLERY_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
    position: 'relative',
  },
  scrollView: {
    flex: 1,
  },
  imageSlide: {
    height: GALLERY_HEIGHT,
  },
  slideImage: {
    width: '100%',
    height: '100%',
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  dotsRow: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    borderRadius: 3,
    height: 5,
  },
  dotActive: {
    width: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  dotInactive: {
    width: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  counterPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  counterText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.10)',
  },
});
