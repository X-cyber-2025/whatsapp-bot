import "dotenv/config";
import http from "http";
import fs from "fs";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const GROUP_IDS = (process.env.GROUP_ID || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

const PHONE_NUMBER = (process.env.PHONE_NUMBER || "")
  .replace(/[^0-9]/g, "");

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";

const AUTH_DIR = "./auth_info";
const PAIRING_NUMBER_FILE = "./pairing_number.txt";
const BOT_STATUS_FILE = "./bot_status.json";

let sock = null;
let reconnecting = false;
let pairingRequested = false;

const contactNames = new Map();
const contactPhoneJids = new Map();
const lidToPhoneJid = new Map();

const logger = P({
  level: "silent"
});

/* =========================================================
   BOT STATUS
========================================================= */

let botStatus = {};

function loadBotStatus() {
  try {
    if (!fs.existsSync(BOT_STATUS_FILE)) {
      botStatus = {};
      return;
    }

    botStatus =
      JSON.parse(
        fs.readFileSync(
          BOT_STATUS_FILE,
          "utf8"
        )
      ) || {};

    console.log("📂 Bot status loaded.");
  } catch (error) {
    console.log(
      "⚠️ Bot status load error:",
      error?.message
    );

    botStatus = {};
  }
}

function saveBotStatus() {
  try {
    fs.writeFileSync(
      BOT_STATUS_FILE,
      JSON.stringify(
        botStatus,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.log(
      "⚠️ Bot status save error:",
      error?.message
    );
  }
}

function getGroupStatus(groupId) {
  if (!botStatus[groupId]) {
    botStatus[groupId] = {
      enabled: true,
      disabledCommands: []
    };
  }

  if (
    !Array.isArray(
      botStatus[groupId].disabledCommands
    )
  ) {
    botStatus[groupId].disabledCommands = [];
  }

  return botStatus[groupId];
}

function isBotEnabled(groupId) {
  return (
    getGroupStatus(groupId).enabled !== false
  );
}

function setBotStatus(
  groupId,
  enabled
) {
  getGroupStatus(groupId).enabled =
    Boolean(enabled);

  saveBotStatus();
}

function normalizeCommandName(command) {
  if (!command) {
    return "";
  }

  return String(command)
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "");
}

function isCommandEnabled(
  groupId,
  command
) {
  const name =
    normalizeCommandName(command);

  if (!name) {
    return true;
  }

  return !getGroupStatus(
    groupId
  ).disabledCommands.includes(
    name
  );
}

function setCommandStatus(
  groupId,
  command,
  enabled
) {
  const name =
    normalizeCommandName(command);

  if (!name) {
    return false;
  }

  const status =
    getGroupStatus(groupId);

  const list =
    status.disabledCommands;

  const index =
    list.indexOf(name);

  if (enabled) {
    if (index !== -1) {
      list.splice(index, 1);
    }
  } else {
    if (index === -1) {
      list.push(name);
    }
  }

  saveBotStatus();

  return true;
}

loadBotStatus();

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
  http.createServer(
    (req, res) => {
      if (req.url === "/health") {
        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );

        res.end(
          JSON.stringify({
            status: "online",
            bot: "WhatsApp Group Bot",
            connected: !!sock,
            groups:
              GROUP_IDS.length ||
              "ALL"
          })
        );

        return;
      }

      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end(
        "WhatsApp Bot is running!"
      );
    }
  );

server.listen(
  PORT,
  () => {
    console.log(
      `🌐 Server running on port ${PORT}`
    );
  }
);

/* =========================================================
   PAIRING NUMBER
========================================================= */

function readSavedPairingNumber() {
  try {
    if (
      !fs.existsSync(
        PAIRING_NUMBER_FILE
      )
    ) {
      return "";
    }

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
  } catch (error) {
    console.log(
      "⚠️ Pairing number read error:",
      error?.message
    );

    return "";
  }
}

function savePairingNumber(number) {
  try {
    fs.writeFileSync(
      PAIRING_NUMBER_FILE,
      number,
      "utf8"
    );
  } catch (error) {
    console.log(
      "⚠️ Pairing number save error:",
      error?.message
    );
  }
}

function getCredentialPhoneNumber(
  creds
) {
  const id =
    creds?.me?.id;

  if (
    !id ||
    typeof id !== "string"
  ) {
    return "";
  }

  return id
    .split(":")[0]
    .split("@")[0]
    .replace(
      /[^0-9]/g,
      ""
    );
}

async function resetAuthForNumberChange() {
  try {
    if (
      fs.existsSync(
        AUTH_DIR
      )
    ) {
      await fs.promises.rm(
        AUTH_DIR,
        {
          recursive: true,
          force: true
        }
      );

      console.log(
        "🗑️ Old WhatsApp session removed."
      );
    }
  } catch (error) {
    console.log(
      "❌ Failed to remove old session:",
      error?.message
    );
  }
}

/* =========================================================
   JID HELPERS
========================================================= */

function normalizeJid(jid) {
  if (
    !jid ||
    typeof jid !== "string"
  ) {
    return null;
  }

  return jid.trim();
}

function isPhoneJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith(
      "@s.whatsapp.net"
    )
  );
}

function isLidJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith("@lid")
  );
}

function phoneNumberToJid(phone) {
  if (!phone) {
    return null;
  }

  const number =
    String(phone)
      .replace(
        /@s.whatsapp.net/g,
        ""
      )
      .replace(
        /[^0-9]/g,
        ""
      );

  if (
    number.length < 8
  ) {
    return null;
  }

  return (
    number +
    "@s.whatsapp.net"
  );
}

/* =========================================================
   NAME HELPERS
========================================================= */

function cleanName(name) {
  if (!name) {
    return null;
  }

  const value =
    String(name)
      .replace(/\s+/g, " ")
      .trim();

  if (!value) {
    return null;
  }

  return value.slice(
    0,
    80
  );
}

function getDisplayName(
  participant = {}
) {
  const ids = [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ].filter(Boolean);

  for (
    const id of ids
  ) {
    const cached =
      contactNames.get(id);

    if (cached) {
      return cached;
    }
  }

  const directName =
    cleanName(
      participant.username ||
      participant.notify ||
      participant.name ||
      participant.verifiedName ||
      participant.pushName
    );

  if (directName) {
    return directName;
  }

  if (
    participant.phoneNumber
  ) {
    const phone =
      String(
        participant.phoneNumber
      )
        .replace(
          /@s.whatsapp.net/g,
          ""
        )
        .replace(
          /[^0-9]/g,
          ""
        );

    if (phone) {
      return phone;
    }
  }

  if (participant.id) {
    const idPart =
      String(
        participant.id
      ).split("@")[0];

    if (idPart) {
      return idPart;
    }
  }

  return "Member";
}

/* =========================================================
   LID MAPPING
========================================================= */

function saveLidMapping(
  lid,
  pn
) {
  const lidJid =
    normalizeJid(lid);

  let phoneJid =
    normalizeJid(pn);

  if (
    !isLidJid(lidJid)
  ) {
    return;
  }

  if (
    !isPhoneJid(phoneJid)
  ) {
    phoneJid =
      phoneNumberToJid(
        phoneJid
      );
  }

  if (
    !isPhoneJid(phoneJid)
  ) {
    return;
  }

  lidToPhoneJid.set(
    lidJid,
    phoneJid
  );

  contactPhoneJids.set(
    lidJid,
    phoneJid
  );
}

async function resolveLidToPhoneJid(
  lid
) {
  if (!lid) {
    return null;
  }

  if (
    isPhoneJid(lid)
  ) {
    return lid;
  }

  if (
    !isLidJid(lid)
  ) {
    return null;
  }

  const cached =
    lidToPhoneJid.get(lid) ||
    contactPhoneJids.get(lid);

  if (
    isPhoneJid(cached)
  ) {
    return cached;
  }

  try {
    const mapping =
      sock?.signalRepository
        ?.lidMapping;

    if (
      mapping &&
      typeof mapping.getPNForLID ===
        "function"
    ) {
      const pn =
        await mapping.getPNForLID(
          lid
        );

      const phoneJid =
        isPhoneJid(pn)
          ? pn
          : phoneNumberToJid(pn);

      if (phoneJid) {
        saveLidMapping(
          lid,
          phoneJid
        );

        return phoneJid;
      }
    }
  } catch (error) {
    console.log(
      "⚠️ LID → Phone mapping error:",
      error?.message
    );
  }

  return null;
}

/* =========================================================
   CONTACT CACHE
========================================================= */

function saveContacts(
  contacts = []
) {
  for (
    const contact of contacts
  ) {
    if (!contact) {
      continue;
    }

    const id =
      normalizeJid(
        contact.id
      );

    const lid =
      normalizeJid(
        contact.lid
      );

    let phoneJid = null;

    if (
      contact.phoneNumber
    ) {
      phoneJid =
        isPhoneJid(
          contact.phoneNumber
        )
          ? contact.phoneNumber
          : phoneNumberToJid(
              contact.phoneNumber
            );
    }

    if (
      !phoneJid &&
      isPhoneJid(id)
    ) {
      phoneJid = id;
    }

    if (
      phoneJid &&
      isLidJid(id)
    ) {
      saveLidMapping(
        id,
        phoneJid
      );
    }

    if (
      phoneJid &&
      lid
    ) {
      saveLidMapping(
        lid,
        phoneJid
      );
    }

    const name =
      cleanName(
        contact.username ||
        contact.notify ||
        contact.name ||
        contact.verifiedName ||
        contact.pushName
      );

    if (name) {
      if (id) {
        contactNames.set(
          id,
          name
        );
      }

      if (lid) {
        contactNames.set(
          lid,
          name
        );
      }

      if (phoneJid) {
        contactNames.set(
          phoneJid,
          name
        );
      }
    }

    if (phoneJid) {
      if (id) {
        contactPhoneJids.set(
          id,
          phoneJid
        );
      }

      if (lid) {
        contactPhoneJids.set(
          lid,
          phoneJid
        );
      }

      contactPhoneJids.set(
        phoneJid,
        phoneJid
      );
    }
  }
}

/* =========================================================
   PHONE JID
========================================================= */

function getDirectPhoneJid(
  participant = {}
) {
  if (
    participant.phoneNumber
  ) {
    const jid =
      isPhoneJid(
        participant.phoneNumber
      )
        ? participant.phoneNumber
        : phoneNumberToJid(
            participant.phoneNumber
          );

    if (jid) {
      return jid;
    }
  }

  if (
    isPhoneJid(
      participant.id
    )
  ) {
    return participant.id;
  }

  return null;
}

async function getPhoneJid(
  participant = {}
) {
  const direct =
    getDirectPhoneJid(
      participant
    );

  if (direct) {
    return direct;
  }

  const ids = [
    participant.id,
    participant.lid
  ].filter(Boolean);

  for (
    const id of ids
  ) {
    const cached =
      contactPhoneJids.get(id) ||
      lidToPhoneJid.get(id);

    if (
      isPhoneJid(cached)
    ) {
      return cached;
    }

    if (
      isLidJid(id)
    ) {
      const resolved =
        await resolveLidToPhoneJid(
          id
        );

      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

async function cacheParticipants(
  participants = []
) {
  for (
    const participant of participants
  ) {
    if (!participant) {
      continue;
    }

    const name =
      getDisplayName(
        participant
      );

    let phoneJid =
      getDirectPhoneJid(
        participant
      );

    if (
      !phoneJid &&
      participant.id
    ) {
      phoneJid =
        await resolveLidToPhoneJid(
          participant.id
        );
    }

    if (
      !phoneJid &&
      participant.lid
    ) {
      phoneJid =
        await resolveLidToPhoneJid(
          participant.lid
        );
    }

    if (
      phoneJid &&
      participant.id
    ) {
      contactPhoneJids.set(
        participant.id,
        phoneJid
      );
    }

    if (
      phoneJid &&
      participant.lid
    ) {
      contactPhoneJids.set(
        participant.lid,
        phoneJid
      );
    }

    if (
      phoneJid &&
      isLidJid(
        participant.id
      )
    ) {
      saveLidMapping(
        participant.id,
        phoneJid
      );
    }

    if (
      phoneJid &&
      isLidJid(
        participant.lid
      )
    ) {
      saveLidMapping(
        participant.lid,
        phoneJid
      );
    }

    if (
      name &&
      name !== "Member"
    ) {
      if (participant.id) {
        contactNames.set(
          participant.id,
          name
        );
      }

      if (participant.lid) {
        contactNames.set(
          participant.lid,
          name
        );
      }

      if (phoneJid) {
        contactNames.set(
          phoneJid,
          name
        );
      }
    }
  }
}

/* =========================================================
   GROUP HELPERS
========================================================= */

function isGroupAllowed(jid) {
  if (
    !jid ||
    !jid.endsWith("@g.us")
  ) {
    return false;
  }

  return (
    GROUP_IDS.length === 0 ||
    GROUP_IDS.includes(jid)
  );
}

function isAdminParticipant(
  participant = {}
) {
  return (
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.admin === true ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true
  );
}

function isOwnerParticipant(
  participant = {}
) {
  return (
    participant.admin ===
      "superadmin" ||
    participant.isSuperAdmin === true
  );
}

function findParticipant(
  participants = [],
  jid
) {
  if (!jid) {
    return null;
  }

  return (
    participants.find(
      participant =>
        participant?.id === jid ||
        participant?.lid === jid ||
        participant?.phoneNumber === jid
    ) || null
  );
}

/* =========================================================
   ADMIN CHECK
========================================================= */

async function isSenderAdmin(
  remoteJid,
  message
) {
  try {
    const participantJid =
      message?.key?.participant;

    if (!participantJid) {
      return false;
    }

    const metadata =
      await sock.groupMetadata(
        remoteJid
      );

    const participants =
      metadata?.participants || [];

    await cacheParticipants(
      participants
    );

    let sender =
      findParticipant(
        participants,
        participantJid
      );

    if (!sender) {
      const senderPhone =
        await resolveLidToPhoneJid(
          participantJid
        );

      if (senderPhone) {
        sender =
          findParticipant(
            participants,
            senderPhone
          );
      }
    }

    if (!sender) {
      sender =
        participants.find(
          participant =>
            participant?.id ===
              participantJid ||
            participant?.lid ===
              participantJid
        );
    }

    return Boolean(
      sender &&
      isAdminParticipant(
        sender
      )
    );

  } catch (error) {
    console.log(
      "⚠️ Admin check error:",
      error?.message
    );

    return false;
  }
}

/* =========================================================
   COMMAND LIST
========================================================= */

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

/* =========================================================
   COPY BUTTON
========================================================= */

function makeCopyButton(
  command
) {
  return {
    name: "cta_copy",
    buttonParamsJson:
      JSON.stringify({
        display_text: "📋 Copy",
        id:
          "copy_" +
          normalizeCommandName(
            command
          ),
        copy_code: command
      })
  };
}

/* =========================================================
   PUBLIC BOT MENU
========================================================= */

function buildMenuText(
  remoteJid
) {
  const isEnabled =
    key =>
      isCommandEnabled(
        remoteJid,
        key
      );

  const group = [
    {
      number: "1️⃣",
      key: "menu",
      command: "/menu"
    },
    {
      number: "2️⃣",
      key: "bot",
      command: "/bot"
    },
    {
      number: "3️⃣",
      key: "rules",
      command: "/rules"
    },
    {
      number: "4️⃣",
      key: "admin",
      command: "/admin"
    },
    {
      number: "5️⃣",
      key: "members",
      command: "/members"
    },
    {
      number: "6️⃣",
      key: "groupinfo",
      command: "/groupinfo"
    },
    {
      number: "7️⃣",
      key: "id",
      command: "/id"
    }
  ].filter(
    item =>
      isEnabled(
        item.key
      )
  );

  const utility = [
    {
      number: "8️⃣",
      key: "ping",
      command: "/ping"
    }
  ].filter(
    item =>
      isEnabled(
        item.key
      )
  );

  const deal = isEnabled("deal")
    ? "│ 9️⃣ /deal /ডিল"
    : "│ 🔴 Deal Command OFF";

  const piyas = isEnabled("piyas")
    ? "│ 🔟 /piyas"
    : "│ 🔴 Piyas Command OFF";

  const website = isEnabled("website")
    ? "│ 1️⃣1️⃣ /website"
    : "│ 🔴 Website Command OFF";

  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 *BOT MENU*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 👥 *GROUP COMMANDS*
│
${
  group.length
    ? group
        .map(
          item =>
            `│ ${item.number} ${item.command}`
        )
        .join("\n")
    : "│ ❌ কোনো Command চালু নেই"
}
╰────────────────────

╭─❖ ⚙️ *UTILITY*
│
${
  utility.length
    ? utility
        .map(
          item =>
            `│ ${item.number} ${item.command}`
        )
        .join("\n")
    : "│ ❌ কোনো Command চালু নেই"
}
╰────────────────────

╭─❖ 💰 *BUY / SELL*
│
${deal}
╰────────────────────

╭─❖ 🤍 *PIYAS*
│
${piyas}
╰────────────────────

╭─❖ 🌐 *OUR WEBSITE*
│
${website}
╰────────────────────


━━━━━━━━━━━━━━━━━━━━
        🤖 *PIYAS BOT*
━━━━━━━━━━━━━━━━━━━━
`;
}

async function sendPublicMenu(
  remoteJid
) {
  try {
    const text =
      buildMenuText(
        remoteJid
      );

    /*
     * IMPORTANT:
     *
     * WhatsApp/Baileys-এর সব version-এ
     * cta_copy button একইভাবে support নাও করতে পারে।
     *
     * তাই আগে native copy button পাঠানোর চেষ্টা করা হচ্ছে।
     * ব্যর্থ হলে সুন্দর menu text-ই পাঠাবে।
     */

    const copyCommands =
      COMMAND_DEFINITIONS
        .filter(item =>
          isCommandEnabled(
            remoteJid,
            item.key
          )
        )
        .map(
          item =>
            item.command
        );

    try {
      await sock.sendMessage(
        remoteJid,
        {
          text,
          buttons:
            copyCommands.map(
              command =>
                makeCopyButton(
                  command
                )
            )
        }
      );

    } catch (buttonError) {
      console.log(
        "⚠️ Copy buttons unsupported:",
        buttonError?.message
      );

      await sock.sendMessage(
        remoteJid,
        {
          text
        }
      );
    }

  } catch (error) {
    console.log(
      "❌ Public menu error:",
      error?.message
    );
  }
}

/* =========================================================
   ADMIN PANEL
========================================================= */

async function sendAdminPanel(
  remoteJid
) {
  try {
    const disabled =
      getGroupStatus(
        remoteJid
      ).disabledCommands || [];

    const commandStatus =
      COMMAND_DEFINITIONS
        .map(item => {
          const enabled =
            !disabled.includes(
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
       👑 *ADMIN PANEL*
╰━━━━━━━━━━━━━━━━━━━━╯

🔐 *শুধুমাত্র Admin ও Owner-এর জন্য*

╭─❖ 🤖 *BOT STATUS*
│
│ ${
      isBotEnabled(remoteJid)
        ? "🟢 Bot: ON"
        : "🔴 Bot: OFF"
    }
╰────────────────────

╭─❖ ⚙️ *COMMAND STATUS*
│
${commandStatus}
╰────────────────────

╭─❖ 🛠️ *BOT CONTROL*
│
│ 🟢 /boton
│ 🔴 /botoff
╰────────────────────

╭─❖ ⚙️ *COMMAND CONTROL*
│
│ 🟢 /on <command>
│ 🔴 /off <command>
│ 📋 /cmdlist
╰────────────────────

╭─❖ 💡 *EXAMPLE*
│
│ 🔴 /off admin
│ 🟢 /on admin
│
│ 🔴 /off deal
│ 🟢 /on deal
│
│ 🔴 /off rules
│ 🟢 /on rules
│
│ 🔴 /off website
│ 🟢 /on website
╰────────────────────

━━━━━━━━━━━━━━━━━━━━
       👑 *ADMIN ONLY*
━━━━━━━━━━━━━━━━━━━━

🤖 *PIYAS BOT*
`;

    const buttons = [
      "/boton",
      "/botoff",
      "/on admin",
      "/off admin",
      "/cmdlist"
    ].map(
      command =>
        makeCopyButton(
          command
        )
    );

    try {
      await sock.sendMessage(
        remoteJid,
        {
          text,
          buttons
        }
      );
    } catch {
      await sock.sendMessage(
        remoteJid,
        {
          text
        }
      );
    }

  } catch (error) {
    console.log(
      "❌ Admin panel error:",
      error?.message
    );
  }
}

/* =========================================================
   COMMAND STATUS
========================================================= */

async function sendCommandList(
  remoteJid
) {
  const disabled =
    getGroupStatus(
      remoteJid
    ).disabledCommands || [];

  const lines =
    COMMAND_DEFINITIONS
      .map(item => {
        const enabled =
          !disabled.includes(
            item.key
          );

        return (
          `${enabled ? "🟢" : "🔴"} ${item.command}`
        );
      })
      .join("\n");

  const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
      📋 *COMMAND STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines}

━━━━━━━━━━━━━━━━━━━━

🤖 *Bot Status:*
${
  isBotEnabled(remoteJid)
    ? "🟢 ON"
    : "🔴 OFF"
}

━━━━━━━━━━━━━━━━━━━━

👑 শুধুমাত্র Admin ও Owner
এই Status দেখতে পারবেন।

🤍 *Piyas*
`;

  await sock.sendMessage(
    remoteJid,
    {
      text
    }
  );
}

/* =========================================================
   RULES
========================================================= */

const GROUP_RULES = `
╭━━━━━━━━━━━━━━━━━━━━╮
        📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করে কথা বলুন।

2️⃣ অশ্লীল বা আপত্তিকর কোনো
কনটেন্ট শেয়ার করবেন না।

3️⃣ Spam বা একই মেসেজ
বারবার পাঠাবেন না।

4️⃣ সন্দেহজনক বা প্রতারণামূলক
লিংক শেয়ার করবেন না।

5️⃣ অন্য সদস্যকে হয়রানি
বা বিরক্ত করবেন না।

6️⃣ Account Buy/Sell ও
Google Play Points সম্পর্কিত
বিষয়ে সবাই সতর্ক থাকুন।

7️⃣ কোনো সমস্যায় পড়লে
সরাসরি Admin-কে জানান।

🤍 সবাই মিলে গ্রুপের
পরিবেশ সুন্দর রাখুন।
`;

/* =========================================================
   WEBSITE
========================================================= */

const WEBSITE_TEXT = `
╭━━━━━━━━━━━━━━━━━━━━╮
      🌐 *OUR WEBSITE*
╰━━━━━━━━━━━━━━━━━━━━╯

🌐 *Official Website:*

${WEBSITE_URL}

🎁 এখানে Account Buy/Sell,
Google Play Points এবং
অন্যান্য earning সম্পর্কিত
তথ্য পাওয়া যাবে।

🤍 *Piyas*
`;

/* =========================================================
   PIYAS
========================================================= */

const PIYAS_INFO = `
╭━━━━━━━━━━━━━━━━━━╮
       🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━╯

☪️ *আমার সবচেয়ে বড় পরিচয়: আমি একজন মুসলিম এবং মহানবী হযরত মুহাম্মাদ (সা.)-এর উম্মত।* 🤍

👤 *Name:* মোঃ আল আমিন
🌐 *English Name:* MD. AL AMIN

👨‍👦 *Father:* মোঃ মোশারফ হোসেন
👩‍👦 *Mother:* মোসাম্মৎ রীপা বেগম

🎂 *Date of Birth:* ০৯ জানুয়ারি ২০০৬
🩸 *Blood Group:* A+

💍 *Marital Status:* Unmarried

🏠 *Address:*
গ্রাম/রাস্তা: বলদার চর, নান্দাইল
ডাকঘর: হেমগঞ্জ বাজার - ২২৯০
নান্দাইল, ময়মনসিংহ

🤍 *Thank You*
`;

/* =========================================================
   BOT STATUS
========================================================= */

const BOT_OFF_TEXT = `
╭━━━━━━━━━━━━━━━━━━━━╮
       🔴 *BOT OFF*
╰━━━━━━━━━━━━━━━━━━━━╯

বট এখন সাময়িকভাবে বন্ধ করা হয়েছে।

👑 শুধুমাত্র Admin / Owner
আবার চালু করতে পারবেন।

🟢 /boton

🤖 *PIYAS BOT*
`;

const BOT_ON_TEXT = `
╭━━━━━━━━━━━━━━━━━━━━╮
        🟢 *BOT ON*
╰━━━━━━━━━━━━━━━━━━━━╯

বট এখন পুনরায় চালু করা হয়েছে। ✅

🤖 এখন সব Command ব্যবহার করা যাবে।

🤍 *Piyas*
`;

const BOT_ALREADY_OFF_TEXT = `
🔴 *BOT STATUS*

বট ইতোমধ্যে OFF আছে।
`;

const BOT_ALREADY_ON_TEXT = `
🟢 *BOT STATUS*

বট ইতোমধ্যে ON আছে।
`;

/* =========================================================
   DEAL
========================================================= */

const DEAL_NOTICE_TOP = `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤝 *DEAL NOTICE*
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ *গুরুত্বপূর্ণ সতর্কতা!*

কোনো ধরনের Account Buy/Sell,
Google Play Points অথবা অন্য
কোনো Deal করার আগে অবশ্যই
Group-এর Admin-এর সাথে
যোগাযোগ করুন।

🚫 *Admin ছাড়া কারো সাথে
কোনো Deal করবেন না।*

⚠️ Admin-এর অনুমতি ছাড়া
কোনো Deal করলে তার সম্পূর্ণ
দায়ভার সংশ্লিষ্ট ব্যক্তির।

❌ Admin ছাড়া করা কোনো Deal-এর
জন্য Group Admin কোনোভাবেই
দায়ী থাকবে না।

👑 *Deal করার জন্য Group Admin:*

`;

const DEAL_NOTICE_BOTTOM = `
📌 নিরাপদ থাকতে সবসময়
Admin-এর মাধ্যমে Deal করুন।

🤍 *PIYAS*
`;

/* =========================================================
   ADMIN DATA
========================================================= */

async function getAdminData(
  remoteJid
) {
  try {
    const metadata =
      await sock.groupMetadata(
        remoteJid
      );

    const participants =
      metadata?.participants || [];

    await cacheParticipants(
      participants
    );

    const adminParticipants =
      participants.filter(
        isAdminParticipant
      );

    const result = [];
    const usedJids = new Set();

    for (
      const participant of adminParticipants
    ) {
      let phoneJid =
        await getPhoneJid(
          participant
        );

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

/* =========================================================
   ADMIN LIST
========================================================= */

async function sendAdminList(
  remoteJid
) {
  const {
    admins
  } =
    await getAdminData(
      remoteJid
    );

  if (!admins.length) {
    await sock.sendMessage(
      remoteJid,
      {
        text:
          "👑 এই গ্রুপে কোনো Admin পাওয়া যায়নি।"
      }
    );

    return;
  }

  const lines = [];
  const mentions = [];

  let number = 1;

  for (
    const admin of admins
  ) {
    const role =
      admin.owner
        ? "⭐ *Group Owner*"
        : "👑 *Admin*";

    if (
      isPhoneJid(
        admin.jid
      )
    ) {
      const phone =
        admin.jid
          .split("@")[0]
          .replace(
            /[^0-9]/g,
            ""
          );

      mentions.push(
        admin.jid
      );

      lines.push(
        `${number}️⃣ @${phone} ${role}`
      );
    } else {
      lines.push(
        `${number}️⃣ ${admin.name} ${role}`
      );
    }

    number++;
  }

  const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n\n")}

━━━━━━━━━━━━━━━━━━━━

👥 *মোট Admin:* ${admins.length} জন

🤍 *Piyas*
`;

  await sock.sendMessage(
    remoteJid,
    {
      text,
      mentions
    }
  );
}

/* =========================================================
   DEAL MESSAGE
========================================================= */

async function sendDealNotice(
  remoteJid
) {
  const {
    admins
  } =
    await getAdminData(
      remoteJid
    );

  if (!admins.length) {
    await sock.sendMessage(
      remoteJid,
      {
        text:
          DEAL_NOTICE_TOP +
          "⚠️ বর্তমানে কোনো Admin পাওয়া যায়নি.\n\n" +
          DEAL_NOTICE_BOTTOM
      }
    );

    return;
  }

  const lines = [];
  const mentions = [];

  let number = 1;

  for (
    const admin of admins
  ) {
    const role =
      admin.owner
        ? "⭐ *Group Owner*"
        : "👑 *Admin*";

    if (
      isPhoneJid(
        admin.jid
      )
    ) {
      const phone =
        admin.jid
          .split("@")[0]
          .replace(
            /[^0-9]/g,
            ""
          );

      mentions.push(
        admin.jid
      );

      lines.push(
        `${number}️⃣ @${phone} ${role}`
      );
    } else {
      lines.push(
        `${number}️⃣ ${admin.name} ${role}`
      );
    }

    number++;
  }

  const text =
    DEAL_NOTICE_TOP +
    lines.join("\n\n") +
    `\n\n👥 *মোট Admin:* ${admins.length} জন\n\n` +
    DEAL_NOTICE_BOTTOM;

  await sock.sendMessage(
    remoteJid,
    {
      text,
      mentions
    }
  );
}

/* =========================================================
   WELCOME
========================================================= */

function getWelcomeText(
  name
) {
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম @${name}!* ❤️

🌸 আপনাকে *Play point League*
গ্রুপে স্বাগতম।

💬 এখানে সবাই একে অপরকে
সহযোগিতা করবেন।

📌 গ্রুপের নিয়ম দেখতে লিখুন:
*/rules*

🌐 Website দেখতে লিখুন:
*/website*

⚡ Account Buy/Sell ও
Google Play Points সম্পর্কিত
তথ্য এখানে শেয়ার করা হয়।

⚠️ *বিশেষ সতর্কতা:*

যেকোনো সমস্যায় পড়লে
সরাসরি Admin-কে জানাবেন।

কোনো ধরনের প্রতারণা বা
সন্দেহজনক বিষয় দেখলে
Admin-কে জানান।

🌐 *Our Official Website:*
${WEBSITE_URL}

🤍 *Piyas*
`;
}

async function sendWelcome(
  groupId,
  participant
) {
  try {
    if (
      !sock ||
      !isBotEnabled(groupId) ||
      !isCommandEnabled(
        groupId,
        "welcome"
      )
    ) {
      return;
    }

    let metadata = null;

    try {
      metadata =
        await sock.groupMetadata(
          groupId
        );

      await cacheParticipants(
        metadata?.participants ||
          []
      );
    } catch {}

    let member =
      findParticipant(
        metadata?.participants ||
          [],
        participant?.id
      );

    if (!member) {
      member =
        findParticipant(
          metadata?.participants ||
            [],
          participant?.lid
        );
    }

    if (!member) {
      member = participant;
    }

    const name =
      getDisplayName(
        member
      );

    const phoneJid =
      await getPhoneJid(
        member
      );

    if (
      isPhoneJid(phoneJid)
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            getWelcomeText(
              name
            ),
          mentions: [
            phoneJid
          ]
        }
      );
    } else {
      await sock.sendMessage(
        groupId,
        {
          text:
            getWelcomeText(
              name
            ).replace(
              `@${name}`,
              name
            )
        }
      );
    }

  } catch (error) {
    console.log(
      "❌ Welcome send error:",
      error?.message
    );
  }
}

/* =========================================================
   LID EVENT
========================================================= */

function handleLidMappingUpdate(
  mapping
) {
  try {
    if (!mapping) {
      return;
    }

    const mappings =
      Array.isArray(mapping)
        ? mapping
        : Array.isArray(
            mapping?.mappings
          )
        ? mapping.mappings
        : [mapping];

    for (
      const item of mappings
    ) {
      if (!item) {
        continue;
      }

      const lid =
        item.lid ||
        item.lidJid ||
        item.lid_jid;

      const pn =
        item.pn ||
        item.pnJid ||
        item.pn_jid ||
        item.phone ||
        item.phoneNumber;

      if (
        lid &&
        pn
      ) {
        saveLidMapping(
          lid,
          pn
        );
      }
    }
  } catch (error) {
    console.log(
      "⚠️ LID mapping update error:",
      error?.message
    );
  }
}

/* =========================================================
   PAIRING CODE
========================================================= */

async function generatePairingCode(
  state
) {
  try {
    if (!PHONE_NUMBER) {
      console.log(
        "❌ PHONE_NUMBER is missing in .env"
      );

      return;
    }

    if (
      state.creds.registered
    ) {
      console.log(
        "✅ Existing WhatsApp session found."
      );

      console.log(
        "🔐 Pairing Code will NOT be generated."
      );

      return;
    }

    const savedNumber =
      readSavedPairingNumber();

    if (
      savedNumber &&
      savedNumber === PHONE_NUMBER
    ) {
      console.log(
        "ℹ️ Same PHONE_NUMBER detected."
      );

      return;
    }

    if (
      pairingRequested
    ) {
      return;
    }

    pairingRequested = true;

    console.log(
      `📱 New PHONE_NUMBER detected: ${PHONE_NUMBER}`
    );

    console.log(
      "🔐 Generating WhatsApp Pairing Code..."
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          2500
        )
    );

    if (
      !sock ||
      state.creds.registered
    ) {
      pairingRequested = false;
      return;
    }

    const code =
      await sock.requestPairingCode(
        PHONE_NUMBER
      );

    savePairingNumber(
      PHONE_NUMBER
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log(
      `🔐 PAIRING CODE: ${code}`
    );

    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );

    console.log(
      "📲 WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead"
    );

  } catch (error) {
    pairingRequested = false;

    console.log(
      "❌ Pairing code error:",
      error?.message
    );
  }
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

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ""
  ).trim();
}

/* =========================================================
   START BOT
========================================================= */

async function startBot() {
  try {
    let authState =
      await useMultiFileAuthState(
        AUTH_DIR
      );

    let {
      state,
      saveCreds
    } = authState;

    const currentCredPhone =
      getCredentialPhoneNumber(
        state.creds
      );

    const numberChanged =
      PHONE_NUMBER &&
      state.creds.registered &&
      currentCredPhone &&
      currentCredPhone !==
        PHONE_NUMBER;

    if (
      numberChanged
    ) {
      console.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      );

      console.log(
        "🔄 PHONE NUMBER CHANGED"
      );

      console.log(
        `Old: ${currentCredPhone}`
      );

      console.log(
        `New: ${PHONE_NUMBER}`
      );

      console.log(
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      );

      await resetAuthForNumberChange();

      pairingRequested = false;

      authState =
        await useMultiFileAuthState(
          AUTH_DIR
        );

      state =
        authState.state;

      saveCreds =
        authState.saveCreds;

      console.log(
        "🆕 New WhatsApp session created."
      );
    }

    /* =====================================================
       SOCKET
    ===================================================== */

    sock =
      makeWASocket({
        auth: state,
        logger,
        browser:
          Browsers.ubuntu(
            "Chrome"
          ),
        markOnlineOnConnect:
          false,
        syncFullHistory:
          false,
        generateHighQualityLinkPreview:
          false,
        printQRInTerminal:
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
       LID
    ===================================================== */

    sock.ev.on(
      "lid-mapping.update",
      handleLidMappingUpdate
    );

    /* =====================================================
       CONTACTS
    ===================================================== */

    sock.ev.on(
      "contacts.upsert",
      contacts => {
        try {
          saveContacts(
            contacts
          );
        } catch (error) {
          console.log(
            "⚠️ contacts.upsert error:",
            error?.message
          );
        }
      }
    );

    sock.ev.on(
      "contacts.update",
      contacts => {
        try {
          saveContacts(
            contacts
          );
        } catch (error) {
          console.log(
            "⚠️ contacts.update error:",
            error?.message
          );
        }
      }
    );

    /* =====================================================
       GROUP PARTICIPANTS
    ===================================================== */

    sock.ev.on(
      "group-participants.update",
      async event => {
        try {
          const groupId =
            event?.id;

          const action =
            event?.action;

          const participants =
            event?.participants ||
            [];

          if (!groupId) {
            return;
          }

          if (
            !isGroupAllowed(
              groupId
            )
          ) {
            return;
          }

          console.log(
            `👥 Group update: ${action} | ${groupId} | ${participants.length} participant(s)`
          );

          if (
            action === "add"
          ) {
            for (
              const participant of participants
            ) {
              await sendWelcome(
                groupId,
                participant
              );
            }
          }

          if (
            action === "promote" ||
            action === "demote"
          ) {
            await cacheParticipants(
              participants
            );
          }

        } catch (error) {
          console.log(
            "❌ Group participant event error:",
            error?.message
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
        try {
          const {
            connection,
            lastDisconnect
          } = update;

          if (
            connection ===
            "connecting"
          ) {
            console.log(
              "🔄 Connecting to WhatsApp..."
            );

            if (
              PHONE_NUMBER &&
              !state.creds.registered
            ) {
              await generatePairingCode(
                state
              );
            }
          }

          if (
            connection === "open"
          ) {
            console.log(
              "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            );

            console.log(
              "✅ WhatsApp Bot Connected Successfully!"
            );

            console.log(
              "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            );

            reconnecting = false;

            try {
              const groups =
                await sock.groupFetchAllParticipating();

              for (
                const group of Object.values(
                  groups || {}
                )
              ) {
                await cacheParticipants(
                  group?.participants ||
                    []
                );
              }

              console.log(
                "📦 Group participant cache loaded."
              );

            } catch (error) {
              console.log(
                "⚠️ Group cache error:",
                error?.message
              );
            }

            return;
          }

          if (
            connection === "close"
          ) {
            const statusCode =
              new Boom(
                lastDisconnect?.error
              )?.output?.statusCode;

            const shouldReconnect =
              statusCode !==
              DisconnectReason.loggedOut;

            console.log(
              `❌ WhatsApp connection closed. Code: ${statusCode}`
            );

            sock = null;

            pairingRequested = false;

            if (
              shouldReconnect &&
              !reconnecting
            ) {
              reconnecting = true;

              console.log(
                "🔄 Reconnecting..."
              );

              setTimeout(
                () => {
                  reconnecting = false;
                  startBot();
                },
                3000
              );

            } else if (
              !shouldReconnect
            ) {
              console.log(
                "🚪 WhatsApp session logged out."
              );

              console.log(
                "ℹ️ New number দিলে নতুন Pairing Code generate হবে."
              );
            }
          }

        } catch (error) {
          console.log(
            "❌ Connection update error:",
            error?.message
          );
        }
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
        try {
          const message =
            messages?.[0];

          if (
            !message ||
            message.key?.fromMe
          ) {
            return;
          }

          const remoteJid =
            message.key?.remoteJid;

          if (
            !remoteJid ||
            !remoteJid.endsWith(
              "@g.us"
            )
          ) {
            return;
          }

          if (
            !isGroupAllowed(
              remoteJid
            )
          ) {
            return;
          }

          const text =
            getMessageText(
              message
            );

          if (!text) {
            return;
          }

          const parts =
            text
              .trim()
              .split(
                /\s+/
              );

          const rawCommand =
            parts[0]
              .toLowerCase();

          const command =
            normalizeCommandName(
              rawCommand
            );

          const args =
            parts.slice(1);

          /* =================================================
             ADMIN-ONLY COMMANDS
          ================================================= */

          const adminOnlyCommands = [
            "adminpanel",
            "cmdlist",
            "botoff",
            "boton",
            "off",
            "on"
          ];

          /*
           * Admin Panel এবং control commands
           * সাধারণ Member কখনো দেখতে/ব্যবহার করতে পারবে না।
           */

          if (
            adminOnlyCommands.includes(
              command
            )
          ) {
            const admin =
              await isSenderAdmin(
                remoteJid,
                message
              );

            if (!admin) {
              return;
            }
          }

          /* =================================================
             BOT OFF
          ================================================= */

          if (
            command === "botoff"
          ) {
            if (
              !isBotEnabled(
                remoteJid
              )
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    BOT_ALREADY_OFF_TEXT
                }
              );

              return;
            }

            setBotStatus(
              remoteJid,
              false
            );

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  BOT_OFF_TEXT
              }
            );

            return;
          }

          /* =================================================
             BOT ON
          ================================================= */

          if (
            command === "boton"
          ) {
            if (
              isBotEnabled(
                remoteJid
              )
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    BOT_ALREADY_ON_TEXT
                }
              );

              return;
            }

            setBotStatus(
              remoteJid,
              true
            );

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  BOT_ON_TEXT
              }
            );

            return;
          }

          /* =================================================
             ADMIN PANEL
          ================================================= */

          if (
            command ===
            "adminpanel"
          ) {
            await sendAdminPanel(
              remoteJid
            );

            return;
          }

          /* =================================================
             COMMAND ON / OFF
          ================================================= */

          if (
            command === "off" ||
            command === "on"
          ) {
            const target =
              normalizeCommandName(
                args[0]
              );

            if (!target) {
              await sock.sendMessage(
                remoteJid,
                {
                  text: `
╭━━━━━━━━━━━━━━━━━━━━╮
      ⚙️ *COMMAND CONTROL*
╰━━━━━━━━━━━━━━━━━━━━╯

🔴 *OFF:*

/off <command>

🟢 *ON:*

/on <command>

💡 উদাহরণ:

/off admin
/on admin

/off deal
/on deal

/off rules
/on rules

/off website
/on website
`
                }
              );

              return;
            }

            const protectedCommands = [
              "on",
              "off",
              "boton",
              "botoff",
              "cmdlist",
              "adminpanel"
            ];

            if (
              protectedCommands.includes(
                target
              )
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "⚠️ এই Admin Control Command বন্ধ করা যাবে না।"
                }
              );

              return;
            }

            const targetCommand =
              target === "ডিল"
                ? "deal"
                : target;

            if (
              command === "off"
            ) {
              if (
                !isCommandEnabled(
                  remoteJid,
                  targetCommand
                )
              ) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `🔴 */${targetCommand}* ইতোমধ্যে OFF আছে।`
                  }
                );

                return;
              }

              setCommandStatus(
                remoteJid,
                targetCommand,
                false
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🔴 *COMMAND OFF*
╰━━━━━━━━━━━━━━━━━━━━╯

⚙️ *Command:*
/${targetCommand}

❌ এখন থেকে এই Command
কাজ করবে না।

🟢 আবার চালু করতে:

/on ${targetCommand}

🤖 *PIYAS BOT*
`
                }
              );

              return;
            }

            if (
              command === "on"
            ) {
              if (
                isCommandEnabled(
                  remoteJid,
                  targetCommand
                )
              ) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `🟢 */${targetCommand}* ইতোমধ্যে ON আছে।`
                  }
                );

                return;
              }

              setCommandStatus(
                remoteJid,
                targetCommand,
                true
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        🟢 *COMMAND ON*
╰━━━━━━━━━━━━━━━━━━━━╯

⚙️ *Command:*
/${targetCommand}

✅ এখন থেকে এই Command
আবার কাজ করবে।

🤖 *PIYAS BOT*
`
                }
              );

              return;
            }
          }

          /* =================================================
             COMMAND LIST
          ================================================= */

          if (
            command === "cmdlist"
          ) {
            await sendCommandList(
              remoteJid
            );

            return;
          }

          /* =================================================
             BOT OFF হলে সাধারণ command বন্ধ
          ================================================= */

          if (
            !isBotEnabled(
              remoteJid
            )
          ) {
            return;
          }

          /* =================================================
             COMMAND OFF CHECK
          ================================================= */

          const commandAlias =
            command === "ডিল"
              ? "deal"
              : command;

          if (
            !isCommandEnabled(
              remoteJid,
              commandAlias
            )
          ) {
            return;
          }

          /* =================================================
             MENU
          ================================================= */

          if (
            command === "menu" ||
            command === "bot"
          ) {
            await sendPublicMenu(
              remoteJid
            );

            return;
          }

          /* =================================================
             RULES
          ================================================= */

          if (
            command === "rules"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  GROUP_RULES
              }
            );

            return;
          }

          /* =================================================
             WEBSITE
          ================================================= */

          if (
            command === "website"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  WEBSITE_TEXT
              }
            );

            return;
          }

          /* =================================================
             DEAL
          ================================================= */

          if (
            command === "deal" ||
            command === "ডিল"
          ) {
            await sendDealNotice(
              remoteJid
            );

            return;
          }

          /* =================================================
             ADMIN
          ================================================= */

          if (
            command === "admin"
          ) {
            await sendAdminList(
              remoteJid
            );

            return;
          }

          /* =================================================
             MEMBERS
          ================================================= */

          if (
            command === "members"
          ) {
            const metadata =
              await sock.groupMetadata(
                remoteJid
              );

            const participants =
              metadata?.participants ||
              [];

            await sock.sendMessage(
              remoteJid,
              {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        👥 *GROUP MEMBERS*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 *মোট Member:* ${participants.length} জন

🤍 *Piyas*
`
              }
            );

            return;
          }

          /* =================================================
             GROUP INFO
          ================================================= */

          if (
            command === "groupinfo"
          ) {
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

            const admins =
              participants.filter(
                isAdminParticipant
              );

            const created =
              metadata?.creation
                ? new Date(
                    Number(
                      metadata.creation
                    ) * 1000
                  ).toLocaleString(
                    "en-BD"
                  )
                : "Unknown";

            await sock.sendMessage(
              remoteJid,
              {
                text: `
╭━━━━━━━━━━━━━━━━━━╮
       👥 *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━╯

📛 *Name:* ${
                  metadata?.subject ||
                  "Unknown"
                }

🆔 *ID:* ${remoteJid}

👥 *Members:* ${
                  participants.length
                }

👑 *Admins:* ${
                  admins.length
                }

📅 *Created:* ${
                  created
                }

🤖 *Bot:* ${
                  isBotEnabled(
                    remoteJid
                  )
                    ? "🟢 ON"
                    : "🔴 OFF"
                }

🤍 *Powered by Piyas*
`
              }
            );

            return;
          }

          /* =================================================
             ID
          ================================================= */

          if (
            command === "id"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🆔 *GROUP ID*\n\n${remoteJid}`
              }
            );

            return;
          }

          /* =================================================
             PING
          ================================================= */

          if (
            command === "ping"
          ) {
            const start =
              Date.now();

            const msg =
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "🏓 Checking Bot..."
                }
              );

            const ping =
              Date.now() -
              start;

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🏓 *PONG!*\n\n⚡ Response: ${ping}ms\n🤖 Bot: Online`,
                edit:
                  msg.key
              }
            );

            return;
          }

          /* =================================================
             PIYAS
          ================================================= */

          if (
            command === "piyas"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  PIYAS_INFO
              }
            );

            return;
          }

        } catch (error) {
          console.log(
            "⚠️ Message handler error:",
            error?.message
          );
        }
      }
    );

    console.log(
      "🚀 WhatsApp Bot Starting..."
    );

  } catch (error) {
    console.log(
      "❌ Failed to start bot:",
      error?.message
    );

    sock = null;

    if (
      !reconnecting
    ) {
      reconnecting = true;

      setTimeout(
        () => {
          reconnecting = false;
          startBot();
        },
        5000
      );
    }
  }
}

/* =========================================================
   GLOBAL ERRORS
========================================================= */

process.on(
  "uncaughtException",
  error => {
    console.log(
      "❌ Uncaught Exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.log(
      "❌ Unhandled Rejection:",
      error
    );
  }
);

/* =========================================================
   SHUTDOWN
========================================================= */

async function shutdown() {
  console.log(
    "\n🛑 Shutting down bot..."
  );

  try {
    if (sock) {
      sock.end(
        new Error(
          "Bot shutting down"
        )
      );
    }
  } catch {}

  try {
    server.close();
  } catch {}

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

startBot();