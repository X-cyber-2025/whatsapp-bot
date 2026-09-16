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
  process.env.PHONE_NUMBER || "";

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
    .map((x) => x.trim())
    .filter(Boolean);

const AUTH_DIR =
  "auth_info_baileys";

const STATUS_FILE =
  "bot_status.json";

const LEAVE_BLACKLIST_FILE =
  "leave_blacklist.json";

const REPORT_FILE =
  "reports.json";

const logger = pino({
  level: "silent"
});

/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type":
      "text/plain; charset=utf-8"
  });

  res.end("PIYAS BOT is running");
});

server.listen(PORT, () => {
  console.log(
    `HTTP server running on port ${PORT}`
  );
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

    const data =
      fs.readFileSync(
        file,
        "utf8"
      );

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);
  } catch (error) {
    console.log(
      `Failed to load ${file}:`,
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
    console.log(
      `Failed to save ${file}:`,
      error.message
    );
  }
}

/* =========================================================
   DATABASE
========================================================= */

let botStatus =
  loadJSON(
    STATUS_FILE,
    {}
  );

let leaveBlacklist =
  loadJSON(
    LEAVE_BLACKLIST_FILE,
    {}
  );

let reports =
  loadJSON(
    REPORT_FILE,
    {}
  );

/* =========================================================
   BOT STATUS
========================================================= */

function getGroupStatus(groupId) {
  if (!botStatus[groupId]) {
    botStatus[groupId] = {
      enabled: true,
      welcome: true
    };

    saveJSON(
      STATUS_FILE,
      botStatus
    );
  }

  return botStatus[groupId];
}

function isBotEnabled(groupId) {
  return (
    getGroupStatus(groupId)
      .enabled !== false
  );
}

function isWelcomeEnabled(groupId) {
  return (
    getGroupStatus(groupId)
      .welcome !== false
  );
}

function setBotEnabled(
  groupId,
  value
) {
  getGroupStatus(
    groupId
  ).enabled = value;

  saveJSON(
    STATUS_FILE,
    botStatus
  );
}

function setWelcomeEnabled(
  groupId,
  value
) {
  getGroupStatus(
    groupId
  ).welcome = value;

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
   IDENTITY HELPERS
========================================================= */

function normalizeJid(jid) {
  if (!jid || typeof jid !== "string") {
    return "";
  }

  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

function sameUser(a, b) {
  if (!a || !b) {
    return false;
  }

  try {
    return areJidsSameUser(
      a,
      b
    );
  } catch {
    return (
      normalizeJid(a) ===
      normalizeJid(b)
    );
  }
}

function cleanPhone(value) {
  if (!value) {
    return "";
  }

  let phone =
    String(value);

  if (phone.includes("@")) {
    phone =
      phone.split("@")[0];
  }

  return phone.replace(
    /\D/g,
    ""
  );
}

function jidToPhone(jid) {
  if (!jid) {
    return "";
  }

  const value =
    String(jid);

  if (
    value.includes(
      "@s.whatsapp.net"
    )
  ) {
    return cleanPhone(
      value
    );
  }

  return "";
}

function addUnique(
  array,
  value
) {
  if (!value) {
    return;
  }

  const item =
    String(value).trim();

  if (!item) {
    return;
  }

  if (!array.includes(item)) {
    array.push(item);
  }
}

function getParticipantJid(
  participant
) {
  if (!participant) {
    return "";
  }

  if (
    typeof participant ===
    "string"
  ) {
    return participant;
  }

  return (
    participant.id ||
    participant.jid ||
    participant.lid ||
    participant.phone ||
    participant.pn ||
    ""
  );
}

function extractUserIdentity(
  input,
  pushName = ""
) {
  const identity = {
    jid: "",
    lid: "",
    phone: "",
    username: "",
    pushName: "",
    aliases: []
  };

  if (
    typeof input ===
    "string"
  ) {
    identity.jid = input;
  } else if (
    input &&
    typeof input === "object"
  ) {
    identity.jid =
      input.id ||
      input.jid ||
      input.participant ||
      input.phone ||
      "";

    identity.lid =
      input.lid || "";

    identity.phone =
      input.phone ||
      input.pn ||
      input.phoneNumber ||
      "";

    identity.username =
      input.username ||
      input.user ||
      input.notify ||
      "";

    identity.pushName =
      input.pushName ||
      input.name ||
      "";
  }

  if (pushName) {
    identity.pushName =
      pushName;
  }

  identity.jid =
    normalizeJid(
      identity.jid
    );

  identity.lid =
    String(
      identity.lid || ""
    ).trim();

  identity.phone =
    cleanPhone(
      identity.phone ||
      jidToPhone(
        identity.jid
      )
    );

  identity.username =
    String(
      identity.username || ""
    )
      .trim()
      .replace(
        /^@/,
        ""
      );

  identity.pushName =
    String(
      identity.pushName || ""
    ).trim();

  addUnique(
    identity.aliases,
    identity.jid
  );

  addUnique(
    identity.aliases,
    identity.lid
  );

  if (identity.phone) {
    addUnique(
      identity.aliases,
      identity.phone
    );

    addUnique(
      identity.aliases,
      `${identity.phone}@s.whatsapp.net`
    );
  }

  if (identity.username) {
    addUnique(
      identity.aliases,
      identity.username
    );

    addUnique(
      identity.aliases,
      `@${identity.username}`
    );
  }

  return identity;
}

function mergeIdentity(
  oldIdentity,
  newIdentity
) {
  const merged = {
    jid:
      oldIdentity?.jid || "",
    lid:
      oldIdentity?.lid || "",
    phone:
      oldIdentity?.phone || "",
    username:
      oldIdentity?.username || "",
    pushName:
      oldIdentity?.pushName || "",
    aliases:
      Array.isArray(
        oldIdentity?.aliases
      )
        ? [
            ...oldIdentity.aliases
          ]
        : []
  };

  if (newIdentity?.jid) {
    merged.jid =
      newIdentity.jid;
  }

  if (newIdentity?.lid) {
    merged.lid =
      newIdentity.lid;
  }

  if (newIdentity?.phone) {
    merged.phone =
      newIdentity.phone;
  }

  if (newIdentity?.username) {
    merged.username =
      newIdentity.username;
  }

  if (newIdentity?.pushName) {
    merged.pushName =
      newIdentity.pushName;
  }

  for (
    const alias of
    newIdentity?.aliases || []
  ) {
    addUnique(
      merged.aliases,
      alias
    );
  }

  return merged;
}

function identityMatches(
  identity,
  target
) {
  if (
    !identity ||
    !target
  ) {
    return false;
  }

  const a =
    extractUserIdentity(
      identity
    );

  const b =
    extractUserIdentity(
      target
    );

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
    a.lid === b.lid
  ) {
    return true;
  }

  if (
    a.phone &&
    b.phone &&
    a.phone === b.phone
  ) {
    return true;
  }

  if (
    a.username &&
    b.username &&
    a.username.toLowerCase() ===
      b.username.toLowerCase()
  ) {
    return true;
  }

  const aAliases =
    new Set(
      a.aliases || []
    );

  const bAliases =
    new Set(
      b.aliases || []
    );

  for (
    const alias of aAliases
  ) {
    if (
      bAliases.has(alias)
    ) {
      return true;
    }
  }

  return false;
}

/* =========================================================
   IDENTITY CACHE
========================================================= */

const userIdentityCache =
  {};

function cacheUserIdentity(
  input,
  pushName = ""
) {
  const identity =
    extractUserIdentity(
      input,
      pushName
    );

  if (
    !identity.jid &&
    !identity.lid &&
    !identity.phone
  ) {
    return;
  }

  const key =
    identity.jid ||
    identity.lid ||
    identity.phone;

  if (!key) {
    return;
  }

  userIdentityCache[key] =
    mergeIdentity(
      userIdentityCache[key] ||
        {},
      identity
    );
}

function findCachedIdentity(
  input
) {
  const identity =
    extractUserIdentity(
      input
    );

  const directKey =
    identity.jid ||
    identity.lid ||
    identity.phone;

  if (
    directKey &&
    userIdentityCache[
      directKey
    ]
  ) {
    return userIdentityCache[
      directKey
    ];
  }

  for (
    const cached of
    Object.values(
      userIdentityCache
    )
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
   TEXT HELPERS
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(
      /[^\p{L}\p{N}\s@/.-]/gu,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

const BAD_WORDS = [
  "সালা",
  "শালা",
  "সালার",
  "শালার",
  "খানকি",
  "খানকির",
  "খানকী",
  "বাঞ্চোদ",
  "বাল",
  "চোদা",
  "চোদন",
  "চুদা",
  "চুদির",
  "মাদারচোদ",
  "হারামি",
  "হারামজাদা",
  "কুত্তারবাচ্চা",
  "fuck",
  "fucking",
  "motherfucker",
  "bitch",
  "asshole",
  "slut",
  "whore"
];

function containsBadWord(
  text
) {
  const normalized =
    normalizeText(text);

  return BAD_WORDS.some(
    (word) =>
      normalized.includes(
        normalizeText(word)
      )
  );
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(
  message
) {
  if (!message?.message) {
    return "";
  }

  const content =
    message.message;

  if (
    content.conversation
  ) {
    return content.conversation;
  }

  if (
    content.extendedTextMessage
      ?.text
  ) {
    return content
      .extendedTextMessage
      .text;
  }

  if (
    content.imageMessage
      ?.caption
  ) {
    return content
      .imageMessage
      .caption;
  }

  if (
    content.videoMessage
      ?.caption
  ) {
    return content
      .videoMessage
      .caption;
  }

  return "";
}

/* =========================================================
   COMMAND PARSER
========================================================= */

function parseCommand(text) {
  const value =
    String(text || "")
      .trim();

  if (
    !value.startsWith("/")
  ) {
    return null;
  }

  const parts =
    value.split(/\s+/);

  const command =
    parts[0]
      .toLowerCase()
      .replace(
        /^\//,
        ""
      );

  return {
    command,
    args: parts.slice(1),
    raw: value
  };
}

/* =========================================================
   GROUP METADATA
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

    return metadata;
  } catch (error) {
    console.log(
      "Group metadata error:",
      error.message
    );

    return null;
  }
}

/* =========================================================
   ADMIN
========================================================= */

function isParticipantAdmin(
  metadata,
  participantId
) {
  if (
    !metadata?.participants ||
    !participantId
  ) {
    return false;
  }

  const target =
    normalizeJid(
      participantId
    );

  const participant =
    metadata.participants.find(
      (p) => {
        const jid =
          getParticipantJid(
            p
          );

        return (
          sameUser(
            jid,
            target
          ) ||
          normalizeJid(jid) ===
            target ||
          p.lid ===
            participantId
        );
      }
    );

  if (!participant) {
    return false;
  }

  return (
    participant.admin ===
      "admin" ||
    participant.admin ===
      "superadmin"
  );
}

function isGroupOwner(
  metadata,
  participantId
) {
  if (
    !metadata?.owner ||
    !participantId
  ) {
    return false;
  }

  return sameUser(
    metadata.owner,
    participantId
  );
}

async function isAdmin(
  sock,
  groupId,
  sender
) {
  const metadata =
    await getGroupMetadata(
      sock,
      groupId
    );

  if (!metadata) {
    return false;
  }

  return (
    isParticipantAdmin(
      metadata,
      sender
    ) ||
    isGroupOwner(
      metadata,
      sender
    )
  );
}

async function isBotAdmin(
  sock,
  groupId
) {
  const metadata =
    await getGroupMetadata(
      sock,
      groupId
    );

  if (!metadata) {
    return false;
  }

  return isParticipantAdmin(
    metadata,
    normalizeJid(
      sock.user?.id
    )
  );
}

function isOwner(sender) {
  const senderPhone =
    cleanPhone(
      sender
    );

  const ownerPhone =
    cleanPhone(
      PHONE_NUMBER
    );

  if (
    !senderPhone ||
    !ownerPhone
  ) {
    return false;
  }

  return (
    senderPhone ===
    ownerPhone
  );
}

/* =========================================================
   MESSAGE DELETE
========================================================= */

async function deleteMessage(
  sock,
  jid,
  message
) {
  try {
    await sock.sendMessage(
      jid,
      {
        delete:
          message.key
      }
    );

    return true;
  } catch (error) {
    console.log(
      "Delete error:",
      error.message
    );

    return false;
  }
}

async function sendWarning(
  sock,
  jid,
  text
) {
  try {
    await sock.sendMessage(
      jid,
      { text }
    );
  } catch (error) {
    console.log(
      "Warning error:",
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
    !TEXT_MODERATION_ENABLED
  ) {
    return {
      flagged: false,
      unavailable: true
    };
  }

  if (!text?.trim()) {
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
      return {
        flagged: false,
        unavailable: true
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
        result?.categories ||
        {},
      scores:
        result?.category_scores ||
        {}
    };
  } catch (error) {
    console.log(
      "OpenAI text error:",
      error.message
    );

    return {
      flagged: false,
      unavailable: true
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
      flagged: false,
      unavailable: true
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
        flagged: false,
        unavailable: true
      };
    }

    const base64 =
      buffer.toString(
        "base64"
      );

    const mimeType =
      message?.message
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
                type:
                  "image_url",
                image_url: {
                  url:
                    `data:${mimeType};base64,${base64}`
                }
              }
            ]
          })
        }
      );

    if (!response.ok) {
      return {
        flagged: false,
        unavailable: true
      };
    }

    const data =
      await response.json();

    const result =
      data?.results?.[0];

    const sexualScore =
      Number(
        result
          ?.category_scores
          ?.sexual || 0
      );

    const minorsScore =
      Number(
        result
          ?.category_scores
          ?.["sexual/minors"] ||
          0
      );

    return {
      flagged:
        minorsScore > 0 ||
        sexualScore >=
          IMAGE_SEXUAL_SCORE_THRESHOLD,
      sexualScore,
      minorsScore,
      categories:
        result?.categories ||
        {},
      scores:
        result?.category_scores ||
        {}
    };
  } catch (error) {
    console.log(
      "OpenAI image error:",
      error.message
    );

    return {
      flagged: false,
      unavailable: true
    };
  }
}

/* =========================================================
   BLACKLIST
========================================================= */

function ensureLeaveGroup(
  groupId
) {
  if (
    !leaveBlacklist[groupId]
  ) {
    leaveBlacklist[groupId] =
      [];
  }

  return leaveBlacklist[
    groupId
  ];
}

function blacklistMember(
  groupId,
  identity,
  reason
) {
  const list =
    ensureLeaveGroup(
      groupId
    );

  const cleanIdentity =
    extractUserIdentity(
      identity
    );

  if (
    !cleanIdentity.jid &&
    !cleanIdentity.lid &&
    !cleanIdentity.phone &&
    !cleanIdentity.username
  ) {
    return false;
  }

  const index =
    list.findIndex(
      (entry) =>
        identityMatches(
          entry.identity,
          cleanIdentity
        )
    );

  if (index >= 0) {
    list[index].identity =
      mergeIdentity(
        list[index].identity,
        cleanIdentity
      );

    list[index].reason =
      reason;

    list[index].updatedAt =
      new Date().toISOString();
  } else {
    list.push({
      identity:
        cleanIdentity,
      reason,
      createdAt:
        new Date().toISOString(),
      updatedAt:
        new Date().toISOString()
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
  const list =
    leaveBlacklist[
      groupId
    ] || [];

  return list.some(
    (entry) =>
      identityMatches(
        entry.identity,
        identity
      )
  );
}

function removeLeaveBlacklist(
  groupId,
  identity
) {
  const list =
    leaveBlacklist[
      groupId
    ] || [];

  const before =
    list.length;

  leaveBlacklist[groupId] =
    list.filter(
      (entry) =>
        !identityMatches(
          entry.identity,
          identity
        )
    );

  if (
    leaveBlacklist[groupId]
      .length !== before
  ) {
    saveJSON(
      LEAVE_BLACKLIST_FILE,
      leaveBlacklist
    );

    return true;
  }

  return false;
}

/* =========================================================
   REPORTS
========================================================= */

function addReport(
  groupId,
  report
) {
  if (!reports[groupId]) {
    reports[groupId] = [];
  }

  reports[groupId].push({
    ...report,
    createdAt:
      new Date().toISOString()
  });

  saveJSON(
    REPORT_FILE,
    reports
  );
}

function getReports(
  groupId
) {
  return (
    reports[groupId] ||
    []
  );
}

/* =========================================================
   MENTION
========================================================= */

function getMentionedTarget(
  message
) {
  const context =
    message?.message
      ?.extendedTextMessage
      ?.contextInfo ||
    message?.message
      ?.imageMessage
      ?.contextInfo ||
    message?.message
      ?.videoMessage
      ?.contextInfo;

  const mentions =
    context?.mentionedJid ||
    [];

  return mentions[0] || "";
}

/* =========================================================
   /BOT MENU
========================================================= */

function getBotMenu() {
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
`;
}

/* =========================================================
   /CMDLIST
========================================================= */

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
`;
}

/* =========================================================
   /ADMINPANEL
========================================================= */

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
`;
}

/* =========================================================
   RULES
========================================================= */

function getRules() {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
       📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করে কথা বলুন।

2️⃣ অশ্লীল বা গালাগালি করা যাবে না।

3️⃣ 18+ / Sexual ছবি বা ভিডিও শেয়ার করা যাবে না।

4️⃣ Spam বা একই মেসেজ বারবার পাঠানো যাবে না।

5️⃣ অনুমতি ছাড়া কোনো Link প্রচার করা যাবে না।

6️⃣ প্রতারণা বা সন্দেহজনক কার্যক্রম থেকে বিরত থাকুন।

7️⃣ Group Admin-এর নির্দেশনা মেনে চলুন।

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`;
}

/* =========================================================
   WELCOME
========================================================= */

function getWelcomeMessage(
  groupName,
  userJid
) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম @${String(
    userJid
  ).split("@")[0]}!* ❤️

🌸 আপনাকে *${groupName}*
গ্রুপে স্বাগতম।

📜 গ্রুপের নিয়ম জানতে লিখুন:

/rules

🤖 Bot Commands দেখতে লিখুন:

/bot

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`;
}

/* =========================================================
   PARTICIPANT UPDATE
========================================================= */

async function handleParticipantUpdate(
  sock,
  update
) {
  const {
    id: groupId,
    participants,
    action,
    author,
    authorPn
  } = update;

  if (
    !groupId ||
    !isAllowedGroup(
      groupId
    )
  ) {
    return;
  }

  const metadata =
    await getGroupMetadata(
      sock,
      groupId
    );

  if (!metadata) {
    return;
  }

  for (
    const participant of
    participants || []
  ) {
    const participantJid =
      getParticipantJid(
        participant
      );

    const participantIdentity =
      extractUserIdentity(
        participant
      );

    const authorIdentity =
      extractUserIdentity(
        author ||
          authorPn ||
          ""
      );

    cacheUserIdentity(
      participantIdentity
    );

    cacheUserIdentity(
      authorIdentity
    );

    /* ================================================
       MEMBER ADD
    ================================================= */

    if (
      action === "add"
    ) {
      const cached =
        findCachedIdentity(
          participantIdentity
        );

      const finalIdentity =
        mergeIdentity(
          cached || {},
          participantIdentity
        );

      if (
        isLeaveBlacklisted(
          groupId,
          finalIdentity
        )
      ) {
        const botAdmin =
          await isBotAdmin(
            sock,
            groupId
          );

        if (
          botAdmin &&
          participantJid
        ) {
          try {
            await sock.groupParticipantsUpdate(
              groupId,
              [participantJid],
              "remove"
            );

            console.log(
              `Removed blacklisted member: ${participantJid}`
            );
          } catch (error) {
            console.log(
              "Blacklist removal error:",
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
          metadata.subject ||
          "এই গ্রুপ";

        try {
          await sock.sendMessage(
            groupId,
            {
              text:
                getWelcomeMessage(
                  groupName,
                  participantJid
                ),
              mentions: [
                participantJid
              ]
            }
          );
        } catch (error) {
          console.log(
            "Welcome error:",
            error.message
          );
        }
      }
    }

    /* ================================================
       MEMBER REMOVE
    ================================================= */

    if (
      action === "remove"
    ) {
      const cached =
        findCachedIdentity(
          participantIdentity
        );

      const finalIdentity =
        mergeIdentity(
          cached || {},
          participantIdentity
        );

      /*
       * Only self-leave is blacklisted.
       * Admin/other removal is NOT blacklisted.
       */

      const selfLeave =
        Boolean(author) &&
        Boolean(participantJid) &&
        sameUser(
          author,
          participantJid
        );

      if (selfLeave) {
        blacklistMember(
          groupId,
          finalIdentity,
          "self_leave"
        );

        console.log(
          `Self-leaver blacklisted: ${participantJid}`
        );
      }
    }
  }
}

/* =========================================================
   MODERATION
========================================================= */

async function moderateMessage(
  sock,
  groupId,
  message,
  sender
) {
  if (
    !isAllowedGroup(
      groupId
    )
  ) {
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

  const admin =
    isParticipantAdmin(
      metadata,
      sender
    );

  const owner =
    isGroupOwner(
      metadata,
      sender
    );

  const botOwner =
    isOwner(sender);

  if (
    admin ||
    owner ||
    botOwner
  ) {
    return false;
  }

  const text =
    getMessageText(
      message
    );

  /* BAD WORDS */

  if (
    text &&
    containsBadWord(
      text
    )
  ) {
    const deleted =
      await deleteMessage(
        sock,
        groupId,
        message
      );

    if (deleted) {
      await sendWarning(
        sock,
        groupId,
        "⚠️ অশ্লীল/গালাগালির ভাষা ব্যবহার করা যাবে না।"
      );
    }

    return true;
  }

  /* AI TEXT */

  if (
    text &&
    TEXT_MODERATION_ENABLED &&
    OPENAI_API_KEY
  ) {
    const result =
      await moderateTextWithOpenAI(
        text
      );

    if (
      result.flagged
    ) {
      const deleted =
        await deleteMessage(
          sock,
          groupId,
          message
        );

      if (deleted) {
        await sendWarning(
          sock,
          groupId,
          "⚠️ এই মেসেজটি Group Policy অনুযায়ী অনুমোদিত নয়।"
        );
      }

      return true;
    }
  }

  /* IMAGE */

  const imageMessage =
    message?.message
      ?.imageMessage;

  if (
    imageMessage &&
    IMAGE_MODERATION_ENABLED &&
    OPENAI_API_KEY
  ) {
    const result =
      await moderateImageWithOpenAI(
        sock,
        message
      );

    if (
      result.flagged
    ) {
      const deleted =
        await deleteMessage(
          sock,
          groupId,
          message
        );

      if (deleted) {
        await sendWarning(
          sock,
          groupId,
          "⚠️ 18+ / Sexual content এই গ্রুপে অনুমোদিত নয়।"
        );
      }

      return true;
    }
  }

  return false;
}

/* =========================================================
   LINK PROTECTION
========================================================= */

function containsLink(
  text
) {
  if (!text) {
    return false;
  }

  return /(https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/)/i.test(
    text
  );
}

async function handleLinkProtection(
  sock,
  groupId,
  message,
  sender
) {
  const text =
    getMessageText(
      message
    );

  if (
    !containsLink(text)
  ) {
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

  const admin =
    isParticipantAdmin(
      metadata,
      sender
    );

  const owner =
    isGroupOwner(
      metadata,
      sender
    );

  const botOwner =
    isOwner(sender);

  if (
    admin ||
    owner ||
    botOwner
  ) {
    return false;
  }

  const deleted =
    await deleteMessage(
      sock,
      groupId,
      message
    );

  if (deleted) {
    await sendWarning(
      sock,
      groupId,
      "🔗 অনুমতি ছাড়া Link শেয়ার করা যাবে না।"
    );
  }

  return deleted;
}

/* =========================================================
   DUPLICATE SPAM
========================================================= */

const recentMessages =
  new Map();

function isDuplicateSpam(
  sender,
  text
) {
  if (
    !sender ||
    !text
  ) {
    return false;
  }

  const normalized =
    normalizeText(
      text
    );

  if (!normalized) {
    return false;
  }

  const key =
    `${sender}:${normalized}`;

  const now =
    Date.now();

  const previous =
    recentMessages.get(
      key
    );

  recentMessages.set(
    key,
    now
  );

  if (!previous) {
    return false;
  }

  return (
    now - previous <=
    5 * 60 * 1000
  );
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(
  sock,
  message,
  groupId,
  sender,
  commandData
) {
  const {
    command,
    args
  } = commandData;

  const admin =
    await isAdmin(
      sock,
      groupId,
      sender
    );

  const owner =
    isOwner(sender);

  /* ======================================================
     BOT MENU
  ====================================================== */

  if (
    command === "bot" ||
    command === "menu"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          getBotMenu()
      }
    );

    return true;
  }

  /* ======================================================
     RULES
  ====================================================== */

  if (
    command === "rules"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          getRules()
      }
    );

    return true;
  }

  /* ======================================================
     PING
  ====================================================== */

  if (
    command === "ping"
  ) {
    const start =
      Date.now();

    await sock.sendMessage(
      groupId,
      {
        text:
          "🏓 Pong!"
      }
    );

    const speed =
      Date.now() -
      start;

    await sock.sendMessage(
      groupId,
      {
        text:
          `⚡ Bot Response: ${speed}ms`
      }
    );

    return true;
  }

  /* ======================================================
     ADMIN LIST
  ====================================================== */

  if (
    command === "admin"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    if (!metadata) {
      return true;
    }

    const admins =
      metadata.participants.filter(
        (p) =>
          p.admin ===
            "admin" ||
          p.admin ===
            "superadmin"
      );

    let text =
      `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;

    if (!admins.length) {
      text +=
        "কোনো Admin পাওয়া যায়নি।";
    } else {
      admins.forEach(
        (p, index) => {
          const jid =
            getParticipantJid(
              p
            );

          text +=
            `${index + 1}️⃣ @${jid.split("@")[0]}\n`;
        }
      );
    }

    await sock.sendMessage(
      groupId,
      {
        text,
        mentions:
          admins
            .map(
              (p) =>
                getParticipantJid(
                  p
                )
            )
            .filter(Boolean)
      }
    );

    return true;
  }

  /* ======================================================
     MEMBERS
  ====================================================== */

  if (
    command === "members"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    if (!metadata) {
      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       👥 *MEMBERS*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 Total Members:
${metadata.participants.length}

❤️ *PIYAS BOT*
`
      }
    );

    return true;
  }

  /* ======================================================
     GROUP INFO
  ====================================================== */

  if (
    command === "groupinfo"
  ) {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    if (!metadata) {
      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       👥 *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Name:
${metadata.subject || "Unknown"}

👥 Members:
${metadata.participants?.length || 0}

🆔 Group ID:
${groupId}

🤖 Bot:
${
  isBotEnabled(groupId)
    ? "🟢 ON"
    : "🔴 OFF"
}

👋 Welcome:
${
  isWelcomeEnabled(groupId)
    ? "🟢 ON"
    : "🔴 OFF"
}

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`
      }
    );

    return true;
  }

  /* ======================================================
     ID
  ====================================================== */

  if (
    command === "id"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🆔 *GROUP ID*\n\n${groupId}`
      }
    );

    return true;
  }

  /* ======================================================
     DEAL
  ====================================================== */

  if (
    command === "deal" ||
    command === "ডিল"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
        💰 *DEAL*
╰━━━━━━━━━━━━━━━━━━━━╯

🔥 Buy / Sell করতে যোগাযোগ করুন।

📩 প্রয়োজনীয় তথ্যসহ Admin-এর সাথে যোগাযোগ করুন।

❤️ *PIYAS*
`
      }
    );

    return true;
  }

  /* ======================================================
     PIYAS
  ====================================================== */

  if (
    command === "piyas"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 *PIYAS BOT*

⚡ Fast
🛡️ Secure
❤️ Community Friendly

━━━━━━━━━━━━━━━━━━

🌐 Website:
${WEBSITE_URL}

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯
`
      }
    );

    return true;
  }

  /* ======================================================
     WEBSITE
  ====================================================== */

  if (
    command === "website"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       🌐 *OUR WEBSITE*
╰━━━━━━━━━━━━━━━━━━━━╯

${WEBSITE_URL}

❤️ *PIYAS BOT*
`
      }
    );

    return true;
  }

  /* ======================================================
     REPORT
  ====================================================== */

  if (
    command === "report"
  ) {
    const target =
      getMentionedTarget(
        message
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ একজনকে mention করে কারণ লিখুন।\n\nExample:\n/report @user spam করছে"
        }
      );

      return true;
    }

    const reason =
      args.join(" ")
        .trim() ||
      "কোনো কারণ দেওয়া হয়নি";

    addReport(
      groupId,
      {
        reporter:
          sender,
        target,
        reason
      }
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
        🛡️ *REPORT*
╰━━━━━━━━━━━━━━━━━━━━╯

✅ Report received.

👤 Target:
@${target.split("@")[0]}

📝 Reason:
${reason}

❤️ *PIYAS BOT*
`,
        mentions: [
          target
        ]
      }
    );

    return true;
  }

  /* ======================================================
     REPORTS
  ====================================================== */

  if (
    command === "reports"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    const list =
      getReports(
        groupId
      );

    if (!list.length) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "📋 কোনো report নেই।"
        }
      );

      return true;
    }

    let text =
      `
╭━━━━━━━━━━━━━━━━━━━━╮
        📋 *REPORTS*
╰━━━━━━━━━━━━━━━━━━━━╯

`;

    const mentions =
      [];

    list
      .slice(-20)
      .forEach(
        (report, index) => {
          text +=
            `${index + 1}️⃣ Target: @${report.target.split("@")[0]}\n` +
            `📝 ${report.reason}\n\n`;

          mentions.push(
            report.target
          );
        }
      );

    await sock.sendMessage(
      groupId,
      {
        text,
        mentions
      }
    );

    return true;
  }

  /* ======================================================
     ADMIN PANEL
  ====================================================== */

  if (
    command ===
      "adminpanel"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Group Admin-এর জন্য।"
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

  /* ======================================================
     CMD LIST
  ====================================================== */

  if (
    command ===
      "cmdlist"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Group Admin-এর জন্য।"
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

  /* ======================================================
     BOT ON
  ====================================================== */

  if (
    command === "on" ||
    command === "boton" ||
    command === "onbot"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    setBotEnabled(
      groupId,
      true
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

✅ Bot এখন *ON* 🟢

❤️ *PIYAS BOT*
`
      }
    );

    return true;
  }

  /* ======================================================
     BOT OFF
  ====================================================== */

  if (
    command === "off" ||
    command === "botoff" ||
    command === "offbot"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    setBotEnabled(
      groupId,
      false
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

🔴 Bot এখন *OFF*

ℹ️ Admin commands চালু থাকবে।

❤️ *PIYAS BOT*
`
      }
    );

    return true;
  }

  /* ======================================================
     FULL STATUS
  ====================================================== */

  if (
    command ===
      "fullbotstatus"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${
  isBotEnabled(groupId)
    ? "🟢 ON"
    : "🔴 OFF"
}

👋 Welcome:
${
  isWelcomeEnabled(groupId)
    ? "🟢 ON"
    : "🔴 OFF"
}

🚫 Blacklist:
${
  (
    leaveBlacklist[
      groupId
    ] || []
  ).length
} Members

📋 Reports:
${
  (
    reports[
      groupId
    ] || []
  ).length
}

╭━━━━━━━━━━━━━━━━━━━━╮
        ❤️ *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯
`
      }
    );

    return true;
  }

  /* ======================================================
     WELCOME ON
  ====================================================== */

  if (
    command ===
      "welcomeon"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    setWelcomeEnabled(
      groupId,
      true
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "👋 Welcome message এখন *ON* 🟢"
      }
    );

    return true;
  }

  /* ======================================================
     WELCOME OFF
  ====================================================== */

  if (
    command ===
      "welcomeoff"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    setWelcomeEnabled(
      groupId,
      false
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "👋 Welcome message এখন *OFF* 🔴"
      }
    );

    return true;
  }

  /* ======================================================
     ALLOW BACK
  ====================================================== */

  if (
    command ===
      "allowback"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    const target =
      getMentionedTarget(
        message
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ যাকে Allow করতে চান তাকে mention করুন।"
        }
      );

      return true;
    }

    const identity =
      findCachedIdentity(
        target
      ) ||
      extractUserIdentity(
        target
      );

    const removed =
      removeLeaveBlacklist(
        groupId,
        identity
      );

    await sock.sendMessage(
      groupId,
      {
        text:
          removed
            ? "✅ Member-এর blacklist permission remove করা হয়েছে। এখন আবার join করতে পারবে।"
            : "ℹ️ এই member blacklist-এ পাওয়া যায়নি।",
        mentions: [
          target
        ]
      }
    );

    return true;
  }

  /* ======================================================
     UNLEAVE
  ====================================================== */

  if (
    command ===
      "unleave"
  ) {
    if (
      !admin &&
      !owner
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin-এর জন্য।"
        }
      );

      return true;
    }

    const target =
      getMentionedTarget(
        message
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ যাকে blacklist থেকে remove করতে চান তাকে mention করুন।"
        }
      );

      return true;
    }

    const identity =
      findCachedIdentity(
        target
      ) ||
      extractUserIdentity(
        target
      );

    const removed =
      removeLeaveBlacklist(
        groupId,
        identity
      );

    await sock.sendMessage(
      groupId,
      {
        text:
          removed
            ? "✅ Member blacklist থেকে remove করা হয়েছে।"
            : "ℹ️ Member blacklist-এ নেই।",
        mentions: [
          target
        ]
      }
    );

    return true;
  }

  return false;
}

/* =========================================================
   MESSAGE HANDLER
========================================================= */

async function handleIncomingMessage(
  sock,
  message
) {
  try {
    if (
      !message?.message
    ) {
      return;
    }

    const remoteJid =
      message.key
        ?.remoteJid ||
      "";

    if (
      !remoteJid.endsWith(
        "@g.us"
      )
    ) {
      return;
    }

    const groupId =
      remoteJid;

    if (
      !isAllowedGroup(
        groupId
      )
    ) {
      return;
    }

    const sender =
      message.key
        ?.participant ||
      message.key
        ?.remoteJid ||
      "";

    const pushName =
      message.pushName ||
      "";

    cacheUserIdentity(
      sender,
      pushName
    );

    const text =
      getMessageText(
        message
      );

    /* COMMANDS */

    const commandData =
      parseCommand(
        text
      );

    if (commandData) {
      const handled =
        await handleCommand(
          sock,
          message,
          groupId,
          sender,
          commandData
        );

      if (handled) {
        return;
      }
    }

    /* BOT OFF */

    if (
      !isBotEnabled(
        groupId
      )
    ) {
      return;
    }

    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    if (!metadata) {
      return;
    }

    const admin =
      isParticipantAdmin(
        metadata,
        sender
      );

    const owner =
      isGroupOwner(
        metadata,
        sender
      );

    const botOwner =
      isOwner(sender);

    /* NORMAL MEMBERS */

    if (
      !admin &&
      !owner &&
      !botOwner
    ) {
      /* DUPLICATE SPAM */

      if (
        text &&
        isDuplicateSpam(
          sender,
          text
        )
      ) {
        const deleted =
          await deleteMessage(
            sock,
            groupId,
            message
          );

        if (deleted) {
          await sendWarning(
            sock,
            groupId,
            "⚠️ একই মেসেজ বারবার পাঠানো যাবে না।"
          );
        }

        return;
      }

      /* LINK */

      const linkDeleted =
        await handleLinkProtection(
          sock,
          groupId,
          message,
          sender
        );

      if (linkDeleted) {
        return;
      }
    }

    /* MODERATION */

    await moderateMessage(
      sock,
      groupId,
      message,
      sender
    );
  } catch (error) {
    console.log(
      "Message handler error:",
      error.message
    );
  }
}

/* =========================================================
   START BOT
========================================================= */

let reconnecting =
  false;

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

    const sock =
      makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal:
          false,
        browser: [
          "PIYAS BOT",
          "Chrome",
          "1.0.0"
        ],
        markOnlineOnConnect:
          false,
        syncFullHistory:
          false,
        generateHighQualityLinkPreview:
          false
      });

    /* CREDS */

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    /* CONNECTION */

    sock.ev.on(
      "connection.update",
      async (update) => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (
          connection ===
          "open"
        ) {
          reconnecting =
            false;

          console.log(
            "✅ PIYAS BOT connected successfully."
          );

          console.log(
            `🤖 Bot JID: ${
              sock.user?.id ||
              "Unknown"
            }`
          );
        }

        if (
          connection ===
          "close"
        ) {
          let statusCode =
            0;

          try {
            statusCode =
              new Boom(
                lastDisconnect
                  ?.error
              )
                ?.output
                ?.statusCode || 0;
          } catch {}

          console.log(
            `Connection closed. Code: ${statusCode}`
          );

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              "❌ Logged out. Delete auth_info_baileys and login again."
            );

            return;
          }

          if (
            !reconnecting
          ) {
            reconnecting =
              true;

            setTimeout(
              () => {
                startBot().catch(
                  console.error
                );
              },
              5000
            );
          }
        }
      }
    );

    /* PARTICIPANTS */

    sock.ev.on(
      "group-participants.update",
      async (update) => {
        await handleParticipantUpdate(
          sock,
          update
        );
      }
    );

    /* MESSAGES */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {
        for (
          const message of
          messages
        ) {
          if (
            message.key
              ?.fromMe
          ) {
            continue;
          }

          await handleIncomingMessage(
            sock,
            message
          );
        }
      }
    );

    return sock;
  } catch (error) {
    console.log(
      "Start bot error:",
      error.message
    );

    if (
      !reconnecting
    ) {
      reconnecting =
        true;

      setTimeout(
        () => {
          reconnecting =
            false;

          startBot().catch(
            console.error
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

async function shutdown(
  signal
) {
  console.log(
    `\n${signal} received. Shutting down...`
  );

  try {
    server.close();
  } catch {}

  process.exit(0);
}

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

/* =========================================================
   START
========================================================= */

startBot().catch(
  console.error
);