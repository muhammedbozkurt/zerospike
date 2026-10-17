import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";

import { THEME, RADIUS } from "../lib/theme/tokens";
import { SCRIM } from "./SheetShell";
import { formatDate } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { ActionRow } from "./form";

/** Widest the sheet gets on a tablet before it stops stretching and centres
 *  (same cap as components/GlucoseInputSheet.tsx's SHEET_MAX_WIDTH). */
const SHEET_MAX_WIDTH = 600;

export interface PickedRange {
  start: number;
  end: number;
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

/**
 * A start-to-end date range picker (whole days) bounded to [minDate, maxDate].
 * Used for the custom report/export window. Rendered from a tab (Settings), so a
 * plain RN Modal is fine here.
 */
export function DateRangePicker({
  visible,
  minDate,
  maxDate,
  initialStart,
  initialEnd,
  locale,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  minDate: Date;
  maxDate: Date;
  initialStart: Date;
  initialEnd: Date;
  locale?: string;
  onCancel: () => void;
  onConfirm: (range: PickedRange) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isWide } = useLayout();
  const [start, setStart] = useState<Date>(initialStart);
  const [end, setEnd] = useState<Date>(initialEnd);
  const [open, setOpen] = useState<"start" | "end" | null>(null);

  useEffect(() => {
    if (visible) {
      setStart(initialStart);
      setEnd(initialEnd);
      setOpen(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const valid = startOfDay(start) <= startOfDay(end);

  // Shares form.tsx's ActionRow instead of hand-drawing icon+label+value again,
  // so a date row sits at the same height/rhythm as every other row in the app.
  const row = (
    key: "start" | "end",
    label: string,
    value: Date,
  ) => (
    <View className="rounded-xl bg-glass border border-hair overflow-hidden mb-2">
      <ActionRow
        icon="calendar-outline"
        label={label}
        value={formatDate(value.toISOString())}
        onPress={() => {
          hapticSelect();
          setOpen((o) => (o === key ? null : key));
        }}
        last
      />
    </View>
  );

  const picker = (key: "start" | "end", value: Date) => (
    <DateTimePicker
      value={value}
      mode="date"
      display={Platform.OS === "ios" ? "spinner" : "default"}
      minimumDate={minDate}
      maximumDate={maxDate}
      locale={locale}
      themeVariant="dark"
      onChange={(e: DateTimePickerEvent, date?: Date) => {
        if (Platform.OS === "android") setOpen(null);
        if (e.type === "dismissed" || !date) return;
        if (key === "start") {
          setStart(date);
          if (startOfDay(date) > startOfDay(end)) setEnd(date);
        } else {
          setEnd(date);
          if (startOfDay(date) < startOfDay(start)) setStart(date);
        }
      }}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}
        onPress={onCancel}
        accessible={false}
        focusable={false}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          accessible={false}
          focusable={false}
          importantForAccessibility="auto"
          style={[
            {
              borderTopLeftRadius: RADIUS["2xl"],
              borderTopRightRadius: RADIUS["2xl"],
              borderTopWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.bg.g1,
              paddingHorizontal: 18,
              paddingTop: 8,
              paddingBottom: insets.bottom + 20,
            },
            isWide ? { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center" } : undefined,
          ]}
        >
          <View className="items-center mb-1.5">
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: THEME.border }} />
          </View>
          <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 12 }}>
            {t("report.rangeTitle")}
          </Text>

          {row("start", t("report.rangeStart"), start)}
          {open === "start" ? picker("start", start) : null}
          {row("end", t("report.rangeEnd"), end)}
          {open === "end" ? picker("end", end) : null}

          <Pressable
            onPress={() => onConfirm({ start: startOfDay(start), end: endOfDay(end) })}
            disabled={!valid}
            accessibilityRole="button"
            className="rounded-2xl mt-3 py-3.5 items-center"
            style={{ backgroundColor: THEME.accent, opacity: valid ? 1 : 0.4 }}
          >
            <Text style={{ color: THEME.accentOnFill, fontWeight: "800" }}>{t("common.confirm")}</Text>
          </Pressable>
          <Pressable onPress={onCancel} className="py-3 items-center mt-1" accessibilityRole="button">
            <Text style={{ color: THEME.textMuted, fontWeight: "600" }}>{t("common.cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
