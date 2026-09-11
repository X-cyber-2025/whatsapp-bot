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
  "https://x-cyber-2025.github.io/X-cyber.web/#earning";

const WEBSITE_HOME =
  "https://x-cyber-2025.github.io/X-cyber.web/";

/* =========================================================
   GLOBAL
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

  const clean = String(phone)
    .replace(/[^0-9]/g, "");

  if (clean.length < 8) {
    return null;
  }

  return `${clean}@s.whatsapp.net`;
}

/* =========================================================
   CONTACT CACHE
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
   SAFE PHONE JID
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

/* =========================================================
   GENERAL PHONE JID
========================================================= */

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
   ADMIN PHONE JID
   IMPORTANT:
   Direct participant phoneNumber gets priority.
   Duplicate JID is prevented later.
========================================================= */

function getAdminPhoneJid(
  participant = {},
  metadata = null
) {
  const direct =
    getDirectPhoneJid(
      participant
    );

  if (direct) {
    return direct;
  }

  /*
   * Group owner PN is provided by WhatsApp
   * in metadata.ownerPn.
   */

  const ownerPn =
    metadata?.ownerPn ||
    metadata?.subjectOwnerPn ||
    null;

  if (
    participant.admin === "superadmin" &&
    isPhoneJid(ownerPn)
  ) {
    return ownerPn;
  }

  /*
   * Use cached mapping only if it is unique
   * for this participant.
   */

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

    const directPhone =
      getDirectPhoneJid(
        participant
      );

    const name =
      getDisplayName(
        participant
      );

    if (
      directPhone &&
      participant.id
    ) {
      contactPhoneJids.set(
        participant.id,
        directPhone
      );
    }

    if (
      directPhone &&
      participant.lid
    ) {
      contactPhoneJids.set(
        participant.lid,
        directPhone
      );
    }

    if (
      directPhone &&
      isLidJid(participant.id)
    ) {
      lidToPhoneJid.set(
        participant.id,
        directPhone
      );
    }

    if (
      directPhone &&
      participant.lid
    ) {
      lidToPhoneJid.set(
        participant.lid,
        directPhone
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

      if (directPhone) {
        contactNames.set(
          directPhone,
          name
        );
      }
    }
  }
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

${WEBSITE_HOME}

⚡ *Earning Page:*

${WEBSITE_URL}

🎁 এখানে Account Buy/Sell,
Google Play Points এবং
অন্যান্য earning সম্পর্কিত
তথ্য পাওয়া যাবে।

🤍 *Piyas*
`;

/* =========================================================
   WELCOME MESSAGE
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
${WEBSITE_HOME}

🤍 *Piyas*
`;
}

/* =========================================================
   PIYAS
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
       GROUP PARTICIPANT UPDATE
       
       এখানে নতুন Member Join করলে
       Automatic Welcome পাঠানো হবে।
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

          cacheParticipants(
            participants
          );

          /* নতুন Member হলে */

          if (
            action === "add"
          ) {
            for (
              const participant of participants
            ) {
              try {
                /*
                 * Group metadata থেকে
                 * আসল participant তথ্য নেওয়া
                 */

                let metadata = null;

                try {
                  metadata =
                    await sock.groupMetadata(
                      groupId
                    );

                  cacheParticipants(
                    metadata?.participants ||
                    []
                  );
                } catch {}

                const currentParticipant =
                  findParticipant(
                    metadata?.participants ||
                    [],
                    participant?.id
                  ) ||
                  participant;

                const name =
                  getDisplayName(
                    currentParticipant
                  );

                const phoneJid =
                  getPhoneJid(
                    currentParticipant
                  );

                /*
                 * আসল JID পাওয়া গেলে
                 * clickable mention হবে।
                 */

                if (
                  phoneJid &&
                  isPhoneJid(
                    phoneJid
                  )
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
                  /*
                   * JID পাওয়া না গেলে
                   * ভুল ব্যক্তিকে mention না করে
                   * শুধু নাম দেখাবে।
                   */

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
              } catch (
                welcomeError
              ) {
                console.log(
                  "⚠️ Welcome error:",
                  welcomeError?.message
                );
              }
            }
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

          pairingRequested =
            false;

          /*
           * Group cache refresh
           */

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
          } catch (
            cacheError
          ) {
            console.log(
              "⚠️ Group cache error:",
              cacheError?.message
            );
          }

          /*
           * Pairing Code
           */

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
            } catch (
              pairingError
            ) {
              console.log(
                "⚠️ Pairing code error:",
                pairingError?.message
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

          if (
            shouldReconnect
          ) {
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

          /* ===============================================
             /MENU /BOT
          =============================================== */

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

          /* ===============================================
             /RULES
          =============================================== */

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

          /* ===============================================
             /WEBSITE
          =============================================== */

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
                  `🆔 *GROUP ID*\n\n${remoteJid}`
              }
            );

            return;
          }

          /* ===============================================
             /GROUPINFO
          =============================================== */

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
                p =>
                  p?.admin ===
                    "admin" ||
                  p?.admin ===
                    "superadmin" ||
                  p?.admin === true ||
                  p?.isAdmin === true ||
                  p?.isSuperAdmin ===
                    true
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
                        ) *
                          1000
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
             
             IMPORTANT:
             এখানে কাউকে mention করা হবে না।
             শুধু নাম দেখাবে।
          =============================================== */

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

            cacheParticipants(
              participants
            );

            if (
              participants.length ===
              0
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "👥 কোনো Member পাওয়া যায়নি।"
                }
              );

              return;
            }

            const lines = [];

            for (
              let i = 0;
              i <
              participants.length;
              i++
            ) {
              const participant =
                participants[i];

              const name =
                getDisplayName(
                  participant
                );

              lines.push(
                `${i + 1}️⃣ ${name}`
              );
            }

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `╭━━━━━━━━━━━━━━━━━━━━╮
        👥 *GROUP MEMBERS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n")}

━━━━━━━━━━━━━━━━━━━━
👥 *মোট Member:* ${participants.length} জন
🤍 *Piyas*`
              }
            );

            return;
          }

          /* ===============================================
             /ADMIN
             
             শুধু /admin কাজ করবে।
             /admins নেই।
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
                  p?.admin ===
                    "admin" ||
                  p?.admin ===
                    "superadmin" ||
                  p?.admin === true ||
                  p?.isAdmin === true ||
                  p?.isSuperAdmin ===
                    true
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
                p =>
                  p?.admin ===
                    "superadmin" ||
                  p?.isSuperAdmin ===
                    true
              );

            const normalAdmins =
              adminParticipants.filter(
                p =>
                  !(
                    p?.admin ===
                      "superadmin" ||
                    p?.isSuperAdmin ===
                      true
                  )
              );

            const lines = [];
            const mentions = [];

            /*
             * Prevent same JID from being used
             * for two different admins.
             */

            const usedJids =
              new Set();

            let number = 1;

            /* =============================================
               OWNER
            ============================================= */

            for (
              const participant of owners
            ) {
              const name =
                getDisplayName(
                  participant
                );

              const jid =
                getAdminPhoneJid(
                  participant,
                  metadata
                );

              if (
                jid &&
                !usedJids.has(jid)
              ) {
                usedJids.add(jid);
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
              const name =
                getDisplayName(
                  participant
                );

              const jid =
                getAdminPhoneJid(
                  participant,
                  metadata
                );

              if (
                jid &&
                !usedJids.has(jid)
              ) {
                usedJids.add(jid);
                mentions.push(jid);

                lines.push(
                  `${number}️⃣ @${name} 👑 *Admin*`
                );
              } else {
                /*
                 * Wrong person mention না করার জন্য
                 * duplicate JID হলে শুধু নাম দেখাবে।
                 */

                lines.push(
                  `${number}️⃣ ${name} 👑 *Admin*`
                );
              }

              number++;
            }

            const adminText = `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n\n")}

👥 *মোট Admin:* ${adminParticipants.length} জন

🤍 *Piyas*
`;

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  adminText,
                mentions:
                  [
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