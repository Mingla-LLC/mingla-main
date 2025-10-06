import * as React from "react";
import { Text, View, TextInput, StyleSheet, TouchableOpacity } from "react-native";
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

  React.useEffect(() => {
    setOtpValue(value);
  }, [value]);

  const handleTextChange = (text: string, index: number) => {
    const newValue = otpValue.split('');
    newValue[index] = text;
    const updatedValue = newValue.join('');
    
    setOtpValue(updatedValue);
    onChange?.(updatedValue);

    // Auto-focus next input
    if (text && index < maxLength - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otpValue[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleFocus = (index: number) => {
    setActiveIndex(index);
  };

  return (
    <View style={[styles.container, containerStyle]} {...props}>
      {Array.from({ length: maxLength }, (_, index) => (
        <InputOTPSlot
          key={index}
          index={index}
          value={otpValue[index] || ''}
          onChangeText={(text) => handleTextChange(text, index)}
          onKeyPress={(key) => handleKeyPress(key, index)}
          onFocus={() => handleFocus(index)}
          isActive={activeIndex === index}
          disabled={disabled}
          style={style}
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
}

function InputOTPSlot({
  index,
  value,
  onChangeText,
  onKeyPress,
  onFocus,
  isActive,
  disabled = false,
  style,
  ...props
}: InputOTPSlotProps) {
  return (
    <TextInput
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
      keyboardType="numeric"
      textAlign="center"
      editable={!disabled}
      selectTextOnFocus
      {...props}
    />
  );
}

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
    gap: 8,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  slot: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    justifyContent: 'center',
    alignItems: 'center',
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
