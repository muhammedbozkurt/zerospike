#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const API = 'https://api.appstoreconnect.apple.com';
const CONFIG_PATH = path.join(os.homedir(), '.appstoreconnect', 'config.json');
const DEFAULT_OUT = '/private/tmp/claude-501/-Users-muhammedbozkurt-Desktop-Others-zerospike/b453f602-1747-4793-bf45-f06e6d2856ae/scratchpad/asc-analytics';
const COUNTRIES = ['US', 'DE', 'FR', 'ES', 'TR'];

class UserError extends Error {}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new UserError(`Kimlik dosyasi yok: ${CONFIG_PATH}`);
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of ['keyId', 'issuerId', 'privateKeyPath', 'appId']) {
    if (!c[k]) throw new UserError(`config.json icinde ${k} eksik.`);
  }
  return c;
}

function makeToken(cfg) {
  const keyPath = cfg.privateKeyPath.replace(/^~/, os.homedir());
  if (!fs.existsSync(keyPath)) throw new UserError(`p8 dosyasi bulunamadi: ${keyPath}`);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const payload = { iss: cfg.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

let TOKEN = null;
let CFG = null;

async function api(method, p, body) {
  const url = p.startsWith('http') ? p : API + p;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* yok */ }
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail || e.title}`).join(' | ') || text.slice(0, 300);
    if (res.status === 401) throw new UserError(`401 kimlik dogrulama basarisiz (key/issuer/p8 kontrol et). ${detail}`);
    if (res.status === 403) throw new UserError(`403 yetki yok: API anahtarinin rolu Analytics icin yetersiz (Admin veya App Manager gerekir). ${detail}`);
    if (res.status === 404) throw new UserError(`404 bulunamadi (appId ${CFG.appId} dogru mu, rapor/instance mevcut mu?). ${detail}`);
    const err = new Error(`HTTP ${res.status} ${method} ${p}: ${detail}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

async function paged(p) {
  const out = [];
  let next = p;
  while (next) {
    const j = await api('GET', next);
    out.push(...(j.data || []));
    next = j.links?.next || null;
  }
  return out;
}

async function listRequests() {
  return paged(`/v1/apps/${CFG.appId}/analyticsReportRequests?limit=200`);
}

async function cmdRequest() {
  const existing = await listRequests();
  for (const type of ['ONGOING', 'ONE_TIME_SNAPSHOT']) {
    const found = existing.find((r) => r.attributes?.accessType === type && !r.attributes?.stoppedDueToInactivity);
    if (found) {
      console.log(`${type}: mevcut istek, id=${found.id}`);
      continue;
    }
    try {
      const j = await api('POST', '/v1/analyticsReportRequests', {
        data: {
          type: 'analyticsReportRequests',
          attributes: { accessType: type },
          relationships: { app: { data: { type: 'apps', id: CFG.appId } } },
        },
      });
      console.log(`${type}: olusturuldu, id=${j.data.id}`);
    } catch (e) {
      if (e instanceof UserError) throw e;
      console.log(`${type}: olusturulamadi (${e.message})`);
    }
  }
  console.log('Not: Apple ilk raporlari istekten sonra 1-2 gun icinde uretir; hazir olunca --list instance gosterir.');
}

async function reportsOf(reqId) {
  return paged(`/v1/analyticsReportRequests/${reqId}/reports?limit=200`);
}
async function instancesOf(repId) {
  return paged(`/v1/analyticsReports/${repId}/instances?filter[granularity]=DAILY&limit=200`);
}

async function cmdList() {
  const reqs = await listRequests();
  if (!reqs.length) {
    console.log('Rapor istegi yok. Once --request calistir.');
    return;
  }
  let totalInst = 0;
  for (const r of reqs) {
    console.log(`Istek ${r.id} accessType=${r.attributes?.accessType}${r.attributes?.stoppedDueToInactivity ? ' (durdurulmus)' : ''}`);
    const reps = await reportsOf(r.id);
    if (!reps.length) console.log('  Henuz rapor yok (Apple uretmedi).');
    for (const rep of reps) {
      const inst = await instancesOf(rep.id);
      totalInst += inst.length;
      const dates = inst.map((i) => i.attributes?.processingDate).filter(Boolean).sort();
      const range = dates.length ? `${dates[0]} .. ${dates[dates.length - 1]}` : '-';
      console.log(`  [${rep.attributes?.category}] ${rep.attributes?.name} (id=${rep.id}) instance=${inst.length} ${range}`);
    }
  }
  console.log(totalInst ? `Hazir instance toplam: ${totalInst}` : 'Hazir instance yok: raporlar henuz hazir degil.');
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const split = (l) => {
    if (delim === '\t') return l.split('\t');
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const o = {};
    head.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
    return o;
  });
}

const pick = (row, ...names) => {
  for (const k of Object.keys(row)) if (names.includes(k.toLowerCase())) return row[k];
  return '';
};

async function cmdFetch(args) {
  if (!args.report) throw new UserError('--report "<ad>" gerekir.');
  const days = args.days;
  const outDir = path.resolve(args.out || DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const want = args.report.toLowerCase();

  const reqs = await listRequests();
  if (!reqs.length) throw new UserError('Rapor istegi yok. Once --request calistir.');
  const matches = [];
  for (const r of reqs) {
    for (const rep of await reportsOf(r.id)) {
      if ((rep.attributes?.name || '').toLowerCase().includes(want)) matches.push(rep);
    }
  }
  if (!matches.length) throw new UserError(`"${args.report}" adli rapor bulunamadi; rapor henuz hazir degil olabilir. --list ile bak.`);

  const rows = [];
  const seen = new Set();
  let files = 0;
  for (const rep of matches) {
    const inst = (await instancesOf(rep.id)).filter((i) => (i.attributes?.processingDate || '') >= cutoff);
    for (const i of inst) {
      const segs = await paged(`/v1/analyticsReportInstances/${i.id}/segments?limit=200`);
      for (const s of segs) {
        const url = s.attributes?.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Segment indirilemedi: HTTP ${res.status}`);
        let buf = Buffer.from(await res.arrayBuffer());
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
        const text = buf.toString('utf8');
        const safe = rep.attributes.name.replace(/[^A-Za-z0-9]+/g, '_');
        fs.writeFileSync(path.join(outDir, `${safe}_${i.attributes.processingDate}_${s.id.slice(0, 8)}.csv`), text);
        files++;
        for (const r of parseCsv(text)) rows.push(r);
      }
    }
  }
  if (!files) throw new UserError(`Son ${days} gun icin instance/segment yok: rapor henuz hazir degil.`);
  console.log(`${files} CSV yazildi: ${outDir} (${rows.length} satir)`);
  summarize(rows);
}

function summarize(rows) {
  const metrics = ['Impressions', 'Page Views', 'Downloads', 'First-Time', 'Search Downloads'];
  const agg = {};
  const bump = (cc, m, v) => {
    agg[cc] ??= {};
    agg[cc][m] = (agg[cc][m] || 0) + v;
  };
  for (const r of rows) {
    const cc = (pick(r, 'territory', 'country', 'country code') || '??').toUpperCase();
    const n = Number(pick(r, 'counts', 'count')) || 0;
    const ev = pick(r, 'event', 'engagement type').toLowerCase();
    const dl = pick(r, 'download type').toLowerCase();
    const src = pick(r, 'source type', 'source').toLowerCase();
    const isSearch = src.includes('search');
    const add = (m) => {
      bump(cc, m, n); bump('TOPLAM', m, n);
      if (isSearch) { bump(`${cc}/Search`, m, n); bump('TOPLAM/Search', m, n); }
    };
    if (ev.includes('impression')) add('Impressions');
    else if (ev.includes('page view')) add('Page Views');
    if (dl) {
      if (dl.includes('first')) add('First-Time');
      add('Downloads');
    } else if (ev.includes('download')) add('Downloads');
  }
  void metrics;
  const keys = [];
  for (const cc of [...COUNTRIES, 'TOPLAM']) { keys.push(cc); keys.push(`${cc}/Search`); }
  const cols = ['Impressions', 'Page Views', 'Downloads', 'First-Time'];
  console.log(['Ulke'.padEnd(14), ...cols.map((c) => c.padStart(12)), 'Conv%'.padStart(8)].join(' '));
  for (const k of keys) {
    const a = agg[k];
    if (!a) continue;
    const base = a['Page Views'] || 0;
    const conv = base && a['Downloads'] ? `${((a['Downloads'] / base) * 100).toFixed(1)}%` : '-';
    console.log([k.padEnd(14), ...cols.map((c) => String(a[c] ?? '-').padStart(12)), conv.padStart(8)].join(' '));
  }
  console.log('Not: Conv% = Downloads / Page Views; secilen raporda ilgili sutun yoksa "-" gorunur (farkli rapor icin tekrar calistir).');
}

function parseArgs(argv) {
  const a = { mode: null, report: null, days: 30, out: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--request') a.mode = 'request';
    else if (x === '--list') a.mode = 'list';
    else if (x === '--fetch') a.mode = 'fetch';
    else if (x === '--report') a.report = argv[++i];
    else if (x === '--days') a.days = Number(argv[++i]) || 30;
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--help' || x === '-h') a.mode = 'help';
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || args.mode === 'help') {
    console.log('Kullanim: asc-analytics.mjs --request | --list | --fetch --report "<ad>" [--days 30] [--out <klasor>]');
    return;
  }
  CFG = loadConfig();
  TOKEN = makeToken(CFG);
  if (args.mode === 'request') await cmdRequest();
  else if (args.mode === 'list') await cmdList();
  else await cmdFetch(args);
}

main().catch((e) => {
  console.error(e instanceof UserError ? `HATA: ${e.message}` : `BEKLENMEYEN HATA: ${e.message}`);
  process.exit(1);
});
