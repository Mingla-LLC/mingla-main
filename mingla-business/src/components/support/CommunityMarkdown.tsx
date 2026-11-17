import React, { useCallback } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import {
  parseCommunityMarkdown,
  type CommunityMarkdownInline,
} from "../../utils/communityMarkdown";
import {
  color,
  space,
} from "../../constants/designSystem";

function Inline({
  item,
}: {
  item: CommunityMarkdownInline;
}): React.ReactElement {
  const openLink = useCallback(() => {
    if (item.href) void Linking.openURL(item.href);
  }, [item.href]);
  return (
    <Text
      style={[
        item.bold && styles.bold,
        item.italic && styles.italic,
        item.code && styles.code,
        item.href && styles.link,
      ]}
      accessibilityRole={item.href ? "link" : undefined}
      onPress={item.href ? openLink : undefined}
    >
      {item.text}
    </Text>
  );
}

export function CommunityMarkdown({
  body,
}: {
  body: string;
}): React.ReactElement {
  const blocks = parseCommunityMarkdown(body);
  return (
    <View style={styles.root}>
      {blocks.map((block, blockIndex) => {
        const prefix =
          block.kind === "bullet"
            ? "• "
            : block.kind === "numbered"
              ? `${block.ordinal}. `
              : block.kind === "quote"
                ? "“"
                : "";
        const suffix = block.kind === "quote" ? "”" : "";
        return (
          <Text
            key={`${block.kind}-${blockIndex}`}
            accessibilityRole={block.kind === "heading" ? "header" : undefined}
            style={[
              styles.line,
              block.kind === "heading" && styles.heading,
              block.level === 1 && styles.headingOne,
              block.kind === "quote" && styles.quote,
            ]}
          >
            {prefix}
            {block.inline.map((item, inlineIndex) => (
              <Inline key={`${blockIndex}-${inlineIndex}`} item={item} />
            ))}
            {suffix}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: space[4],
    gap: space[1],
  },
  line: {
    fontSize: 14,
    lineHeight: 21,
    color: color.text2,
  },
  heading: {
    marginTop: space[1],
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: color.text1,
  },
  headingOne: {
    fontSize: 18,
    lineHeight: 24,
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: {
    fontFamily: "monospace",
    color: color.text1,
  },
  link: {
    color: color.infoText,
    textDecorationLine: "underline",
  },
  quote: {
    fontStyle: "italic",
    color: color.text3,
  },
});
