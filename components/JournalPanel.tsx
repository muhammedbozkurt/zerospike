import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { hapticSelect } from "../lib/haptics";
import { RADIUS, SPACE, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { Button, Chip, Txt } from "./ui";
import { upper } from "../lib/upper";
import type { JournalEntry } from "../lib/db/journal";
import type { CgmDayEntry } from "../lib/cgm/daySummary";

/** A journal list row: a record, or the one summary row a day of sensor
 *  readings folds into. */
export type JournalListRow = JournalEntry | CgmDayEntry;

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
export const JOURNAL_PANEL_PAD = SPACE.md;

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
  data: JournalListRow[];
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
        gap: SPACE.sm,
        paddingHorizontal: JOURNAL_PANEL_PAD,
        paddingTop: SPACE.md,
        paddingBottom: SPACE.sm,
      }}
    >
      <Txt kind="micro" style={{ fontWeight: "700", letterSpacing: 0.8 }}>
        {upper(section.title)}
      </Txt>
      {section.dateLabel !== section.title ? (
        <Txt kind="micro" tone="muted">
          {section.dateLabel}
        </Txt>
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
    <View className="flex-row flex-wrap" style={{ gap: SPACE.sm }}>
      {chips.map((c) => (
        <Chip
          key={c.key}
          label={c.label}
          selected={value === c.key}
          onPress={() => onChange(c.key)}
        />
      ))}
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
        paddingTop: SPACE.md,
      }}
    >
      <Txt kind="micro" tone="muted" style={{ letterSpacing: 1.3, marginBottom: SPACE.sm }}>
        {upper(title)}
      </Txt>
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
        paddingTop: hasAction ? SPACE.xs : SPACE.md,
        paddingBottom: hasAction ? SPACE.md : SPACE.xs,
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
      className="flex-row items-start rounded-xl border"
      style={{
        padding: SPACE.md,
        marginTop: SPACE.md,
        borderColor: withAlpha(THEME.warning, 0.25),
        backgroundColor: withAlpha(THEME.warning, 0.1),
      }}
    >
      <Ionicons name="medical-outline" size={15} color={THEME.warning} />
      <Txt kind="caption" tone="muted" style={{ flex: 1, minWidth: 0, marginStart: SPACE.sm }}>
        {t("disclaimer.short")}
      </Txt>
    </View>
  );
}

/** The empty state for a kind filter that matched nothing. NOT the first-run
 *  case: the user has records, just none of this kind. */
export function JournalEmptyFilter({ onClearFilter }: { onClearFilter: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ ...journalPanelSide(), alignItems: "center", paddingVertical: SPACE.xl }}>
      <Ionicons name="funnel-outline" size={32} color={THEME.textMuted} />
      <Txt
        tone="muted"
        style={{ textAlign: "center", marginTop: SPACE.md, paddingHorizontal: SPACE.xl }}
      >
        {t("dashboard.emptyFilter")}
      </Txt>
      <View style={{ marginTop: SPACE.md }}>
        <Button
          label={t("dashboard.filterAll")}
          variant="outlined"
          size="sm"
          onPress={() => {
            hapticSelect();
            onClearFilter();
          }}
        />
      </View>
    </View>
  );
}
