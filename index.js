require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  getContentType,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");

const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";
const STATUS_FILE = path.join(
  process.cwd(),
  "bot_status.json"
);

const PORT = Number(
  process.env.PORT || 3000
);

const PAIRING_NUMBER =
  String(
    process.env.PAIRING_NUMBER || ""
  )
    .replace(/\D/g, "");

const ALLOWED_GROUPS = String(
  process.env.ALLOWED_GROUPS || ""
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const PREFIXES = [
  "/",
  "!"
];

const COMMAND_DEFINITIONS = [
  {
    key: "menu",
    command: "/menu",
    title: "Main Menu",
    category: "group"
  },
  {
    key: "bot",
    command: "/bot",
    title: "Bot Menu",
    category: "group"
  },
  {
    key: "rules",
    command: "/rules",
    title: "Group Rules",
    category: "group"
  },
  {
    key: "admin",
    command: "/admin",
    title: "Admin List",
    category: "group"
  },
  {
    key: "members",
    command: "/members",
    title: "Group Members",
    category: "group"
  },
  {
    key: "groupinfo",
    command: "/groupinfo",
    title: "Group Info",
    category: "group"
  },
  {
    key: "id",
    command: "/id",
    title: "Group ID",
    category: "group"
  },
  {
    key: "ping",
    command: "/ping",
    title: "Ping",
    category: "utility"
  },
  {
    key: "deal",
    command: "/deal",
    title: "Buy / Sell Deal",
    category: "deal"
  },
  {
    key: "piyas",
    command: "/piyas",
    title: "Piyas Info",
    category: "piyas"
  },
  {
    key: "website",
    command: "/website",
    title: "Official Website",
    category: "website"
  }
];

const COMMAND_ALIASES = {
  "ডিল": "deal"
};

const ADMIN_ONLY_COMMANDS = [
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "onbot",
  "offbot",
  "fullbotstatus"
];

const PROTECTED_COMMANDS = [
  ...ADMIN_ONLY_COMMANDS
];

const SPECIAL_ADMIN_CONTROLS = [
  "welcome"
];

const DEFAULT_RULES = `
╭━━━━━━━━━━━━━━━━━━━━╮
        📜 GROUP RULES
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করে কথা বলুন।
2️⃣ অপ্রয়োজনীয় স্প্যাম করা যাবে না।
3️⃣ কোনো ধরনের প্রতারণামূলক লিংক শেয়ার করা যাবে না।
4️⃣ সন্দেহজনক লিংক বা ফাইল থেকে বিরত থাকুন।
5️⃣ অ্যাডমিনের নির্দেশনা মেনে চলুন।
6️⃣ সমস্যা হলে অ্যাডমিনের সাথে যোগাযোগ করুন।

━━━━━━━━━━━━━━━━━━━━
        🤖 PIYAS BOT
━━━━━━━━━━━━━━━━━━━━
`.trim();

const WARNING_COOLDOWN = 10 * 1000;
const DUPLICATE_WINDOW = 5 * 60 * 1000;

let sock = null;
let reconnectTimer = null;
let pairingRequested = false;

const participantCache = new Map();
const contactCache = new Map();
const warningCache = new Map();
const duplicateMessageCache = new Map();

function log(...args) {
  console.log(...args);
}

function safeReadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const raw = fs.readFileSync(
      file,
      "utf8"
    );

    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.log(
      "JSON read error:",
      error?.message
    );

    return fallback;
  }
}

function safeWriteJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.log(
      "JSON write error:",
      error?.message
    );
  }
}

function normalizeGroupStatus(status) {
  if (
    typeof status === "boolean"
  ) {
    return {
      enabled: status,
      welcomeEnabled: true,
      commands: {}
    };
  }

  if (
    !status ||
    typeof status !== "object"
  ) {
    return {
      enabled: true,
      welcomeEnabled: true,
      commands: {}
    };
  }

  return {
    enabled:
      status.enabled !== false,

    welcomeEnabled:
      status.welcomeEnabled !== false,

    commands:
      status.commands &&
      typeof status.commands === "object"
        ? status.commands
        : {}
  };
}

function loadStatuses() {
  const data = safeReadJSON(
    STATUS_FILE,
    {}
  );

  const result = {};

  for (
    const [groupId, status] of
    Object.entries(data)
  ) {
    result[groupId] =
      normalizeGroupStatus(status);
  }

  return result;
}

let groupStatuses =
  loadStatuses();

function saveStatuses() {
  safeWriteJSON(
    STATUS_FILE,
    groupStatuses
  );
}

function getGroupStatus(groupId) {
  if (
    !groupStatuses[groupId]
  ) {
    groupStatuses[groupId] =
      normalizeGroupStatus(
        null
      );

    saveStatuses();
  }

  groupStatuses[groupId] =
    normalizeGroupStatus(
      groupStatuses[groupId]
    );

  return groupStatuses[groupId];
}

function isBotEnabled(groupId) {
  return getGroupStatus(
    groupId
  ).enabled;
}

function setBotStatus(
  groupId,
  enabled
) {
  const status =
    getGroupStatus(groupId);

  status.enabled =
    Boolean(enabled);

  groupStatuses[groupId] =
    status;

  saveStatuses();

  return status;
}

function isWelcomeEnabled(groupId) {
  return getGroupStatus(
    groupId
  ).welcomeEnabled;
}

function setWelcomeStatus(
  groupId,
  enabled
) {
  const status =
    getGroupStatus(groupId);

  status.welcomeEnabled =
    Boolean(enabled);

  groupStatuses[groupId] =
    status;

  saveStatuses();

  return status;
}

function isCommandEnabled(
  groupId,
  command
) {
  const status =
    getGroupStatus(groupId);

  return (
    status.commands?.[command] !==
    false
  );
}

function setCommandStatus(
  groupId,
  command,
  enabled
) {
  const status =
    getGroupStatus(groupId);

  if (
    !status.commands ||
    typeof status.commands !== "object"
  ) {
    status.commands = {};
  }

  status.commands[command] =
    Boolean(enabled);

  groupStatuses[groupId] =
    status;

  saveStatuses();

  return status;
}

function getCommandDefinition(
  command
) {
  const normalized =
    String(command || "")
      .toLowerCase()
      .replace(/^[/!]/, "")
      .trim();

  const alias =
    COMMAND_ALIASES[
      normalized
    ];

  const key =
    alias || normalized;

  return COMMAND_DEFINITIONS.find(
    item =>
      item.key === key
  );
}

function getBasePhoneNumber(jid) {
  if (
    !jid ||
    typeof jid !== "string"
  ) {
    return "";
  }

  return jid
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "");
}

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

function isGroupJid(jid) {
  return (
    typeof jid === "string" &&
    (
      jid.endsWith(
        "@g.us"
      ) ||
      jid.endsWith(
        "@broadcast"
      )
    )
  );
}

function getMessageText(message) {
  if (!message) {
    return "";
  }

  const type =
    getContentType(message);

  if (!type) {
    return "";
  }

  if (
    type === "conversation"
  ) {
    return (
      message.conversation ||
      ""
    );
  }

  if (
    type === "extendedTextMessage"
  ) {
    return (
      message
        .extendedTextMessage
        ?.text ||
      ""
    );
  }

  if (
    type === "imageMessage"
  ) {
    return (
      message.imageMessage
        ?.caption ||
      ""
    );
  }

  if (
    type === "videoMessage"
  ) {
    return (
      message.videoMessage
        ?.caption ||
      ""
    );
  }

  if (
    type === "documentMessage"
  ) {
    return (
      message.documentMessage
        ?.caption ||
      ""
    );
  }

  return "";
}

function getMessageSender(msg) {
  if (!msg) {
    return "";
  }

  return (
    msg.key?.participant ||
    msg.participant ||
    msg.key?.remoteJid ||
    ""
  );
}

function getDisplayName(
  participant
) {
  if (!participant) {
    return "Member";
  }

  return (
    participant.notify ||
    participant.name ||
    participant.subject ||
    participant.pushName ||
    participant.displayName ||
    "Member"
  );
}

function isAdminParticipant(
  participant
) {
  return (
    participant?.admin === "admin" ||
    participant?.admin === "superadmin"
  );
}

function isOwnerParticipant(
  participant
) {
  return (
    participant?.admin ===
    "superadmin"
  );
}

function cacheParticipants(
  participants
) {
  for (
    const participant of
    participants || []
  ) {
    const id =
      participant?.id ||
      participant?.lid;

    if (!id) {
      continue;
    }

    participantCache.set(
      id,
      participant
    );

    if (
      participant?.lid
    ) {
      participantCache.set(
        participant.lid,
        participant
      );
    }
  }
}

async function getPhoneJid(
  participant
) {
  if (!participant) {
    return "";
  }

  const possibleIds = [
    participant.id,
    participant.lid
  ].filter(Boolean);

  for (
    const id of possibleIds
  ) {
    if (
      id.endsWith(
        "@s.whatsapp.net"
      )
    ) {
      return normalizeJid(id);
    }

    const cached =
      contactCache.get(id);

    if (
      cached &&
      cached.endsWith(
        "@s.whatsapp.net"
      )
    ) {
      return normalizeJid(
        cached
      );
    }
  }

  const directId =
    possibleIds.find(
      id =>
        !id.endsWith(
          "@lid"
        )
    );

  if (
    directId &&
    !directId.endsWith(
      "@g.us"
    )
  ) {
    const number =
      getBasePhoneNumber(
        directId
      );

    if (number) {
      const phoneJid =
        `${number}@s.whatsapp.net`;

      contactCache.set(
        directId,
        phoneJid
      );

      return phoneJid;
    }
  }

  return "";
}

async function getAdminData(
  remoteJid
) {
  try {
    const metadata =
      await sock.groupMetadata(
        remoteJid
      );

    const participants =
      metadata?.participants ||
      [];

    await cacheParticipants(
      participants
    );

    const adminParticipants =
      participants.filter(
        isAdminParticipant
      );

    const result = [];
    const usedJids =
      new Set();

    const botPhone =
      getBasePhoneNumber(
        sock?.user?.id
      );

    for (
      const participant of
      adminParticipants
    ) {
      const phoneJid =
        await getPhoneJid(
          participant
        );

      /*
       * IMPORTANT:
       * The bot can itself be an admin.
       * Do not show the bot in /admin.
       *
       * We compare the actual phone number,
       * so number:device@s.whatsapp.net
       * and number@s.whatsapp.net are
       * treated as the same account.
       */
      const participantPhone =
        getBasePhoneNumber(
          phoneJid ||
          participant.id ||
          participant.lid
        );

      if (
        botPhone &&
        participantPhone &&
        botPhone ===
          participantPhone
      ) {
        continue;
      }

      let name =
        getDisplayName(
          participant
        );

      if (
        !name ||
        name === "Member"
      ) {
        name = "Admin";
      }

      if (
        phoneJid &&
        usedJids.has(
          phoneJid
        )
      ) {
        continue;
      }

      if (phoneJid) {
        usedJids.add(
          phoneJid
        );
      }

      result.push({
        jid:
          phoneJid ||
          participant.id ||
          participant.lid ||
          null,

        name,

        owner:
          isOwnerParticipant(
            participant
          )
      });
    }

    return {
      admins: result,
      result
    };
  } catch (error) {
    console.log(
      "❌ getAdminData error:",
      error?.message
    );

    return {
      admins: [],
      result: []
    };
  }
}

function isAllowedGroup(
  groupId
) {
  if (
    !ALLOWED_GROUPS.length
  ) {
    return true;
  }

  return ALLOWED_GROUPS.includes(
    groupId
  );
}

function getCommandInfo(
  text
) {
  const value =
    String(text || "")
      .trim();

  if (!value) {
    return null;
  }

  const prefix =
    PREFIXES.find(
      p => value.startsWith(p)
    );

  if (!prefix) {
    return null;
  }

  const withoutPrefix =
    value.slice(
      prefix.length
    );

  const parts =
    withoutPrefix
      .trim()
      .split(/\s+/);

  const rawCommand =
    parts.shift() || "";

  const normalizedCommand =
    rawCommand
      .toLowerCase();

  const command =
    COMMAND_ALIASES[
      normalizedCommand
    ] ||
    normalizedCommand;

  return {
    prefix,
    rawCommand,
    command,
    args: parts,
    text: value
  };
}

function getCopyButtons(
  commands
) {
  return (commands || [])
    .map(
      command => ({
        name: "quick_reply",
        buttonParamsJson:
          JSON.stringify({
            display_text:
              `📋 ${command}`,
            id: command
          })
      })
    );
}

async function sendText(
  jid,
  text,
  options = {}
) {
  if (!sock) {
    return null;
  }

  try {
    return await sock.sendMessage(
      jid,
      {
        text,
        ...options
      }
    );
  } catch (error) {
    console.log(
      "sendText error:",
      error?.message
    );

    return null;
  }
}

async function sendButtons(
  jid,
  text,
  buttons = []
) {
  if (!sock) {
    return null;
  }

  try {
    return await sock.sendMessage(
      jid,
      {
        text,
        buttons: getCopyButtons(
          buttons
        ),
        headerType: 1
      }
    );
  } catch {
    return sendText(
      jid,
      text
    );
  }
}

async function sendMenu(
  jid
) {
  const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
          🤖 PIYAS BOT
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Available Commands

👥 Group
│ /menu
│ /bot
│ /rules
│ /admin
│ /members
│ /groupinfo
│ /id

🛠 Utility
│ /ping

💼 Deal
│ /deal
│ /ডিল

ℹ️ Info
│ /piyas
│ /website

━━━━━━━━━━━━━━━━━━━━
       👑 ADMIN CONTROLS
━━━━━━━━━━━━━━━━━━━━

/adminpanel
/cmdlist
/on <command>
/off <command>
/boton
/botoff

👋 Welcome:
/on welcome
/off welcome

━━━━━━━━━━━━━━━━━━━━
`;

  return sendButtons(
    jid,
    text.trim(),
    [
      "/menu",
      "/admin",
      "/rules",
      "/members",
      "/groupinfo",
      "/id",
      "/ping",
      "/deal",
      "/piyas",
      "/website"
    ]
  );
}

async function sendBotMenu(
  jid,
  groupId
) {
  const status =
    getGroupStatus(groupId);

  const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
          🤖 PIYAS BOT
╰━━━━━━━━━━━━━━━━━━━━╯

🟢 Bot:
${status.enabled ? "ON" : "OFF"}

👋 Welcome:
${status.welcomeEnabled ? "ON" : "OFF"}

📌 Commands

/menu
/rules
/admin
/members
/groupinfo
/id
/ping
/deal
/piyas
/website

━━━━━━━━━━━━━━━━━━━━
`;

  return sendButtons(
    jid,
    text.trim(),
    [
      "/menu",
      "/rules",
      "/admin",
      "/members",
      "/groupinfo",
      "/id",
      "/ping"
    ]
  );
}

async function sendRules(
  jid
) {
  return sendText(
    jid,
    DEFAULT_RULES
  );
}

async function sendAdminList(
  jid
) {
  const data =
    await getAdminData(
      jid
    );

  if (
    !data.admins.length
  ) {
    return sendText(
      jid,
      `
╭━━━━━━━━━━━━━━━━━━━━╮
        👑 ADMIN LIST
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ No other admin found.

━━━━━━━━━━━━━━━━━━━━
`.trim()
    );
  }

  let text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        👑 ADMIN LIST
╰━━━━━━━━━━━━━━━━━━━━╯

`;

  const mentions = [];

  data.admins.forEach(
    (admin, index) => {
      const title =
        admin.owner
          ? "👑 Owner"
          : "🛡️ Admin";

      const number =
        getBasePhoneNumber(
          admin.jid
        );

      text +=
        `${index + 1}. ${title}\n`;

      text +=
        `   ${admin.name}\n`;

      if (number) {
        text +=
          `   📱 +${number}\n\n`;

        mentions.push(
          admin.jid
        );
      } else {
        text +=
          `\n`;
      }
    }
  );

  text +=
    "━━━━━━━━━━━━━━━━━━━━";

  return sendText(
    jid,
    text.trim(),
    mentions.length
      ? {
          mentions
        }
      : {}
  );
}

async function sendMembers(
  jid
) {
  try {
    const metadata =
      await sock.groupMetadata(
        jid
      );

    const participants =
      metadata?.participants ||
      [];

    await cacheParticipants(
      participants
    );

    let text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        👥 GROUP MEMBERS
╰━━━━━━━━━━━━━━━━━━━━╯

`;

    const mentions = [];

    participants
      .slice(0, 100)
      .forEach(
        (participant, index) => {
          const name =
            getDisplayName(
              participant
            );

          text +=
            `${index + 1}. ${name}\n`;

          if (
            participant.id
          ) {
            mentions.push(
              participant.id
            );
          }
        }
      );

    if (
      participants.length >
      100
    ) {
      text +=
        `\n... and ${
          participants.length - 100
        } more`;
    }

    text +=
      `\n\n━━━━━━━━━━━━━━━━━━━━\nTotal: ${participants.length}`;

    return sendText(
      jid,
      text.trim(),
      mentions.length
        ? {
            mentions
          }
        : {}
    );
  } catch (error) {
    return sendText(
      jid,
      "❌ Members list পাওয়া যায়নি।"
    );
  }
}

async function sendGroupInfo(
  jid
) {
  try {
    const metadata =
      await sock.groupMetadata(
        jid
      );

    const participants =
      metadata?.participants ||
      [];

    const admins =
      participants.filter(
        isAdminParticipant
      ).length;

    const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        ℹ️ GROUP INFO
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Name:
${metadata.subject || "Unknown"}

🆔 Group ID:
${jid}

👥 Members:
${participants.length}

🛡️ Admins:
${admins}

👑 Owner:
${
  participants.find(
    isOwnerParticipant
  )
    ? "Available"
    : "Not found"
}

━━━━━━━━━━━━━━━━━━━━
`;

    return sendText(
      jid,
      text.trim()
    );
  } catch {
    return sendText(
      jid,
      `
❌ Group information পাওয়া যায়নি।
`.trim()
    );
  }
}

async function sendGroupId(
  jid
) {
  return sendButtons(
    jid,
    `
╭━━━━━━━━━━━━━━━━━━━━╮
          🆔 GROUP ID
╰━━━━━━━━━━━━━━━━━━━━╯

${jid}

━━━━━━━━━━━━━━━━━━━━
`.trim(),
    [jid]
  );
}

async function sendPing(
  jid
) {
  const started =
    Date.now();

  const sent =
    await sendText(
      jid,
      "🏓 Pinging..."
    );

  if (!sent) {
    return;
  }

  const ms =
    Date.now() - started;

  try {
    await sock.sendMessage(
      jid,
      {
        text:
          `🏓 Pong!\n⚡ Response: ${ms}ms`
      }
    );
  } catch {}
}

async function sendDeal(
  jid
) {
  return sendText(
    jid,
    `
╭━━━━━━━━━━━━━━━━━━━━╮
          💼 DEAL
╰━━━━━━━━━━━━━━━━━━━━╯

🤝 Buy / Sell Deal করতে
অ্যাডমিনের সাথে যোগাযোগ করুন।

📱 WhatsApp:
+8801885866257

🌐 Piyas Digital:
Piyas Digital

━━━━━━━━━━━━━━━━━━━━
`.trim()
  );
}

async function sendPiyas(
  jid
) {
  return sendText(
    jid,
    `
╭━━━━━━━━━━━━━━━━━━━━╮
        💜 PIYAS DIGITAL
╰━━━━━━━━━━━━━━━━━━━━╯

আমরা বিভিন্ন Digital Service
সহজভাবে গ্রাহকের কাছে পৌঁছে
দেওয়ার চেষ্টা করি।

⚡ দ্রুত যোগাযোগ
🔒 নিরাপদ প্রক্রিয়া
💬 WhatsApp Support
🤝 সরাসরি যোগাযোগ

━━━━━━━━━━━━━━━━━━━━
`.trim()
  );
}

async function sendWebsite(
  jid
) {
  return sendButtons(
    jid,
    `
╭━━━━━━━━━━━━━━━━━━━━╮
          🌐 WEBSITE
╰━━━━━━━━━━━━━━━━━━━━╯

Piyas Digital

🔗 Website:
https://piyasdigital.netlify.app

📱 WhatsApp:
+8801885866257

━━━━━━━━━━━━━━━━━━━━
`.trim(),
    [
      "https://piyasdigital.netlify.app"
    ]
  );
}

async function sendAdminPanel(
  jid
) {
  const status =
    getGroupStatus(jid);

  const commandLines =
    COMMAND_DEFINITIONS
      .map(item => {
        const enabled =
          isCommandEnabled(
            jid,
            item.key
          );

        return (
          `│ ${
            enabled
              ? "🟢"
              : "🔴"
          } ${item.command}`
        );
      })
      .join("\n");

  const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        👑 ADMIN PANEL
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 🤖 BOT STATUS
│ ${
    status.enabled
      ? "🟢 ON"
      : "🔴 OFF"
  }
╰────────────────────

╭─❖ 👋 WELCOME STATUS
│ ${
    status.welcomeEnabled
      ? "🟢 ON"
      : "🔴 OFF"
  }
╰────────────────────

╭─❖ ⚙️ COMMAND STATUS
${commandLines}
╰────────────────────

╭─❖ 🛠️ BOT CONTROL
│ 🟢 /boton
│ 🔴 /botoff
╰────────────────────

╭─❖ 👋 WELCOME CONTROL
│ 🟢 /on welcome
│ 🔴 /off welcome
╰────────────────────

╭─❖ ⚙️ COMMAND CONTROL
│ 🟢 /on <command>
│ 🔴 /off <command>
│ 📋 /cmdlist
╰────────────────────

━━━━━━━━━━━━━━━━━━━━
       👑 ADMIN ONLY
━━━━━━━━━━━━━━━━━━━━
`;

  return sendButtons(
    jid,
    text.trim(),
    [
      "/adminpanel",
      "/boton",
      "/botoff",
      "/on welcome",
      "/off welcome",
      "/cmdlist"
    ]
  );
}

async function sendCommandList(
  jid
) {
  const status =
    getGroupStatus(jid);

  let text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        📋 COMMAND LIST
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${
  status.enabled
    ? "🟢 ON"
    : "🔴 OFF"
}

👋 Welcome:
${
  status.welcomeEnabled
    ? "🟢 ON"
    : "🔴 OFF"
}

`;

  for (
    const item of
    COMMAND_DEFINITIONS
  ) {
    const enabled =
      isCommandEnabled(
        jid,
        item.key
      );

    text +=
      `${
        enabled
          ? "🟢"
          : "🔴"
      } ${item.command}\n`;
  }

  text += `
━━━━━━━━━━━━━━━━━━━━

Admin Controls:
🟢 /on <command>
🔴 /off <command>

Welcome:
🟢 /on welcome
🔴 /off welcome
`;

  return sendText(
    jid,
    text.trim()
  );
}

async function sendFullBotStatus(
  jid
) {
  const status =
    getGroupStatus(jid);

  let text = `
╭━━━━━━━━━━━━━━━━━━━━╮
      📊 FULL BOT STATUS
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Main Bot:
${
  status.enabled
    ? "🟢 ON"
    : "🔴 OFF"
}

👋 Welcome:
${
  status.welcomeEnabled
    ? "🟢 ON"
    : "🔴 OFF"
}

`;

  for (
    const item of
    COMMAND_DEFINITIONS
  ) {
    text +=
      `${item.command}: ${
        isCommandEnabled(
          jid,
          item.key
        )
          ? "🟢 ON"
          : "🔴 OFF"
      }\n`;
  }

  text +=
    "\n━━━━━━━━━━━━━━━━━━━━";

  return sendText(
    jid,
    text.trim()
  );
}

async function getGroupAdmins(
  groupId
) {
  const data =
    await getAdminData(
      groupId
    );

  return data.admins || [];
}

async function isSenderAdmin(
  groupId,
  sender
) {
  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const participants =
      metadata?.participants ||
      [];

    const normalizedSender =
      normalizeJid(
        sender
      );

    const senderPhone =
      getBasePhoneNumber(
        normalizedSender
      );

    const participant =
      participants.find(
        p => {
          const pPhone =
            getBasePhoneNumber(
              p.id ||
              p.lid
            );

          return (
            (
              p.id &&
              normalizeJid(
                p.id
              ) ===
                normalizedSender
            ) ||
            (
              p.lid &&
              normalizeJid(
                p.lid
              ) ===
                normalizedSender
            ) ||
            (
              senderPhone &&
              pPhone &&
              senderPhone ===
                pPhone
            )
          );
        }
      );

    return Boolean(
      participant &&
      isAdminParticipant(
        participant
      )
    );
  } catch {
    return false;
  }
}

async function isBotAdmin(
  groupId
) {
  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const participants =
      metadata?.participants ||
      [];

    const botPhone =
      getBasePhoneNumber(
        sock?.user?.id
      );

    return participants.some(
      participant => {
        const phone =
          getBasePhoneNumber(
            participant.id ||
            participant.lid
          );

        return (
          botPhone &&
          phone === botPhone &&
          isAdminParticipant(
            participant
          )
        );
      }
    );
  } catch {
    return false;
  }
}

function cleanupCaches() {
  const now =
    Date.now();

  for (
    const [
      key,
      value
    ] of warningCache
  ) {
    if (
      now - value >
      WARNING_COOLDOWN
    ) {
      warningCache.delete(
        key
      );
    }
  }

  for (
    const [
      key,
      value
    ] of duplicateMessageCache
  ) {
    if (
      now - value.time >
      DUPLICATE_WINDOW
    ) {
      duplicateMessageCache.delete(
        key
      );
    }
  }
}

setInterval(
  cleanupCaches,
  60 * 1000
);

function isLink(text) {
  if (!text) {
    return false;
  }

  return /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/|telegram\.me\/)/i.test(
    text
  );
}

async function deleteMessage(
  msg
) {
  try {
    if (!sock) {
      return;
    }

    await sock.sendMessage(
      msg.key.remoteJid,
      {
        delete: msg.key
      }
    );
  } catch {}
}

async function moderateGroupMessage(
  msg,
  text
) {
  const groupId =
    msg.key.remoteJid;

  const sender =
    getMessageSender(msg);

  if (
    !groupId ||
    !isGroupJid(groupId) ||
    !sender
  ) {
    return false;
  }

  const admin =
    await isSenderAdmin(
      groupId,
      sender
    );

  /*
   * Admins are exempt from
   * link moderation and
   * duplicate-message protection.
   */
  if (admin) {
    return false;
  }

  const link =
    isLink(text);

  if (link) {
    await deleteMessage(
      msg
    );

    const warningKey =
      `${groupId}:${sender}`;

    const lastWarning =
      warningCache.get(
        warningKey
      ) || 0;

    if (
      Date.now() -
        lastWarning >=
      WARNING_COOLDOWN
    ) {
      warningCache.set(
        warningKey,
        Date.now()
      );

      await sendText(
        groupId,
        `⚠️ @${getBasePhoneNumber(
          sender
        )} লিংক শেয়ার করা যাবে না।`,
        {
          mentions: [sender]
        }
      );
    }

    return true;
  }

  if (
    text &&
    text.trim().length > 0
  ) {
    const normalized =
      text
        .trim()
        .toLowerCase();

    const duplicateKey =
      `${groupId}:${sender}:${normalized}`;

    const previous =
      duplicateMessageCache.get(
        duplicateKey
      );

    if (
      previous &&
      Date.now() -
        previous.time <
        DUPLICATE_WINDOW
    ) {
      await deleteMessage(
        msg
      );

      const warningKey =
        `${groupId}:${sender}:spam`;

      const lastWarning =
        warningCache.get(
          warningKey
        ) || 0;

      if (
        Date.now() -
          lastWarning >=
        WARNING_COOLDOWN
      ) {
        warningCache.set(
          warningKey,
          Date.now()
        );

        await sendText(
          groupId,
          `⚠️ @${getBasePhoneNumber(
            sender
          )} একই মেসেজ বারবার পাঠানো যাবে না।`,
          {
            mentions: [sender]
          }
        );
      }

      return true;
    }

    duplicateMessageCache.set(
      duplicateKey,
      {
        time: Date.now()
      }
    );
  }

  return false;
}

async function sendWelcome(
  groupId,
  participants
) {
  if (
    !isWelcomeEnabled(
      groupId
    )
  ) {
    return;
  }

  if (
    !participants ||
    !participants.length
  ) {
    return;
  }

  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const groupName =
      metadata?.subject ||
      "Group";

    const mentions =
      participants;

    const names =
      participants
        .map(
          jid =>
            `@${getBasePhoneNumber(
              jid
            )}`
        )
        .join(" ");

    const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 WELCOME
╰━━━━━━━━━━━━━━━━━━━━╯

আসসালামু আলাইকুম 👋

${names}

🌸 ${
      groupName
    } গ্রুপে আপনাকে স্বাগতম।

📜 গ্রুপের নিয়ম মেনে চলুন
এবং সবাইকে সম্মান করুন।

🤖 PIYAS BOT আপনাদের সাথে আছে।

━━━━━━━━━━━━━━━━━━━━
`;

    await sendText(
      groupId,
      text.trim(),
      {
        mentions
      }
    );
  } catch (error) {
    console.log(
      "Welcome error:",
      error?.message
    );
  }
}

async function handleAdminControl(
  msg,
  commandInfo
) {
  const groupId =
    msg.key.remoteJid;

  const sender =
    getMessageSender(msg);

  if (
    !isGroupJid(groupId)
  ) {
    return true;
  }

  const admin =
    await isSenderAdmin(
      groupId,
      sender
    );

  if (!admin) {
    await sendText(
      groupId,
      "❌ এই কমান্ড শুধু Admin ব্যবহার করতে পারবে।"
    );

    return true;
  }

  const command =
    commandInfo.command;

  if (
    command ===
    "adminpanel"
  ) {
    await sendAdminPanel(
      groupId
    );
    return true;
  }

  if (
    command ===
    "cmdlist"
  ) {
    await sendCommandList(
      groupId
    );
    return true;
  }

  if (
    command ===
    "fullbotstatus"
  ) {
    await sendFullBotStatus(
      groupId
    );
    return true;
  }

  if (
    command === "boton" ||
    command === "onbot"
  ) {
    setBotStatus(
      groupId,
      true
    );

    await sendText(
      groupId,
      "🟢 Bot চালু করা হয়েছে।"
    );

    return true;
  }

  if (
    command === "botoff" ||
    command === "offbot"
  ) {
    setBotStatus(
      groupId,
      false
    );

    await sendText(
      groupId,
      "🔴 Bot বন্ধ করা হয়েছে।\n\n/on welcome দিয়ে Welcome আলাদাভাবে চালু করা যাবে।"
    );

    return true;
  }

  if (
    command === "on" ||
    command === "off"
  ) {
    const target =
      String(
        commandInfo.args?.[0] ||
        ""
      )
        .toLowerCase()
        .replace(/^[/!]/, "");

    const enabled =
      command === "on";

    /*
     * Welcome is independent from
     * the main bot status.
     */
    if (
      target === "welcome"
    ) {
      setWelcomeStatus(
        groupId,
        enabled
      );

      await sendText(
        groupId,
        enabled
          ? "🟢 Welcome message চালু করা হয়েছে।"
          : "🔴 Welcome message বন্ধ করা হয়েছে।"
      );

      return true;
    }

    if (!target) {
      await sendText(
        groupId,
        `❌ Command দিন।\n\nউদাহরণ:\n/on ping\n/off ping`
      );

      return true;
    }

    const definition =
      getCommandDefinition(
        target
      );

    if (!definition) {
      await sendText(
        groupId,
        `❌ Unknown command: ${target}\n\n/cmdlist লিখে command list দেখুন।`
      );

      return true;
    }

    setCommandStatus(
      groupId,
      definition.key,
      enabled
    );

    await sendText(
      groupId,
      enabled
        ? `🟢 ${definition.command} চালু করা হয়েছে।`
        : `🔴 ${definition.command} বন্ধ করা হয়েছে।`
    );

    return true;
  }

  return false;
}

async function handleCommand(
  msg,
  commandInfo
) {
  const groupId =
    msg.key.remoteJid;

  const command =
    commandInfo.command;

  if (
    ADMIN_ONLY_COMMANDS.includes(
      command
    )
  ) {
    return handleAdminControl(
      msg,
      commandInfo
    );
  }

  if (
    !isAllowedGroup(
      groupId
    )
  ) {
    return true;
  }

  /*
   * Commands that control the bot
   * are already handled above.
   */
  if (
    !isBotEnabled(
      groupId
    )
  ) {
    return true;
  }

  const definition =
    getCommandDefinition(
      command
    );

  if (
    !definition
  ) {
    return false;
  }

  if (
    !isCommandEnabled(
      groupId,
      definition.key
    )
  ) {
    return true;
  }

  switch (
    definition.key
  ) {
    case "menu":
      await sendMenu(
        groupId
      );
      break;

    case "bot":
      await sendBotMenu(
        groupId,
        groupId
      );
      break;

    case "rules":
      await sendRules(
        groupId
      );
      break;

    case "admin":
      await sendAdminList(
        groupId
      );
      break;

    case "members":
      await sendMembers(
        groupId
      );
      break;

    case "groupinfo":
      await sendGroupInfo(
        groupId
      );
      break;

    case "id":
      await sendGroupId(
        groupId
      );
      break;

    case "ping":
      await sendPing(
        groupId
      );
      break;

    case "deal":
      await sendDeal(
        groupId
      );
      break;

    case "piyas":
      await sendPiyas(
        groupId
      );
      break;

    case "website":
      await sendWebsite(
        groupId
      );
      break;

    default:
      break;
  }

  return true;
}

async function handleMessage(
  msg
) {
  if (!msg) {
    return;
  }

  if (
    msg.key?.fromMe
  ) {
    return;
  }

  const remoteJid =
    msg.key?.remoteJid;

  if (!remoteJid) {
    return;
  }

  const text =
    getMessageText(
      msg.message
    ).trim();

  if (
    isGroupJid(remoteJid)
  ) {
    if (
      !isAllowedGroup(
        remoteJid
      )
    ) {
      return;
    }

    /*
     * Moderation runs before
     * command processing.
     */
    const moderated =
      await moderateGroupMessage(
        msg,
        text
      );

    if (moderated) {
      return;
    }
  }

  const commandInfo =
    getCommandInfo(text);

  if (!commandInfo) {
    return;
  }

  await handleCommand(
    msg,
    commandInfo
  );
}

function startHealthServer() {
  const server =
    http.createServer(
      (req, res) => {
        res.writeHead(
          200,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        res.end(
          "PIYAS BOT is running."
        );
      }
    );

  server.listen(
    PORT,
    "0.0.0.0",
    () => {
      log(
        `🌐 Health server running on port ${PORT}`
      );
    }
  );
}

function removePairingFile() {
  const file =
    path.join(
      process.cwd(),
      "pairing_number.txt"
    );

  try {
    if (
      fs.existsSync(file)
    ) {
      fs.unlinkSync(file);
    }
  } catch {}
}

function savePairingNumber() {
  if (!PAIRING_NUMBER) {
    return;
  }

  try {
    fs.writeFileSync(
      path.join(
        process.cwd(),
        "pairing_number.txt"
      ),
      PAIRING_NUMBER,
      "utf8"
    );
  } catch {}
}

async function createBot() {
  if (
    reconnectTimer
  ) {
    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      null;
  }

  const {
    state,
    saveCreds
  } =
    await useMultiFileAuthState(
      AUTH_DIR
    );

  let version;

  try {
    const latest =
      await fetchLatestBaileysVersion();

    version =
      latest.version;
  } catch {
    version =
      undefined;
  }

  sock =
    makeWASocket({
      auth: {
        creds: state.creds,
        keys:
          makeCacheableSignalKeyStore(
            state.keys,
            P({
              level:
                "silent"
            })
          )
      },

      version,

      logger: P({
        level:
          "silent"
      }),

      printQRInTerminal:
        false,

      browser: [
        "Piyas Bot",
        "Chrome",
        "1.0.0"
      ],

      generateHighQualityLinkPreview:
        false,

      syncFullHistory:
        false,

      markOnlineOnConnect:
        false
    });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "contacts.upsert",
    contacts => {
      for (
        const contact of
        contacts || []
      ) {
        if (
          contact?.id &&
          contact.id.endsWith(
            "@s.whatsapp.net"
          )
        ) {
          contactCache.set(
            contact.id,
            contact.id
          );
        }
      }
    }
  );

  sock.ev.on(
    "group-participants.update",
    async event => {
      try {
        const {
          id,
          participants,
          action
        } = event;

        if (
          action !== "add"
        ) {
          return;
        }

        if (
          !isAllowedGroup(id)
        ) {
          return;
        }

        if (
          !isWelcomeEnabled(id)
        ) {
          return;
        }

        await sendWelcome(
          id,
          participants
        );
      } catch (error) {
        console.log(
          "group participant error:",
          error?.message
        );
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async event => {
      if (
        event.type !==
        "notify"
      ) {
        return;
      }

      for (
        const msg of
        event.messages ||
        []
      ) {
        try {
          await handleMessage(
            msg
          );
        } catch (error) {
          console.log(
            "Message handler error:",
            error?.message
          );
        }
      }
    }
  );

  sock.ev.on(
    "connection.update",
    async update => {
      const {
        connection,
        lastDisconnect
      } = update;

      if (
        connection ===
        "connecting"
      ) {
        log(
          "🔄 Connecting to WhatsApp..."
        );
      }

      if (
        connection ===
        "open"
      ) {
        pairingRequested =
          false;

        log(
          "╭━━━━━━━━━━━━━━━━━━━━╮"
        );
        log(
          "      🤖 PIYAS BOT"
        );
        log(
          "      🟢 CONNECTED"
        );
        log(
          "╰━━━━━━━━━━━━━━━━━━━━╯"
        );

        if (
          sock?.user?.id
        ) {
          log(
            `📱 Bot: ${sock.user.id}`
          );
        }

        removePairingFile();
      }

      if (
        connection ===
        "close"
      ) {
        const code =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode;

        const shouldReconnect =
          code !==
          DisconnectReason.loggedOut;

        log(
          `❌ Connection closed. Code: ${code}`
        );

        if (
          code ===
          DisconnectReason.loggedOut
        ) {
          log(
            "🔴 Logged out. Delete auth_info and pair again."
          );

          pairingRequested =
            false;

          return;
        }

        if (
          shouldReconnect
        ) {
          reconnectTimer =
            setTimeout(
              () => {
                createBot()
                  .catch(
                    error =>
                      console.log(
                        "Reconnect error:",
                        error?.message
                      )
                  );
              },
              5000
            );
        }
      }
    }
  );

  /*
   * Pairing code:
   * only request when the session is not registered.
   *
   * This avoids the old problem where an existing
   * pairing_number.txt file prevented a new code.
   */
  if (
    !state.creds.registered &&
    PAIRING_NUMBER &&
    !pairingRequested
  ) {
    pairingRequested =
      true;

    setTimeout(
      async () => {
        try {
          const code =
            await sock.requestPairingCode(
              PAIRING_NUMBER
            );

          savePairingNumber();

          log(
            "╭━━━━━━━━━━━━━━━━━━━━╮"
          );
          log(
            "      🔐 PAIRING CODE"
          );
          log(
            `      ${code}`
          );
          log(
            "╰━━━━━━━━━━━━━━━━━━━━╯"
          );
        } catch (error) {
          pairingRequested =
            false;

          console.log(
            "Pairing code error:",
            error?.message
          );
        }
      },
      3000
    );
  }

  return sock;
}

async function main() {
  try {
    fs.mkdirSync(
      AUTH_DIR,
      {
        recursive: true
      }
    );

    startHealthServer();

    log(
      "🚀 Starting PIYAS BOT..."
    );

    await createBot();
  } catch (error) {
    console.log(
      "❌ Startup error:",
      error?.message
    );

    reconnectTimer =
      setTimeout(
        () => {
          main().catch(
            console.error
          );
        },
        5000
      );
  }
}

process.on(
  "uncaughtException",
  error => {
    console.log(
      "❌ Uncaught Exception:",
      error?.message
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.log(
      "❌ Unhandled Rejection:",
      error?.message ||
        error
    );
  }
);

main();