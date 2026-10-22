import fs from 'node:fs';
import path from 'node:path';

// Tirnak duyarli CSV satiri: "1,234" tek sutun kalir, "" tirnak icinde tek tirnaktir.
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Play Console > Istatistikler > Yuklemeler disa aktarimi (CSV, genelde UTF-16). Play icin API yolu yok: dosya elle indirilir.
// Tarih sutunu ve "Daily User Installs" / "Install events" / "Gunluk kullanici yuklemeleri" sutunu aranir; haftalik toplam alinir.
// Aralikta 7 farkli gun yoksa toplam "haftalik" diye yazilmaz, kaynak erisilemeyen listesine duser.
export function playSourceFromText(text, start, end) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const head = splitCsvLine(lines[0] || '').map((c) => c.toLowerCase());
  const di = head.findIndex((c) => c === 'date' || c === 'tarih');
  const ii = head.findIndex((c) => /daily user installs|install events|gunluk kullanici|günlük kullan/.test(c));
  if (di < 0 || ii < 0) return { rows: [], unavailable: ['Play CSV sutunlari taninmadi (Date + Daily User Installs bekleniyor)'], installs: null };
  let total = 0;
  const days = new Set();
  for (const l of lines.slice(1)) {
    const c = splitCsvLine(l);
    const d = (c[di] || '').slice(0, 10);
    if (d < start || d > end) continue;
    const n = Number((c[ii] || '').replace(/[\s.,]/g, ''));
    if (Number.isFinite(n) && (c[ii] || '').trim() !== '' && !days.has(d)) { total += n; days.add(d); }
  }
  if (!days.size) return { rows: [], unavailable: [`Play CSV'de ${start}..${end} araligi yok`], installs: null };
  if (days.size !== 7) return { rows: [], unavailable: [`Play CSV'de ${start}..${end} icin ${days.size} gun var (7 bekleniyor), haftalik toplam yazilmadi`], installs: null };
  return { rows: [{ key: 'play.installs', label: 'Play yeni kurulum (CSV)', val: total, scope: 'store' }], unavailable: [], installs: total };
}

export function playSource(file, start, end) {
  const missing = 'kaynak yok: Play Console CSV (Istatistikler > Yuklemeler > disa aktar), sonra --play-csv <dosya>';
  if (!file) return { rows: [], unavailable: [missing], installs: null };
  let text;
  try {
    const buf = fs.readFileSync(file);
    text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  } catch {
    return { rows: [], unavailable: [`Play CSV okunamadi (${path.basename(file)}); ${missing}`], installs: null };
  }
  return playSourceFromText(text, start, end);
}
