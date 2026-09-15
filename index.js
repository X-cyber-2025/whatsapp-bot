import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  areJidsSameUser,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

import P from "pino";
import dotenv from "dotenv";
import { Boom } from "@hapi/boom";
import http from "http";
import fs from "fs";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER = String(
  process.env.PHONE_NUMBER || ""
).replace(/\D/g, "");

const OPENAI_API_KEY = String(
  process.env.OPENAI_API_KEY || ""
).trim();

const WEBSITE_URL =
  process.env.WEBSITE_URL ||
  "https://x-cyber-2025.github.io/X-cyber.web/";

const AUTH_DIR = "./auth_info";
const STATUS_FILE = "./bot_status.json";

const ALLOWED_GROUPS = String(
  process.env.ALLOWED_GROUPS || ""
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const IMAGE_MODERATION_ENABLED =
  String(
    process.env.IMAGE_MODERATION_ENABLED || "true"
  ).toLowerCase() === "true";

const TEXT_MODERATION_ENABLED =
  String(
    process.env.TEXT_MODERATION_ENABLED || "true"
  ).toLowerCase() === "true";

/*
  Application-defined threshold.
  This is NOT an official OpenAI threshold.

  Lower = stricter
  Higher = less strict
*/
const IMAGE_SEXUAL_SCORE_THRESHOLD = Number(
  process.env.IMAGE_SEXUAL_SCORE_THRESHOLD || 0.30
);

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

const logger = P({
  level: "silent",
});

/* =========================================================
   HTTP SERVER
========================================================= */

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type":
        "text/plain; charset=utf-8",
    });

    res.end("PIYAS BOT is running.");
  })
  .listen(PORT, () => {
    console.log(
      `HTTP server running on port ${PORT}`
    );
  });

/* =========================================================
   DIRECTORY
========================================================= */

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, {
    recursive: true,
  });
}

/* =========================================================
   JSON HELPERS
========================================================= */

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.error(
      "READ JSON ERROR:",
      error?.message || error
    );

    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      "WRITE JSON ERROR:",
      error?.message || error
    );
  }
}

/* =========================================================
   BOT STATUS
========================================================= */

let botStatus = readJson(
  STATUS_FILE,
  {}
);

function getGroupStatus(groupId) {
  if (!botStatus[groupId]) {
    botStatus[groupId] = {
      enabled: true,
      welcomeEnabled: true,
      disabledCommands: [],
    };

    writeJson(
      STATUS_FILE,
      botStatus
    );
  }

  return botStatus[groupId];
}

function isCommandDisabled(
  groupId,
  command
) {
  const status =
    getGroupStatus(groupId);

  return status.disabledCommands.includes(
    command.toLowerCase()
  );
}

function setCommandStatus(
  groupId,
  command,
  enabled
) {
  const status =
    getGroupStatus(groupId);

  const cmd =
    command.toLowerCase();

  if (enabled) {
    status.disabledCommands =
      status.disabledCommands.filter(
        (x) => x !== cmd
      );
  } else {
    if (
      !status.disabledCommands.includes(
        cmd
      )
    ) {
      status.disabledCommands.push(
        cmd
      );
    }
  }

  writeJson(
    STATUS_FILE,
    botStatus
  );
}

/* =========================================================
   CONTACT CACHE
========================================================= */

const contactCache =
  new Map();

function cacheContact(
  jid,
  name
) {
  if (!jid || !name) {
    return;
  }

  contactCache.set(
    jidNormalizedUser(jid),
    name
  );
}

function getContactName(jid) {
  if (!jid) {
    return "";
  }

  return (
    contactCache.get(
      jidNormalizedUser(jid)
    ) ||
    jid.split("@")[0] ||
    ""
  );
}

/* =========================================================
   GROUP CACHE
========================================================= */

const groupMetadataCache =
  new Map();

async function getGroupMetadata(
  sock,
  groupId,
  force = false
) {
  if (
    !force &&
    groupMetadataCache.has(groupId)
  ) {
    return groupMetadataCache.get(
      groupId
    );
  }

  const metadata =
    await sock.groupMetadata(
      groupId
    );

  groupMetadataCache.set(
    groupId,
    metadata
  );

  return metadata;
}

/* =========================================================
   JID HELPERS
========================================================= */

function normalizeJid(jid) {
  if (!jid) {
    return "";
  }

  try {
    return jidNormalizedUser(
      jid
    );
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

function getSenderJid(message) {
  return (
    message?.key?.participant ||
    message?.key?.participantAlt ||
    message?.participant ||
    message?.key?.remoteJid ||
    ""
  );
}

/* =========================================================
   OWNER CHECK
========================================================= */

function isOwner(jid) {
  if (
    !PHONE_NUMBER ||
    !jid
  ) {
    return false;
  }

  const ownerNumber =
    PHONE_NUMBER.replace(
      /\D/g,
      ""
    );

  const senderNumber =
    String(jid)
      .split("@")[0]
      .split(":")[0]
      .replace(/\D/g, "");

  return (
    ownerNumber ===
    senderNumber
  );
}

/* =========================================================
   ADMIN CHECK
========================================================= */

async function getAdminInfo(
  sock,
  groupId,
  senderJid
) {
  try {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId
      );

    const participants =
      metadata?.participants ||
      [];

    const sender =
      participants.find(
        (p) =>
          sameUser(
            p.id,
            senderJid
          ) ||
          sameUser(
            p.jid,
            senderJid
          ) ||
          sameUser(
            p.lid,
            senderJid
          ) ||
          sameUser(
            p.phoneNumber,
            senderJid
          )
      );

    const admins =
      participants.filter(
        (p) =>
          p.admin === "admin" ||
          p.admin === "superadmin"
      );

    const senderIsAdmin =
      !!sender &&
      (
        sender.admin === "admin" ||
        sender.admin ===
          "superadmin"
      );

    const botJid =
      sock?.user?.id;

    const botParticipant =
      participants.find(
        (p) =>
          sameUser(
            p.id,
            botJid
          ) ||
          sameUser(
            p.jid,
            botJid
          ) ||
          sameUser(
            p.lid,
            botJid
          ) ||
          sameUser(
            p.phoneNumber,
            botJid
          )
      );

    const botIsAdmin =
      !!botParticipant &&
      (
        botParticipant.admin ===
          "admin" ||
        botParticipant.admin ===
          "superadmin"
      );

    return {
      metadata,
      participants,
      sender,
      senderIsAdmin,
      botParticipant,
      botIsAdmin,
      admins,
    };
  } catch (error) {
    console.error(
      "ADMIN CHECK ERROR:",
      error?.message || error
    );

    return {
      metadata: null,
      participants: [],
      sender: null,
      senderIsAdmin: false,
      botParticipant: null,
      botIsAdmin: false,
      admins: [],
    };
  }
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(
  message
) {
  const m =
    message?.message;

  if (!m) {
    return "";
  }

  return (
    m.conversation ||
    m.extendedTextMessage
      ?.text ||
    m.imageMessage
      ?.caption ||
    m.videoMessage
      ?.caption ||
    m.documentMessage
      ?.caption ||
    m.buttonsResponseMessage
      ?.selectedButtonId ||
    m.listResponseMessage
      ?.singleSelectReply
      ?.selectedRowId ||
    m.templateButtonReplyMessage
      ?.selectedId ||
    ""
  );
}

/* =========================================================
   COMMAND
========================================================= */

function getCommand(text) {
  if (!text) {
    return null;
  }

  const match =
    String(text)
      .trim()
      .match(
        /^[/!.\-]([^\s]+)/i
      );

  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function getCommandArgs(text) {
  if (!text) {
    return [];
  }

  return String(text)
    .trim()
    .split(/\s+/)
    .slice(1);
}

/* =========================================================
   TEXT NORMALIZATION
========================================================= */

function normalizeText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[\u200B-\u200D\uFEFF]/g,
      ""
    )
    .replace(
      /[ًٌٍَُِّْـ]/g,
      ""
    )
    .replace(
      /[\u0610-\u061A\u064B-\u065F]/g,
      ""
    )
    .replace(
      /[.,!?;:'"`~@#$%^&*()[\]{}<>+=|\\/_-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

/* =========================================================
   BAD WORDS
========================================================= */

const BAD_WORD_PATTERNS = [

  /* Bangla */

  /শালা/i,
  /সালা/i,
  /শালার/i,
  /সালার/i,

  /খানকি/i,
  /খানকির/i,
  /খানকিকে/i,

  /চোদ/i,
  /চুদ/i,
  /চোদা/i,
  /চুদা/i,
  /চুদাচুদি/i,

  /মাদারচোদ/i,
  /মাদারচুদ/i,

  /বোকাচোদা/i,
  /বোকাচুদা/i,

  /বাল/i,
  /বালের/i,

  /হারামি/i,
  /হারামজাদা/i,
  /হারামজাদী/i,

  /কুত্তা/i,
  /কুত্তার/i,

  /লুচ্চা/i,
  /লুচ্চামি/i,

  /বেশ্যা/i,
  /পতিতা/i,

  /* English */

  /fuck/i,
  /fucking/i,
  /fucker/i,
  /motherfucker/i,

  /bitch/i,
  /slut/i,
  /whore/i,

  /dick/i,
  /pussy/i,

  /porn/i,
  /porno/i,

  /nude/i,
  /naked/i,

  /boobs/i,
  /breast/i,

  /xxx/i,
  /sex/i,
];

/* =========================================================
   BAD WORD CHECK
========================================================= */

function containsLocalBadWord(
  text
) {
  const normalized =
    normalizeText(text);

  if (!normalized) {
    return false;
  }

  return BAD_WORD_PATTERNS.some(
    (pattern) =>
      pattern.test(
        normalized
      )
  );
}

/* =========================================================
   OPENAI MODERATION
========================================================= */

async function openAIModeration(
  input
) {
  if (!OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY is missing."
    );

    return null;
  }

  try {
    const response =
      await fetch(
        "https://api.openai.com/v1/moderations",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${OPENAI_API_KEY}`,

            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            model:
              "omni-moderation-latest",

            input,
          }),
        }
      );

    const raw =
      await response.text();

    if (!response.ok) {
      console.error(
        "OPENAI MODERATION HTTP ERROR:",
        response.status,
        raw
      );

      return null;
    }

    const data =
      JSON.parse(raw);

    return (
      data?.results?.[0] ||
      null
    );
  } catch (error) {
    console.error(
      "OPENAI MODERATION ERROR:",
      error?.message || error
    );

    return null;
  }
}

/* =========================================================
   TEXT MODERATION
========================================================= */

async function moderateText(
  text
) {
  if (
    !text ||
    !TEXT_MODERATION_ENABLED
  ) {
    return {
      bad: false,
    };
  }

  /*
    First local check.
    This catches Bangla spelling variations
    immediately without API dependency.
  */

  if (
    containsLocalBadWord(
      text
    )
  ) {
    return {
      bad: true,
      source: "local",
      reason: "bad_word",
    };
  }

  /*
    OpenAI check.
  */

  if (!OPENAI_API_KEY) {
    return {
      bad: false,
      source: "no_api_key",
    };
  }

  const result =
    await openAIModeration([
      {
        type: "text",
        text: String(text),
      },
    ]);

  if (!result) {
    return {
      bad: false,
      source: "api_error",
    };
  }

  const categories =
    result.categories || {};

  const sexual =
    categories.sexual === true ||
    categories[
      "sexual/minors"
    ] === true;

  const harassment =
    categories.harassment === true ||
    categories[
      "harassment/threatening"
    ] === true;

  const violence =
    categories.violence === true ||
    categories[
      "violence/graphic"
    ] === true;

  if (
    sexual ||
    harassment ||
    violence
  ) {
    return {
      bad: true,
      source: "openai",
      reason: "moderation",
      result,
    };
  }

  return {
    bad: false,
    source: "openai",
    result,
  };
}

/* =========================================================
   IMAGE MODERATION
========================================================= */

async function moderateImage(
  message,
  sock
) {
  if (
    !IMAGE_MODERATION_ENABLED
  ) {
    return {
      bad: false,
      source: "disabled",
    };
  }

  if (!OPENAI_API_KEY) {
    console.error(
      "IMAGE MODERATION: OPENAI_API_KEY missing."
    );

    return {
      bad: false,
      source: "no_api_key",
    };
  }

  try {
    console.log(
      "IMAGE MODERATION: downloading image..."
    );

    const buffer =
      await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger,

          reuploadRequest:
            sock.updateMediaMessage,
        }
      );

    if (
      !buffer ||
      !buffer.length
    ) {
      console.error(
        "IMAGE MODERATION: empty buffer."
      );

      return {
        bad: false,
        source: "download_failed",
      };
    }

    const imageMessage =
      message?.message
        ?.imageMessage || {};

    const mimeType =
      imageMessage.mimetype ||
      "image/jpeg";

    const base64 =
      Buffer.from(
        buffer
      ).toString("base64");

    const dataUrl =
      `data:${mimeType};base64,${base64}`;

    console.log(
      "IMAGE MODERATION: sending image to moderation API..."
    );

    const result =
      await openAIModeration([
        {
          type: "image_url",

          image_url: {
            url: dataUrl,
          },
        },
      ]);

    if (!result) {
      console.error(
        "IMAGE MODERATION: API returned no result."
      );

      return {
        bad: false,
        source: "api_error",
      };
    }

    const categories =
      result.categories || {};

    const scores =
      result.category_scores || {};

    const sexualScore =
      Number(
        scores.sexual || 0
      );

    const sexualMinorsScore =
      Number(
        scores[
          "sexual/minors"
        ] || 0
      );

    const sexualFlag =
      categories.sexual === true;

    const sexualMinorsFlag =
      categories[
        "sexual/minors"
      ] === true;

    /*
      Normal image:
      sexual false + low score
      = KEEP

      Explicit / sexual:
      official category flag OR
      score crosses our configured threshold
      = DELETE
    */

    const scoreTriggered =
      sexualScore >=
        IMAGE_SEXUAL_SCORE_THRESHOLD ||
      sexualMinorsScore >=
        IMAGE_SEXUAL_SCORE_THRESHOLD;

    const bad =
      sexualFlag ||
      sexualMinorsFlag ||
      scoreTriggered;

    console.log(
      "IMAGE MODERATION RESULT:",
      JSON.stringify(
        {
          flagged:
            result.flagged,

          sexual:
            sexualFlag,

          sexualMinors:
            sexualMinorsFlag,

          sexualScore,

          sexualMinorsScore,

          threshold:
            IMAGE_SEXUAL_SCORE_THRESHOLD,

          delete:
            bad,
        },
        null,
        2
      )
    );

    return {
      bad,
      source: "openai",
      sexualScore,
      sexualMinorsScore,
      result,
    };
  } catch (error) {
    console.error(
      "IMAGE MODERATION ERROR:",
      error?.message || error
    );

    return {
      bad: false,
      source: "exception",
    };
  }
}

/* =========================================================
   DELETE MESSAGE
========================================================= */

async function deleteMessage(
  sock,
  groupId,
  message
) {
  try {
    await sock.sendMessage(
      groupId,
      {
        delete:
          message.key,
      }
    );

    console.log(
      "MESSAGE DELETED:",
      message?.key?.id ||
        "unknown"
    );

    return true;
  } catch (error) {
    console.error(
      "DELETE MESSAGE ERROR:",
      error?.message || error
    );

    return false;
  }
}

/* =========================================================
   MODERATION WARNING
========================================================= */

async function sendModerationWarning(
  sock,
  groupId,
  senderJid,
  reason
) {
  try {
    let text =
      "⚠️ *মেসেজ সরানো হয়েছে!*\n\n" +
      "🚫 এই গ্রুপে অশালীন বা আপত্তিকর কনটেন্ট অনুমোদিত নয়।";

    if (
      reason === "bad_word"
    ) {
      text =
        "⚠️ *মেসেজ সরানো হয়েছে!*\n\n" +
        "🚫 এই গ্রুপে গালিগালাজ বা অশালীন শব্দ ব্যবহার করা যাবে না।";
    }

    if (
      reason ===
      "sexual_image"
    ) {
      text =
        "⚠️ *ছবিটি সরানো হয়েছে!*\n\n" +
        "🚫 এই গ্রুপে অশালীন বা যৌনধর্মী ছবি অনুমোদিত নয়।";
    }

    await sock.sendMessage(
      groupId,
      {
        text,

        mentions:
          senderJid
            ? [senderJid]
            : [],
      }
    );
  } catch (error) {
    console.error(
      "WARNING ERROR:",
      error?.message || error
    );
  }
}

/* =========================================================
   LINK DETECTOR
========================================================= */

function containsLink(text) {
  if (!text) {
    return false;
  }

  return /(https?:\/\/|www\.|t\.me\/|chat\.whatsapp\.com\/|wa\.me\/)/i.test(
    text
  );
}

/* =========================================================
   DUPLICATE SPAM
========================================================= */

const duplicateCache =
  new Map();

function isDuplicateMessage(
  senderJid,
  text
) {
  if (
    !senderJid ||
    !text
  ) {
    return false;
  }

  const key =
    normalizeJid(
      senderJid
    ) +
    "|" +
    normalizeText(text);

  const now =
    Date.now();

  const previous =
    duplicateCache.get(
      key
    );

  duplicateCache.set(
    key,
    now
  );

  return (
    !!previous &&
    now - previous <=
      DUPLICATE_WINDOW_MS
  );
}

/* =========================================================
   GROUP MODERATION
========================================================= */

async function moderateGroupMessage(
  sock,
  message
) {
  const groupId =
    message?.key?.remoteJid;

  if (
    !groupId ||
    !groupId.endsWith(
      "@g.us"
    )
  ) {
    return false;
  }

  const status =
    getGroupStatus(
      groupId
    );

  if (!status.enabled) {
    return false;
  }

  const senderJid =
    getSenderJid(
      message
    );

  const {
    senderIsAdmin,
    botIsAdmin,
  } =
    await getAdminInfo(
      sock,
      groupId,
      senderJid
    );

  /*
    Owner/Admin bypass.
  */

  if (
    senderIsAdmin ||
    isOwner(senderJid)
  ) {
    return false;
  }

  /*
    Bot must be admin to delete.
  */

  if (!botIsAdmin) {
    console.log(
      `[${groupId}] BOT IS NOT ADMIN`
    );

    return false;
  }

  const messageType =
    getContentType(
      message.message
    );

  /* =======================================================
     IMAGE
  ======================================================= */

  if (
    messageType ===
    "imageMessage"
  ) {
    const imageResult =
      await moderateImage(
        message,
        sock
      );

    if (
      imageResult.bad
    ) {
      const deleted =
        await deleteMessage(
          sock,
          groupId,
          message
        );

      if (deleted) {
        await sendModerationWarning(
          sock,
          groupId,
          senderJid,
          "sexual_image"
        );
      }

      return deleted;
    }
  }

  /* =======================================================
     TEXT / CAPTION
  ======================================================= */

  const text =
    getMessageText(
      message
    );

  if (text) {
    const textResult =
      await moderateText(
        text
      );

    if (
      textResult.bad
    ) {
      const deleted =
        await deleteMessage(
          sock,
          groupId,
          message
        );

      if (deleted) {
        await sendModerationWarning(
          sock,
          groupId,
          senderJid,
          textResult.reason
        );
      }

      return deleted;
    }
  }

  /* =======================================================
     LINK
  ======================================================= */

  if (
    text &&
    containsLink(text)
  ) {
    const deleted =
      await deleteMessage(
        sock,
        groupId,
        message
      );

    if (deleted) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "🚫 *লিংক পাঠানো যাবে না।*\n\n" +
            "এই গ্রুপে অনুমতি ছাড়া লিংক শেয়ার করা নিষিদ্ধ।",
        }
      );
    }

    return deleted;
  }

  /* =======================================================
     DUPLICATE
  ======================================================= */

  if (
    text &&
    isDuplicateMessage(
      senderJid,
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
      await sock.sendMessage(
        groupId,
        {
          text:
            "⚠️ *Duplicate message detected.*\n\n" +
            "একই মেসেজ বারবার পাঠাবেন না।",
        }
      );
    }

    return deleted;
  }

  return false;
}

/* =========================================================
   MENU
========================================================= */

async function sendMenu(
  sock,
  groupId
) {
  const text =
    "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
    "        🤖 *PIYAS BOT*\n" +
    "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

    "📌 *GENERAL COMMANDS*\n\n" +

    "▫️ /menu - Bot menu\n" +
    "▫️ /bot - Bot status\n" +
    "▫️ /rules - Group rules\n" +
    "▫️ /admin - Admin list\n" +
    "▫️ /members - Member count\n" +
    "▫️ /groupinfo - Group info\n" +
    "▫️ /id - Group ID\n" +
    "▫️ /ping - Bot ping\n" +
    "▫️ /deal - Deal information\n" +
    "▫️ /ডিল - Deal information\n" +
    "▫️ /piyas - Piyas info\n" +
    "▫️ /website - Website\n\n" +

    "🔐 *ADMIN COMMANDS*\n\n" +

    "▫️ /adminpanel\n" +
    "▫️ /cmdlist\n" +
    "▫️ /on <command>\n" +
    "▫️ /off <command>\n" +
    "▫️ /boton\n" +
    "▫️ /botoff\n" +
    "▫️ /onbot\n" +
    "▫️ /offbot\n" +
    "▫️ /fullbotstatus\n\n" +

    "🛡️ *MODERATION*\n\n" +

    "✅ গালি শনাক্ত\n" +
    "✅ অশালীন শব্দ শনাক্ত\n" +
    "✅ যৌনধর্মী ছবি শনাক্ত\n" +
    "✅ Image caption check\n" +
    "✅ Link detection\n" +
    "✅ Duplicate spam detection\n\n" +

    "❤️ *PIYAS BOT*";

  await sock.sendMessage(
    groupId,
    {
      text,
    }
  );
}

/* =========================================================
   BOT STATUS
========================================================= */

async function sendBotStatus(
  sock,
  groupId
) {
  const status =
    getGroupStatus(
      groupId
    );

  const text =
    "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
    "        🤖 *BOT STATUS*\n" +
    "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

    `⚡ Bot: ${
      status.enabled
        ? "ON 🟢"
        : "OFF 🔴"
    }\n` +

    `👋 Welcome: ${
      status.welcomeEnabled
        ? "ON 🟢"
        : "OFF 🔴"
    }\n` +

    `🛡️ Moderation: ${
      status.enabled
        ? "ACTIVE 🟢"
        : "OFF 🔴"
    }\n\n` +

    `🚫 Disabled commands: ${
      status.disabledCommands
        .length
        ? status.disabledCommands.join(
            ", "
          )
        : "None"
    }`;

  await sock.sendMessage(
    groupId,
    {
      text,
    }
  );
}

/* =========================================================
   RULES
========================================================= */

async function sendRules(
  sock,
  groupId
) {
  const text =
    "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
    "          📜 *GROUP RULES*\n" +
    "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

    "1️⃣ গালিগালাজ করা যাবে না।\n" +
    "2️⃣ অশালীন বা যৌনধর্মী ছবি দেওয়া যাবে না।\n" +
    "3️⃣ অনুমতি ছাড়া লিংক দেওয়া যাবে না।\n" +
    "4️⃣ একই মেসেজ বারবার পাঠানো যাবে না।\n" +
    "5️⃣ Spam করা যাবে না।\n" +
    "6️⃣ Admin-এর নির্দেশনা মেনে চলতে হবে।\n" +
    "7️⃣ সবাইকে সম্মান করে কথা বলতে হবে।";

  await sock.sendMessage(
    groupId,
    {
      text,
    }
  );
}

/* =========================================================
   ADMIN LIST
========================================================= */

async function sendAdminList(
  sock,
  groupId
) {
  try {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId,
        true
      );

    const admins =
      (
        metadata
          ?.participants ||
        []
      ).filter(
        (p) =>
          p.admin === "admin" ||
          p.admin ===
            "superadmin"
      );

    if (!admins.length) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "❌ কোনো Admin পাওয়া যায়নি।",
        }
      );

      return;
    }

    let text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
      "          👑 *ADMINS*\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

    const mentions = [];

    admins.forEach(
      (admin, index) => {
        const jid =
          admin.id ||
          admin.jid ||
          admin.lid ||
          admin.phoneNumber;

        if (!jid) {
          return;
        }

        text +=
          `${index + 1}. @${jid
            .split("@")[0]
            .split(":")[0]}\n`;

        mentions.push(jid);
      }
    );

    await sock.sendMessage(
      groupId,
      {
        text,
        mentions,
      }
    );
  } catch (error) {
    console.error(
      "ADMIN LIST ERROR:",
      error?.message || error
    );
  }
}

/* =========================================================
   MEMBERS
========================================================= */

async function sendMembers(
  sock,
  groupId
) {
  try {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId,
        true
      );

    const count =
      metadata
        ?.participants
        ?.length || 0;

    await sock.sendMessage(
      groupId,
      {
        text:
          "👥 *GROUP MEMBERS*\n\n" +
          `Total Members: *${count}*`,
      }
    );
  } catch (error) {
    console.error(
      "MEMBERS ERROR:",
      error?.message || error
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "❌ Member information পাওয়া যায়নি।",
      }
    );
  }
}

/* =========================================================
   GROUP INFO
========================================================= */

async function sendGroupInfo(
  sock,
  groupId
) {
  try {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId,
        true
      );

    const participants =
      metadata
        ?.participants || [];

    const admins =
      participants.filter(
        (p) =>
          p.admin === "admin" ||
          p.admin ===
            "superadmin"
      ).length;

    const text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
      "       👥 *GROUP INFO*\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

      `📌 Group Name: *${
        metadata.subject ||
        "Unknown"
      }*\n` +

      `👥 Members: *${participants.length}*\n` +

      `👑 Admins: *${admins}*\n\n` +

      `🆔 Group ID:\n${groupId}`;

    await sock.sendMessage(
      groupId,
      {
        text,
      }
    );
  } catch (error) {
    console.error(
      "GROUP INFO ERROR:",
      error?.message || error
    );
  }
}

/* =========================================================
   PIYAS
========================================================= */

async function sendPiyas(
  sock,
  groupId
) {
  await sock.sendMessage(
    groupId,
    {
      text:
        "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
        "          👤 *PIYAS*\n" +
        "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

        "🌐 Website:\n" +
        WEBSITE_URL,
    }
  );
}

/* =========================================================
   WEBSITE
========================================================= */

async function sendWebsite(
  sock,
  groupId
) {
  await sock.sendMessage(
    groupId,
    {
      text:
        "🌐 *WEBSITE*\n\n" +
        WEBSITE_URL,
    }
  );
}

/* =========================================================
   DEAL
========================================================= */

async function sendDeal(
  sock,
  groupId
) {
  await sock.sendMessage(
    groupId,
    {
      text:
        "🔥 *DEAL NOTICE*\n\n" +
        "নতুন Deal / Offer জানতে Group-এ চোখ রাখুন।",
    }
  );
}

/* =========================================================
   ALL COMMANDS
========================================================= */

const ALL_COMMANDS = [
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
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "onbot",
  "offbot",
  "fullbotstatus",
];

/* =========================================================
   ADMIN PANEL
========================================================= */

async function sendAdminPanel(
  sock,
  groupId
) {
  await sock.sendMessage(
    groupId,
    {
      text:
        "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
        "       🔐 *ADMIN PANEL*\n" +
        "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

        "🤖 /boton\n" +
        "🔴 /botoff\n" +
        "🟢 /onbot\n" +
        "🔴 /offbot\n" +
        "📋 /fullbotstatus\n\n" +

        "⚙️ Command Control\n\n" +
        "/on <command>\n" +
        "/off <command>\n\n" +

        "Example:\n" +
        "/off website\n" +
        "/on website",
    }
  );
}

/* =========================================================
   ADMIN COMMAND HANDLER
========================================================= */

async function handleAdminCommand(
  sock,
  groupId,
  senderJid,
  command,
  args
) {
  const {
    senderIsAdmin,
  } =
    await getAdminInfo(
      sock,
      groupId,
      senderJid
    );

  if (
    !senderIsAdmin &&
    !isOwner(senderJid)
  ) {
    if (
      [
        "adminpanel",
        "cmdlist",
        "on",
        "off",
        "boton",
        "botoff",
        "onbot",
        "offbot",
        "fullbotstatus",
      ].includes(command)
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "⛔ এই command শুধুমাত্র Group Admin/Owner ব্যবহার করতে পারবেন।",
        }
      );

      return true;
    }

    return false;
  }

  if (
    command ===
    "adminpanel"
  ) {
    await sendAdminPanel(
      sock,
      groupId
    );

    return true;
  }

  if (
    command ===
    "cmdlist"
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          "📋 *COMMAND LIST*\n\n" +
          ALL_COMMANDS
            .map(
              (x) =>
                `▫️ /${x}`
            )
            .join("\n"),
      }
    );

    return true;
  }

  if (
    command === "on" ||
    command === "off"
  ) {
    const target =
      String(
        args[0] || ""
      )
        .replace(
          /^[/!.\-]/,
          ""
        )
        .toLowerCase();

    if (!target) {
      await sock.sendMessage(
        groupId,
        {
          text:
            "⚠️ Example:\n" +
            "/off website\n" +
            "/on website",
        }
      );

      return true;
    }

    if (
      !ALL_COMMANDS.includes(
        target
      )
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            `❌ /${target} command পাওয়া যায়নি।`,
        }
      );

      return true;
    }

    const enabled =
      command === "on";

    setCommandStatus(
      groupId,
      target,
      enabled
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          `${enabled ? "🟢" : "🔴"} /${target} ${
            enabled
              ? "ON"
              : "OFF"
          } করা হয়েছে।`,
      }
    );

    return true;
  }

  if (
    command === "boton" ||
    command === "onbot"
  ) {
    const status =
      getGroupStatus(
        groupId
      );

    status.enabled = true;

    writeJson(
      STATUS_FILE,
      botStatus
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "🟢 *BOT ON*\n\n" +
          "Bot এখন সক্রিয়।",
      }
    );

    return true;
  }

  if (
    command === "botoff" ||
    command === "offbot"
  ) {
    const status =
      getGroupStatus(
        groupId
      );

    status.enabled = false;

    writeJson(
      STATUS_FILE,
      botStatus
    );

    await sock.sendMessage(
      groupId,
      {
        text:
          "🔴 *BOT OFF*\n\n" +
          "Bot command system বন্ধ করা হয়েছে।",
      }
    );

    return true;
  }

  if (
    command ===
    "fullbotstatus"
  ) {
    await sendBotStatus(
      sock,
      groupId
    );

    return true;
  }

  return false;
}

/* =========================================================
   WELCOME
========================================================= */

async function sendWelcome(
  sock,
  groupId,
  participants
) {
  const status =
    getGroupStatus(
      groupId
    );

  if (
    !status.welcomeEnabled
  ) {
    return;
  }

  try {
    const metadata =
      await getGroupMetadata(
        sock,
        groupId,
        true
      );

    /*
      এখানে Group Name সরাসরি WhatsApp metadata
      থেকে নেওয়া হচ্ছে।

      তাই যে গ্রুপে bot থাকবে,
      welcome message-এ সেই গ্রুপের নাম দেখাবে।
    */

    const groupName =
      metadata?.subject ||
      "এই গ্রুপ";

    const mentions =
      participants || [];

    const mentionText =
      mentions
        .map(
          (jid) =>
            `@${jid
              .split("@")[0]
              .split(":")[0]}`
        )
        .join(" ");

    const text =
      "╭━━━━━━━━━━━━━━━━━━━━╮\n" +
      "        🎉 *স্বাগতম*\n" +
      "╰━━━━━━━━━━━━━━━━━━━━╯\n\n" +

      `🎉 *স্বাগতম ${mentionText}!* ❤️\n\n` +

      `🌸 আপনাকে *${groupName}* গ্রুপে স্বাগতম।\n\n` +

      "📜 Group Rules জানতে /rules লিখুন।\n" +
      "🤖 Bot Menu দেখতে /menu লিখুন।\n\n" +

      "💚 আশা করি সুন্দর সময় কাটাবেন।";

    await sock.sendMessage(
      groupId,
      {
        text,
        mentions,
      }
    );
  } catch (error) {
    console.error(
      "WELCOME ERROR:",
      error?.message || error
    );
  }
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(
  sock,
  message,
  command,
  args
) {
  const groupId =
    message?.key?.remoteJid;

  if (
    !groupId ||
    !groupId.endsWith(
      "@g.us"
    )
  ) {
    return;
  }

  const senderJid =
    getSenderJid(
      message
    );

  /*
    Admin commands.
  */

  const adminHandled =
    await handleAdminCommand(
      sock,
      groupId,
      senderJid,
      command,
      args
    );

  if (adminHandled) {
    return;
  }

  const status =
    getGroupStatus(
      groupId
    );

  if (!status.enabled) {
    return;
  }

  if (
    isCommandDisabled(
      groupId,
      command
    )
  ) {
    await sock.sendMessage(
      groupId,
      {
        text:
          `🔴 /${command} বর্তমানে বন্ধ আছে।`,
      }
    );

    return;
  }

  switch (command) {
    case "menu":
      await sendMenu(
        sock,
        groupId
      );
      break;

    case "bot":
      await sendBotStatus(
        sock,
        groupId
      );
      break;

    case "rules":
      await sendRules(
        sock,
        groupId
      );
      break;

    case "admin":
      await sendAdminList(
        sock,
        groupId
      );
      break;

    case "members":
      await sendMembers(
        sock,
        groupId
      );
      break;

    case "groupinfo":
      await sendGroupInfo(
        sock,
        groupId
      );
      break;

    case "id":
      await sock.sendMessage(
        groupId,
        {
          text:
            "🆔 *GROUP ID*\n\n" +
            `\`${groupId}\``,
        }
      );
      break;

    case "ping":
      await sock.sendMessage(
        groupId,
        {
          text:
            "🏓 *PONG!*\n\n" +
            "🤖 Bot is online.",
        }
      );
      break;

    case "deal":
    case "ডিল":
      await sendDeal(
        sock,
        groupId
      );
      break;

    case "piyas":
      await sendPiyas(
        sock,
        groupId
      );
      break;

    case "website":
      await sendWebsite(
        sock,
        groupId
      );
      break;

    default:
      break;
  }
}

/* =========================================================
   START BOT
========================================================= */

let reconnecting =
  false;

async function startBot() {
  const {
    state,
    saveCreds,
  } =
    await useMultiFileAuthState(
      AUTH_DIR
    );

  const sock =
    makeWASocket({
      auth: state,

      logger,

      printQRInTerminal:
        false,

      markOnlineOnConnect:
        false,

      syncFullHistory:
        false,

      generateHighQualityLinkPreview:
        true,
    });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  /* =======================================================
     CONNECTION UPDATE
  ======================================================= */

  sock.ev.on(
    "connection.update",
    async (update) => {
      const {
        connection,
        lastDisconnect,
      } = update;

      if (
        connection ===
        "open"
      ) {
        reconnecting =
          false;

        console.log(
          "================================="
        );

        console.log(
          "       PIYAS BOT CONNECTED"
        );

        console.log(
          "================================="
        );

        console.log(
          "Bot JID:",
          sock.user?.id
        );

        if (
          ALLOWED_GROUPS.length
        ) {
          console.log(
            "Allowed groups:",
            ALLOWED_GROUPS.join(
              ", "
            )
          );
        } else {
          console.log(
            "Allowed groups: ALL"
          );
        }

        console.log(
          "Image moderation:",
          IMAGE_MODERATION_ENABLED
        );

        console.log(
          "Text moderation:",
          TEXT_MODERATION_ENABLED
        );

        console.log(
          "Image threshold:",
          IMAGE_SEXUAL_SCORE_THRESHOLD
        );
      }

      if (
        connection ===
        "close"
      ) {
        const error =
          lastDisconnect
            ?.error;

        let statusCode;

        try {
          statusCode =
            new Boom(error)
              ?.output
              ?.statusCode;
        } catch {
          statusCode =
            undefined;
        }

        const shouldReconnect =
          statusCode !==
          DisconnectReason.loggedOut;

        console.error(
          "Connection closed:",
          statusCode
        );

        if (
          shouldReconnect &&
          !reconnecting
        ) {
          reconnecting =
            true;

          setTimeout(() => {
            startBot().catch(
              console.error
            );
          }, 3000);
        } else {
          console.log(
            "Bot logged out."
          );

          console.log(
            "Delete auth_info and pair again if required."
          );
        }
      }
    }
  );

  /* =======================================================
     GROUP PARTICIPANT UPDATE
  ======================================================= */

  sock.ev.on(
    "group-participants.update",
    async (update) => {
      try {
        const {
          id,
          participants,
          action,
        } = update;

        if (
          action === "add" &&
          participants?.length
        ) {
          await sendWelcome(
            sock,
            id,
            participants
          );
        }
      } catch (error) {
        console.error(
          "GROUP PARTICIPANT ERROR:",
          error?.message ||
            error
        );
      }
    }
  );

  /* =======================================================
     MESSAGES
  ======================================================= */

  sock.ev.on(
    "messages.upsert",
    async ({
      messages,
      type,
    }) => {
      if (
        type !== "notify" &&
        type !== "append"
      ) {
        return;
      }

      for (
        const message of messages
      ) {
        try {
          if (
            !message?.message
          ) {
            continue;
          }

          const groupId =
            message?.key
              ?.remoteJid;

          if (
            !groupId ||
            !groupId.endsWith(
              "@g.us"
            )
          ) {
            continue;
          }

          /*
            If ALLOWED_GROUPS is empty:
            all groups are allowed.

            If ALLOWED_GROUPS has IDs:
            only those groups are allowed.
          */

          if (
            ALLOWED_GROUPS.length &&
            !ALLOWED_GROUPS.includes(
              groupId
            )
          ) {
            continue;
          }

          /*
            Ignore messages sent by the bot itself.
          */

          if (
            message?.key?.fromMe
          ) {
            continue;
          }

          /*
            Cache sender name.
          */

          const senderJid =
            getSenderJid(
              message
            );

          if (
            senderJid &&
            message.pushName
          ) {
            cacheContact(
              senderJid,
              message.pushName
            );
          }

          /*
            IMPORTANT:

            Moderation runs BEFORE command parsing.

            So these are checked:

            সালা
            শালা
            খানকি
            খানকির
            fuck
            porn
            sexual image
            image caption
            links
            duplicate spam
          */

          const moderated =
            await moderateGroupMessage(
              sock,
              message
            );

          if (
            moderated
          ) {
            continue;
          }

          /*
            Now parse command.
          */

          const text =
            getMessageText(
              message
            );

          const command =
            getCommand(
              text
            );

          if (!command) {
            continue;
          }

          const args =
            getCommandArgs(
              text
            );

          await handleCommand(
            sock,
            message,
            command,
            args
          );
        } catch (error) {
          console.error(
            "MESSAGE HANDLER ERROR:",
            error?.message ||
              error
          );
        }
      }
    }
  );

  return sock;
}

/* =========================================================
   START
========================================================= */

startBot().catch(
  (error) => {
    console.error(
      "BOT START ERROR:",
      error
    );

    setTimeout(() => {
      startBot().catch(
        console.error
      );
    }, 5000);
  }
);

/* =========================================================
   SHUTDOWN
========================================================= */

process.on(
  "SIGINT",
  () => {
    console.log(
      "SIGINT received."
    );

    process.exit(0);
  }
);

process.on(
  "SIGTERM",
  () => {
    console.log(
      "SIGTERM received."
    );

    process.exit(0);
  }
);

process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "UNHANDLED REJECTION:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "UNCAUGHT EXCEPTION:",
      error
    );
  }
);