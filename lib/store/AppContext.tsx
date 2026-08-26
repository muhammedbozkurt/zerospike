import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DevSettings, I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { initDatabase } from "../db/index";
import {
  getDefaultProfile,
  getProfile,
  listProfiles,
} from "../db/profiles";
import type { UserProfile, Lang } from "../db/types";
import i18nInstance, {
  initI18n,
  setLanguage as i18nSetLanguage,
  currentLang,
  isRTLLang,
} from "../i18n";
import { isProCached, verifyProWithStore } from "../services/purchases";
import { markAlarmTourSeen } from "../services/alarmTour";
import { takePendingAlarmRoute } from "../../modules/zerospike-alarmkit";
import { isScreenshotMode } from "../screenshotMode";

/**
 * The RTL restart confirm is the app's own themed dialog (components/Feedback),
 * not a native Alert - but that provider is mounted BELOW AppProvider in
 * app/_layout.tsx, so useFeedback() cannot be called from inside AppProvider
 * itself (a context is only visible to its DESCENDANTS). RootNavigator - a
 * descendant of both providers - registers the live confirm function here once
 * it mounts, so setLanguage below can still show the real dialog.
 */
type RTLConfirmFn = (opts: { title: string; message: string }) => Promise<boolean>;
let rtlConfirmHandler: RTLConfirmFn | null = null;
export function setRTLConfirmHandler(fn: RTLConfirmFn | null): void {
  rtlConfirmHandler = fn;
}

/**
 * I18nManager.forceRTL only re-lays-out every native view with the new writing
 * direction once the JS bundle is re-mounted from scratch - flipping the flag
 * alone changes nothing on screen until that happens. expo-updates' reloadAsync
 * does that reload without a full OS-level relaunch. The require is lazy (not a
 * static import) because the native module can be absent from the binary
 * entirely (not just unavailable at runtime, eg. Expo Go) - a static import
 * throws at MODULE LOAD, crashing the whole app before this function is ever
 * called. DevSettings is the fallback there and in some dev-client states. A
 * final failure is swallowed rather than crashing - the direction still
 * self-corrects on the next real launch (see the startup sync in
 * app/_layout.tsx).
 */
export async function reloadForDirectionChange(): Promise<void> {
  try {
    const Updates = require("expo-updates");
    await Updates.reloadAsync();
    return;
  } catch {
    // expo-updates missing from the binary or unavailable (Expo Go / some dev-client states)
  }
  try {
    DevSettings.reload();
  } catch {
    // no reload path available; the next launch's startup sync still fixes it
  }
}

const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";
const ONBOARDED_KEY = "zerospike.onboarded";

/**
 * Field-wise equality for a profile row. Every refresh re-reads the row from
 * SQLite and gets a brand new object back, so identity alone said "changed" on
 * every single data bump. Screens key their loaders on `activeProfile`, which
 * turned one log write into a second full dashboard load (a second getJournal
 * AND a second live-surface publish) plus two extra renders of every consumer.
 * Comparing the values lets an unchanged row keep its old object.
 */
function sameProfile(a: UserProfile | null, b: UserProfile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as (keyof UserProfile)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

function sameProfileList(a: UserProfile[], b: UserProfile[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((p, i) => sameProfile(p, b[i]));
}

interface AppState {
  ready: boolean;
  onboarded: boolean;
  profiles: UserProfile[];
  activeProfile: UserProfile | null;
  lang: Lang;
  isProUser: boolean;
  /** increments whenever logs/foods change, to trigger list refreshes */
  dataVersion: number;

  bumpData: () => void;
  setActiveProfileId: (id: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  setLanguage: (lang: Lang) => Promise<void>;
  refreshPro: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [lang, setLang] = useState<Lang>("tr");
  const [isProUser, setIsProUser] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  // The active profile's id, mirrored so the refresh callbacks below stay stable
  // across renders (a dep on `activeProfile` gave them a new identity on every
  // profile refresh, which is half of the double-load story).
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeProfile?.id ?? null;

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const applyProfileList = useCallback((list: UserProfile[]) => {
    setProfiles((prev) => (sameProfileList(prev, list) ? prev : list));
  }, []);

  const applyActiveProfile = useCallback((next: UserProfile | null) => {
    setActiveProfile((prev) => (sameProfile(prev, next) ? prev : next));
  }, []);

  /**
   * ONE pass over the profile table that refreshes the list AND the active row.
   * It used to be two round trips (listProfiles + getProfile) fired from the same
   * effect, each landing in its own commit.
   *
   * Still never sits on a DELETED profile: when the active id is gone from the
   * list, hand over to a real profile (getProfile returned null there, and
   * keeping the old object left the whole app addressing a dead profile - empty
   * lists, new logs written under an id nothing else can reach).
   */
  const syncProfiles = useCallback(async () => {
    const list = await listProfiles();
    const currentId = activeIdRef.current;
    const stillThere = currentId
      ? (list.find((p) => p.id === currentId) ?? null)
      : null;
    if (stillThere || currentId == null) {
      applyProfileList(list);
      if (stillThere) applyActiveProfile(stillThere);
      return;
    }
    const next = list[0] ?? (await getDefaultProfile());
    applyProfileList(list.length ? list : [next]);
    applyActiveProfile(next);
    try {
      await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, next.id);
    } catch {
      // a failed hand-over write only costs the choice on next launch
    }
  }, [applyProfileList, applyActiveProfile]);

  /**
   * Re-checks the entitlement against the store. `null` means the store could not
   * be reached, which is NOT "not subscribed": demoting on it would drop a real
   * Pro user to free (and fire the win-back offer at them) the moment they are
   * offline, so an unverifiable answer leaves the current flag standing. Same
   * rule as the launch path below.
   */
  const refreshPro = useCallback(async () => {
    const verified = await verifyProWithStore();
    if (verified != null) setIsProUser(verified);
  }, []);

  const setActiveProfileId = useCallback(async (id: string) => {
    const p = await getProfile(id);
    if (!p) return;
    setActiveProfile(p);
    await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, id);
    // The two device-level surfaces resolve the profile themselves from the key
    // just written, so both were left describing the PREVIOUS profile until
    // something else happened to refresh them: reminders gated on the profile
    // (basal / medication) stayed armed for the profile that was switched away
    // from, and the widget / watch kept its numbers. Backgrounded on purpose -
    // the switch itself must stay instant - and safe to fire here because
    // applyNotificationPrefs no longer prompts.
    void import("../services/notifications").then((m) =>
      m.applyNotificationPrefs()
    );
    void import("../services/liveData").then((m) =>
      m.syncLiveData(p.id, p.glucose_unit)
    );
  }, []);

  const setLanguage = useCallback(async (next: Lang) => {
    const targetRTL = isRTLLang(next);
    const directionChanged = targetRTL !== I18nManager.isRTL;

    await i18nSetLanguage(next);
    setLang(next);
    // A scheduled reminder keeps the literal text the OS was handed, so every
    // pending one is still speaking the previous language. Re-registered in the
    // background: the language switch itself must stay instant.
    void import("../services/notifications").then((m) =>
      m.rescheduleForLanguageChange()
    );
    // The widget's labels come from the App Group snapshot syncLiveData writes,
    // not from the live i18n instance, so without this the lock-screen / home
    // screen widget kept showing the PREVIOUS language until something else
    // happened to touch the snapshot (a data write, a profile switch, or just
    // bringing the app forward again) - the user read that as a missing
    // translation rather than a stale one. Mirrors setActiveProfileId's own
    // fire-and-forget re-sync above; fired only now, AFTER i18nSetLanguage has
    // actually applied `next`, so the snapshot is never written in the language
    // that is about to be replaced.
    const activeId = activeIdRef.current;
    if (activeId) {
      void getProfile(activeId).then((p) => {
        if (!p) return;
        void import("../services/liveData").then((m) =>
          m.syncLiveData(p.id, p.glucose_unit)
        );
      });
    }

    if (!directionChanged) return;

    // Store-screenshot: the capture pipeline drives the language switch itself
    // and has nobody to tap a confirm dialog, so the direction flips
    // unconditionally. The reload still fires here (unlike the passive startup
    // sync in app/_layout.tsx) - the pipeline expects the new direction on
    // screen right after this call, and it manages its own relaunches around
    // that, not around a reload it did not ask for.
    if (isScreenshotMode()) {
      I18nManager.allowRTL(targetRTL);
      I18nManager.forceRTL(targetRTL);
      await reloadForDirectionChange();
      return;
    }

    const approved = rtlConfirmHandler
      ? await rtlConfirmHandler({
          title: i18nInstance.t("settings.rtlRestartTitle"),
          message: i18nInstance.t("settings.rtlRestartBody"),
        })
      : false;
    // Declined (or no host mounted yet to ask): the language choice is already
    // saved above, and the startup sync in app/_layout.tsx corrects the
    // direction on the next launch without asking again.
    if (!approved) return;

    I18nManager.allowRTL(targetRTL);
    I18nManager.forceRTL(targetRTL);
    await reloadForDirectionChange();
  }, []);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, "true");
    // Drop any route an alarm's "Open" button parked WHILE onboarding was still
    // running (the reminder layout is created a step before the end, so its
    // alarms can already exist). app/_layout.tsx only consumes routes once
    // onboarding is done, and a route that has been waiting since then would
    // fire as a surprise navigation the moment the flow completes - away from
    // the reveal the user is looking at.
    takePendingAlarmRoute();
    // Onboarding already showed the alarm framing and asked for the
    // permission, so the upgrade tour (app/alarm-tour.tsx) has nothing left to
    // tell this user. Marking it here is also what keeps that tour from
    // needing to compare app versions to tell a new install from an upgrade.
    await markAlarmTourSeen();
    setOnboarded(true);
  }, []);

  // Bootstrap on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      await initI18n();
      await initDatabase();

      const list = await listProfiles();
      const fallback = list[0] ?? (await getDefaultProfile());

      let activeId = fallback.id;
      try {
        const saved = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
        if (saved && list.some((p) => p.id === saved)) activeId = saved;
      } catch {
        // ignore
      }
      // Taken from the list already in hand rather than re-queried: activeId is
      // either a row that list was just proved to contain, or the fallback itself.
      const active = list.find((p) => p.id === activeId) ?? fallback;

      const onboardedFlag =
        (await AsyncStorage.getItem(ONBOARDED_KEY)) === "true";
      // Cache-first: the LAST KNOWN entitlement, straight from local storage.
      // Asking RevenueCat here meant the splash screen stayed up for a network
      // round trip on every cold start (and for its full timeout when offline).
      const pro = await isProCached();

      if (cancelled) return;
      setProfiles(list.length ? list : [fallback]);
      setActiveProfile(active);
      setLang(currentLang());
      setOnboarded(onboardedFlag);
      setIsProUser(pro);
      setReady(true);

      // Re-apply the reminder plan once per launch, now that the active profile
      // is settled: the schedulers gate on things that can change while the app
      // is closed (the master switch, the profile's insulin mode, a revoked
      // permission), so a reminder armed by an older build could survive with
      // every surface it belongs to gone. Unconditional on permission:
      // applyNotificationPrefs only READS it, never prompts, so this can never
      // raise an OS dialog on launch - and a REVOKED permission is exactly the
      // case that has to reach this call, because applyReminders is what TAKES
      // an already-armed alarm down: without the notification permission its
      // per-row delivery decision turns every notification-mode row into the
      // cancel branch (see reminderDelivery in lib/alarmSelect.ts; since K3-2 an
      // ALARM-mode row is not gated on that permission and survives).
      // Gating this on hasNotificationPermission()
      // itself, as before, skipped that teardown entirely and left yesterday's
      // alarms ringing. Onboarded-guarded still:
      // someone who quit mid-onboarding has no saved prefs yet, and applying
      // the defaults here would arm reminders before onboarding ever offered
      // that choice.
      void import("../services/notifications").then(async (m) => {
        if (onboardedFlag) await m.applyNotificationPrefs();
      });

      // Now that the app is on screen, verify the entitlement against the store
      // and correct the flag if the cache was stale. `null` means the store could
      // not be reached, which is NOT the same as "not subscribed": treating it as
      // one would demote an offline paying user (and fire the win-back offer at
      // them), so an unreachable store simply leaves the cached flag standing.
      const verified = await verifyProWithStore();
      if (!cancelled && verified != null && verified !== pro) {
        setIsProUser(verified);
      }
      } catch (e) {
        // A bootstrap throw (a failed migration, a corrupt DB) must not leave
        // the native splash up forever: RootNavigator only reveals the app once
        // `ready` flips, so flip it and let the screens surface their own empty
        // or error states.
        console.error("bootstrap failed", e);
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-pull the profile list + the active row whenever data is bumped. One query,
  // one commit, and no state write at all when nothing actually changed.
  useEffect(() => {
    if (!ready) return;
    void syncProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      onboarded,
      profiles,
      activeProfile,
      lang,
      isProUser,
      dataVersion,
      bumpData,
      setActiveProfileId,
      refreshProfiles: syncProfiles,
      setLanguage,
      refreshPro,
      completeOnboarding,
    }),
    [
      ready,
      onboarded,
      profiles,
      activeProfile,
      lang,
      isProUser,
      dataVersion,
      bumpData,
      setActiveProfileId,
      syncProfiles,
      setLanguage,
      refreshPro,
      completeOnboarding,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Convenience: the active profile, guaranteed non-null past the ready gate. */
export function useActiveProfile(): UserProfile {
  const { activeProfile } = useApp();
  if (!activeProfile) {
    throw new Error("Active profile accessed before ready");
  }
  return activeProfile;
}
