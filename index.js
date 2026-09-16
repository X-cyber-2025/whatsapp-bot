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
  String(process.env.PHONE_NUMBER || "")
    .replace(/\D/g, "");

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
    process.env.IMAGE_SEXUAL_SCORE_THRESHOLD || "0.30"
  );

const ALLOWED_GROUPS =
  String(process.env.ALLOWED_GROUPS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

const AUTH_DIR =
  process.env.AUTH_DIR || "./auth";

const STATUS_FILE =
  process.env.STATUS_FILE ||
  "./bot-status.json";

const LEAVE_BLACKLIST_FILE =
  process.env.LEAVE_BLACKLIST_FILE ||
  "./leave-blacklist.json";

const REPORT_FILE =
  process.env.REPORT_FILE ||
  "./reports.json";


/* =========================================================
   LOGGER
========================================================= */

const logger = pino({
  level: "silent"
});


/* =========================================================
   HTTP SERVER
========================================================= */

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type":
      "text/plain; charset=utf-8"
  });

  res.end(
    "PIYAS BOT is running."
  );
}).listen(PORT, () => {
  console.log(
    `HTTP server running on port ${PORT}`
  );
});


/* =========================================================
   JSON FUNCTIONS
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
   DATA
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
   BOT STATUS
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
  return (
    ensureGroupStatus(groupId).bot !== false
  );
}


function isWelcomeEnabled(groupId) {
  return (
    ensureGroupStatus(groupId).welcome !== false
  );
}


function setBotStatus(groupId, value) {
  ensureGroupStatus(groupId).bot =
    Boolean(value);

  saveJSON(
    STATUS_FILE,
    botStatus
  );
}


function setWelcomeStatus(groupId, value) {
  ensureGroupStatus(groupId).welcome =
    Boolean(value);

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

  return ALLOWED_GROUPS.includes(
    groupId
  );
}


/* =========================================================
   JID HELPERS
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
    value.endsWith(
      "@s.whatsapp.net"
    )
  );
}


function isLidJid(value) {
  return (
    typeof value === "string" &&
    value.endsWith("@lid")
  );
}


function sameUser(a, b) {
  if (!a || !b) {
    return false;
  }

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

  const match =
    String(value).match(
      /\d{7,15}/
    );

  return match
    ? match[0]
    : "";
}


function jidToPhone(jid) {
  if (!jid || !isPnJid(jid)) {
    return "";
  }

  return cleanPhone(
    jid.split("@")[0]
  );
}


function addUnique(array, value) {
  if (!value) return;

  const item =
    String(value).trim();

  if (
    item &&
    !array.includes(item)
  ) {
    array.push(item);
  }
}


/* =========================================================
   PARTICIPANT ID
========================================================= */

function getParticipantJid(participant) {
  if (!participant) {
    return "";
  }

  if (
    typeof participant === "string"
  ) {
    return normalizeJid(
      participant
    );
  }

  const values = [
    participant.pn,
    participant.phoneJid,
    participant.phoneNumber,
    participant.phone,
    participant.id,
    participant.jid,
    participant.participant,
    participant.lid
  ];

  for (const value of values) {
    if (
      typeof value === "string" &&
      value.includes("@")
    ) {
      return normalizeJid(
        value
      );
    }
  }

  for (const value of values) {
    const phone =
      cleanPhone(value);

    if (phone) {
      return (
        `${phone}@s.whatsapp.net`
      );
    }
  }

  return "";
}


/* =========================================================
   IDENTITY
========================================================= */

function extractUserIdentity(
  input,
  pushName = ""
) {
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


  if (
    typeof input === "string"
  ) {
    const value =
      input.trim();

    if (
      value.endsWith(
        "@s.whatsapp.net"
      )
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


  const jidValues = [
    input.id,
    input.jid,
    input.participant,
    input.pn,
    input.phoneJid,
    input.lid
  ];

  for (
    const value of jidValues
  ) {
    if (
      typeof value !== "string"
    ) {
      continue;
    }

    if (
      value.endsWith(
        "@s.whatsapp.net"
      )
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
  }


  const phone =
    cleanPhone(
      input.phone ||
      input.phoneNumber ||
      ""
    );

  if (phone) {
    identity.phone =
      identity.phone ||
      phone;

    identity.jid =
      identity.jid ||
      `${phone}@s.whatsapp.net`;
  }


  if (
    input.username
  ) {
    identity.username =
      String(
        input.username
      ).trim();
  }


  if (
    input.userName
  ) {
    identity.username =
      String(
        input.userName
      ).trim();
  }


  if (
    input.pushName
  ) {
    identity.pushName =
      String(
        input.pushName
      ).trim();
  }


  if (
    input.notify &&
    !identity.pushName
  ) {
    identity.pushName =
      String(
        input.notify
      ).trim();
  }


  if (
    pushName &&
    !identity.pushName
  ) {
    identity.pushName =
      String(pushName).trim();
  }


  return identity;
}


/* =========================================================
   MERGE IDENTITY
========================================================= */

function mergeIdentity(
  first = {},
  second = {}
) {
  return {
    jid:
      second.jid ||
      first.jid ||
      "",

    lid:
      second.lid ||
      first.lid ||
      "",

    phone:
      second.phone ||
      first.phone ||
      "",

    username:
      second.username ||
      first.username ||
      "",

    pushName:
      second.pushName ||
      first.pushName ||
      ""
  };
}


/* =========================================================
   IDENTITY MATCH
========================================================= */

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
   IDENTITY CACHE
========================================================= */

const userIdentityCache =
  new Map();


function cacheKey(identity) {
  if (!identity) {
    return "";
  }

  return (
    identity.jid ||
    identity.lid ||
    identity.phone ||
    ""
  );
}


function cacheUserIdentity(identity) {
  if (!identity) {
    return;
  }

  const key =
    cacheKey(identity);

  if (!key) {
    return;
  }

  const old =
    userIdentityCache.get(
      key
    ) || {};

  userIdentityCache.set(
    key,
    mergeIdentity(
      old,
      identity
    )
  );
}


function findCachedIdentity(identity) {
  if (!identity) {
    return null;
  }

  for (
    const cached
    of userIdentityCache.values()
  ) {
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
   GROUP METADATA CACHE
========================================================= */

const groupMetadataCache =
  new Map();


async function getGroupMetadata(
  sock,
  groupId
) {
  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    groupMetadataCache.set(
      groupId,
      metadata
    );

    /*
     * Cache every participant identity.
     */
    for (
      const participant
      of metadata?.participants || []
    ) {
      const identity =
        extractUserIdentity(
          participant
        );

      cacheUserIdentity(
        identity
      );
    }

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
   PARTICIPANT IDENTITY
========================================================= */

function participantIdentity(
  participant
) {
  const identity =
    extractUserIdentity(
      participant
    );

  /*
   * Extra PN/phone fields
   */
  const phoneValues = [
    participant?.pn,
    participant?.phoneJid,
    participant?.phoneNumber,
    participant?.phone
  ];

  for (
    const value
    of phoneValues
  ) {
    if (
      typeof value !== "string"
    ) {
      continue;
    }

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

  return identity;
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
  if (!jid) {
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


/* =========================================================
   BOT ADMIN CHECK
========================================================= */

async function isBotAdmin(
  sock,
  groupId
) {
  const botId =
    normalizeJid(
      sock.user?.id || ""
    );

  const botLid =
    normalizeJid(
      sock.user?.lid || ""
    );

  return (
    await isGroupAdmin(
      sock,
      groupId,
      botId
    ) ||
    (
      botLid &&
      await isGroupAdmin(
        sock,
        groupId,
        botLid
      )
    )
  );
}


/* =========================================================
   OWNER
========================================================= */

function isOwner(jid) {
  if (
    !PHONE_NUMBER ||
    !jid
  ) {
    return false;
  }

  const phone =
    jidToPhone(
      normalizeJid(jid)
    );

  return (
    phone === PHONE_NUMBER
  );
}


/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(
  message
) {
  const msg =
    message?.message;

  if (!msg) {
    return "";
  }

  if (
    msg.conversation
  ) {
    return msg.conversation;
  }

  if (
    msg.extendedTextMessage?.text
  ) {
    return (
      msg.extendedTextMessage.text
    );
  }

  if (
    msg.imageMessage?.caption
  ) {
    return (
      msg.imageMessage.caption
    );
  }

  if (
    msg.videoMessage?.caption
  ) {
    return (
      msg.videoMessage.caption
    );
  }

  if (
    msg.documentMessage?.caption
  ) {
    return (
      msg.documentMessage.caption
    );
  }

  return "";
}


/* =========================================================
   COMMAND
========================================================= */

function parseCommand(text) {
  const value =
    String(text || "").trim();

  if (
    !value.startsWith("/")
  ) {
    return {
      command: "",
      args: ""
    };
  }

  const parts =
    value.split(/\s+/);

  const command =
    parts
      .shift()
      .toLowerCase();

  return {
    command,
    args:
      parts.join(" ")
  };
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


function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


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
   DELETE
========================================================= */

async function deleteMessage(
  sock,
  msg
) {
  try {
    await sock.sendMessage(
      msg.key.remoteJid,
      {
        delete: msg.key
      }
    );

    return true;

  } catch (error) {
    console.error(
      "Delete error:",
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
  mentions = []
) {
  try {
    await sock.sendMessage(
      groupId,
      {
        text,
        mentions
      }
    );
  } catch {}
}


/* =========================================================
   BLACKLIST
========================================================= */

function ensureBlacklistGroup(
  groupId
) {
  if (
    !leaveBlacklist.groups[groupId]
  ) {
    leaveBlacklist.groups[groupId] =
      [];
  }

  return (
    leaveBlacklist.groups[groupId]
  );
}


function blacklistMember(
  groupId,
  identity,
  reason
) {
  if (
    !groupId ||
    !identity
  ) {
    return false;
  }

  /*
   * At least one stable identifier required.
   */
  if (
    !identity.jid &&
    !identity.lid &&
    !identity.phone
  ) {
    return false;
  }

  const list =
    ensureBlacklistGroup(
      groupId
    );

  const now =
    new Date().toISOString();

  const index =
    list.findIndex(
      item =>
        identityMatches(
          identity,
          item
        )
    );

  if (index >= 0) {

    list[index] =
      mergeIdentity(
        list[index],
        identity
      );

    list[index].reason =
      reason ||
      list[index].reason ||
      "removed";

    list[index].updatedAt =
      now;

    list[index].permanent =
      true;

  } else {

    list.push({
      ...identity,

      reason:
        reason ||
        "removed",

      createdAt:
        now,

      updatedAt:
        now,

      permanent:
        true
    });
  }

  saveJSON(
    LEAVE_BLACKLIST_FILE,
    leaveBlacklist
  );

  return true;
}


function findBlacklistedMember(
  groupId,
  identity
) {
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
  const list =
    leaveBlacklist.groups[groupId] ||
    [];

  const oldLength =
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
    oldLength !==
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
   REPORT
========================================================= */

function addReport(
  groupId,
  reporter,
  target,
  reason
) {
  if (!reports.groups[groupId]) {
    reports.groups[groupId] =
      [];
  }

  reports.groups[groupId].push({
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
  msg
) {
  const context =
    msg.message
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

function mainMenu() {
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


function commandList() {
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


function adminPanel() {
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
   WELCOME
========================================================= */

function welcomeMessage(
  groupName,
  mention
) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম ${mention}!* ❤️

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


    /*
     * =====================================================
     * MEMBER ADDED / REJOINED
     * =====================================================
     */

    if (
      action === "add"
    ) {

      const metadata =
        await getGroupMetadata(
          sock,
          groupId
        );


      for (
        const participant
        of participants
      ) {

        let identity =
          participantIdentity(
            participant
          );


        /*
         * Try cache
         */
        const cached =
          findCachedIdentity(
            identity
          );

        identity =
          mergeIdentity(
            cached || {},
            identity
          );


        cacheUserIdentity(
          identity
        );


        /*
         * CHECK BLACKLIST
         */
        const blacklisted =
          findBlacklistedMember(
            groupId,
            identity
          );


        if (blacklisted) {

          console.log(
            "================================="
          );

          console.log(
            "BLACKLISTED MEMBER REJOINED"
          );

          console.log(
            "Group:",
            groupId
          );

          console.log(
            "JID:",
            identity.jid || "N/A"
          );

          console.log(
            "LID:",
            identity.lid || "N/A"
          );

          console.log(
            "Phone:",
            identity.phone || "N/A"
          );

          console.log(
            "Reason:",
            blacklisted.reason
          );

          console.log(
            "================================="
          );


          /*
           * Bot must be admin
           */
          if (
            await isBotAdmin(
              sock,
              groupId
            )
          ) {

            /*
             * Prefer JID/PN for remove
             */
            const removeJid =
              identity.jid ||
              getParticipantJid(
                participant
              );


            if (removeJid) {

              try {

                await sock.groupParticipantsUpdate(
                  groupId,
                  [removeJid],
                  "remove"
                );


                await sock.sendMessage(
                  groupId,
                  {
                    text:
                      `🚫 @${jidToPhone(removeJid) || "Member"} blacklist-এর কারণে গ্রুপ থেকে remove করা হয়েছে।\n\n🔒 Admin \`/allowback @user\` না দেওয়া পর্যন্ত পুনরায় থাকতে পারবে না।`,
                    mentions: [
                      removeJid
                    ]
                  }
                );

              } catch (error) {

                console.error(
                  "Blacklist auto-remove error:",
                  error.message
                );
              }
            }

          } else {

            console.log(
              "Bot is not admin. Cannot remove blacklisted member."
            );
          }


          /*
           * Do NOT send welcome to blacklisted user.
           */
          continue;
        }


        /*
         * NORMAL WELCOME
         */
        if (
          isWelcomeEnabled(
            groupId
          )
        ) {

          const groupName =
            metadata?.subject ||
            "আমাদের গ্রুপ";


          const jid =
            identity.jid ||
            identity.lid ||
            getParticipantJid(
              participant
            );


          const phone =
            jidToPhone(
              jid
            );


          const mention =
            phone
              ? `@${phone}`
              : "@Member";


          await sock.sendMessage(
            groupId,
            {
              text:
                welcomeMessage(
                  groupName,
                  mention
                ),
              mentions:
                jid
                  ? [jid]
                  : []
            }
          );
        }
      }


      return;
    }


    /*
     * =====================================================
     * MEMBER REMOVED
     *
     * ADMIN KICK:
     *     BLACKLIST
     *
     * SELF LEAVE:
     *     BLACKLIST
     *
     * BOT REMOVE:
     *     DO NOT CREATE NEW BLACKLIST
     * =====================================================
     */

    if (
      action === "remove"
    ) {

      /*
       * Get bot identities
       */
      const botIdentity =
        extractUserIdentity(
          sock.user?.id
        );

      const botLidIdentity =
        extractUserIdentity(
          sock.user?.lid
        );


      for (
        const participant
        of participants
      ) {

        let identity =
          participantIdentity(
            participant
          );


        /*
         * Cache may contain the
         * PN/LID mapping from before.
         */
        const cached =
          findCachedIdentity(
            identity
          );


        identity =
          mergeIdentity(
            cached || {},
            identity
          );


        cacheUserIdentity(
          identity
        );


        /*
         * -----------------------------------------------
         * Detect BOT as remover
         * -----------------------------------------------
         */

        const botRemoved =
          identityMatches(
            extractUserIdentity(
              author
            ),
            botIdentity
          ) ||
          identityMatches(
            extractUserIdentity(
              authorPn
            ),
            botIdentity
          ) ||
          identityMatches(
            extractUserIdentity(
              authorLid
            ),
            botIdentity
          ) ||
          identityMatches(
            extractUserIdentity(
              author
            ),
            botLidIdentity
          ) ||
          identityMatches(
            extractUserIdentity(
              authorPn
            ),
            botLidIdentity
          ) ||
          identityMatches(
            extractUserIdentity(
              authorLid
            ),
            botLidIdentity
          );


        /*
         * If bot removed them,
         * do not add a new blacklist record.
         */
        if (botRemoved) {

          console.log(
            "Bot removed blacklisted member."
          );

          continue;
        }


        /*
         * -----------------------------------------------
         * Detect SELF LEAVE
         * -----------------------------------------------
         */

        const authorIdentity =
          mergeIdentity(
            extractUserIdentity(
              author
            ),
            extractUserIdentity(
              authorPn
            )
          );


        const completeAuthor =
          mergeIdentity(
            authorIdentity,
            extractUserIdentity(
              authorLid
            )
          );


        const selfLeave =
          identityMatches(
            identity,
            completeAuthor
          );


        const reason =
          selfLeave
            ? "self_leave"
            : "admin_kick";


        /*
         * -----------------------------------------------
         * BLACKLIST
         * -----------------------------------------------
         */

        const saved =
          blacklistMember(
            groupId,
            identity,
            reason
          );


        if (saved) {

          console.log(
            "================================="
          );

          console.log(
            "BLACKLIST ADDED"
          );

          console.log(
            "Group:",
            groupId
          );

          console.log(
            "JID:",
            identity.jid || "N/A"
          );

          console.log(
            "LID:",
            identity.lid || "N/A"
          );

          console.log(
            "Phone:",
            identity.phone || "N/A"
          );

          console.log(
            "Username:",
            identity.username || "N/A"
          );

          console.log(
            "Push Name:",
            identity.pushName || "N/A"
          );

          console.log(
            "Reason:",
            reason
          );

          console.log(
            "Permanent: YES"
          );

          console.log(
            "================================="
          );

        } else {

          console.log(
            "BLACKLIST FAILED: No stable ID."
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
   OPENAI TEXT MODERATION
========================================================= */

async function moderateTextWithOpenAI(
  text
) {
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

          body:
            JSON.stringify({
              model:
                "omni-moderation-latest",

              input:
                text
            })
        }
      );


    if (!response.ok) {
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
      "OpenAI text error:",
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
  msg
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
        msg,
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
      ).toString(
        "base64"
      );


    const mimetype =
      msg.message
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

          body:
            JSON.stringify({
              model:
                "omni-moderation-latest",

              input: [
                {
                  type:
                    "image_url",

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
      "OpenAI image error:",
      error.message
    );

    return {
      flagged: false
    };
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


    const text =
      getMessageText(msg);


    /*
     * Bad words
     */
    if (
      text &&
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


    /*
     * AI text moderation
     */
    if (
      text &&
      OPENAI_API_KEY &&
      TEXT_MODERATION_ENABLED
    ) {

      const result =
        await moderateTextWithOpenAI(
          text
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
          `⚠️ @${jidToPhone(senderJid) || "Member"}-এর মেসেজটি group moderation policy-এর কারণে remove করা হয়েছে।`,
          [senderJid]
        );


        return true;
      }
    }


    /*
     * Image moderation
     */
    if (
      msg.message?.imageMessage &&
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
  if (!text) {
    return false;
  }

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

  if (
    !containsLink(text)
  ) {
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
    `🚫 @${jidToPhone(senderJid) || "Member"} গ্রুপে অনুমতি ছাড়া link দেওয়া যাবে না।`,
    [senderJid]
  );


  return true;
}


/* =========================================================
   DUPLICATE SPAM
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
    duplicateCache.get(
      key
    );


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


  return (
    now - old.time <
      5 * 60 * 1000 &&
    old.text ===
      normalized
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


  /* =======================================================
     MENU
  ======================================================= */

  if (
    command === "/menu" ||
    command === "/bot"
  ) {

    await sock.sendMessage(
      groupId,
      {
        text:
          mainMenu()
      }
    );

    return true;
  }


  /* =======================================================
     RULES
  ======================================================= */

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


  /* =======================================================
     ADMIN
  ======================================================= */

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
      `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;


    const mentions = [];


    admins.forEach(
      (p, index) => {

        const jid =
          getParticipantJid(p);

        if (jid) {
          mentions.push(jid);

          output +=
            `${index + 1}️⃣ @${jidToPhone(jid) || "Admin"}\n`;
        }
      }
    );


    await sock.sendMessage(
      groupId,
      {
        text:
          output,
        mentions
      }
    );

    return true;
  }


  /* =======================================================
     MEMBERS
  ======================================================= */

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


  /* =======================================================
     GROUP INFO
  ======================================================= */

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

📌 Name:
${metadata?.subject || "Unknown"}

👥 Members:
${metadata?.participants?.length || 0}

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


  /* =======================================================
     ID
  ======================================================= */

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


  /* =======================================================
     PING
  ======================================================= */

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


  /* =======================================================
     DEAL
  ======================================================= */

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

⚠️ Deal করার আগে নিজ দায়িত্বে
verify করে নিন।

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  /* =======================================================
     PIYAS
  ======================================================= */

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


  /* =======================================================
     WEBSITE
  ======================================================= */

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


  /* =======================================================
     REPORT
  ======================================================= */

  if (
    command === "/report"
  ) {

    const target =
      getMentionTarget(msg);


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


    addReport(
      groupId,
      senderJid,
      target,
      args ||
        "No reason provided"
    );


    await sock.sendMessage(
      groupId,
      {
        text:
          `✅ Report received.\n\n👤 Target: @${jidToPhone(target) || "Member"}\n📝 Reason: ${args || "No reason provided"}`,

        mentions: [
          target
        ]
      }
    );

    return true;
  }


  /* =======================================================
     REPORTS
  ======================================================= */

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
      `
╭━━━━━━━━━━━━━━━━━━━━╮
       🛡️ *REPORTS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;


    const mentions = [];


    latest.forEach(
      (report, index) => {

        output +=
          `${index + 1}️⃣ Target: @${jidToPhone(report.target) || "Member"}\n`;

        output +=
          `📝 ${report.reason}\n`;

        output +=
          `⏰ ${report.time}\n\n`;


        if (report.target) {
          mentions.push(
            report.target
          );
        }
      }
    );


    await sock.sendMessage(
      groupId,
      {
        text:
          output,
        mentions
      }
    );

    return true;
  }


  /* =======================================================
     ADMIN PANEL
  ======================================================= */

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
          adminPanel()
      }
    );

    return true;
  }


  /* =======================================================
     COMMAND LIST
  ======================================================= */

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
          commandList()
      }
    );

    return true;
  }


  /* =======================================================
     BOT ON
  ======================================================= */

  if (
    command === "/on" ||
    command === "/boton" ||
    command === "/onbot"
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


  /* =======================================================
     BOT OFF
  ======================================================= */

  if (
    command === "/off" ||
    command === "/botoff" ||
    command === "/offbot"
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


  /* =======================================================
     FULL STATUS
  ======================================================= */

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
🟢 ACTIVE

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`.trim()
      }
    );

    return true;
  }


  /* =======================================================
     WELCOME ON
  ======================================================= */

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


  /* =======================================================
     WELCOME OFF
  ======================================================= */

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


  /* =======================================================
     ALLOW BACK / UNLEAVE
  ======================================================= */

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
      getMentionTarget(msg);


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


    let identity =
      extractUserIdentity(
        target
      );


    const cached =
      findCachedIdentity(
        identity
      );


    identity =
      mergeIdentity(
        cached || {},
        identity
      );


    const removed =
      removeLeaveBlacklist(
        groupId,
        identity
      );


    if (removed) {

      await sock.sendMessage(
        groupId,
        {
          text:
            `✅ @${jidToPhone(target) || "Member"}-কে blacklist থেকে remove করা হয়েছে। এখন আবার গ্রুপে থাকতে পারবে।`,

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
   INCOMING MESSAGE
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
     * Group only
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
     * Cache sender identity
     */
    cacheUserIdentity(
      extractUserIdentity(
        senderJid,
        msg.pushName || ""
      )
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
     * Parse command
     */
    const {
      command
    } =
      parseCommand(text);


    /*
     * Admin commands work even when
     * bot is OFF.
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
     * BOT OFF
     */
    if (
      !isBotEnabled(groupId) &&
      !adminCommand
    ) {
      return;
    }


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

        auth:
          state,

        logger,

        printQRInTerminal:
          false,

        markOnlineOnConnect:
          false,

        generateHighQualityLinkPreview:
          false
      });


    /* =====================================================
       CREDENTIALS
    ===================================================== */

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    /* =====================================================
       CONNECTION
    ===================================================== */

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
            `BOT ID: ${sock.user?.id || "Unknown"}`
          );

          console.log(
            `BOT LID: ${sock.user?.lid || "Unknown"}`
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
              lastDisconnect?.error
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
              "Logged out. Login again."
            );
          }
        }
      }
    );


    /* =====================================================
       PARTICIPANT UPDATE
    ===================================================== */

    sock.ev.on(
      "group-participants.update",
      async update => {

        await handleParticipantUpdate(
          sock,
          update
        );

      }
    );


    /* =====================================================
       MESSAGES
    ===================================================== */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        for (
          const msg
          of messages
        ) {

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

      reconnecting =
        true;


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
   SHUTDOWN
========================================================= */

process.on(
  "SIGINT",
  () => {
    console.log(
      "Shutting down..."
    );

    process.exit(0);
  }
);


process.on(
  "SIGTERM",
  () => {
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