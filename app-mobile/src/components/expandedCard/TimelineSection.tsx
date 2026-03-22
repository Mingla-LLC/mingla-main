import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from "react-native";
import { Icon } from "../ui/Icon";
import { TimelineData } from "../../types/expandedCardTypes";
import { generateTimeline } from "../../utils/timelineGenerator";

interface TimelineSectionProps {
  category: string;
  title: string;
  address?: string;
  priceRange?: string;
  travelTime?: string;
  strollTimeline?: Array<{
    step: number;
    type: string;
    title: string;
    location: any;
    description: string;
    duration: number;
  }>;
  routeDuration?: number;
}

interface StepData {
  id: string;
  stepNumber: number;
  label: string;
  title: string;
  subtitle?: string;
  description?: string;
  location?: {
    name?: string;
    address?: string;
    lat?: number;
    lng?: number;
  };
  isStart: boolean;
}

export default function TimelineSection({
  category,
  title,
  address,
  priceRange,
  travelTime,
  strollTimeline,
  routeDuration,
}: TimelineSectionProps) {
  // State to track which steps are expanded (first step expanded by default)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));

  const toggleStep = (stepIndex: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepIndex)) {
      newExpanded.delete(stepIndex);
    } else {
      newExpanded.add(stepIndex);
    }
    setExpandedSteps(newExpanded);
  };

  // Process stroll timeline data
  let steps: StepData[] = [];

  if (strollTimeline && strollTimeline.length > 0) {
    steps = strollTimeline.map((step, index) => {
      const isStart = step.type === "start" || index === 0;
      const stepNumber = step.step || index + 1;

      // Extract title and subtitle from step.title
      // Format could be: "Arrival & Welcome" or "Start: Arrival & Welcome" or "Main Activity"
      // Location name comes from step.location?.name
      let stepTitle = step.title;
      let stepSubtitle = "";

      // Check if title contains a colon (e.g., "Start: Arrival & Welcome")
      const titleParts = step.title.split(":");
      if (titleParts.length > 1) {
        stepTitle = titleParts.slice(1).join(":").trim();
      } else {
        stepTitle = step.title.trim();
      }

      // Subtitle comes from location name or address
      if (step.location?.name) {
        stepSubtitle = step.location.name;
      } else if (step.location?.address) {
        stepSubtitle = step.location.address;
      }

      return {
        id: `step-${stepNumber}`,
        stepNumber,
        label: isStart ? "Start" : `Stop ${stepNumber}`,
        title: stepTitle,
        subtitle: stepSubtitle,
        description: step.description,
        location: step.location,
        isStart,
      };
    });
  } else {
    // Fallback: generate default timeline and convert to StepData format
    const timeline = generateTimeline({
      category,
      title,
      address,
      priceRange,
      travelTime,
    });

    steps = timeline.steps.map((step, index) => {
      const isStart = index === 0;
      const titleParts = step.title.split(":");
      const stepTitle =
        titleParts.length > 1 ? titleParts[0].trim() : step.title;

      return {
        id: step.id,
        stepNumber: index + 1,
        label: isStart ? "Start" : `Stop ${index + 1}`,
        title: stepTitle,
        subtitle: step.location,
        description: step.description,
        location: step.location ? { address: step.location } : undefined,
        isStart,
      };
    });
  }

  const openInMaps = (location: {
    lat?: number;
    lng?: number;
    address?: string;
    name?: string;
  }) => {
    const address = location.address || location.name || "";
    const lat = location.lat;
    const lng = location.lng;

    if (lat != null && lng != null) {
      // Open in maps with coordinates
      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      Linking.openURL(url).catch((err) =>
        console.error("Error opening maps:", err)
      );
    } else if (address) {
      // Open in maps with address
      const encodedAddress = encodeURIComponent(address);
      const url = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
      Linking.openURL(url).catch((err) =>
        console.error("Error opening maps:", err)
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* Timeline Steps */}
      <View style={styles.stepsContainer}>
        {/* Orange vertical line */}
        <View style={styles.timelineLine} />

        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(index);
          const isLast = index === steps.length - 1;

          return (
            <View key={step.id} style={styles.stepWrapper}>
              {/* Step Icon */}
              <View style={styles.stepIconContainer}>
                <View
                  style={[
                    styles.stepIconCircle,
                    isExpanded
                      ? styles.stepIconCircleActive
                      : styles.stepIconCircleInactive,
                  ]}
                >
                  {step.isStart ? (
                    <Icon
                      name="flag"
                      size={20}
                      color={isExpanded ? "#ffffff" : "#9ca3af"}
                    />
                  ) : (
                    <View
                      style={[
                        styles.stopIconInner,
                        isExpanded && styles.stopIconInnerActive,
                      ]}
                    />
                  )}
                </View>
              </View>

              {/* Step Content */}
              <View style={styles.stepContent}>
                {/* Step Header - Always Visible */}
                <TouchableOpacity
                  style={styles.stepHeader}
                  onPress={() => toggleStep(index)}
                  activeOpacity={0.7}
                >
                  <View style={styles.stepHeaderLeft}>
                    {/* Orange pill label */}
                    <View
                      style={[
                        styles.stepLabel,
                        isExpanded && styles.stepLabelActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepLabelText,
                          isExpanded && styles.stepLabelTextActive,
                        ]}
                      >
                        {step.label}
                      </Text>
                    </View>

                    {/* Location pin icon */}
                    <Icon
                      name="location"
                      size={14}
                      color={"#eb7825"}
                      style={styles.locationPin}
                    />

                    {/* Title and Subtitle */}
                    <View style={styles.stepTitleContainer}>
                      <Text
                        style={[
                          styles.stepTitle,
                          isExpanded && styles.stepTitleActive,
                        ]}
                      >
                        {step.title}
                      </Text>
                      {step.subtitle && (
                        <Text style={styles.stepSubtitle}>{step.subtitle}</Text>
                      )}
                    </View>
                  </View>

                  {/* Caret icon */}
                  <Icon
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={isExpanded ? "#eb7825" : "#9ca3af"}
                  />
                </TouchableOpacity>

                {/* Expanded Content */}
                {isExpanded && (
                  <View style={styles.expandedContent}>
                    {/* Description */}
                    {step.description && (
                      <Text style={styles.stepDescription}>
                        {step.description}
                      </Text>
                    )}

                    {/* Location Card */}
                    {step.location &&
                      (step.location.address || step.location.name) && (
                        <View style={styles.locationCard}>
                          <View style={styles.locationCardContent}>
                            <Icon
                              name="location"
                              size={16}
                              color="#eb7825"
                            />
                            <Text style={styles.locationCardAddress}>
                              {step.location.address || step.location.name}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.openMapsButton}
                            onPress={() => openInMaps(step.location!)}
                            activeOpacity={0.7}
                          >
                            <Icon
                              name="paper-plane"
                              size={14}
                              color="#eb7825"
                            />
                            <Text style={styles.openMapsText}>
                              Open in Maps
                            </Text>
                            <Icon
                              name="open-outline"
                              size={12}
                              color="#eb7825"
                            />
                          </TouchableOpacity>
                        </View>
                      )}

                    {/* "Then..." Separator */}
                    {!isLast && (
                      <View style={styles.separator}>
                        <View style={styles.separatorLine} />
                        <Text style={styles.separatorText}>Then...</Text>
                        <View style={styles.separatorLine} />
                      </View>
                    )}
                  </View>
                )}

                {/* Collapsed State - Show minimal info */}
                {/*  {!isExpanded && (
                  <View style={styles.collapsedContent}>
                    {step.subtitle && (
                      <Text style={styles.collapsedSubtitle}>
                        {step.subtitle}
                      </Text>
                    )}
                  </View>
                )} */}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  stepsContainer: {
    paddingHorizontal: 16,
    position: "relative",
  },
  timelineLine: {
    position: "absolute",
    left: 30,
    top: 10,
    bottom: 24,
    width: 2,
    backgroundColor: "#eb7825",
    zIndex: 0,
  },
  stepWrapper: {
    flexDirection: "row",
    marginBottom: 16,
    position: "relative",
    zIndex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 16,
  },
  stepIconContainer: {
    width: 40,
    alignItems: "center",
    zIndex: 2,
  },
  stepIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  stepIconCircleActive: {
    backgroundColor: "#eb7825",
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  stepIconCircleInactive: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  stopIconInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#9ca3af",
  },
  stopIconInnerActive: {
    backgroundColor: "#ffffff",
  },
  stepContent: {
    flex: 1,
    marginLeft: 12,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  stepHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 6,
  },
  stepLabel: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stepLabelActive: {
    backgroundColor: "#eb7825",
  },
  stepLabelText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  stepLabelTextActive: {
    color: "#ffffff",
  },
  locationPin: {
    marginLeft: 2,
  },
  stepTitleContainer: {
    flex: 1,
    minWidth: "100%",
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  stepTitleActive: {
    color: "#eb7825",
  },
  stepSubtitle: {
    fontSize: 14,
    color: "#6b7280",
  },
  expandedContent: {
    marginTop: 8,
  },
  stepDescription: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 12,
  },
  locationCard: {
    backgroundColor: "#fef3e2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  locationCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  locationCardAddress: {
    fontSize: 14,
    color: "#111827",
    flex: 1,
  },
  openMapsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 6,
  },
  openMapsText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#eb7825",
  },
  separator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  separatorText: {
    fontSize: 12,
    color: "#9ca3af",
    fontWeight: "500",
  },
  collapsedContent: {
    marginTop: 4,
  },
  collapsedSubtitle: {
    fontSize: 13,
    color: "#9ca3af",
  },
});
