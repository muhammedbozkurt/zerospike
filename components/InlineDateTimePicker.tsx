import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";

import { Button } from "./ui";
import { SPACE, THEME } from "../lib/theme/tokens";

/**
 * Cross-platform date + time picker for a log's recorded moment, following the
 * InlineTimePicker pattern (see that file for why iOS needs the Done button).
 * - Android: two native dialogs in sequence (date, then time); each dismisses
 *   itself. They follow the system language: `locale` is iOS-only, so the app
 *   language cannot be forced here (do not report this as a bug).
 * - iOS: a single inline datetime spinner in the app language.
 * Times after `max` are not selectable; an Android time-of-day pick that lands
 * past `max` (today + a late hour) is clamped back to `max`.
 */
export function InlineDateTimePicker({
  visible,
  value,
  max,
  locale,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: Date;
  /** Latest selectable moment (usually "now"). */
  max: Date;
  /** Spinner language, iOS-only. */
  locale?: string;
  onChange: (d: Date) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [androidStep, setAndroidStep] = useState<"date" | "time">("date");
  const [draft, setDraft] = useState<Date>(value);

  // Each open restarts the Android two-step flow from the date dialog.
  useEffect(() => {
    if (visible) {
      setAndroidStep("date");
      setDraft(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const clamp = (d: Date) => (d.getTime() > max.getTime() ? new Date(max) : d);

  if (Platform.OS === "android") {
    if (androidStep === "date") {
      return (
        <DateTimePicker
          value={draft}
          mode="date"
          display="default"
          maximumDate={max}
          onChange={(e: DateTimePickerEvent, date?: Date) => {
            if (e.type === "dismissed" || !date) {
              onClose();
              return;
            }
            const next = new Date(draft);
            next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
            setDraft(next);
            setAndroidStep("time");
          }}
        />
      );
    }
    return (
      <DateTimePicker
        value={draft}
        mode="time"
        is24Hour
        display="default"
        onChange={(e: DateTimePickerEvent, date?: Date) => {
          onClose();
          if (e.type === "dismissed" || !date) return;
          const next = new Date(draft);
          next.setHours(date.getHours(), date.getMinutes(), 0, 0);
          onChange(clamp(next));
        }}
      />
    );
  }

  return (
    <View className="rounded-2xl bg-glass border border-hair mb-4 overflow-hidden">
      <View
        className="flex-row items-center justify-end border-b border-hair"
        style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}
      >
        <Button label={t("common.done")} size="sm" minHit onPress={onClose} />
      </View>
      <DateTimePicker
        value={value}
        mode="datetime"
        display="spinner"
        maximumDate={max}
        locale={locale}
        onChange={(_e: DateTimePickerEvent, date?: Date) => {
          if (date) onChange(clamp(date));
        }}
        themeVariant={THEME.scheme}
      />
    </View>
  );
}
