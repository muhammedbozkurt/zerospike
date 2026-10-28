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
  ScrollView,
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
import {
  initialToastState,
  reduceToast,
  toastVisibleMs,
  TOAST_MAX_WIDTH,
  type ToastEffect,
  type ToastEvent,
  type ToastState,
} from "../lib/toastQueue";
import { GLUCOSE_RICH, THEME, RADIUS, ELEVATION } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { animateFade, isReducedMotionNow } from "../lib/useReducedMotion";
import { STACK_AT_SCALE } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";
import { sheetBoxStyle } from "../lib/tabletLayout";
import { logCrash } from "../lib/analytics";
import { ToastCard, type ToastKind } from "./ToastCard";
import { useToastBottom } from "./useToastBottom";

/** An optional single action on a toast, e.g. "Undo" on an auto-created entry. */
export interface ToastAction {
  label: string;
  onPress: () => void | Promise<void>;
  /** A second, quieter button next to the primary one (e.g. "Undo" beside
   *  "Add region"). Same run-once-then-dismiss behaviour as the primary. */
  secondary?: { label: string; onPress: () => void | Promise<void> };
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

/** What the overlay paints: choose() sets dismissAsNull. */
type OpenConfirm = ConfirmOptions & { dismissAsNull?: boolean };

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Like confirm, but dismissing the dialog (backdrop, Android back, screen
   *  reader escape) resolves null instead of false, so a caller whose cancel
   *  button is a real answer can tell the two apart. */
  choose: (opts: ConfirmOptions) => Promise<boolean | null>;
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
  runToastAction: (which?: "secondary") => void;
  toastAnim: Animated.Value;
  confirmOpts: OpenConfirm | null;
  closeConfirm: (result: boolean | null) => void;
  sheet: ActionSheetOptions | null;
  closeSheet: () => void;
  runSheetAction: (action: SheetAction) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);
const FeedbackInternalContext = createContext<FeedbackInternal | null>(null);

let nextHostId = 0;

/** Pause before the generic "undone" confirmation, see runToastAction. */
const UNDONE_CONFIRM_DELAY_MS = 400;

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

/** Cap for a centered, content-sized dialog card on a tablet (ConfirmOverlay). */
const DIALOG_MAX_WIDTH = 520;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  // Toast state: one slot (lib/toastQueue.ts), one Animated.Value, one timer.
  const [toastState, setToastState] = useState<ToastState<ToastAction>>(initialToastState);
  const toastRef = useRef<ToastState<ToastAction>>(toastState);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastMsg = toastState.current?.message ?? "";
  const toastKind = (toastState.current?.kind ?? "success") as ToastKind;
  const toastAction = toastState.current?.action ?? null;

  // Confirm state
  const [confirmOpts, setConfirmOpts] = useState<OpenConfirm | null>(null);
  const resolver = useRef<((v: boolean | null) => void) | null>(null);
  // Set while the open dialog came from choose(): abandoning it yields null.
  const resolverIsChoose = useRef(false);

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

  const closeConfirm = useCallback((result: boolean | null) => {
    resolver.current?.(result);
    resolver.current = null;
    resolverIsChoose.current = false;
    confirmOwner.current = null;
    setConfirmOpts(null);
  }, []);
  const abandonConfirm = useCallback(
    () => closeConfirm(resolverIsChoose.current ? null : false),
    [closeConfirm]
  );

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
      if (confirmOwner.current === id) abandonConfirm();
      if (sheetOwner.current === id) closeSheet();
    },
    [abandonConfirm, closeSheet]
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

  const dispatchToast = useCallback(
    (ev: ToastEvent<ToastAction>) => {
      const { state, effects } = reduceToast(toastRef.current, ev);
      toastRef.current = state;
      setToastState(state);
      effects.forEach((fx: ToastEffect) => {
        switch (fx.type) {
          case "disarm":
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = null;
            break;
          case "reset":
            toastAnim.stopAnimation();
            toastAnim.setValue(0);
            break;
          case "enter":
            if (fx.ms === 0) {
              toastAnim.stopAnimation();
              toastAnim.setValue(1);
              break;
            }
            Animated.timing(toastAnim, {
              toValue: 1,
              duration: fx.ms,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
            break;
          case "arm":
            hideTimer.current = setTimeout(() => {
              hideTimer.current = null;
              dispatchToast({ type: "hideDue", id: fx.id });
            }, fx.ms);
            break;
          case "exit":
            if (fx.ms === 0) {
              toastAnim.stopAnimation();
              toastAnim.setValue(0);
              dispatchToast({ type: "exitDone", id: fx.id, finished: true });
              break;
            }
            Animated.timing(toastAnim, {
              toValue: 0,
              duration: fx.ms,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }).start(({ finished }) => {
              dispatchToast({ type: "exitDone", id: fx.id, finished });
            });
            break;
        }
      });
    },
    [toastAnim]
  );

  // OS "Reduce Motion": the toast then appears and disappears in one frame.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) dispatchToast({ type: "motion", reduceMotion: on });
      })
      .catch(() => {
        // probe unavailable: keep the animated default
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      dispatchToast({ type: "motion", reduceMotion: on });
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [dispatchToast]);

  const toast = useCallback(
    (message: string, kind: ToastKind = "success", action?: ToastAction) => {
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

      const visibleMs = toastVisibleMs({
        hasAction: action != null,
        screenReader: screenReaderOn.current,
        plainMs: TOAST_MS,
        actionMs: TOAST_ACTION_MS,
        actionScreenReaderMs: TOAST_ACTION_SCREEN_READER_MS,
      });
      dispatchToast({ type: "show", message, kind, action: action ?? null, visibleMs });
    },
    [dispatchToast]
  );

  /** Runs the toast's action once, then dismisses it. */
  const runToastAction = useCallback((which?: "secondary") => {
    const cur = toastRef.current.current;
    if (!cur || !cur.action) return;
    const action = which === "secondary" && cur.action.secondary ? cur.action.secondary : cur.action;
    const isUndo = action.label === t("common.undo");
    dispatchToast({ type: "actionRun", id: cur.id });
    const confirmUndone = () => {
      if (!isUndo) return;
      // Most undo handlers are fire-and-forget async, so the promise settles
      // before the restore has. Waiting lets a caller that confirms (or reports a
      // failure) on its own go first; then nothing live may be overwritten.
      setTimeout(() => {
        const { phase } = toastRef.current;
        if (phase === "in" || phase === "shown") return;
        toast(t("calculator.undone"), "info");
      }, UNDONE_CONFIRM_DELAY_MS);
    };
    try {
      Promise.resolve(action.onPress())
        .then(confirmUndone)
        .catch((err) => {
          logCrash(err, { screen: "feedback", op: "toastAction" });
        });
    } catch (err) {
      logCrash(err, { screen: "feedback", op: "toastAction" });
    }
  }, [dispatchToast, toast, t]);

  const openConfirm = useCallback((opts: ConfirmOptions, isChoose: boolean) => {
    // A dialog left dangling by a previous caller never blocks a new one.
    resolver.current?.(resolverIsChoose.current ? null : false);
    resolverIsChoose.current = isChoose;
    confirmOwner.current = activeHostId(hostsRef.current);
    setConfirmOpts({ ...opts, dismissAsNull: isChoose });
    return new Promise<boolean | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const confirm = useCallback(
    (opts: ConfirmOptions) => openConfirm(opts, false) as Promise<boolean>,
    [openConfirm]
  );
  const choose = useCallback(
    (opts: ConfirmOptions) => openConfirm(opts, true),
    [openConfirm]
  );

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
    () => ({ toast, confirm, choose, actionSheet }),
    [toast, confirm, choose, actionSheet]
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
  const toastBottom = useToastBottom();
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

      {/* Toast rests at the BOTTOM, just above the tab bar (or the keyboard, or
          the safe area), so it never sits over the top-bar buttons. It survives
          the screen that fired it and takes touches only while it has an action. */}
      <Animated.View
        pointerEvents={toastAction ? "box-none" : "none"}
        style={{
          position: "absolute",
          start: Math.max(16, insets.left),
          end: Math.max(16, insets.right),
          bottom: toastBottom,
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
        <ToastCard
          message={toastMsg}
          kind={toastKind}
          action={
            toastAction
              ? {
                  label: toastAction.label,
                  onPress: () => runToastAction(),
                  secondary: toastAction.secondary
                    ? { label: toastAction.secondary.label, onPress: () => runToastAction("secondary") }
                    : undefined,
                }
              : null
          }
        />
      </Animated.View>
    </View>
  );
}

/** Entrance animation shared by both overlays; there is no exit animation. */
function useEnterAnim(): Animated.Value {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    animateFade(isReducedMotionNow(), anim, {
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

/** Large text: the content scrolls inside a bounded area so the buttons that
 *  follow stay on screen. At the default size it is a plain fragment. */
function BoundedScroll({
  large,
  maxHeight,
  children,
}: {
  large: boolean;
  maxHeight: number;
  children: React.ReactNode;
}) {
  if (!large) return <>{children}</>;
  return <ScrollView style={{ maxHeight, flexGrow: 0 }}>{children}</ScrollView>;
}

function ConfirmOverlay({
  opts,
  onClose,
}: {
  opts: OpenConfirm;
  onClose: (result: boolean | null) => void;
}) {
  const { t } = useTranslation();
  const { isWide, height: layoutHeight } = useLayout();
  const large = useFontScale() > STACK_AT_SCALE;
  const anim = useEnterAnim();
  const dismiss = useCallback(
    () => onClose(opts.dismissAsNull ? null : false),
    [onClose, opts.dismissAsNull]
  );
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
  // Large text: side-by-side buttons would each get half a narrow dialog.
  const stacked = large || shouldStackButtons(confirmLabel, cancelLabel);

  // Stacked, the primary action leads and each button owns the full width.
  // Side by side, cancel sits left of the primary and they share the row.
  const width = stacked ? "w-full" : "flex-1";

  const cancelButton = (
    <Pressable
      onPress={() => onClose(false)}
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
                ...ELEVATION.popover,
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

            <BoundedScroll large={large} maxHeight={Math.round(layoutHeight * 0.5)}>
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
            </BoundedScroll>

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
  const { isWide, isDialog, width: layoutWidth, height: layoutHeight } = useLayout();
  const sheetLarge = useFontScale() > STACK_AT_SCALE;
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
        style={isDialog ? { justifyContent: "center" } : undefined}
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
                backgroundColor: THEME.bg.g1,
                paddingBottom: insets.bottom + 20,
              },
              sheetBoxStyle(layoutWidth, isWide, layoutHeight, undefined, true, { minRatio: 0 }),
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
            <BoundedScroll large={sheetLarge} maxHeight={Math.round(layoutHeight * 0.55)}>
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
            </BoundedScroll>
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
