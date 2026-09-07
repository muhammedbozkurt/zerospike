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

  const sharedNegatives = loadNegatives(market.sharedNegativesCsv);
  const discoveryNegatives = loadNegatives(market.discoveryNegativesCsv);

  for (const campaign of campaigns.values()) {
    if (campaign.isDiscovery) {
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
    discoveryNegatives: discoveryNegatives.length,
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

  const missingInDiscovery = sharedNegatives.filter(
    (n) => !discoveryNegatives.some((d) => d.text.toLowerCase() === n.text.toLowerCase() && d.matchType === n.matchType),
  );
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

function printPlan(plan) {
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

  console.log('');
  console.log(`CSV ozeti ${market.label}: ${counts.campaigns} kampanya / ${counts.csvAdGroups} ad group / ${counts.keywords} keyword / ${counts.sharedNegatives} + ${counts.discoveryNegatives} negatif`);
  console.log(`Olusturulacak ad group: ${counts.csvAdGroups} (CSV) + 1 (${SEARCH_MATCH_AD_GROUP}, kelimesiz) = ${counts.totalAdGroups}`);
  console.log(`Yazilacak negatif satiri: ${counts.negativeRows} (paylasilan liste ${counts.sharedNegatives} x 3 kampanya + Discovery listesi ${counts.discoveryNegatives}).`);
  console.log(`Discovery listesi paylasilan listeyi zaten kapsadigi icin Discovery kampanyasina yalniz ${market.discoveryNegativesCsv} yazilir.`);
  console.log('Ortak ayarlar: yerlesim APPSTORE_SEARCH_RESULTS, cihaz IPHONE, hedef kitle uygulamayi indirmemis kullanicilar, kampanya durumu PAUSED.');

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

async function applyMarket(client, plan) {
  const { market, campaigns } = plan;
  const adamId = Number(client.config.adamId);
  console.log('');
  console.log(`### ${market.label} uygulaniyor`);
  const startTime = new Date(Date.now() + AD_GROUP_START_OFFSET_MS).toISOString().replace('Z', '');

  for (const c of campaigns) {
    let campaign = await findCampaignByName(client, c.name);
    if (campaign) {
      console.log(`- Kampanya var, atlandi: ${c.name} (id ${campaign.id})`);
    } else {
      const res = await client.request('POST', '/campaigns', {
        body: {
          orgId: client.config.orgId,
          name: c.name,
          adamId,
          countriesOrRegions: [c.country],
          adChannelType: 'SEARCH',
          supplySources: ['APPSTORE_SEARCH_RESULTS'],
          billingEvent: 'TAPS',
          dailyBudgetAmount: money(c.dailyBudget),
          status: 'PAUSED',
        },
      });
      campaign = res.data;
      console.log(`- Kampanya olusturuldu: ${c.name} (id ${campaign.id}, butce ${c.dailyBudget} ${CURRENCY}, durum PAUSED)`);
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
            targetingDimensions: {
              deviceClass: { included: ['IPHONE'] },
              // excluded = uygulamayi indirmemis kullanicilar, yani yeni kullanicilar.
              appDownloaders: { excluded: [String(adamId)] },
            },
          },
        });
        adGroup = res.data;
        console.log(`  - Ad group olusturuldu: ${g.name} (id ${adGroup.id}, teklif ${g.defaultBid} ${CURRENCY}, Search Match ${g.searchMatch ? 'acik' : 'kapali'})`);
      }

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
  const args = { mode: 'dry-run', market: 'all', campaign: null, findApp: null, selftestJwt: null, days: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.mode = 'dry-run';
    else if (a === '--apply') args.mode = 'apply';
    else if (a === '--whoami') args.mode = 'whoami';
    else if (a === '--export-search-terms') args.mode = 'search-terms';
    else if (a === '--find-app') { args.mode = 'find-app'; args.findApp = argv[++i]; }
    else if (a === '--selftest-jwt') { args.mode = 'selftest-jwt'; args.selftestJwt = argv[++i]; }
    else if (a === '--market') args.market = String(argv[++i] || '').toLowerCase();
    else if (a === '--campaign') args.campaign = argv[++i];
    else if (a === '--days') args.days = Number(argv[++i]);
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
    '  --whoami               /acls ve /me cagirir, orgId listesini basar',
    '  --find-app <metin>     adamId arar',
    '  --export-search-terms  --campaign <ad> ile Search Terms raporunu CSV basar',
    '  --selftest-jwt <pem>   Verilen ozel anahtarla client secret uretip dogrular',
    '',
    'Secenekler:',
    '  --market de|fr|all     Varsayilan all',
    '  --campaign <ad>        Rapor icin kampanya adi',
    '  --days <sayi>          Rapor penceresi, varsayilan 30',
    '',
    `Yapilandirma: ${CONFIG_PATH}`,
  ].join('\n'));
}

function resolveMarkets(value) {
  if (value === 'all') return Object.keys(MARKETS);
  if (value in MARKETS) return [value];
  throw new UserError(`Gecersiz pazar: ${value}. Beklenen: de, fr veya all.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'help') { printHelp(); return; }
  if (args.mode === 'selftest-jwt') { cmdSelftestJwt(args.selftestJwt); return; }
  if (args.mode === 'whoami') { await cmdWhoami(); return; }
  if (args.mode === 'find-app') { await cmdFindApp(args.findApp); return; }
  if (args.mode === 'search-terms') { await cmdExportSearchTerms(args.campaign, args.days); return; }

  const marketKeys = resolveMarkets(args.market);
  const plans = marketKeys.map((k) => buildPlan(k));

  if (args.mode === 'dry-run') {
    console.log('MOD: dry-run. Ag cagrisi yapilmaz, hicbir sey olusturulmaz.');
    for (const plan of plans) printPlan(plan);
    console.log('');
    console.log('Gercekten olusturmak icin: node scripts/apple-ads-setup.mjs --apply --market <de|fr|all>');
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
