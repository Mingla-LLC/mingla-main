import * as React from "react";
import { Text, View, TextInput, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface InputOTPProps {
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  style?: any;
  containerStyle?: any;
}

function InputOTP({
  value = "",
  onChange,
  maxLength = 6,
  disabled = false,
  style,
  containerStyle,
  ...props
}: InputOTPProps) {
  const [otpValue, setOtpValue] = React.useState(value);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRefs = React.useRef<(TextInput | null)[]>([]);
  const [dimensions, setDimensions] = React.useState(Dimensions.get('window'));
  
  // Listen for dimension changes (screen rotation, etc.)
  React.useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setDimensions(window);
    });
    return () => subscription?.remove();
  }, []);
  
  // Calculate responsive dimensions - memoize to avoid recalculation on every render
  const { slotWidth, slotHeight, fontSize, gapSize } = React.useMemo(() => {
    const horizontalPadding = 48; // 24px padding on each side from parent
    const gap = 8;
    const availableWidth = dimensions.width - horizontalPadding;
    const totalGapWidth = gap * (maxLength - 1);
    const width = Math.max(40, Math.floor((availableWidth - totalGapWidth) / maxLength)); // Min 40px
    const height = Math.min(Math.max(50, width * 1.1), 64); // Min 50px, max 64px
    const font = Math.min(Math.max(20, Math.floor(width * 0.5)), 28); // Min 20px, max 28px
    return { slotWidth: width, slotHeight: height, fontSize: font, gapSize: gap };
  }, [dimensions.width, maxLength]);

  React.useEffect(() => {
    setOtpValue(value);
    // Auto-focus first empty input or first input if all empty
    if (!value || value.length === 0) {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    } else if (value.length < maxLength) {
      setTimeout(() => {
        inputRefs.current[value.length]?.focus();
      }, 100);
    }
  }, [value, maxLength]);

  // Auto-focus first input on mount
  React.useEffect(() => {
    setTimeout(() => {
      if (!otpValue || otpValue.length === 0) {
        inputRefs.current[0]?.focus();
      }
    }, 200);
  }, []);

  const handleTextChange = (text: string, index: number) => {
    // Handle paste or multiple digits
    if (text.length > 1) {
      // Extract only digits
      const digits = text.replace(/\D/g, "").slice(0, maxLength - index);
      
      // Ensure we have enough slots
      const newValue = otpValue.split('');
      while (newValue.length < maxLength) {
        newValue.push('');
      }
      
      // Fill in the digits starting from current index
      for (let i = 0; i < digits.length && index + i < maxLength; i++) {
        newValue[index + i] = digits[i];
      }
      
      const updatedValue = newValue.slice(0, maxLength).join('');
      setOtpValue(updatedValue);
      onChange?.(updatedValue);
      
      // Focus on the next empty input or the last input
      const nextIndex = Math.min(index + digits.length, maxLength - 1);
      setTimeout(() => {
        inputRefs.current[nextIndex]?.focus();
      }, 0);
      return;
    }

    // Only allow digits
    if (text && !/^\d$/.test(text)) {
      return;
    }

    // Ensure we have enough slots
    const newValue = otpValue.split('');
    while (newValue.length < maxLength) {
      newValue.push('');
    }
    newValue[index] = text;
    const updatedValue = newValue.slice(0, maxLength).join('');
    
    setOtpValue(updatedValue);
    onChange?.(updatedValue);

    // Auto-focus next input with setTimeout to ensure it works
    if (text && index < maxLength - 1) {
      setTimeout(() => {
        inputRefs.current[index + 1]?.focus();
      }, 0);
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace') {
      if (!otpValue[index] && index > 0) {
        // If current field is empty, move to previous and clear it
        setTimeout(() => {
          inputRefs.current[index - 1]?.focus();
          // Clear the previous field
          const newValue = otpValue.split('');
          if (newValue.length > index - 1) {
            newValue[index - 1] = '';
            const updatedValue = newValue.slice(0, maxLength).join('');
            setOtpValue(updatedValue);
            onChange?.(updatedValue);
          }
        }, 0);
      }
    }
  };

  const handleFocus = (index: number) => {
    setActiveIndex(index);
  };

  const responsiveStyles = React.useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: gapSize,
      justifyContent: 'center',
      width: '100%',
      paddingHorizontal: 0,
    },
    slot: {
      width: slotWidth,
      height: slotHeight,
      borderWidth: 2,
      borderColor: '#e5e7eb',
      borderRadius: 12,
      backgroundColor: '#f9fafb',
      fontSize: fontSize,
      fontWeight: '700',
      color: '#111827',
      textAlign: 'center',
      padding: 0,
      paddingVertical: 0,
    },
  }), [slotWidth, slotHeight, fontSize, gapSize]);

  return (
    <View style={[responsiveStyles.container, containerStyle]} {...props}>
      {Array.from({ length: maxLength }, (_, index) => (
        <InputOTPSlot
          key={index}
          ref={(ref) => {
            inputRefs.current[index] = ref;
          }}
          index={index}
          value={otpValue[index] || ''}
          onChangeText={(text) => handleTextChange(text, index)}
          onKeyPress={(key) => handleKeyPress(key, index)}
          onFocus={() => handleFocus(index)}
          isActive={activeIndex === index}
          disabled={disabled}
          style={[responsiveStyles.slot, style]}
          autoFocus={index === 0 && !otpValue}
        />
      ))}
    </View>
  );
}

interface InputOTPGroupProps {
  children: React.ReactNode;
  style?: any;
}

function InputOTPGroup({ children, style, ...props }: InputOTPGroupProps) {
  return (
    <View style={[styles.group, style]} {...props}>
      {children}
    </View>
  );
}

interface InputOTPSlotProps {
  index: number;
  value: string;
  onChangeText: (text: string) => void;
  onKeyPress: (key: string) => void;
  onFocus: () => void;
  isActive: boolean;
  disabled?: boolean;
  style?: any;
  autoFocus?: boolean;
}

const InputOTPSlot = React.forwardRef<TextInput, InputOTPSlotProps>(({
  index,
  value,
  onChangeText,
  onKeyPress,
  onFocus,
  isActive,
  disabled = false,
  style,
  autoFocus = false,
  ...props
}, ref) => {
  return (
    <TextInput
      ref={ref}
      style={[
        styles.slot,
        isActive && styles.activeSlot,
        disabled && styles.disabledSlot,
        style,
      ]}
      value={value}
      onChangeText={onChangeText}
      onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key)}
      onFocus={onFocus}
      maxLength={1}
      keyboardType="number-pad"
      textAlign="center"
      editable={!disabled}
      selectTextOnFocus
      autoFocus={autoFocus}
      {...props}
    />
  );
});

InputOTPSlot.displayName = "InputOTPSlot";

interface InputOTPSeparatorProps {
  style?: any;
}

function InputOTPSeparator({ style, ...props }: InputOTPSeparatorProps) {
  return (
    <View style={[styles.separator, style]} {...props}>
      <Ionicons name="remove" size={16} color="#6b7280" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  slot: {
    width: 56,
    height: 64,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    padding: 0,
    paddingVertical: 0,
  },
  activeSlot: {
    borderColor: '#eb7825',
    borderWidth: 2,
    backgroundColor: '#fff',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  disabledSlot: {
    opacity: 0.5,
    backgroundColor: '#f3f4f6',
  },
  separator: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
