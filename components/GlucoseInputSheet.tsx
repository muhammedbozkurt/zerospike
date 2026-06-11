import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import type { PeriodTag } from "../lib/db/types";
import { Button, Segmented } from "./ui";

const PERIODS: PeriodTag[] = [
  "fasting",
  "pre_meal",
  "post_meal_2h",
  "bedtime",
  "manual",
];

interface Props {
  visible: boolean;
  initialPeriod?: PeriodTag;
  onClose: () => void;
  onSubmit: (value: number, period: PeriodTag) => void;
}

export function GlucoseInputSheet({
  visible,
  initialPeriod = "fasting",
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<PeriodTag>(initialPeriod);

  useEffect(() => {
    if (visible) {
      setValue("");
      setPeriod(initialPeriod);
    }
  }, [visible, initialPeriod]);

  function submit() {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num) || num <= 0 || num > 900) return;
    onSubmit(num, period);
  }

  const valid = (() => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 && n <= 900;
  })();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable className="flex-1 bg-black/70 justify-end" onPress={onClose}>
          <Pressable
            className="rounded-t-3xl bg-zinc-950 border-t border-x border-zinc-800 px-5 pt-4 pb-8"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-3">
              <View className="w-10 h-1 rounded-full bg-zinc-700" />
            </View>
            <Text className="text-zinc-50 text-xl font-bold mb-4">
              {t("dashboard.logGlucose")}
            </Text>

            <Text className="text-sm font-medium text-zinc-400 mb-2">
              {t("dashboard.selectPeriod")}
            </Text>
            <Segmented
              options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
              value={period}
              onChange={setPeriod}
              className="mb-5"
            />

            <View className="flex-row items-end justify-center mb-6">
              <TextInput
                value={value}
                onChangeText={(s) => setValue(s.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                autoFocus
                placeholder="110"
                placeholderTextColor="#3f3f46"
                className="text-6xl font-bold text-zinc-50 text-center min-w-[120px]"
                maxLength={3}
              />
              <Text className="text-zinc-500 text-lg mb-3 ml-2">
                {t("common.mgdl")}
              </Text>
            </View>

            <Button
              label={t("common.save")}
              size="lg"
              disabled={!valid}
              onPress={submit}
            />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
