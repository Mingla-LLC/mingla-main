import React, { useRef, useState } from 'react';
import {
  View,
  Image,
  ScrollView,
  StyleSheet,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  TouchableOpacity,
  Text,
} from 'react-native';
import { Icon } from '../ui/Icon';
// ORCH-1069: reuse the shared video-capable cover renderer (image + GIF + video,
// muted autoplay, reduce-motion aware) for `.mp4` gallery entries. Same renderer
// the event/trip grid + hero use (COMMS-0007); do NOT add a parallel player or a
// direct expo-video call site here.
import { EventCoverMedia } from '@mingla/event-rendering';
// ORCH-1069: single owner of video-URL detection, mirrors discover-cards isVideoUrl
// (I-1069-VIDEO-DETECTION-MATCHES-EDGE).
import { isVideoUrl } from '../../utils/videoUrl';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ImageGalleryProps {
  images: string[];
  initialImage?: string;
}

export default function ImageGallery({
  images,
  initialImage,
}: ImageGalleryProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(SCREEN_WIDTH);

  // Find initial index if initialImage is provided
  React.useEffect(() => {
    if (initialImage) {
      const index = images.findIndex((img) => img === initialImage);
      if (index !== -1 && scrollViewRef.current && containerWidth > 0) {
        setCurrentIndex(index);
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            x: index * containerWidth,
            animated: false,
          });
        }, 200);
      }
    }
  }, [initialImage, images, containerWidth]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const imageWidth = event.nativeEvent.layoutMeasurement.width || SCREEN_WIDTH;
    const index = Math.round(contentOffsetX / imageWidth);
    setCurrentIndex(index);
  };

  const handleContainerLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== containerWidth) {
      setContainerWidth(width);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0 && scrollViewRef.current) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      scrollViewRef.current.scrollTo({
        x: newIndex * containerWidth,
        animated: true,
      });
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1 && scrollViewRef.current) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      scrollViewRef.current.scrollTo({
        x: newIndex * containerWidth,
        animated: true,
      });
    }
  };

  if (!images || images.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <Icon name="image-outline" size={48} color="#9ca3af" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={handleContainerLayout}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {images.map((mediaUri, index) => (
          <View
            key={index}
            style={[styles.imageContainer, { width: containerWidth }]}
          >
            {isVideoUrl(mediaUri) ? (
              // ORCH-1069: a `.mp4`/video entry plays via the shared renderer.
              // Only the visible page plays (playbackActive/autoplay gated on
              // currentIndex) so paging away pauses the video — no N simultaneous
              // decodes in a multi-media venue (I-1069-ONE-PLAYING-DECK-VIDEO,
              // gallery arm). The gallery is a deliberate-attention surface, so it
              // exposes the unmute control (OQ-1: show it here, keep the deck muted).
              <EventCoverMedia
                mediaUrl={mediaUri}
                mediaType="video"
                radius={0}
                label="Cover video"
                videoContentFit="cover"
                autoplay={index === currentIndex}
                playbackActive={index === currentIndex}
                muted
                loop
                showAudioControl
                audioControlPosition="bottomRight"
                style={styles.image}
              />
            ) : (
              <Image
                source={{ uri: mediaUri }}
                style={styles.image}
                resizeMode="cover"
              />
            )}
          </View>
        ))}
      </ScrollView>

      {/* Navigation Arrows */}
      {images.length > 1 && (
        <>
          {currentIndex > 0 && (
            <TouchableOpacity
              style={[styles.navButton, styles.navButtonLeft]}
              onPress={goToPrevious}
              activeOpacity={0.7}
            >
              <Icon name="chevron-back" size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
          {currentIndex < images.length - 1 && (
            <TouchableOpacity
              style={[styles.navButton, styles.navButtonRight]}
              onPress={goToNext}
              activeOpacity={0.7}
            >
              <Icon name="chevron-forward" size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Dot Indicators */}
      {images.length > 1 && (
        <View style={styles.dotsContainer}>
          {images.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === currentIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 300,
    backgroundColor: '#000000',
    position: 'relative',
  },
  scrollView: {
    flex: 1,
  },
  imageContainer: {
    height: 300,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6b7280',
  },
  dotActive: {
    width: 24,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  counter: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  counterText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  navButtonLeft: {
    left: 16,
  },
  navButtonRight: {
    right: 16,
  },
});

