/**
 * #4238 W6a — "Headline, text and button" (design v9 words sheet): the
 * tightest limit per field with the app it comes from, the TikTok emoji note,
 * the button as a 2 × 2 grid, Cancel and Save pinned at the foot. The copy
 * check only warns (T-5): Save is never blocked by it.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { color, space, type } from "../../../constants/designSystem";
import { platformName } from "./hostAdCopy";
import { hb } from "./hostAdBuilderCopy";
import { BuilderLabel, builderStyles as bs, ChipRow, Note } from "./HostAdBuilderBits";
import {
  HOST_AD_CTA_OPTIONS,
  HOST_AD_TEXT_RULES,
  type HostAdCtaId,
  hostAdTikTokEmojiNote,
} from "./hostAdCreativeRules";

type Field = "primary" | "headline";

/** The tightest limit among the chosen apps for one field. */
function tightest(apps: readonly string[], field: Field): { max: number; platform: string } | null {
  const rules = HOST_AD_TEXT_RULES.filter((rule) => rule.field === field && apps.includes(rule.platform));
  if (rules.length === 0) return null;
  const best = rules.reduce((a, b) => (b.max < a.max ? b : a));
  return { max: best.max, platform: best.platform };
}

export function HostAdWordsSheet(props: {
  visible: boolean;
  apps: readonly string[];
  name: string;
  headline: string;
  primary: string;
  cta: HostAdCtaId;
  warnings: readonly { excerpt: string; message: string }[];
  onClose: () => void;
  onSave: (next: { name: string; headline: string; primary: string; cta: HostAdCtaId }) => void;
}): React.ReactElement {
  const [name, setName] = useState(props.name);
  const [headline, setHeadline] = useState(props.headline);
  const [primary, setPrimary] = useState(props.primary);
  const [cta, setCta] = useState<HostAdCtaId>(props.cta);
  useEffect(() => {
    if (!props.visible) return;
    setName(props.name);
    setHeadline(props.headline);
    setPrimary(props.primary);
    setCta(props.cta);
  }, [props.visible, props.name, props.headline, props.primary, props.cta]);
  const headLimit = tightest(props.apps, "headline");
  const textLimit = tightest(props.apps, "primary");
  const count = (text: string): number => [...text].length;
  const limitLine = (text: string, limit: { max: number; platform: string } | null): string =>
    limit
      ? hb("creative.limit", { n: count(text), max: limit.max, app: platformName(limit.platform) })
      : String(count(text));
  const emoji = hostAdTikTokEmojiNote(props.apps, primary);
  return (
    <Sheet visible={props.visible} onClose={props.onClose} snapPoint="full" testID="host-ad-words-sheet">
      <View style={s.wrap}>
        <Text style={s.title} accessibilityRole="header">{hb("creative.words")}</Text>
        <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" testID="host-ad-words-scroll">
          {props.warnings.map((warning) => (
            <Note key={`${warning.excerpt}-${warning.message}`} tone="warn" text={`“${warning.excerpt}”: ${warning.message} ${hb("creative.copyWarn")}`} />
          ))}
          <View style={bs.stack}>
            <View style={bs.rowBetween}>
              <BuilderLabel>{hb("creative.headline")}</BuilderLabel>
              <Text style={[bs.caption, headLimit && count(headline) > headLimit.max && s.over]}>{limitLine(headline, headLimit)}</Text>
            </View>
            <Input value={headline} onChangeText={setHeadline} accessibilityLabel={hb("creative.headline")} testID="host-ad-words-headline" />
          </View>
          <View style={bs.stack}>
            <View style={bs.rowBetween}>
              <BuilderLabel>{hb("creative.text")}</BuilderLabel>
              <Text style={[bs.caption, textLimit && count(primary) > textLimit.max && s.over]}>{limitLine(primary, textLimit)}</Text>
            </View>
            <Input value={primary} onChangeText={setPrimary} multiline accessibilityLabel={hb("creative.text")} testID="host-ad-words-text" />
            {props.apps.includes("tiktok") ? <Text style={bs.caption}>{emoji ? emoji : hb("creative.emoji")}</Text> : null}
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("creative.button")}</BuilderLabel>
            <ChipRow
              grid
              role="radio"
              accessibilityLabel={hb("creative.button")}
              options={HOST_AD_CTA_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
              selected={[cta]}
              onToggle={(id) => setCta(id as HostAdCtaId)}
              testIDPrefix="host-ad-words-cta"
            />
          </View>
          <View style={bs.stack}>
            <BuilderLabel>{hb("creative.name")}</BuilderLabel>
            <Input value={name} onChangeText={setName} accessibilityLabel={hb("creative.name")} testID="host-ad-words-name" />
            <Text style={bs.caption}>{hb("creative.nameHelp")}</Text>
          </View>
        </ScrollView>
        <View style={s.foot} testID="host-ad-words-footer">
          <View style={s.half}>
            <Button label={hb("creative.cancel")} variant="secondary" fullWidth onPress={props.onClose} testID="host-ad-words-cancel" />
          </View>
          <View style={s.half}>
            <Button
              label={hb("creative.save")}
              fullWidth
              onPress={() => props.onSave({ name: name.trim(), headline: headline.trim(), primary: primary.trim(), cta })}
              testID="host-ad-words-save"
            />
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  // #4238 rework 3: minHeight 0 + a shrinking scroll keep Save inside the card at 800 px tall.
  wrap: { flex: 1, minHeight: 0, paddingHorizontal: space[6], paddingTop: space[2] },
  scroll: { flex: 1, minHeight: 0 },
  title: { ...type.h1, color: color.text1, marginBottom: space[6] },
  body: { gap: space[6], paddingBottom: space[6] },
  over: { color: color.warningText },
  foot: {
    flexDirection: "row",
    gap: space[3],
    paddingTop: space[4],
    paddingBottom: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  half: { flex: 1 },
});
