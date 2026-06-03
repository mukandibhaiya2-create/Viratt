/**
 * bot.js â€” Smart auto-responder with context-aware female persona
 *
 * For FEMALE users, replies are selected from a contextual bucket
 * based on what the message is about (greeting, sad, funny, thanks, etc.)
 * with a shuffle-based anti-repeat system so the same line never repeats
 * until the full bucket is exhausted.
 *
 * Trigger conditions depend on the active mode:
 * â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
 * â”‚ Mode                     â”‚ Trigger                                      â”‚
 * â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
 * â”‚ Friendly Mode ON         â”‚ ALL messages from ALL users                  â”‚
 * â”‚ Unfriendly Admin Mode ON â”‚ Only messages from admin / owner             â”‚
 * â”‚ Default (both OFF)       â”‚ "bot" keyword + @mention + tag + reply-to-botâ”‚
 * â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const genderHelper       = global.gender || require('../../utils/gender');
const { resolveUserProfile } = genderHelper;

const RESPONSE_DELAY_MS = 1500;
const handledMessages   = new Map();       // messageID â†’ timestamp
let   repliesCache      = null;            // parsed bot-reply.json
// Per-bucket shuffle state: "senderID:bucket" â†’ remaining indices (array)
const shuffleState      = new Map();

// â”€â”€â”€ Safe string helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const str = v => String(v || '');

// â”€â”€â”€ Admin / owner check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isAdminOrOwner(senderID) {
  const id = str(senderID);
  if (id === str(global.config?.ownerID)) return true;
  const adminIDs = global.config?.adminIDs;
  return Array.isArray(adminIDs) && adminIDs.map(str).includes(id);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONTEXT DETECTION â€” classify a message body into one of the female buckets
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CONTEXT_PATTERNS = [
  // bucket name          keyword / pattern list (any match â†’ that bucket)
  ['night_morning',   [/good\s*night/i, /good\s*morning/i, /gn\b/i, /gm\b/i,
                       /\braat\b/i, /\bsubah\b/i, /\bso\s*ja\b/i, /\bneend\b/i,
                       /\butho\b/i, /\bjago\b/i]],

  ['late_reply',      [/\blake\b/i, /\bder\b/i, /\bwait\b/i, /\bkahan\s*tha\b/i,
                       /itna\s*time/i, /\blatif/i, /\bgayab\b/i, /kitni\s*der/i]],

  ['sad_lonely',      [/\bsad\b/i, /\bdukhi\b/i, /\brona\b/i, /\bro\s*raha\b/i,
                       /\bakela\b/i, /\blonely\b/i, /\bdepressed\b/i,
                       /\bbura\s*lag\b/i, /\btaklif\b/i, /\bdard\b/i,
                       /\btension\b/i, /\bpareshaan\b/i, /\bupset\b/i]],

  ['funny_playful',   [/\blol\b/i, /\bhaha/i, /\bxd\b/i, /\bðŸ˜‚/,/\bðŸ¤£/,
                       /\bfunny\b/i, /\bmast\s*hai\b/i, /\bhasna\b/i,
                       /\bhas\s*raha\b/i, /\bhas\s*rahi\b/i, /\bhasi\b/i,
                       /\bpagal\b/i, /\bhans\b/i]],

  ['compliment_received', [/\bcute\b/i, /\bhandsome\b/i, /\bsmart\b/i,
                           /\bachha\s*lagta\b/i, /\bpyaara\b/i, /\bpyaari\b/i,
                           /\bsundar\b/i, /\bbeautiful\b/i, /\bawesome\b/i,
                           /\bgreat\b/i, /\bkamaal\b/i, /\bwonderful\b/i,
                           /tum.*acha/i, /tum.*best/i]],

  ['thanks',          [/\bthanks\b/i, /\bthank\s*you\b/i, /\bshukriya\b/i,
                       /\bshukra\b/i, /\bmeharbaani\b/i, /\btyvm\b/i,
                       /\btysm\b/i, /\bty\b/i, /\bbahut\s*achha\b/i]],

  ['asking_about_me', [/\bkaisa\s*ho\b/i, /\bkaisi\s*ho\b/i, /\bkaise\s*ho\b/i,
                       /\bkya\s*kar\s*rahe\b/i, /\bkya\s*chal\s*raha\b/i,
                       /\bkya\s*haal\b/i, /\bhow\s*are\s*you\b/i,
                       /\bsab\s*theek\b/i, /\bkhayal\b/i, /\bkuch\s*kha\b/i,
                       /\bsoya\b/i, /\bkha\s*liya\b/i]],

  ['needs_help',      [/\bhelp\b/i, /\bkaam\b/i, /\bchahiye\b/i,
                       /\bproblem\b/i, /\bissue\b/i, /\bkarna\s*hai\b/i,
                       /\bbatao\b/i, /\bkaise\s*karun\b/i, /\bkuch\s*karo\b/i,
                       /\bsahi\s*karo\b/i, /\bfix\b/i]],

  ['greeting',        [/^h+[aeiou]*y*i*\b/i, /\bhello\b/i, /\bhi\b/i,
                       /\bhey\b/i, /\bkya\s*baat\b/i, /\bkya\s*re\b/i,
                       /\bkya\s*yaar\b/i, /\bkya\s*hal\b/i,
                       /\bsup\b/i, /\bnamaste\b/i, /\bassalam\b/i]],
];

/**
 * Classify message body into a FEMALE reply bucket.
 * Falls back to 'general' if nothing matches.
 */
function detectBucket(body = '') {
  const b = body.trim();
  if (!b) return 'greeting';

  for (const [bucket, patterns] of CONTEXT_PATTERNS) {
    for (const rx of patterns) {
      if (rx.test(b)) return bucket;
    }
  }
  return 'general';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SHUFFLE-BASED ANTI-REPEAT PICKER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Fisher-Yates shuffle (mutates array in place, returns it).
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick the next reply from a bucket without repeating until the bucket
 * is exhausted, then reshuffle and start again.
 *
 * @param {string[]} pool   - All replies in this bucket
 * @param {string}   stateKey - Unique key per user+bucket combo
 */
function pickFromPool(pool, stateKey) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  let remaining = shuffleState.get(stateKey);

  // If pool is exhausted or not yet initialized, rebuild a shuffled index list
  if (!remaining || remaining.length === 0) {
    remaining = shuffle([...Array(pool.length).keys()]);
    // Ensure we never start with the same index as last time
    // (already handled by shuffle randomness, but just in case pool.length=2)
  }

  const idx = remaining.pop();
  shuffleState.set(stateKey, remaining);
  return pool[idx];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// REPLY LOADING & SELECTION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function loadReplies() {
  if (repliesCache) return repliesCache;
  const p = path.join(__dirname, 'noprefix', 'bot-reply.json');
  repliesCache = JSON.parse(fs.readFileSync(p, 'utf8'));
  return repliesCache;
}

/**
 * Select the right reply for this user.
 *
 * For FEMALE: context-aware bucket + anti-repeat shuffle.
 * For others: plain random pick from their flat array.
 */
function pickReply({ senderID, gender, messageBody }) {
  const replies = loadReplies();

  // â”€â”€ Special VIP user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (str(senderID) === '100037743553265') {
    const pool = replies['100037743553265'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const g = str(gender).toUpperCase();

  // â”€â”€ MALE / default flat array â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (g === 'MALE') {
    const pool = replies['MALE'] || replies['default'] || [];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // â”€â”€ FEMALE: context-aware + anti-repeat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (g === 'FEMALE') {
    const femaleData = replies['FEMALE'];

    // Support old flat-array format gracefully (won't happen after the update
    // but keeps the code resilient if someone manually edits the JSON).
    if (Array.isArray(femaleData)) {
      const stateKey = `${senderID}:legacy`;
      return pickFromPool(femaleData, stateKey) || 'Hello! ðŸ‘‹';
    }

    const bucket   = detectBucket(messageBody);
    const pool     = femaleData[bucket] || femaleData['general'] || [];
    const stateKey = `${senderID}:${bucket}`;
    return pickFromPool(pool, stateKey) || 'Hello! ðŸ‘‹';
  }

  // â”€â”€ Gender unknown â†’ default flat array â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const pool = replies['default'] || [];
  return pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : 'Hello! ðŸ‘‹';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRIGGER LOGIC
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function shouldTrigger(message = {}) {
  const { body = '', mentions = {}, messageReply, senderID } = message;

  const botID = str(global.client?.botID || global.config?.botID);

  // Never respond to ourselves
  if (botID && str(senderID) === botID) return false;

  const fm  = global.config?.friendlyMode        || {};
  const uam = global.config?.unfriendlyAdminMode  || {};

  // Mode 1: Friendly â€” respond to everyone
  if (fm.enabled) return true;

  // Mode 2: Unfriendly Admin â€” respond only to admin/owner
  if (uam.enabled) return isAdminOrOwner(senderID);

  // Mode 3: Default â€” targeted triggers only
  if (body && /\bbot\b/i.test(body)) return true;
  if (botID && Object.keys(mentions).some(uid => str(uid) === botID)) return true;
  if (body && Object.keys(mentions).length > 0) {
    const lowerBody = body.toLowerCase();
    for (const tag of Object.values(mentions)) {
      if (tag && lowerBody.includes(str(tag).toLowerCase().replace(/^@/, ''))) return true;
    }
  }
  if (botID && str(messageReply?.senderID) === botID) return true;

  return false;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DE-DUPE HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function cleanupHandledMap() {
  const now = Date.now();
  for (const [key, ts] of handledMessages) {
    if (now - ts > 5 * 60 * 1000) handledMessages.delete(key);
  }
}
function markHandled(mid) { if (mid) { handledMessages.set(mid, Date.now()); cleanupHandledMap(); } }
function wasHandled(mid)  { cleanupHandledMap(); return !!mid && handledMessages.has(mid); }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SEND
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function sendReply({ api, message }) {
  const { threadID, messageID, senderID, body } = message;

  if (!shouldTrigger(message) || wasHandled(messageID)) return;
  markHandled(messageID);

  const profile   = await resolveUserProfile({ userID: senderID, threadID, api });
  const replyText = pickReply({ senderID, gender: profile.gender, messageBody: body || '' });
  const userName  = profile.name || 'User';

  return api.sendMessage(
    { body: `ðŸ¥€${userName}ðŸ˜—, ${replyText}`, mentions: [{ tag: userName, id: senderID }] },
    threadID,
    undefined,
    messageID
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MODULE EXPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

module.exports = {
  config: {
    name: 'bot',
    description: 'Context-aware auto-responder with flirty female persona and pet names',
    usage: '',
    credit: 'ðð«ð¢ð²ðšð§ð¬ð¡ ð‘ðšð£ð©ð®ð­',
    hasPrefix: false,
    permission: 'PUBLIC',
    cooldown: 1,
    category: 'SYSTEM'
  },

  run: async function ({ api, message }) {
    return sendReply({ api, message });
  },

  handleEvent: async function ({ api, message }) {
    if (!message?.senderID) return;
    if (wasHandled(message.messageID)) return;
    await new Promise(resolve => setTimeout(resolve, RESPONSE_DELAY_MS));
    if (wasHandled(message.messageID)) return;
    return sendReply({ api, message });
  }
};function loadReplies() {
  if (repliesCache) return repliesCache;
  const botRepliesPath = path.join(__dirname, "noprefix", "bot-reply.json");
  repliesCache = JSON.parse(fs.readFileSync(botRepliesPath, "utf8"));
  return repliesCache;
}

function pickReply({ senderID, gender }) {
  const replies = loadReplies();
  let category = "default";
  if (senderID === "100037743553265") category = "100037743553265";
  else if (gender === 2 || gender?.toString().toUpperCase() === "MALE") category = "MALE";
  else if (gender === 1 || gender?.toString().toUpperCase() === "FEMALE") category = "FEMALE";

  let list = replies[category];
  if (!Array.isArray(list) || list.length === 0) {
    list = replies.default || [];
  }

  if (!Array.isArray(list) || list.length === 0) {
    return "Hello! 👋";
  }

  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

async function sendReply({ api, message }) {
  const { threadID, messageID, senderID, body } = message;
  if (!shouldTrigger(body) || wasHandled(messageID)) {
    return;
  }

  markHandled(messageID);

  const profile = await resolveUserProfile({ userID: senderID, threadID, api });
  const replyText = pickReply({ senderID, gender: profile.gender });
  const userName = profile.name || "User";

  return api.sendMessage({
    body: `🥀${userName}😗, ${replyText}`,
    mentions: [{ tag: userName, id: senderID }]
  }, threadID, undefined, messageID);
}

module.exports = {
  config: {
    name: "bot",
    description: "Quick reply when someone says bot",
    usage: "",
    credit: "𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭",
    hasPrefix: false,
    permission: "PUBLIC",
    cooldown: 1,
    category: "SYSTEM"
  },

  run: async function({ api, message }) {
    return sendReply({ api, message });
  },

  handleEvent: async function({ api, message }) {
    if (!message?.body || wasHandled(message.messageID)) return;
    await new Promise(resolve => setTimeout(resolve, RESPONSE_DELAY_MS));
    if (wasHandled(message.messageID)) return;
    return sendReply({ api, message });
  }
};
