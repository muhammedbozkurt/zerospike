import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, Easing, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

type ToastKind = "success" | "info" | "error";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SheetAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}
interface ActionSheetOptions {
  title?: string;
  actions: SheetAction[];
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  actionSheet: (opts: ActionSheetOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

const TOAST_STYLE: Record<
  ToastKind,
  { icon: keyof typeof Ionicons.glyphMap; color: string; border: string }
> = {
  success: { icon: "checkmark-circle", color: "#10b981", border: "border-emerald-500/40" },
  info: { icon: "information-circle", color: "#22d3ee", border: "border-brand/40" },
  error: { icon: "alert-circle", color: "#f43f5e", border: "border-rose-500/40" },
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  // Toast state
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState<ToastKind>("success");
  const toastAnim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirm state
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  // Action sheet state
  const [sheet, setSheet] = useState<ActionSheetOptions | null>(null);

  const actionSheet = useCallback((opts: ActionSheetOptions) => {
    setSheet(opts);
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      setToastMsg(message);
      setToastKind(kind);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, 2200);
    },
    [toastAnim]
  );

  const confirm = useCallback((opts: ConfirmOptions) => {
    setConfirmOpts(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function closeConfirm(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setConfirmOpts(null);
  }

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const ts = TOAST_STYLE[toastKind];

  return (
    <FeedbackContext.Provider value={{ toast, confirm, actionSheet }}>
      {children}

      {/* Toast */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 90,
          opacity: toastAnim,
          transform: [
            {
              translateY: toastAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [24, 0],
              }),
            },
          ],
        }}
      >
        <View
          className={`flex-row items-center rounded-2xl bg-zinc-900 border ${ts.border} px-4 py-3.5`}
        >
          <Ionicons name={ts.icon} size={20} color={ts.color} />
          <Text className="text-zinc-100 font-medium ml-3 flex-1">{toastMsg}</Text>
        </View>
      </Animated.View>

      {/* Confirm dialog */}
      <Modal
        visible={!!confirmOpts}
        transparent
        animationType="fade"
        onRequestClose={() => closeConfirm(false)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-center px-8"
          onPress={() => closeConfirm(false)}
        >
          <Pressable
            className="rounded-3xl bg-zinc-900 border border-zinc-800 p-5"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-3">
              <View
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  confirmOpts?.destructive ? "bg-rose-500/15" : "bg-brand/15"
                }`}
              >
                <Ionicons
                  name={
                    confirmOpts?.icon ??
                    (confirmOpts?.destructive ? "trash-outline" : "help-circle-outline")
                  }
                  size={24}
                  color={confirmOpts?.destructive ? "#f43f5e" : "#22d3ee"}
                />
              </View>
            </View>

            {confirmOpts?.title ? (
              <Text className="text-zinc-50 text-lg font-bold text-center mb-1.5">
                {confirmOpts.title}
              </Text>
            ) : null}
            <Text className="text-zinc-300 text-center text-[15px] leading-5 mb-5">
              {confirmOpts?.message}
            </Text>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => closeConfirm(false)}
                className="flex-1 rounded-2xl bg-zinc-800 active:bg-zinc-700 py-3.5 items-center"
              >
                <Text className="text-zinc-100 font-semibold">
                  {confirmOpts?.cancelLabel ?? t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => closeConfirm(true)}
                className={`flex-1 rounded-2xl py-3.5 items-center ${
                  confirmOpts?.destructive ? "bg-rose-500 active:bg-rose-600" : "bg-brand active:bg-brandDark"
                }`}
              >
                <Text className="text-black font-semibold">
                  {confirmOpts?.confirmLabel ?? t("common.confirm")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Action sheet */}
      <Modal
        visible={!!sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-end"
          onPress={() => setSheet(null)}
        >
          <Pressable
            className="rounded-t-3xl bg-zinc-950 border-t border-x border-zinc-800 px-4 pt-3 pb-8"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-zinc-700" />
            </View>
            {sheet?.title ? (
              <Text className="text-zinc-400 text-center text-sm py-2">
                {sheet.title}
              </Text>
            ) : null}
            {sheet?.actions.map((a, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  setSheet(null);
                  a.onPress();
                }}
                className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3.5 mb-2 active:bg-zinc-800"
              >
                {a.icon ? (
                  <Ionicons
                    name={a.icon}
                    size={20}
                    color={a.destructive ? "#f43f5e" : "#22d3ee"}
                  />
                ) : null}
                <Text
                  className={`ml-3 font-medium text-base ${
                    a.destructive ? "text-rose-400" : "text-zinc-100"
                  }`}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setSheet(null)}
              className="rounded-2xl bg-zinc-800 active:bg-zinc-700 px-4 py-3.5 mt-1 items-center"
            >
              <Text className="text-zinc-300 font-semibold">{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}
