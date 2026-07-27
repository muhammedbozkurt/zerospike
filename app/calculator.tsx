import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { getFood } from "../lib/db/foods";
import {
  addMealLog,
  addSugarLog,
  deleteMealRecord,
  findMatchingSugarLog,
  getMealLog,
  getSugarLog,
  updateMealLog,
  updateSugarLog,
} from "../lib/db/logs";
import {
  deleteInjection,
  getCalculatorInjectionForMeal,
  logInjection,
  updateInjection,
} from "../lib/db/injections";
import { logEvent } from "../lib/analytics";
import { noteLogAndMaybeReview } from "../lib/services/review";
import {
  checkDose,
  estimateInsulin,
  activeMealSlot,
  type InsulinWarning,
} from "../lib/insulin";
import { activeInsulin } from "../lib/iob";
import { getInjections } from "../lib/db/injections";
import {
  classifyGlucose,
  formatGlucose,
  glucoseFromDisplay,
  glucoseToDisplay,
  glucoseUnitLabel,
  targetMidpoint,
  targetRangeFor,
} from "../lib/glucose";
import { insulinModeOf, insulinModeShowsBolus } from "../lib/insulinMode";
import { schedulePostMealReminder } from "../lib/services/notifications";
import { writeGlucoseToHealthIfEnabled } from "../lib/services/health";
import { foodSourceLabel } from "../lib/services/openFoodFacts";
import type { Food, LogTag, MealSlot } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { Segmented } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { Tooltip } from "../components/Tooltip";
import { TagPicker } from "../components/TagPicker";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { InlineDateTimePicker } from "../components/InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { hapticSuccess } from "../lib/haptics";
import {
  AppBackground,
  GlassCard,
  GlucoseChip,
  GradientCTA,
  IconTile,
  withAlpha,
} from "../components/rich";
import { GLUCOSE_RICH, RADIUS, RICH_BY_STATUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/** The site an auto-written mealtime bolus is filed under until the user edits
 *  it. The calculator never asks for a site, so it records the region the app
 *  already treats as the canonical first entry and leaves the rotation POINT
 *  unset - an unspecified point is honest, a guessed one would not be. */
const AUTO_BOLUS_SITE = "abdomen_left" as const;

/** Maps an estimate warning to its calculator i18n key. */
const WARN_KEY: Record<InsulinWarning, string> = {
  high_dose: "warnHighDose",
  carb_ratio_out_of_range: "warnRatio",
  isf_out_of_range: "warnIsf",
};

/** The mockup's B04 read-out card: a small caps label with a big figure beside it. */
function ReadoutCard({
  label,
  value,
  suffix,
  color,
  accessory,
  children,
}: {
  label: string;
  value: string;
  suffix?: string;
  color?: string;
  accessory?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <GlassCard style={{ marginBottom: 10 }}>
      <View className="flex-row items-center justify-between">
        <Text
          style={{
            color: THEME.muted,
            fontSize: 11,
            letterSpacing: 1.3,
            fontWeight: "800",
            flex: 1,
          }}
        >
          {upper(label)}
        </Text>
        <View className="flex-row items-baseline" style={{ gap: 4 }}>
          <Text
            style={[
              TABULAR,
              { color: color ?? THEME.ink, fontSize: 26, fontWeight: "800" },
            ]}
          >
            {value}
          </Text>
          {suffix ? (
            <Text style={{ color: THEME.muted, fontSize: 12 }}>{suffix}</Text>
          ) : null}
          {accessory}
        </View>
      </View>
      {children}
    </GlassCard>
  );
}

/** A neutral, non-blocking notice card (info tone, never an alarm). */
function NoticeCard({
  icon,
  tint,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title?: string;
  body: string;
}) {
  return (
    <View
      className="flex-row items-start rounded-2xl px-3.5 py-3 mb-3"
      style={{ borderWidth: 1, borderColor: withAlpha(tint, 0.3), backgroundColor: withAlpha(tint, 0.1) }}
    >
      <Ionicons name={icon} size={15} color={tint} style={{ marginTop: 1 }} />
      <View className="flex-1 ml-2.5">
        {title ? (
          <Text style={{ color: tint, fontSize: 12, fontWeight: "800", marginBottom: 2 }}>
            {title}
          </Text>
        ) : null}
        <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 17, opacity: 0.85 }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

/** A labelled detail row wrapper for the section below the hero. */
function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: THEME.muted,
        fontSize: 12,
        fontWeight: "700",
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

export default function CalculatorScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { foodId, portion: portionParam, mealLogId } = useLocalSearchParams<{
    foodId?: string;
    portion?: string;
    mealLogId?: string;
  }>();
  const { activeProfile, lang, bumpData, dataVersion } = useApp();
  const { actionSheet, confirm, toast } = useFeedback();

  const [food, setFood] = useState<Food | null>(null);
  const [portion, setPortion] = useState(100);
  const [slot, setSlot] = useState<MealSlot>(activeMealSlot());
  const [glucose, setGlucose] = useState("");
  const [doseText, setDoseText] = useState("");
  const [doseTouched, setDoseTouched] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [tags, setTags] = useState<LogTag[]>([]);
  const [iob, setIob] = useState(0);
  const [saving, setSaving] = useState(false);
  // null keeps the "log it as of now" default; a Date is an explicit user pick.
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // The reading an already-saved meal is attached to, so an edit updates that
  // row instead of silently leaving a stale value behind it.
  const [linkedSugarLogId, setLinkedSugarLogId] = useState<string | null>(null);

  const isEdit = typeof mealLogId === "string" && mealLogId.length > 0;

  // A user who told us they take no mealtime insulin gets a carb-only screen:
  // no dose estimate, no dose field, no injection written. Everything else on
  // this screen (portion, carbs, photo, note, tags) is unchanged.
  const insulinMode = insulinModeOf(activeProfile);
  const showsDose = insulinModeShowsBolus(insulinMode);

  useEffect(() => {
    (async () => {
      if (!foodId) return;
      const f = await getFood(foodId);
      if (f) {
        setFood(f);
        // Prefill the portion from a one-tap "recent meal" re-log, else default.
        const p = Number(portionParam);
        setPortion(Number.isFinite(p) && p > 0 ? p : f.portion_size_g || 100);
      }
    })();
  }, [foodId, portionParam]);

  // Edit mode: prefill every field from the stored log. doseTouched is set so
  // the estimate effect never overwrites the dose the user actually applied.
  useEffect(() => {
    (async () => {
      if (!isEdit || !mealLogId) return;
      const log = await getMealLog(mealLogId);
      if (!log) return;
      if (log.food_id) {
        const f = await getFood(log.food_id);
        if (f) setFood(f);
      }
      setPortion(log.portion_g);
      setDoseText(num(log.insulin_dose_units));
      setDoseTouched(true);
      setNote(log.personal_note ?? "");
      setPhoto(log.photo_uri_local);
      setTags(log.tags);
      setLoggedAt(new Date(log.logged_at));
      setLinkedSugarLogId(log.sugar_log_id);
      if (log.sugar_log_id) {
        const reading = await getSugarLog(log.sugar_log_id);
        if (reading) {
          setGlucose(
            String(
              glucoseToDisplay(
                reading.glucose_level_mgdl,
                activeProfile?.glucose_unit ?? "mgdl"
              )
            )
          );
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, mealLogId]);

  // Active insulin (IOB) from recent bolus doses, used to trim the correction
  // so a fresh dose doesn't stack on top of insulin that is still working.
  useEffect(() => {
    (async () => {
      if (!activeProfile) return;
      const injections = await getInjections(activeProfile.id, 100);
      setIob(activeInsulin(injections));
    })();
  }, [activeProfile, dataVersion]);

  const unit = activeProfile?.glucose_unit ?? "mgdl";

  const glucoseMgdl = useMemo(() => {
    const g = parseFloat(glucose.replace(",", "."));
    return Number.isFinite(g) && g > 0 ? glucoseFromDisplay(g, unit) : null;
  }, [glucose, unit]);

  const glucoseStatus =
    glucoseMgdl != null && activeProfile
      ? classifyGlucose(glucoseMgdl, "pre_meal", activeProfile)
      : null;

  // The correction aims at the MIDDLE of the post-meal range, and the screen
  // says so in words right under the number.
  const correctionTarget = activeProfile
    ? targetMidpoint(targetRangeFor("post_meal_2h", activeProfile))
    : null;

  const estimate = useMemo(() => {
    if (!food || !activeProfile) return null;
    return estimateInsulin(food, portion, activeProfile, {
      slot,
      currentGlucose: glucoseMgdl,
      currentIOB: iob,
    });
  }, [food, activeProfile, portion, slot, glucoseMgdl, iob]);

  // Keep the manual dose synced to the estimate until the user edits it.
  useEffect(() => {
    if (estimate && !doseTouched) setDoseText(num(estimate.totalDose));
  }, [estimate, doseTouched]);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });

    if (result.canceled || !result.assets?.[0]) return;
    const src = result.assets[0].uri;
    // Copy into the app sandbox for fully-offline persistence.
    try {
      const dest = `${FileSystem.documentDirectory}meal_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: src, to: dest });
      setPhoto(dest);
    } catch {
      setPhoto(src);
    }
  }

  function choosePhoto() {
    actionSheet({
      title: t("calculator.addPhoto"),
      actions: [
        {
          label: t("calculator.takePhoto"),
          icon: "camera-outline",
          onPress: () => pickPhoto(true),
        },
        {
          label: t("calculator.choosePhoto"),
          icon: "images-outline",
          onPress: () => pickPhoto(false),
        },
      ],
    });
  }

  /**
   * The same two-stage plausibility gate the Injection tab uses. It runs BEFORE
   * anything is written, because this screen creates a real injection row: a
   * dose that would need confirming when typed by hand must need confirming
   * here too. Declining cancels the whole record, not just the injection.
   */
  async function confirmDose(units: number): Promise<boolean> {
    const check = checkDose(units);
    if (check === "ok") return true;

    const first = await confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseCheckBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
    if (!first) return false;
    if (check === "high") return true;

    return confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseImplausibleBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
  }

  async function logMeal() {
    if (!food || !activeProfile || !estimate || saving) return;

    // Locked before the confirmation dialog, not after it: the CTA is disabled
    // while `saving`, and a second tap during the dialog would otherwise start a
    // parallel save.
    setSaving(true);
    try {
      const dose = showsDose
        ? parseFloat(doseText.replace(",", ".")) || estimate.totalDose
        : 0;
      // Gate first: nothing at all is written until an unusual dose is confirmed.
      if (dose > 0 && !(await confirmDose(dose))) return;

      const loggedIso = loggedAt ? loggedAt.toISOString() : undefined;
      const at = loggedAt ?? new Date();

      if (isEdit && mealLogId) {
        // Correcting an existing record: no post-meal reminder and no review
        // nudge, but every row this meal owns has to move with it. Leaving the
        // linked bolus at its old value would keep active insulin wrong for
        // hours, which is exactly the coupling the auto-write exists to fix.
        await updateMealLog(mealLogId, {
          portion_g: portion,
          calculated_carbs_g: estimate.carbs,
          insulin_dose_units: dose,
          photo_uri_local: photo,
          personal_note: note.trim() || null,
          tags,
          ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
        });

        const existingInjection = await getCalculatorInjectionForMeal(mealLogId);
        if (dose > 0) {
          if (existingInjection) {
            await updateInjection(existingInjection.id, {
              dose_units: dose,
              insulin_type: "bolus",
              tags,
              ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
            });
          } else {
            await logInjection({
              profile_id: activeProfile.id,
              site: AUTO_BOLUS_SITE,
              site_point: null,
              dose_units: dose,
              insulin_type: "bolus",
              meal_log_id: mealLogId,
              source: "calculator",
              tags,
              logged_at: loggedIso,
            });
          }
        } else if (existingInjection) {
          // The dose was cleared, so the injection it stood for is gone too.
          await deleteInjection(existingInjection.id);
        }

        // A corrected glucose value belongs on the reading this meal is already
        // attached to, not on a second row. Clearing the field leaves the
        // reading alone: a measurement is not deleted because a field went blank.
        if (linkedSugarLogId && glucoseMgdl != null) {
          await updateSugarLog(linkedSugarLogId, {
            glucose_level_mgdl: glucoseMgdl,
            ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
          });
        } else if (!linkedSugarLogId && glucoseMgdl != null) {
          // R10 1.3: the meal had no reading attached, but one was typed while
          // editing it — it was silently discarded before. Same dedup as a fresh
          // save (reuse a measurement logged minutes ago instead of doubling it),
          // then link the result so it stops disappearing on save.
          const existingReading = await findMatchingSugarLog(
            activeProfile.id,
            glucoseMgdl,
            at
          );
          let newSugarLogId: string;
          if (existingReading) {
            newSugarLogId = existingReading.id;
          } else {
            const sugar = await addSugarLog({
              profile_id: activeProfile.id,
              glucose_level_mgdl: glucoseMgdl,
              period_tag: "pre_meal",
              tags,
              logged_at: loggedIso,
            });
            void writeGlucoseToHealthIfEnabled(sugar);
            newSugarLogId = sugar.id;
          }
          await updateMealLog(mealLogId, { sugar_log_id: newSugarLogId });
        }

        logEvent("log_edited", { kind: "meal" });
        hapticSuccess();
        bumpData();
        router.back();
        return;
      }

      // The glucose typed here is a real reading the user took. Before v8 it was
      // used for the correction and then discarded (meal_logs.sugar_log_id was
      // always null), so it never appeared in the journal, the averages or the
      // export. Persist it and link it to the meal.
      //
      // But only if it is genuinely new: a user who logged this reading on the
      // dashboard a minute ago and then typed the same number here would
      // otherwise get two identical rows, double-counted in every average and in
      // the doctor's export. Same value within a few minutes = same measurement.
      let sugarLogId: string | null = null;
      let createdSugarLogId: string | null = null;
      if (glucoseMgdl != null) {
        const existingReading = await findMatchingSugarLog(
          activeProfile.id,
          glucoseMgdl,
          at
        );
        if (existingReading) {
          sugarLogId = existingReading.id;
        } else {
          const sugar = await addSugarLog({
            profile_id: activeProfile.id,
            glucose_level_mgdl: glucoseMgdl,
            period_tag: "pre_meal",
            tags,
            logged_at: loggedIso,
          });
          // Opt-in Apple Health mirror (H1); no-op unless the user enabled it.
          void writeGlucoseToHealthIfEnabled(sugar);
          sugarLogId = sugar.id;
          createdSugarLogId = sugar.id;
        }
      }

      const meal = await addMealLog({
        profile_id: activeProfile.id,
        food_id: food.id,
        custom_food_name: null,
        portion_g: portion,
        calculated_carbs_g: estimate.carbs,
        insulin_dose_units: dose,
        sugar_log_id: sugarLogId,
        photo_uri_local: photo,
        personal_note: note.trim() || null,
        tags,
        logged_at: loggedIso,
      });
      logEvent("log_added", { kind: "meal", source: "manual" });

      // SAFETY: the dose has to land in injection_logs, not only on the meal row.
      // IOB is computed from bolus injections, so a dose recorded on the meal
      // alone left active insulin reading 0 for anyone logging through this
      // screen - which is the main flow - and silently disabled the entire
      // anti-stacking protection. The row is marked source='calculator' so the
      // injection tab can show it as already logged rather than inviting a
      // duplicate, and it stays fully editable there.
      let wroteInjection = false;
      if (showsDose && dose > 0) {
        await logInjection({
          profile_id: activeProfile.id,
          site: AUTO_BOLUS_SITE,
          site_point: null,
          dose_units: dose,
          insulin_type: "bolus",
          meal_log_id: meal.id,
          source: "calculator",
          tags,
          logged_at: loggedIso,
        });
        wroteInjection = true;
      }

      void noteLogAndMaybeReview();
      hapticSuccess();
      // Logging a meal schedules the 2-hour post-meal glucose check reminder.
      await schedulePostMealReminder();
      bumpData();

      // ONE undo for the whole record. Undoing "the injection" while the meal
      // and its dose stayed behind left the user with a half-reverted entry they
      // had no way to finish reverting; this takes back exactly what the save
      // created. A reading that already existed is never touched, because the
      // save did not create it.
      const mealId = meal.id;
      const createdReading = createdSugarLogId;
      const message = wroteInjection
        ? t("calculator.autoInjection")
        : createdReading
          ? t("calculator.autoGlucose")
          : t("calculator.savedRecord");
      toast(message, "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            await deleteMealRecord(mealId, createdReading);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  if (!food || !estimate) {
    // The host lives on every branch, so anything this screen ever says lands
    // inside its own view controller rather than behind it.
    return (
      <AppBackground>
        <View className="flex-1 items-center justify-center">
          <Text style={{ color: THEME.muted }}>{t("common.loading")}</Text>
        </View>
        <FeedbackHost />
      </AppBackground>
    );
  }

  const heroDose =
    estimate.totalDose === 0 &&
    (estimate.mealDose > 0 || estimate.correctionDose > 0)
      ? "< 0.5"
      : num(estimate.totalDose);

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Platform.OS === "ios" ? 8 : insets.top }}>
        {/* Header (mockup B04: close, centred title, balancing spacer) */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.muted} />
          </Pressable>
          <Text style={{ color: THEME.ink, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {isEdit
              ? t("calculator.editTitle")
              : showsDose
                ? t("calculator.title")
                : t("calculator.carbFocusTitle")}
          </Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Food identity, kept compact so the read-outs stay the hero */}
          <View className="flex-row items-center mb-3">
            <IconTile emoji="🍽️" size={34} radius={11} hero style={{ marginRight: 10 }} />
            <View className="flex-1">
              <Text style={{ color: THEME.ink, fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                {foodName(food, lang)}
              </Text>
              <Text style={{ color: THEME.muted, fontSize: 11 }}>
                {num(food.carb_100g)} {t("common.grams")}/100g
                {/* A barcode result carries no glycemic index; showing "GI 0"
                    would read as a measured zero rather than "not stated". */}
                {food.glycemic_index > 0
                  ? ` · ${t("food.gi")} ${food.glycemic_index} · ${t("food.gl")} ${food.glycemic_load}`
                  : ""}
              </Text>
            </View>
          </View>
          {food.source ? (
            <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 10 }}>
              {t("food.dataSource", { source: foodSourceLabel(food.source) })}
              {" · "}
              {t("food.estimatedValues")}
            </Text>
          ) : null}

          {/* Read-out 1: carbohydrate, with the portion slider under it */}
          <ReadoutCard
            label={t("calculator.estCarbs")}
            value={num(estimate.carbs)}
            suffix={t("common.grams")}
          >
            <View className="flex-row items-center justify-between mt-2" style={{ gap: 10 }}>
              <Text style={{ color: THEME.muted, fontSize: 11 }}>
                {t("calculator.portion")}
              </Text>
              {/* Typeable / steppable so any gram value is reachable (e.g. 237 g,
                  or above the slider's 500 g coarse range up to 1500 g). */}
              <Stepper
                value={portion}
                onChange={setPortion}
                step={5}
                longStep={25}
                min={0}
                max={1500}
                decimals={0}
                suffix={t("common.grams")}
                accessibilityLabel={t("calculator.portion")}
                style={{ width: 148 }}
              />
            </View>
            {/* The slider stays a 0-500 g coarse control; typing can exceed it, so
                clamp only its thumb, never the real portion. */}
            <Slider
              minimumValue={0}
              maximumValue={500}
              step={5}
              value={Math.min(portion, 500)}
              onValueChange={setPortion}
              minimumTrackTintColor={THEME.accent}
              maximumTrackTintColor={THEME.track}
              thumbTintColor={THEME.accent}
            />
          </ReadoutCard>

          {/* Read-out 2: current glucose, typed inline, coloured live */}
          <GlassCard style={{ marginBottom: 10 }}>
            <View className="flex-row items-center justify-between">
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 11,
                  letterSpacing: 1.3,
                  fontWeight: "800",
                  flex: 1,
                }}
              >
                {upper(t("calculator.currentGlucose"))}
              </Text>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <TextInput
                  value={glucose}
                  onChangeText={(s) =>
                    setGlucose(
                      unit === "mmol"
                        ? s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")
                        : s.replace(/[^0-9]/g, "")
                    )
                  }
                  keyboardType={unit === "mmol" ? "decimal-pad" : "number-pad"}
                  placeholder="-"
                  placeholderTextColor="rgba(137,163,176,0.7)"
                  maxLength={unit === "mmol" ? 4 : 3}
                  style={[
                    TABULAR,
                    {
                      color: glucoseStatus ? RICH_BY_STATUS[glucoseStatus] : THEME.ink,
                      fontSize: 26,
                      fontWeight: "800",
                      minWidth: 58,
                      textAlign: "right",
                      padding: 0,
                    },
                  ]}
                />
                {glucoseStatus ? (
                  <GlucoseChip
                    status={glucoseStatus}
                    dot={false}
                    label={
                      glucoseStatus === "normal"
                        ? t("insights.inRange")
                        : glucoseStatus === "low"
                          ? t("insights.low")
                          : glucoseStatus === "veryHigh"
                            ? t("insights.veryHigh")
                            : t("insights.high")
                    }
                  />
                ) : (
                  <Text style={{ color: THEME.muted, fontSize: 11 }}>
                    {glucoseUnitLabel(unit)}
                  </Text>
                )}
              </View>
            </View>
          </GlassCard>

          {showsDose ? (
            <>
              {/* Hero: the calculated number, glowing, with its provenance */}
              <View
                className="rounded-2xl p-4 mb-3"
                style={[
                  {
                    borderWidth: 1,
                    borderColor: withAlpha(THEME.accent, 0.45),
                    backgroundColor: withAlpha(THEME.accent, 0.12),
                  },
                  glow(THEME.accent, 28, 0.45),
                ]}
              >
                <Text
                  style={{
                    color: THEME.accent,
                    fontSize: 11,
                    letterSpacing: 1.3,
                    fontWeight: "800",
                  }}
                >
                  {upper(t("calculator.estimatedDose"))}
                </Text>

                <View className="items-center mt-1">
                  <Text
                    style={[
                      TABULAR,
                      {
                        color: THEME.accent,
                        fontSize: 46,
                        lineHeight: 54,
                        fontWeight: "800",
                        textShadowColor: withAlpha(THEME.accent, 0.6),
                        textShadowRadius: 20,
                      },
                    ]}
                  >
                    {heroDose}
                  </Text>
                  <Text style={{ color: THEME.muted, fontSize: 12, marginTop: -2 }}>
                    {t("common.units")}
                  </Text>
                </View>

                {/* The arithmetic behind the figure, itemised */}
                <View className="mt-3" style={{ gap: 5 }}>
                  <Breakdown
                    label={t("calculator.mealDose")}
                    value={`${num(estimate.mealDose)} ${t("common.units")}`}
                  />
                  {estimate.correctionDose > 0 ? (
                    <Breakdown
                      label={t("calculator.correctionDose")}
                      value={`${num(estimate.correctionDose)} ${t("common.units")}`}
                    />
                  ) : null}
                  {iob > 0 ? (
                    <Breakdown
                      label={t("calculator.activeInsulin")}
                      value={`${num(iob)} ${t("common.units")}`}
                    />
                  ) : null}
                  {estimate.iobReduction > 0 ? (
                    <Breakdown
                      label={t("calculator.iobReduction")}
                      value={`-${num(estimate.iobReduction)} ${t("common.units")}`}
                      tint={GLUCOSE_RICH.target}
                    />
                  ) : null}
                </View>

                {/* The "adjust it yourself" explanation collapses into a tooltip
                    so the read-out stays uncluttered (regulation note below is
                    always visible). */}
                <View className="flex-row items-center justify-end" style={{ marginTop: 8, gap: 6 }}>
                  <Text style={{ color: THEME.muted, fontSize: 11 }}>
                    {t("common.note")}
                  </Text>
                  <Tooltip
                    text={
                      correctionTarget != null
                        ? `${t("calculator.overrideHint")}\n\n${t("calculator.correctionTargetNote", {
                            value: formatGlucose(correctionTarget, unit),
                            unit: glucoseUnitLabel(unit),
                          })}`
                        : t("calculator.overrideHint")
                    }
                  />
                </View>
              </View>

              {/* Regulation: a non-advice note accompanies every dose display. */}
              <NoticeCard
                icon="medical-outline"
                tint={GLUCOSE_RICH.high}
                body={t("calculator.calcNotAdvice")}
              />

              {/* A default ratio must never be mistaken for the user's own. */}
              {activeProfile && !activeProfile.ratios_confirmed ? (
                <NoticeCard
                  icon="information-circle-outline"
                  tint={THEME.accent}
                  title={t("calculator.defaultRatiosTitle")}
                  body={t("calculator.defaultRatiosBody")}
                />
              ) : null}

              {/* Plausibility warnings: non-blocking; the dose stays editable */}
              {estimate.warnings.map((w) => (
                <NoticeCard
                  key={w}
                  icon="alert-circle-outline"
                  tint={GLUCOSE_RICH.low}
                  body={t(`calculator.${WARN_KEY[w]}`)}
                />
              ))}

              <Pressable
                onPress={() => router.push("/sources")}
                hitSlop={8}
                className="flex-row items-center mb-4"
              >
                <Ionicons name="information-circle-outline" size={14} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontSize: 12, marginLeft: 5 }}>
                  {t("sources.calcLink")}
                </Text>
              </Pressable>

              <DetailLabel>{t("calculator.manualDose")}</DetailLabel>
              <TextInput
                value={doseText}
                onChangeText={(s) => {
                  setDoseTouched(true);
                  setDoseText(s.replace(/[^0-9.,]/g, ""));
                }}
                keyboardType="decimal-pad"
                style={[inputStyle, { marginBottom: 16 }]}
              />
            </>
          ) : (
            <NoticeCard
              icon="information-circle-outline"
              tint={THEME.accent}
              title={t("calculator.carbFocusTitle")}
              // A basal-only user DOES use insulin, so telling them they said
              // otherwise is simply wrong. Each mode gets its own sentence.
              body={
                insulinMode === "basal"
                  ? t("calculator.carbFocusBodyBasal")
                  : t("calculator.carbFocusBody")
              }
            />
          )}

          {/* ── Details ──────────────────────────────────────────────────── */}
          <DetailLabel>{t("calculator.activeSlot")}</DetailLabel>
          <Segmented
            options={SLOTS.map((s) => ({ value: s, label: t(`slot.${s}`) }))}
            value={slot}
            onChange={setSlot}
            className="mb-4"
          />

          <DetailLabel>{t("calculator.loggedTime")}</DetailLabel>
          <Pressable
            onPress={() => setTimePickerOpen((v) => !v)}
            className="flex-row items-center mb-4"
            style={inputStyle}
          >
            <Ionicons name="time-outline" size={16} color={THEME.muted} />
            <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
              {relativeDay((loggedAt ?? new Date()).toISOString(), {
                today: t("common.today"),
                yesterday: t("common.yesterday"),
              })}
              {" · "}
              {formatTime((loggedAt ?? new Date()).toISOString())}
            </Text>
          </Pressable>
          <InlineDateTimePicker
            visible={timePickerOpen}
            value={loggedAt ?? new Date()}
            max={new Date()}
            locale={lang}
            onChange={setLoggedAt}
            onClose={() => setTimePickerOpen(false)}
          />

          {photo ? (
            <View className="mb-4">
              <Image source={{ uri: photo }} className="w-full h-44 rounded-2xl" />
              <Pressable
                onPress={() => setPhoto(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("common.delete")}
                className="absolute top-2 right-2 rounded-full p-1.5"
                style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
              >
                <Ionicons name="trash-outline" size={16} color={GLUCOSE_RICH.low} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={choosePhoto}
              className="flex-row items-center justify-center rounded-2xl py-4 mb-4"
              style={{ borderWidth: 1, borderStyle: "dashed", borderColor: THEME.border }}
            >
              <Ionicons name="camera-outline" size={18} color={THEME.muted} />
              <Text style={{ color: THEME.muted, marginLeft: 8 }}>
                {t("calculator.addPhoto")}
              </Text>
            </Pressable>
          )}

          <DetailLabel>{t("calculator.personalNote")}</DetailLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("calculator.notePlaceholder")}
            placeholderTextColor="rgba(137,163,176,0.7)"
            multiline
            style={[inputStyle, { marginBottom: 16, minHeight: 72 }]}
            textAlignVertical="top"
          />

          <TagPicker value={tags} onChange={setTags} className="mb-5" />

          <NoticeCard
            icon="medical-outline"
            tint={GLUCOSE_RICH.high}
            body={t("disclaimer.short")}
          />

          <GradientCTA
            label={
              isEdit
                ? t("calculator.saveChanges")
                : showsDose
                  ? t("calculator.saveAsInjection")
                  : t("calculator.logMeal")
            }
            disabled={saving}
            onPress={logMeal}
          />
          <Text
            style={{
              color: THEME.muted,
              fontSize: 11,
              textAlign: "center",
              marginTop: 8,
            }}
          >
            {t("calculator.estimatedDose")}
          </Text>
        </ScrollView>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

function Breakdown({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View className="flex-row justify-between">
      <Text style={{ color: tint ?? THEME.muted, fontSize: 12, flex: 1, paddingRight: 8 }}>
        {label}
      </Text>
      <Text style={[TABULAR, { color: tint ?? THEME.ink, fontSize: 12, fontWeight: "700" }]}>
        {value}
      </Text>
    </View>
  );
}
