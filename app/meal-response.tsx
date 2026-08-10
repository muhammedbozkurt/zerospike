import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { getFood } from "../lib/db/foods";
import {
  getMealLog,
  getMealResponseHistory,
  listSugarLogsForWindows,
  type SugarWindow,
} from "../lib/db/logs";
import type { Food, MealLog, MealSlot } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import {
  BASELINE_LOOKBACK_MINUTES,
  computeMealResponse,
  MEAL_RESPONSE_HOURS,
  type MealResponse,
} from "../lib/mealResponse";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { formatTime, num, relativeDay } from "../lib/format";
import { mealSlotForHour } from "../lib/insulin";
import { ScreenHeader } from "../components/ScreenHeader";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { EMOJI_RENDERS, FoodPlate } from "../components/FoodPlate";
import { AppBackground, GlassCard, GradientAreaChart, IconTile } from "../components/rich";
import { GLUCOSE_RICH, HIT_TARGET, TABULAR, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { upper } from "../lib/upper";

/** Illustrated plate per meal slot, matching the food tab's journal rows. */
const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍲",
};

/** The glyph behind each slot plate when its emoji cannot be drawn. */
const SLOT_ICON: Record<MealSlot, keyof typeof Ionicons.glyphMap> = {
  breakfast: "sunny-outline",
  lunch: "partly-sunny-outline",
  dinner: "moon-outline",
};

interface HistoryRow {
  meal: MealLog;
  response: MealResponse | null;
}

/**
 * Every reading a meal's response can draw from: the baseline lookback before it
 * through the end of the tracked window. Mirrors exactly what
 * computeMealResponse filters for, so narrowing the query cannot change a curve.
 */
function mealReadingWindow(meal: Pick<MealLog, "logged_at">): SugarWindow {
  const start = new Date(meal.logged_at).getTime();
  return {
    from: new Date(start - BASELINE_LOOKBACK_MINUTES * 60_000).toISOString(),
    to: new Date(start + MEAL_RESPONSE_HOURS * 3_600_000).toISOString(),
  };
}

/** A StatCard-shaped placeholder: same container (rounded-2xl p-4, glass fill
 *  + hairline border) and label row as the real chip, so the strip never
 *  resizes when the real figure replaces the skeleton bar. */
function ChipSkeleton({ label }: { label: string }) {
  return (
    <View
      className="rounded-2xl p-4"
      style={{ flex: 1, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.border }}
    >
      <View className="flex-row items-center mb-1">
        <Text
          className="text-[11px] font-semibold tracking-wider text-mut"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {upper(label)}
        </Text>
      </View>
      <View className="flex-row items-end">
        <Skeleton width={48} height={28} radius={6} />
      </View>
    </View>
  );
}

/**
 * Loading placeholder for the report: the same card shells (GlassCard, the
 * chip strip) and every STATIC label (curve title, axis ticks, chip
 * captions) shown for real - only the data-derived parts (the mini curve,
 * the four figures) are skeletonised - so the swap to the real report lands
 * on the same card heights instead of resizing the page under the user.
 * `isWide` is layout, not data, so the chip row chunking (2 vs 4 per row)
 * already matches the real strip before anything has loaded.
 */
function MealResponseSkeleton({ isWide }: { isWide: boolean }) {
  const { t } = useTranslation();
  const chipLabels = [
    t("mealResponse.start"),
    t("mealResponse.peak"),
    t("mealResponse.twoHour"),
    t("mealResponse.delta"),
  ];
  const perRow = isWide ? 4 : 2;
  const rows: string[][] = [];
  for (let i = 0; i < chipLabels.length; i += perRow) rows.push(chipLabels.slice(i, i + perRow));

  return (
    <>
      {/* Meal summary */}
      <View className="flex-row items-center mb-5">
        <Skeleton width={46} height={46} radius={15} style={{ marginRight: 12 }} />
        <View className="flex-1">
          <Skeleton width="60%" height={19} />
          <View style={{ marginTop: 6 }}>
            <Skeleton width="45%" height={12} />
          </View>
        </View>
      </View>

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
        <Skeleton height={100} radius={12} />
        <View className="flex-row justify-between mt-1">
          {["0", "1", "2", "3"].map((h) => (
            <Text key={h} style={{ color: THEME.muted, fontSize: 10 }}>
              {h}
            </Text>
          ))}
        </View>
      </GlassCard>

      {/* Stat chips: start · peak · +2h · delta */}
      {rows.map((row, rowIndex) => (
        <View
          key={rowIndex}
          className="flex-row"
          style={{ gap: 8, marginTop: rowIndex === 0 ? 0 : 8 }}
        >
          {row.map((label) => (
            <ChipSkeleton key={label} label={label} />
          ))}
        </View>
      ))}
    </>
  );
}

/**
 * Read-only view of a single meal's glucose response over the following
 * MEAL_RESPONSE_HOURS: a mini curve, four descriptive stat chips, and (Pro) a
 * comparison against the last few times the same meal was logged. Reports what
 * was measured, never a judgement, never a dose.
 */
export default function MealResponseScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mealId } = useLocalSearchParams<{ mealId?: string }>();
  const { activeProfile, isProUser, lang } = useApp();
  const { isWide, contentColumn } = useLayout();

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
      const [f, pastMeals] = await Promise.all([
        m.food_id ? getFood(m.food_id) : Promise.resolve(null),
        getMealResponseHistory(activeProfile.id, m, 5),
      ]);
      if (!alive) return;
      // This screen looks at a three-hour span around each of at most six meals,
      // and used to get there by reading the newest 2000 readings - a query whose
      // cost grew with the profile's entire history instead of with the six spans
      // actually being asked about. The windows go into SQL instead; the linked
      // baseline readings are fetched by id alongside, since one can legitimately
      // sit outside its meal's lookback.
      const meals = [m, ...pastMeals];
      const readings = await listSugarLogsForWindows(
        activeProfile.id,
        meals.map(mealReadingWindow),
        meals
          .map((x) => x.sugar_log_id)
          .filter((id): id is string => id != null)
      );
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
  // A catalogue meal wears its food's plate; a typed-name meal wears its slot's.
  // Both carry an Ionicons fallback, so the header is never a blank square.
  const heroSlot = meal
    ? mealSlotForHour(new Date(meal.logged_at).getHours())
    : null;

  // The four descriptive figures, chunked into rows: the phone keeps its 2x2
  // block, a tablet lays them out in one line instead of stretching two.
  const chipRows: { key: string; label: string; display: string; suffix?: string }[][] =
    (() => {
      if (!response) return [];
      const chips = [
        {
          key: "start",
          label: t("mealResponse.start"),
          display: fmt(response.baseline),
          suffix: response.baseline != null ? u : undefined,
        },
        {
          key: "peak",
          label: t("mealResponse.peak"),
          display: fmt(response.peak),
          suffix: u,
        },
        {
          key: "twoHour",
          label: t("mealResponse.twoHour"),
          display: fmt(response.twoHourValue),
          suffix: response.twoHourValue != null ? u : undefined,
        },
        {
          key: "delta",
          label: t("mealResponse.delta"),
          display: fmtDelta(response.delta),
          suffix: response.delta != null ? u : undefined,
        },
      ];
      const perRow = isWide ? 4 : 2;
      const rows: (typeof chips)[] = [];
      for (let i = 0; i < chips.length; i += perRow) rows.push(chips.slice(i, i + perRow));
      return rows;
    })();

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
      <View style={contentColumn}>
        <ScreenHeader title={t("mealResponse.title")} onBack={() => router.back()} />
      </View>

      {loading ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[{ padding: 16 }, contentColumn]}>
            <MealResponseSkeleton isWide={isWide} />
          </View>
        </ScrollView>
      ) : !meal ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ color: THEME.muted, textAlign: "center" }}>
            {t("mealResponse.notFound")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[{ padding: 16 }, contentColumn]}>
            {/* Meal summary */}
            <View className="flex-row items-center mb-5">
              {food ? (
                <FoodPlate
                  category={food.category}
                  size={46}
                  radius={15}
                  style={{ marginRight: 12 }}
                />
              ) : (
                <IconTile
                  emoji={EMOJI_RENDERS ? (heroSlot ? SLOT_EMOJI[heroSlot] : "🍽️") : undefined}
                  icon={heroSlot ? SLOT_ICON[heroSlot] : "restaurant-outline"}
                  size={46}
                  radius={15}
                  hero
                  style={{ marginRight: 12 }}
                />
              )}
              <View className="flex-1">
                <Text style={{ color: THEME.ink, fontSize: 17, fontWeight: "800" }} numberOfLines={2}>
                  {displayName}
                </Text>
                <Text style={[TABULAR, { color: THEME.muted, fontSize: 12, marginTop: 3 }]}>
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

                {/* Stat chips: start · peak · +2h · delta. Two per row on a phone,
                    one row of four once there is width for it. */}
                {chipRows.map((row, rowIndex) => (
                  <View
                    key={row.map((chip) => chip.key).join("-")}
                    className="flex-row"
                    style={{ gap: 8, marginTop: rowIndex === 0 ? 0 : 8 }}
                  >
                    {row.map((chip) => (
                      <StatCard
                        key={chip.key}
                        glass
                        label={chip.label}
                        display={chip.display}
                        suffix={chip.suffix}
                        style={{ flex: 1 }}
                      />
                    ))}
                  </View>
                ))}

                {/* Previous attempts: Pro comparison list */}
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
                              minHeight: 34,
                              paddingVertical: 8,
                              borderTopWidth: i === 0 ? 0 : 1,
                              borderTopColor: THEME.border,
                            }}
                          >
                            <Text
                              style={{ color: THEME.muted, fontSize: 11, width: 88 }}
                              numberOfLines={1}
                            >
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
                              numberOfLines={1}
                              style={[
                                TABULAR,
                                { color: THEME.ink, fontSize: 11, fontWeight: "700", width: 64, textAlign: "right" },
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
                        accessibilityRole="button"
                        accessibilityLabel={t("mealResponse.previousTitle")}
                        className="rounded-2xl bg-glass border border-hair p-4 flex-row items-center active:opacity-80"
                        style={{ minHeight: HIT_TARGET + 20 }}
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
          </View>
        </ScrollView>
      )}
    </AppBackground>
  );
}
