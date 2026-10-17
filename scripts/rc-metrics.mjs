#!/usr/bin/env node
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keyPath = path.join(os.homedir(), '.revenuecat', 'zerospike.key');
let KEY;
try {
  KEY = fs.readFileSync(keyPath, 'utf8').trim();
} catch {
  console.error(`Anahtar dosyasi okunamadi: ${keyPath}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const chartIdx = args.indexOf('--chart');
const chartArg = chartIdx >= 0 ? args[chartIdx + 1] : null;
const chartName = chartArg === 'active_subscriptions' ? 'actives' : chartArg;
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const days = Number(opt('--days', 90));
const resolution = opt('--resolution', 'month');
const raw = args.includes('--raw');
const PICK = {
  trial_conversion: ['New Customers', 'Started Trials', 'Start Rate', 'Conversion Rate', 'Converted Trials', 'Abandoned Trials'],
};

function get(p) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: 'api.revenuecat.com', path: `/v2${p}`, method: 'GET', headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            return reject(new Error(`HTTP ${res.statusCode} ${p}: anahtar gecersiz veya bu kaynak icin yetkisi yok (v2 secret key, ilgili okuma izni gerekir)`));
          }
          if (res.statusCode === 429) return reject(new Error(`HTTP 429 ${p}: rate limit (25 istek/dk), biraz bekleyin`));
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode} ${p}: ${b.slice(0, 200)}`));
          try { resolve(JSON.parse(b)); } catch { reject(new Error(`JSON ayrisamadi ${p}`)); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function list(p) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i++) {
    const sep = p.includes('?') ? '&' : '?';
    const r = await get(`${p}${sep}limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`);
    const items = r.items || [];
    out.push(...items);
    if (!r.next_page || !items.length) break;
    after = items[items.length - 1].id;
  }
  return out;
}

const soft = async (fn, label) => {
  try { return await fn(); } catch (e) { console.log(`(${label} alinamadi: ${e.message})`); return null; }
};

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (r) => cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  ');
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(w.map((n) => '-'.repeat(n)).join('  '));
  rows.forEach((r) => console.log(line(r)));
}

const projects = await list('/projects');
if (!projects.length) { console.log('Proje yok.'); process.exit(0); }

for (const pr of projects) {
  console.log(`\n== Proje: ${pr.name} (${pr.id}) ==`);
  const id = pr.id;

  const ov = await soft(() => get(`/projects/${id}/metrics/overview`), 'overview');
  if (ov) {
    console.log(`\nOverview (para birimi: ${ov.currency || '?'}); donem P28D = son 28 gun, P0D = anlik`);
    table(
      (ov.metrics || []).map((m) => ({ id: m.id, ad: m.name, deger: m.value, birim: m.unit, donem: m.period === 'P28D' ? 'P28D (28 gun)' : m.period, guncelleme: m.last_updated_at_iso8601 || '' })),
      ['id', 'ad', 'deger', 'birim', 'donem', 'guncelleme'],
    );
  }

  const apps = await soft(() => list(`/projects/${id}/apps`), 'apps');
  if (apps) { console.log('\nUygulamalar'); table(apps.map((a) => ({ id: a.id, ad: a.name, store: a.type })), ['id', 'ad', 'store']); }

  const prods = await soft(() => list(`/projects/${id}/products`), 'products');
  if (prods) {
    console.log('\nUrunler (fiyat v2 product kaynaginda yoksa gosterilmez)');
    table(
      prods.map((p) => ({
        id: p.id, store_id: p.store_identifier, store: (apps || []).find((a) => a.id === p.app_id)?.type || p.app_id || '', tur: p.type,
        sure: p.subscription?.duration || '', deneme: p.subscription?.trial_duration || '',
        fiyat: p.subscription?.prices ? JSON.stringify(p.subscription.prices) : (p.price ?? ''),
      })),
      ['id', 'store_id', 'store', 'tur', 'sure', 'deneme', 'fiyat'],
    );
  }

  const ents = await soft(() => list(`/projects/${id}/entitlements`), 'entitlements');
  if (ents) { console.log('\nEntitlements'); table(ents.map((e) => ({ id: e.id, lookup_key: e.lookup_key, ad: e.display_name })), ['id', 'lookup_key', 'ad']); }

  const offs = await soft(() => list(`/projects/${id}/offerings`), 'offerings');
  if (offs) {
    console.log('\nOfferings');
    for (const o of offs) {
      console.log(`- ${o.id} (${o.lookup_key}) ${o.display_name || ''}${o.is_current ? ' [current]' : ''}`);
      const pk = await soft(() => list(`/projects/${id}/offerings/${o.id}/packages`), `paketler ${o.id}`);
      (pk || []).forEach((k) => console.log(`    paket ${k.lookup_key}: ${k.display_name || ''}`));
    }
  }

  if (chartName) {
    const day = (d) => d.toISOString().slice(0, 10);
    const q = `resolution=${resolution}&start_date=${day(new Date(Date.now() - days * 864e5))}&end_date=${day(new Date())}`;
    const ch = await soft(() => get(`/projects/${id}/charts/${chartName}?${q}`), `chart ${chartName}`);
    if (ch && raw) console.log(JSON.stringify(ch, null, 1));
    else if (ch) {
      const ms = ch.measures || [];
      const want = PICK[chartName];
      const idx = ms.map((m, i) => i).filter((i) => !want || want.includes(ms[i].display_name));
      const byT = new Map();
      for (const v of ch.values || []) {
        const t = v.cohort ?? v.timestamp ?? v.date;
        if (!byT.has(t)) byT.set(t, { incomplete: false });
        const r = byT.get(t);
        r[v.measure] = v.value;
        if (v.incomplete) r.incomplete = true;
      }
      const fmt = (i, val) => (val === undefined || val === null ? '' : ms[i]?.unit === '%' ? `${Number(val).toFixed(1)}%` : String(val));
      const rows = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, r]) => {
        const row = { donem: new Date(t * 1000).toISOString().slice(0, 10) + (r.incomplete ? '*' : '') };
        idx.forEach((i) => (row[ms[i].display_name] = fmt(i, r[i])));
        return row;
      });
      console.log(`\nChart ${chartName} (${ch.display_name}), ${resolution}, son ${days} gun  (* = donem tamamlanmadi)`);
      table(rows, ['donem', ...idx.map((i) => ms[i].display_name)]);
    }
  }
}
