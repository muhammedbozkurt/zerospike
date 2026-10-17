import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { hapticSelect } from "../lib/haptics";
import { RADIUS, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { upper } from "../lib/upper";
import type { JournalEntry } from "../lib/db/journal";

/**
 * The journal's container, shared by the dashboard's preview and the full
 * screen (app/journal.tsx).
 *
 * It is ONE container painted across four separately rendered pieces of the
 * same SectionList - the header closes the top, each day separator and each row
 * carry the sides, the footer closes the bottom - because it cannot be a single
 * wrapping <View> without giving up virtualization. On the dashboard the same
 * SectionList is also the page scroller, so a self-contained list component was
 * never an option; what is shared instead is every piece of the chrome, so the
 * two screens cannot drift apart.
 *
 * Opaque (THEME.surfaceRaised) rather than the usual translucent glass, because the day
 * separators are STICKY: rows scroll underneath them, and anything see-through
 * would show the feed sliding past behind the date.
 */
export const JOURNAL_PANEL_PAD = 12;

/** The sides, carried by every piece between the top and the bottom. */
export const journalPanelSide = () =>
  ({
    backgroundColor: THEME.surfaceRaised,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: THEME.border,
  }) as const;

export type JournalSection = {
  title: string;
  dateLabel: string;
  data: JournalEntry[];
};

/**
 * Day separator. Inside the panel it is a SECTION BREAK rather than a pill on
 * the page: a full-width band carrying the container's sides, so it divides the
 * rows instead of adding a second bordered shape on top of them. Still opaque,
 * which is what keeps it readable while stuck over scrolling rows.
 *
 * The label wraps rather than clipping: the longest relative-day + date
 * combinations need the second line at large accessibility text sizes.
 */
export function JournalDayHeader({ section }: { section: JournalSection }) {
  return (
    <View
      style={{
        ...journalPanelSide(),
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        paddingHorizontal: JOURNAL_PANEL_PAD,
        paddingTop: 12,
        paddingBottom: 6,
      }}
    >
      <Text style={{ color: THEME.text, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>
        {upper(section.title)}
      </Text>
      {section.dateLabel !== section.title ? (
        <Text style={{ color: THEME.textMuted, fontSize: 11, fontWeight: "600" }}>
          {section.dateLabel}
        </Text>
      ) : null}
    </View>
  );
}

export type JournalFilter = "all" | "glucose" | "meal" | "injection" | "med";

/** Session-only kind filter. Wraps rather than overflowing, which is what keeps
 *  the longest translated set (de/pt) on the panel instead of off the screen. */
export function JournalFilterChips({
  chips,
  value,
  onChange,
}: {
  chips: { key: JournalFilter; label: string }[];
  value: JournalFilter;
  onChange: (next: JournalFilter) => void;
}) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {chips.map((c) => {
        const on = value === c.key;
        return (
          <Pressable
            key={c.key}
            onPress={() => {
              hapticSelect();
              onChange(c.key);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.label}
            className={`rounded-full px-3 py-1.5 border ${
              on ? "bg-brand border-brand" : "bg-glass border-hair"
            }`}
          >
            <Text className={`text-xs font-semibold ${on ? "text-onAccent" : "text-mut"}`}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Opens the container: heading and filter chips share it with the rows below
 *  instead of floating on the page. */
export function JournalPanelTop({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={{
        ...journalPanelSide(),
        borderTopWidth: 1,
        borderTopLeftRadius: RADIUS.lg,
        borderTopRightRadius: RADIUS.lg,
        paddingHorizontal: JOURNAL_PANEL_PAD,
        paddingTop: 12,
      }}
    >
      <Text className="text-xs font-semibold tracking-wider text-mut mb-2">
        {upper(title)}
      </Text>
      {children}
    </View>
  );
}

/** Closes the container. `children` is the one action that belongs to the
 *  journal itself: "see the full journal" on the dashboard, "show more" on the
 *  full screen. */
export function JournalPanelBottom({ children }: { children?: React.ReactNode }) {
  const hasAction = React.Children.count(children) > 0 && children !== false;
  return (
    <View
      style={{
        ...journalPanelSide(),
        borderBottomWidth: 1,
        borderBottomLeftRadius: RADIUS.lg,
        borderBottomRightRadius: RADIUS.lg,
        paddingHorizontal: JOURNAL_PANEL_PAD,
        paddingTop: hasAction ? 4 : 12,
        paddingBottom: hasAction ? 12 : 4,
      }}
    >
      {children}
    </View>
  );
}

/**
 * The medical notice. Sits BELOW the panel on both screens, never inside it: it
 * speaks for the whole app rather than for this list, and it is the last thing
 * on the page either way (App Review guideline 5.1.1 framing - see
 * components/Disclaimer.tsx for the full version).
 */
export function JournalDisclaimerNote() {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-start rounded-xl border px-3.5 py-3 mt-3"
      style={{
        borderColor: withAlpha(THEME.warning, 0.25),
        backgroundColor: withAlpha(THEME.warning, 0.1),
      }}
    >
      <Ionicons name="medical-outline" size={15} color={THEME.warning} />
      <Text className="text-xs leading-4 ml-2.5 flex-1" style={{ color: THEME.textMuted }}>
        {t("disclaimer.short")}
      </Text>
    </View>
  );
}

/** The empty state for a kind filter that matched nothing. NOT the first-run
 *  case: the user has records, just none of this kind. */
export function JournalEmptyFilter({ onClearFilter }: { onClearFilter: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ ...journalPanelSide(), alignItems: "center", paddingVertical: 40 }}>
      <Ionicons name="funnel-outline" size={32} color={THEME.textMuted} />
      <Text className="text-mut text-center mt-3 px-8">{t("dashboard.emptyFilter")}</Text>
      <Pressable
        onPress={() => {
          hapticSelect();
          onClearFilter();
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("dashboard.filterAll")}
        className="mt-3 rounded-full border border-hair bg-glass px-3.5 py-1.5"
      >
        <Text className="text-xs font-semibold text-mut">{t("dashboard.filterAll")}</Text>
      </Pressable>
    </View>
  );
}
