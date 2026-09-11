import "dotenv/config";
import http from "http";

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
  .map(id => id.trim())
  .filter(Boolean);

const PHONE_NUMBER = (process.env.PHONE_NUMBER || "")
  .replace(/[^0-9]/g, "");

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";

/* =========================================================
   GLOBAL
========================================================= */

let sock = null;
let reconnecting = false;
let pairingRequested = false;

const contactNames = new Map();
const contactPhoneJids = new Map();
const lidToPhoneJid = new Map();

/* =========================================================
   LOGGER
========================================================= */

const logger = P({
  level: "silent"
});

/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    res.end(
      JSON.stringify({
        status: "online",
        bot: "WhatsApp Group Bot",
        connected: !!sock,
        groups: GROUP_IDS.length || "ALL"
      })
    );

    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("WhatsApp Bot is running!");
});

server.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

/* =========================================================
   HELPERS
========================================================= */

function cleanName(name) {
  if (!name) return null;

  const value = String(name)
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return null;

  return value.slice(0, 80);
}

function normalizeJid(jid) {
  if (!jid || typeof jid !== "string") {
    return null;
  }

  return jid.trim();
}

function isPhoneJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith("@s.whatsapp.net")
  );
}

function isLidJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith("@lid")
  );
}

function phoneNumberToJid(phone) {
  if (!phone) return null;

  const number = String(phone)
    .replace(/[^0-9]/g, "");

  if (number.length < 8) {
    return null;
  }

  return `${number}@s.whatsapp.net`;
}

/* =========================================================
   SAVE CONTACTS
========================================================= */

function saveContacts(contacts = []) {
  for (const contact of contacts) {
    if (!contact) continue;

    const id = normalizeJid(contact.id);
    const lid = normalizeJid(contact.lid);

    let phoneJid = null;

    if (
      typeof contact.phoneNumber === "string" &&
      contact.phoneNumber
    ) {
      if (isPhoneJid(contact.phoneNumber)) {
        phoneJid = contact.phoneNumber;
      } else {
        phoneJid = phoneNumberToJid(
          contact.phoneNumber
        );
      }
    }

    if (!phoneJid && isPhoneJid(id)) {
      phoneJid = id;
    }

    const name = cleanName(
      contact.username ||
      contact.notify ||
      contact.name ||
      contact.verifiedName ||
      contact.pushName ||
      null
    );

    if (name) {
      if (id) {
        contactNames.set(id, name);
      }

      if (lid) {
        contactNames.set(lid, name);
      }

      if (phoneJid) {
        contactNames.set(phoneJid, name);
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

      if (id && isLidJid(id)) {
        lidToPhoneJid.set(
          id,
          phoneJid
        );
      }

      if (lid) {
        lidToPhoneJid.set(
          lid,
          phoneJid
        );
      }
    }
  }
}

/* =========================================================
   DISPLAY NAME
========================================================= */

function getDisplayName(participant = {}) {
  const ids = [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ].filter(Boolean);

  for (const id of ids) {
    const cached =
      contactNames.get(id);

    if (cached) {
      return cached;
    }
  }

  const directName = cleanName(
    participant.username ||
    participant.notify ||
    participant.name ||
    participant.verifiedName ||
    participant.pushName ||
    null
  );

  if (directName) {
    return directName;
  }

  if (
    typeof participant.phoneNumber === "string" &&
    participant.phoneNumber
  ) {
    const phone =
      participant.phoneNumber
        .replace(/@s.whatsapp.net/g, "")
        .replace(/[^0-9]/g, "");

    if (phone) {
      return phone;
    }
  }

  if (
    typeof participant.id === "string"
  ) {
    const idPart =
      participant.id.split("@")[0];

    if (idPart) {
      return idPart;
    }
  }

  return "Member";
}

/* =========================================================
   GET PHONE JID
========================================================= */

function getDirectPhoneJid(participant = {}) {
  if (
    typeof participant.phoneNumber === "string" &&
    participant.phoneNumber
  ) {
    if (
      isPhoneJid(
        participant.phoneNumber
      )
    ) {
      return participant.phoneNumber;
    }

    const jid =
      phoneNumberToJid(
        participant.phoneNumber
      );

    if (jid) {
      return jid;
    }
  }

  if (
    isPhoneJid(participant.id)
  ) {
    return participant.id;
  }

  return null;
}

function getPhoneJid(participant = {}) {
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

  for (const id of ids) {
    const cached =
      contactPhoneJids.get(id);

    if (
      cached &&
      isPhoneJid(cached)
    ) {
      return cached;
    }

    const mapped =
      lidToPhoneJid.get(id);

    if (
      mapped &&
      isPhoneJid(mapped)
    ) {
      return mapped;
    }
  }

  return null;
}

/* =========================================================
   CACHE PARTICIPANTS
========================================================= */

function cacheParticipants(
  participants = []
) {
  for (const participant of participants) {
    if (!participant) continue;

    const phoneJid =
      getDirectPhoneJid(
        participant
      );

    const name =
      getDisplayName(
        participant
      );

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
      isLidJid(participant.id)
    ) {
      lidToPhoneJid.set(
        participant.id,
        phoneJid
      );
    }

    if (
      phoneJid &&
      participant.lid
    ) {
      lidToPhoneJid.set(
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
   ADMIN HELPERS
========================================================= */

function isAdminParticipant(participant = {}) {
  return (
    participant?.admin === "admin" ||
    participant?.admin === "superadmin" ||
    participant?.admin === true ||
    participant?.isAdmin === true ||
    participant?.isSuperAdmin === true
  );
}

function isOwnerParticipant(participant = {}) {
  return (
    participant?.admin === "superadmin" ||
    participant?.isSuperAdmin === true
  );
}

/* =========================================================
   GROUP CHECK
========================================================= */

function isGroupAllowed(jid) {
  if (
    !jid ||
    !jid.endsWith("@g.us")
  ) {
    return false;
  }

  if (GROUP_IDS.length === 0) {
    return true;
  }

  return GROUP_IDS.includes(jid);
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(message) {
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
   FIND PARTICIPANT
========================================================= */

function findParticipant(
  participants = [],
  jid
) {
  if (!jid) {
    return null;
  }

  return (
    participants.find(
      p =>
        p?.id === jid ||
        p?.lid === jid ||
        p?.phoneNumber === jid
    ) || null
  );
}

/* =========================================================
   MAIN MENU
========================================================= */

const MENU_TEXT = `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 *BOT MENU*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 👑 *GROUP COMMANDS*
│
│ 1️⃣ /menu
│ 2️⃣ /bot
│ 3️⃣ /rules
│ 4️⃣ /admin
│ 5️⃣ /members
│ 6️⃣ /groupinfo
│ 7️⃣ /id
│
╰────────────────────

╭─❖ ⚙️ *UTILITY*
│
│ 8️⃣ /ping
│ 9️⃣ /website
│
╰────────────────────

╭─❖ 💰 *BUY / SELL*
│
│ 🔟 /deal /ডিল
│
╰────────────────────

╭─❖ 🤍 *PIYAS*
│
│ 1️⃣1️⃣ /piyas
│
╰────────────────────

━━━━━━━━━━━━━━━━━━━━
        🤖 *PIYAS BOT*
━━━━━━━━━━━━━━━━━━━━
`;

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
       🌐 *OFFICIAL WEBSITE*
╰━━━━━━━━━━━━━━━━━━━━╯

🌐 *আমাদের Official Website:*

${WEBSITE_URL}

🎁 এখানে Account Buy/Sell,
Google Play Points এবং
অন্যান্য earning সম্পর্কিত
তথ্য পাওয়া যাবে।

🤍 *Piyas*
`;

/* =========================================================
   WELCOME
========================================================= */

function getWelcomeText(name) {
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

🌐 *আমাদের Official Website:*
${WEBSITE_URL}

🤍 *Piyas*
`;
}

/* =========================================================
   PIYAS INFO
========================================================= */

const PIYAS_INFO = `
╭━━━━━━━━━━━━━━━━━━╮
       🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━╯

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

🪪 *NID:* 9172******24

🤍 *Thank You*
`;

/* =========================================================
   DEAL NOTICE
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
   SEND DEAL NOTICE
========================================================= */

async function sendDealNotice(remoteJid) {
  try {
    if (!sock) {
      return;
    }

    const metadata =
      await sock.groupMetadata(
        remoteJid
      );

    const participants =
      metadata?.participants || [];

    cacheParticipants(
      participants
    );

    const adminParticipants =
      participants.filter(
        isAdminParticipant
      );

    if (
      adminParticipants.length === 0
    ) {
      await sock.sendMessage(
        remoteJid,
        {
          text:
            DEAL_NOTICE_TOP +
            "⚠️ বর্তমানে কোনো Admin পাওয়া যায়নি।\n\n" +
            DEAL_NOTICE_BOTTOM
        }
      );

      return;
    }

    const owners =
      adminParticipants.filter(
        isOwnerParticipant
      );

    const normalAdmins =
      adminParticipants.filter(
        p => !isOwnerParticipant(p)
      );

    const lines = [];
    const mentions = [];
    const usedJids = new Set();

    let number = 1;

    /* =====================================================
       GROUP OWNER
    ===================================================== */

    for (
      const participant of owners
    ) {
      const name =
        getDisplayName(
          participant
        );

      let jid =
        getDirectPhoneJid(
          participant
        );

      if (
        !jid &&
        isPhoneJid(
          metadata?.ownerPn
        )
      ) {
        jid =
          metadata.ownerPn;
      }

      if (
        !jid &&
        isPhoneJid(
          metadata?.subjectOwnerPn
        )
      ) {
        jid =
          metadata.subjectOwnerPn;
      }

      if (
        jid &&
        !usedJids.has(jid)
      ) {
        usedJids.add(jid);

        mentions.push(
          jid
        );

        lines.push(
          `${number}️⃣ @${name} ⭐ *Group Owner*`
        );
      } else {
        lines.push(
          `${number}️⃣ ${name} ⭐ *Group Owner*`
        );
      }

      number++;
    }

    /* =====================================================
       OTHER ADMINS
    ===================================================== */

    for (
      const participant of normalAdmins
    ) {
      const name =
        getDisplayName(
          participant
        );

      const jid =
        getPhoneJid(
          participant
        );

      if (
        jid &&
        !usedJids.has(jid)
      ) {
        usedJids.add(jid);

        mentions.push(
          jid
        );

        lines.push(
          `${number}️⃣ @${name} 👑 *Admin*`
        );
      } else {
        lines.push(
          `${number}️⃣ ${name} 👑 *Admin*`
        );
      }

      number++;
    }

    const dealText =
      DEAL_NOTICE_TOP +
      lines.join("\n") +
      "\n\n" +
      `👥 *মোট Admin:* ${adminParticipants.length} জন\n\n` +
      DEAL_NOTICE_BOTTOM;

    await sock.sendMessage(
      remoteJid,
      {
        text: dealText,
        mentions: [
          ...new Set(
            mentions
          )
        ]
      }
    );

  } catch (error) {
    console.log(
      "❌ Deal notice error:",
      error?.message
    );

    try {
      await sock.sendMessage(
        remoteJid,
        {
          text: `
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

❌ Admin ছাড়া করা কোনো Deal-এর
জন্য Group Admin কোনোভাবেই
দায়ী থাকবে না।

📌 নিরাপদ থাকতে সবসময়
Admin-এর মাধ্যমে Deal করুন।

🤍 *PIYAS*
`
        }
      );
    } catch {}
  }
}

/* =========================================================
   SEND WELCOME
========================================================= */

async function sendWelcome(
  groupId,
  participant
) {
  try {
    if (!sock) {
      return;
    }

    let metadata = null;

    try {
      metadata =
        await sock.groupMetadata(
          groupId
        );

      cacheParticipants(
        metadata?.participants || []
      );
    } catch {}

    let member =
      findParticipant(
        metadata?.participants || [],
        participant?.id
      );

    if (!member) {
      member =
        findParticipant(
          metadata?.participants || [],
          participant?.lid
        );
    }

    if (!member) {
      member = participant;
    }

    const name =
      getDisplayName(member);

    const phoneJid =
      getPhoneJid(member);

    if (
      phoneJid &&
      isPhoneJid(phoneJid)
    ) {
      await sock.sendMessage(
        groupId,
        {
          text:
            getWelcomeText(name),
          mentions: [
            phoneJid
          ]
        }
      );

      console.log(
        `👋 Welcome sent to ${name} in ${groupId}`
      );

      return;
    }

    const fallbackText =
      getWelcomeText(name)
        .replace(
          `@${name}`,
          name
        );

    await sock.sendMessage(
      groupId,
      {
        text: fallbackText
      }
    );

    console.log(
      `👋 Welcome sent without mention to ${name}`
    );

  } catch (error) {
    console.log(
      "❌ Welcome send error:",
      error?.message
    );
  }
}

/* =========================================================
   START BOT
========================================================= */

async function startBot() {
  try {
    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        "./auth_info"
      );

    sock = makeWASocket({
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
       CONTACTS
    ===================================================== */

    sock.ev.on(
      "contacts.upsert",
      contacts => {
        saveContacts(
          contacts
        );
      }
    );

    sock.ev.on(
      "contacts.update",
      contacts => {
        saveContacts(
          contacts
        );
      }
    );

    /* =====================================================
       NEW MEMBER
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
            event?.participants || [];

          console.log(
            `👥 Group update: ${action} | ${groupId} | ${participants.length} participant(s)`
          );

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
            cacheParticipants(
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
        }

        if (
          connection === "open"
        ) {
          console.log(
            "✅ WhatsApp Bot Connected Successfully!"
          );

          reconnecting =
            false;

          pairingRequested =
            false;

          try {
            const groups =
              await sock.groupFetchAllParticipating();

            for (
              const group of Object.values(
                groups || {}
              )
            ) {
              cacheParticipants(
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

          if (
            PHONE_NUMBER &&
            !state.creds.registered &&
            !pairingRequested
          ) {
            try {
              pairingRequested =
                true;

              const code =
                await sock.requestPairingCode(
                  PHONE_NUMBER
                );

              console.log(
                `🔐 Pairing Code: ${code}`
              );

            } catch (error) {
              console.log(
                "⚠️ Pairing code error:",
                error?.message
              );

              pairingRequested =
                false;
            }
          }
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

          if (
            shouldReconnect &&
            !reconnecting
          ) {
            reconnecting =
              true;

            console.log(
              "🔄 Reconnecting..."
            );

            setTimeout(
              () => {
                reconnecting =
                  false;

                startBot();
              },
              3000
            );

          } else if (
            !shouldReconnect
          ) {
            console.log(
              "🚪 Logged out. Please pair the bot again."
            );
          }
        }
      }
    );

    /* =====================================================
       MESSAGE HANDLER
    ===================================================== */

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        try {
          const message =
            messages?.[0];

          if (!message) {
            return;
          }

          if (
            message.key?.fromMe
          ) {
            return;
          }

          const remoteJid =
            message.key?.remoteJid;

          if (!remoteJid) {
            return;
          }

          if (
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

          const command =
            text
              .split(/\s+/)[0]
              .toLowerCase();

          /* =================================================
             /MENU এবং /BOT
          ================================================= */

          if (
            command === "/menu" ||
            command === "/bot"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  MENU_TEXT
              }
            );

            return;
          }

          /* =================================================
             /RULES
          ================================================= */

          if (
            command === "/rules"
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
             /WEBSITE
          ================================================= */

          if (
            command === "/website"
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
             /DEAL এবং /ডিল
             
             Admin ID mention সহ Deal Notice
          ================================================= */

          if (
            command === "/deal" ||
            command === "/ডিল"
          ) {
            await sendDealNotice(
              remoteJid
            );

            return;
          }

          /* =================================================
             /PING
          ================================================= */

          if (
            command === "/ping"
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
             /ID
          ================================================= */

          if (
            command === "/id"
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
             /GROUPINFO
          ================================================= */

          if (
            command ===
            "/groupinfo"
          ) {
            const metadata =
              await sock.groupMetadata(
                remoteJid
              );

            const participants =
              metadata?.participants ||
              [];

            cacheParticipants(
              participants
            );

            const admins =
              participants.filter(
                isAdminParticipant
              );

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
                  metadata?.creation
                    ? new Date(
                        Number(
                          metadata.creation
                        ) * 1000
                      ).toLocaleString(
                        "en-BD"
                      )
                    : "Unknown"
                }

🤍 *Powered by Piyas*
`
              }
            );

            return;
          }

          /* =================================================
             /MEMBERS
             
             শুধু মোট Member সংখ্যা দেখাবে।
             কোনো নাম/নাম্বার দেখাবে না।
          ================================================= */

          if (
            command ===
            "/members"
          ) {
            const metadata =
              await sock.groupMetadata(
                remoteJid
              );

            const participants =
              metadata?.participants ||
              [];

            const total =
              participants.length;

            await sock.sendMessage(
              remoteJid,
              {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
        👥 *GROUP MEMBERS*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 *মোট Member:* ${total} জন

🤍 *Piyas*
`
              }
            );

            return;
          }

          /* =================================================
             /ADMIN
             
             শুধু /admin কাজ করবে।
             /admins কাজ করবে না।
          ================================================= */

          if (
            command === "/admin"
          ) {
            const metadata =
              await sock.groupMetadata(
                remoteJid
              );

            const participants =
              metadata?.participants ||
              [];

            cacheParticipants(
              participants
            );

            const adminParticipants =
              participants.filter(
                isAdminParticipant
              );

            if (
              adminParticipants.length ===
              0
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "👑 এই গ্রুপে কোনো Admin পাওয়া যায়নি।"
                }
              );

              return;
            }

            const owners =
              adminParticipants.filter(
                isOwnerParticipant
              );

            const normalAdmins =
              adminParticipants.filter(
                p =>
                  !isOwnerParticipant(p)
              );

            const lines = [];
            const mentions = [];
            const usedJids =
              new Set();

            let number = 1;

            /* =================================================
               OWNER
            ================================================= */

            for (
              const participant of owners
            ) {
              const name =
                getDisplayName(
                  participant
                );

              let jid =
                getDirectPhoneJid(
                  participant
                );

              if (
                !jid &&
                isPhoneJid(
                  metadata?.ownerPn
                )
              ) {
                jid =
                  metadata.ownerPn;
              }

              if (
                !jid &&
                isPhoneJid(
                  metadata?.subjectOwnerPn
                )
              ) {
                jid =
                  metadata.subjectOwnerPn;
              }

              if (
                jid &&
                !usedJids.has(jid)
              ) {
                usedJids.add(jid);

                mentions.push(
                  jid
                );

                lines.push(
                  `${number}️⃣ @${name} ⭐ *Group Owner*`
                );
              } else {
                lines.push(
                  `${number}️⃣ ${name} ⭐ *Group Owner*`
                );
              }

              number++;
            }

            /* =================================================
               OTHER ADMINS
            ================================================= */

            for (
              const participant of normalAdmins
            ) {
              const name =
                getDisplayName(
                  participant
                );

              const jid =
                getPhoneJid(
                  participant
                );

              if (
                jid &&
                !usedJids.has(jid)
              ) {
                usedJids.add(jid);

                mentions.push(
                  jid
                );

                lines.push(
                  `${number}️⃣ @${name} 👑 *Admin*`
                );
              } else {
                lines.push(
                  `${number}️⃣ ${name} 👑 *Admin*`
                );
              }

              number++;
            }

            await sock.sendMessage(
              remoteJid,
              {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n\n")}

👥 *মোট Admin:* ${adminParticipants.length} জন

🤍 *Piyas*
`,
                mentions: [
                  ...new Set(
                    mentions
                  )
                ]
              }
            );

            return;
          }

          /* =================================================
             /PIYAS
          ================================================= */

          if (
            command === "/piyas"
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
      error
    );

    sock = null;

    if (!reconnecting) {
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
   GLOBAL ERROR HANDLERS
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
   GRACEFUL SHUTDOWN
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