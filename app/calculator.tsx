import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
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
  setSugarLogHealthUuid,
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
import {
  getTemplateWithItems,
  touchTemplate,
  type TemplateWithItems,
} from "../lib/db/mealTemplates";
import { applyItemPortion, parsePortions, resolvedTotals } from "../lib/mealTemplates";
import {
  schedulePostMealReminder,
  noteJournalActivity,
} from "../lib/services/notifications";
import {
  deleteGlucoseFromHealth,
  getHealthWriteEnabled,
  updateGlucoseInHealth,
  writeGlucoseToHealthIfEnabled,
} from "../lib/services/health";
import { foodSourceLabel } from "../lib/services/openFoodFacts";
import type { Food, LogTag, MealSlot } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { Segmented } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { EMOJI_RENDERS } from "../components/FoodPlate";
import { Tooltip } from "../components/Tooltip";
import { TagPicker } from "../components/TagPicker";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { InlineDateTimePicker } from "../components/InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";
import {
  GLUCOSE_INPUT_CEILING,
  glucoseAboveCeiling,
  parseDecimalText,
  sanitizeNumberText,
} from "../lib/numberInput";
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
import { GLUCOSE_RICH, INPUT_TEXT, MODAL_TOP_PAD, RADIUS, RICH_BY_STATUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/** The region an auto-written mealtime bolus is filed under: NONE. This screen
 *  never asks where the dose went, so it records no region and no rotation point
 *  (schema v11 allows a null site). It used to stamp 'abdomen_left', which put
 *  entries the user never placed into their rotation picture and heated that one
 *  region on the map; the injection tab can still fill the region in later. */
const AUTO_BOLUS_SITE = null;

/**
 * The stand-in food row for a meal that has none: a typed-name entry, or one
 * whose catalogue food was deleted afterwards. The screen used to wait forever
 * for a food that would never load and showed only "loading", so the fastest way
 * to log something was also the one entry that could not be corrected.
 *
 * Every figure comes from the meal's own record: carb_100g is back-derived from
 * the carbs and portion that were saved, so the numbers on screen are the user's
 * and a portion change scales them the same way it does for a catalogue food.
 */
function foodFromMeal(log: {
  custom_food_name: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  logged_at: string;
}): Food {
  const name = log.custom_food_name?.trim() || "";
  // NOT rounded: at the stored portion this has to reproduce the stored carbs
  // exactly, or merely opening the entry and saving it again would nudge the
  // user's own figure. The screen rounds it for display (see num()).
  const per100 =
    log.portion_g > 0 ? (log.calculated_carbs_g * 100) / log.portion_g : 0;
  return {
    id: "",
    name_tr: name,
    name_en: name,
    name_de: name,
    name_es: name,
    name_fr: name,
    aliases_json: "[]",
    category: "other",
    barcode: null,
    carb_100g: per100,
    glycemic_index: 0,
    glycemic_load: 0,
    portion_size_g: log.portion_g,
    brand_name: null,
    custom_notes: null,
    is_custom: 1,
    source: null,
    created_at: log.logged_at,
  };
}

/**
 * A meal template as ONE food for the estimator: carb_100g is the template's total
 * carbohydrate and the portion is pinned to 100, so carb_100g × 100 / 100 gives
 * back exactly that total.
 *
 * This is how several items reach a dose estimate without touching estimateInsulin
 * or anything around it: its signature is Pick<Food,"carb_100g"> and it computes
 * carbs = carb_100g × portion / 100. The whole safety chain on this screen (the IOB
 * re-read, checkDose, both confirmations, the injection row) therefore runs
 * unchanged and unduplicated - a second copy of it for templates is precisely the
 * thing that must not exist.
 */
function foodFromTemplate(loaded: TemplateWithItems): Food {
  const name = loaded.template.name;
  return {
    id: "",
    name_tr: name,
    name_en: name,
    name_de: name,
    name_es: name,
    name_fr: name,
    aliases_json: "[]",
    category: "other",
    barcode: null,
    carb_100g: loaded.carbs_g,
    glycemic_index: 0,
    glycemic_load: 0,
    portion_size_g: 100,
    brand_name: null,
    custom_notes: null,
    is_custom: 1,
    source: null,
    created_at: loaded.template.created_at,
  };
}

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

/** Secondary, non-regulation notices (default ratios, ISF off) stacked as
 *  separate cards each carry their own border/background and pile up
 *  vertically; grouped under one card they read as one dismissable block
 *  instead of a wall of boxes. The regulation notice (calcNotAdvice) and the
 *  plausibility warnings stay outside this group, on their own. */
function NoticeGroup({
  items,
}: {
  items: { icon: keyof typeof Ionicons.glyphMap; tint: string; title?: string; body: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <View
      className="rounded-2xl px-3.5 py-3 mb-3"
      style={{
        borderWidth: 1,
        borderColor: withAlpha(THEME.accent, 0.3),
        backgroundColor: withAlpha(THEME.accent, 0.1),
      }}
    >
      {items.map((item, i) => (
        <View
          key={i}
          className="flex-row items-start"
          style={{ marginTop: i === 0 ? 0 : 10 }}
        >
          <Ionicons name={item.icon} size={15} color={item.tint} style={{ marginTop: 1 }} />
          <View className="flex-1 ml-2.5">
            {item.title ? (
              <Text style={{ color: item.tint, fontSize: 12, fontWeight: "800", marginBottom: 2 }}>
                {item.title}
              </Text>
            ) : null}
            <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 17, opacity: 0.85 }}>
              {item.body}
            </Text>
          </View>
        </View>
      ))}
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

function CalculatorScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    foodId,
    portion: portionParam,
    mealLogId,
    templateId,
    portions,
  } = useLocalSearchParams<{
    foodId?: string;
    portion?: string;
    mealLogId?: string;
    templateId?: string;
    portions?: string;
  }>();
  const { activeProfile, lang, bumpData, dataVersion } = useApp();
  const { actionSheet, confirm, toast } = useFeedback();

  const [food, setFood] = useState<Food | null>(null);
  // Set only on the template route: what the synthetic food above stands for, and
  // what the saved row is then named, portioned and attributed to.
  const [templateCtx, setTemplateCtx] = useState<TemplateWithItems | null>(null);
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
  // Flips true only on a direct user edit (photo, note, tags, typed dose) -
  // never on the edit-mode prefill - so the close button only warns about
  // input the user themselves just made, not the record it loaded.
  const [dirty, setDirty] = useState(false);
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

  // Template mode: load the recipe, fold it into one synthetic food and pin the
  // portion to 100. `portions` (a csv on the link) carries ONE day's portions
  // without touching the stored template; it is all-or-nothing, so a stale link
  // falls back to the template as it stands rather than dosing on a partial read.
  useEffect(() => {
    (async () => {
      if (!templateId) return;
      const loaded = await getTemplateWithItems(templateId, lang);
      if (!loaded) return;
      const carried = parsePortions(portions, loaded.items.length);
      const items = carried
        ? loaded.items.map((item, i) => applyItemPortion(item, carried[i]))
        : loaded.items;
      const totals = resolvedTotals(items);
      const ctx: TemplateWithItems = {
        template: loaded.template,
        items,
        carbs_g: totals.carbs_g,
        portion_g: totals.portion_g,
      };
      setTemplateCtx(ctx);
      setFood(foodFromTemplate(ctx));
      setPortion(100);
    })();
  }, [templateId, portions, lang]);

  // Edit mode: prefill every field from the stored log. doseTouched is set so
  // the estimate effect never overwrites the dose the user actually applied.
  useEffect(() => {
    (async () => {
      if (!isEdit || !mealLogId) return;
      const log = await getMealLog(mealLogId);
      if (!log) return;
      const catalogueFood = log.food_id ? await getFood(log.food_id) : null;
      // No catalogue row (typed name, or the food was deleted since): stand one in
      // from the meal's own values instead of leaving the screen loading forever.
      setFood(catalogueFood ?? foodFromMeal(log));
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
    void readFreshIob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile, dataVersion]);

  /** Re-reads active insulin from the log. IOB decays while this screen sits
   *  open, so the value the save uses is taken at save time, not at mount. */
  async function readFreshIob(): Promise<number> {
    if (!activeProfile) return 0;
    const injections = await getInjections(activeProfile.id, 100);
    const fresh = activeInsulin(injections);
    setIob(fresh);
    return fresh;
  }

  const unit = activeProfile?.glucose_unit ?? "mgdl";

  // ONE numeric normalizer for the whole app (lib/numberInput): a comma is a
  // decimal separator, not a digit to be dropped - "5,5" must stay 5.5 mmol/L
  // and never become 55.
  const glucoseTyped = useMemo(() => parseDecimalText(glucose), [glucose]);

  const glucoseMgdl = useMemo(() => {
    return glucoseTyped != null && glucoseTyped > 0
      ? glucoseFromDisplay(glucoseTyped, unit)
      : null;
  }, [glucoseTyped, unit]);

  // Descriptive only: a reading past what a consumer meter reports is still
  // accepted and stored, it just gets said out loud.
  const glucoseAboveMeterRange = glucoseAboveCeiling(glucoseTyped, unit);

  // What the manual dose field reads right now. null = EMPTY, which is not the
  // same as 0: 0 is the user stating they injected nothing.
  const typedDose = useMemo(() => parseDecimalText(doseText), [doseText]);

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
    setDirty(true);
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

  /** The header close button: a photo, note, tag or typed dose the user just
   *  added has nowhere else to live if this screen closes without saving, so
   *  leaving un-warned would silently drop it. Nothing to lose (dirty still
   *  false) closes at once, same as before. */
  async function handleClose() {
    if (dirty) {
      const proceed = await confirm({
        title: t("calculator.discardTitle"),
        message: t("calculator.discardBody"),
        confirmLabel: t("calculator.discardConfirm"),
        destructive: true,
        icon: "close-circle-outline",
      });
      if (!proceed) return;
    }
    router.back();
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
      // Active insulin decays by the minute, so the figure the save is built on
      // is re-read here rather than trusted from whenever the screen opened.
      const freshIob = await readFreshIob();
      const est = estimateInsulin(food, portion, activeProfile, {
        slot,
        currentGlucose: glucoseMgdl,
        currentIOB: freshIob,
      });

      // The typed dose is the record of what the user actually injected, so it is
      // never overwritten by the estimate: a typed 0 means "no insulin" and is
      // stored as 0. Falling back to the estimated total on a falsy parse turned
      // that declaration into a phantom bolus and left active-insulin tracking
      // wrong for hours. An EMPTY field is not a value at all, so the save says
      // what it is about to store before it writes anything.
      let dose: number;
      if (!showsDose) {
        dose = 0;
      } else if (typedDose == null) {
        const proceed = await confirm({
          title: t("calculator.emptyDoseTitle"),
          message: t("calculator.emptyDoseBody", { n: num(est.totalDose) }),
          confirmLabel: t("calculator.emptyDoseConfirm"),
          icon: "help-circle-outline",
        });
        if (!proceed) return;
        dose = 0;
      } else if (!doseTouched && typedDose !== est.totalDose) {
        // The field still holds the estimate from when the screen opened, and the
        // re-read active insulin moved it. Show the current figure instead of
        // storing either number behind the user's back; declining just returns to
        // the screen, which now displays the refreshed estimate.
        const proceed = await confirm({
          title: t("calculator.iobRefreshedTitle"),
          message: t("calculator.iobRefreshedBody", { n: num(est.totalDose) }),
          confirmLabel: t("common.save"),
          icon: "refresh-outline",
        });
        if (!proceed) return;
        dose = est.totalDose;
      } else {
        dose = typedDose;
      }
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
          calculated_carbs_g: est.carbs,
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
          // A previously mirrored reading must not keep its stale value in
          // Apple Health after a correction here.
          void (async () => {
            try {
              // With the mirror off, updateGlucoseInHealth returns null WITHOUT
              // deleting the old sample; clearing the uuid then would orphan it
              // in Apple Health forever. Leave the link untouched instead.
              if (!(await getHealthWriteEnabled())) return;
              const row = await getSugarLog(linkedSugarLogId);
              if (!row?.healthkit_uuid) return;
              const uuid = await updateGlucoseInHealth(
                row.healthkit_uuid,
                row.glucose_level_mgdl,
                row.logged_at
              );
              await setSugarLogHealthUuid(row.id, uuid);
            } catch {
              // the local edit must never fail because the mirror did
            }
          })();
        } else if (!linkedSugarLogId && glucoseMgdl != null) {
          // R10 1.3: the meal had no reading attached, but one was typed while
          // editing it, and it was silently discarded before. Same dedup as a fresh
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

      // A template saves as ONE row named after the recipe, carrying its summed
      // portion and the id it came from. The synthetic food has no catalogue row
      // behind it, so food_id stays null and the name is stored on the meal.
      const meal = await addMealLog({
        profile_id: activeProfile.id,
        food_id: templateCtx ? null : food.id,
        custom_food_name: templateCtx ? templateCtx.template.name : null,
        portion_g: templateCtx ? templateCtx.portion_g : portion,
        calculated_carbs_g: est.carbs,
        insulin_dose_units: dose,
        sugar_log_id: sugarLogId,
        photo_uri_local: photo,
        personal_note: note.trim() || null,
        tags,
        logged_at: loggedIso,
        meal_template_id: templateCtx ? templateCtx.template.id : null,
      });
      if (templateCtx) await touchTemplate(templateCtx.template.id, meal.logged_at);
      logEvent("log_added", {
        kind: "meal",
        source: templateCtx ? "template" : "manual",
      });

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
      void noteJournalActivity();
      hapticSuccess();
      // Logging a meal NOW schedules the 2-hour post-meal glucose check reminder.
      // A backdated entry does not: the countdown would start from this moment
      // rather than from the meal, so writing up last night's dinner armed a
      // check for two hours from now and overwrote a timer already running.
      if (loggedAt == null) await schedulePostMealReminder();
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
            // Undo also revokes the Apple Health mirror of the reading this save
            // created (best-effort): the local row is gone, so leaving the sample
            // in Health would strand a reading the user just took back.
            const mirrored = await deleteMealRecord(mealId, createdReading);
            void deleteGlucoseFromHealth(mirrored);
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
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        {/* Header (mockup B04: close, centred title, balancing spacer) */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={handleClose}
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
            <IconTile emoji={EMOJI_RENDERS ? "🍽️" : undefined} icon="restaurant-outline" size={34} radius={11} hero style={{ marginRight: 10 }} />
            <View className="flex-1">
              <Text style={{ color: THEME.ink, fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                {foodName(food, lang)}
              </Text>
              {/* The synthetic template food has no real per-100 g value (it is the
                  total), so printing one here would read as a measured figure. */}
              <Text style={{ color: THEME.muted, fontSize: 11 }}>
                {templateCtx ? (
                  t("templates.itemCount", { count: templateCtx.items.length })
                ) : (
                  <>
                    {num(food.carb_100g)} {t("common.grams")}/100g
                    {/* A barcode result carries no glycemic index; showing "GI 0"
                        would read as a measured zero rather than "not stated". */}
                    {food.glycemic_index > 0
                      ? ` · ${t("food.gi")} ${food.glycemic_index} · ${t("food.gl")} ${food.glycemic_load}`
                      : ""}
                  </>
                )}
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
            {/* A template has no single portion to drag: its carbs are the sum of its
                items, and one slider over the lot would silently rescale every one
                of them. The portions are edited where they live instead. */}
            {templateCtx ? (
              <View className="mt-2">
                <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 16 }}>
                  {t("templates.calcFromItems")}
                </Text>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/meal-template",
                      params: { templateId: templateCtx.template.id, mode: "log" },
                    })
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  className="flex-row items-center mt-2"
                >
                  <Ionicons name="options-outline" size={14} color={THEME.accent} />
                  <Text style={{ color: THEME.accent, fontSize: 12, marginLeft: 5 }}>
                    {t("templates.adjustAndLog")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
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
                    style={{ flex: 1, maxWidth: 220 }}
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
              </>
            )}
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
                    setGlucose(sanitizeNumberText(s, unit === "mmol"))
                  }
                  keyboardType={unit === "mmol" ? "decimal-pad" : "number-pad"}
                  placeholder="-"
                  placeholderTextColor="rgba(137,163,176,0.7)"
                  maxLength={unit === "mmol" ? 4 : 3}
                  style={[
                    TABULAR,
                    INPUT_TEXT,
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

          {/* Descriptive notes about the READING itself. Neither is an alarm and
              neither instructs: they state what the number is, so a low reading
              that auto-fills a full meal dose is never presented without it. */}
          {glucoseStatus === "low" ? (
            <NoticeCard
              icon="information-circle-outline"
              tint={GLUCOSE_RICH.low}
              body={t("calculator.lowReadingNote")}
            />
          ) : null}
          {glucoseAboveMeterRange ? (
            <NoticeCard
              icon="information-circle-outline"
              tint={THEME.accent}
              body={t("calculator.glucoseAboveMeterRange", {
                max: num(GLUCOSE_INPUT_CEILING[unit]),
                unit: glucoseUnitLabel(unit),
              })}
            />
          ) : null}

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

              {/* Secondary, non-regulation notices (default ratio in use, ISF
                  skipped) grouped into one card instead of stacking each as
                  its own box - a default ratio must still never be mistaken
                  for the user's own, and a dropped correction is still stated,
                  not hidden, just no longer in a separate box each. */}
              <NoticeGroup
                items={[
                  ...(activeProfile && !activeProfile.ratios_confirmed
                    ? [
                        {
                          icon: "information-circle-outline" as const,
                          tint: THEME.accent,
                          title: t("calculator.defaultRatiosTitle"),
                          body: t("calculator.defaultRatiosBody"),
                        },
                      ]
                    : []),
                  ...(estimate.correctionSkipped === "isf_invalid"
                    ? [
                        {
                          icon: "information-circle-outline" as const,
                          tint: THEME.accent,
                          body: t("calculator.correctionOffIsf"),
                        },
                      ]
                    : []),
                ]}
              />

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
                  setDirty(true);
                  setDoseText(sanitizeNumberText(s, true));
                }}
                keyboardType="decimal-pad"
                style={[
                  inputStyle,
                  INPUT_TEXT,
                  { marginBottom: typedDose == null || typedDose === 0 ? 10 : 16 },
                ]}
              />
              {/* What the save will store, spelled out while the field is still
                  in front of the user - an empty field is not a value, and a
                  typed 0 is a real record of "no insulin". */}
              {typedDose == null ? (
                <NoticeCard
                  icon="information-circle-outline"
                  tint={THEME.accent}
                  body={t("calculator.doseEmptyNote", { n: num(estimate.totalDose) })}
                />
              ) : typedDose === 0 ? (
                <NoticeCard
                  icon="information-circle-outline"
                  tint={THEME.accent}
                  body={t("calculator.doseZeroNote")}
                />
              ) : null}
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
                onPress={() => {
                  setPhoto(null);
                  setDirty(true);
                }}
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
            onChangeText={(s) => {
              setNote(s);
              setDirty(true);
            }}
            placeholder={t("calculator.notePlaceholder")}
            placeholderTextColor="rgba(137,163,176,0.7)"
            multiline
            style={[inputStyle, INPUT_TEXT, { marginBottom: 16, minHeight: 72 }]}
            textAlignVertical="top"
          />

          <TagPicker
            value={tags}
            onChange={(v) => {
              setTags(v);
              setDirty(true);
            }}
            className="mb-5"
          />

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

export default function CalculatorRoute() {
  return (
    <SafeAreaProvider>
      <CalculatorScreen />
    </SafeAreaProvider>
  );
}
