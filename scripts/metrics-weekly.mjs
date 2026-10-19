#!/usr/bin/env node
// Haftalik huni raporu: ASC + RevenueCat (tam kapsam) ve Supabase v_* (rizali ornek).
// Kullanim: metrics-weekly.mjs [--dry] [--end YYYY-MM-DD] [--out <klasor>]
// Kimlik degerleri hicbir zaman ciktiya yazilmaz; erisilemeyen kaynak satir olarak isaretlenir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SUPABASE_URL = 'https://jcpepqectdubbmchhdsn.supabase.co';
const SERVICE_KEY_PATH = path.join(os.homedir(), '.supabase', 'zerospike.service.key');

function parseArgs(argv) {
  const a = { dry: false, end: null, out: path.join(ROOT, 'scratchpad', 'metrics') };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry') a.dry = true;
    else if (x === '--end') {
      a.end = argv[++i];
      const d = new Date(`${a.end}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.end || '') || isNaN(d) || d.toISOString().slice(0, 10) !== a.end) {
        console.error('--end gecerli bir tarih olmali (YYYY-MM-DD, ornek 2026-10-17)');
        process.exit(1);
      }
    }
    else if (x === '--out') a.out = path.resolve(argv[++i]);
    else if (x === '--help' || x === '-h') {
      console.log('Kullanim: metrics-weekly.mjs [--dry] [--end YYYY-MM-DD] [--out <klasor>]');
      process.exit(0);
    } else {
      console.error(`Bilinmeyen arguman: ${x}`);
      process.exit(1);
    }
  }
  return a;
}

const day = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => day(new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5));

function isoWeek(s) {
  const d = new Date(`${s}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-${String(w).padStart(2, '0')}`;
}

const pctFmt = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const fmt = (v, unit) => (v === null || v === undefined || Number.isNaN(v) ? '-' : unit === 'pct' ? pctFmt.format(v) : numFmt.format(v));

function run(script, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(HERE, script), ...args], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, code: err ? (err.code ?? 'hata') : 0, out: String(stdout || '') });
    });
  });
}

const cells = (line) => line.trim().split(/\s{2,}/);
const num = (s) => {
  const n = Number(String(s ?? '').replace(/[%,]/g, ''));
  return Number.isFinite(n) && String(s ?? '').trim() !== '' && String(s) !== '-' ? n : null;
};

async function ascSource(start, end, tmpDir) {
  const res = [];
  const unavailable = [];
  const rows = {};
  for (const report of ['App Downloads', 'Discovery']) {
    const r = await run('asc-analytics.mjs', ['--fetch', '--report', report, '--days', '7', '--out', tmpDir]);
    if (!r.ok) { unavailable.push(`node scripts/asc-analytics.mjs --fetch --report "${report}" (cikis kodu ${r.code})`); continue; }
    for (const line of r.out.split('\n')) {
      const m = line.match(/^(US|DE|TOPLAM)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
      if (!m) continue;
      const k = m[1];
      rows[k] ??= {};
      const [imp, pv, dl] = [num(m[2]), num(m[3]), num(m[4])];
      if (imp !== null) rows[k].imp = imp;
      if (pv !== null) rows[k].pv = pv;
      if (dl !== null) rows[k].dl = dl;
    }
  }
  for (const [k, label] of [['US', 'US'], ['DE', 'DE'], ['TOPLAM', 'Toplam']]) {
    const v = rows[k] || {};
    res.push({ key: `asc.imp.${k}`, label: `Gosterim ${label}`, val: v.imp ?? null, scope: 'store' });
    res.push({ key: `asc.pv.${k}`, label: `Sayfa goruntuleme ${label}`, val: v.pv ?? null, scope: 'store' });
    res.push({ key: `asc.dl.${k}`, label: `Indirme ${label}`, val: v.dl ?? null, scope: 'store' });
  }
  return { rows: res, unavailable, downloads: rows.TOPLAM?.dl ?? null };
}

async function rcSource() {
  const unavailable = [];
  const rows = [];
  const r = await run('rc-metrics.mjs', ['--chart', 'trial_conversion', '--days', '28', '--resolution', 'week']);
  if (!r.ok) return { rows, unavailable: [`node scripts/rc-metrics.mjs (cikis kodu ${r.code}; ~/.revenuecat/zerospike.key)`] };
  const lines = r.out.split('\n');
  const soft = lines.filter((l) => /alinamadi/.test(l));
  if (soft.length) unavailable.push(`node scripts/rc-metrics.mjs (${soft.length} bolum alinamadi, HTTP durumunu cikti ile kontrol et)`);
  const want = { 'active subscriptions': ['rc.actives', 'Aktif abonelik'], mrr: ['rc.mrr', 'MRR'] };
  for (const l of lines) {
    const c = cells(l);
    const hit = want[(c[1] || '').toLowerCase()];
    if (hit) rows.push({ key: hit[0], label: hit[1], val: num(c[2]), scope: 'store' });
  }
  const hi = lines.findIndex((l) => /^donem\s/.test(l));
  if (hi >= 0) {
    const head = cells(lines[hi]);
    const data = lines.slice(hi + 2).map(cells).filter((c) => /^\d{4}-\d{2}-\d{2}/.test(c[0]) && !c[0].endsWith('*'));
    const last = data[data.length - 1];
    if (last) {
      const col = (n) => num(last[head.indexOf(n)]);
      rows.push({ key: 'rc.new', label: 'Yeni musteri', val: col('New Customers'), scope: 'store' });
      rows.push({ key: 'rc.trials', label: 'Deneme baslangici', val: col('Started Trials'), scope: 'store' });
      rows.push({ key: 'rc.conv', label: 'Denemeden donusum (adet)', val: col('Converted Trials'), scope: 'store' });
    }
  }
  if (!rows.length) unavailable.push('node scripts/rc-metrics.mjs (satir ayristirilamadi)');
  return { rows, unavailable };
}

async function sbGet(key, view, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${view}`);
  return res.json();
}

async function sbSource(start, end, downloads) {
  let key;
  try { key = fs.readFileSync(SERVICE_KEY_PATH, 'utf8').trim(); } catch {
    return { rows: [], unavailable: ['Supabase service anahtari dosyasi yok: ~/.supabase/zerospike.service.key'] };
  }
  const range = `day=gte.${start}&day=lte.${end}`;
  const sum = (arr, f) => arr.reduce((a, r) => a + (Number(r[f]) || 0), 0);
  const rows = [];
  const unavailable = [];
  const add = (key2, label, val, n) => rows.push({ key: key2, label, val, n, scope: 'app' });
  try {
    const ret = await sbGet(key, 'v_retention_cohort', `cohort_day=gte.${addDays(start, -30)}&cohort_day=lte.${end}&limit=10000`);
    const inWeek = ret.filter((r) => r.cohort_day >= start);
    const newDev = sum(inWeek, 'n');
    add('app.consented', 'Rizali yeni cihaz', newDev, newDev);
    for (const [f, off] of [['d1', 1], ['d7', 7], ['d30', 30]]) {
      const c = ret.filter((r) => r.cohort_day <= addDays(end, -off) && r.cohort_day >= addDays(start, -off));
      const n = sum(c, 'n');
      add(`app.ret.${f}`, `Retention ${f.toUpperCase()}`, n ? sum(c, f) / n : null, n);
    }
    const fun = await sbGet(key, 'v_funnel_daily', `${range}&limit=10000`);
    add('app.onb_done', 'Onboarding tamamlama (cihaz-gun)', sum(fun, 'onboarding_done'), sum(fun, 'onboarding_done'));
    add('app.first_log', 'Ilk kayit (cihaz-gun)', sum(fun, 'first_log'), sum(fun, 'first_log'));
    const third = await sbGet(key, 'v_third_log', `${range}&limit=10000`);
    add('app.third_log', '3. kayit (cihaz)', sum(third, 'devices'), sum(third, 'devices'));
    const onb = await sbGet(key, 'v_onboarding_dropoff', 'limit=10000');
    const byStep = new Map();
    for (const r of onb) {
      const k = `${String(r.idx).padStart(2, '0')} ${r.step}`;
      byStep.set(k, (byStep.get(k) || 0) + (Number(r.devices) || 0));
    }
    for (const [k, v] of [...byStep.entries()].sort()) add(`app.onb.${k}`, `Onboarding adim ${k} (tum zaman)`, v, v);
    const pw = await sbGet(key, 'v_paywall_daily', `${range}&limit=10000`);
    const byReason = new Map();
    for (const r of pw) {
      const k = r.reason || 'bilinmiyor';
      const o = byReason.get(k) || { v: 0, d: 0 };
      o.v += Number(r.views) || 0; o.d += Number(r.devices) || 0;
      byReason.set(k, o);
    }
    for (const [k, o] of [...byReason.entries()].sort()) add(`app.pw.${k}`, `Paywall goruntuleme, reason=${k}`, o.v, o.d);
    const pr = await sbGet(key, 'v_purchase_results_daily', `${range}&limit=10000`);
    const byRes = new Map();
    for (const r of pr) {
      const o = byRes.get(r.result || 'bilinmiyor') || { v: 0, d: 0 };
      o.v += Number(r.events) || 0; o.d += Number(r.devices) || 0;
      byRes.set(r.result || 'bilinmiyor', o);
    }
    if (!byRes.size) add('app.pr.none', 'Satin alma sonucu (olay henuz yok)', 0, 0);
    for (const [k, o] of [...byRes.entries()].sort()) add(`app.pr.${k}`, `Satin alma sonucu: ${k}`, o.v, o.d);
    const ev = await sbGet(key, 'v_event_daily', `${range}&limit=10000`);
    const names = [['paywall_cta', 'Paywall CTA'], ['trial_started', 'Deneme baslatma (istemci)'], ['downsell_view', 'Downsell goruntuleme'], ['downsell_accept', 'Downsell kabul'], ['store_review_prompt', 'Degerlendirme istemi'], ['spike_message_sent', 'Spike cagrisi'], ['carb_estimate_used', 'Besin tahmini kullanildi (istemci)'], ['carb_estimate_blocked', 'Besin tahmini engellendi (istemci)']];
    for (const [nm, label] of names) {
      const f = ev.filter((r) => r.name === nm);
      add(`app.ev.${nm}`, label, sum(f, 'events'), sum(f, 'devices'));
    }
    const countCalls = async (extra) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/spike_calls?select=id&${range}${extra}&limit=0`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const n = Number((res.headers.get('content-range') || '').split('/')[1]);
      if (!Number.isFinite(n)) throw new Error('count yok');
      return n;
    };
    try {
      const total = await countCalls('');
      add('app.spike.calls', 'Spike model cagrisi (sunucu, spike_calls, tum modlar)', total, total);
    } catch {
      unavailable.push('Supabase spike_calls sayimi (erisilemedi)');
    }
    try {
      const carb = await countCalls('&mode=eq.carb_estimate');
      const carbFiltered = await countCalls('&mode=eq.carb_estimate&filtered=eq.true');
      add('app.carb.calls', 'Besin tahmini model cagrisi (sunucu, spike_calls.mode=carb_estimate)', carb, carb);
      add('app.carb.filtered', 'Besin tahmini suzulen cagri (sunucu)', carbFiltered, carbFiltered);
    } catch {
      unavailable.push('Supabase spike_calls.mode sayimi (kolon yok: migration 20261019100000 bekliyor, ya da erisilemedi)');
    }
    try {
      const gate = await sbGet(key, 'v_spike_gate_daily', `${range}&limit=10000`);
      const byReason = (r) => gate.filter((g) => g.reason === r);
      const caps = [...new Set(byReason('device').map((g) => Number(g.cap)))].sort((a, b) => a - b);
      for (const c of caps) add(`app.spike.rej.device.${c}`, `Spike ret: cihaz limiti (${c})`, sum(byReason('device').filter((g) => Number(g.cap) === c), 'n'), null);
      const ip = sum(byReason('ip'), 'n');
      const glob = sum(byReason('global'), 'n');
      const rej = sum(gate.filter((g) => g.reason !== 'ok'), 'n');
      const ok = sum(byReason('ok'), 'n');
      add('app.spike.rej.ip', 'Spike ret: IP limiti', ip, null);
      add('app.spike.rej.global', 'Spike ret: genel limit', glob, null);
      add('app.spike.rej_rate', 'Spike ret orani (ret / ret+ok)', rej + ok ? rej / (rej + ok) : null, null);
    } catch (e) {
      const missing = /HTTP (404|400)/.test(String(e.message));
      unavailable.push(missing ? 'Supabase v_spike_gate_daily (gorunum yok, migration bekliyor)' : 'Supabase v_spike_gate_daily (erisilemedi)');
    }
  } catch (e) {
    const m = /HTTP (\d+)/.exec(String(e.message));
    const why = m ? `HTTP ${m[1]}` : 'ag hatasi';
    return { rows, unavailable: [`Supabase v_* sorgusu (${why}; supabase login/link ve ~/.supabase/zerospike.service.key)`] };
  }
  return { rows, unavailable, downloads };
}

function loadPrev(file) {
  try {
    const m = /<!-- DATA (.*?) -->/s.exec(fs.readFileSync(file, 'utf8'));
    return m ? JSON.parse(m[1]) : {};
  } catch { return {}; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const end = args.end || addDays(day(new Date()), -1);
  const start = addDays(end, -6);
  const week = isoWeek(end);
  const prevFile = path.join(args.out, `${isoWeek(addDays(end, -7))}.md`);
  fs.mkdirSync(args.out, { recursive: true });
  const prev = loadPrev(prevFile);

  let store = [];
  const unavailable = [];
  let downloads = null;
  if (!args.dry) {
    const tmp = path.join(args.out, '.asc-raw');
    fs.mkdirSync(tmp, { recursive: true });
    const [a, r] = await Promise.all([ascSource(start, end, tmp), rcSource()]);
    downloads = a.downloads;
    store = [...a.rows, ...r.rows];
    unavailable.push(...a.unavailable, ...r.unavailable);
    const s = await sbSource(start, end, downloads);
    store.push(...s.rows);
    unavailable.push(...s.unavailable);
  } else {
    for (const [k, l] of [['asc.imp.TOPLAM', 'Gosterim Toplam'], ['asc.dl.TOPLAM', 'Indirme Toplam'], ['rc.trials', 'Deneme baslangici'], ['rc.conv', 'Denemeden donusum (adet)'], ['rc.actives', 'Aktif abonelik'], ['rc.mrr', 'MRR']]) store.push({ key: k, label: l, val: null, scope: 'store' });
    for (const [k, l] of [['app.consented', 'Rizali yeni cihaz'], ['app.onb_done', 'Onboarding tamamlama'], ['app.first_log', 'Ilk kayit'], ['app.third_log', '3. kayit'], ['app.pw.after_logs', 'Paywall goruntuleme, reason=after_logs'], ['app.ev.paywall_cta', 'Paywall CTA'], ['app.pr.success', 'Satin alma sonucu: success'], ['app.ev.downsell_view', 'Downsell goruntuleme'], ['app.ev.store_review_prompt', 'Degerlendirme istemi'], ['app.spike.calls', 'Spike model cagrisi (sunucu, spike_calls, tum modlar)'], ['app.carb.calls', 'Besin tahmini model cagrisi (sunucu)'], ['app.carb.filtered', 'Besin tahmini suzulen cagri (sunucu)'], ['app.ev.carb_estimate_used', 'Besin tahmini kullanildi (istemci)'], ['app.ev.carb_estimate_blocked', 'Besin tahmini engellendi (istemci)'], ['app.ev.spike_message_sent', 'Spike cagrisi'], ['app.spike.rej.device.3', 'Spike ret: cihaz limiti (3)'], ['app.spike.rej.device.50', 'Spike ret: cihaz limiti (50)'], ['app.spike.rej.ip', 'Spike ret: IP limiti'], ['app.spike.rej.global', 'Spike ret: genel limit'], ['app.spike.rej_rate', 'Spike ret orani (ret / ret+ok)'], ['app.ret.d1', 'Retention D1']]) store.push({ key: k, label: l, val: null, n: null, scope: 'app' });
  }

  const dl = downloads;
  const line = (r) => {
    const unit = r.key.startsWith('app.ret') || r.key.endsWith('_rate') ? 'pct' : 'num';
    const p = prev[r.key];
    const diff = r.val !== null && r.val !== undefined && typeof p === 'number' ? fmt(r.val - p, unit) : '-';
    if (r.scope === 'store') return `| ${r.label} | ${fmt(r.val, unit)} | ${fmt(p, unit)} | ${diff} | tam kapsam | - |`;
    const low = r.n !== null && r.n !== undefined && r.n < 30 ? ' (dusuk n, yorum yapma)' : '';
    const riza = dl && r.n !== null && r.n !== undefined ? fmt(r.n / dl, 'pct') : '-';
    return `| ${r.label} | ${fmt(r.val, unit)} | ${fmt(p, unit)} | ${diff} | n=${r.n ?? '-'}${low} | ${riza} |`;
  };
  const head = '| Satir | Bu hafta | Gecen hafta | Fark | n | Riza (yaklasik, iOS paydasi) |\n|---|---|---|---|---|---|';
  const storeRows = store.filter((r) => r.scope === 'store').map(line);
  const appRows = store.filter((r) => r.scope === 'app').map(line);

  const md = [
    `# Haftalik metrikler ${week} (${start} .. ${end}, UTC)`,
    args.dry ? '\nDRY: ag cagrisi yapilmadi, degerler bos iskelet.' : '',
    '\nUygulama ici olaylar rizali ornekleme: yalniz analitik rizasi veren cihazlar sayilir, daha ilgili kullanicilara yanli olabilir. Riza orani paydasi ASC haftalik indirme sayisidir (yalniz iOS); pay iOS ve Android cihazlarini birlikte sayar, bu yuzden oran yaklasiktir ve ustten sapabilir.',
    '\n## Magaza ve RevenueCat (tam kapsam)\n', head, ...storeRows,
    '\n## Uygulama ici huni (rizali ornek)\n', head, ...appRows,
    '\nSpike ret orani paydasi: ok = iade sonrasi net model cagrisi (bedava tekrar dahil). Veri tam kapsam, riza ornegi degil; n bos, riza sutunu "-".',
    ...(unavailable.length ? ['\n## Erisilemeyen kaynaklar\n', ...unavailable.map((u) => `KULLANICI YENILEYECEK: ${u}`)] : []),
    args.dry ? '' : '\nKULLANICI YENILEYECEK: Play Console (script yok, elle bak)',
    `\n<!-- DATA ${JSON.stringify(Object.fromEntries(store.filter((r) => r.val !== null && r.val !== undefined).map((r) => [r.key, r.val])))} -->`,
    '',
  ].join('\n');
  const outFile = path.join(args.out, `${week}.md`);
  fs.writeFileSync(outFile, md);
  console.log(`Yazildi: ${outFile} (${storeRows.length + appRows.length} satir, ${unavailable.length} erisilemeyen kaynak)`);
}

main().catch(() => {
  console.error('metrics-weekly beklenmeyen hata');
  process.exit(1);
});
