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

/* =========================================================
   GLOBAL DATA
========================================================= */

let sock = null;
let pairingRequested = false;

const contactNames = new Map();
const contactPhoneJids = new Map();
const lidToPhoneJid = new Map();

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
        groups: GROUP_IDS.length || "ALL",
        connected: !!sock
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
   LOGGER
========================================================= */

const logger = P({
  level: "silent"
});

/* =========================================================
   BASIC HELPERS
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

  const clean = String(phone)
    .replace(/[^0-9]/g, "");

  if (clean.length < 8) {
    return null;
  }

  return `${clean}@s.whatsapp.net`;
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
    }

    if (
      id &&
      isLidJid(id) &&
      phoneJid
    ) {
      lidToPhoneJid.set(
        id,
        phoneJid
      );
    }

    if (
      lid &&
      phoneJid
    ) {
      lidToPhoneJid.set(
        lid,
        phoneJid
      );
    }
  }
}

/* =========================================================
   GET DISPLAY NAME
========================================================= */

function getDisplayName(participant = {}) {
  const ids = [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ].filter(Boolean);

  for (const id of ids) {
    const cachedName =
      contactNames.get(id);

    if (cachedName) {
      return cachedName;
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

function getPhoneJid(participant = {}) {
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

    const directJid =
      phoneNumberToJid(
        participant.phoneNumber
      );

    if (directJid) {
      return directJid;
    }
  }

  if (
    isPhoneJid(participant.id)
  ) {
    return participant.id;
  }

  const ids = [
    participant.id,
    participant.lid
  ].filter(Boolean);

  for (const id of ids) {
    const cachedPhone =
      contactPhoneJids.get(id);

    if (
      cachedPhone &&
      isPhoneJid(cachedPhone)
    ) {
      return cachedPhone;
    }

    const mappedPhone =
      lidToPhoneJid.get(id);

    if (
      mappedPhone &&
      isPhoneJid(mappedPhone)
    ) {
      return mappedPhone;
    }
  }

  return null;
}

/* =========================================================
   ADMIN INFO
========================================================= */

function getAdminInfo(participant = {}) {
  const name =
    getDisplayName(participant);

  const phoneJid =
    getPhoneJid(participant);

  const isOwner =
    participant.admin === "superadmin" ||
    participant.isSuperAdmin === true;

  const isAdmin =
    participant.admin === "admin" ||
    participant.admin === "superadmin" ||
    participant.admin === true ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true;

  return {
    participant,
    name,
    phoneJid,
    isOwner,
    isAdmin
  };
}

/* =========================================================
   FIND PARTICIPANT
========================================================= */

function findParticipant(
  participants,
  participantId
) {
  if (!Array.isArray(participants)) {
    return null;
  }

  return (
    participants.find(
      participant =>
        participant?.id === participantId ||
        participant?.lid === participantId ||
        participant?.phoneNumber === participantId
    ) || null
  );
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(message) {
  const msg = message?.message;

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
   GROUP RULES
========================================================= */

const GROUP_RULES = `
📜 *GROUP RULES*

1️⃣ সবাইকে সম্মান করে কথা বলুন।
2️⃣ অশ্লীল/আপত্তিকর কনটেন্ট পাঠাবেন না।
3️⃣ Spam বা একই মেসেজ বারবার পাঠাবেন না।
4️⃣ প্রতারণামূলক লিংক বা সন্দেহজনক ফাইল শেয়ার করবেন না।
5️⃣ Admin-এর অনুমতি ছাড়া গ্রুপের নিয়ম পরিবর্তনের চেষ্টা করবেন না।
6️⃣ অন্য সদস্যকে হয়রানি বা বিরক্ত করবেন না।
7️⃣ গ্রুপের পরিবেশ সুন্দর রাখুন।

❤️ সবাই মিলে সুন্দর একটি কমিউনিটি তৈরি করি।
`;

/* =========================================================
   MENU
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

╭─❖ 🤍 *PIYAS*
│
│ 🔟 /piyas
│
╰────────────────────

━━━━━━━━━━━━━━━━━━━━
        🤖 *PIYAS BOT*
━━━━━━━━━━━━━━━━━━━━
`;

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
ডাকঘর: হেংগু বাজার - ২২৯০
নান্দাইল, ময়মনসিংহ

🪪 *NID:* 9172******24

🤍 *Thank You*
`;

/* =========================================================
   CACHE GROUP PARTICIPANTS
========================================================= */

function cacheParticipants(
  participants = []
) {
  for (const participant of participants) {
    if (!participant) continue;

    const phoneJid =
      getPhoneJid(participant);

    const name =
      getDisplayName(participant);

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
   START BOT
========================================================= */

async function startBot() {
  try {
    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      "./auth_info"
    );

    sock = makeWASocket({
      auth: state,

      logger,

      browser:
        Browsers.ubuntu(
          "Chrome"
        ),

      markOnlineOnConnect: false,

      syncFullHistory: false,

      generateHighQualityLinkPreview: false
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
       GROUP PARTICIPANT UPDATE
    ===================================================== */

    sock.ev.on(
      "group-participants.update",
      async event => {
        try {
          const participants =
            event?.participants || [];

          cacheParticipants(
            participants
          );

          if (event?.id) {
            try {
              const metadata =
                await sock.groupMetadata(
                  event.id
                );

              cacheParticipants(
                metadata?.participants || []
              );
            } catch {}
          }
        } catch (error) {
          console.log(
            "⚠️ Participant update error:",
            error?.message
          );
        }
      }
    );

    /* =====================================================
       CONNECTION UPDATE
    ===================================================== */

    sock.ev.on(
      "connection.update",
      async update => {
        const {
          connection,
          lastDisconnect
        } = update;

        if (
          connection === "connecting"
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

          pairingRequested = false;

          if (
            PHONE_NUMBER &&
            !state.creds.registered &&
            !pairingRequested
          ) {
            try {
              pairingRequested = true;

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

              pairingRequested = false;
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

          if (shouldReconnect) {
            console.log(
              "🔄 Reconnecting..."
            );

            sock = null;

            setTimeout(
              () => {
                startBot();
              },
              3000
            );
          } else {
            console.log(
              "🚪 Logged out. Please pair the bot again."
            );
          }
        }
      }
    );

    /* =====================================================
       INITIAL GROUP CACHE
    ===================================================== */

    try {
      const groups =
        await sock.groupFetchAllParticipating();

      for (
        const group of Object.values(
          groups || {}
        )
      ) {
        cacheParticipants(
          group?.participants || []
        );
      }

      console.log(
        "📦 Group participant cache loaded."
      );
    } catch (error) {
      console.log(
        "⚠️ Initial group cache error:",
        error?.message
      );
    }

    console.log(
      "🚀 WhatsApp Bot Starting..."
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
            !remoteJid.endsWith("@g.us")
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

          const sender =
            message.key?.participant ||
            message.key?.remoteJid;

          /* ===============================================
             /MENU + /BOT
          =============================================== */

          if (
            command === "/menu" ||
            command === "/bot"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: MENU_TEXT
              }
            );

            return;
          }

          /* ===============================================
             /RULES
          =============================================== */

          if (
            command === "/rules"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: GROUP_RULES
              }
            );

            return;
          }

          /* ===============================================
             /WEBSITE
          =============================================== */

          if (
            command === "/website"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: `
🌐 *OUR WEBSITE*

🔗 https://example.com

🤍 Visit our website for more information.
`
              }
            );

            return;
          }

          /* ===============================================
             /PING
          =============================================== */

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
              Date.now() - start;

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

          /* ===============================================
             /ID
          =============================================== */

          if (
            command === "/id"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🆔 *Group ID:*\n\n${remoteJid}`
              }
            );

            return;
          }

          /* ===============================================
             /GROUPINFO
          =============================================== */

          if (
            command === "/groupinfo"
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
                p =>
                  p?.admin === "admin" ||
                  p?.admin === "superadmin" ||
                  p?.admin === true ||
                  p?.isAdmin === true ||
                  p?.isSuperAdmin === true
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

          /* ===============================================
             /MEMBERS
          =============================================== */

          if (
            command === "/members"
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

            if (
              participants.length === 0
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "👥 কোনো member পাওয়া যায়নি।"
                }
              );

              return;
            }

            const lines = [];
            const mentions = [];

            for (
              let i = 0;
              i < participants.length;
              i++
            ) {
              const participant =
                participants[i];

              const info =
                getAdminInfo(
                  participant
                );

              const name =
                info.name;

              const jid =
                info.phoneJid;

              if (jid) {
                mentions.push(jid);

                lines.push(
                  `${i + 1}️⃣ @${name}`
                );
              } else {
                lines.push(
                  `${i + 1}️⃣ ${name}`
                );
              }
            }

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `👥 *GROUP MEMBERS*\n\n${lines.join(
                    "\n"
                  )}\n\n👥 মোট Member: ${participants.length} জন`,
                mentions: [
                  ...new Set(
                    mentions
                  )
                ]
              }
            );

            return;
          }

          /* ===============================================
             /ADMIN
          =============================================== */

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
                p =>
                  p?.admin === "admin" ||
                  p?.admin === "superadmin" ||
                  p?.admin === true ||
                  p?.isAdmin === true ||
                  p?.isSuperAdmin === true
              );

            if (
              adminParticipants.length === 0
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
                p =>
                  p?.admin === "superadmin" ||
                  p?.isSuperAdmin === true
              );

            const normalAdmins =
              adminParticipants.filter(
                p =>
                  !(
                    p?.admin === "superadmin" ||
                    p?.isSuperAdmin === true
                  )
              );

            const lines = [];
            const mentions = [];

            let number = 1;

            /* =============================================
               GROUP OWNER
            ============================================= */

            for (
              const participant of owners
            ) {
              const info =
                getAdminInfo(
                  participant
                );

              const name =
                info.name ||
                "Group Owner";

              const jid =
                info.phoneJid;

              if (jid) {
                mentions.push(jid);

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

            /* =============================================
               OTHER ADMINS
            ============================================= */

            for (
              const participant of normalAdmins
            ) {
              const info =
                getAdminInfo(
                  participant
                );

              const name =
                info.name ||
                "Admin";

              const jid =
                info.phoneJid;

              if (jid) {
                mentions.push(jid);

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

            const adminText = `
╭━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━╯

${lines.join("\n\n")}

👥 *মোট Admin:* ${
              adminParticipants.length
            } জন

🤍 *Piyas*
`;

            await sock.sendMessage(
              remoteJid,
              {
                text: adminText,
                mentions: [
                  ...new Set(
                    mentions
                  )
                ]
              }
            );

            return;
          }

          /* ===============================================
             /PIYAS
          =============================================== */

          if (
            command === "/piyas"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: PIYAS_INFO
              }
            );

            return;
          }

          /* ===============================================
             /WELCOME-TEST
          =============================================== */

          if (
            command === "/welcome-test"
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

            const participant =
              findParticipant(
                participants,
                sender
              );

            if (!participant) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "👋 Welcome!"
                }
              );

              return;
            }

            const info =
              getAdminInfo(
                participant
              );

            if (
              info.phoneJid
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `👋 Welcome @${info.name}! 🤍`,
                  mentions: [
                    info.phoneJid
                  ]
                }
              );
            } else {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `👋 Welcome ${info.name}! 🤍`
                }
              );
            }

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

  } catch (error) {
    console.log(
      "❌ Failed to start bot:",
      error
    );

    sock = null;

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