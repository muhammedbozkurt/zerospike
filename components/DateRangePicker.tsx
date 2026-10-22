import React, { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";

import { THEME, RADIUS, SPACE } from "../lib/theme/tokens";
import { SCRIM } from "./SheetShell";
import { formatDate } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { sheetBoxStyle } from "../lib/tabletLayout";
import { ActionRow } from "./form";
import { Button, Txt } from "./ui";


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
  const { isWide, width: layoutWidth, height: layoutHeight } = useLayout();
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
    <View className="rounded-2xl bg-glass border border-hair overflow-hidden mb-2">
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
        accessibilityViewIsModal
        onAccessibilityEscape={onCancel}
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
              paddingHorizontal: SPACE.lg,
              paddingTop: SPACE.sm,
              paddingBottom: insets.bottom + SPACE.xl,
            },
            sheetBoxStyle(layoutWidth, isWide, layoutHeight),
          ]}
        >
          <View className="items-center" style={{ marginBottom: SPACE.sm }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: THEME.border }} />
          </View>
          <Txt kind="subtitle" accessibilityRole="header" style={{ textAlign: "center", marginBottom: SPACE.md }}>
            {t("report.rangeTitle")}
          </Txt>

          {row("start", t("report.rangeStart"), start)}
          {open === "start" ? picker("start", start) : null}
          {row("end", t("report.rangeEnd"), end)}
          {open === "end" ? picker("end", end) : null}

          <View style={{ marginTop: SPACE.md }}>
            <Button
              label={t("common.confirm")}
              size="lg"
              disabled={!valid}
              onPress={() => onConfirm({ start: startOfDay(start), end: endOfDay(end) })}
            />
          </View>
          <View style={{ marginTop: SPACE.xs }}>
            <Button label={t("common.cancel")} variant="tertiary" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
