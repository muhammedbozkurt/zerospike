import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { JournalEntry } from "../lib/db/journal";
import type { LogTag, UserProfile } from "../lib/db/types";
import { FoodPlate } from "./FoodPlate";
import {
  classifyGlucose,
  GlucoseStatus,
  formatGlucose,
  glucoseUnitLabel,
} from "../lib/glucose";
import { formatTime } from "../lib/format";
import { num } from "../lib/format";
import { RICH_BY_STATUS, THEME, TABULAR, glow, HIT_TARGET } from "../lib/theme/tokens";
import { GlucoseChip } from "./rich/GlucoseChip";
import { IconTile } from "./rich/IconTile";
import { withAlpha } from "./rich/GlassCard";



/** The shared glass "lrow": translucent fill, light border, left accent bar.
 *
 *  The edit/delete menu is reached ONLY by long-pressing the row, which a screen
 *  reader neither announces nor offers. It is now both hinted and exposed as a
 *  real accessibility action, so the menu is reachable without a long press. */
function Row({
  children,
  accent,
  label,
  onPress,
  onLongPress,
  inPanel,
  firstInPanel,
}: {
  children: React.ReactNode;
  accent: string;
  /** What this row is, spoken as one phrase (the children are decorative parts). */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Drawn INSIDE the dashboard's journal panel rather than as a free-standing
   *  card on the page background. A card inside a card reads as twice the
   *  chrome for the same content, so in this mode the row drops its own border,
   *  corner radius and fill and becomes a plain divided line - the panel
   *  already provides all three. The colour hierarchy is untouched: the type
   *  accent moves from a left border to a leading bar of the same width and
   *  colour, so the row is still identifiable at a glance. */
  inPanel?: boolean;
  /** First row under a day separator: no divider above it, the separator is
   *  already the break. */
  firstInPanel?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? t("journal.rowHint") : undefined}
      accessibilityActions={
        onLongPress
          ? [{ name: "longpress", label: t("journal.rowActions") }]
          : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        // The shortest row (a glucose reading with no tags) came to ~40pt, just
        // under the 44pt target - and this row IS the tap target for editing.
        // A floor, not a height: taller rows are untouched, and the row still
        // grows with the text at a large accessibility font size.
        minHeight: HIT_TARGET,
        ...(inPanel
          ? {
              borderTopWidth: firstInPanel ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: THEME.border,
              paddingVertical: 10,
              paddingHorizontal: 12,
            }
          : {
              borderRadius: 13,
              borderWidth: 1,
              borderColor: THEME.border,
              borderLeftWidth: 3,
              borderLeftColor: accent,
              backgroundColor: THEME.glass,
              paddingVertical: 9,
              paddingHorizontal: 10,
              marginBottom: 9,
            }),
      }}
    >
      {inPanel ? (
        <View
          style={{
            width: 3,
            alignSelf: "stretch",
            minHeight: 22,
            borderRadius: 2,
            backgroundColor: accent,
            marginRight: 9,
          }}
        />
      ) : null}
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
          // A 10pt chip inside the row's own Pressable: a near-miss opened the
          // edit flow instead of expanding the tags. The slop carries the target
          // to ~44pt without making the chip (or the row) any taller.
          hitSlop={{ top: 13, bottom: 13, left: 12, right: 12 }}
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

/**
 * The meal thumbnail's on-screen size, and the decode budget derived from it.
 *
 * A logged meal photo is a full-resolution camera image (several megapixels). It
 * is shown in a 30x30 dp square, and without a size hint the loader decoded the
 * whole thing into memory for every visible row - the single most expensive thing
 * on the journal list. The hint caps the decode at 3x the display size, which is
 * past any screen's pixel density and a rounding error next to the original.
 */
const MEAL_THUMB_DP = 30;
const MEAL_THUMB_DECODE_PX = MEAL_THUMB_DP * 3;

interface Props {
  entry: JournalEntry;
  profile: UserProfile;
  onLongPress?: (entry: JournalEntry) => void;
  onPress?: (entry: JournalEntry) => void;
  /** Meal rows only: when true, shows a small curve chevron that opens the
   *  meal's response (lib/mealResponse.ts) instead of the row's own edit tap. */
  hasResponse?: boolean;
  onOpenResponse?: (entry: JournalEntry) => void;
  /** See Row's own `inPanel` note: the dashboard draws its journal inside one
   *  container, every other caller still gets the free-standing card. */
  inPanel?: boolean;
  firstInPanel?: boolean;
}

function JournalItemBase({
  entry,
  profile,
  onLongPress,
  onPress,
  hasResponse,
  onOpenResponse,
  inPanel,
  firstInPanel,
}: Props) {
  const { t } = useTranslation();
  const chrome = { inPanel, firstInPanel };

  if (entry.kind === "glucose") {
    const status = classifyGlucose(
      entry.glucose_level_mgdl,
      entry.period_tag,
      profile
    );
    const color = RICH_BY_STATUS[status];
    const label = [
      `${formatGlucose(entry.glucose_level_mgdl, profile.glucose_unit)} ${glucoseUnitLabel(profile.glucose_unit)}`,
      t(`period.${entry.period_tag}`),
      status === "low" ? t("journal.lowBadge") : null,
      formatTime(entry.logged_at),
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={color}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
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
        {/* The time is the row's right edge: at a large accessibility font size
            it shrinks rather than wrapping the clock onto two lines. */}
        <Text
          style={{ color: THEME.muted, fontSize: 10, marginLeft: 6 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {formatTime(entry.logged_at)}
        </Text>
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
    const label = [
      entry.dose_units != null
        ? `${num(entry.dose_units)} ${t("common.units")}`
        : null,
      entry.site ? t(`injectionSite.${entry.site}`) : t("injectionSite.unassigned"),
      typeLabel,
      formatTime(entry.logged_at),
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={THEME.accent}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
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
            {entry.site
              ? t(`injectionSite.${entry.site}`)
              : t("injectionSite.unassigned")}
            {typeLabel ? ` · ${typeLabel}` : ""}
          </Text>
          {entry.note ? (
            <Text style={{ color: THEME.muted, fontSize: 10, fontStyle: "italic", marginTop: 1 }} numberOfLines={2}>
              {`“${entry.note}”`}
            </Text>
          ) : null}
          <TagBadges tags={entry.tags} />
        </View>
        <Text
          style={{ color: THEME.muted, fontSize: 10, marginLeft: 6 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {formatTime(entry.logged_at)}
        </Text>
      </Row>
    );
  }

  if (entry.kind === "med") {
    const label = [
      entry.name ? `${t("meds.entryLabel")} · ${entry.name}` : t("meds.entryLabel"),
      formatTime(entry.logged_at),
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={THEME.accent}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
        {/* IconTile only carries Ionicons; a pill glyph lives in
            MaterialCommunityIcons, so this tile matches IconTile's look by
            hand instead of forcing "medical"/"medkit" onto a row that would
            then read the same as the injection row above it. */}
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: THEME.border,
            backgroundColor: THEME.glass,
            marginRight: 10,
          }}
        >
          <MaterialCommunityIcons name="pill" size={16} color={THEME.accent} />
        </View>
        <View className="flex-1">
          <Text
            style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {entry.name ? `${t("meds.entryLabel")} · ${entry.name}` : t("meds.entryLabel")}
          </Text>
        </View>
        <Text
          style={{ color: THEME.muted, fontSize: 10, marginLeft: 6 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {formatTime(entry.logged_at)}
        </Text>
      </Row>
    );
  }

  // meal entry: neutral (muted) accent, on-palette instead of slate hexes.
  const mealLabel = [
    entry.display_name,
    `${Math.round(entry.portion_g)} ${t("common.grams")}`,
    t("journal.carbsLabel", {
      carbs: num(Math.round(entry.calculated_carbs_g * 10) / 10),
    }),
    entry.insulin_dose_units > 0
      ? t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })
      : null,
    formatTime(entry.logged_at),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Row
      {...chrome}
      accent={THEME.muted}
      label={mealLabel}
      onPress={() => onPress?.(entry)}
      onLongPress={() => onLongPress?.(entry)}
    >
      {entry.photo_uri_local ? (
        <Image
          source={{
            uri: entry.photo_uri_local,
            width: MEAL_THUMB_DECODE_PX,
            height: MEAL_THUMB_DECODE_PX,
          }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          style={{
            width: MEAL_THUMB_DP,
            height: MEAL_THUMB_DP,
            borderRadius: 10,
            marginRight: 10,
          }}
        />
      ) : (
        // Shared food plate: the emoji always travels with an Ionicons fallback,
        // so a category the emoji map does not know (or a device without an
        // emoji font) still shows a picture instead of a blank box.
        <FoodPlate
          category={entry.category}
          size={MEAL_THUMB_DP}
          radius={10}
          style={{ marginRight: 10 }}
        />
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
          })}
          {entry.insulin_dose_units > 0
            ? ` · ${t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })}`
            : ""}
        </Text>
        {entry.personal_note ? (
          <Text style={{ color: THEME.muted, fontSize: 10, fontStyle: "italic", marginTop: 1 }} numberOfLines={2}>
            “{entry.personal_note}”
          </Text>
        ) : null}
        <TagBadges tags={entry.tags} />
      </View>
      <View className="items-end" style={{ marginLeft: 6 }}>
        <Text
          style={{ color: THEME.muted, fontSize: 10 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {formatTime(entry.logged_at)}
        </Text>
        {hasResponse && onOpenResponse ? (
          // Nested inside the row's own Pressable, so it has to be an
          // unmistakable target of its own: 14pt + hitSlop 8 came to ~30pt, and a
          // near-miss silently opened the row's edit flow instead. The slop
          // carries it to 44pt without making the row taller.
          <Pressable
            onPress={() => onOpenResponse(entry)}
            hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={t("mealResponse.title")}
            style={{ marginTop: 3 }}
          >
            <Ionicons name="pulse-outline" size={16} color={THEME.accent} />
          </Pressable>
        ) : null}
      </View>
    </Row>
  );
}

/**
 * Memoized: a journal row's output is a pure function of its entry, the profile's
 * targets and its two flags. The dashboard re-renders on plenty of things a row
 * knows nothing about (a ticking timer, a sheet opening, a filter chip), and each
 * of those used to re-render every visible row - including re-decoding every meal
 * photo above. The callback props are already identity-stable on the caller side
 * (a ref-backed wrapper), so the default shallow compare is enough.
 */
export const JournalItem = React.memo(JournalItemBase);
