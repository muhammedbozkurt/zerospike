import { useCallback, useEffect, useRef } from "react";

import { logCrash } from "./analytics";
import { getProfile, updateProfile } from "./db/profiles";
import { createRatioWriter, type RatioWriter } from "./ratioWriter";
import { useApp } from "./store/AppContext";

/**
 * The one way a screen writes the calculator's four numbers (carb ratio per
 * meal and the correction factor). The calculator's ratios sheet and Profile and
 * Targets both go through this, so they read and write the same profile record
 * and a value typed in either one is there in the other.
 *
 * The writer compares against what it last sent (not the profile in context,
 * which lags a write), so `get({ renew: true })` is for the moment a screen
 * starts a fresh editing session: another screen may have written since.
 * Leaving the screen with a draft still waiting writes it.
 */
export function useRatioWriter(onError?: (e: unknown) => void): {
  get: (opts?: { renew?: boolean }) => RatioWriter | null;
} {
  const { activeProfile, bumpData } = useApp();
  const profileRef = useRef(activeProfile);
  profileRef.current = activeProfile;
  const bumpRef = useRef(bumpData);
  bumpRef.current = bumpData;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const writerRef = useRef<{ id: string; writer: RatioWriter } | null>(null);

  const get = useCallback((opts?: { renew?: boolean }) => {
    const p = profileRef.current;
    if (!p) return null;
    if (opts?.renew) void writerRef.current?.writer.flush();
    if (opts?.renew || !writerRef.current || writerRef.current.id !== p.id) {
      writerRef.current = {
        id: p.id,
        writer: createRatioWriter({
          stored: p,
          persist: async (patch) => {
            await updateProfile(p.id, patch);
            bumpRef.current();
          },
          // The database, not the context copy: the refresh after a write may
          // not have reached the context yet, and a stale set here would make
          // the next draft look unchanged.
          reload: async () => (await getProfile(p.id)) ?? profileRef.current,
          unit: () => profileRef.current?.glucose_unit ?? "mgdl",
          onError: (e) => {
            logCrash(e, { screen: "ratios", step: "write" });
            errorRef.current?.(e);
          },
        }),
      };
    }
    return writerRef.current.writer;
  }, []);

  useEffect(
    () => () => {
      void writerRef.current?.writer.flush();
    },
    []
  );

  return { get };
}
