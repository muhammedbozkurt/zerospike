import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { initDatabase } from "../db/index";
import {
  getDefaultProfile,
  getProfile,
  listProfiles,
} from "../db/profiles";
import type { UserProfile, Lang } from "../db/types";
import { initI18n, setLanguage as i18nSetLanguage, currentLang } from "../i18n";
import { isPro as readIsPro } from "../services/purchases";

const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";
const ONBOARDED_KEY = "zerospike.onboarded";

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

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const refreshProfiles = useCallback(async () => {
    const list = await listProfiles();
    setProfiles(list);
    return;
  }, []);

  const refreshPro = useCallback(async () => {
    setIsProUser(await readIsPro());
  }, []);

  const setActiveProfileId = useCallback(async (id: string) => {
    const p = await getProfile(id);
    if (p) {
      setActiveProfile(p);
      await AsyncStorage.setItem(ACTIVE_PROFILE_KEY, id);
    }
  }, []);

  const setLanguage = useCallback(async (next: Lang) => {
    await i18nSetLanguage(next);
    setLang(next);
  }, []);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, "true");
    setOnboarded(true);
  }, []);

  // Bootstrap on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      const active = (await getProfile(activeId)) ?? fallback;

      const onboardedFlag =
        (await AsyncStorage.getItem(ONBOARDED_KEY)) === "true";
      const pro = await readIsPro();

      if (cancelled) return;
      setProfiles(list.length ? list : [fallback]);
      setActiveProfile(active);
      setLang(currentLang());
      setOnboarded(onboardedFlag);
      setIsProUser(pro);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the active profile object fresh after edits.
  const refreshActive = useCallback(async () => {
    if (!activeProfile) return;
    const fresh = await getProfile(activeProfile.id);
    if (fresh) setActiveProfile(fresh);
  }, [activeProfile]);

  // Re-pull the active profile and list whenever data is bumped.
  useEffect(() => {
    if (!ready) return;
    refreshProfiles();
    refreshActive();
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
      refreshProfiles,
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
      refreshProfiles,
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
