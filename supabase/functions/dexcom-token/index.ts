// dexcom-token giris noktasi. Mantik handler.ts'te (test edilebilir); burada yalniz gercek
// bagimliliklar baglanir. DEPLOY KULLANICIDA: `supabase functions deploy dexcom-token`,
// once migration (20261027140000_dexcom_links.sql) ve secrets (DEXCOM_CLIENT_ID,
// DEXCOM_CLIENT_SECRET, DEXCOM_TOKEN_KEY). verify_jwt false olmali (supabase/config.toml).
// Acilis kosullari: scratchpad/g250-cgm-f/acilis-kosullari.md.

import { env, resolveCallerIp, serve, serviceCreds } from "../_shared/http.ts";
import { createHandler } from "./handler.ts";
import { PostgresStore } from "./store.ts";

serve((req) => {
  const creds = serviceCreds();
  return createHandler({
    store: creds ? new PostgresStore(creds) : null,
    env,
    fetch,
    now: () => Date.now(),
    bucketKey: creds?.key,
    callerIp: resolveCallerIp,
  })(req);
});
