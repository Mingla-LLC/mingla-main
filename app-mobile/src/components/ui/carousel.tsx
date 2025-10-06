import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet, ScrollView, Dimensions } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface CarouselProps {
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical";
  style?: any;
  showDots?: boolean;
  showArrows?: boolean;
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

interface CarouselContextProps {
  currentIndex: number;
  totalSlides: number;
  orientation: "horizontal" | "vertical";
  scrollToSlide: (index: number) => void;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
}

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);

  if (!context) {
    throw new Error("useCarousel must be used within a <Carousel />");
  }

  return context;
}

function Carousel({
  orientation = "horizontal",
  children,
  style,
  showDots = true,
  showArrows = true,
  autoPlay = false,
  autoPlayInterval = 3000,
  ...props
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [totalSlides, setTotalSlides] = React.useState(0);
  const scrollViewRef = React.useRef<ScrollView>(null);
  const screenWidth = Dimensions.get('window').width;

  const scrollToSlide = React.useCallback((index: number) => {
    if (scrollViewRef.current) {
      const offset = orientation === "horizontal" 
        ? index * screenWidth 
        : index * 200; // Adjust height as needed
      scrollViewRef.current.scrollTo({
        x: orientation === "horizontal" ? offset : 0,
        y: orientation === "vertical" ? offset : 0,
        animated: true,
      });
    }
    setCurrentIndex(index);
  }, [orientation, screenWidth]);

  const scrollPrev = React.useCallback(() => {
    if (currentIndex > 0) {
      scrollToSlide(currentIndex - 1);
    }
  }, [currentIndex, scrollToSlide]);

  const scrollNext = React.useCallback(() => {
    if (currentIndex < totalSlides - 1) {
      scrollToSlide(currentIndex + 1);
    }
  }, [currentIndex, totalSlides, scrollToSlide]);

  const canScrollPrev = currentIndex > 0;
  const canScrollNext = currentIndex < totalSlides - 1;

  // Auto-play functionality
  React.useEffect(() => {
    if (autoPlay && totalSlides > 1) {
      const interval = setInterval(() => {
        if (currentIndex < totalSlides - 1) {
          scrollNext();
        } else {
          scrollToSlide(0);
        }
      }, autoPlayInterval);

      return () => clearInterval(interval);
    }
  }, [autoPlay, autoPlayInterval, currentIndex, totalSlides, scrollNext, scrollToSlide]);

  // Count total slides
  React.useEffect(() => {
    const slides = React.Children.count(children);
    setTotalSlides(slides);
  }, [children]);

  return (
    <CarouselContext.Provider
      value={{
        currentIndex,
        totalSlides,
        orientation,
        scrollToSlide,
        scrollPrev,
        scrollNext,
        canScrollPrev,
        canScrollNext,
      }}
    >
      <View style={[styles.carousel, style]} {...props}>
        {children}
        
        {showArrows && (
          <>
            <CarouselPrevious />
            <CarouselNext />
          </>
        )}
        
        {showDots && totalSlides > 1 && (
          <View style={styles.dotsContainer}>
            {Array.from({ length: totalSlides }).map((_, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dot,
                  index === currentIndex && styles.activeDot,
                ]}
                onPress={() => scrollToSlide(index)}
              />
            ))}
          </View>
        )}
      </View>
    </CarouselContext.Provider>
  );
}

interface CarouselContentProps {
  children: React.ReactNode;
  style?: any;
}

function CarouselContent({ children, style, ...props }: CarouselContentProps) {
  const { orientation } = useCarousel();
  const scrollViewRef = React.useRef<ScrollView>(null);
  const screenWidth = Dimensions.get('window').width;

  const handleScroll = (event: any) => {
    const contentOffset = event.nativeEvent.contentOffset;
    const index = orientation === "horizontal" 
      ? Math.round(contentOffset.x / screenWidth)
      : Math.round(contentOffset.y / 200);
    
    // Update current index in context
    // This would need to be passed up to parent component
  };

  return (
    <ScrollView
      ref={scrollViewRef}
      style={[styles.carouselContent, style]}
      horizontal={orientation === "horizontal"}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      pagingEnabled={true}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

interface CarouselItemProps {
  children: React.ReactNode;
  style?: any;
}

function CarouselItem({ children, style, ...props }: CarouselItemProps) {
  const { orientation } = useCarousel();
  const screenWidth = Dimensions.get('window').width;

  return (
    <View
      style={[
        styles.carouselItem,
        orientation === "horizontal" 
          ? { width: screenWidth } 
          : { height: 200 },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

interface CarouselPreviousProps {
  style?: any;
  onPress?: () => void;
}

function CarouselPrevious({ style, onPress, ...props }: CarouselPreviousProps) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <TouchableOpacity
      style={[
        styles.navButton,
        styles.previousButton,
        orientation === "horizontal" 
          ? styles.horizontalPrevious 
          : styles.verticalPrevious,
        !canScrollPrev && styles.disabledButton,
        style,
      ]}
      onPress={onPress || scrollPrev}
      disabled={!canScrollPrev}
      {...props}
    >
      <Ionicons 
        name="chevron-back" 
        size={16} 
        color={canScrollPrev ? "#6b7280" : "#d1d5db"} 
      />
    </TouchableOpacity>
  );
}

interface CarouselNextProps {
  style?: any;
  onPress?: () => void;
}

function CarouselNext({ style, onPress, ...props }: CarouselNextProps) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <TouchableOpacity
      style={[
        styles.navButton,
        styles.nextButton,
        orientation === "horizontal" 
          ? styles.horizontalNext 
          : styles.verticalNext,
        !canScrollNext && styles.disabledButton,
        style,
      ]}
      onPress={onPress || scrollNext}
      disabled={!canScrollNext}
      {...props}
    >
      <Ionicons 
        name="chevron-forward" 
        size={16} 
        color={canScrollNext ? "#6b7280" : "#d1d5db"} 
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  carousel: {
    position: 'relative',
    backgroundColor: 'white',
  },
  carouselContent: {
    flex: 1,
  },
  carouselItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButton: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  previousButton: {
    zIndex: 1,
  },
  nextButton: {
    zIndex: 1,
  },
  horizontalPrevious: {
    left: 16,
    top: '50%',
    marginTop: -16,
  },
  horizontalNext: {
    right: 16,
    top: '50%',
    marginTop: -16,
  },
  verticalPrevious: {
    top: 16,
    left: '50%',
    marginLeft: -16,
    transform: [{ rotate: '90deg' }],
  },
  verticalNext: {
    bottom: 16,
    left: '50%',
    marginLeft: -16,
    transform: [{ rotate: '90deg' }],
  },
  disabledButton: {
    opacity: 0.5,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d1d5db',
  },
  activeDot: {
    backgroundColor: '#eb7825',
  },
});

export {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
};
