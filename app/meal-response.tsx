import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { getFood } from "../lib/db/foods";
import { getMealLog, getMealResponseHistory, listSugarLogs } from "../lib/db/logs";
import type { Food, MealLog } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { computeMealResponse, type MealResponse } from "../lib/mealResponse";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { formatTime, num, relativeDay } from "../lib/format";
import { mealSlotForHour } from "../lib/insulin";
import { ScreenHeader } from "../components/ScreenHeader";
import { StatCard } from "../components/StatCard";
import { AppBackground, GlassCard, GradientAreaChart, IconTile } from "../components/rich";
import { GLUCOSE_RICH, TABULAR, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

/** Illustrated plate per meal slot, matching the food tab's journal rows. */
const SLOT_EMOJI = { breakfast: "🍳", lunch: "🥗", dinner: "🍲" } as const;

interface HistoryRow {
  meal: MealLog;
  response: MealResponse | null;
}

/**
 * Read-only view of a single meal's glucose response over the following
 * MEAL_RESPONSE_HOURS: a mini curve, four descriptive stat chips, and (Pro) a
 * comparison against the last few times the same meal was logged. Reports what
 * was measured — never a judgement, never a dose.
 */
export default function MealResponseScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mealId } = useLocalSearchParams<{ mealId?: string }>();
  const { activeProfile, isProUser, lang } = useApp();

  const [loading, setLoading] = useState(true);
  const [meal, setMeal] = useState<MealLog | null>(null);
  const [food, setFood] = useState<Food | null>(null);
  const [response, setResponse] = useState<MealResponse | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!mealId || !activeProfile) {
        setLoading(false);
        return;
      }
      const m = await getMealLog(mealId);
      if (!alive || !m) {
        setLoading(false);
        return;
      }
      const [f, readings, pastMeals] = await Promise.all([
        m.food_id ? getFood(m.food_id) : Promise.resolve(null),
        listSugarLogs(activeProfile.id, 2000),
        getMealResponseHistory(activeProfile.id, m, 5),
      ]);
      if (!alive) return;
      setMeal(m);
      setFood(f);
      setResponse(computeMealResponse(m, readings, activeProfile));
      setHistory(
        pastMeals.map((pm) => ({
          meal: pm,
          response: computeMealResponse(pm, readings, activeProfile),
        }))
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [mealId, activeProfile]);

  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const u = glucoseUnitLabel(unit);
  const fmt = (mgdl: number | null) => (mgdl == null ? "-" : formatGlucose(mgdl, unit));
  const fmtDelta = (delta: number | null) =>
    delta == null ? "-" : `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${formatGlucose(Math.abs(delta), unit)}`;

  const displayName = meal
    ? meal.custom_food_name?.trim() || (food ? foodName(food, lang) : "-")
    : "-";
  const heroEmoji = food
    ? "🍽️"
    : meal
      ? SLOT_EMOJI[mealSlotForHour(new Date(meal.logged_at).getHours())]
      : "🍽️";

  const maxTwoHour = useMemo(
    () =>
      Math.max(
        60,
        ...history.map((h) => h.response?.twoHourValue ?? 0).filter((v) => v > 0)
      ),
    [history]
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <ScreenHeader title={t("mealResponse.title")} onBack={() => router.back()} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: THEME.muted }}>{t("common.loading")}</Text>
        </View>
      ) : !meal ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ color: THEME.muted, textAlign: "center" }}>
            {t("mealResponse.notFound")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Meal summary */}
          <View className="flex-row items-center mb-4">
            <IconTile emoji={heroEmoji} size={44} radius={14} hero style={{ marginRight: 12 }} />
            <View className="flex-1">
              <Text style={{ color: THEME.ink, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 2 }}>
                {Math.round(meal.calculated_carbs_g)} {t("common.grams")} ·{" "}
                {relativeDay(meal.logged_at, { today: t("common.today"), yesterday: t("common.yesterday") })}{" "}
                {formatTime(meal.logged_at)}
              </Text>
            </View>
          </View>

          {response ? (
            <>
              {/* Mini curve */}
              <GlassCard style={{ marginBottom: 12 }}>
                <Text
                  style={{
                    color: THEME.muted,
                    fontSize: 11,
                    letterSpacing: 1.3,
                    fontWeight: "800",
                    marginBottom: 8,
                  }}
                >
                  {upper(t("mealResponse.curveTitle"))}
                </Text>
                <GradientAreaChart
                  data={response.curve.map((p) => p.glucose_level_mgdl)}
                  height={100}
                  targetBand={
                    activeProfile
                      ? { min: activeProfile.target_postmeal_min, max: activeProfile.target_postmeal_max }
                      : undefined
                  }
                  style={{ alignSelf: "stretch", width: "100%" }}
                />
                <View className="flex-row justify-between mt-1">
                  {["0", "1", "2", "3"].map((h) => (
                    <Text key={h} style={{ color: THEME.muted, fontSize: 10 }}>
                      {h}
                    </Text>
                  ))}
                </View>
              </GlassCard>

              {/* Stat chips: start · peak · +2h · delta */}
              <View className="flex-row" style={{ gap: 8 }}>
                <StatCard
                  glass
                  label={t("mealResponse.start")}
                  display={fmt(response.baseline)}
                  suffix={response.baseline != null ? u : undefined}
                  style={{ flex: 1 }}
                />
                <StatCard
                  glass
                  label={t("mealResponse.peak")}
                  display={fmt(response.peak)}
                  suffix={u}
                  style={{ flex: 1 }}
                />
              </View>
              <View className="flex-row mt-2" style={{ gap: 8 }}>
                <StatCard
                  glass
                  label={t("mealResponse.twoHour")}
                  display={fmt(response.twoHourValue)}
                  suffix={response.twoHourValue != null ? u : undefined}
                  style={{ flex: 1 }}
                />
                <StatCard
                  glass
                  label={t("mealResponse.delta")}
                  display={fmtDelta(response.delta)}
                  suffix={response.delta != null ? u : undefined}
                  style={{ flex: 1 }}
                />
              </View>

              {/* Previous attempts — Pro comparison list */}
              {history.length > 0 ? (
                <>
                  <Text
                    style={{
                      color: THEME.muted,
                      fontSize: 11,
                      letterSpacing: 1.3,
                      fontWeight: "800",
                      marginTop: 20,
                      marginBottom: 8,
                      paddingHorizontal: 1,
                    }}
                  >
                    {upper(t("mealResponse.previousTitle"))}
                  </Text>
                  {isProUser ? (
                    <GlassCard>
                      {history.map((h, i) => (
                        <View
                          key={h.meal.id}
                          className="flex-row items-center"
                          style={{
                            paddingVertical: 8,
                            borderTopWidth: i === 0 ? 0 : 1,
                            borderTopColor: THEME.border,
                          }}
                        >
                          <Text style={{ color: THEME.muted, fontSize: 11, width: 78 }}>
                            {relativeDay(h.meal.logged_at, {
                              today: t("common.today"),
                              yesterday: t("common.yesterday"),
                            })}
                          </Text>
                          <View
                            className="flex-1 h-2 rounded-full overflow-hidden mr-2"
                            style={{ backgroundColor: THEME.track }}
                          >
                            {h.response?.twoHourValue != null ? (
                              <View
                                className="h-2 rounded-full"
                                style={{
                                  width: `${Math.min(100, (h.response.twoHourValue / maxTwoHour) * 100)}%`,
                                  backgroundColor: THEME.accent,
                                }}
                              />
                            ) : null}
                          </View>
                          <Text
                            style={[
                              TABULAR,
                              { color: THEME.ink, fontSize: 11, fontWeight: "700", width: 56, textAlign: "right" },
                            ]}
                          >
                            {fmtDelta(h.response?.delta ?? null)}
                          </Text>
                        </View>
                      ))}
                    </GlassCard>
                  ) : (
                    <Pressable
                      onPress={() => router.push({ pathname: "/paywall", params: { reason: "mealResponse" } })}
                      className="rounded-2xl bg-glass border border-hair p-4 flex-row items-center active:opacity-80"
                    >
                      <IconTile icon="lock-closed" size={36} radius={12} tint={THEME.muted} style={{ marginRight: 12 }} />
                      <View className="flex-1">
                        <Text style={{ color: THEME.ink, fontWeight: "700" }}>
                          {t("mealResponse.previousTitle")}
                        </Text>
                        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                          {t("paywall.limitTitleMealResponse")}
                        </Text>
                      </View>
                      <View className="rounded-full bg-brand px-2 py-0.5">
                        <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
                      </View>
                    </Pressable>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <View className="items-center py-10">
              <Ionicons name="pulse-outline" size={40} color={THEME.muted} />
              <Text style={{ color: THEME.ink, textAlign: "center", marginTop: 14, fontWeight: "700" }}>
                {t("mealResponse.emptyTitle")}
              </Text>
              <Text
                style={{
                  color: THEME.muted,
                  textAlign: "center",
                  marginTop: 8,
                  lineHeight: 18,
                  paddingHorizontal: 12,
                }}
              >
                {t("mealResponse.emptyBody")}
              </Text>
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 11,
                  textAlign: "center",
                  marginTop: 10,
                  lineHeight: 16,
                  paddingHorizontal: 12,
                }}
              >
                {t("mealResponse.emptyReminderNote")}
              </Text>
            </View>
          )}

          <View
            className="flex-row items-start rounded-2xl bg-glass border border-hair p-3.5 mt-5"
            style={{ borderColor: GLUCOSE_RICH.high + "4d" }}
          >
            <Ionicons name="information-circle-outline" size={15} color={THEME.muted} />
            <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 17, marginLeft: 10, flex: 1 }}>
              {t("mealResponse.disclaimer")}
            </Text>
          </View>
        </ScrollView>
      )}
    </AppBackground>
  );
}
