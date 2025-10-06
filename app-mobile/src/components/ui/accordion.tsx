import * as React from "react";
import { Text, View, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { Ionicons } from '@expo/vector-icons';

interface AccordionProps {
  children: React.ReactNode;
  type?: "single" | "multiple";
  collapsible?: boolean;
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
}

function Accordion({
  children,
  type = "single",
  collapsible = true,
  value,
  onValueChange,
  ...props
}: AccordionProps) {
  const [openItems, setOpenItems] = React.useState<string[]>(
    Array.isArray(value) ? value : value ? [value] : []
  );

  const handleValueChange = (itemValue: string) => {
    if (type === "single") {
      const newValue = openItems.includes(itemValue) ? [] : [itemValue];
      setOpenItems(newValue);
      onValueChange?.(newValue[0] || "");
    } else {
      const newValue = openItems.includes(itemValue)
        ? openItems.filter(item => item !== itemValue)
        : [...openItems, itemValue];
      setOpenItems(newValue);
      onValueChange?.(newValue);
    }
  };

  return (
    <View style={styles.accordion}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child) && child.props && typeof child.props === 'object' && 'value' in child.props) {
          const childProps = child.props as { value: string; [key: string]: any };
          return React.cloneElement(child, {
            ...childProps,
            isOpen: openItems.includes(childProps.value),
            onToggle: () => handleValueChange(childProps.value),
          } as any);
        }
        return child;
      })}
    </View>
  );
}

interface AccordionItemProps {
  children: React.ReactNode;
  value: string;
  style?: any;
}

function AccordionItem({
  children,
  value,
  style,
  ...props
}: AccordionItemProps) {
  return (
    <View style={[styles.accordionItem, style]} {...props}>
      {children}
    </View>
  );
}

interface AccordionTriggerProps {
  children: React.ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  style?: any;
}

function AccordionTrigger({
  children,
  isOpen = false,
  onToggle,
  style,
  ...props
}: AccordionTriggerProps) {
  const rotateValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(rotateValue, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isOpen, rotateValue]);

  const rotate = rotateValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <TouchableOpacity
      style={[styles.accordionTrigger, style]}
      onPress={onToggle}
      {...props}
    >
      <View style={styles.accordionTriggerContent}>
        {children}
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-down" size={16} color="#6b7280" />
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
}

interface AccordionContentProps {
  children: React.ReactNode;
  isOpen?: boolean;
  style?: any;
}

function AccordionContent({
  children,
  isOpen = false,
  style,
  ...props
}: AccordionContentProps) {
  const heightValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(heightValue, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isOpen, heightValue]);

  return (
    <Animated.View
      style={[
        styles.accordionContent,
        {
          maxHeight: heightValue.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1000], // Adjust based on content
          }),
          opacity: heightValue,
        },
        style,
      ]}
      {...props}
    >
      <View style={styles.accordionContentInner}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  accordion: {
    width: '100%',
  },
  accordionItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  accordionTrigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  accordionTriggerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  accordionContent: {
    overflow: 'hidden',
  },
  accordionContentInner: {
    paddingTop: 0,
    paddingBottom: 16,
  },
});

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
