// Tum ZS- kampanyalarini toplu duraklatir veya acar.
// Kullanim: node scripts/apple-ads-status.mjs paused|enabled [kampanya adi on eki, ornek ZS-DE-Discovery]
import fs from "node:fs";
import os from "node:os";
import { createClientSecret } from "./apple-ads-setup.mjs";

const target = (process.argv[2] || "").toLowerCase();
const prefix = process.argv[3] || "ZS-";
if (target !== "paused" && target !== "enabled") {
  console.log("Kullanim: node scripts/apple-ads-status.mjs paused|enabled");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(os.homedir() + "/.apple-ads/zerospike/config.json", "utf8"));
const pem = fs.readFileSync(cfg.privateKeyPath.replace(/^~/, os.homedir()), "utf8");
const secret = createClientSecret({ clientId: cfg.clientId, teamId: cfg.teamId, keyId: cfg.keyId, privateKeyPem: pem });
const q = new URLSearchParams({ client_id: cfg.clientId, client_secret: secret, grant_type: "client_credentials", scope: "searchadsorg" });
const tokRes = await fetch("https://appleid.apple.com/auth/oauth2/token?" + q, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
const tok = (await tokRes.json()).access_token;
if (!tok) { console.log("Token alinamadi"); process.exit(1); }
const H = { Authorization: "Bearer " + tok, "X-AP-Context": "orgId=" + cfg.orgId, "Content-Type": "application/json" };
const base = "https://api.searchads.apple.com/api/v5";
const status = target.toUpperCase();
const cs = (await (await fetch(`${base}/campaigns?limit=50`, { headers: H })).json()).data || [];
for (const c of cs.filter((c) => c.name.startsWith(prefix))) {
  const r = await fetch(`${base}/campaigns/${c.id}`, { method: "PUT", headers: H, body: JSON.stringify({ campaign: { status }, clearGeoTargetingOnCountryOrRegionChange: false }) });
  const j = await r.json().catch(() => ({}));
  console.log(c.name.padEnd(18), r.ok ? j.data?.status : "HATA " + r.status + " " + JSON.stringify(j).slice(0, 160));
}
