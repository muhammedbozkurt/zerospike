import React, { useRef, useState } from "react";
import {
  I18nManager,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import type { JournalEntry } from "../lib/db/journal";
import type { LogTag, UserProfile } from "../lib/db/types";
import { FoodPlate } from "./FoodPlate";
import {
  classifyGlucose,
  GlucoseStatus,
  formatGlucose,
  glucoseUnitLabel,
} from "../lib/glucose";
import { formatTime } from "../lib/format";
import { num } from "../lib/format";
import { RICH_BY_STATUS, THEME, TYPE, SPACE, glow, HIT_TARGET, RADIUS } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { Txt } from "./ui";
import { GlucoseChip } from "./rich/GlucoseChip";
import { hasMealWeight } from "../lib/mealPrefill";
import { IconTile } from "./rich/IconTile";
import { withAlpha } from "./rich/GlassCard";
import {
  deleteActionWidth,
  estimateRowWidth,
  SWIPE_DRAG_OFFSET,
  SWIPE_FRICTION,
  swipeContentOffset,
  swipeIconOpacity,
  swipeLabelOpacity,
  swipeOpenThreshold,
} from "../lib/swipeAction";




/** The single red action a swipe reveals: a trash icon over the word for
 *  "Delete", so it reads the same way whether the user gets there by icon or
 *  by label. `onPress` already carries the confirm - see useJournalRows.tsx's
 *  confirmAndDelete - so this is a plain button, not a second confirmation.
 *
 *  The red fill is NEVER animated: ReanimatedSwipeable's own wrapper already
 *  hides this whole layer while the row is closed, and its container has no
 *  background of its own, so fading the fill in during the drag does not hide
 *  the action - it punches a see-through hole where the row used to be. It is
 *  painted the instant the row moves, and everything that does animate here is
 *  driven off `translation` (the library's own SharedValue, the row's offset
 *  in px) rather than `progress`, because what the icon and the word need to
 *  know is how many POINTS of panel are uncovered, not a normalised fraction.
 *  See lib/swipeAction.ts for the whole measured argument.
 *
 *  `alignSelf: "stretch"` - NOT `flex: 1` - is what makes the panel match the
 *  ROW's own box: the library's action layer is `...StyleSheet.absoluteFill`
 *  with `flexDirection: "row-reverse"` (see its styles.rightActions), so this
 *  view's parent is a ROW. In a row, `flex: 1` means grow along the MAIN axis,
 *  and its `flexBasis: 0%` overrides `width` outright - the panel then spanned
 *  the whole row and the library measured that full span as the open distance.
 *  Stretch is the cross-axis (height) property this actually wanted, and it is
 *  already the parent's default, so the width below is the only thing setting
 *  the panel's size. A fixed height would fall short of a taller multi-line
 *  row and leave the red fill short of the row's own top/bottom edge. */
function SwipeDeleteAction({
  onPress,
  translation,
  actionWidth,
}: {
  onPress: () => void;
  translation: SharedValue<number>;
  /** A quarter of the row this action belongs to - measured, never assumed.
   *  See Row's own onLayout and lib/swipeAction.ts's SWIPE_ACTION_RATIO. */
  actionWidth: number;
}) {
  const { t } = useTranslation();
  // Read once on the JS side: RN does not mirror `transform: translateX` for
  // RTL, so the offset below has to carry its own sign.
  const isRTL = I18nManager.isRTL;
  const contentStyle = useAnimatedStyle(() => ({
    opacity: swipeIconOpacity(translation.value, actionWidth),
    transform: [
      { translateX: swipeContentOffset(translation.value, actionWidth, isRTL) },
    ],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: swipeLabelOpacity(translation.value, actionWidth),
  }));
  return (
    <View style={{ width: actionWidth, alignSelf: "stretch" }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t("journal.deleteA11y")}
        android_ripple={{ color: withAlpha(THEME.onDanger, RIPPLE_ALPHA), foreground: true }}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: THEME.dangerFill,
        }}
      >
        <Animated.View style={[{ alignItems: "center" }, contentStyle]}>
          <Ionicons name="trash-outline" size={18} color={THEME.onDanger} />
          {/* Opacity only, never `display`: the word keeps its box at every
              width, so the icon does not hop vertically as the label arrives. */}
          <Animated.Text
            numberOfLines={1}
            style={[
              TYPE.micro,
              { color: THEME.onDanger, fontWeight: "700", marginTop: SPACE.xs },
              labelStyle,
            ]}
          >
            {t("common.delete")}
          </Animated.Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

/** The shared glass "row": translucent fill, light border, left accent bar.
 *
 *  The edit/delete menu is reached ONLY by long-pressing the row, which a screen
 *  reader neither announces nor offers. It is now both hinted and exposed as a
 *  real accessibility action, so the menu is reachable without a long press. A
 *  left swipe (right in RTL) is a second, discoverable way to the same delete -
 *  see `onDelete` below. */
function Row({
  children,
  accent,
  label,
  onPress,
  onLongPress,
  onDelete,
  inPanel,
  firstInPanel,
}: {
  children: React.ReactNode;
  accent: string;
  /** What this row is, spoken as one phrase (the children are decorative parts). */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Reveals the swipe delete action (see SwipeDeleteAction) when set. Left
   *  undefined, no ReanimatedSwipeable is even mounted for this row - the
   *  long-press menu's own Delete stays the only way in, exactly as before
   *  (zero regression for any caller that does not pass it). */
  onDelete?: () => void;
  /** Drawn INSIDE the dashboard's journal panel rather than as a free-standing
   *  card on the page background. A card inside a card reads as twice the
   *  chrome for the same content, so in this mode the row drops its own border,
   *  corner radius and fill and becomes a plain divided line - the panel
   *  already provides all three. The colour hierarchy is untouched: the type
   *  accent moves from a left border to a leading bar of the same width and
   *  colour, so the row is still identifiable at a glance. */
  inPanel?: boolean;
  /** First row under a day separator: no divider above it, the separator is
   *  already the break. */
  firstInPanel?: boolean;
}) {
  const { t } = useTranslation();
  const swipeRef = useRef<SwipeableMethods>(null);

  // The delete panel is a share of THIS row, not a fixed stub, so the row has
  // to know its own width. onLayout is the authority; the window width only
  // seeds the very first frame, because a row that started at the floor width
  // and then jumped to a quarter would be visible on the first swipe after
  // mount. The measurement is re-reported on rotation, on a tablet split, and
  // whenever Dynamic Type re-lays the row out, so the panel and every
  // threshold derived from it follow along on their own.
  const { width: windowW } = useWindowDimensions();
  const [measuredRowW, setMeasuredRowW] = useState(0);
  const rowW = measuredRowW > 0 ? measuredRowW : estimateRowWidth(windowW);
  const actionW = deleteActionWidth(rowW);
  const openThreshold = swipeOpenThreshold(actionW);

  const row = (
    <Pressable
      // Only when a swipe can actually happen: a row without onDelete never
      // mounts a Swipeable, so measuring it would be pure per-row overhead in
      // the list. The sub-pixel guard stops a layout that reports 352.6667 and
      // 352.66671 on alternate passes from looping setState forever.
      onLayout={
        onDelete
          ? (e) => {
              const w = e.nativeEvent.layout.width;
              setMeasuredRowW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
            }
          : undefined
      }
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? t("journal.rowHint") : undefined}
      accessibilityActions={
        onLongPress
          ? [{ name: "longpress", label: t("journal.rowActions") }]
          : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        // The shortest row (a glucose reading with no tags) came to ~40pt, just
        // under the 44pt target - and this row IS the tap target for editing.
        // A floor, not a height: taller rows are untouched, and the row still
        // grows with the text at a large accessibility font size.
        minHeight: HIT_TARGET,
        ...(inPanel
          ? {
              borderTopWidth: firstInPanel ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: THEME.border,
              paddingVertical: SPACE.sm,
              paddingHorizontal: SPACE.md,
            }
          : {
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderColor: THEME.border,
              borderLeftWidth: 3,
              borderLeftColor: accent,
              backgroundColor: THEME.surface,
              paddingVertical: SPACE.sm,
              paddingHorizontal: SPACE.md,
              marginBottom: onDelete ? 0 : SPACE.sm,
            }),
      }}
    >
      {inPanel ? (
        <View
          style={{
            width: 3,
            alignSelf: "stretch",
            minHeight: 22,
            borderRadius: 2,
            backgroundColor: accent,
            marginEnd: SPACE.sm,
          }}
        />
      ) : null}
      {children}
    </Pressable>
  );

  if (!onDelete) return row;

  const revealDelete = (
    _progress: SharedValue<number>,
    translation: SharedValue<number>
  ) => (
    <SwipeDeleteAction
      translation={translation}
      actionWidth={actionW}
      onPress={() => {
        swipeRef.current?.close();
        onDelete();
      }}
    />
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      // 1, the library's own default: the row follows the finger exactly. An
      // earlier pass raised this to 2 to make the panel harder to reach, which
      // is the wrong lever twice over - the library divides BOTH the row's
      // travel and the release comparison by it, so it buys a lagging,
      // unresponsive drag AND doubles the distance to commit. lib/swipeAction
      // .ts carries the measured argument. Passed explicitly, not defaulted,
      // so the value is a decision on the record rather than an omission.
      friction={SWIPE_FRICTION}
      // Both edges, same value: the pan needs real horizontal intent whichever
      // way the finger goes, so a near-vertical drag stays with the FlatList.
      // This is a dead zone on both platforms (the native handlers zero the
      // translation on activation), which is why it is 16 and not the 28 that
      // made the gesture feel broken.
      dragOffsetFromLeftEdge={SWIPE_DRAG_OFFSET}
      dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
      // THE fix for "azicik sola slide edince bile sil butonu geliyor" (device
      // QA): the panel still tracks the finger from the first pixel, but
      // letting go before 70% of it is out springs it shut, so a barely-there
      // swipe can never leave the delete button sitting there to be tapped.
      // The library's own default is half the panel. 70% OF THE MEASURED
      // PANEL, so the pull stays proportionally identical on every screen
      // instead of getting easier as the row gets wider.
      leftThreshold={I18nManager.isRTL ? openThreshold : undefined}
      rightThreshold={I18nManager.isRTL ? undefined : openThreshold}
      // A single fixed-width action, not a variable drag-to-commit: overshoot
      // would let it stretch past its own button, so it is turned off on
      // whichever side the action actually renders on.
      overshootLeft={I18nManager.isRTL ? false : undefined}
      overshootRight={I18nManager.isRTL ? undefined : false}
      // The row's own marginBottom moved here (it is off on the row itself
      // whenever onDelete is set - see `row`'s style above) so the gap between
      // free-standing cards sits OUTSIDE the swipeable's clipped, rounded
      // container instead of inside it, where a rounded corner would show a
      // square notch cut out of the revealed action underneath it.
      //
      // In-panel rows carry no border radius of their own (see the row style
      // above) EXCEPT the very first row, which sits right under the panel's
      // own rounded top cap (components/JournalPanel.tsx's JournalPanelTop) -
      // without matching that same radius here, swiping that one row open
      // used to show a hard square corner poking out of the panel's rounded
      // silhouette (device QA screenshot). The panel's LAST row needs no
      // equivalent: JournalPanelBottom always renders below the rows on both
      // screens that draw a journal (it carries the "show more" / "see the full
      // journal" action, and still renders its rounded cap with no action at
      // all), so the last row's square bottom corners never reach the panel's
      // silhouette. That is why there is no `lastInPanel` prop to match.
      containerStyle={
        !inPanel
          ? { borderRadius: RADIUS.md, marginBottom: SPACE.sm }
          : firstInPanel
            ? { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg }
            : undefined
      }
      // ReanimatedSwipeable's renderRightActions is always the edge revealed by
      // a swipe-towards-the-start gesture; it does NOT mirror for RTL layouts
      // (only the actions' own internal stacking does - see the library's
      // styles.rightActions). Arabic instead reveals from the left, so the
      // action still appears on the side the reading direction opens towards.
      {...(I18nManager.isRTL
        ? { renderLeftActions: revealDelete }
        : { renderRightActions: revealDelete })}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

/** Max tag chips shown before the rest collapse into a "+N" chip. Keeps tags on
 *  ONE line (no flex-wrap second row). */
const MAX_TAG_CHIPS = 2;

function TagChip({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: withAlpha(THEME.accent, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(THEME.accent, 0.22),
        paddingHorizontal: SPACE.sm,
        paddingVertical: 1,
        marginEnd: SPACE.xs,
      }}
    >
      <Txt kind="micro" tone="accent" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

function TagBadges({ tags }: { tags: LogTag[] }) {
  const { t } = useTranslation();
  // Collapsed to one line ("+N") until the user taps +N to reveal them all. The
  // +N Pressable is its own responder, so tapping it does NOT open the row's
  // edit flow.
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;
  const visible = expanded ? tags : tags.slice(0, MAX_TAG_CHIPS);
  const overflow = tags.length - visible.length;
  const allLabel = tags.map((tag) => t(`tags.${tag}`)).join(", ");
  return (
    <View
      className={`flex-row items-center ${expanded ? "flex-wrap" : ""}`}
      style={{ marginTop: SPACE.xs }}
      accessibilityLabel={`${t("tags.label")}: ${allLabel}`}
    >
      {visible.map((tag) => (
        <TagChip key={tag} label={t(`tags.${tag}`)} />
      ))}
      {overflow > 0 || expanded ? (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          // A 10pt chip inside the row's own Pressable: a near-miss opened the
          // edit flow instead of expanding the tags. The slop carries the target
          // to ~44pt without making the chip (or the row) any taller.
          hitSlop={{ top: 13, bottom: 13, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? t("journal.showLess") : allLabel}
        >
          <TagChip label={expanded ? t("journal.showLess") : `+${overflow}`} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The meal thumbnail's on-screen size, and the decode budget derived from it.
 *
 * A logged meal photo is a full-resolution camera image (several megapixels). It
 * is shown in a 30x30 dp square, and without a size hint the loader decoded the
 * whole thing into memory for every visible row - the single most expensive thing
 * on the journal list. The hint caps the decode at 3x the display size, which is
 * past any screen's pixel density and a rounding error next to the original.
 */
const MEAL_THUMB_DP = 30;
const MEAL_THUMB_DECODE_PX = MEAL_THUMB_DP * 3;

interface Props {
  entry: JournalEntry;
  profile: UserProfile;
  onLongPress?: (entry: JournalEntry) => void;
  onPress?: (entry: JournalEntry) => void;
  /** Meal rows only: when true, shows a small curve chevron that opens the
   *  meal's response (lib/mealResponse.ts) instead of the row's own edit tap. */
  hasResponse?: boolean;
  onOpenResponse?: (entry: JournalEntry) => void;
  /** Swipe-to-delete (see Row's own `onDelete` note). Left undefined, the row
   *  never mounts a ReanimatedSwipeable at all - the long-press menu's Delete
   *  is unaffected either way. */
  onDelete?: (entry: JournalEntry) => void;
  /** See Row's own `inPanel` note: the dashboard draws its journal inside one
   *  container, every other caller still gets the free-standing card. */
  inPanel?: boolean;
  firstInPanel?: boolean;
}

function JournalItemBase({
  entry,
  profile,
  onLongPress,
  onPress,
  onDelete,
  hasResponse,
  onOpenResponse,
  inPanel,
  firstInPanel,
}: Props) {
  const { t } = useTranslation();
  const chrome = {
    inPanel,
    firstInPanel,
    onDelete: onDelete ? () => onDelete(entry) : undefined,
  };

  if (entry.kind === "glucose") {
    const status = classifyGlucose(
      entry.glucose_level_mgdl,
      entry.period_tag,
      profile
    );
    const color = RICH_BY_STATUS[status];
    const isHealthSource = entry.source === "health";
    // An imported reading carries no period at all (period_tag "unset" - see
    // lib/periodTag.ts), so the row's own source is what identifies it, not a
    // guessed time-of-day label. For any other row that somehow has no period
    // set, the plain "unset" label still applies.
    const periodLabel =
      entry.period_tag !== "unset" ? t(`period.${entry.period_tag}`) : null;
    const sourceLabel = isHealthSource
      ? periodLabel
        ? `${t("journal.sourceHealth")} · ${periodLabel}`
        : t("journal.sourceHealth")
      : (periodLabel ?? t("period.unset"));
    const label = [
      `${formatGlucose(entry.glucose_level_mgdl, profile.glucose_unit)} ${glucoseUnitLabel(profile.glucose_unit)}`,
      sourceLabel,
      status === "low" ? t("journal.lowBadge") : null,
      formatTime(entry.logged_at),
      // Visual text is untouched (sourceLabel already reads "unset" above);
      // this only tells VoiceOver/TalkBack that tapping the row can assign a
      // period tag, since journal.addPeriodTag has no other reachable spot in
      // the UI otherwise.
      entry.period_tag === "unset" ? t("journal.addPeriodTag") : null,
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={color}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
        {/* value chip carries the reading in its status color (never color alone) */}
        <GlucoseChip
          value={formatGlucose(entry.glucose_level_mgdl, profile.glucose_unit)}
          status={status}
          dot={false}
          style={{ marginEnd: SPACE.md }}
        />
        <View className="flex-1" style={{ minWidth: 0 }}>
          {/* Health-sourced rows read as a secondary "where this came from"
              badge (muted tone, same as the app's other secondary text) - not
              a bold clinical classification like a period tag. */}
          <Txt
            kind="caption"
            tone={isHealthSource ? "muted" : "text"}
            style={{ fontWeight: "700" }}
          >
            <Ionicons name="water" size={11} color={color} />{" "}
            {sourceLabel}
          </Txt>
          {status === "low" ? (
            <Text style={[TYPE.micro, { color, fontWeight: "800" }]}>
              {t("journal.lowBadge")}
            </Text>
          ) : null}
          <TagBadges tags={entry.tags} />
        </View>
        {/* The time is the row's right edge. It never shrinks (a clock is short
            and font shrinking clips on Android); the text column beside it wraps. */}
        <Txt
          kind="micro"
          tone="muted"
          tabular
          style={{ marginStart: SPACE.sm, flexShrink: 0, fontWeight: "400" }}
          numberOfLines={1}
        >
          {formatTime(entry.logged_at)}
        </Txt>
      </Row>
    );
  }

  if (entry.kind === "injection") {
    const typeLabel =
      entry.insulin_type === "basal"
        ? t("injection.typeBasal")
        : entry.insulin_type === "bolus"
          ? t("injection.typeBolus")
          : null;
    const label = [
      entry.dose_units != null
        ? `${num(entry.dose_units)} ${t("common.units")}`
        : null,
      entry.site ? t(`injectionSite.${entry.site}`) : t("injectionSite.unassigned"),
      typeLabel,
      formatTime(entry.logged_at),
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={THEME.accent}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
        <IconTile icon="medical" size={30} radius={10} style={{ marginEnd: SPACE.md }} />
        {entry.dose_units != null ? (
          <View
            style={[
              {
                borderRadius: 9,
                paddingHorizontal: SPACE.sm,
                paddingVertical: SPACE.xs,
                marginEnd: SPACE.sm,
                backgroundColor: withAlpha(THEME.accent, 0.16),
              },
              glow(THEME.accent, 10, 0.35),
            ]}
          >
            <Txt kind="micro" tone="accent" tabular style={{ fontWeight: "800" }}>
              {num(entry.dose_units)} {t("common.units")}
            </Txt>
          </View>
        ) : null}
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt kind="caption" numberOfLines={2} style={{ fontWeight: "700" }}>
            {entry.site
              ? t(`injectionSite.${entry.site}`)
              : t("injectionSite.unassigned")}
            {typeLabel ? ` · ${typeLabel}` : ""}
          </Txt>
          {entry.note ? (
            <Txt kind="micro" tone="muted" style={{ fontStyle: "italic", fontWeight: "400" }} numberOfLines={2}>
              {`“${entry.note}”`}
            </Txt>
          ) : null}
          <TagBadges tags={entry.tags} />
        </View>
        <Txt
          kind="micro"
          tone="muted"
          tabular
          style={{ marginStart: SPACE.sm, flexShrink: 0, fontWeight: "400" }}
          numberOfLines={1}
        >
          {formatTime(entry.logged_at)}
        </Txt>
      </Row>
    );
  }

  if (entry.kind === "med") {
    const label = [
      entry.name ? `${t("meds.entryLabel")} · ${entry.name}` : t("meds.entryLabel"),
      formatTime(entry.logged_at),
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <Row
        {...chrome}
        accent={THEME.accent}
        label={label}
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
      >
        {/* IconTile only carries Ionicons; a pill glyph lives in
            MaterialCommunityIcons, so this tile matches IconTile's look by
            hand instead of forcing "medical"/"medkit" onto a row that would
            then read the same as the injection row above it. */}
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: THEME.border,
            backgroundColor: THEME.surface,
            marginEnd: SPACE.md,
          }}
        >
          <MaterialCommunityIcons name="pill" size={16} color={THEME.accent} />
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt kind="caption" numberOfLines={2} style={{ fontWeight: "700" }}>
            {entry.name ? `${t("meds.entryLabel")} · ${entry.name}` : t("meds.entryLabel")}
          </Txt>
        </View>
        <Txt
          kind="micro"
          tone="muted"
          tabular
          style={{ marginStart: SPACE.sm, flexShrink: 0, fontWeight: "400" }}
          numberOfLines={1}
        >
          {formatTime(entry.logged_at)}
        </Txt>
      </Row>
    );
  }

  // meal entry: neutral (muted) accent, on-palette instead of slate hexes.
  const mealLabel = [
    entry.display_name,
    hasMealWeight(entry.portion_g) ? `${Math.round(entry.portion_g)} ${t("common.grams")}` : null,
    t("journal.carbsLabel", {
      carbs: num(Math.round(entry.calculated_carbs_g * 10) / 10),
    }),
    entry.insulin_dose_units > 0
      ? t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })
      : null,
    formatTime(entry.logged_at),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Row
      {...chrome}
      accent={THEME.textMuted}
      label={mealLabel}
      onPress={() => onPress?.(entry)}
      onLongPress={() => onLongPress?.(entry)}
    >
      {entry.photo_uri_local ? (
        <Image
          source={{
            uri: entry.photo_uri_local,
            width: MEAL_THUMB_DECODE_PX,
            height: MEAL_THUMB_DECODE_PX,
          }}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          style={{
            width: MEAL_THUMB_DP,
            height: MEAL_THUMB_DP,
            borderRadius: 10,
            marginEnd: SPACE.md,
          }}
        />
      ) : (
        // Shared food plate: the emoji always travels with an Ionicons fallback,
        // so a category the emoji map does not know (or a device without an
        // emoji font) still shows a picture instead of a blank box.
        <FoodPlate
          category={entry.category}
          size={MEAL_THUMB_DP}
          radius={10}
          style={{ marginEnd: SPACE.md }}
        />
      )}
      <View className="flex-1" style={{ minWidth: 0 }}>
        {/* Food name is user data: wraps to two lines rather than clipping. */}
        <Txt kind="caption" numberOfLines={2} style={{ fontWeight: "700" }}>
          {entry.display_name}
        </Txt>
        <Txt kind="micro" tone="muted" style={{ fontWeight: "400" }}>
          {hasMealWeight(entry.portion_g)
            ? `${Math.round(entry.portion_g)} ${t("common.grams")} · `
            : ""}
          {t("journal.carbsLabel", {
            carbs: num(Math.round(entry.calculated_carbs_g * 10) / 10),
          })}
          {entry.insulin_dose_units > 0
            ? ` · ${t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })}`
            : ""}
        </Txt>
        {entry.personal_note ? (
          <Txt kind="micro" tone="muted" style={{ fontStyle: "italic", fontWeight: "400" }} numberOfLines={2}>
            “{entry.personal_note}”
          </Txt>
        ) : null}
        <TagBadges tags={entry.tags} />
      </View>
      <View className="items-end" style={{ marginStart: SPACE.sm, flexShrink: 0 }}>
        <Txt kind="micro" tone="muted" tabular style={{ fontWeight: "400" }} numberOfLines={1}>
          {formatTime(entry.logged_at)}
        </Txt>
        {hasResponse && onOpenResponse ? (
          // Nested inside the row's own Pressable, so it has to be an
          // unmistakable target of its own: 14pt + hitSlop 8 came to ~30pt, and a
          // near-miss silently opened the row's edit flow instead. The slop
          // carries it to 44pt without making the row taller.
          <Pressable
            onPress={() => onOpenResponse(entry)}
            hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={t("mealResponse.title")}
            style={{ marginTop: SPACE.xs }}
          >
            <Ionicons name="pulse-outline" size={16} color={THEME.accent} />
          </Pressable>
        ) : null}
      </View>
    </Row>
  );
}

/**
 * Memoized: a journal row's output is a pure function of its entry, the profile's
 * targets and its two flags. The dashboard re-renders on plenty of things a row
 * knows nothing about (a ticking timer, a sheet opening, a filter chip), and each
 * of those used to re-render every visible row - including re-decoding every meal
 * photo above. The callback props are already identity-stable on the caller side
 * (a ref-backed wrapper), so the default shallow compare is enough.
 */
export const JournalItem = React.memo(JournalItemBase);
