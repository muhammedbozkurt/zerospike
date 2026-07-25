import React, { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { JournalEntry } from "../lib/db/journal";
import type { LogTag, UserProfile } from "../lib/db/types";
import {
  classifyGlucose,
  GlucoseStatus,
  formatGlucose,
  glucoseUnitLabel,
} from "../lib/glucose";
import { formatTime } from "../lib/format";
import { num } from "../lib/format";
import { RICH_BY_STATUS, THEME, TABULAR, glow } from "../lib/theme/tokens";
import { GlucoseChip } from "./rich/GlucoseChip";
import { IconTile } from "./rich/IconTile";
import { withAlpha } from "./rich/GlassCard";



/** The shared glass "lrow": translucent fill, light border, left accent bar. */
function Row({
  children,
  accent,
  onPress,
  onLongPress,
}: {
  children: React.ReactNode;
  accent: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 13,
        borderWidth: 1,
        borderColor: THEME.border,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        backgroundColor: THEME.glass,
        paddingVertical: 9,
        paddingHorizontal: 10,
        marginBottom: 9,
      }}
    >
      {children}
    </Pressable>
  );
}

/** Max tag chips shown before the rest collapse into a "+N" chip. Keeps tags on
 *  ONE line (no flex-wrap second row). */
const MAX_TAG_CHIPS = 2;

function TagChip({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: withAlpha(THEME.accent, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(THEME.accent, 0.22),
        paddingHorizontal: 6,
        paddingVertical: 1,
        marginRight: 4,
      }}
    >
      <Text style={{ color: THEME.accent, fontSize: 10, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function TagBadges({ tags }: { tags: LogTag[] }) {
  const { t } = useTranslation();
  // Collapsed to one line ("+N") until the user taps +N to reveal them all. The
  // +N Pressable is its own responder, so tapping it does NOT open the row's
  // edit flow.
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;
  const visible = expanded ? tags : tags.slice(0, MAX_TAG_CHIPS);
  const overflow = tags.length - visible.length;
  const allLabel = tags.map((tag) => t(`tags.${tag}`)).join(", ");
  return (
    <View
      className={`flex-row items-center mt-1 ${expanded ? "flex-wrap" : ""}`}
      accessibilityLabel={`${t("tags.label")}: ${allLabel}`}
    >
      {visible.map((tag) => (
        <TagChip key={tag} label={t(`tags.${tag}`)} />
      ))}
      {overflow > 0 || expanded ? (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? t("journal.showLess") : allLabel}
        >
          <TagChip label={expanded ? t("journal.showLess") : `+${overflow}`} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface Props {
  entry: JournalEntry;
  profile: UserProfile;
  onLongPress?: (entry: JournalEntry) => void;
  onPress?: (entry: JournalEntry) => void;
}

export function JournalItem({ entry, profile, onLongPress, onPress }: Props) {
  const { t } = useTranslation();

  if (entry.kind === "glucose") {
    const status = classifyGlucose(
      entry.glucose_level_mgdl,
      entry.period_tag,
      profile
    );
    const color = RICH_BY_STATUS[status];
    return (
      <Row accent={color} onPress={() => onPress?.(entry)} onLongPress={() => onLongPress?.(entry)}>
        {/* value chip carries the reading in its status color (never color alone) */}
        <GlucoseChip
          value={formatGlucose(entry.glucose_level_mgdl, profile.glucose_unit)}
          status={status}
          dot={false}
          style={{ marginRight: 10 }}
        />
        <View className="flex-1">
          <Text style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }}>
            <Ionicons name="water" size={11} color={color} />{" "}
            {t(`period.${entry.period_tag}`)}
            {entry.source === "health" ? " · CGM" : ""}
          </Text>
          {status === "low" ? (
            <Text style={{ color, fontSize: 10, fontWeight: "800", marginTop: 1 }}>
              {t("journal.lowBadge")}
            </Text>
          ) : null}
          <TagBadges tags={entry.tags} />
        </View>
        <Text style={{ color: THEME.muted, fontSize: 10 }}>{formatTime(entry.logged_at)}</Text>
      </Row>
    );
  }

  if (entry.kind === "injection") {
    const typeLabel =
      entry.insulin_type === "basal"
        ? t("injection.typeBasal")
        : entry.insulin_type === "bolus"
          ? t("injection.typeBolus")
          : null;
    return (
      <Row accent={THEME.accent} onPress={() => onPress?.(entry)} onLongPress={() => onLongPress?.(entry)}>
        <IconTile icon="medical" size={30} radius={10} style={{ marginRight: 10 }} />
        {entry.dose_units != null ? (
          <View
            style={[
              {
                borderRadius: 9,
                paddingHorizontal: 8,
                paddingVertical: 3,
                marginRight: 8,
                backgroundColor: withAlpha(THEME.accent, 0.16),
              },
              glow(THEME.accent, 10, 0.35),
            ]}
          >
            <Text style={[TABULAR, { color: THEME.accent, fontSize: 11, fontWeight: "800" }]}>
              {num(entry.dose_units)} {t("common.units")}
            </Text>
          </View>
        ) : null}
        <View className="flex-1">
          <Text
            style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {t(`injectionSite.${entry.site}`)}
            {typeLabel ? ` · ${typeLabel}` : ""}
          </Text>
          {entry.note ? (
            <Text style={{ color: THEME.muted, fontSize: 10, fontStyle: "italic", marginTop: 1 }} numberOfLines={2}>
              {`“${entry.note}”`}
            </Text>
          ) : null}
          <TagBadges tags={entry.tags} />
        </View>
        <Text style={{ color: THEME.muted, fontSize: 10 }}>{formatTime(entry.logged_at)}</Text>
      </Row>
    );
  }

  // meal entry — neutral (muted) accent, on-palette instead of slate hexes.
  return (
    <Row accent={THEME.muted} onPress={() => onPress?.(entry)} onLongPress={() => onLongPress?.(entry)}>
      {entry.photo_uri_local ? (
        <Image source={{ uri: entry.photo_uri_local }} style={{ width: 30, height: 30, borderRadius: 10, marginRight: 10 }} />
      ) : (
        <IconTile icon="restaurant" size={30} radius={10} tint={THEME.muted} style={{ marginRight: 10 }} />
      )}
      <View className="flex-1">
        {/* Food name is user data: wraps to two lines rather than clipping. */}
        <Text style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }} numberOfLines={2}>
          {entry.display_name}
        </Text>
        <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 1 }}>
          {Math.round(entry.portion_g)} {t("common.grams")} ·{" "}
          {t("journal.carbsLabel", {
            carbs: num(Math.round(entry.calculated_carbs_g * 10) / 10),
          })}{" "}
          · {t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })}
        </Text>
        {entry.personal_note ? (
          <Text style={{ color: THEME.muted, fontSize: 10, fontStyle: "italic", marginTop: 1 }} numberOfLines={2}>
            “{entry.personal_note}”
          </Text>
        ) : null}
        <TagBadges tags={entry.tags} />
      </View>
      <Text style={{ color: THEME.muted, fontSize: 10 }}>{formatTime(entry.logged_at)}</Text>
    </Row>
  );
}
