import * as React from "react";
import { TextInput, StyleSheet } from "react-native";

import { cn } from "./utils";

interface InputProps {
  className?: string;
  type?: string;
  value?: string;
  onChange?: (e: any) => void;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  required?: boolean;
  style?: any;
  [key: string]: any;
}

function Input({ className, type, value, onChange, onChangeText, placeholder, required, style, ...props }: InputProps) {
  const handleChange = (text: string) => {
    if (onChangeText) {
      onChangeText(text);
    }
    if (onChange) {
      // Create a synthetic event for compatibility
      onChange({ target: { value: text } });
    }
  };

  return (
    <TextInput
      value={value}
      onChangeText={handleChange}
      placeholder={placeholder}
      secureTextEntry={type === 'password'}
      keyboardType={type === 'email' ? 'email-address' : type === 'number' ? 'numeric' : 'default'}
      style={[
        styles.input,
        style
      ]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    height: 36,
    width: '100%',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: 'white',
  },
});

export { Input };
