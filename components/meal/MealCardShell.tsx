import React, { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";

import { SWIPE_DRAG_OFFSET, SWIPE_FRICTION } from "../../lib/swipeAction";
import { THEME } from "../../lib/theme/tokens";
import { FoodPlate } from "../FoodPlate";

const DELETE_W = 84;

/**
 * The card both the food cards and the estimate cards sit in: plate, a title
 * slot, a right-hand figure slot, a small remove button, children underneath.
 * Swipe left deletes (react-native-gesture-handler is already mounted at the
 * app root); the visible remove button is the way in for anyone who does not
 * swipe (the swipe panel is hidden from assistive tech while the card is closed).
 */
export function MealCardShell({
  category,
  title,
  figure,
  removeLabel,
  onRemove,
  children,
}: {
  category: string;
  title: React.ReactNode;
  figure: React.ReactNode;
  removeLabel: string;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const swipeRef = useRef<SwipeableMethods>(null);

  return (
    <View style={{ marginBottom: 8, borderRadius: 16, overflow: "hidden" }}>
      <ReanimatedSwipeable
        ref={swipeRef}
        friction={SWIPE_FRICTION}
        dragOffsetFromLeftEdge={SWIPE_DRAG_OFFSET}
        dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}
        overshootRight={false}
        rightThreshold={DELETE_W * 0.7}
        renderRightActions={() => (
          <Pressable
            onPress={() => {
              swipeRef.current?.close();
              onRemove();
            }}
            accessibilityRole="button"
            accessibilityLabel={removeLabel}
            style={{
              width: DELETE_W,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: THEME.dangerFill,
            }}
          >
            <Ionicons name="trash-outline" size={18} color={THEME.onDanger} />
            <Text
              numberOfLines={1}
              style={{ color: THEME.onDanger, fontSize: 11, fontWeight: "700", marginTop: 3 }}
            >
              {t("common.delete")}
            </Text>
          </Pressable>
        )}
      >
        <View
          className="bg-glass border border-hair"
          style={{ borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <FoodPlate category={category} size={36} radius={12} style={{ marginRight: 10 }} />
            <View style={{ flex: 1, paddingEnd: 8 }}>{title}</View>
            {figure}
            <Pressable
              onPress={onRemove}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={removeLabel}
              style={{
                minWidth: 32,
                minHeight: 32,
                marginStart: 4,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close-circle" size={20} color={THEME.textMuted} />
            </Pressable>
          </View>
          {children ? <View style={{ marginTop: 10 }}>{children}</View> : null}
        </View>
      </ReanimatedSwipeable>
    </View>
  );
}
