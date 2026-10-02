// Organizer — banc d'essai terrain.
// Bot Telegram en long polling : chaque vocal part à Gemini avec le prompt de tri,
// l'audio et le résultat sont gardés dans /home/node/data. Aucun package npm.
// Pas de signe dollar dans ce fichier : il est embarqué dans le compose, qui l'interpréterait.

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const env = process.env;
const TZ = env.TZ || 'Europe/Paris';
const MODEL = env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const FALLBACK = env.GEMINI_MODEL_FALLBACK || 'gemini-3.8-flash';
const ALLOWED = (env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SHOW_RESULT = env.SHOW_RESULT !== 'false';
const PROMPT_VERSION = 'tri/v1';
const DATA = '/home/node/data';
const LOG = DATA + '/captures.jsonl';
const OFFSET = DATA + '/offset';

if (!env.TELEGRAM_BOT_TOKEN || !env.GEMINI_API_KEY) {
  console.error('TELEGRAM_BOT_TOKEN et GEMINI_API_KEY sont obligatoires.');
  process.exit(1);
}

const TG = 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN;
const TG_FILE = 'https://api.telegram.org/file/bot' + env.TELEGRAM_BOT_TOKEN + '/';
const SYSTEM = await readFile('/app/system.md', 'utf8');
const SCHEMA = JSON.parse(await readFile('/app/response-schema.json', 'utf8'));
await mkdir(DATA + '/audio', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, body) {
  const r = await fetch(TG + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error('Telegram ' + method + ' : ' + j.description);
  return j.result;
}

const say = (chatId, text, replyTo) =>
  tg('sendMessage', { chat_id: chatId, text, reply_parameters: replyTo ? { message_id: replyTo } : undefined });

// Date ISO 8601 avec le décalage du fuseau, ex. 2026-10-06T08:12:00+02:00
function isoLocal(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const off = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + off;
}

const jourSemaine = (date) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long' }).format(date);
const dateCourte = (iso) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso)).replace(' 00:00', '');

// Thèmes et prénoms déjà sortis, réinjectés pour stabiliser les libellés.
async function connus() {
  const themes = new Set();
  const prenoms = new Set();
  if (existsSync(LOG)) {
    for (const line of (await readFile(LOG, 'utf8')).split('\n')) {
      if (!line) continue;
      try {
        for (const it of JSON.parse(line).resultat?.items || []) {
          if (it.theme) themes.add(it.theme);
          for (const p of it.personnes || []) prenoms.add(p);
        }
      } catch {}
    }
  }
  const aucun = "aucun pour l'instant";
  return { themes: [...themes].join(', ') || aucun, prenoms: [...prenoms].join(', ') || aucun };
}

async function gemini(model, system, parts) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gemini ' + model + ' ' + r.status + ' : ' + (j.error?.message || 'réponse illisible'));
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const out = JSON.parse(text);
  if (typeof out.transcription !== 'string' || !Array.isArray(out.items)) throw new Error('Sortie hors schéma');
  return { out, usage: j.usageMetadata };
}

const LABEL = { action: 'À faire', pensee: 'Pensée', information: 'Info', ambigu: 'À revoir' };

function resume(out) {
  if (!out.items.length) return 'Rien à classer. Gardé tel quel.';
  return out.items.map((it) => {
    const extra = [];
    const quand = it.echeance_date || it.fenetre_fin;
    if (it.echeance_expr) extra.push(it.echeance_expr + (quand ? ' → ' + dateCourte(quand) : ''));
    if (it.alarme) extra.push('alarme');
    if (it.theme) extra.push(it.theme);
    return '- ' + (LABEL[it.nature] || it.nature) + ' : ' + it.texte + (extra.length ? '\n  ' + extra.join(' · ') : '');
  }).join('\n');
}

async function handle(u) {
  const m = u.message;
  if (!m) return;
  const chat = String(m.chat.id);
  if (!ALLOWED.includes(chat)) {
    await say(m.chat.id, 'Accès non autorisé. Ton identifiant : ' + chat);
    return;
  }
  const voice = m.voice || m.audio;
  if (!voice && !m.text) return;
  if (m.text === '/start') return say(m.chat.id, 'Prêt. Envoie un vocal.');
  if (m.text?.startsWith('/')) return;

  const emis = new Date(m.date * 1000);
  const id = chat + '_' + m.message_id;
  const capture = {
    id, chat, message_id: m.message_id, emis_le: isoLocal(emis), recu_le: isoLocal(new Date()),
    duree_s: voice?.duration ?? null, audio: null, texte_ecrit: m.text ?? null,
    version_prompt: PROMPT_VERSION, modele: null, etat: 'recue', erreur: null, resultat: null, usage: null,
  };

  let parts;
  if (voice) {
    const f = await tg('getFile', { file_id: voice.file_id });
    const buf = Buffer.from(await (await fetch(TG_FILE + f.file_path)).arrayBuffer());
    capture.audio = 'audio/' + id + '.' + (f.file_path.split('.').pop() || 'ogg');
    await writeFile(DATA + '/' + capture.audio, buf);
    parts = [{ inlineData: { mimeType: voice.mime_type || 'audio/ogg', data: buf.toString('base64') } }, { text: 'Voici le vocal.' }];
  } else {
    parts = [{ text: "Message écrit, pas de vocal. Ce texte est la transcription :\n" + m.text }];
  }
  await say(m.chat.id, 'Reçu.', m.message_id);

  const k = await connus();
  const vars = {
    '{{emis_le}}': capture.emis_le, '{{jour_semaine}}': jourSemaine(emis), '{{fuseau}}': TZ,
    '{{themes_connus}}': k.themes, '{{prenoms_connus}}': k.prenoms, '{{exemples}}': '',
  };
  let system = SYSTEM;
  for (const [key, val] of Object.entries(vars)) system = system.replaceAll(key, () => val);

  for (const model of [MODEL, FALLBACK]) {
    try {
      const { out, usage } = await gemini(model, system, parts);
      Object.assign(capture, { modele: model, etat: 'classee', erreur: null, resultat: out, usage });
      break;
    } catch (e) {
      console.error(id + ' : ' + e.message);
      Object.assign(capture, { modele: model, etat: 'a_revoir', erreur: e.message });
    }
  }
  await appendFile(LOG, JSON.stringify(capture) + '\n');

  if (capture.etat !== 'classee') await say(m.chat.id, 'Le tri a échoué. Le vocal est gardé.');
  else if (SHOW_RESULT) await say(m.chat.id, resume(capture.resultat));
}

await tg('deleteWebhook', { drop_pending_updates: false });
let offset = existsSync(OFFSET) ? Number(await readFile(OFFSET, 'utf8')) : 0;
console.log('Organizer terrain démarré. Modèle ' + MODEL + ', repli ' + FALLBACK + ', ' + ALLOWED.length + ' conversation(s) autorisée(s).');

for (;;) {
  let updates;
  try {
    updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
  } catch (e) {
    console.error(e.message);
    await sleep(5000);
    continue;
  }
  for (const u of updates) {
    // Trois essais avant d'abandonner un message : une panne réseau ne doit pas le perdre.
    for (let essai = 1; essai <= 3; essai++) {
      try {
        await handle(u);
        break;
      } catch (e) {
        console.error('Message ' + u.update_id + ', essai ' + essai + ' : ' + e.message);
        await sleep(5000 * essai);
      }
    }
    offset = u.update_id + 1;
    await writeFile(OFFSET, String(offset));
  }
}
