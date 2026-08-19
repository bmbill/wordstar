// Scrape Longman (LDOCE) entries for the word list in word-star.html.
//
// Writes one JSON per word into tools/.ldoce-cache/ and, for words that have an
// American pronunciation, the mp3 into audio/words/<word>.mp3. Both are skipped
// when already present, so the run is resumable — just start it again.
//
//   node tools/ldoce-fetch.mjs              # everything still missing
//   node tools/ldoce-fetch.mjs --limit 20   # first 20 missing (smoke test)
//   node tools/ldoce-fetch.mjs --words loud,hear
//
// Paced at 3 workers x 500ms so we stay a polite guest on their servers.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools', '.ldoce-cache');
const AUDIO = path.join(ROOT, 'audio', 'words');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WORKERS = 3;
const PACE_MS = 500;

const argv = process.argv.slice(2);
const argOf = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(AUDIO, { recursive: true });

// ---------- word list ----------

export function readWordList() {
  const html = fs.readFileSync(path.join(ROOT, 'word-star.html'), 'utf8');
  const m = html.match(/const RAW=\[([\s\S]*?)\n\];/);
  if (!m) throw new Error('could not find the RAW word array in word-star.html');
  const rows = JSON.parse('[' + m[1] + ']');
  return [...new Set(rows.map(r => r[0]))].filter(w => /^[a-z][a-z-]*$/.test(w));
}

// LDOCE is a British dictionary: American spellings hit a "Did you mean:" page and
// yield nothing. Each pair below is the SAME word spelled differently, so the British
// page's *American* recording is the right audio — Longman even names those files after
// the American spelling (neighbour's US file is laadneighbor.mp3).
//
// Deliberately excluded, because they would play a different word: headphone/headphones,
// soybean/soya bean, ladybug/ladybird, toward/towards, aluminum/aluminium. Also makeup
// and pickup — /dictionary/make-up is the phrasal verb "make up", whose examples are the
// wrong sense ("Women make up a small proportion of...") and whose stress differs from
// the noun. Those two fall back to TTS.
export const VARIANT_SLUG = {
  theater: 'theatre', centimeter: 'centimetre', kilometer: 'kilometre',
  neighbor: 'neighbour', neighborhood: 'neighbourhood', colorful: 'colourful',
  flavor: 'flavour', humor: 'humour', harbor: 'harbour', rumor: 'rumour',
  behavior: 'behaviour', endeavor: 'endeavour', splendor: 'splendour', tumor: 'tumour',
  counselor: 'counsellor', traveler: 'traveller', marvelous: 'marvellous',
  jewelry: 'jewellery', fulfill: 'fulfil', enroll: 'enrol', whiskey: 'whisky',
  nonprofit: 'non-profit', restroom: 'rest-room', hometown: 'home-town',
  shortsighted: 'short-sighted',
};

// ---------- html extraction ----------

const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–' };

function decode(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// <span class="EXAMPLE"> can hold nested spans (GRAM, COLLOINEXA, ...), so a lazy
// regex would cut the sentence short. Walk the tags and track depth instead.
function spanBlocks(html, className) {
  const open = `<span class="${className}">`;
  const blocks = [];
  let from = 0, at;
  while ((at = html.indexOf(open, from)) !== -1) {
    let i = at + open.length, depth = 1;
    const tag = /<\/?span\b/g;
    tag.lastIndex = i;
    let m;
    while (depth > 0 && (m = tag.exec(html))) {
      depth += m[0] === '</span' ? -1 : 1;
      i = tag.lastIndex;
    }
    blocks.push(html.slice(at + open.length, i - '</span'.length));
    from = i;
  }
  return blocks;
}

const stripQuery = u => u.split('?')[0];

export function extractEntry(html) {
  const out = {};
  const title = html.match(/class="pagetitle"[^>]*>([^<]*)/);
  if (title) out.hw = decode(title[1]).toLowerCase();

  const ame = html.match(/data-src-mp3="([^"]*\/ameProns\/[^"]*)"/);
  const bre = html.match(/data-src-mp3="([^"]*\/breProns\/[^"]*)"/);
  if (ame) out.ame = stripQuery(ame[1]);
  if (bre) out.bre = stripQuery(bre[1]);

  const codes = spanBlocks(html, 'PronCodes')[0];
  if (codes) {
    // "/ˈæɡrɪˌkʌltʃə $ -ər/" — the part after $ is the American variant
    const ipa = decode(codes).replace(/^\/|\/$/g, '').trim();
    if (ipa) out.ipa = ipa;
  }

  // Only examples that carry their own audio, i.e. the dictionary's own examples
  // rather than the long "Examples from the Corpus" list.
  out.ex = [];
  for (const block of spanBlocks(html, 'EXAMPLE')) {
    const mp3 = block.match(/data-src-mp3="([^"]*\/exaProns\/[^"]*)"/);
    if (!mp3) continue;
    const text = decode(block);
    if (text) out.ex.push({ t: text, a: stripQuery(mp3[1]) });
  }
  return out;
}

// ---------- fetching ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, asBuffer = false) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      return { status: 200, body: asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text() };
    } catch (e) {
      lastErr = String(e.cause?.code || e.message).slice(0, 60);
    }
  }
  return { status: 0, err: lastErr };
}

const cachePath = w => path.join(CACHE, w + '.json');
const audioPath = w => path.join(AUDIO, w + '.mp3');

async function fetchWord(word, stats) {
  let entry;
  if (fs.existsSync(cachePath(word))) {
    entry = JSON.parse(fs.readFileSync(cachePath(word), 'utf8'));
    stats.cached++;
  } else {
    const slug = VARIANT_SLUG[word] || word;
    const res = await get('https://www.ldoceonline.com/dictionary/' + encodeURIComponent(slug));
    if (res.status === 404) entry = { err: 404 };
    else if (res.status !== 200) entry = { err: res.err };
    else entry = extractEntry(res.body);
    fs.writeFileSync(cachePath(word), JSON.stringify(entry));
    if (entry.err) stats.pageFail++; else stats.pageOk++;
    await sleep(PACE_MS);
  }

  if (entry.ame && !fs.existsSync(audioPath(word))) {
    const res = await get(entry.ame, true);
    if (res.status === 200 && res.body.length > 500) {
      fs.writeFileSync(audioPath(word), res.body);
      stats.mp3Ok++;
      stats.mp3Bytes += res.body.length;
    } else {
      stats.mp3Fail++;
    }
    await sleep(PACE_MS);
  }
}

// ---------- main ----------

if (import.meta.filename === path.resolve(process.argv[1])) {
  const only = argOf('--words');
  const limit = +argOf('--limit') || 0;

  // A word is pending if we never fetched its page, or we did and its mp3 is still missing.
  const needsAudio = w => {
    try { return !!JSON.parse(fs.readFileSync(cachePath(w), 'utf8')).ame; }
    catch { return true; }
  };

  let words = only ? only.split(',').map(s => s.trim()).filter(Boolean) : readWordList();
  if (!only) words = words.filter(w => !fs.existsSync(cachePath(w)) || (!fs.existsSync(audioPath(w)) && needsAudio(w)));
  if (limit) words = words.slice(0, limit);

  const stats = { cached: 0, pageOk: 0, pageFail: 0, mp3Ok: 0, mp3Fail: 0, mp3Bytes: 0 };
  const total = words.length;
  console.log(`[ldoce] ${total} word(s) to do (${WORKERS} workers, ${PACE_MS}ms pacing)`);

  const queue = [...words];
  let done = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const w = queue.shift();
      try { await fetchWord(w, stats); }
      catch (e) { console.warn('[ldoce]', w, 'failed:', String(e).slice(0, 80)); }
      if (++done % 100 === 0 || done === total) {
        console.log(`[ldoce] ${done}/${total} | pages ok ${stats.pageOk} fail ${stats.pageFail} | mp3 ok ${stats.mp3Ok} fail ${stats.mp3Fail} (${(stats.mp3Bytes / 1e6).toFixed(1)}MB)`);
      }
    }
  }));
  console.log('[ldoce] done', JSON.stringify(stats));
}
