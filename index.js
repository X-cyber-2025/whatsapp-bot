import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  jidNormalizedUser,
  areJidsSameUser
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import dotenv from "dotenv";
import pino from "pino";
import fs from "fs";
import http from "http";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER =
  String(process.env.PHONE_NUMBER || "").replace(/\D/g, "");

const WEBSITE_URL =
  process.env.WEBSITE_URL ||
  "https://x-cyber-2025.github.io/X-cyber.web/";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "";

const IMAGE_MODERATION_ENABLED =
  String(
    process.env.IMAGE_MODERATION_ENABLED || "true"
  ).toLowerCase() === "true";

const TEXT_MODERATION_ENABLED =
  String(
    process.env.TEXT_MODERATION_ENABLED || "true"
  ).toLowerCase() === "true";

const IMAGE_SEXUAL_SCORE_THRESHOLD =
  Number(
    process.env.IMAGE_SEXUAL_SCORE_THRESHOLD || 0.30
  );

const ALLOWED_GROUPS =
  String(process.env.ALLOWED_GROUPS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const AUTH_DIR =
  process.env.AUTH_DIR || "./auth";

const STATUS_FILE =
  process.env.STATUS_FILE || "./bot-status.json";

const LEAVE_BLACKLIST_FILE =
  process.env.LEAVE_BLACKLIST_FILE ||
  "./leave-blacklist.json";

const REPORT_FILE =
  process.env.REPORT_FILE ||
  "./reports.json";


/* =========================================================
   HTTP HEALTH SERVER
========================================================= */

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("PIYAS BOT is running.");
  })
  .listen(PORT, () => {
    console.log(`HTTP server running on port ${PORT}`);
  });


/* =========================================================
   LOGGER
========================================================= */

const logger = pino({
  level: "silent"
});


/* =========================================================
   JSON HELPERS
========================================================= */

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(
          fallback,
          null,
          2
        )
      );
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      `JSON load error: ${file}`,
      error.message
    );

    return fallback;
  }
}


function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      `JSON save error: ${file}`,
      error.message
    );
  }
}


/* =========================================================
   PERSISTENT DATA
========================================================= */

const botStatus =
  loadJSON(
    STATUS_FILE,
    {
      groups: {}
    }
  );

const leaveBlacklist =
  loadJSON(
    LEAVE_BLACKLIST_FILE,
    {
      groups: {}
    }
  );

const reports =
  loadJSON(
    REPORT_FILE,
    {
      groups: {}
    }
  );


/* =========================================================
   STATUS HELPERS
========================================================= */

function ensureGroupStatus(groupId) {
  if (!botStatus.groups[groupId]) {
    botStatus.groups[groupId] = {
      bot: true,
      welcome: true
    };

    saveJSON(
      STATUS_FILE,
      botStatus
    );
  }

  return botStatus.groups[groupId];
}


function isBotEnabled(groupId) {
  return ensureGroupStatus(groupId).bot !== false;
}


function isWelcomeEnabled(groupId) {
  return ensureGroupStatus(groupId).welcome !== false;
}


function setBotStatus(groupId, value) {
  ensureGroupStatus(groupId).bot = value;

  saveJSON(
    STATUS_FILE,
    botStatus
  );
}


function setWelcomeStatus(groupId, value) {
  ensureGroupStatus(groupId).welcome = value;

  saveJSON(
    STATUS_FILE,
    botStatus
  );
}


/* =========================================================
   GROUP FILTER
========================================================= */

function isAllowedGroup(groupId) {
  if (!ALLOWED_GROUPS.length) {
    return true;
  }

  return ALLOWED_GROUPS.includes(groupId);
}


/* =========================================================
   JID / ID HELPERS
========================================================= */

function normalizeJid(value) {
  if (!value) return "";

  try {
    return jidNormalizedUser(
      String(value)
    );
  } catch {
    return String(value);
  }
}


function isPnJid(value) {
  return (
    typeof value === "string" &&
    value.endsWith("@s.whatsapp.net")
  );
}


function isLidJid(value) {
  return (
    typeof value === "string" &&
    value.endsWith("@lid")
  );
}


function sameUser(a, b) {
  if (!a || !b) return false;

  try {
    return areJidsSameUser(
      normalizeJid(a),
      normalizeJid(b)
    );
  } catch {
    return (
      normalizeJid(a) ===
      normalizeJid(b)
    );
  }
}


function cleanPhone(value) {
  if (!value) return "";

  const str =
    String(value);

  const match =
    str.match(/\d{7,15}/);

  return match
    ? match[0]
    : "";
}


function jidToPhone(jid) {
  if (!jid) return "";

  if (!isPnJid(jid)) {
    return "";
  }

  return cleanPhone(
    jid.split("@")[0]
  );
}


function addUnique(array, value) {
  if (!value) return;

  const normalized =
    String(value).trim();

  if (!normalized) return;

  if (!array.includes(normalized)) {
    array.push(normalized);
  }
}


/* =========================================================
   PARTICIPANT ID HELPERS
========================================================= */

function getParticipantJid(participant) {
  if (!participant) {
    return "";
  }

  if (typeof participant === "string") {
    return normalizeJid(
      participant
    );
  }

  const candidates = [
    participant.id,
    participant.jid,
    participant.participant,
    participant.lid,
    participant.pn
  ];

  for (const value of candidates) {
    if (
      typeof value === "string" &&
      value.includes("@")
    ) {
      return normalizeJid(
        value
      );
    }
  }

  if (participant.phone) {
    const phone =
      cleanPhone(
        participant.phone
      );

    if (phone) {
      return `${phone}@s.whatsapp.net`;
    }
  }

  return "";
}


/*
 * For groupParticipantsUpdate(), PN JID is preferred
 * whenever available.
 */
function getParticipantActionJid(participant) {
  if (!participant) {
    return "";
  }

  if (typeof participant === "string") {
    return normalizeJid(
      participant
    );
  }

  const candidates = [
    participant.pn,
    participant.phoneJid,
    participant.phone,
    participant.phoneNumber,
    participant.id,
    participant.jid,
    participant.participant,
    participant.lid
  ];

  for (const value of candidates) {
    if (
      typeof value === "string" &&
      value.endsWith("@s.whatsapp.net")
    ) {
      return normalizeJid(
        value
      );
    }
  }

  for (const value of candidates) {
    if (
      typeof value === "string" &&
      value.includes("@")
    ) {
      return normalizeJid(
        value
      );
    }
  }

  return "";
}


/* =========================================================
   IDENTITY EXTRACTION
========================================================= */

function extractUserIdentity(input, pushName = "") {
  const identity = {
    jid: "",
    lid: "",
    phone: "",
    username: "",
    pushName: ""
  };

  if (!input) {
    if (pushName) {
      identity.pushName =
        String(pushName).trim();
    }

    return identity;
  }

  if (typeof input === "string") {
    const value =
      input.trim();

    if (value.includes("@")) {
      const normalized =
        normalizeJid(value);

      if (isPnJid(normalized)) {
        identity.jid =
          normalized;

        identity.phone =
          jidToPhone(
            normalized
          );
      }

      if (isLidJid(normalized)) {
        identity.lid =
          normalized;
      }
    } else {
      const phone =
        cleanPhone(value);

      if (phone) {
        identity.phone =
          phone;

        identity.jid =
          `${phone}@s.whatsapp.net`;
      }
    }

    if (pushName) {
      identity.pushName =
        String(pushName).trim();
    }

    return identity;
  }

  const values = [
    input.id,
    input.jid,
    input.participant,
    input.pn,
    input.phoneJid,
    input.lid,
    input.phone,
    input.phoneNumber
  ];

  for (const value of values) {
    if (
      typeof value !== "string"
    ) {
      continue;
    }

    if (
      value.endsWith("@s.whatsapp.net")
    ) {
      identity.jid =
        normalizeJid(value);

      identity.phone =
        jidToPhone(value);
    }

    if (
      value.endsWith("@lid")
    ) {
      identity.lid =
        normalizeJid(value);
    }

    if (
      !value.includes("@")
    ) {
      const phone =
        cleanPhone(value);

      if (phone) {
        identity.phone =
          identity.phone ||
          phone;

        identity.jid =
          identity.jid ||
          `${phone}@s.whatsapp.net`;
      }
    }
  }

  const username =
    input.username ||
    input.userName ||
    input.name ||
    "";

  if (username) {
    identity.username =
      String(username).trim();
  }

  const finalPushName =
    input.pushName ||
    input.notify ||
    pushName ||
    "";

  if (finalPushName) {
    identity.pushName =
      String(finalPushName).trim();
  }

  return identity;
}


/* =========================================================
   IDENTITY MERGE
========================================================= */

function mergeIdentity(a = {}, b = {}) {
  const result = {
    jid: "",
    lid: "",
    phone: "",
    username: "",
    pushName: ""
  };

  for (const key of Object.keys(result)) {
    result[key] =
      b[key] ||
      a[key] ||
      "";
  }

  return result;
}


/* =========================================================
   IDENTITY CACHE
========================================================= */

const userIdentityCache =
  new Map();


function identityCacheKey(identity) {
  if (!identity) return "";

  return (
    identity.jid ||
    identity.lid ||
    identity.phone ||
    ""
  );
}


function cacheUserIdentity(identity) {
  if (!identity) return;

  const clean = {
    jid: identity.jid || "",
    lid: identity.lid || "",
    phone: identity.phone || "",
    username: identity.username || "",
    pushName: identity.pushName || ""
  };

  const key =
    identityCacheKey(clean);

  if (!key) return;

  const old =
    userIdentityCache.get(key) || {};

  userIdentityCache.set(
    key,
    mergeIdentity(
      old,
      clean
    )
  );
}


function findCachedIdentity(identity) {
  if (!identity) {
    return null;
  }

  for (const cached of userIdentityCache.values()) {
    if (
      identityMatches(
        identity,
        cached
      )
    ) {
      return cached;
    }
  }

  return null;
}


/* =========================================================
   IDENTITY MATCHING
========================================================= */

/*
 * Stable identifiers:
 * - PN/JID
 * - LID
 * - Phone
 *
 * Username is intentionally NOT used as a sole match.
 * Push name is never used as a blacklist identifier.
 */
function identityMatches(a, b) {
  if (!a || !b) {
    return false;
  }

  if (
    a.jid &&
    b.jid &&
    sameUser(
      a.jid,
      b.jid
    )
  ) {
    return true;
  }

  if (
    a.lid &&
    b.lid &&
    sameUser(
      a.lid,
      b.lid
    )
  ) {
    return true;
  }

  if (
    a.phone &&
    b.phone &&
    cleanPhone(a.phone) ===
      cleanPhone(b.phone)
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   TEXT NORMALIZATION
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   BAD WORDS
========================================================= */

const BAD_WORDS = [
  "সালা",
  "শালা",
  "শালার",
  "সালার",
  "খানকি",
  "খানকির",
  "খানকী",
  "বাল",
  "বালের",
  "চোদা",
  "চোদাচুদি",
  "চুদ",
  "চুদা",
  "চুদাচুদি",
  "হারামি",
  "হারামজাদা",
  "হারামজাদী",
  "কুত্তা",
  "কুত্তার",
  "মাদারচোদ",
  "মাদারচোদা",
  "বাঞ্চোদ",
  "বাইনচোদ",
  "ফাক",
  "fuck",
  "fucking",
  "motherfucker",
  "bitch",
  "bastard",
  "dick",
  "pussy",
  "slut",
  "whore"
];


function containsBadWord(text) {
  const normalized =
    normalizeText(text);

  return BAD_WORDS.some(
    word =>
      normalized.includes(
        normalizeText(word)
      )
  );
}


/* =========================================================
   MESSAGE TEXT EXTRACTION
========================================================= */

function getMessageText(message) {
  if (!message) {
    return "";
  }

  const msg =
    message.message;

  if (!msg) {
    return "";
  }

  if (msg.conversation) {
    return msg.conversation;
  }

  if (
    msg.extendedTextMessage?.text
  ) {
    return msg.extendedTextMessage.text;
  }

  if (
    msg.imageMessage?.caption
  ) {
    return msg.imageMessage.caption;
  }

  if (
    msg.videoMessage?.caption
  ) {
    return msg.videoMessage.caption;
  }

  if (
    msg.documentMessage?.caption
  ) {
    return msg.documentMessage.caption;
  }

  return "";
}


/* =========================================================
   COMMAND PARSER
========================================================= */

function parseCommand(text) {
  const value =
    String(text || "").trim();

  if (!value.startsWith("/")) {
    return {
      command: "",
      args: ""
    };
  }

  const parts =
    value.split(/\s+/);

  const command =
    parts.shift()
      .toLowerCase();

  return {
    command,
    args: parts.join(" ")
  };
}


/* =========================================================
   GROUP METADATA CACHE
========================================================= */

const groupMetadataCache =
  new Map();


async function getGroupMetadata(sock, groupId) {
  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    groupMetadataCache.set(
      groupId,
      metadata
    );

    return metadata;
  } catch {
    return (
      groupMetadataCache.get(
        groupId
      ) || null
    );
  }
}


/* =========================================================
   ADMIN CHECK
========================================================= */

function isAdminParticipant(
  participant
) {
  return (
    participant?.admin === "admin" ||
    participant?.admin === "superadmin"
  );
}


async function isGroupAdmin(
  sock,
  groupId,
  jid
) {
  if (!groupId || !jid) {
    return false;
  }

  const metadata =
    await getGroupMetadata(
      sock,
      groupId
    );

  if (!metadata) {
    return false;
  }

  const normalized =
    normalizeJid(jid);

  const participant =
    metadata.participants?.find(
      p =>
        sameUser(
          p.id,
          normalized
        ) ||
        (
          p.jid &&
          sameUser(
            p.jid,
            normalized
          )
        ) ||
        (
          p.lid &&
          sameUser(
            p.lid,
            normalized
          )
        )
    );

  return Boolean(
    participant &&
    isAdminParticipant(
      participant
    )
  );
}


async function isBotAdmin(
  sock,
  groupId
) {
  const botJid =
    normalizeJid(
      sock.user?.id || ""
    );

  return isGroupAdmin(
    sock,
    groupId,
    botJid
  );
}


/* =========================================================
   OWNER CHECK
========================================================= */

function isOwner(jid) {
  if (!PHONE_NUMBER || !jid) {
    return false;
  }

  const phone =
    jidToPhone(
      normalizeJid(jid)
    );

  return (
    phone ===
    PHONE_NUMBER
  );
}


/* =========================================================
   DELETE MESSAGE
========================================================= */

async function deleteMessage(
  sock,
  msg
) {
  try {
    if (!msg?.key) {
      return false;
    }

    await sock.sendMessage(
      msg.key.remoteJid,
      {
        delete: msg.key
      }
    );

    return true;
  } catch (error) {
    console.error(
      "Delete message error:",
      error.message
    );

    return false;
  }
}


/* =========================================================
   WARNING
========================================================= */

async function sendWarning(
  sock,
  groupId,
  text,
  mentionedJid = []
) {
  try {
    await sock.sendMessage(
      groupId,
      {
        text,
        mentions:
          mentionedJid
      }
    );
  } catch {}
}


/* =========================================================
   OPENAI TEXT MODERATION
========================================================= */

async function moderateTextWithOpenAI(text) {
  if (
    !OPENAI_API_KEY ||
    !TEXT_MODERATION_ENABLED ||
    !text
  ) {
    return {
      flagged: false
    };
  }

  try {
    const response =
      await fetch(
        "https://api.openai.com/v1/moderations",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model:
              "omni-moderation-latest",
            input: text
          })
        }
      );

    if (!response.ok) {
      console.error(
        "OpenAI text moderation HTTP:",
        response.status
      );

      return {
        flagged: false
      };
    }

    const data =
      await response.json();

    const result =
      data?.results?.[0];

    return {
      flagged:
        Boolean(
          result?.flagged
        ),
      categories:
        result?.categories || {}
    };
  } catch (error) {
    console.error(
      "OpenAI text moderation error:",
      error.message
    );

    return {
      flagged: false
    };
  }
}


/* =========================================================
   OPENAI IMAGE MODERATION
========================================================= */

async function moderateImageWithOpenAI(
  sock,
  message
) {
  if (
    !OPENAI_API_KEY ||
    !IMAGE_MODERATION_ENABLED
  ) {
    return {
      flagged: false
    };
  }

  try {
    const buffer =
      await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger,
          reuploadRequest:
            sock.updateMediaMessage
        }
      );

    if (!buffer) {
      return {
        flagged: false
      };
    }

    const base64 =
      Buffer.from(
        buffer
      ).toString("base64");

    const mimetype =
      message.message
        ?.imageMessage
        ?.mimetype ||
      "image/jpeg";

    const response =
      await fetch(
        "https://api.openai.com/v1/moderations",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model:
              "omni-moderation-latest",
            input: [
              {
                type: "image_url",
                image_url: {
                  url:
                    `data:${mimetype};base64,${base64}`
                }
              }
            ]
          })
        }
      );

    if (!response.ok) {
      console.error(
        "OpenAI image moderation HTTP:",
        response.status
      );

      return {
        flagged: false
      };
    }

    const data =
      await response.json();

    const result =
      data?.results?.[0];

    const categories =
      result?.categories || {};

    const scores =
      result?.category_scores || {};

    const sexualScore =
      Number(
        scores.sexual || 0
      );

    const sexualMinors =
      Boolean(
        categories[
          "sexual/minors"
        ]
      );

    const sexual =
      Boolean(
        categories.sexual
      );

    const flagged =
      sexualMinors ||
      (
        sexual &&
        sexualScore >=
          IMAGE_SEXUAL_SCORE_THRESHOLD
      );

    return {
      flagged,
      sexualScore,
      sexualMinors,
      categories,
      scores
    };
  } catch (error) {
    console.error(
      "OpenAI image moderation error:",
      error.message
    );

    return {
      flagged: false
    };
  }
}


/* =========================================================
   BLACKLIST HELPERS
========================================================= */

function ensureLeaveGroup(groupId) {
  if (
    !leaveBlacklist.groups[groupId]
  ) {
    leaveBlacklist.groups[groupId] = [];
  }

  return leaveBlacklist.groups[groupId];
}


function blacklistMember(
  groupId,
  identity,
  reason = "removed"
) {
  if (!groupId || !identity) {
    return false;
  }

  const list =
    ensureLeaveGroup(
      groupId
    );

  const existingIndex =
    list.findIndex(
      item =>
        identityMatches(
          identity,
          item
        )
    );

  const now =
    new Date().toISOString();

  if (existingIndex >= 0) {
    const old =
      list[existingIndex];

    list[existingIndex] = {
      ...mergeIdentity(
        old,
        identity
      ),
      reason:
        reason ||
        old.reason ||
        "removed",
      updatedAt: now,
      permanent: true
    };
  } else {
    list.push({
      ...identity,
      reason,
      createdAt: now,
      updatedAt: now,
      permanent: true
    });
  }

  saveJSON(
    LEAVE_BLACKLIST_FILE,
    leaveBlacklist
  );

  return true;
}


function isLeaveBlacklisted(
  groupId,
  identity
) {
  if (
    !groupId ||
    !identity
  ) {
    return null;
  }

  const list =
    leaveBlacklist.groups[groupId] ||
    [];

  return (
    list.find(
      item =>
        identityMatches(
          identity,
          item
        )
    ) || null
  );
}


function removeLeaveBlacklist(
  groupId,
  identity
) {
  if (
    !groupId ||
    !identity
  ) {
    return false;
  }

  const list =
    leaveBlacklist.groups[groupId] ||
    [];

  const before =
    list.length;

  leaveBlacklist.groups[groupId] =
    list.filter(
      item =>
        !identityMatches(
          identity,
          item
        )
    );

  const changed =
    before !==
    leaveBlacklist.groups[groupId].length;

  if (changed) {
    saveJSON(
      LEAVE_BLACKLIST_FILE,
      leaveBlacklist
    );
  }

  return changed;
}


/* =========================================================
   REPORT SYSTEM
========================================================= */

function ensureReportGroup(groupId) {
  if (!reports.groups[groupId]) {
    reports.groups[groupId] = [];
  }

  return reports.groups[groupId];
}


function addReport(
  groupId,
  reporter,
  target,
  reason
) {
  const list =
    ensureReportGroup(
      groupId
    );

  list.push({
    reporter,
    target,
    reason,
    time:
      new Date().toISOString()
  });

  saveJSON(
    REPORT_FILE,
    reports
  );
}


/* =========================================================
   MENTION TARGET
========================================================= */

function getMentionTarget(
  message
) {
  const context =
    message.message
      ?.extendedTextMessage
      ?.contextInfo;

  const mentioned =
    context?.mentionedJid;

  if (
    Array.isArray(mentioned) &&
    mentioned.length
  ) {
    return normalizeJid(
      mentioned[0]
    );
  }

  return "";
}


/* =========================================================
   MENU
========================================================= */

function getMainMenu() {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 *BOT MENU*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 👥 *GROUP COMMANDS*
│
│ 1️⃣ /menu
│ 2️⃣ /bot
│ 3️⃣ /rules
│ 4️⃣ /admin
│ 5️⃣ /members
│ 6️⃣ /groupinfo
│ 7️⃣ /id
╰────────────────────

╭─❖ ⚙️ *UTILITY*
│
│ 8️⃣ /ping
╰────────────────────

╭─❖ 💰 *BUY / SELL*
│
│ 9️⃣ /deal /ডিল
╰────────────────────

╭─❖ 🤍 *PIYAS*
│
│ 🔟 /piyas
╰────────────────────

╭─❖ 🌐 *OUR WEBSITE*
│
│ 1️⃣1️⃣ /website
╰────────────────────

╭─❖ 🛡️ *REPORT*
│
│ 1️⃣2️⃣ /report @user কারণ
│ 1️⃣3️⃣ /reports
╰────────────────────

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim();
}


function getCommandList() {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
       📋 *COMMAND LIST*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 👥 *GROUP COMMANDS*
│
│ 1️⃣ /menu
│ 2️⃣ /bot
│ 3️⃣ /rules
│ 4️⃣ /admin
│ 5️⃣ /members
│ 6️⃣ /groupinfo
│ 7️⃣ /id
╰────────────────────

╭─❖ ⚙️ *UTILITY*
│
│ 8️⃣ /ping
╰────────────────────

╭─❖ 💰 *BUY / SELL*
│
│ 9️⃣ /deal /ডিল
╰────────────────────

╭─❖ 🤍 *PIYAS*
│
│ 🔟 /piyas
╰────────────────────

╭─❖ 🌐 *OUR WEBSITE*
│
│ 1️⃣1️⃣ /website
╰────────────────────

╭─❖ 🛡️ *REPORT*
│
│ 1️⃣2️⃣ /report @user কারণ
│ 1️⃣3️⃣ /reports
╰────────────────────

╭─❖ 👑 *ADMIN COMMANDS*
│
│ 1️⃣4️⃣ /adminpanel
│ 1️⃣5️⃣ /cmdlist
│ 1️⃣6️⃣ /on
│ 1️⃣7️⃣ /off
│ 1️⃣8️⃣ /boton
│ 1️⃣9️⃣ /botoff
│ 2️⃣0️⃣ /onbot
│ 2️⃣1️⃣ /offbot
│ 2️⃣2️⃣ /fullbotstatus
│ 2️⃣3️⃣ /welcomeon
│ 2️⃣4️⃣ /welcomeoff
│ 2️⃣5️⃣ /allowback @user
│ 2️⃣6️⃣ /unleave @user
╰────────────────────

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim();
}


function getAdminPanel() {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *ADMIN PANEL*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 🤖 *BOT CONTROL*
│
│ 1️⃣ /on
│ 2️⃣ /off
│ 3️⃣ /boton
│ 4️⃣ /botoff
│ 5️⃣ /onbot
│ 6️⃣ /offbot
│ 7️⃣ /fullbotstatus
╰────────────────────

╭─❖ 👋 *WELCOME CONTROL*
│
│ 8️⃣ /welcomeon
│ 9️⃣ /welcomeoff
╰────────────────────

╭─❖ 🛡️ *MEMBER CONTROL*
│
│ 🔟 /allowback @user
│ 1️⃣1️⃣ /unleave @user
╰────────────────────

╭─❖ 📋 *COMMAND MANAGEMENT*
│
│ 1️⃣2️⃣ /cmdlist
│ 1️⃣3️⃣ /adminpanel
╰────────────────────

╭━━━━━━━━━━━━━━━━━━━━╮
     🔐 *ADMIN ACCESS ONLY*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim();
}


/* =========================================================
   WELCOME MESSAGE
========================================================= */

function getWelcomeMessage(
  groupName,
  participantName
) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম ${participantName}!* ❤️

🌸 আপনাকে *${groupName}*
গ্রুপে স্বাগতম।

📌 গ্রুপের নিয়ম মেনে চলুন।
🤝 সবাইকে সম্মান করুন।
🚫 Spam / Link / খারাপ ভাষা ব্যবহার করবেন না।

💚 *Enjoy the group!*

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim();
}


/* =========================================================
   PARTICIPANT IDENTITY FROM METADATA
========================================================= */

function participantIdentityFromMetadata(
  participant
) {
  if (!participant) {
    return extractUserIdentity("");
  }

  const identity =
    extractUserIdentity(
      participant
    );

  const pnCandidates = [
    participant.pn,
    participant.phoneJid,
    participant.phone,
    participant.phoneNumber
  ];

  for (const value of pnCandidates) {
    if (
      typeof value === "string"
    ) {
      if (
        value.endsWith(
          "@s.whatsapp.net"
        )
      ) {
        identity.jid =
          normalizeJid(value);

        identity.phone =
          jidToPhone(value);
      } else {
        const phone =
          cleanPhone(value);

        if (phone) {
          identity.phone =
            identity.phone ||
            phone;

          identity.jid =
            identity.jid ||
            `${phone}@s.whatsapp.net`;
        }
      }
    }
  }

  return identity;
}


/* =========================================================
   PARTICIPANT UPDATE
========================================================= */

async function handleParticipantUpdate(
  sock,
  update
) {
  try {
    const {
      id: groupId,
      participants = [],
      action,
      author,
      authorPn,
      authorLid
    } = update;

    if (
      !groupId ||
      !isAllowedGroup(groupId)
    ) {
      return;
    }

    if (
      !Array.isArray(participants) ||
      !participants.length
    ) {
      return;
    }

    const groupMetadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    /*
     * =====================================================
     * ADD / REJOIN
     * =====================================================
     */

    if (action === "add") {
      for (const participant of participants) {
        const participantJid =
          getParticipantActionJid(
            participant
          );

        const rawIdentity =
          participantIdentityFromMetadata(
            participant
          );

        const cached =
          findCachedIdentity(
            rawIdentity
          );

        const finalIdentity =
          mergeIdentity(
            cached || {},
            rawIdentity
          );

        cacheUserIdentity(
          finalIdentity
        );

        const blacklisted =
          isLeaveBlacklisted(
            groupId,
            finalIdentity
          );

        if (blacklisted) {
          console.log(
            `BLACKLIST REJOIN BLOCKED: ${participantJid}`
          );

          if (
            participantJid &&
            await isBotAdmin(
              sock,
              groupId
            )
          ) {
            try {
              await sock.groupParticipantsUpdate(
                groupId,
                [participantJid],
                "remove"
              );

              await sock.sendMessage(
                groupId,
                {
                  text:
                    `🚫 @${jidToPhone(participantJid) || "Member"}-কে blacklist-এর কারণে গ্রুপ থেকে remove করা হয়েছে।`,
                  mentions: [
                    participantJid
                  ]
                }
              );
            } catch (error) {
              console.error(
                "Blacklist remove error:",
                error.message
              );
            }
          }

          continue;
        }

        if (
          isWelcomeEnabled(
            groupId
          )
        ) {
          const groupName =
            groupMetadata?.subject ||
            "আমাদের গ্রুপ";

          const phone =
            jidToPhone(
              participantJid
            );

          const mention =
            participantJid ||
            rawIdentity.jid ||
            rawIdentity.lid;

          const displayName =
            phone
              ? `@${phone}`
              : "@Member";

          await sock.sendMessage(
            groupId,
            {
              text:
                getWelcomeMessage(
                  groupName,
                  displayName
                ),
              mentions:
                mention
                  ? [mention]
                  : []
            }
          );
        }
      }

      return;
    }


    /*
     * =====================================================
     * REMOVE / LEAVE / KICK
     *
     * IMPORTANT:
     * Self leave       -> blacklist
     * Admin kick       -> blacklist
     * Bot remove       -> DO NOT blacklist
     * =====================================================
     */

    if (action === "remove") {
      const botJid =
        normalizeJid(
          sock.user?.id || ""
        );

      for (const participant of participants) {
        const participantJid =
          getParticipantJid(
            participant
          );

        const actionJid =
          getParticipantActionJid(
            participant
          ) ||
          participantJid;

        const participantIdentity =
          participantIdentityFromMetadata(
            participant
          );

        /*
         * Author identity
         */
        const authorIdentity =
          extractUserIdentity(
            author
          );

        const authorPnIdentity =
          extractUserIdentity(
            authorPn
          );

        const authorLidIdentity =
          extractUserIdentity(
            authorLid
          );

        let authorMerged =
          mergeIdentity(
            authorIdentity,
            authorPnIdentity
          );

        authorMerged =
          mergeIdentity(
            authorMerged,
            authorLidIdentity
          );

        /*
         * Cached identity
         */
        const cached =
          findCachedIdentity(
            participantIdentity
          );

        const finalIdentity =
          mergeIdentity(
            cached || {},
            participantIdentity
          );

        cacheUserIdentity(
          finalIdentity
        );


        /*
         * -------------------------------------------------
         * CHECK WHETHER BOT ITSELF REMOVED THE MEMBER
         * -------------------------------------------------
         */

        const removedByBot =
          (
            botJid &&
            (
              sameUser(
                author,
                botJid
              ) ||
              sameUser(
                authorPn,
                botJid
              ) ||
              sameUser(
                authorLid,
                botJid
              )
            )
          );


        /*
         * -------------------------------------------------
         * CHECK SELF LEAVE
         * -------------------------------------------------
         */

        const authorMatchesMember =
          identityMatches(
            finalIdentity,
            authorMerged
          );


        /*
         * -------------------------------------------------
         * IMPORTANT:
         *
         * If author matches member:
         *      SELF LEAVE
         *
         * If author is another person:
         *      ADMIN / MODERATOR KICK
         *
         * BOTH are BLACKLISTED.
         *
         * Only Bot removal is ignored.
         * -------------------------------------------------
         */

        if (!removedByBot) {
          const reason =
            authorMatchesMember
              ? "self_leave"
              : "admin_kick";

          blacklistMember(
            groupId,
            finalIdentity,
            reason
          );

          console.log(
            `BLACKLISTED: ${actionJid || participantJid} | ${reason}`
          );
        }
      }

      return;
    }

  } catch (error) {
    console.error(
      "Participant update error:",
      error.message
    );
  }
}


/* =========================================================
   MODERATION
========================================================= */

async function moderateMessage(
  sock,
  msg,
  groupId,
  senderJid
) {
  try {
    if (!msg?.message) {
      return false;
    }

    /*
     * Admin / owner bypass
     */
    if (
      isOwner(senderJid) ||
      await isGroupAdmin(
        sock,
        groupId,
        senderJid
      )
    ) {
      return false;
    }


    /*
     * TEXT MODERATION
     */

    const text =
      getMessageText(msg);

    if (text) {
      if (
        containsBadWord(text)
      ) {
        await deleteMessage(
          sock,
          msg
        );

        await sendWarning(
          sock,
          groupId,
          `⚠️ @${jidToPhone(senderJid) || "Member"}-এর মেসেজটি inappropriate language-এর কারণে remove করা হয়েছে।`,
          [senderJid]
        );

        return true;
      }

      if (
        OPENAI_API_KEY &&
        TEXT_MODERATION_ENABLED
      ) {
        const aiResult =
          await moderateTextWithOpenAI(
            text
          );

        if (
          aiResult.flagged
        ) {
          await deleteMessage(
            sock,
            msg
          );

          await sendWarning(
            sock,
            groupId,
            `⚠️ @${jidToPhone(senderJid) || "Member"}-এর মেসেজটি group moderation policy-এর কারণে remove করা হয়েছে।`,
            [senderJid]
          );

          return true;
        }
      }
    }


    /*
     * IMAGE MODERATION
     */

    const imageMessage =
      msg.message
        ?.imageMessage;

    if (
      imageMessage &&
      OPENAI_API_KEY &&
      IMAGE_MODERATION_ENABLED
    ) {
      const result =
        await moderateImageWithOpenAI(
          sock,
          msg
        );

      if (
        result.flagged
      ) {
        await deleteMessage(
          sock,
          msg
        );

        await sendWarning(
          sock,
          groupId,
          `⚠️ @${jidToPhone(senderJid) || "Member"}-এর ছবিটি group policy-এর কারণে remove করা হয়েছে।`,
          [senderJid]
        );

        return true;
      }
    }

    return false;

  } catch (error) {
    console.error(
      "Moderation error:",
      error.message
    );

    return false;
  }
}


/* =========================================================
   LINK PROTECTION
========================================================= */

function containsLink(text) {
  if (!text) return false;

  return /https?:\/\/|www\.|t\.me\/|wa\.me\/|chat\.whatsapp\.com\//i.test(
    text
  );
}


async function handleLinkProtection(
  sock,
  msg,
  groupId,
  senderJid
) {
  const text =
    getMessageText(msg);

  if (!containsLink(text)) {
    return false;
  }

  const admin =
    isOwner(senderJid) ||
    await isGroupAdmin(
      sock,
      groupId,
      senderJid
    );

  if (admin) {
    return false;
  }

  await deleteMessage(
    sock,
    msg
  );

  await sendWarning(
    sock,
    groupId,
    `🚫 @${jidToPhone(senderJid) || "Member"} গ্রুপে অনুমতি ছাড়া link পাঠানো যাবে না।`,
    [senderJid]
  );

  return true;
}


/* =========================================================
   DUPLICATE SPAM PROTECTION
========================================================= */

const duplicateCache =
  new Map();


function isDuplicateSpam(
  groupId,
  senderJid,
  text
) {
  if (!text) {
    return false;
  }

  const key =
    `${groupId}:${normalizeJid(senderJid)}`;

  const now =
    Date.now();

  const normalized =
    normalizeText(text);

  const old =
    duplicateCache.get(key);

  duplicateCache.set(
    key,
    {
      text: normalized,
      time: now
    }
  );

  if (!old) {
    return false;
  }

  const withinFiveMinutes =
    now - old.time <
    5 * 60 * 1000;

  return (
    withinFiveMinutes &&
    old.text === normalized
  );
}


/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(
  sock,
  msg,
  groupId,
  senderJid
) {
  const text =
    getMessageText(msg);

  const {
    command,
    args
  } =
    parseCommand(text);

  if (!command) {
    return false;
  }

  const admin =
    isOwner(senderJid) ||
    await isGroupAdmin(
      sock,
      groupId,
      senderJid
    );


  /* -------------------------------------------------------
     PUBLIC COMMANDS
  ------------------------------------------------------- */

  if (
    command === "/menu" ||
    command === "/bot"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          getMainMenu()
      }
    );

    return true;
  }


  if (
    command === "/rules"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করুন।
2️⃣ Spam করা যাবে না।
3️⃣ অনুমতি ছাড়া link দেওয়া যাবে না।
4️⃣ খারাপ ভাষা ব্যবহার করা যাবে না।
5️⃣ 18+ / inappropriate content নিষিদ্ধ।
6️⃣ প্রতারণামূলক deal করা যাবে না।
7️⃣ Admin-এর নির্দেশনা মেনে চলুন।

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  if (
    command === "/admin"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    const admins =
      metadata?.participants
        ?.filter(
          p =>
            isAdminParticipant(p)
        ) || [];

    let output =
      `╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;

    admins.forEach(
      (p, index) => {
        const jid =
          getParticipantJid(p);

        output +=
          `${index + 1}️⃣ @${jidToPhone(jid) || "Admin"}\n`;
      }
    );

    output +=
      `
╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯`;

    await sock.sendMessage(
      groupId,
      {
        text: output,
        mentions:
          admins
            .map(
              p =>
                getParticipantJid(p)
            )
            .filter(Boolean)
      }
    );

    return true;
  }


  if (
    command === "/members"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    const count =
      metadata?.participants
        ?.length || 0;

    await sock.sendMessage(
      groupId,
      {
        text:
          `👥 *Group Members:* ${count}`
      }
    );

    return true;
  }


  if (
    command === "/groupinfo"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       👥 *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Name: ${metadata?.subject || "Unknown"}
👥 Members: ${metadata?.participants?.length || 0}
🆔 Group ID:
${groupId}

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  if (
    command === "/id"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🆔 *Group ID:*\n${groupId}`
      }
    );

    return true;
  }


  if (
    command === "/ping"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          "🏓 *Pong!*\n\n🤖 PIYAS BOT is active."
      }
    );

    return true;
  }


  if (
    command === "/deal" ||
    command === "/ডিল"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        💰 *BUY / SELL*
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Buy / Sell deal করতে
group-এর নিয়ম মেনে post করুন।

⚠️ Deal করার আগে অবশ্যই
নিজ দায়িত্বে verify করে নিন।

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  if (
    command === "/piyas"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯

🌐 Website:
${WEBSITE_URL}

❤️ *PIYAS BOT*
`.trim()
      }
    );

    return true;
  }


  if (
    command === "/website"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🌐 *OUR WEBSITE*\n\n${WEBSITE_URL}`
      }
    );

    return true;
  }


  /* -------------------------------------------------------
     REPORT
  ------------------------------------------------------- */

  if (
    command === "/report"
  ) {
    const target =
      getMentionTarget(
        msg
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ একজন member-কে mention করে কারণ লিখুন।\n\nExample:\n/report @user spam করছে"
        }
      );

      return true;
    }

    const reason =
      args || "No reason provided";

    addReport(
      groupId,
      senderJid,
      target,
      reason
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          `✅ Report received.\n\n👤 Target: @${jidToPhone(target) || "Member"}\n📝 Reason: ${reason}`,
        mentions: [
          target
        ]
      }
    );

    return true;
  }


  if (
    command === "/reports"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    const list =
      reports.groups[groupId] ||
      [];

    if (!list.length) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "📋 কোনো report পাওয়া যায়নি।"
        }
      );

      return true;
    }

    const latest =
      list.slice(-20);

    let output =
      `╭━━━━━━━━━━━━━━━━━━━━╮
       🛡️ *REPORTS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;

    for (
      let i = 0;
      i < latest.length;
      i++
    ) {
      const report =
        latest[i];

      output +=
        `${i + 1}️⃣ Target: @${jidToPhone(report.target) || "Member"}\n` +
        `📝 ${report.reason}\n` +
        `⏰ ${report.time}\n\n`;
    }

    await sock.sendMessage(
      groupId,
      {
        text: output,
        mentions:
          latest
            .map(
              x =>
                x.target
            )
            .filter(Boolean)
      }
    );

    return true;
  }


  /* -------------------------------------------------------
     ADMIN PANEL
  ------------------------------------------------------- */

  if (
    command === "/adminpanel"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 এই command শুধু Group Admin-এর জন্য।"
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          getAdminPanel()
      }
    );

    return true;
  }


  if (
    command === "/cmdlist"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 এই command শুধু Group Admin-এর জন্য।"
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          getCommandList()
      }
    );

    return true;
  }


  /* -------------------------------------------------------
     BOT CONTROL
  ------------------------------------------------------- */

  if (
    [
      "/on",
      "/boton",
      "/onbot"
    ].includes(command)
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 Admin only."
        }
      );

      return true;
    }

    setBotStatus(
      groupId,
      true
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "✅ PIYAS BOT এই গ্রুপে ON করা হয়েছে।"
      }
    );

    return true;
  }


  if (
    [
      "/off",
      "/botoff",
      "/offbot"
    ].includes(command)
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 Admin only."
        }
      );

      return true;
    }

    setBotStatus(
      groupId,
      false
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "🔴 PIYAS BOT এই গ্রুপে OFF করা হয়েছে।"
      }
    );

    return true;
  }


  if (
    command === "/fullbotstatus"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 Admin only."
        }
      );

      return true;
    }

    const status =
      ensureGroupStatus(
        groupId
      );

    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${status.bot ? "🟢 ON" : "🔴 OFF"}

👋 Welcome:
${status.welcome ? "🟢 ON" : "🔴 OFF"}

🛡️ Blacklist:
🟢 Active

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  /* -------------------------------------------------------
     WELCOME CONTROL
  ------------------------------------------------------- */

  if (
    command === "/welcomeon"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 Admin only."
        }
      );

      return true;
    }

    setWelcomeStatus(
      groupId,
      true
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "✅ Welcome message ON করা হয়েছে।"
      }
    );

    return true;
  }


  if (
    command === "/welcomeoff"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 Admin only."
        }
      );

      return true;
    }

    setWelcomeStatus(
      groupId,
      false
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "🔴 Welcome message OFF করা হয়েছে।"
      }
    );

    return true;
  }


  /* -------------------------------------------------------
     ALLOW BACK / REMOVE BLACKLIST
  ------------------------------------------------------- */

  if (
    command === "/allowback" ||
    command === "/unleave"
  ) {
    if (!admin) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    const target =
      getMentionTarget(
        msg
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ যাকে blacklist থেকে remove করতে চান তাকে mention করুন।\n\nExample:\n/allowback @user"
        }
      );

      return true;
    }

    const targetIdentity =
      extractUserIdentity(
        target
      );

    const cached =
      findCachedIdentity(
        targetIdentity
      );

    const finalIdentity =
      mergeIdentity(
        cached || {},
        targetIdentity
      );

    const removed =
      removeLeaveBlacklist(
        groupId,
        finalIdentity
      );

    if (removed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            `✅ @${jidToPhone(target) || "Member"}-কে blacklist থেকে remove করা হয়েছে। এখন আবার join করতে পারবে।`,
          mentions: [
            target
          ]
        }
      );
    } else {
      await sock.sendMessage(
        groupId,
        {
          text:
            "ℹ️ এই member blacklist-এ পাওয়া যায়নি।"
        }
      );
    }

    return true;
  }


  return false;
}


/* =========================================================
   MESSAGE HANDLER
========================================================= */

async function handleIncomingMessage(
  sock,
  msg
) {
  try {
    if (!msg?.message) {
      return;
    }

    const groupId =
      msg.key?.remoteJid;

    /*
     * Only groups
     */
    if (
      !groupId ||
      !groupId.endsWith(
        "@g.us"
      )
    ) {
      return;
    }

    if (
      !isAllowedGroup(
        groupId
      )
    ) {
      return;
    }


    const senderJid =
      normalizeJid(
        msg.key?.participant ||
        msg.participant ||
        ""
      );

    if (!senderJid) {
      return;
    }


    /*
     * Cache identity
     */
    const senderIdentity =
      extractUserIdentity(
        senderJid,
        msg.pushName || ""
      );

    cacheUserIdentity(
      senderIdentity
    );


    /*
     * BOT OFF:
     *
     * Moderation is still kept active so
     * blacklist/security remains functional.
     */

    const commandText =
      getMessageText(msg);

    const {
      command
    } =
      parseCommand(
        commandText
      );


    /*
     * Admin commands must work even if
     * normal bot status is OFF.
     */

    const adminCommand =
      [
        "/adminpanel",
        "/cmdlist",
        "/on",
        "/off",
        "/boton",
        "/botoff",
        "/onbot",
        "/offbot",
        "/fullbotstatus",
        "/welcomeon",
        "/welcomeoff",
        "/allowback",
        "/unleave"
      ].includes(
        command
      );


    /*
     * Security moderation
     */

    const moderated =
      await moderateMessage(
        sock,
        msg,
        groupId,
        senderJid
      );

    if (moderated) {
      return;
    }


    /*
     * Link protection
     */

    const linkRemoved =
      await handleLinkProtection(
        sock,
        msg,
        groupId,
        senderJid
      );

    if (linkRemoved) {
      return;
    }


    /*
     * Duplicate spam
     */

    const text =
      getMessageText(msg);

    if (
      text &&
      isDuplicateSpam(
        groupId,
        senderJid,
        text
      )
    ) {
      const admin =
        isOwner(senderJid) ||
        await isGroupAdmin(
          sock,
          groupId,
          senderJid
        );

      if (!admin) {
        await deleteMessage(
          sock,
          msg
        );

        await sendWarning(
          sock,
          groupId,
          `⚠️ @${jidToPhone(senderJid) || "Member"} একই message বারবার পাঠানো যাবে না।`,
          [senderJid]
        );

        return;
      }
    }


    /*
     * BOT OFF
     */

    if (
      !isBotEnabled(
        groupId
      ) &&
      !adminCommand
    ) {
      return;
    }


    /*
     * Commands
     */

    await handleCommand(
      sock,
      msg,
      groupId,
      senderJid
    );

  } catch (error) {
    console.error(
      "Message handler error:",
      error.message
    );
  }
}


/* =========================================================
   START BOT
========================================================= */

let sock = null;
let reconnecting = false;


async function startBot() {
  try {
    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    const {
      version
    } =
      await fetchLatestBaileysVersion();


    sock =
      makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false
      });


    /* -----------------------------------------------------
       SAVE AUTH
    ----------------------------------------------------- */

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    /* -----------------------------------------------------
       CONNECTION
    ----------------------------------------------------- */

    sock.ev.on(
      "connection.update",
      async update => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (
          connection === "open"
        ) {
          reconnecting =
            false;

          console.log(
            "================================="
          );

          console.log(
            "PIYAS BOT CONNECTED"
          );

          console.log(
            `Bot: ${sock.user?.id || "Unknown"}`
          );

          console.log(
            "================================="
          );

          return;
        }


        if (
          connection === "close"
        ) {
          const statusCode =
            new Boom(
              lastDisconnect
                ?.error
            )?.output
              ?.statusCode;

          const shouldReconnect =
            statusCode !==
            DisconnectReason.loggedOut;

          console.log(
            `Connection closed. Reconnect: ${shouldReconnect}`
          );

          if (
            shouldReconnect &&
            !reconnecting
          ) {
            reconnecting =
              true;

            setTimeout(
              () => {
                startBot()
                  .catch(
                    error =>
                      console.error(
                        "Reconnect error:",
                        error.message
                      )
                  );
              },
              5000
            );
          } else if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              "Logged out. Delete auth folder and login again."
            );
          }
        }
      }
    );


    /* -----------------------------------------------------
       GROUP PARTICIPANT EVENTS
    ----------------------------------------------------- */

    sock.ev.on(
      "group-participants.update",
      async update => {
        await handleParticipantUpdate(
          sock,
          update
        );
      }
    );


    /* -----------------------------------------------------
       MESSAGES
    ----------------------------------------------------- */

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        for (const msg of messages) {
          await handleIncomingMessage(
            sock,
            msg
          );
        }
      }
    );


  } catch (error) {
    console.error(
      "START BOT ERROR:",
      error
    );

    if (!reconnecting) {
      reconnecting = true;

      setTimeout(
        () => {
          startBot()
            .catch(
              err =>
                console.error(
                  "Retry error:",
                  err.message
                )
            );
        },
        10000
      );
    }
  }
}


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

process.on(
  "SIGINT",
  async () => {
    console.log(
      "Shutting down..."
    );

    process.exit(0);
  }
);


process.on(
  "SIGTERM",
  async () => {
    console.log(
      "Shutting down..."
    );

    process.exit(0);
  }
);


/* =========================================================
   START
========================================================= */

startBot();