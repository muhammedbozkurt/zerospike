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
  AccessibilityInfo,
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

import {
  activeHostId,
  popHost,
  pushHost,
  shouldStackButtons,
  UNDO_TOAST_MS,
  UNDO_TOAST_SCREEN_READER_MS,
} from "../lib/feedback";
import { GLUCOSE_RICH, THEME, RADIUS, ELEVATION } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";

type ToastKind = "success" | "info" | "error";

/** An optional single action on a toast, e.g. "Undo" on an auto-created entry. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface SheetAction {
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
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
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
  toastAction: ToastAction | null;
  runToastAction: () => void;
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

/** Mockup 10: a glass card with a glowing status dot, tinted per kind. */
function toastStyle(kind: ToastKind): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (kind) {
    case "success":
      return { icon: "checkmark-circle", color: GLUCOSE_RICH.target };
    case "info":
      return { icon: "information-circle", color: THEME.accent };
    default:
      return { icon: "alert-circle", color: GLUCOSE_RICH.low };
  }
}

/** How long a toast stays up. */
const TOAST_MS = 2200;
/**
 * A toast that carries an action stays up as long as UNDO_TOAST_MS
 * (lib/feedback.ts), the same window the undo-batch accumulation
 * (useUndoBatch) restores against - the two are one shared pair of constants
 * so they can never drift apart again (see that file's own note).
 *
 * With a screen reader on, that window was not an undo model at all: the toast is
 * painted, not focused, so the announcement lands mid-sentence, the user then has
 * to swipe to the button, and the normal window is gone before they reach it. The
 * whole "you can take that back" affordance was effectively unavailable to them.
 */
const TOAST_ACTION_MS = UNDO_TOAST_MS;
const TOAST_ACTION_SCREEN_READER_MS = UNDO_TOAST_SCREEN_READER_MS;

/** Widest a full-bleed action sheet gets on a tablet before it stops
 *  stretching and centres (same cap as components/GlucoseInputSheet.tsx's
 *  SHEET_MAX_WIDTH). */
const SHEET_MAX_WIDTH = 600;
/** Cap for a centered, content-sized dialog card on a tablet (ConfirmOverlay). */
const DIALOG_MAX_WIDTH = 520;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  // Toast state
  const [toastMsg, setToastMsg] = useState("");
  const [toastKind, setToastKind] = useState<ToastKind>("success");
  const [toastAction, setToastAction] = useState<ToastAction | null>(null);
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

  // Whether a screen reader is running. Read once and kept current, because
  // `toast` is synchronous and cannot await the query.
  const screenReaderOn = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (alive) screenReaderOn.current = on;
      })
      .catch(() => {
        // treat an unavailable probe as "off"; the timings stay as they were
      });
    const sub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (on) => {
        screenReaderOn.current = on;
      }
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success", action?: ToastAction) => {
      setToastMsg(message);
      setToastKind(kind);
      setToastAction(action ?? null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      // A toast is painted into an overlay and never takes focus, so a screen
      // reader user got NO feedback at all that their save/delete/undo landed.
      // Announce it, and name the action so they know one is on offer.
      try {
        AccessibilityInfo.announceForAccessibility(
          action ? `${message}. ${action.label}` : message
        );
      } catch {
        // announcing is best-effort; the visual toast is unaffected
      }

      const visibleMs = action
        ? screenReaderOn.current
          ? TOAST_ACTION_SCREEN_READER_MS
          : TOAST_ACTION_MS
        : TOAST_MS;
      hideTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
        setToastAction(null);
      }, visibleMs);
    },
    [toastAnim]
  );

  /** Runs the toast's action once, then dismisses it. */
  const runToastAction = useCallback(() => {
    const action = toastAction;
    setToastAction(null);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(toastAnim, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
    action?.onPress();
  }, [toastAction, toastAnim]);

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
      toastAction,
      runToastAction,
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
      toastAction,
      runToastAction,
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
  const insets = useSafeAreaInsets();
  if (!internal) return null;
  const {
    toastMsg,
    toastKind,
    toastAction,
    runToastAction,
    toastAnim,
    confirmOpts,
    closeConfirm,
    sheet,
    closeSheet,
    runSheetAction,
  } = internal;
  const ts = toastStyle(toastKind);

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
    >
      {confirmOpts ? (
        <ConfirmOverlay opts={confirmOpts} onClose={closeConfirm} />
      ) : null}

      {sheet ? (
        <SheetOverlay sheet={sheet} onClose={closeSheet} onRun={runSheetAction} />
      ) : null}

      {/* Toast enters from the TOP, clear of the tab bar and any bottom CTA bar,
          and survives the screen that fired it. Solid dark surface (not a 5%
          glass) so it reads over any background; the kind color is only the left
          strip + icon. It accepts touches only while it carries an action. */}
      <Animated.View
        pointerEvents={toastAction ? "box-none" : "none"}
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          top: insets.top + 8,
          opacity: toastAnim,
          transform: [
            {
              translateY: toastAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [-24, 0],
              }),
            },
          ],
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: THEME.surfaceRaised,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: `${ts.color}55`,
            paddingVertical: 12,
            paddingHorizontal: 14,
            overflow: "hidden",
            ...ELEVATION.card,
          }}
        >
          {/* Kind color as a left strip only (never the fill) */}
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: ts.color,
            }}
          />
          <Ionicons name={ts.icon} size={18} color={ts.color} style={{ marginLeft: 4 }} />
          <Text
            accessible
            accessibilityRole="text"
            style={{ color: THEME.text, fontWeight: "600", marginLeft: 10, flex: 1 }}
          >
            {toastMsg}
          </Text>
          {toastAction ? (
            <Pressable
              onPress={runToastAction}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={toastAction.label}
              style={{
                marginLeft: 10,
                minHeight: 44,
                justifyContent: "center",
                backgroundColor: THEME.accentFill,
                borderRadius: RADIUS.full,
                paddingHorizontal: 14,
                paddingVertical: 7,
              }}
            >
              <Text style={{ color: THEME.accentOnFill, fontWeight: "800", fontSize: 13 }}>
                {toastAction.label}
              </Text>
            </Pressable>
          ) : null}
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
  const { isWide } = useLayout();
  const anim = useEnterAnim();
  const dismiss = useCallback(() => onClose(false), [onClose]);
  useBackHandler(dismiss);

  useEffect(() => {
    try {
      AccessibilityInfo.announceForAccessibility(
        opts.title ? `${opts.title}. ${opts.message}` : opts.message
      );
    } catch {
      // announcing is best-effort; the visible dialog is unaffected
    }
    // once, on open: the dialog never takes focus by itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmLabel = opts.confirmLabel ?? t("common.confirm");
  const cancelLabel = opts.cancelLabel ?? t("common.cancel");
  const stacked = shouldStackButtons(confirmLabel, cancelLabel);

  // Stacked, the primary action leads and each button owns the full width.
  // Side by side, cancel sits left of the primary and they share the row.
  const width = stacked ? "w-full" : "flex-1";

  const cancelButton = (
    <Pressable
      onPress={dismiss}
      accessibilityRole="button"
      accessibilityLabel={cancelLabel}
      className={`${width} rounded-2xl bg-glass border border-hair active:opacity-80 py-3.5 px-3`}
    >
      <DialogLabel className="text-ink font-semibold">{cancelLabel}</DialogLabel>
    </Pressable>
  );

  const confirmButton = (
    <Pressable
      onPress={() => onClose(true)}
      accessibilityRole="button"
      accessibilityLabel={confirmLabel}
      className={`${width} rounded-2xl py-3.5 px-3 ${
        opts.destructive
          ? "bg-dangerFill active:opacity-80"
          : "bg-brand active:bg-brandDark"
      }`}
    >
      <DialogLabel
        className={`font-semibold ${opts.destructive ? "text-onDanger" : "text-onAccent"}`}
      >
        {confirmLabel}
      </DialogLabel>
    </Pressable>
  );

  return (
    // accessibilityViewIsModal: without it VoiceOver kept swiping straight past
    // the dialog into the screen underneath, so a destructive confirmation could
    // be answered by tapping a control it was supposed to be blocking.
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: anim }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={dismiss}
    >
      <Pressable
        className="flex-1 bg-black/70 justify-center px-8"
        onPress={dismiss}
        accessible={false}
        focusable={false}
      >
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
            className="rounded-3xl border border-hair p-5"
            style={[
              {
                backgroundColor: THEME.surfaceRaised,
                shadowColor: ELEVATION.sheet.shadowColor,
                shadowOpacity: 0.5,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: 12 },
                elevation: 16,
              },
              isWide ? { maxWidth: DIALOG_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
          >
            <View className="items-center mb-3">
              <View
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  opts.destructive ? "bg-low/15" : "bg-brand/15"
                }`}
              >
                <Ionicons
                  name={
                    opts.icon ??
                    (opts.destructive ? "trash-outline" : "help-circle-outline")
                  }
                  size={24}
                  color={opts.destructive ? GLUCOSE_RICH.low : THEME.accent}
                />
              </View>
            </View>

            {opts.title ? (
              <Text
                accessibilityRole="header"
                className="text-ink text-lg font-bold text-center mb-1.5"
              >
                {opts.title}
              </Text>
            ) : null}
            <Text className="text-mut text-center text-[15px] leading-5 mb-5">
              {opts.message}
            </Text>

            {stacked ? (
              <View className="gap-2.5">
                {confirmButton}
                {cancelButton}
              </View>
            ) : (
              <View className="flex-row gap-3">
                {cancelButton}
                {confirmButton}
              </View>
            )}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A button label that shrinks rather than wrapping or clipping. The full width
 * bounds the text so adjustsFontSizeToFit has something to shrink against.
 */
function DialogLabel({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
      className={`w-full text-center ${className}`}
    >
      {children}
    </Text>
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
  const { isWide } = useLayout();
  const anim = useEnterAnim();
  useBackHandler(onClose);

  return (
    // See ConfirmOverlay: the sheet has to own accessibility focus, or a screen
    // reader walks past its options into the list it is covering.
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: anim }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
    >
      <Pressable
        className="flex-1 bg-black/70 justify-end"
        onPress={onClose}
        accessible={false}
        focusable={false}
      >
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
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={[
              {
                backgroundColor: THEME.bg.base,
                paddingBottom: insets.bottom + 20,
              },
              isWide ? { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center" } : undefined,
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-hair" />
            </View>
            {sheet.title ? (
              <Text className="text-mut text-center text-sm py-2">
                {sheet.title}
              </Text>
            ) : null}
            {sheet.actions.map((a, i) => (
              <Pressable
                key={i}
                onPress={() => onRun(a)}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                className="flex-row items-center rounded-2xl bg-glass border border-hair px-4 py-3.5 mb-2 active:opacity-80"
              >
                {a.icon ? (
                  <Ionicons
                    name={a.icon}
                    size={20}
                    color={a.destructive ? GLUCOSE_RICH.low : THEME.accent}
                  />
                ) : null}
                {/* A sheet option is one tappable line. The longest of these
                    ("In 15 Minuten ans erneute Messen erinnern") shrinks to fit
                    rather than wrapping under the icon. */}
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  className={`flex-1 ${a.icon ? "ml-3" : ""} font-medium text-base ${
                    a.destructive ? "text-low" : "text-ink"
                  }`}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("common.cancel")}
              className="rounded-2xl bg-glass border border-hair active:opacity-80 px-4 py-3.5 mt-1"
            >
              <DialogLabel className="text-mut font-semibold">
                {t("common.cancel")}
              </DialogLabel>
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
