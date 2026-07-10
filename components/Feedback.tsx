import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { activeHostId, popHost, pushHost } from "../lib/feedbackHost";

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

/**
 * The overlays are deliberately NOT an RN <Modal>. On iOS a <Modal> asks the
 * root view controller to present, and a view controller that is already
 * presenting a modal screen (every `presentation: "modal"` route) silently
 * refuses the second presentation: the dialog never appears, its state stays
 * open, and it pops up (swallowing every touch) once the screen above it is
 * dismissed. Instead the provider only holds state, and a <FeedbackHost />
 * inside each modal screen paints an absolute overlay within that screen's own
 * view controller.
 */
interface FeedbackInternal {
  hosts: readonly number[];
  registerHost: (id: number) => void;
  unregisterHost: (id: number) => void;
  toastMsg: string;
  toastKind: ToastKind;
  toastAnim: Animated.Value;
  confirmOpts: ConfirmOptions | null;
  closeConfirm: (result: boolean) => void;
  sheet: ActionSheetOptions | null;
  closeSheet: () => void;
  runSheetAction: (action: SheetAction) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);
const FeedbackInternalContext = createContext<FeedbackInternal | null>(null);

let nextHostId = 0;

const TOAST_STYLE: Record<
  ToastKind,
  { icon: keyof typeof Ionicons.glyphMap; color: string; border: string }
> = {
  success: { icon: "checkmark-circle", color: "#10b981", border: "border-emerald-500/40" },
  info: { icon: "information-circle", color: "#22d3ee", border: "border-brand/40" },
  error: { icon: "alert-circle", color: "#f43f5e", border: "border-rose-500/40" },
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
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

  // Which host was on top when each overlay opened. When that host goes away
  // (its screen closed) the overlay dies with it instead of leaking onto the
  // next screen with a promise nobody will ever settle.
  const confirmOwner = useRef<number | null>(null);
  const sheetOwner = useRef<number | null>(null);

  // hostsRef mirrors `hosts` so callbacks read the stack without re-creating.
  const [hosts, setHosts] = useState<readonly number[]>([]);
  const hostsRef = useRef<readonly number[]>([]);

  const closeConfirm = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    confirmOwner.current = null;
    setConfirmOpts(null);
  }, []);

  const closeSheet = useCallback(() => {
    sheetOwner.current = null;
    setSheet(null);
  }, []);

  const registerHost = useCallback((id: number) => {
    hostsRef.current = pushHost(hostsRef.current, id);
    setHosts(hostsRef.current);
  }, []);

  const unregisterHost = useCallback(
    (id: number) => {
      hostsRef.current = popHost(hostsRef.current, id);
      setHosts(hostsRef.current);
      if (confirmOwner.current === id) closeConfirm(false);
      if (sheetOwner.current === id) closeSheet();
    },
    [closeConfirm, closeSheet]
  );

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
    // A dialog left dangling by a previous caller never blocks a new one.
    resolver.current?.(false);
    confirmOwner.current = activeHostId(hostsRef.current);
    setConfirmOpts(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const actionSheet = useCallback((opts: ActionSheetOptions) => {
    sheetOwner.current = activeHostId(hostsRef.current);
    setSheet(opts);
  }, []);

  const runSheetAction = useCallback(
    (action: SheetAction) => {
      closeSheet();
      action.onPress();
    },
    [closeSheet]
  );

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({ toast, confirm, actionSheet }),
    [toast, confirm, actionSheet]
  );

  const internal = useMemo<FeedbackInternal>(
    () => ({
      hosts,
      registerHost,
      unregisterHost,
      toastMsg,
      toastKind,
      toastAnim,
      confirmOpts,
      closeConfirm,
      sheet,
      closeSheet,
      runSheetAction,
    }),
    [
      hosts,
      registerHost,
      unregisterHost,
      toastMsg,
      toastKind,
      toastAnim,
      confirmOpts,
      closeConfirm,
      sheet,
      closeSheet,
      runSheetAction,
    ]
  );

  return (
    <FeedbackContext.Provider value={api}>
      <FeedbackInternalContext.Provider value={internal}>
        {children}
      </FeedbackInternalContext.Provider>
    </FeedbackContext.Provider>
  );
}

/**
 * Paints toast / confirm / action sheet inside the view controller it lives in.
 * The root layout mounts one; so does every screen presented as a native modal.
 * Only the most recently mounted host paints, so there is never a duplicate.
 * Place it as the LAST child of an unpadded, flex-1 screen root.
 */
export function FeedbackHost() {
  const internal = useContext(FeedbackInternalContext);
  const idRef = useRef(-1);
  if (idRef.current < 0) idRef.current = nextHostId++;
  const id = idRef.current;

  const register = internal?.registerHost;
  const unregister = internal?.unregisterHost;

  useEffect(() => {
    if (!register || !unregister) return;
    register(id);
    return () => unregister(id);
  }, [id, register, unregister]);

  if (!internal || activeHostId(internal.hosts) !== id) return null;
  return <FeedbackOverlays />;
}

function FeedbackOverlays() {
  const internal = useContext(FeedbackInternalContext);
  if (!internal) return null;
  const { toastMsg, toastKind, toastAnim, confirmOpts, closeConfirm, sheet } = internal;
  const ts = TOAST_STYLE[toastKind];

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
    >
      {confirmOpts ? (
        <ConfirmOverlay opts={confirmOpts} onClose={closeConfirm} />
      ) : null}

      {sheet ? (
        <SheetOverlay
          sheet={sheet}
          onClose={internal.closeSheet}
          onRun={internal.runSheetAction}
        />
      ) : null}

      {/* Toast rides above the dialogs, and survives the screen that fired it. */}
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
    </View>
  );
}

/** Entrance animation shared by both overlays; there is no exit animation. */
function useEnterAnim(): Animated.Value {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  return anim;
}

/** Android's hardware back closes the overlay instead of popping the screen. */
function useBackHandler(onBack: () => void) {
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);
}

function ConfirmOverlay({
  opts,
  onClose,
}: {
  opts: ConfirmOptions;
  onClose: (result: boolean) => void;
}) {
  const { t } = useTranslation();
  const anim = useEnterAnim();
  const dismiss = useCallback(() => onClose(false), [onClose]);
  useBackHandler(dismiss);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
      <Pressable className="flex-1 bg-black/70 justify-center px-8" onPress={dismiss}>
        <Animated.View
          style={{
            transform: [
              {
                scale: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          }}
        >
          <Pressable
            className="rounded-3xl bg-zinc-900 border border-zinc-800 p-5"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-3">
              <View
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  opts.destructive ? "bg-rose-500/15" : "bg-brand/15"
                }`}
              >
                <Ionicons
                  name={
                    opts.icon ??
                    (opts.destructive ? "trash-outline" : "help-circle-outline")
                  }
                  size={24}
                  color={opts.destructive ? "#f43f5e" : "#22d3ee"}
                />
              </View>
            </View>

            {opts.title ? (
              <Text className="text-zinc-50 text-lg font-bold text-center mb-1.5">
                {opts.title}
              </Text>
            ) : null}
            <Text className="text-zinc-300 text-center text-[15px] leading-5 mb-5">
              {opts.message}
            </Text>

            <View className="flex-row gap-3">
              <Pressable
                onPress={dismiss}
                className="flex-1 rounded-2xl bg-zinc-800 active:bg-zinc-700 py-3.5 items-center"
              >
                <Text className="text-zinc-100 font-semibold">
                  {opts.cancelLabel ?? t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onClose(true)}
                className={`flex-1 rounded-2xl py-3.5 items-center ${
                  opts.destructive
                    ? "bg-rose-500 active:bg-rose-600"
                    : "bg-brand active:bg-brandDark"
                }`}
              >
                <Text className="text-black font-semibold">
                  {opts.confirmLabel ?? t("common.confirm")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function SheetOverlay({
  sheet,
  onClose,
  onRun,
}: {
  sheet: ActionSheetOptions;
  onClose: () => void;
  onRun: (action: SheetAction) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const anim = useEnterAnim();
  useBackHandler(onClose);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
      <Pressable className="flex-1 bg-black/70 justify-end" onPress={onClose}>
        <Animated.View
          style={{
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, 0],
                }),
              },
            ],
          }}
        >
          <Pressable
            className="rounded-t-3xl bg-zinc-950 border-t border-x border-zinc-800 px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 20 }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-zinc-700" />
            </View>
            {sheet.title ? (
              <Text className="text-zinc-400 text-center text-sm py-2">
                {sheet.title}
              </Text>
            ) : null}
            {sheet.actions.map((a, i) => (
              <Pressable
                key={i}
                onPress={() => onRun(a)}
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
              onPress={onClose}
              className="rounded-2xl bg-zinc-800 active:bg-zinc-700 px-4 py-3.5 mt-1 items-center"
            >
              <Text className="text-zinc-300 font-semibold">{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within FeedbackProvider");
  return ctx;
}
