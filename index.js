import "dotenv/config";
import http from "http";
import fs from "fs";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  generateWAMessageFromContent,
  proto
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER = (process.env.PHONE_NUMBER || "")
  .replace(/[^0-9]/g, "");

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";

const AUTH_DIR = "./auth_info";
const PAIRING_NUMBER_FILE = "./pairing_number.txt";
const BOT_STATUS_FILE = "./bot_status.json";

/* =========================================================
   ALLOWED GROUPS
========================================================= */

const ALLOWED_GROUPS = [
  "120363428127558997@g.us",
  "120363410799321594@g.us"
];

let sock = null;
let reconnecting = false;
let pairingRequested = false;

const logger = P({
  level: "silent"
});

const contactNames = new Map();
const contactPhoneJids = new Map();
const lidToPhoneJid = new Map();

/* =========================================================
   COMMAND DEFINITIONS
========================================================= */

const COMMAND_DEFINITIONS = {
  menu: "menu",
  bot: "bot",
  rules: "rules",
  admin: "admin",
  members: "members",
  groupinfo: "groupinfo",
  id: "id",
  ping: "ping",
  deal: "deal",
  piyas: "piyas",
  website: "website"
};

const COMMAND_ALIASES = {
  "ডিল": "deal"
};

/* =========================================================
   ADMIN ONLY COMMANDS
========================================================= */

const ADMIN_ONLY_COMMANDS = new Set([
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "offbot",
  "onbot",
  "fullbotstatus"
]);

/* =========================================================
   PROTECTED COMMANDS
========================================================= */

const PROTECTED_COMMANDS = new Set([
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "offbot",
  "onbot",
  "fullbotstatus"
]);

/* =========================================================
   BOT STATUS
========================================================= */

let botStatus = {};

function loadBotStatus() {
  try {
    if (fs.existsSync(BOT_STATUS_FILE)) {
      botStatus = JSON.parse(
        fs.readFileSync(
          BOT_STATUS_FILE,
          "utf8"
        )
      );
    }
  } catch (e) {
    console.log(
      "Bot status load error:",
      e.message
    );

    botStatus = {};
  }

  for (const groupId of Object.keys(botStatus)) {
    if (
      typeof botStatus[groupId] ===
      "boolean"
    ) {
      botStatus[groupId] = {
        enabled:
          botStatus[groupId],
        disabledCommands: [],
        fullBotOff: false,
        adminAllowedCommands: []
      };
    }

    if (!botStatus[groupId]) {
      botStatus[groupId] = {};
    }

    botStatus[groupId].enabled =
      botStatus[groupId].enabled !== false;

    botStatus[groupId].disabledCommands =
      Array.isArray(
        botStatus[groupId]
          .disabledCommands
      )
        ? botStatus[groupId]
            .disabledCommands
        : [];

    botStatus[groupId].fullBotOff =
      botStatus[groupId]
        .fullBotOff === true;

    botStatus[groupId]
      .adminAllowedCommands =
      Array.isArray(
        botStatus[groupId]
          .adminAllowedCommands
      )
        ? botStatus[groupId]
            .adminAllowedCommands
        : [];
  }

  saveBotStatus();
}

function saveBotStatus() {
  try {
    fs.writeFileSync(
      BOT_STATUS_FILE,
      JSON.stringify(
        botStatus,
        null,
        2
      )
    );
  } catch (e) {
    console.log(
      "Bot status save error:",
      e.message
    );
  }
}

function ensureGroupStatus(groupId) {
  if (!botStatus[groupId]) {
    botStatus[groupId] = {
      enabled: true,
      disabledCommands: [],
      fullBotOff: false,
      adminAllowedCommands: []
    };
  }

  if (
    !Array.isArray(
      botStatus[groupId]
        .disabledCommands
    )
  ) {
    botStatus[groupId]
      .disabledCommands = [];
  }

  if (
    !Array.isArray(
      botStatus[groupId]
        .adminAllowedCommands
    )
  ) {
    botStatus[groupId]
      .adminAllowedCommands = [];
  }

  if (
    typeof botStatus[groupId]
      .enabled !== "boolean"
  ) {
    botStatus[groupId]
      .enabled = true;
  }

  if (
    typeof botStatus[groupId]
      .fullBotOff !== "boolean"
  ) {
    botStatus[groupId]
      .fullBotOff = false;
  }

  return botStatus[groupId];
}

function isBotEnabled(groupId) {
  return ensureGroupStatus(
    groupId
  ).enabled;
}

function setBotEnabled(
  groupId,
  enabled
) {
  ensureGroupStatus(
    groupId
  ).enabled = enabled;

  saveBotStatus();
}

function isCommandEnabled(
  groupId,
  command
) {
  return !ensureGroupStatus(
    groupId
  ).disabledCommands.includes(
    command
  );
}

function setCommandEnabled(
  groupId,
  command,
  enabled
) {
  const status =
    ensureGroupStatus(
      groupId
    );

  if (enabled) {
    status.disabledCommands =
      status.disabledCommands
        .filter(
          c => c !== command
        );
  } else if (
    !status.disabledCommands
      .includes(command)
  ) {
    status.disabledCommands
      .push(command);
  }

  saveBotStatus();
}

/* =========================================================
   FULL BOT OFF
========================================================= */

function isFullBotOff(groupId) {
  return ensureGroupStatus(
    groupId
  ).fullBotOff === true;
}

function setFullBotOff(
  groupId,
  enabled
) {
  ensureGroupStatus(
    groupId
  ).fullBotOff = enabled;

  saveBotStatus();
}

function getAdminAllowedCommands(
  groupId
) {
  return ensureGroupStatus(
    groupId
  ).adminAllowedCommands;
}

function setAdminAllowedCommands(
  groupId,
  commands
) {
  ensureGroupStatus(
    groupId
  ).adminAllowedCommands =
    [...new Set(commands)];

  saveBotStatus();
}

function normalizeCommand(
  command
) {
  let cmd =
    String(command || "")
      .trim()
      .toLowerCase();

  if (cmd.startsWith("/")) {
    cmd = cmd.slice(1);
  }

  if (COMMAND_ALIASES[cmd]) {
    cmd =
      COMMAND_ALIASES[cmd];
  }

  return cmd;
}

function isAdminAllowedCommand(
  groupId,
  command
) {
  const cmd =
    normalizeCommand(
      command
    );

  if (
    PROTECTED_COMMANDS.has(
      cmd
    )
  ) {
    return true;
  }

  return getAdminAllowedCommands(
    groupId
  ).includes(cmd);
}

/* =========================================================
   GROUP ACCESS
========================================================= */

function isGroupAllowed(
  groupId
) {
  return ALLOWED_GROUPS.includes(
    normalizeJid(groupId)
  );
}

/* =========================================================
   HTTP SERVER
========================================================= */

http
  .createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end(
        "PIYAS BOT is running.\n" +
        "Bot works only in configured Allowed Groups."
      );
    }
  )
  .listen(
    PORT,
    () => {
      console.log(
        `HTTP server running on port ${PORT}`
      );

      console.log(
        "━━━━━━━━━━━━━━━━━━━━"
      );

      console.log(
        "ALLOWED GROUPS:"
      );

      for (
        const groupId of
        ALLOWED_GROUPS
      ) {
        console.log(
          `✅ ${groupId}`
        );
      }

      console.log(
        "━━━━━━━━━━━━━━━━━━━━"
      );
    }
  );

/* =========================================================
   PAIRING NUMBER
========================================================= */

function readSavedPairingNumber() {
  try {
    if (
      fs.existsSync(
        PAIRING_NUMBER_FILE
      )
    ) {
      return fs
        .readFileSync(
          PAIRING_NUMBER_FILE,
          "utf8"
        )
        .trim()
        .replace(
          /[^0-9]/g,
          ""
        );
    }
  } catch {}

  return "";
}

function savePairingNumber(
  number
) {
  try {
    fs.writeFileSync(
      PAIRING_NUMBER_FILE,
      number
    );
  } catch {}
}

function getCredentialsNumber() {
  try {
    const file =
      `${AUTH_DIR}/creds.json`;

    if (
      !fs.existsSync(file)
    ) {
      return "";
    }

    const creds =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    return String(
      creds?.me?.id || ""
    )
      .split(":")[0]
      .split("@")[0]
      .replace(
        /[^0-9]/g,
        ""
      );
  } catch {
    return "";
  }
}

/* =========================================================
   AUTH NUMBER CHECK
========================================================= */

function resetAuthIfNumberChanged() {
  if (!PHONE_NUMBER) {
    return;
  }

  const savedNumber =
    readSavedPairingNumber();

  const credentialNumber =
    getCredentialsNumber();

  const knownNumber =
    credentialNumber ||
    savedNumber;

  if (
    knownNumber &&
    knownNumber !== PHONE_NUMBER
  ) {
    console.log(
      `Pairing number changed: ${knownNumber} -> ${PHONE_NUMBER}`
    );

    try {
      fs.rmSync(
        AUTH_DIR,
        {
          recursive: true,
          force: true
        }
      );
    } catch {}

    pairingRequested = false;
  }

  savePairingNumber(
    PHONE_NUMBER
  );
}

/* =========================================================
   JID HELPERS
========================================================= */

function normalizeJid(
  jid = ""
) {
  return String(jid)
    .trim()
    .toLowerCase();
}

function phoneFromJid(
  jid = ""
) {
  return String(jid)
    .split("@")[0]
    .split(":")[0]
    .replace(
      /[^0-9]/g,
      ""
    );
}

function isGroupJid(
  jid = ""
) {
  return jid.endsWith(
    "@g.us"
  );
}

function getBotJid() {
  return normalizeJid(
    sock?.user?.id || ""
  );
}

function getBotPhoneJid() {
  if (!PHONE_NUMBER) {
    return "";
  }

  return `${PHONE_NUMBER}@s.whatsapp.net`;
}

/* =========================================================
   NAME HELPERS
========================================================= */

function getPushName(
  message
) {
  return (
    message?.pushName ||
    message?.verifiedBizName ||
    "Unknown"
  );
}

function getParticipantName(
  participant
) {
  if (!participant) {
    return "Unknown";
  }

  const jid =
    normalizeJid(
      participant.id || ""
    );

  const phoneJid =
    contactPhoneJids.get(
      jid
    ) || jid;

  return (
    participant.notify ||
    participant.name ||
    participant.pushName ||
    contactNames.get(
      jid
    ) ||
    contactNames.get(
      phoneJid
    ) ||
    phoneFromJid(
      phoneJid
    ) ||
    "Unknown"
  );
}

/* =========================================================
   LID MAPPING
========================================================= */

function updateLidMapping(
  contact
) {
  if (!contact) {
    return;
  }

  const id =
    normalizeJid(
      contact.id || ""
    );

  const lid =
    normalizeJid(
      contact.lid || ""
    );

  const jid =
    normalizeJid(
      contact.jid || ""
    );

  if (lid && jid) {
    lidToPhoneJid.set(
      lid,
      jid
    );
  }

  if (
    id.endsWith("@lid") &&
    jid.endsWith(
      "@s.whatsapp.net"
    )
  ) {
    lidToPhoneJid.set(
      id,
      jid
    );
  }
}

/* =========================================================
   CONTACT CACHE
========================================================= */

function cacheContact(
  contact
) {
  if (!contact) {
    return;
  }

  const id =
    normalizeJid(
      contact.id || ""
    );

  const name =
    contact.notify ||
    contact.name ||
    contact.pushName ||
    contact.verifiedBizName;

  if (id && name) {
    contactNames.set(
      id,
      name
    );
  }

  const jid =
    normalizeJid(
      contact.jid || ""
    );

  if (
    id.endsWith("@lid") &&
    jid.endsWith(
      "@s.whatsapp.net"
    )
  ) {
    contactPhoneJids.set(
      id,
      jid
    );

    lidToPhoneJid.set(
      id,
      jid
    );
  }

  if (
    id.endsWith(
      "@s.whatsapp.net"
    )
  ) {
    contactPhoneJids.set(
      id,
      id
    );
  }

  updateLidMapping(
    contact
  );
}

/* =========================================================
   PARTICIPANT HELPERS
========================================================= */

function isAdminParticipant(
  participant
) {
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

function isOwnerParticipant(
  participant
) {
  if (!participant) {
    return false;
  }

  return (
    participant.admin ===
    "superadmin"
  );
}

function findParticipant(
  metadata,
  jid
) {
  const target =
    normalizeJid(jid);

  const participants =
    metadata?.participants ||
    [];

  return participants.find(
    p => {
      const pid =
        normalizeJid(
          p.id || ""
        );

      if (
        pid === target
      ) {
        return true;
      }

      if (
        pid.endsWith("@lid") &&
        target.endsWith(
          "@s.whatsapp.net"
        )
      ) {
        return (
          lidToPhoneJid.get(
            pid
          ) === target
        );
      }

      if (
        target.endsWith("@lid") &&
        pid.endsWith(
          "@s.whatsapp.net"
        )
      ) {
        return (
          lidToPhoneJid.get(
            target
          ) === pid
        );
      }

      return (
        phoneFromJid(
          pid
        ) ===
        phoneFromJid(
          target
        )
      );
    }
  );
}

/* =========================================================
   SENDER ADMIN
========================================================= */

async function isSenderAdmin(
  groupId,
  message
) {
  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const sender =
      message?.key
        ?.participant ||
      message?.participant ||
      "";

    const participant =
      findParticipant(
        metadata,
        sender
      );

    return isAdminParticipant(
      participant
    );
  } catch {
    return false;
  }
}

/* =========================================================
   COPY BUTTON
========================================================= */

function createCopyButton(
  command
) {
  return {
    name: "cta_copy",

    buttonParamsJson:
      JSON.stringify({
        display_text:
          "📋 Copy",

        id:
          `copy_${normalizeCommand(
            command
          )}`,

        copy_code:
          command
      })
  };
}

/* =========================================================
   SEND COPY BUTTON MESSAGE
========================================================= */

async function sendCopyButtonMessage(
  jid,
  command
) {
  try {
    const button =
      createCopyButton(
        command
      );

    const message =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create(
                    {
                      body:
                        proto.Message
                          .InteractiveMessage
                          .Body
                          .create(
                            {
                              text:
                                `📋 ${command}`
                            }
                          ),

                      nativeFlowMessage:
                        proto.Message
                          .InteractiveMessage
                          .NativeFlowMessage
                          .create(
                            {
                              buttons: [
                                button
                              ]
                            }
                          )
                    }
                  )
            }
          }
        },
        {
          userJid:
            jid
        }
      );

    await sock.relayMessage(
      jid,
      message.message,
      {
        messageId:
          message.key.id
      }
    );
  } catch (e) {
    console.log(
      "Copy button error:",
      e.message
    );
  }
}

/* =========================================================
   BOT MENU
========================================================= */

async function sendBotMenu(
  jid
) {
  /*
    WhatsApp native copy buttons-এর
    compatibility ভালো রাখার জন্য
    প্রতিটি command আলাদা Copy button
    message হিসেবে পাঠানো হচ্ছে।
  */

  const menuText = `
╭━━━━━━━━━━━━━━━━━━╮
       🤖 BOT MENU
╰━━━━━━━━━━━━━━━━━━╯

👥 GROUP COMMANDS
┌──────────────────
│ /menu
│ /bot
│ /rules
│ /admin
│ /members
│ /groupinfo
│ /id
└──────────────────

⚙️ UTILITY
┌──────────────────
│ /ping
└──────────────────

💰 BUY / SELL
┌──────────────────
│ /deal
│ /ডিল
└──────────────────

🤍 PIYAS
┌──────────────────
│ /piyas
└──────────────────

🌐 WEBSITE
┌──────────────────
│ /website
└──────────────────

━━━━━━━━━━━━━━━━━━
     ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`;

  /*
    আগে Menu text পাঠাবে
  */

  await sock.sendMessage(
    jid,
    {
      text:
        menuText
    }
  );

  /*
    তারপর প্রতিটি command-এর
    পাশে Copy button
  */

  const commands = [
    "/menu",
    "/bot",
    "/rules",
    "/admin",
    "/members",
    "/groupinfo",
    "/id",
    "/ping",
    "/deal",
    "/ডিল",
    "/piyas",
    "/website"
  ];

  /*
    একসাথে অনেক native button পাঠালে
    WhatsApp client-এ সমস্যা হতে পারে।
    তাই অল্প delay দিয়ে পাঠানো হচ্ছে।
  */

  for (
    const command of commands
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          150
        )
    );

    await sendCopyButtonMessage(
      jid,
      command
    );
  }
}

/* =========================================================
   ADMIN PANEL
========================================================= */

async function sendAdminPanel(
  jid
) {
  const text = `
╭━━━━━━━━━━━━━━━━━━╮
      👑 ADMIN PANEL
╰━━━━━━━━━━━━━━━━━━╯

⚙️ BOT CONTROL

• /boton
• /botoff

🔧 COMMAND CONTROL

• /on <command>
• /off <command>

🤖 FULL BOT CONTROL

• /offbot
• /offbot all
• /offbot none
• /offbot menu admin
• /onbot
• /fullbotstatus

📋 OTHER

• /cmdlist
• /adminpanel

━━━━━━━━━━━━━━━━━━
      ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`;

  await sock.sendMessage(
    jid,
    {
      text
    }
  );
}

/* =========================================================
   COMMAND LIST
========================================================= */

async function sendCommandList(
  jid
) {
  const text = `
╭━━━━━━━━━━━━━━━━━━╮
       📋 COMMAND LIST
╰━━━━━━━━━━━━━━━━━━╯

👥 GROUP

/menu
/bot
/rules
/admin
/members
/groupinfo
/id

⚙️ UTILITY

/ping

💰 DEAL

/deal
/ডিল

🤍 PIYAS

/piyas

🌐 WEBSITE

/website

━━━━━━━━━━━━━━━━━━

👑 ADMIN

/boton
/botoff
/on
/off
/offbot
/onbot
/fullbotstatus
/adminpanel
/cmdlist

━━━━━━━━━━━━━━━━━━
`;

  await sock.sendMessage(
    jid,
    {
      text
    }
  );
}

/* =========================================================
   GROUP RULES
========================================================= */

const GROUP_RULES = `
╭━━━━━━━━━━━━━━━━━━╮
       📜 GROUP RULES
╰━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাই ভদ্রভাবে কথা বলবেন।
2️⃣ Spam করা যাবে না।
3️⃣ প্রতারণামূলক পোস্ট নিষিদ্ধ।
4️⃣ অপ্রয়োজনীয় Link দেওয়া যাবে না।
5️⃣ Admin-এর নির্দেশ মেনে চলুন।
6️⃣ Group-এর পরিবেশ সুন্দর রাখুন।

━━━━━━━━━━━━━━━━━━
      ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`;

/* =========================================================
   BOT INFO
========================================================= */

const BOT_INFO = `
╭━━━━━━━━━━━━━━━━━━╮
        🤖 PIYAS BOT
╰━━━━━━━━━━━━━━━━━━╯

⚡ Fast & Smart WhatsApp Bot

👥 Group Management
⚙️ Utility Commands
💰 Buy / Sell Support
🤍 PIYAS Services

━━━━━━━━━━━━━━━━━━
🌐 Website
${WEBSITE_URL}
━━━━━━━━━━━━━━━━━━
`;

/* =========================================================
   PIYAS
========================================================= */

const PIYAS_INFO = `
╭━━━━━━━━━━━━━━━━━━╮
          🤍 PIYAS
╰━━━━━━━━━━━━━━━━━━╯

ডিজিটাল সার্ভিস ও বিভিন্ন
অনলাইন সাপোর্টের জন্য
আমাদের সাথে যোগাযোগ করুন।

🌐 ${WEBSITE_URL}

━━━━━━━━━━━━━━━━━━
        ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`;

/* =========================================================
   DEAL
========================================================= */

const DEAL_NOTICE = `
╭━━━━━━━━━━━━━━━━━━╮
        💰 DEAL
╰━━━━━━━━━━━━━━━━━━╯

Buy / Sell Deal করতে হলে
Admin-এর সাথে যোগাযোগ করুন।

⚠️ Deal করার আগে অবশ্যই
তথ্য যাচাই করে নিন।

━━━━━━━━━━━━━━━━━━
        ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`;

/* =========================================================
   FULL BOT STATUS
========================================================= */

async function sendFullBotStatus(
  jid
) {
  const status =
    ensureGroupStatus(
      jid
    );

  const fullStatus =
    status.fullBotOff
      ? "🔴 FULL BOT OFF"
      : "🟢 FULL BOT ON";

  const allowed =
    status.adminAllowedCommands;

  const allowedText =
    allowed.length
      ? allowed
          .map(
            c => `• /${c}`
          )
          .join("\n")
      : "• শুধু Protected Commands";

  const text = `
╭━━━━━━━━━━━━━━━━━━╮
      🤖 FULL BOT STATUS
╰━━━━━━━━━━━━━━━━━━╯

Status: ${fullStatus}

👑 Admin Commands:
${allowedText}

━━━━━━━━━━━━━━━━━━

📌 OFF:
/offbot

📌 নির্দিষ্ট command:
/offbot menu admin

📌 সব command Admin-এর জন্য:
/offbot all

📌 কোনো normal command নয়:
/offbot none

📌 আবার ON:
/onbot
`;

  await sock.sendMessage(
    jid,
    {
      text
    }
  );
}

/* =========================================================
   FULL BOT OFF COMMAND
========================================================= */

async function handleFullBotOffCommand(
  jid,
  args
) {
  const input =
    args
      .join(" ")
      .trim();

  if (
    input.toLowerCase() ===
    "all"
  ) {
    setFullBotOff(
      jid,
      true
    );

    const allCommands =
      Object.keys(
        COMMAND_DEFINITIONS
      );

    setAdminAllowedCommands(
      jid,
      allCommands
    );

    await sock.sendMessage(
      jid,
      {
        text: `
🔴 *FULL BOT OFF*

👑 Admin / Owner-এর জন্য
সব command চালু থাকবে।

👥 সাধারণ সদস্যদের command
বন্ধ থাকবে।

📌 আবার ON:
/onbot
`
      }
    );

    return;
  }

  if (
    input.toLowerCase() ===
    "none"
  ) {
    setFullBotOff(
      jid,
      true
    );

    setAdminAllowedCommands(
      jid,
      []
    );

    await sock.sendMessage(
      jid,
      {
        text: `
🔴 *FULL BOT OFF*

👥 সাধারণ সদস্যদের
সব command বন্ধ।

👑 Admin / Owner-এর জন্যও
শুধু control commands চালু।

📌 আবার ON:
/onbot
`
      }
    );

    return;
  }

  if (input) {
    const commands =
      input
        .split(/\s+/)
        .map(
          normalizeCommand
        )
        .filter(Boolean);

    const validCommands =
      commands.filter(
        command =>
          COMMAND_DEFINITIONS[
            command
          ]
      );

    setFullBotOff(
      jid,
      true
    );

    setAdminAllowedCommands(
      jid,
      validCommands
    );

    const allowedText =
      validCommands.length
        ? validCommands
            .map(
              c => `/${c}`
            )
            .join(" ")
        : "কোনো normal command নেই";

    await sock.sendMessage(
      jid,
      {
        text: `
🔴 *FULL BOT OFF*

👥 সাধারণ সদস্যদের
সব command বন্ধ।

👑 Admin / Owner-এর জন্য
চালু থাকবে:

${allowedText}

━━━━━━━━━━━━━━━━━━

📌 আবার ON:
/onbot
`
      }
    );

    return;
  }

  setFullBotOff(
    jid,
    true
  );

  setAdminAllowedCommands(
    jid,
    []
  );

  await sock.sendMessage(
    jid,
    {
      text: `
🔴 *FULL BOT OFF*

এখন থেকে সাধারণ সদস্যদের
কোনো command কাজ করবে না।

👑 Admin / Owner-এর জন্য
শুধু Bot Control Commands
চালু থাকবে।

📌 নির্দিষ্ট command:

/offbot menu admin

📌 সব command:

/offbot all

📌 আবার পুরো Bot ON:

/onbot
`
    }
  );
}

/* =========================================================
   FULL BOT ON
========================================================= */

async function handleFullBotOnCommand(
  jid
) {
  setFullBotOff(
    jid,
    false
  );

  setAdminAllowedCommands(
    jid,
    []
  );

  await sock.sendMessage(
    jid,
    {
      text: `
🟢 *FULL BOT ON*

Bot আবার সবার জন্য
চালু হয়েছে। ✅

📌 Allowed Group ID হওয়ায়
এই Group-এ Bot কাজ করবে।
`
    }
  );
}

/* =========================================================
   GET MESSAGE TEXT
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
    msg.extendedTextMessage
      ?.text
  ) {
    return msg.extendedTextMessage
      .text;
  }

  if (
    msg.imageMessage
      ?.caption
  ) {
    return msg.imageMessage
      .caption;
  }

  if (
    msg.videoMessage
      ?.caption
  ) {
    return msg.videoMessage
      .caption;
  }

  return "";
}

/* =========================================================
   PARSE COMMAND
========================================================= */

function parseCommand(
  text
) {
  const trimmed =
    String(text || "")
      .trim();

  if (
    !trimmed.startsWith("/")
  ) {
    return {
      command: "",
      args: []
    };
  }

  const parts =
    trimmed
      .slice(1)
      .trim()
      .split(/\s+/);

  const command =
    normalizeCommand(
      parts.shift() || ""
    );

  return {
    command,
    args: parts
  };
}

/* =========================================================
   WELCOME
========================================================= */

async function sendWelcome(
  groupId,
  participant,
  action
) {
  try {
    if (!sock) {
      return;
    }

    if (
      !isGroupAllowed(
        groupId
      )
    ) {
      return;
    }

    if (
      action === "add"
    ) {
      await sock.sendMessage(
        groupId,
        {
          text: `
╭━━━━━━━━━━━━━━━━━━╮
       👋 WELCOME
╰━━━━━━━━━━━━━━━━━━╯

Welcome @${phoneFromJid(
            participant
          )}

🤍 Group-এ স্বাগতম!

📌 /menu লিখে Bot Commands দেখুন।

━━━━━━━━━━━━━━━━━━
      ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`,
          mentions: [
            participant
          ]
        }
      );
    }

    if (
      action === "remove"
    ) {
      await sock.sendMessage(
        groupId,
        {
          text: `
👋 বিদায় @${phoneFromJid(
            participant
          )}

Group থেকে বের হয়ে গেছেন।

━━━━━━━━━━━━━━━━━━
      ⚡ PIYAS BOT
━━━━━━━━━━━━━━━━━━
`,
          mentions: [
            participant
          ]
        }
      );
    }
  } catch (e) {
    console.log(
      "Welcome error:",
      e.message
    );
  }
}

/* =========================================================
   START BOT
========================================================= */

async function startBot() {
  if (reconnecting) {
    return;
  }

  reconnecting = true;

  try {
    resetAuthIfNumberChanged();

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    sock =
      makeWASocket({
        auth: state,

        logger,

        printQRInTerminal:
          false,

        browser:
          Browsers.macOS(
            "Chrome"
          ),

        syncFullHistory:
          false,

        generateHighQualityLinkPreview:
          false
      });

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    /* =====================================================
       CONTACTS
    ===================================================== */

    sock.ev.on(
      "contacts.upsert",
      contacts => {
        for (
          const contact
          of contacts
        ) {
          cacheContact(
            contact
          );
        }
      }
    );

    sock.ev.on(
      "contacts.update",
      contacts => {
        for (
          const contact
          of contacts
        ) {
          cacheContact(
            contact
          );
        }
      }
    );

    /* =====================================================
       GROUP PARTICIPANTS
    ===================================================== */

    sock.ev.on(
      "group-participants.update",
      async update => {
        try {
          const {
            id,
            participants,
            action
          } = update;

          if (
            !isGroupAllowed(
              id
            )
          ) {
            return;
          }

          for (
            const participant
            of participants
          ) {
            await sendWelcome(
              id,
              participant,
              action
            );
          }
        } catch (e) {
          console.log(
            "Participant update error:",
            e.message
          );
        }
      }
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
          connection ===
          "open"
        ) {
          reconnecting = false;

          console.log(
            "✅ PIYAS BOT CONNECTED"
          );

          console.log(
            "━━━━━━━━━━━━━━━━━━━━"
          );

          console.log(
            "Allowed Groups:"
          );

          for (
            const groupId
            of ALLOWED_GROUPS
          ) {
            console.log(
              `✅ ${groupId}`
            );
          }

          console.log(
            "━━━━━━━━━━━━━━━━━━━━"
          );
        }

        if (
          connection ===
          "close"
        ) {
          reconnecting = false;

          const statusCode =
            new Boom(
              lastDisconnect
                ?.error
            )?.output
              ?.statusCode;

          const shouldReconnect =
            statusCode !==
            DisconnectReason
              .loggedOut;

          console.log(
            "❌ Connection closed:",
            statusCode
          );

          if (
            shouldReconnect
          ) {
            setTimeout(
              () => {
                startBot();
              },
              3000
            );
          } else {
            console.log(
              "❌ Logged out. Delete auth_info and pair again."
            );
          }
        }
      }
    );

    /* =====================================================
       PAIRING
    ===================================================== */

    if (
      !state.creds.registered &&
      PHONE_NUMBER &&
      !pairingRequested
    ) {
      pairingRequested = true;

      setTimeout(
        async () => {
          try {
            const code =
              await sock.requestPairingCode(
                PHONE_NUMBER
              );

            console.log(
              "\n================================"
            );

            console.log(
              "📱 WHATSAPP PAIRING CODE:"
            );

            console.log(
              code
            );

            console.log(
              "================================\n"
            );
          } catch (e) {
            pairingRequested = false;

            console.log(
              "Pairing code error:",
              e.message
            );
          }
        },
        2500
      );
    }

    /* =====================================================
       MESSAGE HANDLER
    ===================================================== */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type
      }) => {
        if (
          type !== "notify"
        ) {
          return;
        }

        for (
          const message
          of messages
        ) {
          try {
            if (
              !message?.message
            ) {
              continue;
            }

            if (
              message.key
                ?.fromMe
            ) {
              continue;
            }

            const remoteJid =
              normalizeJid(
                message.key
                  ?.remoteJid ||
                ""
              );

            /* =============================================
               ONLY GROUP
            ============================================= */

            if (
              !isGroupJid(
                remoteJid
              )
            ) {
              continue;
            }

            /* =============================================
               GROUP ID WHITELIST
            ============================================= */

            if (
              !isGroupAllowed(
                remoteJid
              )
            ) {
              continue;
            }

            const text =
              getMessageText(
                message
              );

            if (!text) {
              continue;
            }

            const {
              command,
              args
            } =
              parseCommand(
                text
              );

            if (!command) {
              continue;
            }

            const senderIsAdmin =
              await isSenderAdmin(
                remoteJid,
                message
              );

            /* =============================================
               FULL BOT CONTROL
            ============================================= */

            if (
              command ===
              "offbot"
            ) {
              if (
                !senderIsAdmin
              ) {
                continue;
              }

              await handleFullBotOffCommand(
                remoteJid,
                args
              );

              continue;
            }

            if (
              command ===
              "onbot"
            ) {
              if (
                !senderIsAdmin
              ) {
                continue;
              }

              await handleFullBotOnCommand(
                remoteJid
              );

              continue;
            }

            if (
              command ===
              "fullbotstatus"
            ) {
              if (
                !senderIsAdmin
              ) {
                continue;
              }

              await sendFullBotStatus(
                remoteJid
              );

              continue;
            }

            /* =============================================
               FULL BOT OFF
            ============================================= */

            let fullBotAdminAccess =
              false;

            if (
              isFullBotOff(
                remoteJid
              )
            ) {
              if (
                !senderIsAdmin
              ) {
                continue;
              }

              if (
                !isAdminAllowedCommand(
                  remoteJid,
                  command
                )
              ) {
                continue;
              }

              fullBotAdminAccess =
                true;
            }

            /* =============================================
               ADMIN ONLY
            ============================================= */

            if (
              ADMIN_ONLY_COMMANDS.has(
                command
              ) &&
              !senderIsAdmin
            ) {
              continue;
            }

            /* =============================================
               ADMIN PANEL
            ============================================= */

            if (
              command ===
              "adminpanel"
            ) {
              await sendAdminPanel(
                remoteJid
              );

              continue;
            }

            /* =============================================
               COMMAND LIST
            ============================================= */

            if (
              command ===
              "cmdlist"
            ) {
              await sendCommandList(
                remoteJid
              );

              continue;
            }

            /* =============================================
               BOT ON
            ============================================= */

            if (
              command ===
              "boton"
            ) {
              setBotEnabled(
                remoteJid,
                true
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "🟢 Bot এখন আবার ON করা হয়েছে।"
                }
              );

              continue;
            }

            /* =============================================
               BOT OFF
            ============================================= */

            if (
              command ===
              "botoff"
            ) {
              setBotEnabled(
                remoteJid,
                false
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "🔴 Bot OFF করা হয়েছে।"
                }
              );

              continue;
            }

            /* =============================================
               COMMAND ON
            ============================================= */

            if (
              command ===
              "on"
            ) {
              const target =
                normalizeCommand(
                  args[0]
                );

              if (
                !target ||
                !COMMAND_DEFINITIONS[
                  target
                ]
              ) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ সঠিক command দিন।\n\nউদাহরণ:\n/on menu"
                  }
                );

                continue;
              }

              setCommandEnabled(
                remoteJid,
                target,
                true
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🟢 /${target} command ON করা হয়েছে।`
                }
              );

              continue;
            }

            /* =============================================
               COMMAND OFF
            ============================================= */

            if (
              command ===
              "off"
            ) {
              const target =
                normalizeCommand(
                  args[0]
                );

              if (
                !target ||
                !COMMAND_DEFINITIONS[
                  target
                ]
              ) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ সঠিক command দিন।\n\nউদাহরণ:\n/off menu"
                  }
                );

                continue;
              }

              setCommandEnabled(
                remoteJid,
                target,
                false
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🔴 /${target} command OFF করা হয়েছে।`
                }
              );

              continue;
            }

            /* =============================================
               NORMAL BOT STATUS
            ============================================= */

            if (
              !fullBotAdminAccess &&
              !isBotEnabled(
                remoteJid
              )
            ) {
              continue;
            }

            /* =============================================
               COMMAND STATUS
            ============================================= */

            if (
              !fullBotAdminAccess &&
              !isCommandEnabled(
                remoteJid,
                command
              )
            ) {
              continue;
            }

            /* =============================================
               MENU
            ============================================= */

            if (
              command ===
              "menu"
            ) {
              await sendBotMenu(
                remoteJid
              );

              continue;
            }

            /* =============================================
               BOT
               /bot = SAME MENU
            ============================================= */

            if (
              command ===
              "bot"
            ) {
              await sendBotMenu(
                remoteJid
              );

              continue;
            }

            /* =============================================
               RULES
            ============================================= */

            if (
              command ===
              "rules"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    GROUP_RULES
                }
              );

              continue;
            }

            /* =============================================
               ADMIN
            ============================================= */

            if (
              command ===
              "admin"
            ) {
              try {
                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const admins =
                  (
                    metadata
                      ?.participants ||
                    []
                  ).filter(
                    p =>
                      isAdminParticipant(
                        p
                      )
                  );

                let text = `
╭━━━━━━━━━━━━━━━━━━╮
       👑 GROUP ADMINS
╰━━━━━━━━━━━━━━━━━━╯

`;

                for (
                  const admin
                  of admins
                ) {
                  text +=
                    `• @${phoneFromJid(
                      admin.id
                    )}\n`;
                }

                text +=
                  "\n━━━━━━━━━━━━━━━━━━";

                await sock.sendMessage(
                  remoteJid,
                  {
                    text,

                    mentions:
                      admins.map(
                        a => a.id
                      )
                  }
                );
              } catch {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Admin list পাওয়া যায়নি।"
                  }
                );
              }

              continue;
            }

            /* =============================================
               MEMBERS
            ============================================= */

            if (
              command ===
              "members"
            ) {
              try {
                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const count =
                  metadata
                    ?.participants
                    ?.length ||
                  0;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👥 Group Members: *${count}* জন`
                  }
                );
              } catch {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Member count পাওয়া যায়নি।"
                  }
                );
              }

              continue;
            }

            /* =============================================
               GROUP INFO
            ============================================= */

            if (
              command ===
              "groupinfo"
            ) {
              try {
                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata
                    ?.participants ||
                  [];

                const admins =
                  participants.filter(
                    p =>
                      isAdminParticipant(
                        p
                      )
                  ).length;

                const owner =
                  metadata?.owner ||
                  "Unknown";

                const text = `
╭━━━━━━━━━━━━━━━━━━╮
       👥 GROUP INFO
╰━━━━━━━━━━━━━━━━━━╯

📌 Name:
${metadata.subject || "Unknown"}

👥 Members:
${participants.length}

👑 Admins:
${admins}

🆔 Group ID:
${remoteJid}

👤 Owner:
${owner}

━━━━━━━━━━━━━━━━━━
`;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text
                  }
                );
              } catch {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Group info পাওয়া যায়নি।"
                  }
                );
              }

              continue;
            }

            /* =============================================
               ID
            ============================================= */

            if (
              command ===
              "id"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🆔 *GROUP ID*\n\n${remoteJid}`
                }
              );

              continue;
            }

            /* =============================================
               PING
            ============================================= */

            if (
              command ===
              "ping"
            ) {
              const start =
                Date.now();

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "🏓 Pinging..."
                }
              );

              const ms =
                Date.now() -
                start;

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🏓 Pong!\n⚡ ${ms}ms`
                }
              );

              continue;
            }

            /* =============================================
               DEAL
            ============================================= */

            if (
              command ===
              "deal"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    DEAL_NOTICE
                }
              );

              continue;
            }

            /* =============================================
               PIYAS
            ============================================= */

            if (
              command ===
              "piyas"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    PIYAS_INFO
                }
              );

              continue;
            }

            /* =============================================
               WEBSITE
            ============================================= */

            if (
              command ===
              "website"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🌐 Our Website\n\n${WEBSITE_URL}`
                }
              );

              continue;
            }

          } catch (e) {
            console.log(
              "Message handler error:",
              e.message
            );
          }
        }
      }
    );
  } catch (e) {
    reconnecting = false;

    console.log(
      "Start bot error:",
      e.message
    );

    setTimeout(
      () => {
        startBot();
      },
      5000
    );
  }
}

/* =========================================================
   GLOBAL ERROR HANDLERS
========================================================= */

process.on(
  "uncaughtException",
  err => {
    console.log(
      "Uncaught Exception:",
      err.message
    );
  }
);

process.on(
  "unhandledRejection",
  err => {
    console.log(
      "Unhandled Rejection:",
      err
    );
  }
);

process.on(
  "SIGINT",
  async () => {
    try {
      if (sock) {
        sock.end(
          undefined
        );
      }
    } catch {}

    process.exit(0);
  }
);

process.on(
  "SIGTERM",
  async () => {
    try {
      if (sock) {
        sock.end(
          undefined
        );
      }
    } catch {}

    process.exit(0);
  }
);

/* =========================================================
   START
========================================================= */

loadBotStatus();
startBot();