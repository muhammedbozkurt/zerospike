#!/usr/bin/env node
// zerospike Apple Ads v2 kampanya kurulumu.
// Bagimlilik yok: yalniz Node stdlib. Varsayilan mod --dry-run, aga cikmaz.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api.searchads.apple.com/api/v5';
const TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const JWT_AUDIENCE = 'https://appleid.apple.com';
const OAUTH_SCOPE = 'searchadsorg';
const CURRENCY = 'USD';
const CLIENT_SECRET_DAYS = 180;
const BULK_CHUNK = 1000;
const BULK_MIN_GAP_MS = 5000;
// Ad group startTime "current time"dan buyuk olmali; saat farki ve gecikme icin pay birakiliyor.
const AD_GROUP_START_OFFSET_MS = 15 * 60 * 1000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'apple-ads');
const CONFIG_PATH = path.join(homedir(), '.apple-ads', 'zerospike', 'config.json');

const MARKETS = {
  de: {
    label: 'DE',
    country: 'DE',
    keywordsCsv: 'keywords-de.csv',
    sharedNegativesCsv: 'negatives-de.csv',
    discoveryNegativesCsv: 'negatives-de-discovery.csv',
    budgets: {
      'ZS-DE-Brand': '1.00',
      'ZS-DE-Generic': '5.00',
      'ZS-DE-Competitor': '1.50',
      'ZS-DE-Discovery': '3.00',
    },
    discoveryCampaign: 'ZS-DE-Discovery',
    searchMatchBid: '0.50',
    expected: { campaigns: 4, csvAdGroups: 12, keywords: 125, sharedNegatives: 37, discoveryNegatives: 191 },
  },
  fr: {
    label: 'FR',
    country: 'FR',
    keywordsCsv: 'keywords-fr.csv',
    sharedNegativesCsv: 'negatives-fr.csv',
    discoveryNegativesCsv: 'negatives-fr-discovery.csv',
    budgets: {
      'ZS-FR-Brand': '1.00',
      'ZS-FR-Generic': '2.00',
      'ZS-FR-Competitor': '1.00',
      'ZS-FR-Discovery': '2.00',
    },
    discoveryCampaign: 'ZS-FR-Discovery',
    searchMatchBid: '0.20',
    expected: { campaigns: 4, csvAdGroups: 12, keywords: 104, sharedNegatives: 30, discoveryNegatives: 139 },
  },
  // Tek kampanyali test: ayri Discovery listesi yok, negatifler kampanya duzeyindedir. Takvim (--start, --end) istege baglidir.
  us: {
    label: 'US',
    country: 'US',
    keywordsCsv: 'keywords-us.csv',
    sharedNegativesCsv: 'negatives-us.csv',
    discoveryNegativesCsv: null,
    budgets: {
      'ZS-US-Test': '3.50',
    },
    discoveryCampaign: 'ZS-US-Test',
    searchMatchBid: '0.60',
    devices: ['IPHONE', 'IPAD'],
    newUsersOnly: false,
    acceptsSchedule: true,
    checkDefaultAd: true,
    expected: { campaigns: 1, csvAdGroups: 2, keywords: 13, sharedNegatives: 70, discoveryNegatives: 0 },
  },
};

const SEARCH_MATCH_AD_GROUP = 'SearchMatch';

class UserError extends Error {}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let hasField = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; hasField = true; continue; }
    if (c === ',') { row.push(field); field = ''; hasField = true; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = []; field = ''; hasField = false;
      continue;
    }
    field += c;
    hasField = true;
  }
  if (hasField || field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
  }
  return rows;
}

function readRecords(file, requiredColumns) {
  const full = path.join(DOCS_DIR, file);
  if (!existsSync(full)) throw new UserError(`CSV bulunamadi: ${full}`);
  const rows = parseCsv(readFileSync(full, 'utf8'));
  if (rows.length === 0) throw new UserError(`CSV bos: ${full}`);
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const col of requiredColumns) {
    if (!header.includes(col)) throw new UserError(`${file} icinde "${col}" sutunu yok. Basliklar: ${header.join(', ')}`);
  }
  return rows.slice(1).map((cells, idx) => {
    const rec = { _line: idx + 2, _file: file };
    header.forEach((h, i) => { rec[h] = (cells[i] ?? '').trim(); });
    return rec;
  });
}

function normalizeMatchType(value, ctx) {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'EXACT' || upper === 'BROAD') return upper;
  throw new UserError(`${ctx}: gecersiz eslesme turu "${value}". Yalniz Exact veya Broad kabul edilir.`);
}

function normalizeBid(value, ctx) {
  const raw = String(value || '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new UserError(`${ctx}: gecersiz teklif "${value}". Ornek bicim: 0.45`);
  const num = Number(raw);
  if (!(num > 0)) throw new UserError(`${ctx}: teklif sifirdan buyuk olmali.`);
  return num.toFixed(2);
}

function buildPlan(marketKey) {
  const market = MARKETS[marketKey];
  const warnings = [];
  const keywordRows = readRecords(market.keywordsCsv, ['campaign', 'ad group', 'keyword', 'match type', 'bid']);

  const campaigns = new Map();
  const seenKeywords = new Set();
  for (const row of keywordRows) {
    const ctx = `${row._file}:${row._line}`;
    const campaignName = row.campaign;
    const adGroupName = row['ad group'];
    const text = row.keyword;
    if (!campaignName || !adGroupName || !text) throw new UserError(`${ctx}: campaign, ad group ve keyword bos olamaz.`);
    if (!(campaignName in market.budgets)) {
      throw new UserError(`${ctx}: "${campaignName}" plandaki butce tablosunda yok. Beklenen: ${Object.keys(market.budgets).join(', ')}`);
    }
    const matchType = normalizeMatchType(row['match type'], ctx);
    const bid = normalizeBid(row.bid, ctx);

    const dedupeKey = `${campaignName}|${adGroupName}|${text.toLowerCase()}|${matchType}`;
    if (seenKeywords.has(dedupeKey)) {
      warnings.push(`${ctx}: tekrar eden kelime atlandi: ${text}`);
      continue;
    }
    seenKeywords.add(dedupeKey);

    if (!campaigns.has(campaignName)) {
      campaigns.set(campaignName, {
        name: campaignName,
        country: market.country,
        dailyBudget: market.budgets[campaignName],
        isDiscovery: campaignName === market.discoveryCampaign,
        adGroups: new Map(),
        negatives: [],
        negativesSource: '',
      });
    }
    const campaign = campaigns.get(campaignName);
    if (!campaign.adGroups.has(adGroupName)) {
      campaign.adGroups.set(adGroupName, {
        name: adGroupName,
        keywords: [],
        searchMatch: false,
        fromCsv: true,
        defaultBid: '0.00',
      });
    }
    campaign.adGroups.get(adGroupName).keywords.push({ text, matchType, bid });
  }

  for (const name of Object.keys(market.budgets)) {
    if (!campaigns.has(name)) throw new UserError(`${market.keywordsCsv}: "${name}" kampanyasi icin hic satir yok.`);
  }

  for (const campaign of campaigns.values()) {
    for (const adGroup of campaign.adGroups.values()) {
      // Ad group varsayilan teklifi, o grubun en yuksek kelime teklifidir.
      adGroup.defaultBid = adGroup.keywords
        .reduce((max, kw) => (Number(kw.bid) > Number(max) ? kw.bid : max), '0.00');
    }
  }

  const discovery = campaigns.get(market.discoveryCampaign);
  discovery.adGroups.set(SEARCH_MATCH_AD_GROUP, {
    name: SEARCH_MATCH_AD_GROUP,
    keywords: [],
    searchMatch: true,
    fromCsv: false,
    defaultBid: market.searchMatchBid,
  });

  for (const campaign of campaigns.values()) {
    // Apple: dailyBudgetAmount, ad group defaultBidAmount degerinden kucuk olamaz.
    const maxBid = [...campaign.adGroups.values()].reduce((max, g) => Math.max(max, Number(g.defaultBid)), 0);
    if (Number(campaign.dailyBudget) < maxBid) {
      throw new UserError(`${campaign.name}: gunluk butce ${campaign.dailyBudget} ${CURRENCY}, en yuksek teklif ${maxBid.toFixed(2)} ${CURRENCY}. Gunluk butce teklifi asmali.`);
    }
  }

  const sharedNegatives = loadNegatives(market.sharedNegativesCsv);
  const discoveryNegatives = market.discoveryNegativesCsv ? loadNegatives(market.discoveryNegativesCsv) : null;

  for (const campaign of campaigns.values()) {
    if (campaign.isDiscovery && discoveryNegatives) {
      campaign.negatives = discoveryNegatives;
      campaign.negativesSource = market.discoveryNegativesCsv;
    } else {
      campaign.negatives = sharedNegatives;
      campaign.negativesSource = market.sharedNegativesCsv;
    }
  }

  const csvAdGroupCount = [...campaigns.values()]
    .reduce((sum, c) => sum + [...c.adGroups.values()].filter((g) => g.fromCsv).length, 0);
  const totalAdGroupCount = [...campaigns.values()].reduce((sum, c) => sum + c.adGroups.size, 0);
  const keywordCount = [...campaigns.values()]
    .reduce((sum, c) => sum + [...c.adGroups.values()].reduce((s, g) => s + g.keywords.length, 0), 0);

  const counts = {
    campaigns: campaigns.size,
    csvAdGroups: csvAdGroupCount,
    totalAdGroups: totalAdGroupCount,
    keywords: keywordCount,
    sharedNegatives: sharedNegatives.length,
    discoveryNegatives: discoveryNegatives ? discoveryNegatives.length : 0,
    negativeRows: [...campaigns.values()].reduce((sum, c) => sum + c.negatives.length, 0),
  };

  const expected = market.expected;
  const checks = [
    ['kampanya', counts.campaigns, expected.campaigns],
    ['CSV ad group', counts.csvAdGroups, expected.csvAdGroups],
    ['keyword', counts.keywords, expected.keywords],
    ['paylasilan negatif', counts.sharedNegatives, expected.sharedNegatives],
    ['Discovery negatif', counts.discoveryNegatives, expected.discoveryNegatives],
  ];
  for (const [label, actual, want] of checks) {
    if (actual !== want) warnings.push(`SAYIM SAPMASI: ${label} beklenen ${want}, bulunan ${actual}`);
  }

  const missingInDiscovery = discoveryNegatives ? sharedNegatives.filter(
    (n) => !discoveryNegatives.some((d) => d.text.toLowerCase() === n.text.toLowerCase() && d.matchType === n.matchType),
  ) : [];
  if (missingInDiscovery.length > 0) {
    warnings.push(`${market.discoveryNegativesCsv} paylasilan listeyi kapsamiyor, eksik ${missingInDiscovery.length} satir. Ornek: ${missingInDiscovery[0].text}`);
  }

  return { marketKey, market, campaigns: [...campaigns.values()], counts, warnings };
}

function loadNegatives(file) {
  const rows = readRecords(file, ['keyword', 'match type']);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const ctx = `${row._file}:${row._line}`;
    const text = row.keyword;
    if (!text) throw new UserError(`${ctx}: negatif kelime bos.`);
    const matchType = normalizeMatchType(row['match type'], ctx);
    const key = `${text.toLowerCase()}|${matchType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, matchType });
  }
  return out;
}

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(value, width) {
  const s = String(value);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function printPlan(plan, { showBodies = false } = {}) {
  const { market, campaigns, counts } = plan;
  console.log('');
  console.log(`Pazar: ${market.label} (${market.country})`);
  console.log(`${pad('Kampanya', 20)}${padLeft('Butce/gun', 12)}${padLeft('Ad group', 10)}${padLeft('Keyword', 9)}${padLeft('Negatif', 9)}  Negatif kaynagi`);
  console.log('-'.repeat(96));
  let budgetTotal = 0;
  for (const c of campaigns) {
    const kw = [...c.adGroups.values()].reduce((s, g) => s + g.keywords.length, 0);
    budgetTotal += Number(c.dailyBudget);
    console.log(
      pad(c.name, 20)
      + padLeft(`${c.dailyBudget} ${CURRENCY}`, 12)
      + padLeft(c.adGroups.size, 10)
      + padLeft(kw, 9)
      + padLeft(c.negatives.length, 9)
      + '  ' + c.negativesSource,
    );
  }
  console.log('-'.repeat(96));
  console.log(
    pad('TOPLAM', 20)
    + padLeft(`${budgetTotal.toFixed(2)} ${CURRENCY}`, 12)
    + padLeft(counts.totalAdGroups, 10)
    + padLeft(counts.keywords, 9)
    + padLeft(counts.negativeRows, 9),
  );

  console.log('');
  console.log(`${pad('Ad group', 24)}${pad('Kampanya', 20)}${padLeft('Varsayilan teklif', 18)}${padLeft('Keyword', 9)}${padLeft('Search Match', 14)}`);
  console.log('-'.repeat(96));
  for (const c of campaigns) {
    for (const g of c.adGroups.values()) {
      console.log(
        pad(g.name, 24)
        + pad(c.name, 20)
        + padLeft(`${g.defaultBid} ${CURRENCY}`, 18)
        + padLeft(g.keywords.length, 9)
        + padLeft(g.searchMatch ? 'acik' : 'kapali', 14),
      );
    }
  }

  const hasDiscoveryList = Boolean(market.discoveryNegativesCsv);
  const sharedCampaignCount = campaigns.filter((c) => !c.isDiscovery).length;
  const negativeSummary = hasDiscoveryList ? `${counts.sharedNegatives} + ${counts.discoveryNegatives}` : counts.sharedNegatives;
  const devices = (market.devices || ['IPHONE']).join(' + ');
  const audience = market.newUsersOnly === false ? 'tum kullanicilar (yeni kullanici kisiti yok)' : 'uygulamayi indirmemis kullanicilar';
  console.log('');
  console.log(`CSV ozeti ${market.label}: ${counts.campaigns} kampanya / ${counts.csvAdGroups} ad group / ${counts.keywords} keyword / ${negativeSummary} negatif`);
  console.log(`Olusturulacak ad group: ${counts.csvAdGroups} (CSV) + 1 (${SEARCH_MATCH_AD_GROUP}, kelimesiz) = ${counts.totalAdGroups}`);
  if (hasDiscoveryList) {
    console.log(`Yazilacak negatif satiri: ${counts.negativeRows} (paylasilan liste ${counts.sharedNegatives} x ${sharedCampaignCount} kampanya + Discovery listesi ${counts.discoveryNegatives}).`);
    console.log(`Discovery listesi paylasilan listeyi zaten kapsadigi icin Discovery kampanyasina yalniz ${market.discoveryNegativesCsv} yazilir.`);
  } else {
    console.log(`Yazilacak negatif satiri: ${counts.negativeRows} (${market.sharedNegativesCsv}, kampanya duzeyi, ayri Discovery listesi yok).`);
  }
  console.log(`Ortak ayarlar: yerlesim APPSTORE_SEARCH_RESULTS, cihaz ${devices}, hedef kitle ${audience}, kampanya durumu PAUSED.`);
  if (plan.schedule) {
    const s = plan.schedule;
    console.log(`Takvim: ${scheduleLabel(s)}${s.startTime ? '' : '; kampanya olusturuldugu anda baslar'}${s.clamped ? '; gecmis tarih verildigi icin baslangic simdiye cekildi' : ''}.`);
    if (showBodies) {
      for (const c of campaigns) {
        const body = buildCampaignBody({ orgId: '<orgId>', adamId: '<adamId>', campaign: c, schedule: s });
        console.log(`Kampanya govdesi ${c.name} (orgId ve adamId config.json'dan gelir): ${JSON.stringify(body)}`);
      }
    }
  }
  if (market.checkDefaultAd) {
    console.log('Default Ad: her ad group icin kontrol edilir; listede ad yoksa yalniz --create-default-ad ile olusturulur.');
  }

  if (plan.warnings.length > 0) {
    console.log('');
    for (const w of plan.warnings) console.log(`UYARI: ${w}`);
  }
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createClientSecret({ clientId, teamId, keyId, privateKeyPem, now = Date.now(), days = CLIENT_SECRET_DAYS }) {
  const header = { alg: 'ES256', kid: keyId };
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    sub: clientId,
    aud: JWT_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + 86400 * days,
    iss: teamId,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // ieee-p1363 = ham r||s; JOSE ES256 DER imzayi kabul etmez.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

function decodeJwt(token) {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
    signatureBytes: Buffer.from(s, 'base64url').length,
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, 'base64url'),
  };
}

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p;
}

function configHelp() {
  return [
    `Yapilandirma dosyasi bekleniyor: ${CONFIG_PATH}`,
    '',
    'Kurulum adimlari:',
    '  1. mkdir -p ~/.apple-ads/zerospike',
    '  2. openssl ecparam -genkey -name prime256v1 -noout -out ~/.apple-ads/zerospike/private-key.pem',
    '  3. openssl ec -in ~/.apple-ads/zerospike/private-key.pem -pubout -out ~/.apple-ads/zerospike/public-key.pem',
    '  4. ads.apple.com > Account Settings > API alanina public-key.pem icerigini yapistirip kaydedin.',
    '     Kaydettikten sonra ekranda clientId, teamId ve keyId gorunur.',
    '  5. Asagidaki icerigi config.json olarak yazin:',
    '',
    '{',
    '  "clientId": "SEARCHADS....",',
    '  "teamId": "SEARCHADS....",',
    '  "keyId": "....",',
    '  "orgId": 0,',
    '  "adamId": 6778782351,',
    '  "privateKeyPath": "~/.apple-ads/zerospike/private-key.pem"',
    '}',
    '',
    'orgId bilinmiyorsa once --whoami calistirin, /acls yanitindaki orgId degerini yazin.',
    'Bu dosya ve ozel anahtar depoya konulmaz.',
  ].join('\n');
}

function loadConfig({ requireOrgId = true, requireAdamId = false } = {}) {
  if (!existsSync(CONFIG_PATH)) throw new UserError(`Yapilandirma bulunamadi.\n\n${configHelp()}`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new UserError(`Yapilandirma dosyasi gecerli JSON degil: ${CONFIG_PATH}\n${err.message}`);
  }
  for (const field of ['clientId', 'teamId', 'keyId', 'privateKeyPath']) {
    if (!cfg[field]) throw new UserError(`Yapilandirmada "${field}" eksik.\n\n${configHelp()}`);
  }
  const keyPath = expandHome(cfg.privateKeyPath);
  if (!existsSync(keyPath)) throw new UserError(`Ozel anahtar bulunamadi: ${keyPath}\n\n${configHelp()}`);
  if (requireOrgId && !cfg.orgId) throw new UserError(`Yapilandirmada "orgId" eksik. Once --whoami calistirip /acls yanitindaki orgId degerini yazin.`);
  if (requireAdamId && !cfg.adamId) throw new UserError(`Yapilandirmada "adamId" eksik. --find-app zerospike ile bulup yazin.`);
  return { ...cfg, privateKeyPem: readFileSync(keyPath, 'utf8') };
}

class AdsClient {
  constructor(config) {
    this.config = config;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.lastBulkAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) return this.accessToken;
    const clientSecret = createClientSecret(this.config);
    const params = {
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: clientSecret,
      scope: OAUTH_SCOPE,
    };
    const form = new URLSearchParams(params).toString();

    // Apple dokumani parametreleri sorgu dizesinde gosteriyor; bazi OAuth istemcileri govdeyi kullanir.
    // Once dokumandaki bicim denenir, reddedilirse govde bicimine dusulur.
    let res = await fetch(`${TOKEN_URL}?${form}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Host: 'appleid.apple.com' },
    });
    let body = await res.text();
    if (!res.ok) {
      const first = { status: res.status, body };
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      body = await res.text();
      if (!res.ok) {
        throw new UserError(
          `Erisim jetonu alinamadi.\nSorgu dizesi denemesi HTTP ${first.status}:\n${first.body}\n`
          + `Govde denemesi HTTP ${res.status}:\n${body}`,
        );
      }
    }
    const json = JSON.parse(body);
    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, (Number(json.expires_in) || 3600) - 60) * 1000;
    return this.accessToken;
  }

  async request(method, endpoint, { body, query, withOrg = true, tolerateBodyErrors = false } = {}) {
    const token = await this.getAccessToken();
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${token}` };
    if (withOrg && this.config.orgId) headers['X-AP-Context'] = `orgId=${this.config.orgId}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      throw new UserError(`API hatasi ${method} ${url.pathname} HTTP ${res.status}\n${text}`);
    }
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new UserError(`API yaniti JSON degil: ${method} ${url.pathname}\n${text}`);
    }
    if (!tolerateBodyErrors && json.error && (json.error.errors || []).length > 0) {
      throw new UserError(`API govdesinde hata: ${method} ${url.pathname}\n${JSON.stringify(json.error, null, 2)}`);
    }
    return json;
  }

  async waitForBulkSlot() {
    const wait = BULK_MIN_GAP_MS - (Date.now() - this.lastBulkAt);
    if (wait > 0) await new Promise((resolve) => { setTimeout(resolve, wait); });
    this.lastBulkAt = Date.now();
  }

  async bulk(endpoint, items) {
    const results = [];
    for (let i = 0; i < items.length; i += BULK_CHUNK) {
      const chunk = items.slice(i, i + BULK_CHUNK);
      await this.waitForBulkSlot();
      // Bulk uclari yinelenen satirda 200 donup hatayi govdeye koyar; burada durmak yerine raporlanir.
      const res = await this.request('POST', endpoint, { body: chunk, tolerateBodyErrors: true });
      const failed = (res.error && res.error.errors) || [];
      if (failed.length > 0) console.log(`  NOT: ${failed.length} satir reddedildi: ${JSON.stringify(failed).slice(0, 500)}`);
      results.push(...(res.data || []));
    }
    return results;
  }
}

async function findCampaignByName(client, name) {
  const res = await client.request('POST', '/campaigns/find', {
    body: {
      pagination: { offset: 0, limit: 1000 },
      conditions: [{ field: 'name', operator: 'EQUALS', values: [name] }],
    },
  });
  return (res.data || []).find((c) => c.name === name && !c.deleted) || null;
}

async function findAdGroupByName(client, campaignId, name) {
  const res = await client.request('POST', `/campaigns/${campaignId}/adgroups/find`, {
    body: {
      pagination: { offset: 0, limit: 1000 },
      conditions: [{ field: 'name', operator: 'EQUALS', values: [name] }],
    },
  });
  return (res.data || []).find((g) => g.name === name && !g.deleted) || null;
}

async function listAll(client, endpoint) {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await client.request('GET', endpoint, { query: { limit: 1000, offset } });
    const batch = res.data || [];
    out.push(...batch);
    const total = res.pagination && res.pagination.totalResults;
    offset += batch.length;
    if (batch.length === 0 || (typeof total === 'number' && offset >= total)) break;
    if (batch.length < 1000) break;
  }
  return out;
}

function money(amount) {
  return { amount, currency: CURRENCY };
}

// Apple tarih bicimi: UTC, "Z" eki yok.
function toApiTime(ms) {
  return new Date(ms).toISOString().replace('Z', '');
}

function parseDay(value) {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  // Date.parse 2026-02-31 gibi tarihleri sessizce kaydirir; gidis donus kontrolu bunu yakalar.
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
}

function parseStart(value) {
  if (value === 'now') return 'now';
  const ms = parseDay(value);
  if (Number.isNaN(ms)) {
    throw new UserError(`--start gecersiz: "${value}". Ornek: --start 2026-10-14 (UTC 00:00) veya --start now.`);
  }
  return ms;
}

function parseEnd(value) {
  const ms = parseDay(value);
  if (Number.isNaN(ms)) {
    throw new UserError(`--end gecersiz: "${value}". Ornek: --end 2026-10-28 (UTC 00:00).`);
  }
  return ms;
}

// Takvimli pazarlarda (acceptsSchedule) tarih istege baglidir. --start yoksa kampanya govdesine hicbir tarih
// yazilmaz (Apple varsayilani: olusturuldugu anda baslar, bitis yok); endTime yalniz --end ile yazilir.
function resolveSchedule(market, startArg, endArg) {
  if (!market.acceptsSchedule) return null;
  if (startArg == null) return { startTime: null, endTime: null, clamped: false };
  const earliest = Date.now() + AD_GROUP_START_OFFSET_MS;
  const wanted = startArg === 'now' ? earliest : startArg;
  const clamped = wanted < earliest;
  const startMs = clamped ? earliest : wanted;
  if (endArg != null && endArg <= startMs) {
    throw new UserError(`${market.label}: --end (${toApiTime(endArg)}) baslangictan (${toApiTime(startMs)}) sonra olmali.`);
  }
  return {
    startTime: toApiTime(startMs),
    endTime: endArg == null ? null : toApiTime(endArg),
    clamped,
  };
}

function scheduleLabel(s) {
  if (!s.startTime) return 'tarih yok, bitis yok';
  if (!s.endTime) return `baslangic ${s.startTime} UTC, bitis yok`;
  return `${s.startTime} .. ${s.endTime} UTC`;
}

function scheduleDiffers(campaign, schedule) {
  const differs = (have, want) => String(have || '').slice(0, 16) !== String(want || '').slice(0, 16);
  // Baslangica yalniz --start verildiyse bakilir; verilmediyse kampanya olusturuldugu andaki degeri tasir.
  return (schedule.startTime != null && differs(campaign.startTime, schedule.startTime)) || differs(campaign.endTime, schedule.endTime);
}

// Tarih alanlari yalniz verildiyse govdeye girer; yazilmayan alan Apple varsayilanina kalir.
function buildCampaignBody({ orgId, adamId, campaign, schedule }) {
  const body = {
    orgId,
    name: campaign.name,
    adamId,
    countriesOrRegions: [campaign.country],
    adChannelType: 'SEARCH',
    supplySources: ['APPSTORE_SEARCH_RESULTS'],
    billingEvent: 'TAPS',
    dailyBudgetAmount: money(campaign.dailyBudget),
    status: 'PAUSED',
  };
  if (schedule?.startTime) body.startTime = schedule.startTime;
  if (schedule?.endTime) body.endTime = schedule.endTime;
  return body;
}

const DEFAULT_AD_NAME = 'Default Ad';
const DEFAULT_CREATIVE_NAME = 'Default Product Page';

async function findDefaultCreativeId(client, adamId) {
  const found = await client.request('POST', '/creatives/find', {
    body: {
      pagination: { offset: 0, limit: 100 },
      conditions: [
        { field: 'adamId', operator: 'EQUALS', values: [String(adamId)] },
        { field: 'type', operator: 'EQUALS', values: ['DEFAULT_PRODUCT_PAGE'] },
      ],
    },
  });
  const hit = (found.data || [])[0];
  if (hit) return hit.id;
  const created = await client.request('POST', '/creatives', {
    body: { adamId, name: DEFAULT_CREATIVE_NAME, type: 'DEFAULT_PRODUCT_PAGE' },
  });
  return created.data.id;
}

// Search Results ad group'larinda varsayilan ad Apple tarafindan otomatik saglanmasi beklenir (hesapta
// DEFAULT_PRODUCT_PAGE creative'i yok, konsol kampanyalari yine de calisti), bu yuzden varsayilan davranis yalniz
// kontroldur. Olusturma yalniz create=true iken denenir; uclar belgelenmis ama canli dogrulanmadi, hata
// kurulumu durdurmaz.
async function checkDefaultAd(client, campaignId, adGroup, state, create) {
  try {
    const listed = await client.request('GET', `/campaigns/${campaignId}/adgroups/${adGroup.id}/ads`);
    const ads = (listed.data || []).filter((a) => !a.deleted);
    if (ads.length > 0) {
      console.log(`    Ad: ${ads.length} mevcut, Default Ad eklenmedi.`);
      return;
    }
    if (!create) {
      console.log('    Ad: listede ad yok; Search Results ad group\'unda varsayilan ad Apple tarafindan saglanmasi beklenir.');
      console.log('        Gosterim gelmez ve ad group NO_AVAILABLE_ADS gosterirse ayni komutu --create-default-ad ile tekrar calistirin.');
      return;
    }
    if (!state.creativeId) state.creativeId = await findDefaultCreativeId(client, Number(client.config.adamId));
    const res = await client.request('POST', `/campaigns/${campaignId}/adgroups/${adGroup.id}/ads`, {
      body: { name: DEFAULT_AD_NAME, creativeId: state.creativeId, status: 'ENABLED' },
    });
    console.log(`    Ad: Default Ad olusturuldu (id ${res.data.id}).`);
  } catch (err) {
    console.log(`    UYARI: Default Ad kontrol edilemedi veya olusturulamadi, konsolda ${adGroup.name} > Ads sekmesine bakin.`);
    console.log(`    ${String(err.message).split('\n').join('\n    ')}`);
  }
}

async function applyMarket(client, plan) {
  const { market, campaigns } = plan;
  const adamId = Number(client.config.adamId);
  console.log('');
  console.log(`### ${market.label} uygulaniyor`);
  // "now" ve gecmis baslangic uygulama aninda yeniden hesaplanir; --market all uzun surerse pay tukenmesin.
  const schedule = resolveSchedule(market, plan.startArg, plan.endArg);
  const startTime = schedule?.startTime ?? toApiTime(Date.now() + AD_GROUP_START_OFFSET_MS);
  const targetingDimensions = { deviceClass: { included: market.devices || ['IPHONE'] } };
  // excluded = uygulamayi indirmemis kullanicilar, yani yeni kullanicilar.
  if (market.newUsersOnly !== false) targetingDimensions.appDownloaders = { excluded: [String(adamId)] };
  const adState = { creativeId: null };

  for (const c of campaigns) {
    let campaign = await findCampaignByName(client, c.name);
    if (campaign) {
      console.log(`- Kampanya var, atlandi: ${c.name} (id ${campaign.id})`);
      if (schedule && scheduleDiffers(campaign, schedule)) {
        console.log(`  UYARI: mevcut takvim ${campaign.startTime || '-'} .. ${campaign.endTime || '-'}, istenen ${scheduleLabel(schedule)}. --apply mevcut kampanyayi guncellemez; takvim icin --update-schedule --market ${market.label.toLowerCase()}.`);
      }
    } else {
      const campaignBody = buildCampaignBody({ orgId: client.config.orgId, adamId, campaign: c, schedule });
      const res = await client.request('POST', '/campaigns', { body: campaignBody });
      campaign = res.data;
      const when = schedule ? `, takvim ${scheduleLabel(schedule)}` : '';
      console.log(`- Kampanya olusturuldu: ${c.name} (id ${campaign.id}, butce ${c.dailyBudget} ${CURRENCY}, durum PAUSED${when})`);
    }

    const existingNegatives = await listAll(client, `/campaigns/${campaign.id}/negativekeywords`);
    const negativeSet = new Set(existingNegatives.filter((n) => !n.deleted).map((n) => `${n.text.toLowerCase()}|${n.matchType}`));
    const newNegatives = c.negatives.filter((n) => !negativeSet.has(`${n.text.toLowerCase()}|${n.matchType}`));
    if (newNegatives.length === 0) {
      console.log(`  Negatif: ${c.negatives.length} satirin tamami zaten var, atlandi.`);
    } else {
      const created = await client.bulk(`/campaigns/${campaign.id}/negativekeywords/bulk`, newNegatives.map((n) => ({
        text: n.text,
        matchType: n.matchType,
        status: 'ACTIVE',
      })));
      console.log(`  Negatif: ${created.length} eklendi, ${c.negatives.length - newNegatives.length} zaten vardi.`);
    }

    for (const g of c.adGroups.values()) {
      let adGroup = await findAdGroupByName(client, campaign.id, g.name);
      if (adGroup) {
        console.log(`  - Ad group var, atlandi: ${g.name} (id ${adGroup.id})`);
      } else {
        const res = await client.request('POST', `/campaigns/${campaign.id}/adgroups`, {
          body: {
            orgId: client.config.orgId,
            campaignId: campaign.id,
            name: g.name,
            startTime,
            pricingModel: 'CPC',
            defaultBidAmount: money(g.defaultBid),
            automatedKeywordsOptIn: g.searchMatch,
            status: 'ENABLED',
            targetingDimensions,
          },
        });
        adGroup = res.data;
        console.log(`  - Ad group olusturuldu: ${g.name} (id ${adGroup.id}, teklif ${g.defaultBid} ${CURRENCY}, Search Match ${g.searchMatch ? 'acik' : 'kapali'})`);
      }

      if (market.checkDefaultAd) await checkDefaultAd(client, campaign.id, adGroup, adState, plan.createDefaultAd === true);

      if (g.keywords.length === 0) {
        console.log(`    Keyword: yok (${g.name} kelimesiz calisir).`);
        continue;
      }
      const existingKeywords = await listAll(client, `/campaigns/${campaign.id}/adgroups/${adGroup.id}/targetingkeywords`);
      const keywordSet = new Set(existingKeywords.filter((k) => !k.deleted).map((k) => `${k.text.toLowerCase()}|${k.matchType}`));
      const newKeywords = g.keywords.filter((k) => !keywordSet.has(`${k.text.toLowerCase()}|${k.matchType}`));
      if (newKeywords.length === 0) {
        console.log(`    Keyword: ${g.keywords.length} satirin tamami zaten var, atlandi.`);
        continue;
      }
      const created = await client.bulk(`/campaigns/${campaign.id}/adgroups/${adGroup.id}/targetingkeywords/bulk`, newKeywords.map((k) => ({
        text: k.text,
        matchType: k.matchType,
        bidAmount: money(k.bid),
        status: 'ACTIVE',
      })));
      console.log(`    Keyword: ${created.length} eklendi, ${g.keywords.length - newKeywords.length} zaten vardi.`);
    }
  }
}

function apiTimeMs(value) {
  const s = String(value);
  return Date.parse(s.endsWith('Z') ? s : `${s}Z`);
}

function minuteOf(value) {
  return String(value || '').slice(0, 16);
}

// Apple belgesinde CampaignUpdate startTime ve endTime listelemez (Campaign nesnesi ikisini updatable der) ve
// endTime'i silmenin yolunu tarif etmez. Canli API'de endTime: null bitisi siler ve gelecekteki startTime one
// cekilebilir (2026-10-06, GET ile dogrulandi). Belgesiz oldugu icin sonuc her calismada GET ile yeniden dogrulanir.
function buildScheduleUpdateBody(schedule, { withStart }) {
  const campaign = {};
  if (withStart) campaign.startTime = schedule.startTime;
  campaign.endTime = schedule.endTime;
  return { campaign, clearGeoTargetingOnCountryOrRegionChange: false };
}

// AdGroupUpdate zarf istemez (Apple belgesi: kismi guncelleme, yalniz startTime yeter).
function buildAdGroupStartBody(schedule) {
  return { startTime: schedule.startTime };
}

function printScheduleUpdatePlan(name, schedule, explicitStart) {
  console.log('');
  console.log(`Kampanya ${name}: PUT /api/v5/campaigns/<campaignId> (id kampanya adindan bulunur)`);
  console.log(`  Takvim: ${scheduleLabel(schedule)}`);
  console.log(`  Govde: ${JSON.stringify(buildScheduleUpdateBody(schedule, { withStart: true }))}`);
  console.log(`  Apple baslangic degisikligini reddederse yedek govde: ${JSON.stringify(buildScheduleUpdateBody(schedule, { withStart: false }))}`);
  if (!explicitStart) console.log('  --start verilmedigi icin baslangic yalniz mevcut baslangic bu zamandan sonraysa gonderilir.');
  console.log('  Kampanya takvimi zaten istenen gibiyse kampanya icin PUT gonderilmez. Durum (status) govdede yok, degismez.');
  console.log(`  Ad group: baslangici ${schedule.startTime} UTC'den sonra olan her ad group icin (canlida listeden bulunur):`);
  console.log(`    PUT /api/v5/campaigns/<campaignId>/adgroups/<adGroupId> govde: ${JSON.stringify(buildAdGroupStartBody(schedule))}`);
  console.log('    Bu zamandan once baslayan ad group\'lara dokunulmaz.');
}

// Ad group baslangici kampanyanin yeni baslangicindan sonraysa o ad group kendi tarihine kadar yayina girmez (ON_HOLD),
// kampanya ENABLED olsa bile. Bu ad group'larin startTime'i kampanyanin baslangicina cekilir.
async function pullAdGroupStarts(client, campaign, schedule) {
  const endpoint = `/campaigns/${campaign.id}/adgroups`;
  const listActive = async () => (await listAll(client, endpoint)).filter((g) => !g.deleted);
  try {
    let adGroups = await listActive();
    const late = adGroups.filter((g) => g.startTime && apiTimeMs(g.startTime) > apiTimeMs(schedule.startTime));
    if (late.length === 0) console.log(`Ad group baslangici: ${schedule.startTime} UTC'den sonra baslayan ad group yok, PUT gonderilmedi.`);
    const pulled = [];
    for (const g of late) {
      const body = buildAdGroupStartBody(schedule);
      console.log(`PUT ${endpoint}/${g.id} (${g.name}, onceki baslangic ${g.startTime}) govde: ${JSON.stringify(body)}`);
      try {
        await client.request('PUT', `${endpoint}/${g.id}`, { body });
        pulled.push(g.id);
      } catch (err) {
        console.log(`HATA: ${g.name} baslangici cekilemedi: ${String(err.message).split('\n').join(' ').slice(0, 400)}`);
        process.exitCode = 1;
      }
    }
    if (pulled.length > 0) adGroups = await listActive();
    for (const g of adGroups) {
      console.log(`  Ad group ${pad(g.name, 12)} id ${g.id}, durum ${g.status}, servingStatus ${g.servingStatus}, displayStatus ${g.displayStatus}, baslangic ${g.startTime || '-'}`);
      if (pulled.includes(g.id) && minuteOf(g.startTime) !== minuteOf(schedule.startTime)) {
        console.log(`    HATA: baslangic degismedi (istenen ${schedule.startTime}, GET ${g.startTime || '-'}); Apple alani sessizce yok saymis olabilir.`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.log(`HATA: ad group baslangiclari islenemedi: ${String(err.message).split('\n')[0]}`);
    process.exitCode = 1;
  }
}

async function updateCampaignSchedule(client, name, schedule, explicitStart) {
  const found = await findCampaignByName(client, name);
  if (!found) throw new UserError(`Kampanya bulunamadi: ${name}. Once --apply ile olusturun.`);
  console.log('');
  console.log(`### ${name} (id ${found.id})`);
  console.log(`Onceki: baslangic ${found.startTime || '-'}, bitis ${found.endTime || 'yok'}, durum ${found.status}`);
  console.log(`Istenen: ${scheduleLabel(schedule)}`);

  // Baslamis kampanyanin baslangici ileri alinmasin: --start yokken "simdi" yalniz gelecekteki baslangici one ceker.
  const withStart = explicitStart || !found.startTime || apiTimeMs(found.startTime) > apiTimeMs(schedule.startTime);
  if (!withStart) console.log(`Baslangic gonderilmez: mevcut ${found.startTime} UTC, istenen ${schedule.startTime} UTC'den once.`);
  const needsEnd = minuteOf(found.endTime) !== minuteOf(schedule.endTime);

  let sentStart = withStart;
  let startRejection = null;
  if (!withStart && !needsEnd) {
    console.log('Kampanya takvimi zaten istenen gibi, kampanya icin PUT gonderilmez.');
  } else {
    const put = (withStartField) => {
      const body = buildScheduleUpdateBody(schedule, { withStart: withStartField });
      console.log(`PUT /campaigns/${found.id} govde: ${JSON.stringify(body)}`);
      return client.request('PUT', `/campaigns/${found.id}`, { body });
    };
    try {
      await put(withStart);
    } catch (err) {
      if (!withStart || !(err instanceof UserError) || !/start/i.test(err.message)) throw err;
      startRejection = String(err.message).split('\n').slice(1).join(' ').slice(0, 400);
      sentStart = false;
      console.log('Apple baslangic degisikligini reddetti, yalniz bitis ile yeniden denenir.');
      await put(false);
    }
  }

  const after = (await client.request('GET', `/campaigns/${found.id}`)).data;
  console.log(`Sonra (GET): baslangic ${after.startTime || '-'}, bitis ${after.endTime || 'yok'}, durum ${after.status}, servingStatus ${after.servingStatus}`);
  if (startRejection) {
    console.log(`UYARI: Apple baslangic degisikligini reddetti, yalniz bitis guncellendi; baslangic ${after.startTime || '-'} kaldi. Apple yaniti: ${startRejection}`);
  } else if (sentStart && minuteOf(after.startTime) !== minuteOf(schedule.startTime)) {
    console.log(`${explicitStart ? 'HATA' : 'UYARI'}: baslangic degismedi (istenen ${schedule.startTime}, GET ${after.startTime || '-'}); Apple alani sessizce yok saymis olabilir.`);
    if (explicitStart) process.exitCode = 1;
  }
  if (minuteOf(after.endTime) !== minuteOf(schedule.endTime)) {
    console.log(`HATA: bitis tarihi istenen gibi degil (istenen ${schedule.endTime || 'yok'}, GET ${after.endTime || 'yok'}); Apple null degerini yok saymis veya alani degistirmemis olabilir.`);
    process.exitCode = 1;
  }

  await pullAdGroupStarts(client, found, schedule);
  console.log(`Kampanya durumu ${after.status}; yayina almak icin: node scripts/apple-ads-status.mjs enabled ${name}`);
}

async function cmdUpdateSchedule(args) {
  const marketKeys = resolveMarkets(args.market);
  const unsupported = marketKeys.filter((k) => !MARKETS[k].acceptsSchedule);
  if (unsupported.length > 0) {
    throw new UserError(`--update-schedule yalniz takvimli pazar (us) icin gecerlidir, ${unsupported.join(', ')} takvimli degil. --market us verin.`);
  }
  const startArg = args.start == null ? null : parseStart(args.start);
  const endArg = args.end == null ? null : parseEnd(args.end);
  const explicitStart = startArg != null;
  const live = args.dryRun !== true;
  const client = live ? new AdsClient(loadConfig({ requireOrgId: true })) : null;
  if (live) {
    console.log(`MOD: update-schedule (canli). orgId ${client.config.orgId}. Govdelerde yalniz takvim alanlari var, kampanya ve ad group durumu (status) degismez.`);
  } else {
    console.log('MOD: update-schedule, dry-run. Ag cagrisi yapilmaz, hicbir sey degismez.');
  }
  for (const key of marketKeys) {
    const market = MARKETS[key];
    // --start yoksa baslangic "simdi" (+15 dk) olur; --end yoksa bitis temizlenir.
    const schedule = resolveSchedule(market, startArg ?? 'now', endArg);
    for (const name of Object.keys(market.budgets)) {
      if (live) await updateCampaignSchedule(client, name, schedule, explicitStart);
      else printScheduleUpdatePlan(name, schedule, explicitStart);
    }
  }
  if (!live) {
    console.log('');
    console.log('Canli gonderim icin --dry-run olmadan calistirin: node scripts/apple-ads-setup.mjs --update-schedule --market us');
  }
}

function scaleBid(bid, factor) {
  return (Math.round(Number(bid) * factor * 100) / 100).toFixed(2);
}

// Teklifler CSV'deki degerin carpimidir (kaynak dosya henuz eski degerdeyken calistirilir, sonra CSV yeni degerlere
// guncellenir). Canlida hedef zaten esitse PUT gonderilmez, bu yuzden yeniden calistirmak guvenlidir.
async function cmdUpdateBids(args) {
  const marketKeys = resolveMarkets(args.market);
  const unsupported = marketKeys.filter((k) => !MARKETS[k].acceptsSchedule);
  if (unsupported.length > 0 || marketKeys.length !== 1) {
    throw new UserError('--update-bids yalniz --market us ile kullanilir.');
  }
  const factor = Number(args.factor);
  if (!(factor > 0) || factor > 5) throw new UserError(`--factor gecersiz: "${args.factor}". Ornek: --factor 1.33`);
  const plan = buildPlan(marketKeys[0]);
  const live = args.dryRun !== true;
  const client = live ? new AdsClient(loadConfig({ requireOrgId: true })) : null;
  console.log(live
    ? `MOD: update-bids (canli). Carpan ${factor}. Govdelerde yalniz teklif alanlari var, durum (status) degismez.`
    : `MOD: update-bids, dry-run. Carpan ${factor}. Ag cagrisi yapilmaz.`);

  let sent = 0;
  for (const c of plan.campaigns) {
    const campaign = live ? await findCampaignByName(client, c.name) : null;
    if (live && !campaign) throw new UserError(`Kampanya bulunamadi: ${c.name}`);
    console.log('');
    console.log(`### ${c.name}${campaign ? ` (id ${campaign.id})` : ''}`);
    for (const g of c.adGroups.values()) {
      const newDefault = scaleBid(g.defaultBid, factor);
      const groupBody = { defaultBidAmount: money(newDefault) };
      const kwTargets = g.keywords.map((k) => ({ text: k.text, matchType: k.matchType, from: k.bid, to: scaleBid(k.bid, factor) }));
      console.log(`- Ad group ${g.name}: varsayilan teklif ${g.defaultBid} -> ${newDefault} ${CURRENCY}, ${kwTargets.length} keyword`);
      console.log(`  PUT /campaigns/<c>/adgroups/<a> govde: ${JSON.stringify(groupBody)}`);
      if (kwTargets.length > 0) {
        console.log(`  PUT /campaigns/<c>/adgroups/<a>/targetingkeywords/bulk govde ornegi: ${JSON.stringify({ id: '<id>', text: kwTargets[0].text, matchType: kwTargets[0].matchType, bidAmount: money(kwTargets[0].to) })}`);
        for (const k of kwTargets) console.log(`    ${pad(k.text, 26)}${k.matchType} ${k.from} -> ${k.to}`);
      }
      if (!live) continue;

      const adGroup = await findAdGroupByName(client, campaign.id, g.name);
      if (!adGroup) throw new UserError(`Ad group bulunamadi: ${g.name}`);
      const base = `/campaigns/${campaign.id}/adgroups/${adGroup.id}`;
      const haveDefault = adGroup.defaultBidAmount && adGroup.defaultBidAmount.amount;
      if (haveDefault && Number(haveDefault) === Number(newDefault)) {
        console.log(`  Varsayilan teklif zaten ${newDefault}, PUT gonderilmedi.`);
      } else {
        await client.request('PUT', base, { body: groupBody });
        sent += 1;
        console.log(`  PUT ${base} tamam.`);
      }

      if (kwTargets.length > 0) {
        const existing = (await listAll(client, `${base}/targetingkeywords`)).filter((k) => !k.deleted);
        const updates = [];
        for (const t of kwTargets) {
          const hit = existing.find((k) => k.text.toLowerCase() === t.text.toLowerCase() && k.matchType === t.matchType);
          if (!hit) { console.log(`  UYARI: keyword canlida yok: ${t.text} (${t.matchType})`); process.exitCode = 1; continue; }
          if (hit.bidAmount && Number(hit.bidAmount.amount) === Number(t.to)) continue;
          updates.push({ id: hit.id, text: hit.text, matchType: hit.matchType, bidAmount: money(t.to) });
        }
        if (updates.length === 0) {
          console.log('  Keyword teklifleri zaten hedefte, PUT gonderilmedi.');
        } else {
          await client.waitForBulkSlot();
          const res = await client.request('PUT', `${base}/targetingkeywords/bulk`, { body: updates, tolerateBodyErrors: true });
          const failed = (res.error && res.error.errors) || [];
          if (failed.length > 0) { console.log(`  HATA: ${failed.length} keyword reddedildi: ${JSON.stringify(failed).slice(0, 500)}`); process.exitCode = 1; }
          sent += updates.length;
          console.log(`  PUT ${base}/targetingkeywords/bulk: ${updates.length} keyword gonderildi.`);
        }
      }
    }
  }
  if (!live) {
    console.log('');
    console.log('Canli gonderim icin --dry-run olmadan: node scripts/apple-ads-setup.mjs --update-bids --market us --factor 1.33');
    return;
  }

  console.log('');
  console.log(`Gonderilen degisiklik: ${sent}. GET dogrulamasi:`);
  for (const c of plan.campaigns) {
    const campaign = await findCampaignByName(client, c.name);
    const adGroups = (await listAll(client, `/campaigns/${campaign.id}/adgroups`)).filter((g) => !g.deleted);
    for (const g of adGroups) {
      const planned = c.adGroups.get(g.name);
      const want = planned ? scaleBid(planned.defaultBid, factor) : null;
      const have = g.defaultBidAmount && g.defaultBidAmount.amount;
      const ok = want != null && Number(have) === Number(want);
      console.log(`  Ad group ${pad(g.name, 12)} id ${g.id}, teklif ${have} ${CURRENCY} (istenen ${want}) ${ok ? 'TAMAM' : 'FARKLI'}, durum ${g.status}, servingStatus ${g.servingStatus}, servingStateReasons ${JSON.stringify(g.servingStateReasons ?? null)}`);
      if (!ok) process.exitCode = 1;
      if (planned && planned.keywords.length > 0) {
        const kws = (await listAll(client, `/campaigns/${campaign.id}/adgroups/${g.id}/targetingkeywords`)).filter((k) => !k.deleted);
        for (const k of kws) {
          const pk = planned.keywords.find((p) => p.text.toLowerCase() === k.text.toLowerCase() && p.matchType === k.matchType);
          const kwant = pk ? scaleBid(pk.bid, factor) : null;
          const kok = kwant != null && Number(k.bidAmount && k.bidAmount.amount) === Number(kwant);
          console.log(`    ${pad(k.text, 26)}${pad(k.matchType, 7)}${pad(k.bidAmount && k.bidAmount.amount, 6)} ${k.status} ${kok ? 'TAMAM' : `FARKLI (istenen ${kwant})`}`);
          if (!kok) process.exitCode = 1;
        }
      }
    }
  }
}

async function cmdWhoami() {
  const config = loadConfig({ requireOrgId: false });
  const client = new AdsClient(config);
  const acls = await client.request('GET', '/acls', { withOrg: false });
  console.log('Erisilebilir organizasyonlar (/acls):');
  for (const org of acls.data || []) {
    console.log(`- orgId ${org.orgId} | ${org.orgName || org.displayName} | para birimi ${org.currency} | odeme ${org.paymentModel} | rol ${(org.roleNames || []).join(', ')}`);
  }
  if (config.orgId) {
    const me = await client.request('GET', '/me');
    console.log('');
    console.log(`Kullanici (/me): ${JSON.stringify(me.data)}`);
  } else {
    console.log('');
    console.log('config.json icinde orgId yok, /me atlandi. Yukaridaki orgId degerlerinden birini yazin.');
  }
}

async function cmdFindApp(query) {
  if (!query || query.length < 3) throw new UserError('--find-app en az 3 karakterlik bir arama metni ister.');
  const client = new AdsClient(loadConfig());
  const res = await client.request('GET', '/search/apps', { query: { query, returnOwnedApps: true, limit: 50 } });
  const apps = res.data || [];
  if (apps.length === 0) {
    console.log('Sonuc yok. returnOwnedApps=true ile arama yapildi, uygulama adinin ilk harfleriyle deneyin.');
    return;
  }
  console.log(`${pad('adamId', 14)}${pad('Uygulama', 40)}Gelistirici`);
  console.log('-'.repeat(86));
  for (const app of apps) {
    console.log(pad(app.adamId, 14) + pad(app.appName, 40) + (app.developerName || ''));
  }
  console.log('');
  console.log('Dogru satirdaki adamId degerini config.json icine yazin.');
}

async function cmdExportSearchTerms(campaignName, days) {
  if (!campaignName) throw new UserError('--export-search-terms icin --campaign <ad> gerekir.');
  const client = new AdsClient(loadConfig());
  const campaign = await findCampaignByName(client, campaignName);
  if (!campaign) throw new UserError(`Kampanya bulunamadi: ${campaignName}`);
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const res = await client.request('POST', `/reports/campaigns/${campaign.id}/searchterms`, {
    body: {
      startTime: iso(start),
      endTime: iso(end),
      timeZone: 'ORTZ',
      selector: {
        orderBy: [{ field: 'impressions', sortOrder: 'DESCENDING' }],
        pagination: { offset: 0, limit: 1000 },
      },
      returnRecordsWithNoMetrics: false,
      returnRowTotals: false,
      returnGrandTotals: false,
    },
  });
  const rows = ((res.data || {}).reportingDataResponse || {}).row || [];
  console.log('search term,match type,impressions,taps,installs,spend,avg cpt');
  for (const row of rows) {
    const meta = row.metadata || {};
    const total = row.total || {};
    const cells = [
      meta.searchTermText || '',
      meta.searchTermSource || '',
      total.impressions ?? 0,
      total.taps ?? 0,
      total.totalInstalls ?? total.installs ?? 0,
      (total.localSpend && total.localSpend.amount) || '0',
      (total.avgCPT && total.avgCPT.amount) || '0',
    ];
    console.log(cells.map((c) => (String(c).includes(',') ? `"${c}"` : String(c))).join(','));
  }
  console.log('');
  console.log(`${rows.length} satir, ${iso(start)} .. ${iso(end)}, kampanya ${campaignName} (id ${campaign.id}).`);
}

function cmdSelftestJwt(keyPath) {
  const resolved = expandHome(keyPath);
  if (!resolved || !existsSync(resolved)) throw new UserError('--selftest-jwt <ozel-anahtar.pem> yolu gerekir.');
  const privateKeyPem = readFileSync(resolved, 'utf8');
  const token = createClientSecret({
    clientId: 'SEARCHADS.00000000-1111-2222-3333-444444444444',
    teamId: 'SEARCHADS.55555555-6666-7777-8888-999999999999',
    keyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    privateKeyPem,
  });
  const decoded = decodeJwt(token);
  const publicKey = crypto.createPublicKey({ key: privateKeyPem });
  const ok = crypto.verify('sha256', Buffer.from(decoded.signingInput), { key: publicKey, dsaEncoding: 'ieee-p1363' }, decoded.signature);
  console.log('JWT uzunlugu:', token.length);
  console.log('Header:', JSON.stringify(decoded.header));
  console.log('Payload:', JSON.stringify(decoded.payload));
  console.log('Imza uzunlugu (bayt):', decoded.signatureBytes, '(ES256 icin 64 olmali)');
  console.log('exp - iat (gun):', (decoded.payload.exp - decoded.payload.iat) / 86400);
  console.log('Imza dogrulandi:', ok);
  const checks = [
    ['alg ES256', decoded.header.alg === 'ES256'],
    ['kid dolu', typeof decoded.header.kid === 'string' && decoded.header.kid.length > 0],
    ['sub = clientId', decoded.payload.sub.startsWith('SEARCHADS.0')],
    ['iss = teamId', decoded.payload.iss.startsWith('SEARCHADS.5')],
    ['aud dogru', decoded.payload.aud === JWT_AUDIENCE],
    ['exp <= 180 gun', decoded.payload.exp - decoded.payload.iat <= 86400 * 180],
    ['imza 64 bayt', decoded.signatureBytes === 64],
    ['imza gecerli', ok === true],
  ];
  let allOk = true;
  for (const [label, pass] of checks) {
    if (!pass) allOk = false;
    console.log(`${pass ? 'GECTI' : 'KALDI'}  ${label}`);
  }
  if (!allOk) throw new UserError('JWT ozdenetimi basarisiz.');
}

function parseArgs(argv) {
  const args = { mode: 'dry-run', dryRun: false, updateSchedule: false, updateBids: false, factor: null, market: 'all', campaign: null, findApp: null, selftestJwt: null, days: 30, start: null, end: null, createDefaultAd: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') { args.mode = 'dry-run'; args.dryRun = true; }
    else if (a === '--apply') args.mode = 'apply';
    else if (a === '--update-schedule') args.updateSchedule = true;
    else if (a === '--update-bids') args.updateBids = true;
    else if (a === '--factor') args.factor = argv[++i] ?? '';
    else if (a === '--whoami') args.mode = 'whoami';
    else if (a === '--export-search-terms') args.mode = 'search-terms';
    else if (a === '--find-app') { args.mode = 'find-app'; args.findApp = argv[++i]; }
    else if (a === '--selftest-jwt') { args.mode = 'selftest-jwt'; args.selftestJwt = argv[++i]; }
    else if (a === '--market') args.market = String(argv[++i] || '').toLowerCase();
    else if (a === '--campaign') args.campaign = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
    // Degersiz --start/--end "verilmedi" sayilmasin; bos metin dogrulayiciya gider ve hata verir.
    else if (a === '--start') args.start = argv[++i] ?? '';
    else if (a === '--end') args.end = argv[++i] ?? '';
    else if (a === '--create-default-ad') args.createDefaultAd = true;
    else if (a === '--help' || a === '-h') args.mode = 'help';
    else throw new UserError(`Bilinmeyen secenek: ${a}. Kullanim icin --help.`);
  }
  return args;
}

function printHelp() {
  console.log([
    'zerospike Apple Ads kurulum scripti',
    '',
    'Kullanim: node scripts/apple-ads-setup.mjs [komut] [secenek]',
    '',
    'Komutlar:',
    '  --dry-run              CSV planini dogrular ve tabloyu basar, aga cikmaz (varsayilan)',
    '  --apply                Kampanya, ad group, keyword ve negatifleri olusturur (idempotent)',
    '  --update-schedule      Mevcut kampanyanin startTime/endTime alanlarini PUT ile gunceller; kampanyadan sonra baslayan',
    '                         ad group baslangiclarini da kampanyanin baslangicina ceker (canli; --dry-run govdeleri basar).',
    '                         --start/--end verilmezse bitis tarihi temizlenir ve baslangic simdiye (+15 dk) cekilir.',
    '  --update-bids          Mevcut US kampanyasinda CSV tekliflerini --factor ile carpip 2 ondalik yuvarlar; ad group',
    '                         defaultBidAmount ve keyword bidAmount PUT eder, GET ile dogrular (--market us --factor 1.33).',
    '  --whoami               /acls ve /me cagirir, orgId listesini basar',
    '  --find-app <metin>     adamId arar',
    '  --export-search-terms  --campaign <ad> ile Search Terms raporunu CSV basar',
    '  --selftest-jwt <pem>   Verilen ozel anahtarla client secret uretip dogrular',
    '',
    'Secenekler:',
    '  --market de|fr|us|all  Varsayilan all',
    '  --start <YYYY-MM-DD|now>  Takvimli pazar (us) icin baslangic (UTC 00:00), now = su an + 15 dk. Verilmezse kampanya',
    '                         govdesine hicbir tarih yazilmaz (olusturuldugu anda baslar, bitis tarihi yok).',
    '  --end <YYYY-MM-DD>     Takvimli pazar (us) icin bitis (UTC 00:00); yalniz --start ile birlikte verilir. Verilmezse bitis tarihi yok.',
    '  --create-default-ad    Ad group listesinde ad yoksa Default Ad olusturmayi dener (varsayilan: yalniz kontrol)',
    '  --campaign <ad>        Rapor icin kampanya adi',
    '  --days <sayi>          Rapor penceresi, varsayilan 30',
    '',
    `Yapilandirma: ${CONFIG_PATH}`,
  ].join('\n'));
}

function resolveMarkets(value) {
  if (value === 'all') return Object.keys(MARKETS);
  if (value in MARKETS) return [value];
  throw new UserError(`Gecersiz pazar: ${value}. Beklenen: de, fr, us veya all.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'help') { printHelp(); return; }
  if (args.updateBids) {
    if (args.mode !== 'dry-run' && args.mode !== 'apply') {
      throw new UserError('--update-bids diger komutlarla birlestirilemez; yalniz --market us, --factor ve --dry-run ile kullanilir.');
    }
    await cmdUpdateBids(args);
    return;
  }
  if (args.updateSchedule) {
    if (args.mode !== 'dry-run' && args.mode !== 'apply') {
      throw new UserError('--update-schedule diger komutlarla birlestirilemez; yalniz --market, --start, --end ve --dry-run ile kullanilir.');
    }
    await cmdUpdateSchedule(args);
    return;
  }
  if (args.mode === 'selftest-jwt') { cmdSelftestJwt(args.selftestJwt); return; }
  if (args.mode === 'whoami') { await cmdWhoami(); return; }
  if (args.mode === 'find-app') { await cmdFindApp(args.findApp); return; }
  if (args.mode === 'search-terms') { await cmdExportSearchTerms(args.campaign, args.days); return; }

  const marketKeys = resolveMarkets(args.market);
  const plans = marketKeys.map((k) => buildPlan(k));
  const startArg = args.start == null ? null : parseStart(args.start);
  const endArg = args.end == null ? null : parseEnd(args.end);
  if (endArg != null && startArg == null) {
    throw new UserError('--end tek basina verilemez, --start de gerekir. Ornek: --start 2026-10-14 --end 2026-10-28 (--start now da olur).');
  }
  for (const plan of plans) {
    plan.startArg = startArg;
    plan.endArg = endArg;
    plan.createDefaultAd = args.createDefaultAd;
    plan.schedule = resolveSchedule(plan.market, startArg, endArg);
    if ((startArg != null || endArg != null) && !plan.market.acceptsSchedule) {
      plan.warnings.push(`--start ve --end yalniz takvimli pazar (us) icin gecerlidir, ${plan.market.label} icin yok sayildi.`);
    }
  }

  if (args.mode === 'dry-run') {
    console.log('MOD: dry-run. Ag cagrisi yapilmaz, hicbir sey olusturulmaz.');
    for (const plan of plans) printPlan(plan, { showBodies: true });
    console.log('');
    console.log('Gercekten olusturmak icin: node scripts/apple-ads-setup.mjs --apply --market <de|fr|us|all>');
    if (plans.some((p) => p.schedule)) {
      console.log('US icin istege bagli takvim: node scripts/apple-ads-setup.mjs --apply --market us [--start YYYY-MM-DD [--end YYYY-MM-DD]]');
    }
    return;
  }

  const config = loadConfig({ requireOrgId: true, requireAdamId: true });
  const client = new AdsClient(config);
  console.log(`MOD: apply. orgId ${config.orgId}, adamId ${config.adamId}. Kampanyalar PAUSED olusturulur, konsoldan siz acarsiniz.`);
  for (const plan of plans) {
    printPlan(plan);
    await applyMarket(client, plan);
  }
  console.log('');
  console.log('Bitti. ads.apple.com uzerinden kampanyalari gozden gecirip ENABLED yapin.');
}

// Modul disaridan import edildiginde main calismasin, yalniz dogrudan calistirmada.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main().catch((err) => {
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
