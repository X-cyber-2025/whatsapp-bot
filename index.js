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

const PHONE_NUMBER = String(process.env.PHONE_NUMBER || "")
  .replace(/\D/g, "");

const WEBSITE_URL =
  process.env.WEBSITE_URL ||
  "https://x-cyber-2025.github.io/X-cyber.web/";

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || "";

const IMAGE_MODERATION_ENABLED =
  String(process.env.IMAGE_MODERATION_ENABLED || "true")
    .toLowerCase() === "true";

const TEXT_MODERATION_ENABLED =
  String(process.env.TEXT_MODERATION_ENABLED || "true")
    .toLowerCase() === "true";

const IMAGE_SEXUAL_SCORE_THRESHOLD =
  Number(process.env.IMAGE_SEXUAL_SCORE_THRESHOLD || 0.30);

const ALLOWED_GROUPS = new Set(
  String(process.env.ALLOWED_GROUPS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
);

const AUTH_DIR = "./auth_info";

const STATUS_FILE = "./bot_status.json";
const LEAVE_BLACKLIST_FILE = "./leave_blacklist.json";
const REPORT_FILE = "./reports.json";

const logger = pino({
  level: "silent"
});

/* =========================================================
   HTTP SERVER
========================================================= */

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("PIYAS BOT ONLINE");
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

/* =========================================================
   JSON HELPERS
========================================================= */

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(fallback, null, 2)
      );
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8");

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);
  } catch (err) {
    console.error(`JSON read error: ${file}`, err.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );
  } catch (err) {
    console.error(`JSON write error: ${file}`, err.message);
  }
}

let botStatus = readJson(STATUS_FILE, {});
let leaveBlacklist = readJson(
  LEAVE_BLACKLIST_FILE,
  {}
);
let reports = readJson(REPORT_FILE, {});

/* =========================================================
   STATUS
========================================================= */

function ensureGroupStatus(groupId) {
  if (!botStatus[groupId]) {
    botStatus[groupId] = {
      enabled: true,
      welcomeEnabled: true,
      disabledCommands: []
    };

    writeJson(STATUS_FILE, botStatus);
  }

  return botStatus[groupId];
}

function saveStatus() {
  writeJson(STATUS_FILE, botStatus);
}

/* =========================================================
   GROUP FILTER
========================================================= */

function isAllowedGroup(groupId) {
  if (ALLOWED_GROUPS.size === 0) {
    return true;
  }

  return ALLOWED_GROUPS.has(groupId);
}

/* =========================================================
   USER / JID HELPERS
========================================================= */

function normalizeJid(jid) {
  if (!jid) return "";

  try {
    return jidNormalizedUser(String(jid));
  } catch {
    return String(jid);
  }
}

function sameUser(a, b) {
  if (!a || !b) return false;

  try {
    return areJidsSameUser(
      normalizeJid(a),
      normalizeJid(b)
    );
  } catch {
    return normalizeJid(a) === normalizeJid(b);
  }
}

function getParticipantJid(participant) {
  if (!participant) return "";

  if (typeof participant === "string") {
    return normalizeJid(participant);
  }

  return normalizeJid(
    participant.id ||
    participant.jid ||
    participant.lid ||
    participant.phoneNumber ||
    ""
  );
}

/* =========================================================
   TEXT NORMALIZATION
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(text) {
  return normalizeText(text)
    .replace(/\s+/g, "");
}

/* =========================================================
   BAD WORDS
========================================================= */

const BAD_WORDS = [
  "শালা",
  "সালা",
  "শালার",
  "সালার",

  "খানকি",
  "খানকির",
  "খানকিকে",
  "খানকিটা",

  "কানকি",
  "কানকির",
  "কানকিকে",

  "কাংকি",
  "কাংকির",

  "মাগি",
  "মাগী",
  "মাগির",
  "মাগীর",
  "মাগিকে",
  "মাগীকে",

  "চোদা",
  "চোদন",
  "চোদাচুদি",
  "চুদা",
  "চুদির",
  "চুদাচুদি",

  "বাল",
  "বালের",

  "হারামি",
  "হারামীর",
  "হারামজাদা",
  "হারামজাদার",

  "কুত্তা",
  "কুত্তার",

  "বাঞ্চোদ",
  "বোকাচোদা",
  "মাদারচোদ",
  "মাদারচোদা",
  "বেশ্যা",

  "fuck",
  "fucking",
  "fucker",
  "motherfucker",
  "shit",
  "bitch",
  "bastard",
  "whore",
  "slut",
  "asshole",
  "dick",
  "pussy",
  "cock"
];

const BAD_WORD_REGEX = BAD_WORDS.map(
  word => normalizeText(word)
);

function containsBadWord(text) {
  const normal = normalizeText(text);
  const compact = compactText(text);

  for (const word of BAD_WORD_REGEX) {
    if (!word) continue;

    if (normal.includes(word)) {
      return true;
    }

    if (word.length >= 3 && compact.includes(word)) {
      return true;
    }
  }

  return false;
}

/* =========================================================
   TEXT EXTRACTION
========================================================= */

function getMessageText(message) {
  if (!message) return "";

  const m = message.message || {};

  if (m.conversation) {
    return m.conversation;
  }

  if (m.extendedTextMessage?.text) {
    return m.extendedTextMessage.text;
  }

  if (m.imageMessage?.caption) {
    return m.imageMessage.caption;
  }

  if (m.videoMessage?.caption) {
    return m.videoMessage.caption;
  }

  return "";
}

/* =========================================================
   COMMAND PARSER
========================================================= */

function parseCommand(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed.startsWith("/")) {
    return {
      command: "",
      args: ""
    };
  }

  const parts = trimmed.split(/\s+/);

  const command = parts[0]
    .slice(1)
    .toLowerCase();

  const args = parts
    .slice(1)
    .join(" ")
    .trim();

  return {
    command,
    args
  };
}

/* =========================================================
   GROUP METADATA
========================================================= */

const groupMetadataCache = new Map();

async function getGroupMetadata(sock, groupId, force = false) {
  if (!force && groupMetadataCache.has(groupId)) {
    return groupMetadataCache.get(groupId);
  }

  try {
    const metadata =
      await sock.groupMetadata(groupId);

    groupMetadataCache.set(
      groupId,
      metadata
    );

    return metadata;
  } catch (err) {
    console.error(
      "groupMetadata error:",
      err.message
    );

    return null;
  }
}

/* =========================================================
   ADMIN CHECK
========================================================= */

async function getAdminInfo(
  sock,
  groupId,
  userJid,
  force = false
) {
  const metadata =
    await getGroupMetadata(
      sock,
      groupId,
      force
    );

  if (!metadata) {
    return {
      isAdmin: false,
      isBotAdmin: false,
      metadata: null
    };
  }

  const participant =
    metadata.participants?.find(p =>
      sameUser(
        getParticipantJid(p),
        userJid
      )
    );

  const isAdmin =
    participant?.admin === "admin" ||
    participant?.admin === "superadmin";

  const botJid =
    normalizeJid(sock.user?.id);

  const botParticipant =
    metadata.participants?.find(p =>
      sameUser(
        getParticipantJid(p),
        botJid
      )
    );

  const isBotAdmin =
    botParticipant?.admin === "admin" ||
    botParticipant?.admin === "superadmin";

  return {
    isAdmin: Boolean(isAdmin),
    isBotAdmin: Boolean(isBotAdmin),
    metadata
  };
}

/* =========================================================
   BOT OWNER
========================================================= */

function isBotOwner(jid) {
  if (!PHONE_NUMBER || !jid) {
    return false;
  }

  const cleanJid =
    normalizeJid(jid);

  const number =
    cleanJid.split("@")[0]
      .split(":")[0]
      .replace(/\D/g, "");

  return number === PHONE_NUMBER;
}

/* =========================================================
   MESSAGE DELETE
========================================================= */

async function deleteMessage(
  sock,
  groupId,
  message
) {
  try {
    const sender =
      message.key?.participant ||
      message.key?.remoteJid;

    const admin =
      await getAdminInfo(
        sock,
        groupId,
        sender,
        true
      );

    if (!admin.isBotAdmin) {
      return false;
    }

    await sock.sendMessage(
      groupId,
      {
        delete: {
          remoteJid: groupId,
          fromMe: Boolean(message.key?.fromMe),
          id: message.key?.id,
          participant: message.key?.participant
        }
      }
    );

    return true;
  } catch (err) {
    console.error(
      "Delete error:",
      err.message
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
  sender,
  text
) {
  try {
    await sock.sendMessage(
      groupId,
      {
        text,
        mentions: sender ? [sender] : []
      }
    );
  } catch {}
}

/* =========================================================
   OPENAI TEXT MODERATION
========================================================= */

async function moderateTextWithOpenAI(text) {
  if (
    !TEXT_MODERATION_ENABLED ||
    !OPENAI_API_KEY ||
    !text
  ) {
    return false;
  }

  try {
    const response = await fetch(
      "https://api.openai.com/v1/moderations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: text
        })
      }
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "OpenAI text moderation error:",
        response.status,
        errorText
      );

      return false;
    }

    const data =
      await response.json();

    const result =
      data.results?.[0];

    if (!result) {
      return false;
    }

    return Boolean(
      result.flagged &&
      (
        result.categories?.harassment ||
        result.categories?.harassment_threatening ||
        result.categories?.sexual ||
        result.categories?.sexual_minors
      )
    );
  } catch (err) {
    console.error(
      "OpenAI text moderation:",
      err.message
    );

    return false;
  }
}

/* =========================================================
   IMAGE MODERATION
========================================================= */

function isImageMessage(message) {
  return Boolean(
    message?.message?.imageMessage
  );
}

async function moderateImageWithOpenAI(
  sock,
  message
) {
  if (
    !IMAGE_MODERATION_ENABLED ||
    !OPENAI_API_KEY ||
    !isImageMessage(message)
  ) {
    return {
      delete: false,
      reason: ""
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
        delete: false,
        reason: "download_failed"
      };
    }

    const base64 =
      Buffer.from(buffer).toString("base64");

    const mimeType =
      message.message.imageMessage
        ?.mimetype ||
      "image/jpeg";

    const dataUrl =
      `data:${mimeType};base64,${base64}`;

    const response = await fetch(
      "https://api.openai.com/v1/moderations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: [
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "OpenAI image moderation error:",
        response.status,
        errorText
      );

      return {
        delete: false,
        reason: "api_error"
      };
    }

    const data =
      await response.json();

    const result =
      data.results?.[0];

    if (!result) {
      return {
        delete: false,
        reason: "no_result"
      };
    }

    const sexualScore =
      Number(
        result.category_scores?.sexual || 0
      );

    const sexualMinorsScore =
      Number(
        result.category_scores?.[
          "sexual/minors"
        ] || 0
      );

    const sexualFlag =
      Boolean(
        result.categories?.sexual
      );

    const sexualMinorsFlag =
      Boolean(
        result.categories?.[
          "sexual/minors"
        ]
      );

    const deleteImage =
      sexualMinorsFlag ||
      sexualMinorsScore >= 0.05 ||
      sexualFlag ||
      sexualScore >= IMAGE_SEXUAL_SCORE_THRESHOLD;

    console.log(
      "IMAGE MODERATION:",
      JSON.stringify({
        sexualFlag,
        sexualMinorsFlag,
        sexualScore,
        sexualMinorsScore,
        threshold:
          IMAGE_SEXUAL_SCORE_THRESHOLD,
        deleteImage
      })
    );

    return {
      delete: deleteImage,
      reason: deleteImage
        ? "sexual_content"
        : ""
    };
  } catch (err) {
    console.error(
      "Image moderation error:",
      err.message
    );

    return {
      delete: false,
      reason: "exception"
    };
  }
}

/* =========================================================
   LEAVE BLACKLIST
========================================================= */

function ensureLeaveGroup(groupId) {
  if (!leaveBlacklist[groupId]) {
    leaveBlacklist[groupId] = {};
  }

  return leaveBlacklist[groupId];
}

function blacklistMember(
  groupId,
  participant,
  author
) {
  const jid =
    getParticipantJid(participant);

  if (!jid) {
    return;
  }

  const group =
    ensureLeaveGroup(groupId);

  const key =
    normalizeJid(jid);

  group[key] = {
    jid: key,
    leftAt: new Date().toISOString(),
    leftBy: author || key,
    reason: "self_leave"
  };

  writeJson(
    LEAVE_BLACKLIST_FILE,
    leaveBlacklist
  );

  console.log(
    `SELF LEAVE BLACKLIST: ${groupId} -> ${key}`
  );
}

function isLeaveBlacklisted(
  groupId,
  participant
) {
  const jid =
    getParticipantJid(participant);

  if (!jid) {
    return false;
  }

  const group =
    leaveBlacklist[groupId];

  if (!group) {
    return false;
  }

  const current =
    normalizeJid(jid);

  if (group[current]) {
    return true;
  }

  for (const item of Object.values(group)) {
    if (sameUser(item.jid, current)) {
      return true;
    }
  }

  return false;
}

function removeLeaveBlacklist(
  groupId,
  participant
) {
  const jid =
    getParticipantJid(participant);

  if (!jid) {
    return false;
  }

  const group =
    leaveBlacklist[groupId];

  if (!group) {
    return false;
  }

  let removed = false;

  for (const key of Object.keys(group)) {
    if (
      sameUser(
        group[key].jid,
        jid
      )
    ) {
      delete group[key];
      removed = true;
    }
  }

  if (removed) {
    writeJson(
      LEAVE_BLACKLIST_FILE,
      leaveBlacklist
    );
  }

  return removed;
}

/* =========================================================
   REPORT SYSTEM
========================================================= */

function ensureReportGroup(groupId) {
  if (!reports[groupId]) {
    reports[groupId] = [];
  }

  return reports[groupId];
}

function addReport(
  groupId,
  reporter,
  target,
  reason
) {
  const group =
    ensureReportGroup(groupId);

  group.push({
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    reporter:
      normalizeJid(reporter),

    target:
      normalizeJid(target),

    reason:
      reason || "No reason provided",

    time:
      new Date().toISOString(),

    status: "pending"
  });

  if (group.length > 100) {
    group.splice(
      0,
      group.length - 100
    );
  }

  writeJson(
    REPORT_FILE,
    reports
  );

  return group[group.length - 1];
}

/* =========================================================
   MENTION TARGET
========================================================= */

function getMentionedUser(message) {
  const context =
    message.message
      ?.extendedTextMessage
      ?.contextInfo;

  const mentions =
    context?.mentionedJid || [];

  if (mentions.length > 0) {
    return normalizeJid(
      mentions[0]
    );
  }

  return "";
}

/* =========================================================
   COMMAND PERMISSION
========================================================= */

async function isAdminOrOwner(
  sock,
  groupId,
  sender
) {
  if (isBotOwner(sender)) {
    return true;
  }

  const info =
    await getAdminInfo(
      sock,
      groupId,
      sender
    );

  return info.isAdmin;
}

async function canControlBot(
  sock,
  groupId,
  sender
) {
  return isAdminOrOwner(
    sock,
    groupId,
    sender
  );
}

/* =========================================================
   COMMAND LIST
========================================================= */

const COMMAND_NAMES = [
  "menu",
  "bot",
  "rules",
  "admin",
  "members",
  "groupinfo",
  "id",
  "ping",
  "deal",
  "ডিল",
  "piyas",
  "website",
  "report",
  "reports",
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "onbot",
  "offbot",
  "fullbotstatus",
  "allowback",
  "unleave",
  "welcomeon",
  "welcomeoff"
];

/* =========================================================
   MENU
========================================================= */

function getMenuText(groupName, status) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 *Group:* ${groupName}

📌 *Available Commands*

/menu
/bot
/rules
/admin
/members
/groupinfo
/id
/ping
/deal
/ডিল
/piyas
/website

🚨 *Report*
/report @user কারণ
/reports

🛠️ *Admin Commands*
/adminpanel
/cmdlist
/on command
/off command
/boton
/botoff
/fullbotstatus
/welcomeon
/welcomeoff

🚫 *Leave Blacklist*
/allowback @user
/unleave @user

━━━━━━━━━━━━━━━━━━━━
⚡ *Bot Status:* ${
    status.enabled
      ? "ON 🟢"
      : "OFF 🔴"
  }
━━━━━━━━━━━━━━━━━━━━
`;
}

/* =========================================================
   WELCOME
========================================================= */

function createWelcomeText(
  groupName,
  participant
) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম @${participant}!* ❤️

🌸 আপনাকে *${groupName}*
গ্রুপে স্বাগতম।

📌 গ্রুপের নিয়ম মেনে চলুন।
🤝 সবাইকে সম্মান করুন।
🚫 অশ্লীল ছবি ও গালাগালি থেকে বিরত থাকুন।

━━━━━━━━━━━━━━━━━━━━
🤖 *PIYAS BOT*
━━━━━━━━━━━━━━━━━━━━
`;
}

/* =========================================================
   GROUP PARTICIPANT EVENTS
========================================================= */

async function handleParticipantUpdate(
  sock,
  update
) {
  const {
    id: groupId,
    author,
    participants,
    action
  } = update;

  if (!groupId?.endsWith("@g.us")) {
    return;
  }

  if (!isAllowedGroup(groupId)) {
    return;
  }

  const status =
    ensureGroupStatus(groupId);

  const groupName =
    (
      await getGroupMetadata(
        sock,
        groupId,
        true
      )
    )?.subject ||
    "এই গ্রুপ";

  for (const participant of participants || []) {
    const participantJid =
      getParticipantJid(participant);

    if (!participantJid) {
      continue;
    }

    /* =========================================
       ADD
    ========================================= */

    if (action === "add") {
      if (
        isLeaveBlacklisted(
          groupId,
          participant
        )
      ) {
        console.log(
          `BLACKLISTED REJOIN: ${participantJid}`
        );

        const info =
          await getAdminInfo(
            sock,
            groupId,
            participantJid,
            true
          );

        if (info.isBotAdmin) {
          try {
            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  1200
                )
            );

            await sock.groupParticipantsUpdate(
              groupId,
              [participantJid],
              "remove"
            );

            await sendWarning(
              sock,
              groupId,
              participantJid,
              `🚫 @${participantJid.split("@")[0]} আপনাকে এই গ্রুপ থেকে আগে নিজে Leave করার কারণে আবার Join করার পর Remove করা হয়েছে।\n\nAdmin চাইলে /allowback @user দিয়ে blacklist তুলে দিতে পারবেন।`
            );
          } catch (err) {
            console.error(
              "Blacklist remove error:",
              err.message
            );
          }
        }

        continue;
      }

      if (status.welcomeEnabled) {
        try {
          await sock.sendMessage(
            groupId,
            {
              text:
                createWelcomeText(
                  groupName,
                  participantJid.split("@")[0]
                ),
              mentions: [
                participantJid
              ]
            }
          );
        } catch {}
      }
    }

    /* =========================================
       REMOVE
    ========================================= */

    if (action === "remove") {
      const authorJid =
        normalizeJid(author);

      /*
       Self leave detection:
       author and participant are same user.
      */

      const selfLeave =
        Boolean(authorJid) &&
        sameUser(
          authorJid,
          participantJid
        );

      if (selfLeave) {
        blacklistMember(
          groupId,
          participant,
          authorJid
        );

        console.log(
          `SELF LEAVE: ${participantJid}`
        );
      } else {
        console.log(
          `ADMIN/OTHER REMOVE: ${participantJid}`
        );
      }
    }
  }
}

/* =========================================================
   MODERATION
========================================================= */

async function moderateGroupMessage(
  sock,
  groupId,
  message
) {
  const sender =
    normalizeJid(
      message.key?.participant ||
      message.key?.remoteJid ||
      ""
    );

  if (!sender) {
    return false;
  }

  if (message.key?.fromMe) {
    return false;
  }

  const adminInfo =
    await getAdminInfo(
      sock,
      groupId,
      sender
    );

  /*
   Admin + Owner bypass moderation.
  */

  if (
    adminInfo.isAdmin ||
    isBotOwner(sender)
  ) {
    return false;
  }

  const text =
    getMessageText(message);

  /* =========================================
     LOCAL BAD WORD DETECTION
  ========================================= */

  if (
    TEXT_MODERATION_ENABLED &&
    text &&
    containsBadWord(text)
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
        sender,
        `⚠️ @${sender.split("@")[0]} গালাগালি করা যাবে না।\n\n🚫 আপনার মেসেজটি মুছে দেওয়া হয়েছে।`
      );
    }

    return deleted;
  }

  /* =========================================
     OPENAI TEXT MODERATION
  ========================================= */

  if (
    TEXT_MODERATION_ENABLED &&
    text &&
    OPENAI_API_KEY
  ) {
    const flagged =
      await moderateTextWithOpenAI(
        text
      );

    if (flagged) {
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
          sender,
          `⚠️ @${sender.split("@")[0]} আপনার মেসেজটি গ্রুপের moderation rules অনুযায়ী সরানো হয়েছে।`
        );
      }

      return deleted;
    }
  }

  /* =========================================
     IMAGE MODERATION
  ========================================= */

  if (
    IMAGE_MODERATION_ENABLED &&
    isImageMessage(message)
  ) {
    const result =
      await moderateImageWithOpenAI(
        sock,
        message
      );

    if (result.delete) {
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
          sender,
          `🚫 @${sender.split("@")[0]} এই ছবিটি গ্রুপে অনুমোদিত নয়।\n\n🔞 যৌন/অশ্লীল ধরনের ছবি নিষিদ্ধ।`
        );
      }

      return deleted;
    }
  }

  return false;
}

/* =========================================================
   LINK PROTECTION
========================================================= */

function containsLink(text) {
  return Boolean(
    String(text || "").match(
      /(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|telegram\.me\/)/i
    )
  );
}

async function moderateLink(
  sock,
  groupId,
  message
) {
  const sender =
    normalizeJid(
      message.key?.participant ||
      ""
    );

  const text =
    getMessageText(message);

  if (!text || !containsLink(text)) {
    return false;
  }

  const info =
    await getAdminInfo(
      sock,
      groupId,
      sender
    );

  if (
    info.isAdmin ||
    isBotOwner(sender)
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
      sender,
      `🔗 @${sender.split("@")[0]} গ্রুপে অনুমতি ছাড়া link share করা যাবে না।`
    );
  }

  return deleted;
}

/* =========================================================
   DUPLICATE SPAM
========================================================= */

const recentMessages = new Map();

async function moderateDuplicateSpam(
  sock,
  groupId,
  message
) {
  const sender =
    normalizeJid(
      message.key?.participant ||
      ""
    );

  const text =
    normalizeText(
      getMessageText(message)
    );

  if (!sender || !text) {
    return false;
  }

  const info =
    await getAdminInfo(
      sock,
      groupId,
      sender
    );

  if (
    info.isAdmin ||
    isBotOwner(sender)
  ) {
    return false;
  }

  const key =
    `${groupId}:${sender}:${text}`;

  const now = Date.now();

  const previous =
    recentMessages.get(key);

  recentMessages.set(
    key,
    now
  );

  if (
    previous &&
    now - previous < 5 * 60 * 1000
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
        sender,
        `⚠️ @${sender.split("@")[0]} একই মেসেজ বারবার পাঠানো যাবে না।`
      );
    }

    return deleted;
  }

  return false;
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(
  sock,
  groupId,
  message
) {
  const sender =
    normalizeJid(
      message.key?.participant ||
      ""
    );

  const text =
    getMessageText(message);

  const {
    command,
    args
  } = parseCommand(text);

  if (!command) {
    return false;
  }

  const status =
    ensureGroupStatus(groupId);

  const groupMetadata =
    await getGroupMetadata(
      sock,
      groupId
    );

  const groupName =
    groupMetadata?.subject ||
    "এই গ্রুপ";

  /* =========================================
     COMMAND ENABLE/DISABLE CHECK
  ========================================= */

  const alwaysAllowed = [
    "menu",
    "bot",
    "id",
    "ping"
  ];

  if (
    status.disabledCommands.includes(command) &&
    !alwaysAllowed.includes(command)
  ) {
    return true;
  }

  /* =========================================
     MENU
  ========================================= */

  if (command === "menu") {
    await sock.sendMessage(
      groupId,
      {
        text:
          getMenuText(
            groupName,
            status
          )
      }
    );

    return true;
  }

  /* =========================================
     BOT
  ========================================= */

  if (command === "bot") {
    await sock.sendMessage(
      groupId,
      {
        text: `
🤖 *PIYAS BOT*

🟢 Bot Status:
${status.enabled ? "ON" : "OFF"}

👥 Group:
${groupName}

⚡ Ready.
`
      }
    );

    return true;
  }

  /* =========================================
     RULES
  ========================================= */

  if (command === "rules") {
    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ গালাগালি করা যাবে না।
2️⃣ অশ্লীল/18+ ছবি পাঠানো যাবে না।
3️⃣ অনুমতি ছাড়া link share করা যাবে না।
4️⃣ Spam করা যাবে না।
5️⃣ সবাইকে সম্মান করতে হবে।
6️⃣ কোনো সমস্যা হলে /report ব্যবহার করুন।

━━━━━━━━━━━━━━━━━━━━
🤖 PIYAS BOT
━━━━━━━━━━━━━━━━━━━━
`
      }
    );

    return true;
  }

  /* =========================================
     ADMIN
  ========================================= */

  if (command === "admin") {
    const admins =
      groupMetadata?.participants
        ?.filter(
          p =>
            p.admin === "admin" ||
            p.admin === "superadmin"
        ) || [];

    let textAdmin =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
      "       👑 *GROUP ADMINS*\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

    const mentions = [];

    for (
      let i = 0;
      i < admins.length;
      i++
    ) {
      const jid =
        getParticipantJid(
          admins[i]
        );

      if (!jid) continue;

      mentions.push(jid);

      textAdmin +=
        `${i + 1}. @${jid.split("@")[0]}\n`;
    }

    await sock.sendMessage(
      groupId,
      {
        text: textAdmin,
        mentions
      }
    );

    return true;
  }

  /* =========================================
     MEMBERS
  ========================================= */

  if (command === "members") {
    const members =
      groupMetadata?.participants || [];

    await sock.sendMessage(
      groupId,
      {
        text:
          `👥 *Group Members:* ${members.length}\n\n` +
          `🏷️ *Group:* ${groupName}`
      }
    );

    return true;
  }

  /* =========================================
     GROUP INFO
  ========================================= */

  if (command === "groupinfo") {
    const members =
      groupMetadata?.participants || [];

    const admins =
      members.filter(
        p =>
          p.admin === "admin" ||
          p.admin === "superadmin"
      );

    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       ℹ️ *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

🏷️ Name:
${groupName}

🆔 ID:
${groupId}

👥 Members:
${members.length}

👑 Admins:
${admins.length}

🤖 Bot:
${status.enabled ? "ON 🟢" : "OFF 🔴"}
`
      }
    );

    return true;
  }

  /* =========================================
     ID
  ========================================= */

  if (command === "id") {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🆔 *Group ID*\n\n${groupId}`
      }
    );

    return true;
  }

  /* =========================================
     PING
  ========================================= */

  if (command === "ping") {
    const start = Date.now();

    await sock.sendMessage(
      groupId,
      {
        text: "🏓 Pinging..."
      }
    );

    const ms =
      Date.now() - start;

    await sock.sendMessage(
      groupId,
      {
        text:
          `🏓 *PONG!*\n⚡ ${ms}ms`
      }
    );

    return true;
  }

  /* =========================================
     DEAL
  ========================================= */

  if (
    command === "deal" ||
    command === "ডিল"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text: `
🔥 *TODAY'S DEAL*

🎁 Special digital service available.

📩 বিস্তারিত জানতে Admin-এর সাথে যোগাযোগ করুন।
`
      }
    );

    return true;
  }

  /* =========================================
     PIYAS
  ========================================= */

  if (command === "piyas") {
    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        👤 *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 PIYAS BOT
🌐 ${WEBSITE_URL}

📩 Digital Service & Support
`
      }
    );

    return true;
  }

  /* =========================================
     WEBSITE
  ========================================= */

  if (command === "website") {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🌐 *Website*\n\n${WEBSITE_URL}`
      }
    );

    return true;
  }

  /* =========================================
     REPORT
  ========================================= */

  if (command === "report") {
    const target =
      getMentionedUser(message);

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            `❌ ব্যবহার করুন:\n\n/report @user কারণ`
        }
      );

      return true;
    }

    const reason =
      args
        .replace(
          /@\S+/g,
          ""
        )
        .trim() ||
      "কোনো কারণ দেওয়া হয়নি";

    const report =
      addReport(
        groupId,
        sender,
        target,
        reason
      );

    await sock.sendMessage(
      groupId,
      {
        text: `
🚨 *REPORT RECEIVED*

👤 Reported:
@${target.split("@")[0]}

📝 Reported By:
@${sender.split("@")[0]}

📌 Reason:
${reason}

🆔 Report ID:
${report.id}

⚠️ Admin-এর পর্যালোচনার জন্য রিপোর্টটি সংরক্ষণ করা হয়েছে।
`,
        mentions: [
          target,
          sender
        ]
      }
    );

    return true;
  }

  /* =========================================
     REPORTS
  ========================================= */

  if (command === "reports") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin ব্যবহার করতে পারবেন।"
        }
      );

      return true;
    }

    const list =
      reports[groupId] || [];

    if (list.length === 0) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "📭 এই গ্রুপে কোনো report নেই।"
        }
      );

      return true;
    }

    const latest =
      list.slice(-20).reverse();

    let reportText =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
      "       🚨 *REPORTS*\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

    const mentions = [];

    latest.forEach(
      (report, index) => {
        reportText +=
          `${index + 1}. @${report.target.split("@")[0]}\n` +
          `👤 By: @${report.reporter.split("@")[0]}\n` +
          `📝 ${report.reason}\n` +
          `📅 ${report.time}\n` +
          `━━━━━━━━━━━━━━\n`;

        mentions.push(
          report.target,
          report.reporter
        );
      }
    );

    await sock.sendMessage(
      groupId,
      {
        text: reportText,
        mentions: [
          ...new Set(mentions)
        ]
      }
    );

    return true;
  }

  /* =========================================
     ADMIN PANEL
  ========================================= */

  if (command === "adminpanel") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🛠️ *ADMIN PANEL*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${status.enabled ? "🟢 ON" : "🔴 OFF"}

👋 Welcome:
${status.welcomeEnabled ? "🟢 ON" : "🔴 OFF"}

🚫 Disabled Commands:
${
  status.disabledCommands.length
    ? status.disabledCommands.join(", ")
    : "None"
}

📌 Commands:

/boton
/botoff

/welcomeon
/welcomeoff

/on command
/off command

/cmdlist
/fullbotstatus

/allowback @user
/unleave @user

/reports
`
      }
    );

    return true;
  }

  /* =========================================
     CMDLIST
  ========================================= */

  if (command === "cmdlist") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text:
          `📋 *COMMAND LIST*\n\n` +
          COMMAND_NAMES
            .map(
              x => `/${x}`
            )
            .join("\n")
      }
    );

    return true;
  }

  /* =========================================
     BOT ON
  ========================================= */

  if (
    command === "boton" ||
    command === "onbot"
  ) {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    status.enabled = true;
    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          "🤖 Bot successfully turned ON. 🟢"
      }
    );

    return true;
  }

  /* =========================================
     BOT OFF
  ========================================= */

  if (
    command === "botoff" ||
    command === "offbot"
  ) {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    status.enabled = false;
    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          "🤖 Bot successfully turned OFF. 🔴\n\nAdmin commands will still work."
      }
    );

    return true;
  }

  /* =========================================
     ON COMMAND
  ========================================= */

  if (command === "on") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    const target =
      args.toLowerCase().replace(
        /^\//,
        ""
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ ব্যবহার:\n/on command"
        }
      );

      return true;
    }

    status.disabledCommands =
      status.disabledCommands.filter(
        x => x !== target
      );

    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          `✅ /${target} command ON করা হয়েছে।`
      }
    );

    return true;
  }

  /* =========================================
     OFF COMMAND
  ========================================= */

  if (command === "off") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    const target =
      args.toLowerCase().replace(
        /^\//,
        ""
      );

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ ব্যবহার:\n/off command"
        }
      );

      return true;
    }

    if (
      !status.disabledCommands.includes(
        target
      )
    ) {
      status.disabledCommands.push(
        target
      );
    }

    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          `🔴 /${target} command OFF করা হয়েছে।`
      }
    );

    return true;
  }

  /* =========================================
     FULL STATUS
  ========================================= */

  if (
    command === "fullbotstatus"
  ) {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    await sock.sendMessage(
      groupId,
      {
        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
      📊 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${status.enabled ? "🟢 ON" : "🔴 OFF"}

👋 Welcome:
${status.welcomeEnabled ? "🟢 ON" : "🔴 OFF"}

🚫 Disabled:
${
  status.disabledCommands.length
    ? status.disabledCommands.join(", ")
    : "None"
}

🔞 Image Moderation:
${IMAGE_MODERATION_ENABLED ? "🟢 ON" : "🔴 OFF"}

🤬 Text Moderation:
${TEXT_MODERATION_ENABLED ? "🟢 ON" : "🔴 OFF"}

🔗 Link Protection:
🟢 ON

🚫 Leave Blacklist:
🟢 ON

🚨 Report System:
🟢 ON
`
      }
    );

    return true;
  }

  /* =========================================
     WELCOME ON
  ========================================= */

  if (command === "welcomeon") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    status.welcomeEnabled = true;
    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          "👋 Welcome message ON করা হয়েছে। 🟢"
      }
    );

    return true;
  }

  /* =========================================
     WELCOME OFF
  ========================================= */

  if (command === "welcomeoff") {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ Admin only."
        }
      );

      return true;
    }

    status.welcomeEnabled = false;
    saveStatus();

    await sock.sendMessage(
      groupId,
      {
        text:
          "👋 Welcome message OFF করা হয়েছে। 🔴"
      }
    );

    return true;
  }

  /* =========================================
     ALLOW BACK
  ========================================= */

  if (
    command === "allowback" ||
    command === "unleave"
  ) {
    const allowed =
      await canControlBot(
        sock,
        groupId,
        sender
      );

    if (!allowed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ এই command শুধু Admin ব্যবহার করতে পারবেন।"
        }
      );

      return true;
    }

    const target =
      getMentionedUser(message);

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ ব্যবহার করুন:\n/allowback @user"
        }
      );

      return true;
    }

    const removed =
      removeLeaveBlacklist(
        groupId,
        target
      );

    if (removed) {
      await sock.sendMessage(
        groupId,
        {
          text:
            `✅ @${target.split("@")[0]}-এর self-leave blacklist তুলে দেওয়া হয়েছে।\n\nএখন Admin চাইলে তাকে আবার Group-এ Add করতে পারবেন।`,
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
            "ℹ️ এই সদস্য Leave blacklist-এ নেই।"
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
  message
) {
  try {
    if (!message?.key) {
      return;
    }

    const groupId =
      message.key.remoteJid;

    if (
      !groupId ||
      !groupId.endsWith("@g.us")
    ) {
      return;
    }

    if (!isAllowedGroup(groupId)) {
      return;
    }

    const status =
      ensureGroupStatus(groupId);

    const text =
      getMessageText(message);

    const {
      command
    } = parseCommand(text);

    /*
     Admin commands work even when
     normal bot is OFF.
    */

    const adminCommands = [
      "adminpanel",
      "cmdlist",
      "on",
      "off",
      "boton",
      "botoff",
      "onbot",
      "offbot",
      "fullbotstatus",
      "allowback",
      "unleave",
      "welcomeon",
      "welcomeoff",
      "reports"
    ];

    if (
      command &&
      adminCommands.includes(command)
    ) {
      await handleCommand(
        sock,
        groupId,
        message
      );

      return;
    }

    if (!status.enabled) {
      return;
    }

    /* =========================================
       MODERATION FIRST
    ========================================= */

    const moderated =
      await moderateGroupMessage(
        sock,
        groupId,
        message
      );

    if (moderated) {
      return;
    }

    /* =========================================
       LINK
    ========================================= */

    const linkDeleted =
      await moderateLink(
        sock,
        groupId,
        message
      );

    if (linkDeleted) {
      return;
    }

    /* =========================================
       DUPLICATE SPAM
    ========================================= */

    const spamDeleted =
      await moderateDuplicateSpam(
        sock,
        groupId,
        message
      );

    if (spamDeleted) {
      return;
    }

    /* =========================================
       COMMAND
    ========================================= */

    if (command) {
      await handleCommand(
        sock,
        groupId,
        message
      );
    }
  } catch (err) {
    console.error(
      "Message handler error:",
      err.message
    );
  }
}

/* =========================================================
   CONNECT BOT
========================================================= */

let reconnectTimer = null;
let shuttingDown = false;

async function startBot() {
  try {
    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      AUTH_DIR
    );

    const {
      version
    } = await fetchLatestBaileysVersion();

    const sock =
      makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: [
          "PIYAS BOT",
          "Chrome",
          "1.0.0"
        ],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false
      });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    /* =========================================
       CONNECTION
    ========================================= */

    sock.ev.on(
      "connection.update",
      async update => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (connection === "open") {
          console.log(
            "================================"
          );

          console.log(
            "🤖 PIYAS BOT CONNECTED"
          );

          console.log(
            `👤 ${sock.user?.id || ""}`
          );

          console.log(
            "================================"
          );
        }

        if (connection === "close") {
          if (shuttingDown) {
            return;
          }

          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output?.statusCode;

          console.log(
            "Connection closed:",
            statusCode
          );

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              "❌ Logged out. Delete auth_info and pair again."
            );

            return;
          }

          if (reconnectTimer) {
            clearTimeout(
              reconnectTimer
            );
          }

          reconnectTimer =
            setTimeout(() => {
              console.log(
                "🔄 Reconnecting..."
              );

              startBot();
            }, 5000);
        }
      }
    );

    /* =========================================
       GROUP PARTICIPANTS
    ========================================= */

    sock.ev.on(
      "group-participants.update",
      async update => {
        await handleParticipantUpdate(
          sock,
          update
        );
      }
    );

    /* =========================================
       MESSAGES
    ========================================= */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type
      }) => {
        if (type !== "notify") {
          return;
        }

        for (const message of messages) {
          await handleIncomingMessage(
            sock,
            message
          );
        }
      }
    );

    return sock;
  } catch (err) {
    console.error(
      "START BOT ERROR:",
      err
    );

    if (!shuttingDown) {
      setTimeout(
        startBot,
        10000
      );
    }
  }
}

/* =========================================================
   SHUTDOWN
========================================================= */

async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    "\n🛑 PIYAS BOT shutting down..."
  );

  saveStatus();

  writeJson(
    LEAVE_BLACKLIST_FILE,
    leaveBlacklist
  );

  writeJson(
    REPORT_FILE,
    reports
  );

  process.exit(0);
}

process.on(
  "SIGINT",
  shutdown
);

process.on(
  "SIGTERM",
  shutdown
);

/* =========================================================
   START
========================================================= */

console.log(
  "================================"
);

console.log(
  "🤖 PIYAS BOT STARTING..."
);

console.log(
  `🌐 Website: ${WEBSITE_URL}`
);

console.log(
  `🔞 Image Moderation: ${
    IMAGE_MODERATION_ENABLED
      ? "ON"
      : "OFF"
  }`
);

console.log(
  `🤬 Text Moderation: ${
    TEXT_MODERATION_ENABLED
      ? "ON"
      : "OFF"
  }`
);

console.log(
  `🚫 Leave Blacklist: ON`
);

console.log(
  `🚨 Report System: ON`
);

console.log(
  "================================"
);

startBot();