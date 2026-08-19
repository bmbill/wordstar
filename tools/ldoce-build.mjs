// Turn tools/.ldoce-cache/ into the two files the app loads:
//
//   prons.json     word -> IPA. A word being present means audio/words/<word>.mp3
//                  exists, which is how the app decides between real audio and TTS.
//   sentences.json the existing {word:{e,h}} file, with an "x" array of real
//                  Longman example sentences added (cloze-blanked, easy ones first).
//
//   node tools/ldoce-build.mjs [--dry]

import fs from 'fs';
import path from 'path';
import { readWordList, VARIANT_SLUG } from './ldoce-fetch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, 'tools', '.ldoce-cache');
const AUDIO = path.join(ROOT, 'audio', 'words');
const dry = process.argv.includes('--dry');

const MAX_EX = 3;      // per word, to keep sentences.json a reasonable download
const MIN_WORDS = 5;
const MAX_WORDS = 16;

// ---------- inflections ----------

// Enough to recognise the headword inside an example. Over-generating is safe:
// every candidate still has to survive a word-boundary match against the text.
const IRREGULAR = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'], have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'], go: ['goes', 'went', 'gone', 'going'],
  say: ['says', 'said'], make: ['makes', 'made', 'making'], take: ['takes', 'took', 'taken', 'taking'],
  come: ['comes', 'came', 'coming'], see: ['sees', 'saw', 'seen', 'seeing'],
  get: ['gets', 'got', 'gotten', 'getting'], give: ['gives', 'gave', 'given', 'giving'],
  find: ['finds', 'found', 'finding'], think: ['thinks', 'thought', 'thinking'],
  tell: ['tells', 'told', 'telling'], become: ['becomes', 'became', 'becoming'],
  leave: ['leaves', 'left', 'leaving'], feel: ['feels', 'felt', 'feeling'],
  bring: ['brings', 'brought', 'bringing'], begin: ['begins', 'began', 'begun', 'beginning'],
  keep: ['keeps', 'kept', 'keeping'], hold: ['holds', 'held', 'holding'],
  write: ['writes', 'wrote', 'written', 'writing'], stand: ['stands', 'stood', 'standing'],
  hear: ['hears', 'heard', 'hearing'], let: ['lets', 'letting'], mean: ['means', 'meant', 'meaning'],
  set: ['sets', 'setting'], meet: ['meets', 'met', 'meeting'], run: ['runs', 'ran', 'running'],
  pay: ['pays', 'paid', 'paying'], sit: ['sits', 'sat', 'sitting'], speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  lie: ['lies', 'lay', 'lain', 'lying'], lead: ['leads', 'led', 'leading'], read: ['reads', 'reading'],
  grow: ['grows', 'grew', 'grown', 'growing'], lose: ['loses', 'lost', 'losing'],
  fall: ['falls', 'fell', 'fallen', 'falling'], send: ['sends', 'sent', 'sending'],
  build: ['builds', 'built', 'building'], understand: ['understands', 'understood', 'understanding'],
  draw: ['draws', 'drew', 'drawn', 'drawing'], break: ['breaks', 'broke', 'broken', 'breaking'],
  spend: ['spends', 'spent', 'spending'], buy: ['buys', 'bought', 'buying'],
  eat: ['eats', 'ate', 'eaten', 'eating'], drink: ['drinks', 'drank', 'drunk', 'drinking'],
  drive: ['drives', 'drove', 'driven', 'driving'], choose: ['chooses', 'chose', 'chosen', 'choosing'],
  wear: ['wears', 'wore', 'worn', 'wearing'], teach: ['teaches', 'taught', 'teaching'],
  catch: ['catches', 'caught', 'catching'], sleep: ['sleeps', 'slept', 'sleeping'],
  sing: ['sings', 'sang', 'sung', 'singing'], swim: ['swims', 'swam', 'swum', 'swimming'],
  ride: ['rides', 'rode', 'ridden', 'riding'], rise: ['rises', 'rose', 'risen', 'rising'],
  fly: ['flies', 'flew', 'flown', 'flying'], throw: ['throws', 'threw', 'thrown', 'throwing'],
  win: ['wins', 'won', 'winning'], forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
  child: ['children'], man: ['men'], woman: ['women'], foot: ['feet'], tooth: ['teeth'],
  person: ['people'], mouse: ['mice'], goose: ['geese'], knife: ['knives'], leaf: ['leaves'],
  wife: ['wives'], life: ['lives'], shelf: ['shelves'], good: ['better', 'best'], bad: ['worse', 'worst'],
};

function inflections(w) {
  const v = new Set([w]);
  (IRREGULAR[w] || []).forEach(x => v.add(x));
  const last = w.slice(-1), stem = w.slice(0, -1);
  ['s', 'es', 'ed', 'ing', 'd', 'r', 'st'].forEach(s => v.add(w + s));
  if (last === 'y' && !/[aeiou]y$/.test(w)) ['ies', 'ied', 'ier', 'iest'].forEach(s => v.add(stem + s));
  if (last === 'e') ['ing', 'ed', 'er', 'est', 'y'].forEach(s => v.add(stem + s));
  if (/(s|x|z|ch|sh)$/.test(w)) v.add(w + 'es');
  if (/f$/.test(w)) v.add(stem + 'ves');
  // doubled final consonant: stop -> stopping, big -> bigger
  if (/^[a-z]*[^aeiou][aeiou][bdglmnprt]$/.test(w)) ['ing', 'ed', 'er', 'est', 'y'].forEach(s => v.add(w + last + s));
  return [...v].sort((a, b) => b.length - a.length);
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- example filtering ----------

const OPENERS = /^["'“‘(]?[A-Z]/;
const CLOSERS = /[.!?]["'”’)]?$/;

// Corpus examples occasionally land somewhere we don't want a vocabulary game to go.
// Deliberately narrow: ordinary usage like "after the war many soldiers stayed in
// France" stays, graphic or adult content goes. A hit is ignored when the term IS the
// headword — someone studying "kill" or "gun" still needs examples for it — and words
// left with nothing simply fall back to the hand-written e/h sentences.
const SENSITIVE = /\b(suicide|rape|raped|sex|sexual|naked|nude|prostitute|virgin|condom|murder(ed|s)?|stabbed|knifed|strangled|corpse|cocaine|heroin|marijuana|cannabis|drunk|drunken|beer|whisky|whiskey|vodka|cigar|cigarette|smoking|terrorist)\b|shot dead|to death|gun to his|gun to her|threatened to kill|kill (him|her|my)self/i;

function sensitive(text, forms) {
  const set = new Set(forms.map(f => f.toLowerCase()));
  const re = new RegExp(SENSITIVE.source, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const term = m[0].toLowerCase();
    if (!set.has(term)) return true;   // not the word being studied -> drop the example
  }
  return false;
}

function reject(text) {
  if (text.includes('(=')) return 'gloss';            // "a servant (=someone who serves)"
  if (/[→←↔]|\bSYN\b|\bOPP\b/.test(text)) return 'markup';
  if (!OPENERS.test(text)) return 'fragment-start';   // "agricultural land"
  if (!CLOSERS.test(text)) return 'fragment-end';
  const n = text.split(/\s+/).length;
  if (n < MIN_WORDS) return 'too-short';
  if (n > MAX_WORDS) return 'too-long';
  return null;
}

// ---------- build ----------

const words = readWordList();
const sentences = JSON.parse(fs.readFileSync(path.join(ROOT, 'sentences.json'), 'utf8'));
const prons = {};
const stats = { noCache: 0, cacheErr: 0, withAudio: 0, withIpa: 0, ipaDual: 0, exSeen: 0, exKept: 0, rejected: {}, wordsWithEx: 0, exactOnly: 0 };

for (const w of words) {
  const file = path.join(CACHE, w + '.json');
  if (!fs.existsSync(file)) { stats.noCache++; continue; }
  let entry;
  try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { stats.cacheErr++; continue; }
  if (entry.err) { stats.cacheErr++; continue; }

  // prons.json doubles as the "has local audio" manifest, so only list words
  // whose mp3 actually made it onto disk.
  if (fs.existsSync(path.join(AUDIO, w + '.mp3'))) {
    let ipa = entry.ipa || '';
    if (ipa.includes('$')) { stats.ipaDual++; ipa = ''; }   // BrE $ AmE shorthand isn't safe to render
    prons[w] = ipa;
    stats.withAudio++;
    if (ipa) stats.withIpa++;
  }

  // Clear first so x[] is always rebuilt from the current cache. Without this, a word
  // whose entry no longer yields examples would keep whatever a previous run wrote.
  const rec = sentences[w] || (sentences[w] = {});
  delete rec.x;

  if (!entry.ex?.length) continue;
  // Words fetched via a British headword have examples spelled the British way
  // ("theatre"), so recognise that spelling too — it is the blanked word either way.
  const forms = inflections(w);
  const slug = VARIANT_SLUG[w];
  if (slug) for (const alt of [slug, slug.replace(/-/g, ' '), slug.replace(/-/g, '')]) forms.push(...inflections(alt));
  forms.sort((a, b) => b.length - a.length);
  const re = new RegExp('\\b(' + forms.map(escRe).join('|') + ')\\b', 'i');
  const already = new Set([rec.e, rec.h].filter(Boolean).map(s => s.replace(/_+/g, '_').toLowerCase()));

  const exact = [], inflected = [];
  for (const e of entry.ex) {
    stats.exSeen++;
    const why = reject(e.t);
    if (why) { stats.rejected[why] = (stats.rejected[why] || 0) + 1; continue; }
    const m = e.t.match(re);
    if (!m) { stats.rejected.noHeadword = (stats.rejected.noHeadword || 0) + 1; continue; }
    if (sensitive(e.t, forms)) { stats.rejected.sensitive = (stats.rejected.sensitive || 0) + 1; continue; }
    const cloze = e.t.replace(new RegExp('\\b(' + forms.map(escRe).join('|') + ')\\b', 'gi'), '___');
    const key = cloze.replace(/_+/g, '_').toLowerCase();
    if (already.has(key)) { stats.rejected.duplicate = (stats.rejected.duplicate || 0) + 1; continue; }
    already.add(key);
    (m[1].toLowerCase() === w ? exact : inflected).push(cloze);
  }
  const picked = [...exact, ...inflected].slice(0, MAX_EX);
  if (picked.length) {
    rec.x = picked;
    stats.exKept += picked.length;
    stats.wordsWithEx++;
    if (!inflected.length) stats.exactOnly++;
  } else {
    delete rec.x;
  }
}

console.log('[build] words in list        ', words.length);
console.log('[build] not yet fetched      ', stats.noCache, '| cache errors', stats.cacheErr);
console.log('[build] with local mp3       ', stats.withAudio, `(${(100 * stats.withAudio / words.length).toFixed(1)}%)`);
console.log('[build] with renderable IPA  ', stats.withIpa, '| skipped BrE$AmE forms', stats.ipaDual);
console.log('[build] examples seen/kept   ', stats.exSeen, '/', stats.exKept);
console.log('[build] words with examples  ', stats.wordsWithEx, `(${(100 * stats.wordsWithEx / words.length).toFixed(1)}%)`, '| base form only', stats.exactOnly);
console.log('[build] rejections           ', JSON.stringify(stats.rejected));

if (dry) {
  console.log('\n--- dry run, nothing written. samples: ---');
  for (const w of Object.keys(sentences).filter(k => sentences[k].x).slice(0, 8)) {
    console.log(w, JSON.stringify(sentences[w].x));
  }
} else {
  fs.writeFileSync(path.join(ROOT, 'prons.json'), JSON.stringify(prons));
  fs.writeFileSync(path.join(ROOT, 'sentences.json'), JSON.stringify(sentences));
  const kb = f => (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0) + 'KB';
  console.log('\n[build] wrote prons.json', kb('prons.json'), '| sentences.json', kb('sentences.json'));
}
