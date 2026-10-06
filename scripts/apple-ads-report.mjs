#!/usr/bin/env node
// zerospike Apple Ads raporu. Yalniz okur; hicbir kampanya ayarini degistirmez.
// Bagimlilik yok: yalniz Node stdlib. JWT, apple-ads-setup.mjs icindeki createClientSecret ile uretilir.
// Cikti stdout'a markdown; uyari ve tekrar denemeler stderr'e gider.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createClientSecret } from './apple-ads-setup.mjs';

const API_BASE = 'https://api.searchads.apple.com/api/v5';
const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const OAUTH_SCOPE = 'searchadsorg';
const CONFIG_PATH = path.join(homedir(), '.apple-ads', 'zerospike', 'config.json');
const RETRY_STATUS = 502;
const RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 3000;
const PAGE_SIZE = 1000;

class UserError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function printHelp() {
  console.log([
    'zerospike Apple Ads rapor scripti (salt okunur, hicbir sey degistirmez)',
    '',
    'Kullanim: node scripts/apple-ads-report.mjs [secenek]',
    '',
    'Secenekler:',
    '  --days <N>      Rapor penceresi: bugun dahil son N gun (1..365). Varsayilan 7',
    '  --prefix <ad>   Kampanya adi on eki. Varsayilan ZS-US',
    '  --top <N>       Arama terimi tablolarinda en fazla N satir. Varsayilan 25',
    '  --help          Bu metin',
    '',
    'Cikti (stdout, markdown): kampanya, ad group ve keyword tablolari (gosterim, tap, TTR, kurulum,',
    'yeni indirme, harcama, ortalama CPT, CPA) ile Search Match ve hedefli kelime arama terimi tablolari.',
    'Apple 502 dondururse istek 2 kez daha denenir.',
    '',
    `Yapilandirma: ${CONFIG_PATH} (apple-ads-setup.mjs ile ayni dosya)`,
  ].join('\n'));
}

function parseArgs(argv) {
  const args = { days: 7, prefix: 'ZS-US', top: 25, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--prefix') args.prefix = argv[++i];
    else if (a === '--top') args.top = Number(argv[++i]);
    else throw new UserError(`Bilinmeyen secenek: ${a}. Kullanim icin --help.`);
  }
  if (!Number.isInteger(args.days) || args.days < 1 || args.days > 365) throw new UserError('--days 1 ile 365 arasinda tam sayi olmali.');
  if (!args.prefix) throw new UserError('--prefix bos olamaz.');
  if (!Number.isInteger(args.top) || args.top < 1) throw new UserError('--top pozitif tam sayi olmali.');
  return args;
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new UserError(`Yapilandirma bulunamadi: ${CONFIG_PATH}. Kurulum icin scripts/apple-ads-README.md.`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new UserError(`Yapilandirma dosyasi gecerli JSON degil: ${CONFIG_PATH}\n${err.message}`);
  }
  for (const field of ['clientId', 'teamId', 'keyId', 'privateKeyPath', 'orgId']) {
    if (!cfg[field]) throw new UserError(`Yapilandirmada "${field}" eksik: ${CONFIG_PATH}`);
  }
  const keyPath = cfg.privateKeyPath.startsWith('~') ? path.join(homedir(), cfg.privateKeyPath.slice(1)) : cfg.privateKeyPath;
  if (!existsSync(keyPath)) throw new UserError(`Ozel anahtar bulunamadi: ${keyPath}`);
  return { ...cfg, privateKeyPem: readFileSync(keyPath, 'utf8') };
}

// setup scriptiyle ayni akis: once dokumandaki sorgu dizesi bicimi, reddedilirse govde bicimi.
async function fetchAccessToken(cfg) {
  const clientSecret = createClientSecret({
    clientId: cfg.clientId,
    teamId: cfg.teamId,
    keyId: cfg.keyId,
    privateKeyPem: cfg.privateKeyPem,
  });
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: clientSecret,
    scope: OAUTH_SCOPE,
  }).toString();

  let res = await fetch(`${TOKEN_URL}?${form}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Host: 'appleid.apple.com' },
  });
  let body = await res.text();
  if (!res.ok) {
    const first = `HTTP ${res.status}: ${body}`;
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    body = await res.text();
    if (!res.ok) throw new UserError(`Erisim jetonu alinamadi.\nSorgu dizesi denemesi ${first}\nGovde denemesi HTTP ${res.status}: ${body}`);
  }
  const token = JSON.parse(body).access_token;
  if (!token) throw new UserError(`Erisim jetonu yanitta yok: ${body}`);
  return token;
}

async function api(ctx, method, endpoint, body) {
  const headers = { Authorization: `Bearer ${ctx.token}`, 'X-AP-Context': `orgId=${ctx.cfg.orgId}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  for (let attempt = 0; ; attempt += 1) {
    let res;
    let text;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      text = await res.text();
    } catch (err) {
      throw new UserError(`Ag hatasi ${method} ${endpoint}: ${err.message}${err.cause ? ` (${err.cause.message || err.cause})` : ''}`);
    }
    if (res.status === RETRY_STATUS && attempt < RETRY_LIMIT) {
      const wait = RETRY_BASE_DELAY_MS * (attempt + 1);
      console.error(`UYARI: HTTP ${res.status} ${method} ${endpoint}, ${wait / 1000} sn sonra yeniden denenecek (${attempt + 1}/${RETRY_LIMIT}).`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new UserError(`API hatasi ${method} ${endpoint} HTTP ${res.status}\n${text}`);
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new UserError(`API yaniti JSON degil: ${method} ${endpoint}\n${text}`);
    }
    if (json.error && (json.error.errors || []).length > 0) {
      throw new UserError(`API govdesinde hata: ${method} ${endpoint}\n${JSON.stringify(json.error)}`);
    }
    return json;
  }
}

function extractRows(res) {
  const data = res && res.data;
  const body = (data && data.reportingDataResponse) || (res && res.reportingDataResponse) || data || res || {};
  return Array.isArray(body.row) ? body.row : [];
}

async function fetchReport(ctx, endpoint, { returnNoMetrics }) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const res = await api(ctx, 'POST', endpoint, {
      startTime: ctx.start,
      endTime: ctx.end,
      // Search term raporu yalniz ORTZ kabul eder; tum tablolar ayni saat diliminde kalir.
      timeZone: 'ORTZ',
      selector: {
        orderBy: [{ field: 'impressions', sortOrder: 'DESCENDING' }],
        pagination: { offset, limit: PAGE_SIZE },
      },
      returnRecordsWithNoMetrics: returnNoMetrics,
      returnRowTotals: true,
      returnGrandTotals: false,
    });
    const batch = extractRows(res);
    rows.push(...batch);
    offset += batch.length;
    const total = res.pagination && res.pagination.totalResults;
    if (batch.length === 0 || batch.length < PAGE_SIZE || (typeof total === 'number' && offset >= total)) break;
  }
  return rows;
}

function firstNumber(source, fields) {
  for (const f of fields) {
    if (source[f] !== undefined && source[f] !== null && source[f] !== '') return Number(source[f]) || 0;
  }
  return 0;
}

function amountOf(m) {
  if (m && typeof m === 'object' && m.amount !== undefined && m.amount !== null) return Number(m.amount) || 0;
  return Number(m) || 0;
}

// API 5: install alanlari tap/view/total olarak ayrildi; eski adlar geri dusus olarak okunur.
function metricsOf(row) {
  const t = row.total || {};
  return {
    impressions: firstNumber(t, ['impressions']),
    taps: firstNumber(t, ['taps']),
    installs: firstNumber(t, ['totalInstalls', 'tapInstalls', 'installs']),
    newDownloads: firstNumber(t, ['totalNewDownloads', 'tapNewDownloads', 'newDownloads']),
    spend: amountOf(t.localSpend),
  };
}

function sumMetrics(list) {
  return list.reduce((acc, m) => ({
    impressions: acc.impressions + m.impressions,
    taps: acc.taps + m.taps,
    installs: acc.installs + m.installs,
    newDownloads: acc.newDownloads + m.newDownloads,
    spend: acc.spend + m.spend,
  }), { impressions: 0, taps: 0, installs: 0, newDownloads: 0, spend: 0 });
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function money(ctx, n) {
  return ctx.currency === 'USD' ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${ctx.currency}`;
}

function optionalMoney(ctx, m) {
  if (m === undefined || m === null || m === '') return '-';
  const n = amountOf(m);
  return Number.isFinite(n) ? money(ctx, n) : '-';
}

function metricCells(ctx, m) {
  return [
    String(m.impressions),
    String(m.taps),
    m.impressions > 0 ? `${((m.taps / m.impressions) * 100).toFixed(2)}%` : '-',
    String(m.installs),
    String(m.newDownloads),
    money(ctx, m.spend),
    m.taps > 0 ? money(ctx, m.spend / m.taps) : '-',
    m.installs > 0 ? money(ctx, m.spend / m.installs) : '-',
  ];
}

const METRIC_HEADERS = ['Impr', 'Tap', 'TTR', 'Kur', 'Yeni', 'Harcama', 'CPT', 'CPA'];

function renderTable(headers, leadingAlign, bodyRows, totalRow) {
  const align = headers.map((_, i) => (i < leadingAlign ? '---' : '---:'));
  const lines = [`| ${headers.join(' | ')} |`, `| ${align.join(' | ')} |`];
  for (const r of bodyRows) lines.push(`| ${r.map(cell).join(' | ')} |`);
  if (totalRow) lines.push(`| ${totalRow.map((c, i) => (i === 0 ? `**${cell(c)}**` : cell(c))).join(' | ')} |`);
  return lines;
}

function statusText(display, serving, reasons) {
  const main = display || serving || '-';
  const why = Array.isArray(reasons) && reasons.length > 0 ? ` (${reasons.slice(0, 2).join(', ')})` : '';
  return `${main}${why}`;
}

function byLabel(a, b) {
  return String(a).localeCompare(String(b), 'en');
}

function bySpendThenImpressions(a, b) {
  return b.m.spend - a.m.spend || b.m.impressions - a.m.impressions;
}

function campaignSection(ctx, rows) {
  const items = rows.map((r) => ({ meta: r.metadata, m: metricsOf(r) })).sort((a, b) => byLabel(a.meta.campaignName, b.meta.campaignName));
  const body = items.map(({ meta, m }) => [
    meta.campaignName,
    statusText(meta.displayStatus, meta.servingStatus, meta.servingStateReasons),
    optionalMoney(ctx, meta.dailyBudget ?? meta.dailyBudgetAmount),
    ...metricCells(ctx, m),
  ]);
  const total = sumMetrics(items.map((i) => i.m));
  return renderTable(['Kampanya', 'Durum', 'Butce/gun', ...METRIC_HEADERS], 2, body, ['Toplam', '', '', ...metricCells(ctx, total)]);
}

function adGroupSection(ctx, rows) {
  const items = rows
    .filter((r) => r.metadata && !r.metadata.deleted)
    .map((r) => ({ meta: r.metadata, m: metricsOf(r) }))
    .sort(bySpendThenImpressions);
  const body = items.map(({ meta, m }) => [
    meta.adGroupName,
    statusText(meta.adGroupDisplayStatus, meta.adGroupServingStatus, meta.adGroupServingStateReasons),
    optionalMoney(ctx, meta.defaultBidAmount),
    meta.automatedKeywordsOptIn === undefined ? '-' : (meta.automatedKeywordsOptIn ? 'acik' : 'kapali'),
    ...metricCells(ctx, m),
  ]);
  const total = sumMetrics(items.map((i) => i.m));
  return renderTable(['Ad group', 'Durum', 'Teklif', 'Search Match', ...METRIC_HEADERS], 2, body, ['Toplam', '', '', '', ...metricCells(ctx, total)]);
}

function keywordSection(ctx, rows) {
  const items = rows
    .filter((r) => r.metadata && !r.metadata.deleted && !r.metadata.adGroupDeleted)
    .map((r) => ({ meta: r.metadata, m: metricsOf(r) }))
    .sort(bySpendThenImpressions);
  const body = items.map(({ meta, m }) => [
    meta.adGroupName,
    meta.keyword,
    meta.matchType,
    optionalMoney(ctx, meta.bidAmount),
    meta.keywordDisplayStatus || meta.keywordStatus || '-',
    ...metricCells(ctx, m),
  ]);
  const total = sumMetrics(items.map((i) => i.m));
  return renderTable(['Ad group', 'Kelime', 'Eslesme', 'Teklif', 'Durum', ...METRIC_HEADERS], 5, body, ['Toplam', '', '', '', '', ...metricCells(ctx, total)]);
}

function termLabel(row) {
  const text = row.metadata && row.metadata.searchTermText;
  if (text) return text;
  return row.other ? '(diger terimler, Apple 10 gosterim alti gizler)' : '(terim yok)';
}

function termTable(ctx, list, headers, leading, toCells) {
  if (list.length === 0) return null;
  const total = ['Toplam', ...Array(leading - 1).fill(''), ...metricCells(ctx, sumMetrics(list.map((i) => i.m)))];
  const lines = renderTable([...headers, ...METRIC_HEADERS], leading, list.slice(0, ctx.top).map(toCells), total);
  if (list.length > ctx.top) lines.push('', `> Ilk ${ctx.top} satir gosteriliyor, toplam ${list.length} satir; Toplam satiri tum satirlari kapsar.`);
  return lines;
}

function searchTermTables(ctx, rows) {
  const items = rows
    .filter((r) => r.metadata && !r.metadata.adGroupDeleted)
    .map((r) => ({ row: r, meta: r.metadata, m: metricsOf(r) }))
    .sort((a, b) => b.m.impressions - a.m.impressions || b.m.spend - a.m.spend);
  const auto = items.filter((i) => i.meta.searchTermSource === 'AUTO');
  const targeted = items.filter((i) => i.meta.searchTermSource !== 'AUTO');
  return {
    auto: termTable(ctx, auto, ['Arama terimi', 'Ad group'], 2, ({ row, meta, m }) => [termLabel(row), meta.adGroupName, ...metricCells(ctx, m)]),
    targeted: termTable(ctx, targeted, ['Arama terimi', 'Kelime', 'Eslesme', 'Ad group'], 4, ({ row, meta, m }) => [
      termLabel(row),
      meta.keyword || '-',
      meta.matchType || '-',
      meta.adGroupName,
      ...metricCells(ctx, m),
    ]),
  };
}

async function guarded(ctx, out, title, fn) {
  try {
    await fn();
  } catch (err) {
    ctx.failures += 1;
    const firstLine = String(err.message).split('\n')[0];
    out.push(`> HATA (${title}): ${firstLine}`, '');
    console.error(`HATA (${title}): ${err.message}`);
  }
}

async function collectCampaign(ctx, row) {
  const { campaignId, campaignName } = row.metadata;
  const base = `/reports/campaigns/${campaignId}`;
  const entry = { name: campaignName, adGroups: null, keywords: null, terms: null, errors: [] };
  await guarded(ctx, entry.errors, `${campaignName} ad group`, async () => {
    entry.adGroups = await fetchReport(ctx, `${base}/adgroups`, { returnNoMetrics: true });
  });
  await guarded(ctx, entry.errors, `${campaignName} keyword`, async () => {
    entry.keywords = await fetchReport(ctx, `${base}/keywords`, { returnNoMetrics: true });
  });
  await guarded(ctx, entry.errors, `${campaignName} arama terimi`, async () => {
    entry.terms = searchTermTables(ctx, await fetchReport(ctx, `${base}/searchterms`, { returnNoMetrics: false }));
  });
  return entry;
}

function emitPerCampaign(out, heading, entries, render, empty = '(veri yok)') {
  out.push(`## ${heading}`, '');
  for (const entry of entries) {
    out.push(`### ${entry.name}`, '');
    const lines = render(entry);
    out.push(...(lines && lines.length > 0 ? lines : [empty]), '');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const cfg = loadConfig();
  const end = new Date();
  const start = new Date(end.getTime() - (args.days - 1) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const ctx = {
    cfg,
    token: await fetchAccessToken(cfg),
    start: iso(start),
    end: iso(end),
    days: args.days,
    prefix: args.prefix,
    top: args.top,
    currency: 'USD',
    failures: 0,
  };

  const allCampaigns = await fetchReport(ctx, '/reports/campaigns', { returnNoMetrics: true });
  const campaigns = allCampaigns
    .filter((r) => r.metadata && !r.metadata.deleted && String(r.metadata.campaignName || '').startsWith(ctx.prefix))
    .sort((a, b) => byLabel(a.metadata.campaignName, b.metadata.campaignName));
  if (campaigns.length === 0) throw new UserError(`"${ctx.prefix}" ile baslayan kampanya bulunamadi (${allCampaigns.length} kampanya tarandi).`);

  const spendWithCurrency = campaigns.map((r) => (r.total || {}).localSpend).find((m) => m && m.currency);
  if (spendWithCurrency) ctx.currency = spendWithCurrency.currency;

  // Istekler sirayla gider; oran siniri ve 502 riski kucuk tutulur.
  const perCampaign = [];
  for (const row of campaigns) perCampaign.push(await collectCampaign(ctx, row));

  const out = [
    `# Apple Ads raporu: ${ctx.prefix}*`,
    '',
    `Donem: ${ctx.start} .. ${ctx.end} (${ctx.days} gun, bugun dahil, saat dilimi ORTZ) | orgId ${cfg.orgId} | Olusturuldu: ${new Date().toISOString()}`,
    '',
    '## Kampanyalar',
    '',
    ...campaignSection(ctx, campaigns),
    '',
  ];
  emitPerCampaign(out, "Ad group'lar", perCampaign, (e) => e.adGroups && adGroupSection(ctx, e.adGroups));
  emitPerCampaign(out, 'Kelimeler', perCampaign, (e) => e.keywords && keywordSection(ctx, e.keywords));
  emitPerCampaign(out, 'Search Match arama terimleri', perCampaign, (e) => e.terms && e.terms.auto, '(veri yok: Search Match henuz terim uretmedi veya terimler 10 gosterimin altinda)');
  emitPerCampaign(out, 'Hedefli kelimelerin arama terimleri (Broad ve Exact)', perCampaign, (e) => e.terms && e.terms.targeted);
  for (const entry of perCampaign) out.push(...entry.errors);
  out.push(
    '## Notlar',
    '',
    '- Kur = kurulum (yeni + tekrar indirme). Yeni = yeni indirme. CPA = harcama / Kur. CPT = harcama / Tap. TTR = Tap / Impr.',
    '- Apple raporlari birkac saat gecikmelidir; sifir gosterim kararini 24 saatten once vermeyin.',
    '- Arama terimi raporu 10 gosterimin altindaki terimleri gizler; kucuk butcede cogu terim "diger" satirinda kalir.',
    '- Silinmis kampanya, ad group ve kelimeler listelenmez.',
  );
  console.log(out.join('\n'));

  if (ctx.failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof UserError) {
    console.error('');
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.error('');
  console.error('Beklenmeyen hata:');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
