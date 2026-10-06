import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SectionList, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { getJournal, type GlucoseEntry, type JournalEntry } from "../lib/db/journal";
import { insulinModeUsesInsulin } from "../lib/insulinMode";
import { applyGlucoseCorrection } from "../lib/services/glucoseEdit";
import { formatDate, formatDateKey, formatWeekday, relativeDay } from "../lib/format";
import {
  JOURNAL_LOAD_STEP,
  JOURNAL_PAGE_LIMITS,
  nextJournalCut,
} from "../lib/journalSlice";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { logCrash, logEvent } from "../lib/analytics";
import { MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { AppBackground } from "../components/rich";
import { Button } from "../components/ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost } from "../components/Feedback";
import { JournalItem } from "../components/JournalItem";
import { GlucoseInputSheet } from "../components/GlucoseInputSheet";
import { useJournalRows } from "../components/useJournalRows";
import {
  JournalDayHeader,
  JournalDisclaimerNote,
  JournalEmptyFilter,
  JournalFilterChips,
  JournalPanelBottom,
  JournalPanelTop,
  journalPanelSide,
  type JournalFilter,
  type JournalSection,
} from "../components/JournalPanel";

const journalKey = (e: JournalEntry) => `${e.kind}-${e.id}`;

/**
 * The full journal: every record, paged, on its own screen.
 *
 * It exists because the dashboard's journal used to grow IN PLACE - a "show
 * more" button that kept extending a list inside a page that was already
 * scrolling, which is the nested-scroll trap. The dashboard now shows a short
 * preview (see JOURNAL_PREVIEW_LIMITS) and hands off here, where paging has a
 * screen of its own to happen on.
 *
 * Everything a row can do is the SAME code the dashboard runs: the chrome comes
 * from components/JournalPanel.tsx and the interactions from
 * components/useJournalRows.tsx, so an edit, a long press or a delete-undo
 * cannot behave differently depending on which screen the row was tapped on.
 */
function JournalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { columnPad } = useLayout();
  const { activeProfile, lang, dataVersion, bumpData } = useApp();
  // The dashboard carries its active filter over, so tapping through from a
  // filtered preview does not silently widen back to everything.
  const params = useLocalSearchParams<{ filter?: string }>();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadLimit, setLoadLimit] = useState(300);
  const [pages, setPages] = useState(1);
  const [filter, setFilter] = useState<JournalFilter>(() =>
    params.filter === "glucose" ||
    params.filter === "meal" ||
    params.filter === "injection" ||
    params.filter === "med"
      ? params.filter
      : "all"
  );

  // Edit state for a glucose row. Owned here rather than by useJournalRows
  // because the dashboard drives the same sheet from its own logging flow too;
  // what the two SHARE is the correction itself (applyGlucoseCorrection).
  const [editGlucose, setEditGlucose] = useState<GlucoseEntry | null>(null);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    try {
      // Same feed the dashboard's list reads: the calculator's own bolus row is
      // filtered out, so a meal and its dose are one entry rather than two.
      setEntries(
        await getJournal(activeProfile.id, lang, loadLimit, undefined, {
          excludeCalculatorInjections: true,
        })
      );
    } catch (err) {
      logCrash(err, { screen: "journal", load: "feed" });
    } finally {
      setLoaded(true);
    }
  }, [activeProfile, lang, loadLimit]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const rows = useJournalRows({
    entries,
    onChanged: bumpData,
    onEditGlucose: setEditGlucose,
  });

  const chips = useMemo(
    () => [
      { key: "all" as const, label: t("dashboard.filterAll") },
      { key: "glucose" as const, label: t("dashboard.quickAddGlucose") },
      { key: "meal" as const, label: t("dashboard.quickAddFood") },
      ...(insulinModeUsesInsulin(activeProfile?.insulin_mode)
        ? [{ key: "injection" as const, label: t("dashboard.quickAddInjection") }]
        : []),
      ...(activeProfile?.oral_meds_enabled === 1 || entries.some((e) => e.kind === "med")
        ? [{ key: "med" as const, label: t("meds.entryLabel") }]
        : []),
    ],
    [t, activeProfile?.insulin_mode, activeProfile?.oral_meds_enabled, entries]
  );

  const { filteredEntries, displayEntries, sections } = useMemo(() => {
    const filtered =
      filter === "all" ? entries : entries.filter((e) => e.kind === filter);
    let cut = 0;
    for (let p = 0; p < pages; p++) cut = nextJournalCut(filtered, cut, JOURNAL_PAGE_LIMITS);
    const display = filtered.slice(0, cut);
    const built: JournalSection[] = [];
    const byKey = new Map<string, JournalEntry[]>();
    for (const e of display) {
      const key = formatDateKey(e.logged_at);
      let arr = byKey.get(key);
      if (!arr) {
        arr = [];
        byKey.set(key, arr);
        const rel = relativeDay(e.logged_at, {
          today: t("common.today"),
          yesterday: t("common.yesterday"),
        });
        const date = formatDate(e.logged_at);
        built.push({
          title: rel !== date ? rel : formatWeekday(e.logged_at) || date,
          dateLabel: date,
          data: arr,
        });
      }
      arr.push(e);
    }
    return { filteredEntries: filtered, displayEntries: display, sections: built };
  }, [entries, filter, pages, t]);

  // Offered while the loaded feed still has rows to reveal, or while the SQL
  // window came back full (so the DB may hold older records). Both false = the
  // journal really is at its end and the button goes away.
  const canShowMore =
    displayEntries.length < filteredEntries.length || entries.length >= loadLimit;

  function showMore() {
    hapticSelect();
    if (displayEntries.length < filteredEntries.length) {
      setPages((p) => p + 1);
    } else if (entries.length >= loadLimit) {
      // Loaded window exhausted and the query filled it: widen the window once
      // and advance with it. When the DB is drained the length check stops this.
      setLoadLimit((l) => l + JOURNAL_LOAD_STEP);
      setPages((p) => p + 1);
    }
  }

  const renderItem = useCallback(
    ({ item, index }: { item: JournalEntry; index: number }) =>
      activeProfile ? (
        <View style={journalPanelSide}>
          <JournalItem
            entry={item}
            profile={activeProfile}
            onPress={rows.onRowPress}
            onLongPress={rows.onRowLongPress}
            onDelete={rows.onRowDelete}
            hasResponse={item.kind === "meal" && rows.mealResponseIds.has(item.id)}
            onOpenResponse={rows.onRowOpenResponse}
            inPanel
            firstInPanel={index === 0}
          />
        </View>
      ) : null,
    [
      activeProfile,
      rows.mealResponseIds,
      rows.onRowPress,
      rows.onRowLongPress,
      rows.onRowDelete,
      rows.onRowOpenResponse,
    ]
  );

  async function submitGlucoseEdit(
    value: number,
    period: Parameters<typeof applyGlucoseCorrection>[2],
    tags: Parameters<typeof applyGlucoseCorrection>[3],
    loggedAt: Date | null
  ) {
    const target = editGlucose;
    setEditGlucose(null);
    if (!target) return;
    await applyGlucoseCorrection(target, value, period, tags, loggedAt);
    logEvent("log_edited", { kind: "glucose" });
    hapticSuccess();
    bumpData();
  }

  return (
    <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
      <ScreenHeader title={t("journal.title")} onBack={() => router.back()} />

      <SectionList
        sections={sections}
        keyExtractor={journalKey}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => <JournalDayHeader section={section} />}
        renderItem={renderItem}
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={9}
        ListHeaderComponent={
          entries.length > 0 ? (
            <JournalPanelTop title={t("dashboard.history")}>
              <JournalFilterChips
                chips={chips}
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setPages(1);
                }}
              />
            </JournalPanelTop>
          ) : null
        }
        // Only the FILTER can empty this screen: its single entry point is the
        // dashboard's "see the full journal" action, which is itself only drawn
        // once records exist. An entirely empty feed therefore draws nothing
        // rather than inventing a first-run message that belongs on the
        // dashboard.
        ListEmptyComponent={
          loaded && entries.length > 0 ? (
            <JournalEmptyFilter
              onClearFilter={() => {
                setFilter("all");
                setPages(1);
              }}
            />
          ) : null
        }
        ListFooterComponent={
          entries.length > 0 ? (
            <View>
              <JournalPanelBottom>
                {canShowMore ? (
                  <Button
                    label={t("journal.showMore")}
                    variant="secondary"
                    onPress={showMore}
                    className="border border-hair"
                    icon={<Ionicons name="chevron-down" size={16} color={THEME.ink} />}
                  />
                ) : null}
              </JournalPanelBottom>
              <JournalDisclaimerNote />
            </View>
          ) : null
        }
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: insets.bottom + 24,
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      />

      <GlucoseInputSheet
        visible={editGlucose != null}
        unit={activeProfile?.glucose_unit ?? "mgdl"}
        profile={activeProfile ?? undefined}
        edit={editGlucose}
        onClose={() => setEditGlucose(null)}
        onSubmit={submitGlucoseEdit}
        onDelete={() => {
          // The sheet's own confirm already ran before this fires.
          const target = editGlucose;
          setEditGlucose(null);
          if (target) void rows.deleteEntry(target);
        }}
      />
      {rows.sheets}
      <FeedbackHost />
    </AppBackground>
  );
}

export default function JournalRoute() {
  return (
    <SafeAreaProvider>
      <JournalScreen />
    </SafeAreaProvider>
  );
}
