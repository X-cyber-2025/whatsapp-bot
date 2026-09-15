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
   PIYAS BOT
   ========================================================= */

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER = String(
  process.env.PHONE_NUMBER || ""
).replace(/\D/g, "");

const GROUP_IDS = (process.env.GROUP_ID || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

const AUTH_FOLDER =
  process.env.AUTH_FOLDER ||
  "auth_info_baileys";

const STATUS_FILE =
  process.env.STATUS_FILE ||
  "bot_status.json";

let sock = null;

/* =========================================================
   COMMANDS
   ========================================================= */

const COMMAND_DEFINITIONS = {
  menu: {
    aliases: ["menu"],
    title: "Menu"
  },

  bot: {
    aliases: ["bot"],
    title: "Bot Info"
  },

  rules: {
    aliases: ["rules"],
    title: "Rules"
  },

  admin: {
    aliases: ["admin"],
    title: "Admin"
  },

  members: {
    aliases: ["members"],
    title: "Members"
  },

  groupinfo: {
    aliases: ["groupinfo"],
    title: "Group Info"
  },

  id: {
    aliases: ["id"],
    title: "Group ID"
  },

  ping: {
    aliases: ["ping"],
    title: "Ping"
  },

  deal: {
    aliases: ["deal"],
    title: "Deal"
  },

  piyas: {
    aliases: ["piyas", "পিয়াস"],
    title: "PIYAS"
  },

  website: {
    aliases: ["website"],
    title: "Website"
  }
};

const ADMIN_COMMANDS = [
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "offbot",
  "onbot",
  "fullbotstatus"
];

const PROTECTED_COMMANDS = [
  "adminpanel",
  "cmdlist",
  "on",
  "off",
  "boton",
  "botoff",
  "offbot",
  "onbot",
  "fullbotstatus"
];

const COMMAND_ALIAS_MAP = {};

for (
  const [key, data]
  of Object.entries(COMMAND_DEFINITIONS)
) {
  for (
    const alias
    of data.aliases
  ) {
    COMMAND_ALIAS_MAP[
      alias.toLowerCase()
    ] = key;
  }
}

/* =========================================================
   STATUS
   ========================================================= */

function defaultStatus() {
  return {
    enabled: true,
    disabledCommands: [],
    fullBotOff: false,
    adminAllowedCommands: [],
    welcomeEnabled: true
  };
}

function loadStatus() {
  try {
    if (
      !fs.existsSync(
        STATUS_FILE
      )
    ) {
      return defaultStatus();
    }

    const raw =
      fs.readFileSync(
        STATUS_FILE,
        "utf8"
      );

    const data =
      JSON.parse(raw);

    if (
      typeof data ===
      "boolean"
    ) {
      return {
        ...defaultStatus(),
        enabled: data
      };
    }

    return {
      ...defaultStatus(),
      ...data,

      disabledCommands:
        Array.isArray(
          data.disabledCommands
        )
          ? data.disabledCommands
          : [],

      adminAllowedCommands:
        Array.isArray(
          data.adminAllowedCommands
        )
          ? data.adminAllowedCommands
          : []
    };

  } catch (error) {
    console.error(
      "Status load error:",
      error
    );

    return defaultStatus();
  }
}

function saveStatus(
  status
) {
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify(
        status,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "Status save error:",
      error
    );
  }
}

const botStatus =
  new Map();

function getStatus(
  groupId
) {
  if (
    !botStatus.has(
      groupId
    )
  ) {
    botStatus.set(
      groupId,
      loadStatus()
    );
  }

  return botStatus.get(
    groupId
  );
}

function updateStatus(
  groupId,
  patch
) {
  const current =
    getStatus(groupId);

  const updated = {
    ...current,
    ...patch
  };

  botStatus.set(
    groupId,
    updated
  );

  saveStatus(
    updated
  );

  return updated;
}

function isBotEnabled(
  groupId
) {
  return (
    getStatus(groupId)
      .enabled === true
  );
}

function setBotEnabled(
  groupId,
  enabled
) {
  updateStatus(
    groupId,
    {
      enabled:
        Boolean(enabled)
    }
  );
}

function isFullBotOff(
  groupId
) {
  return (
    getStatus(groupId)
      .fullBotOff === true
  );
}

function getAdminAllowedCommands(
  groupId
) {
  return (
    getStatus(groupId)
      .adminAllowedCommands ||
    []
  );
}

function setAdminAllowedCommands(
  groupId,
  commands
) {
  updateStatus(
    groupId,
    {
      adminAllowedCommands:
        [
          ...new Set(
            commands
          )
        ]
    }
  );
}

function isAdminAllowedCommand(
  groupId,
  command
) {
  return getAdminAllowedCommands(
    groupId
  ).includes(command);
}

function isWelcomeEnabled(
  groupId
) {
  return (
    getStatus(groupId)
      .welcomeEnabled !== false
  );
}

function setWelcomeEnabled(
  groupId,
  enabled
) {
  updateStatus(
    groupId,
    {
      welcomeEnabled:
        Boolean(enabled)
    }
  );
}

/* =========================================================
   COMMAND HELPERS
   ========================================================= */

function normalizeCommandName(
  command
) {
  return String(
    command || ""
  )
    .replace(/^\//, "")
    .trim()
    .toLowerCase();
}

function resolveCommand(
  command
) {
  const normalized =
    normalizeCommandName(
      command
    );

  if (
    ADMIN_COMMANDS.includes(
      normalized
    )
  ) {
    return normalized;
  }

  return (
    COMMAND_ALIAS_MAP[
      normalized
    ] || null
  );
}

function isCommandEnabled(
  groupId,
  command
) {
  const normalized =
    normalizeCommandName(
      command
    );

  return !getStatus(
    groupId
  ).disabledCommands.includes(
    normalized
  );
}

function enableCommand(
  groupId,
  command
) {
  const normalized =
    normalizeCommandName(
      command
    );

  const disabled =
    getStatus(
      groupId
    ).disabledCommands.filter(
      value =>
        value !== normalized
    );

  updateStatus(
    groupId,
    {
      disabledCommands:
        disabled
    }
  );
}

function disableCommand(
  groupId,
  command
) {
  const normalized =
    normalizeCommandName(
      command
    );

  if (
    PROTECTED_COMMANDS.includes(
      normalized
    )
  ) {
    return false;
  }

  const disabled =
    getStatus(
      groupId
    ).disabledCommands;

  if (
    !disabled.includes(
      normalized
    )
  ) {
    disabled.push(
      normalized
    );
  }

  updateStatus(
    groupId,
    {
      disabledCommands:
        disabled
    }
  );

  return true;
}

/* =========================================================
   MESSAGE HELPERS
   ========================================================= */

function getMessageText(
  message
) {
  if (!message) {
    return "";
  }

  return (
    message.conversation ||
    message.extendedTextMessage
      ?.text ||
    message.imageMessage
      ?.caption ||
    message.videoMessage
      ?.caption ||
    message.documentMessage
      ?.caption ||
    message.buttonsResponseMessage
      ?.selectedButtonId ||
    message.listResponseMessage
      ?.singleSelectReply
      ?.selectedRowId ||
    message.templateButtonReplyMessage
      ?.selectedId ||
    ""
  );
}

function getGroupId(
  message
) {
  const jid =
    message?.key
      ?.remoteJid || "";

  return jid.endsWith(
    "@g.us"
  )
    ? jid
    : null;
}

function getSenderJid(
  message
) {
  return (
    message?.key
      ?.participant ||
    message?.key
      ?.remoteJid ||
    ""
  );
}

/* =========================================================
   COPY BUTTON
   ========================================================= */

function makeCopyButton(
  command
) {
  const normalized =
    normalizeCommandName(
      command
    );

  return {
    name: "cta_copy",

    buttonParamsJson:
      JSON.stringify({
        display_text:
          `📋 Copy ${command}`,

        id:
          `copy_${normalized}`,

        copy_code:
          command
      })
  };
}

/* =========================================================
   PUBLIC MENU
   =========================================================
   IMPORTANT:
   সব Command একই Message-এর মধ্যে থাকবে।
   প্রতিটি Command-এর জন্য Native Copy Button থাকবে।
   ========================================================= */

async function sendPublicMenu(
  jid
) {
  if (!sock) {
    return;
  }

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
    "/piyas",
    "/website"
  ];

  const bodyText =
`╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 PIYAS BOT
╰━━━━━━━━━━━━━━━━━━━━╯

📋 AVAILABLE COMMANDS

🟢 /menu
🟢 /bot
🟢 /rules
🟢 /admin
🟢 /members
🟢 /groupinfo
🟢 /id
🟢 /ping
🟢 /deal
🟢 /piyas
🟢 /website

━━━━━━━━━━━━━━━━━━━━

📋 নিচের Copy Button থেকে
প্রয়োজনীয় Command কপি করুন।

❤️ PIYAS BOT`;

  try {
    const buttons =
      commands.map(
        command =>
          makeCopyButton(
            command
          )
      );

    const msg =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },

              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create({
                    body:
                      proto.Message
                        .InteractiveMessage
                        .Body
                        .create({
                          text:
                            bodyText
                        }),

                    nativeFlowMessage:
                      proto.Message
                        .InteractiveMessage
                        .NativeFlowMessage
                        .create({
                          buttons
                        })
                  })
            }
          }
        },
        {
          userJid:
            sock.user?.id
        }
      );

    await sock.relayMessage(
      jid,
      msg.message,
      {
        messageId:
          msg.key.id
      }
    );

  } catch (error) {
    console.error(
      "Public Menu Error:",
      error
    );

    await sock.sendMessage(
      jid,
      {
        text:
          bodyText
      }
    );
  }
}

/* =========================================================
   ADMIN PANEL
   ========================================================= */

async function sendAdminPanel(
  jid,
  groupId
) {
  const status =
    getStatus(groupId);

  const disabled =
    status.disabledCommands ||
    [];

  const allowed =
    status.adminAllowedCommands ||
    [];

  const normalCommands =
    Object.keys(
      COMMAND_DEFINITIONS
    );

  const commandStatus =
    normalCommands
      .map(command => {
        const enabled =
          !disabled.includes(
            command
          );

        return `${
          enabled
            ? "🟢"
            : "🔴"
        } /${command}`;
      })
      .join("\n");

  const allowedText =
    allowed.length
      ? allowed
          .map(
            command =>
              `🟢 /${command}`
          )
          .join("\n")
      : "❌ কোনো Command Allow করা নেই";

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
        👑 ADMIN PANEL
╰━━━━━━━━━━━━━━━━━━━━╯

🔐 শুধুমাত্র Admin / Owner

╭─❖ 🤖 BOT STATUS
│
│ ${
  status.enabled
    ? "🟢 Bot ON"
    : "🔴 Bot OFF"
}
│ ${
  status.fullBotOff
    ? "🔴 Full Bot OFF"
    : "🟢 Full Bot ON"
}
│ ${
  status.welcomeEnabled
    ? "🟢 Welcome ON"
    : "🔴 Welcome OFF"
}
╰────────────────────

╭─❖ ⚙️ COMMAND STATUS
│
${commandStatus}
╰────────────────────

╭─❖ 🔴 FULL BOT CONTROL
│
│ /offbot
│ /onbot
│ /fullbotstatus
╰────────────────────

╭─❖ 🔐 ADMIN CONTROL
│
│ /on <command>
│ /off <command>
│ /boton
│ /botoff
│ /cmdlist
╰────────────────────

╭─❖ 🟢 ADMIN ALLOWED
│
${allowedText}
╰────────────────────`;

  const controls = [
    "/adminpanel",
    "/cmdlist",
    "/offbot",
    "/onbot",
    "/fullbotstatus",
    "/boton",
    "/botoff",
    "/on welcome",
    "/off welcome"
  ];

  try {
    const buttons =
      controls.map(
        command =>
          makeCopyButton(
            command
          )
      );

    const msg =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },

              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create({
                    body:
                      proto.Message
                        .InteractiveMessage
                        .Body
                        .create({
                          text
                        }),

                    nativeFlowMessage:
                      proto.Message
                        .InteractiveMessage
                        .NativeFlowMessage
                        .create({
                          buttons
                        })
                  })
            }
          }
        },
        {
          userJid:
            sock.user?.id
        }
      );

    await sock.relayMessage(
      jid,
      msg.message,
      {
        messageId:
          msg.key.id
      }
    );

  } catch (error) {
    console.error(
      "Admin Panel Error:",
      error
    );

    await sock.sendMessage(
      jid,
      {
        text
      }
    );
  }
}

/* =========================================================
   COMMAND LIST
   ========================================================= */

async function sendCommandList(
  jid,
  groupId
) {
  const status =
    getStatus(groupId);

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
        📋 COMMAND LIST
╰━━━━━━━━━━━━━━━━━━━━╯

🟢 = Enabled
🔴 = Disabled

${Object.keys(
  COMMAND_DEFINITIONS
)
  .map(command => {
    const enabled =
      !status.disabledCommands.includes(
        command
      );

    return `${
      enabled
        ? "🟢"
        : "🔴"
    } /${command}`;
  })
  .join("\n")}

━━━━━━━━━━━━━━━━━━━━

👑 ADMIN COMMANDS

🔐 /adminpanel
🔐 /cmdlist
🔐 /on <command>
🔐 /off <command>
🔐 /boton
🔐 /botoff
🔐 /offbot
🔐 /onbot
🔐 /fullbotstatus`;

  const commands = [
    ...Object.keys(
      COMMAND_DEFINITIONS
    ).map(
      command =>
        `/${command}`
    ),

    "/adminpanel",
    "/cmdlist",
    "/on <command>",
    "/off <command>",
    "/boton",
    "/botoff",
    "/offbot",
    "/onbot",
    "/fullbotstatus"
  ];

  try {
    const buttons =
      commands.map(
        command =>
          makeCopyButton(
            command
          )
      );

    const msg =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },

              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create({
                    body:
                      proto.Message
                        .InteractiveMessage
                        .Body
                        .create({
                          text
                        }),

                    nativeFlowMessage:
                      proto.Message
                        .InteractiveMessage
                        .NativeFlowMessage
                        .create({
                          buttons
                        })
                  })
            }
          }
        },
        {
          userJid:
            sock.user?.id
        }
      );

    await sock.relayMessage(
      jid,
      msg.message,
      {
        messageId:
          msg.key.id
      }
    );

  } catch (error) {
    console.error(
      "Command List Error:",
      error
    );

    await sock.sendMessage(
      jid,
      {
        text
      }
    );
  }
}

/* =========================================================
   FULL BOT STATUS
   ========================================================= */

async function sendFullBotStatus(
  jid,
  groupId
) {
  const status =
    getStatus(groupId);

  const allowed =
    status.adminAllowedCommands ||
    [];

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 FULL BOT STATUS
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${
  status.enabled
    ? "🟢 ON"
    : "🔴 OFF"
}

🔴 Full Bot:
${
  status.fullBotOff
    ? "🔴 OFF"
    : "🟢 ON"
}

👋 Welcome:
${
  status.welcomeEnabled
    ? "🟢 ON"
    : "🔴 OFF"
}

🔐 Admin Allowed Commands:

${
  allowed.length
    ? allowed
        .map(
          command =>
            `🟢 /${command}`
        )
        .join("\n")
    : "❌ None"
}`;

  try {
    const msg =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },

              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create({
                    body:
                      proto.Message
                        .InteractiveMessage
                        .Body
                        .create({
                          text
                        }),

                    nativeFlowMessage:
                      proto.Message
                        .InteractiveMessage
                        .NativeFlowMessage
                        .create({
                          buttons: [
                            makeCopyButton(
                              "/fullbotstatus"
                            )
                          ]
                        })
                  })
            }
          }
        },
        {
          userJid:
            sock.user?.id
        }
      );

    await sock.relayMessage(
      jid,
      msg.message,
      {
        messageId:
          msg.key.id
      }
    );

  } catch (error) {
    console.error(
      "Full Status Error:",
      error
    );

    await sock.sendMessage(
      jid,
      {
        text
      }
    );
  }
}

/* =========================================================
   FULL BOT OFF
   ========================================================= */

async function handleFullBotOff(
  jid,
  groupId
) {
  updateStatus(
    groupId,
    {
      fullBotOff:
        true,

      adminAllowedCommands:
        []
    }
  );

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
        🔴 FULL BOT OFF
╰━━━━━━━━━━━━━━━━━━━━╯

✅ Full Bot এখন OFF করা হয়েছে।

👥 Normal Member:
❌ কোনো Bot Command কাজ করবে না।

👑 Admin / Owner:
✅ Control Command ব্যবহার করতে পারবেন।

📌 নির্দিষ্ট Command Admin-এর
জন্য Allow করতে:

/on welcome
/on menu
/on admin
/on deal

🟢 সবকিছু আবার চালু করতে:

/onbot`;

  await sock.sendMessage(
    jid,
    {
      text
    }
  );
}

/* =========================================================
   FULL BOT ON
   ========================================================= */

async function handleFullBotOn(
  jid,
  groupId
) {
  updateStatus(
    groupId,
    {
      fullBotOff:
        false,

      adminAllowedCommands:
        []
    }
  );

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
        🟢 FULL BOT ON
╰━━━━━━━━━━━━━━━━━━━━╯

✅ Full Bot আবার ON হয়েছে।

👥 Normal Member:
🟢 Bot Command ব্যবহার করতে পারবে।

👑 Admin / Owner:
🟢 সব Admin Control ব্যবহার করতে পারবে।`;

  await sock.sendMessage(
    jid,
    {
      text
    }
  );
}

/* =========================================================
   BOT OFF
   ========================================================= */

async function handleBotOff(
  jid,
  groupId
) {
  setBotEnabled(
    groupId,
    false
  );

  await sock.sendMessage(
    jid,
    {
      text:
`🔴 BOT OFF

সাধারণ Bot Command বন্ধ করা হয়েছে।

🟢 /boton
দিয়ে আবার চালু করা যাবে।`
    }
  );
}

/* =========================================================
   BOT ON
   ========================================================= */

async function handleBotOn(
  jid,
  groupId
) {
  setBotEnabled(
    groupId,
    true
  );

  await sock.sendMessage(
    jid,
    {
      text:
`🟢 BOT ON

সব সাধারণ Bot Command চালু হয়েছে।`
    }
  );
}

/* =========================================================
   /ON COMMAND
   ========================================================= */

async function handleOnCommand(
  jid,
  groupId,
  args
) {
  if (!args) {
    await sock.sendMessage(
      jid,
      {
        text:
`❌ Command দিন।

উদাহরণ:

/on welcome
/on menu
/on admin
/on deal`
      }
    );

    return;
  }

  const command =
    normalizeCommandName(
      args
    );

  /* WELCOME */

  if (
    command ===
    "welcome"
  ) {
    setWelcomeEnabled(
      groupId,
      true
    );

    if (
      isFullBotOff(
        groupId
      )
    ) {
      const allowed =
        getAdminAllowedCommands(
          groupId
        );

      if (
        !allowed.includes(
          "welcome"
        )
      ) {
        allowed.push(
          "welcome"
        );
      }

      setAdminAllowedCommands(
        groupId,
        allowed
      );
    }

    await sock.sendMessage(
      jid,
      {
        text:
`🟢 Welcome ON

${
  isFullBotOff(groupId)
    ? "Full Bot OFF থাকলেও Welcome চালু থাকবে।"
    : "Welcome Message চালু করা হয়েছে।"
}`
      }
    );

    return;
  }

  const resolved =
    resolveCommand(
      command
    );

  if (!resolved) {
    await sock.sendMessage(
      jid,
      {
        text:
`❌ Unknown Command

উদাহরণ:

/on menu
/on admin
/on deal
/on members`
      }
    );

    return;
  }

  enableCommand(
    groupId,
    resolved
  );

  if (
    isFullBotOff(
      groupId
    )
  ) {
    const allowed =
      getAdminAllowedCommands(
        groupId
      );

    if (
      !allowed.includes(
        resolved
      )
    ) {
      allowed.push(
        resolved
      );
    }

    setAdminAllowedCommands(
      groupId,
      allowed
    );
  }

  await sock.sendMessage(
    jid,
    {
      text:
`🟢 /${resolved} ON

${
  isFullBotOff(groupId)
    ? "Full Bot OFF থাকা অবস্থায় এই Command শুধু Admin / Owner ব্যবহার করতে পারবে।"
    : "Command চালু করা হয়েছে।"
}`
    }
  );
}

/* =========================================================
   /OFF COMMAND
   ========================================================= */

async function handleOffCommand(
  jid,
  groupId,
  args
) {
  if (!args) {
    await sock.sendMessage(
      jid,
      {
        text:
`❌ Command দিন।

উদাহরণ:

/off welcome
/off menu
/off admin
/off deal`
      }
    );

    return;
  }

  const command =
    normalizeCommandName(
      args
    );

  /* WELCOME */

  if (
    command ===
    "welcome"
  ) {
    setWelcomeEnabled(
      groupId,
      false
    );

    const allowed =
      getAdminAllowedCommands(
        groupId
      ).filter(
        value =>
          value !==
          "welcome"
      );

    setAdminAllowedCommands(
      groupId,
      allowed
    );

    await sock.sendMessage(
      jid,
      {
        text:
          "🔴 Welcome OFF করা হয়েছে।"
      }
    );

    return;
  }

  const resolved =
    resolveCommand(
      command
    );

  if (!resolved) {
    await sock.sendMessage(
      jid,
      {
        text:
          "❌ এই Command পাওয়া যায়নি।"
      }
    );

    return;
  }

  if (
    PROTECTED_COMMANDS.includes(
      resolved
    )
  ) {
    await sock.sendMessage(
      jid,
      {
        text:
`❌ এই Command OFF করা যাবে না।

🔐 এটি Admin Control Command।`
      }
    );

    return;
  }

  disableCommand(
    groupId,
    resolved
  );

  const allowed =
    getAdminAllowedCommands(
      groupId
    ).filter(
      value =>
        value !==
        resolved
    );

  setAdminAllowedCommands(
    groupId,
    allowed
  );

  await sock.sendMessage(
    jid,
    {
      text:
        `🔴 /${resolved} OFF করা হয়েছে।`
    }
  );
}

/* =========================================================
   NORMAL COMMANDS
   ========================================================= */

async function handleNormalCommand(
  jid,
  groupId,
  command
) {
  switch (command) {

    /* MENU */

    case "menu": {
      await sendPublicMenu(
        jid
      );

      break;
    }

    /* BOT */

    case "bot": {
      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 PIYAS BOT
╰━━━━━━━━━━━━━━━━━━━━╯

⚡ Fast WhatsApp Group Bot

🟢 Status:
${
  isBotEnabled(groupId)
    ? "ON"
    : "OFF"
}

👋 Welcome:
${
  isWelcomeEnabled(groupId)
    ? "ON"
    : "OFF"
}

🔐 Admin Control:
Active

📋 /menu
দিয়ে সব Command দেখতে পারবেন।`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/bot"
      );

      break;
    }

    /* RULES */

    case "rules": {
      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
          📜 RULES
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করুন।
2️⃣ Spam করা যাবে না।
3️⃣ অপ্রয়োজনীয় Link দেওয়া যাবে না।
4️⃣ প্রতারণামূলক কাজ করা যাবে না।
5️⃣ Admin-এর নির্দেশ মেনে চলুন।
6️⃣ Group পরিবেশ সুন্দর রাখুন।

❤️ ধন্যবাদ।`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/rules"
      );

      break;
    }

    /* ADMIN */

    case "admin": {
      const metadata =
        await getGroupMetadata(
          groupId
        );

      if (!metadata) {
        await sock.sendMessage(
          jid,
          {
            text:
              "❌ Group information পাওয়া যায়নি।"
          }
        );

        break;
      }

      const admins =
        (
          metadata.participants ||
          []
        ).filter(
          isAdminParticipant
        );

      const mentions =
        admins.map(
          participant =>
            participant.id
        );

      const adminText =
        admins
          .map(
            (
              participant,
              index
            ) => {
              const number =
                participant.id
                  ?.split("@")[0] ||
                "Unknown";

              return (
                `${index + 1}. @${number}`
              );
            }
          )
          .join("\n");

      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
        👑 GROUP ADMINS
╰━━━━━━━━━━━━━━━━━━━━╯

${
  adminText ||
  "কোনো Admin পাওয়া যায়নি।"
}`,

          mentions
        }
      );

      await sendCommandWithCopy(
        jid,
        "/admin"
      );

      break;
    }

    /* MEMBERS */

    case "members": {
      const metadata =
        await getGroupMetadata(
          groupId
        );

      if (!metadata) {
        await sock.sendMessage(
          jid,
          {
            text:
              "❌ Group information পাওয়া যায়নি।"
          }
        );

        break;
      }

      const count =
        metadata
          .participants
          ?.length || 0;

      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
        👥 GROUP MEMBERS
╰━━━━━━━━━━━━━━━━━━━━╯

👥 Total Members:
${count}`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/members"
      );

      break;
    }

    /* GROUP INFO */

    case "groupinfo": {
      const metadata =
        await getGroupMetadata(
          groupId
        );

      if (!metadata) {
        await sock.sendMessage(
          jid,
          {
            text:
              "❌ Group information পাওয়া যায়নি।"
          }
        );

        break;
      }

      const admins =
        (
          metadata.participants ||
          []
        ).filter(
          isAdminParticipant
        ).length;

      const members =
        metadata
          .participants
          ?.length || 0;

      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
        ℹ️ GROUP INFO
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Name:
${metadata.subject || "Unknown"}

👥 Members:
${members}

👑 Admins:
${admins}

🆔 Group ID:
${groupId}`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/groupinfo"
      );

      break;
    }

    /* ID */

    case "id": {
      await sock.sendMessage(
        jid,
        {
          text:
`🆔 GROUP ID

${groupId}`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/id"
      );

      break;
    }

    /* PING */

    case "ping": {
      const start =
        Date.now();

      await sock.sendMessage(
        jid,
        {
          text:
            "🏓 Pinging..."
        }
      );

      const ping =
        Date.now() -
        start;

      await sock.sendMessage(
        jid,
        {
          text:
`🏓 PONG!

⚡ Response:
${ping} ms`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/ping"
      );

      break;
    }

    /* DEAL */

    case "deal": {
      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
          🔥 DEAL
╰━━━━━━━━━━━━━━━━━━━━╯

📢 PIYAS SERVICES

💎 Google Play Points
📱 Gmail Service
⭐ Telegram Star
🎵 TikTok Coin
▶️ YouTube Premium
🌐 VPN
🎁 Digital Services

📩 যোগাযোগ করতে Admin-এর
সাথে Contact করুন।`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/deal"
      );

      break;
    }

    /* PIYAS */

    case "piyas": {
      await sock.sendMessage(
        jid,
        {
          text:
`╭━━━━━━━━━━━━━━━━━━━━╮
          👑 PIYAS
╰━━━━━━━━━━━━━━━━━━━━╯

🔥 PIYAS SERVICES

📱 Digital Service
🎮 Gaming Service
⭐ Google Play
🌐 VPN
📩 Online Service

❤️ Trusted Service`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/piyas"
      );

      break;
    }

    /* WEBSITE */

    case "website": {
      await sock.sendMessage(
        jid,
        {
          text:
`🌐 PIYAS WEBSITE

https://x-cyber-2025.github.io/X-cyber.web/`
        }
      );

      await sendCommandWithCopy(
        jid,
        "/website"
      );

      break;
    }

    default:
      break;
  }
}

/* =========================================================
   SINGLE COMMAND COPY
   ========================================================= */

async function sendCommandWithCopy(
  jid,
  command
) {
  try {
    const msg =
      generateWAMessageFromContent(
        jid,
        {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },

              interactiveMessage:
                proto.Message
                  .InteractiveMessage
                  .create({
                    body:
                      proto.Message
                        .InteractiveMessage
                        .Body
                        .create({
                          text:
                            command
                        }),

                    nativeFlowMessage:
                      proto.Message
                        .InteractiveMessage
                        .NativeFlowMessage
                        .create({
                          buttons: [
                            makeCopyButton(
                              command
                            )
                          ]
                        })
                  })
            }
          }
        },
        {
          userJid:
            sock.user?.id
        }
      );

    await sock.relayMessage(
      jid,
      msg.message,
      {
        messageId:
          msg.key.id
      }
    );

  } catch (error) {
    console.error(
      "Copy Error:",
      error
    );
  }
}

/* =========================================================
   ADMIN CHECK
   ========================================================= */

function normalizeJid(
  jid
) {
  return String(
    jid || ""
  ).replace(
    /:\d+(?=@)/,
    ""
  );
}

function sameJid(
  a,
  b
) {
  if (!a || !b) {
    return false;
  }

  return (
    normalizeJid(a) ===
    normalizeJid(b)
  );
}

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
      "superadmin" ||

    participant.admin ===
      true ||

    participant.isAdmin ===
      true ||

    participant.isSuperAdmin ===
      true
  );
}

async function isSenderAdmin(
  groupId,
  senderJid
) {
  if (
    !sock ||
    !groupId ||
    !senderJid
  ) {
    return false;
  }

  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const participants =
      metadata?.participants ||
      [];

    let participant =
      participants.find(
        participant =>
          sameJid(
            participant.id,
            senderJid
          )
      );

    if (
      !participant &&
      senderJid.endsWith(
        "@lid"
      )
    ) {
      participant =
        participants.find(
          p =>
            sameJid(
              p.lid,
              senderJid
            )
        );
    }

    if (!participant) {
      const phone =
        senderJid.split(
          "@"
        )[0];

      participant =
        participants.find(
          p => {
            const pPhone =
              String(
                p.phoneNumber ||
                  ""
              ).replace(
                /\D/g,
                ""
              );

            return (
              pPhone &&
              pPhone === phone
            );
          }
        );
    }

    return isAdminParticipant(
      participant
    );

  } catch (error) {
    console.error(
      "Admin Check Error:",
      error
    );

    return false;
  }
}

/* =========================================================
   BOT ADMIN CHECK
   ========================================================= */

function getBotJids() {
  const jids = [];

  if (
    sock?.user?.id
  ) {
    jids.push(
      sock.user.id
    );
  }

  if (
    sock?.user?.lid
  ) {
    jids.push(
      sock.user.lid
    );
  }

  if (PHONE_NUMBER) {
    jids.push(
      `${PHONE_NUMBER}@s.whatsapp.net`
    );
  }

  return [
    ...new Set(
      jids.filter(Boolean)
    )
  ];
}

async function isBotAdminInGroup(
  groupId
) {
  if (
    !sock ||
    !groupId
  ) {
    return false;
  }

  try {
    const metadata =
      await sock.groupMetadata(
        groupId
      );

    const participants =
      metadata?.participants ||
      [];

    const botJids =
      getBotJids();

    const botParticipant =
      participants.find(
        participant =>
          botJids.some(
            botJid =>
              sameJid(
                participant.id,
                botJid
              ) ||
              sameJid(
                participant.lid,
                botJid
              )
          )
      );

    return isAdminParticipant(
      botParticipant
    );

  } catch (error) {
    console.error(
      "Bot Admin Check Error:",
      error
    );

    return false;
  }
}

async function isGroupAllowed(
  groupId
) {
  if (!groupId) {
    return false;
  }

  /*
     GROUP_ID না দিলে:
     Bot যেসব Group-এ Admin,
     সেসব Group-এ কাজ করবে।
  */

  if (
    GROUP_IDS.length === 0
  ) {
    return await isBotAdminInGroup(
      groupId
    );
  }

  /*
     GROUP_ID দেওয়া থাকলে:
     নির্দিষ্ট Group + Bot Admin
     দুটোই লাগবে।
  */

  if (
    !GROUP_IDS.includes(
      groupId
    )
  ) {
    return false;
  }

  return await isBotAdminInGroup(
    groupId
  );
}

/* =========================================================
   GROUP METADATA
   ========================================================= */

async function getGroupMetadata(
  groupId
) {
  try {
    return await sock.groupMetadata(
      groupId
    );
  } catch (error) {
    console.error(
      "Group Metadata Error:",
      error
    );

    return null;
  }
}

/* =========================================================
   WELCOME
   ========================================================= */

async function sendWelcome(
  groupId,
  participantJids
) {
  if (
    !isWelcomeEnabled(
      groupId
    )
  ) {
    return;
  }

  if (
    !Array.isArray(
      participantJids
    )
  ) {
    return;
  }

  const mentions =
    participantJids;

  const mentionText =
    mentions
      .map(
        jid =>
          `@${jid.split("@")[0]}`
      )
      .join(" ");

  const text =
`╭━━━━━━━━━━━━━━━━━━━━╮
        👋 WELCOME
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 গ্রুপে নতুন সদস্য যোগ হয়েছে!

${mentionText}

🤖 PIYAS BOT-এর পক্ষ থেকে
স্বাগতম! ❤️

📌 গ্রুপের নিয়ম মেনে চলুন।
💬 প্রয়োজন হলে /menu লিখুন।`;

  try {
    await sock.sendMessage(
      groupId,
      {
        text,
        mentions
      }
    );
  } catch (error) {
    console.error(
      "Welcome Error:",
      error
    );
  }
}

/* =========================================================
   MESSAGE HANDLER
   ========================================================= */

async function handleMessage(
  message
) {
  try {
    const groupId =
      getGroupId(
        message
      );

    if (!groupId) {
      return;
    }

    const allowed =
      await isGroupAllowed(
        groupId
      );

    if (!allowed) {
      return;
    }

    const text =
      getMessageText(
        message
      ).trim();

    if (
      !text.startsWith("/")
    ) {
      return;
    }

    const parts =
      text.split(
        /\s+/
      );

    const rawCommand =
      normalizeCommandName(
        parts[0]
      );

    const args =
      parts
        .slice(1)
        .join(" ")
        .trim();

    const command =
      resolveCommand(
        rawCommand
      );

    if (!command) {
      return;
    }

    const senderJid =
      getSenderJid(
        message
      );

    const senderIsAdmin =
      await isSenderAdmin(
        groupId,
        senderJid
      );

    /* ADMIN ONLY */

    if (
      ADMIN_COMMANDS.includes(
        command
      )
    ) {
      if (
        !senderIsAdmin
      ) {
        return;
      }
    }

    /* FULL BOT OFF */

    if (
      command ===
      "offbot"
    ) {
      await handleFullBotOff(
        groupId,
        groupId
      );

      return;
    }

    if (
      command ===
      "onbot"
    ) {
      await handleFullBotOn(
        groupId,
        groupId
      );

      return;
    }

    if (
      command ===
      "fullbotstatus"
    ) {
      await sendFullBotStatus(
        groupId,
        groupId
      );

      return;
    }

    let fullBotAdminAccess =
      false;

    /*
       Full Bot OFF:
       Normal Member -> Silent
       Admin -> Protected/Allowed Command
    */

    if (
      isFullBotOff(
        groupId
      )
    ) {
      if (
        !senderIsAdmin
      ) {
        return;
      }

      if (
        !PROTECTED_COMMANDS.includes(
          command
        ) &&
        !isAdminAllowedCommand(
          groupId,
          command
        )
      ) {
        return;
      }

      fullBotAdminAccess =
        true;
    }

    /* BOT OFF */

    if (
      command ===
      "botoff"
    ) {
      await handleBotOff(
        groupId,
        groupId
      );

      return;
    }

    /* BOT ON */

    if (
      command ===
      "boton"
    ) {
      await handleBotOn(
        groupId,
        groupId
      );

      return;
    }

    /* ADMIN PANEL */

    if (
      command ===
      "adminpanel"
    ) {
      await sendAdminPanel(
        groupId,
        groupId
      );

      return;
    }

    /* COMMAND LIST */

    if (
      command ===
      "cmdlist"
    ) {
      await sendCommandList(
        groupId,
        groupId
      );

      return;
    }

    /* ON */

    if (
      command ===
      "on"
    ) {
      await handleOnCommand(
        groupId,
        groupId,
        args
      );

      return;
    }

    /* OFF */

    if (
      command ===
      "off"
    ) {
      await handleOffCommand(
        groupId,
        groupId,
        args
      );

      return;
    }

    /* BOT OFF */

    if (
      !fullBotAdminAccess &&
      !isBotEnabled(
        groupId
      )
    ) {
      return;
    }

    /* COMMAND DISABLED */

    if (
      !fullBotAdminAccess &&
      !isCommandEnabled(
        groupId,
        command
      )
    ) {
      return;
    }

    /* NORMAL COMMAND */

    await handleNormalCommand(
      groupId,
      groupId,
      command
    );

  } catch (error) {
    console.error(
      "Message Handler Error:",
      error
    );
  }
}

/* =========================================================
   START BOT
   ========================================================= */

async function startBot() {
  const {
    state,
    saveCreds
  } =
    await useMultiFileAuthState(
      AUTH_FOLDER
    );

  sock =
    makeWASocket({
      auth: state,

      browser:
        Browsers.ubuntu(
          "Chrome"
        ),

      printQRInTerminal:
        false,

      logger:
        P({
          level:
            "silent"
        }),

      generateHighQualityLinkPreview:
        true,

      markOnlineOnConnect:
        false,

      syncFullHistory:
        false
    });

  /* CREDENTIALS */

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  /* CONNECTION */

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
        console.log("");
        console.log(
          "================================="
        );
        console.log(
          "        PIYAS BOT CONNECTED"
        );
        console.log(
          "================================="
        );
        console.log("");

        try {
          const groups =
            await sock.groupFetchAllParticipating();

          const groupList =
            Object.values(
              groups || {}
            );

          console.log(
            `Groups Found: ${groupList.length}`
          );

          for (
            const group
            of groupList
          ) {
            try {
              const admin =
                await isBotAdminInGroup(
                  group.id
                );

              console.log(
                `${
                  group.subject ||
                  group.id
                }: ${
                  admin
                    ? "BOT ADMIN"
                    : "NOT ADMIN"
                }`
              );
            } catch {}
          }

        } catch (error) {
          console.error(
            "Group Fetch Error:",
            error
          );
        }
      }

      if (
        connection ===
        "close"
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
          "Connection Closed:",
          statusCode
        );

        if (
          shouldReconnect
        ) {
          console.log(
            "Reconnecting..."
          );

          setTimeout(
            () => {
              startBot().catch(
                console.error
              );
            },
            3000
          );

        } else {
          console.log(
            "Logged out."
          );

          console.log(
            "Delete auth folder and pair again."
          );
        }
      }
    }
  );

  /* PAIRING CODE */

  if (
    PHONE_NUMBER &&
    !sock.authState
      .creds.registered
  ) {
    try {
      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );

      const code =
        await sock.requestPairingCode(
          PHONE_NUMBER
        );

      console.log("");
      console.log(
        "================================="
      );
      console.log(
        "        WHATSAPP PAIRING CODE"
      );
      console.log(
        "================================="
      );
      console.log(
        code
      );
      console.log(
        "================================="
      );
      console.log("");

    } catch (error) {
      console.error(
        "Pairing Code Error:",
        error
      );
    }
  }

  /* MESSAGES */

  sock.ev.on(
    "messages.upsert",
    async ({
      messages
    }) => {

      for (
        const message
        of messages
      ) {
        if (
          !message?.message
        ) {
          continue;
        }

        if (
          message.key?.fromMe
        ) {
          continue;
        }

        await handleMessage(
          message
        );
      }
    }
  );

  /* GROUP PARTICIPANT */

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
          action !==
          "add"
        ) {
          return;
        }

        const allowed =
          await isGroupAllowed(
            id
          );

        if (!allowed) {
          return;
        }

        await sendWelcome(
          id,
          participants
        );

      } catch (error) {
        console.error(
          "Participant Update Error:",
          error
        );
      }
    }
  );
}

/* =========================================================
   HTTP SERVER
   ========================================================= */

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
`PIYAS BOT
Status: Online
`
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `HTTP server running on port ${PORT}`
    );
  }
);

/* =========================================================
   START
   ========================================================= */

startBot().catch(
  error => {
    console.error(
      "Bot Startup Error:",
      error
    );
  }
);