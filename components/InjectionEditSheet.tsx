import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { InsulinPen } from "../lib/db/types";
import { updateInjection, getPen, type InjectionUpdate } from "../lib/db/injections";
import { maybeNotifyPenLow } from "../lib/services/notifications";
import { logEvent } from "../lib/analytics";
import { hapticSuccess, hapticSelect } from "../lib/haptics";
import { Button } from "./ui";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";

/** The stored injection being corrected (structurally matches Injection). */
export interface InjectionEditTarget {
  id: string;
  dose_units: number | null;
  pen_id: string | null;
  logged_at: string;
}

/**
 * Bottom sheet for correcting an injection's dose, time and pen. Pen stock
 * accounting (delta on the same pen, full refund/deduct on a pen change) lives
 * in updateInjection; this sheet only collects the new values.
 *
 * Rendered from tab screens (injection tab, dashboard journal), which are not
 * modal routes, so a plain RN Modal is fine here (gotcha 22 applies to the
 * calculator/add-food/scan modal screens only).
 */
export function InjectionEditSheet({
  visible,
  injection,
  pens,
  onClose,
  onSaved,
}: {
  visible: boolean;
  injection: InjectionEditTarget | null;
  /** Active pens offered in the picker. */
  pens: InsulinPen[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [dose, setDose] = useState("");
  const [penId, setPenId] = useState<string | null>(null);
  const [loggedAt, setLoggedAt] = useState<Date>(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && injection) {
      setDose(injection.dose_units != null ? num(injection.dose_units) : "");
      setPenId(injection.pen_id);
      setLoggedAt(new Date(injection.logged_at));
      setTimePickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, injection?.id]);

  async function save() {
    if (!injection || saving) return;
    setSaving(true);
    try {
      const doseNum = parseFloat(dose.replace(",", "."));
      const patch: InjectionUpdate = {
        dose_units: Number.isFinite(doseNum) && doseNum > 0 ? doseNum : null,
        logged_at: loggedAt.toISOString(),
      };
      // Touch the pen link only when the user actually changed it: the picker
      // lists active pens, so an untouched link to an archived pen must survive
      // (writing it back as null would wrongly refund that pen's stock).
      if (penId !== injection.pen_id) {
        const pen = penId ? pens.find((p) => p.id === penId) ?? null : null;
        patch.pen_id = pen ? pen.id : null;
        patch.insulin_type = pen ? pen.insulin_type : null;
      }
      await updateInjection(injection.id, patch);
      logEvent("log_edited", { kind: "insulin" });
      hapticSuccess();
      // The balance may have just crossed the low threshold; same nudge as create.
      if (penId) {
        const fresh = await getPen(penId);
        if (fresh) {
          await maybeNotifyPenLow({
            id: fresh.id,
            name: fresh.name,
            remaining_units: fresh.remaining_units,
          });
        }
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable className="flex-1 bg-black/70 justify-end" onPress={onClose}>
          <Pressable
            className="rounded-t-3xl bg-zinc-950 border-t border-x border-zinc-800 px-5 pt-3"
            style={{ maxHeight: "100%" }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-2 py-1">
              <View className="w-10 h-1 rounded-full bg-zinc-700" />
            </View>
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-zinc-50 text-xl font-bold">
                {t("calculator.editTitle")}
              </Text>
              <Pressable onPress={onClose} hitSlop={12} className="p-1">
                <Ionicons name="close" size={24} color="#71717a" />
              </Pressable>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
            >
              {/* Dose (optional, mirrors the injection tab's create form) */}
              <Text className="text-sm font-medium text-zinc-400 mb-1.5">
                {t("injection.dose")}
              </Text>
              <View className="flex-row items-center mb-4">
                <TextInput
                  value={dose}
                  onChangeText={(s) =>
                    setDose(s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1"))
                  }
                  keyboardType="decimal-pad"
                  placeholder="-"
                  placeholderTextColor="#52525b"
                  maxLength={5}
                  className="flex-1 rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50"
                />
                <Text className="text-zinc-500 ml-2">{t("common.units")}</Text>
              </View>

              {/* Pen picker */}
              <Text className="text-sm font-medium text-zinc-400 mb-1.5">
                {t("injection.selectPen")}
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                <Pressable
                  onPress={() => {
                    hapticSelect();
                    setPenId(null);
                  }}
                  className={`rounded-xl border px-3 py-2 ${
                    penId === null
                      ? "border-brand bg-brand/10"
                      : "border-zinc-700 bg-zinc-800/60"
                  }`}
                >
                  <Text className={penId === null ? "text-brand font-medium" : "text-zinc-300"}>
                    {t("injection.noPen")}
                  </Text>
                </Pressable>
                {pens.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      hapticSelect();
                      setPenId(p.id);
                    }}
                    className={`rounded-xl border px-3 py-2 ${
                      penId === p.id
                        ? "border-brand bg-brand/10"
                        : "border-zinc-700 bg-zinc-800/60"
                    }`}
                  >
                    <Text
                      className={penId === p.id ? "text-brand font-medium" : "text-zinc-300"}
                    >
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* When it was injected (date + time, never in the future) */}
              <Text className="text-sm font-medium text-zinc-400 mb-1.5">
                {t("calculator.loggedTime")}
              </Text>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setTimePickerOpen((v) => !v);
                }}
                className="flex-row items-center rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 mb-5"
              >
                <Ionicons name="time-outline" size={16} color="#a1a1aa" />
                <Text className="text-zinc-50 ml-2">
                  {relativeDay(loggedAt.toISOString(), {
                    today: t("common.today"),
                    yesterday: t("common.yesterday"),
                  })}
                  {" · "}
                  {formatTime(loggedAt.toISOString())}
                </Text>
              </Pressable>
              <InlineDateTimePicker
                visible={timePickerOpen}
                value={loggedAt}
                max={new Date()}
                locale={i18n.language}
                onChange={setLoggedAt}
                onClose={() => setTimePickerOpen(false)}
              />

              <Button
                label={t("common.save")}
                size="lg"
                loading={saving}
                onPress={save}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
