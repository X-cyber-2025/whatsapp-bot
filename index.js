require("dotenv").config();

const http = require("http");
const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const pino = require("pino");

const PORT = process.env.PORT || 3000;
const AUTH_FOLDER = "./auth_info";
const PHONE_NUMBER = process.env.PHONE_NUMBER || "";

const GROUP_IDS = (process.env.GROUP_ID || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const WEBSITE = "https://x-cyber-2025.github.io/X-cyber.web/";

const RULES = `
📜 *GROUP RULES*

1️⃣ সবাইকে সম্মান করে কথা বলুন।
2️⃣ অশ্লীল/আপত্তিকর কোনো কনটেন্ট শেয়ার করা যাবে না।
3️⃣ Spam বা অতিরিক্ত মেসেজ করা যাবে না।
4️⃣ কোনো সদস্যকে বিরক্ত করা যাবে না।
5️⃣ Admin-এর সিদ্ধান্তকে সম্মান করুন।
6️⃣ গ্রুপের পরিবেশ সুন্দর রাখুন।

⚠️ নিয়ম ভঙ্গ করলে প্রয়োজন অনুযায়ী ব্যবস্থা নেওয়া হবে।

❤️ *Piyas*
`.trim();

const WELCOME = `
🎉 *WELCOME TO THE GROUP* 🎉

আসসালামু আলাইকুম @${"{member}"} ❤️

🌸 আমাদের গ্রুপে আপনাকে স্বাগতম।

📌 গ্রুপের নিয়ম দেখতে লিখুন:
*/rules*

🤖 Bot Menu দেখতে লিখুন:
*/menu*

🌐 Website:
${WEBSITE}

❤️ *Piyas*
`.trim();

const MENU = `
╭━━━〔 🤖 *PIYAS BOT* 〕━━━╮

👋 *Welcome!*

📌 *Available Commands*

🔹 */menu* অথবা */bot*
   ➜ Bot Menu

🔹 */rules*
   ➜ গ্রুপের নিয়ম দেখুন

🔹 */website*
   ➜ Website Link

🔹 */ping*
   ➜ Bot Response Check

🔹 */id*
   ➜ আপনার WhatsApp ID

🔹 */groupinfo*
   ➜ Group Information

🔹 */members*
   ➜ Group Members

🔹 */admin*
   ➜ Group Admin List

🔹 */piyas*
   ➜ Piyas Information

╰━━━━━━━━━━━━━━━━━━━━╯

❤️ *Piyas*
`.trim();

const PIYAS_INFO = `
╭━━━〔 👤 *PIYAS INFORMATION* 〕━━━╮

👤 *Name:* মোঃ আল আমিন
🔤 *English Name:* MD. AL AMIN

👨 *Father:* মোঃ মোশারফ হোসেন
👩 *Mother:* মোসাম্মৎ রীপা বেগম

🎂 *Date of Birth:* ০৯ জানুয়ারি ২০০৬
🩸 *Blood Group:* A+ (A Positive)
💍 *Marital Status:* অবিবাহিত

🏠 *Address:*
গ্রাম/রাস্তা: বলদার চর, নান্দাইল
ডাকঘর: হেংগু বাজার - ২২৯০
নান্দাইল, ময়মনসিংহ

🪪 *NID:* 9172******24

╰━━━━━━━━━━━━━━━━━━━━╯

❤️ *Piyas*
`.trim();

const contactCache = new Map();

let reconnectTimer = null;
let reconnectAttempts = 0;
let shuttingDown = false;
let sock = null;

function saveContacts(contacts = []) {
  for (const contact of contacts) {
    if (!contact) continue;

    const id = contact.id || contact.jid;
    if (!id) continue;

    contactCache.set(id, {
      ...contact,
      id
    });

    /*
     * LID এবং Phone JID mapping থাকলে cache করা
     */
    const lid = contact.lid;
    const phoneNumber =
      contact.phoneNumber ||
      contact.pn ||
      contact.phone;

    if (lid && phoneNumber) {
      contactCache.set(lid, {
        ...contact,
        id: lid,
        phoneNumber
      });
    }

    if (phoneNumber) {
      contactCache.set(phoneNumber, {
        ...contact,
        id: phoneNumber,
        phoneNumber
      });
    }
  }
}

function normalizeJid(jid) {
  if (!jid || typeof jid !== "string") return null;

  return jid.includes(":")
    ? jid.split(":")[0]
    : jid;
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

function getDisplayName(participant) {
  if (!participant) return "Unknown Member";

  const id =
    participant.id ||
    participant.jid ||
    participant.lid ||
    "";

  const cached = contactCache.get(id);

  const name =
    participant.notify ||
    participant.name ||
    participant.verifiedName ||
    participant.pushName ||
    participant.subject ||
    cached?.notify ||
    cached?.name ||
    cached?.verifiedName ||
    cached?.pushName;

  if (name && String(name).trim()) {
    return String(name).trim();
  }

  if (isPhoneJid(id)) {
    const number = id.split("@")[0];
    return number;
  }

  return "Unknown Member";
}

function findParticipant(participants, id) {
  if (!Array.isArray(participants) || !id) {
    return null;
  }

  const normalized = normalizeJid(id);

  return (
    participants.find(p => {
      const pid = normalizeJid(
        p?.id ||
        p?.jid ||
        p?.lid
      );

      return pid === normalized;
    }) || null
  );
}

/*
 * Admin/Member-এর Phone JID বের করার চেষ্টা।
 *
 * Priority:
 * 1. phoneNumber
 * 2. pn
 * 3. phone
 * 4. id যদি @s.whatsapp.net হয়
 * 5. lid-এর cached phone mapping
 */
function getMentionJid(participant) {
  if (!participant) return null;

  const possiblePhoneIds = [
    participant.phoneNumber,
    participant.pn,
    participant.phone,
    participant.phone_jid,
    participant.jid
  ];

  for (const jid of possiblePhoneIds) {
    if (isPhoneJid(jid)) {
      return normalizeJid(jid);
    }
  }

  if (isPhoneJid(participant.id)) {
    return normalizeJid(participant.id);
  }

  if (isPhoneJid(participant.lid)) {
    return normalizeJid(participant.lid);
  }

  /*
   * LID থেকে cache-এ Phone JID খোঁজা
   */
  const possibleLids = [
    participant.id,
    participant.lid
  ];

  for (const lid of possibleLids) {
    if (!isLidJid(lid)) continue;

    const cached = contactCache.get(lid);

    const cachedPhone =
      cached?.phoneNumber ||
      cached?.pn ||
      cached?.phone ||
      cached?.id;

    if (isPhoneJid(cachedPhone)) {
      return normalizeJid(cachedPhone);
    }
  }

  return null;
}

function getMessageText(message) {
  if (!message) return "";

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ""
  ).trim();
}

function getPhoneJid(number) {
  if (!number) return null;

  const clean = String(number).replace(/\D/g, "");

  if (!clean) return null;

  return `${clean}@s.whatsapp.net`;
}

function getMentionJidFromId(id) {
  if (!id || typeof id !== "string") return null;

  if (isPhoneJid(id)) {
    return normalizeJid(id);
  }

  const cached = contactCache.get(id);

  if (cached) {
    return (
      getMentionJid(cached) ||
      (isPhoneJid(cached.id) ? normalizeJid(cached.id) : null)
    );
  }

  return null;
}

function isAllowedGroup(jid) {
  if (!jid || !jid.endsWith("@g.us")) {
    return false;
  }

  if (GROUP_IDS.length === 0) {
    return true;
  }

  return GROUP_IDS.includes(jid);
}

function scheduleReconnect() {
  if (shuttingDown) return;
  if (reconnectTimer) return;

  reconnectAttempts++;

  const delay = Math.min(
    5000 * reconnectAttempts,
    60000
  );

  console.log(
    `🔄 Reconnecting in ${Math.round(delay / 1000)} seconds...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch(console.error);
  }, delay);
}

async function startBot() {
  if (shuttingDown) return;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: Browsers.ubuntu("Chrome"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    /*
     * Contact cache
     */
    sock.ev.on("contacts.upsert", contacts => {
      saveContacts(contacts);
    });

    sock.ev.on("contacts.update", contacts => {
      saveContacts(contacts);
    });

    /*
     * Connection update
     */
    sock.ev.on("connection.update", async update => {
      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {
        console.log("📱 QR generated.");
      }

      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === "open") {
        reconnectAttempts = 0;

        console.log("✅ WhatsApp Connected!");
        console.log(
          `🌐 Website: ${WEBSITE}`
        );

        /*
         * Pairing Code
         */
        if (
          PHONE_NUMBER &&
          !state.creds.registered
        ) {
          try {
            const cleanNumber =
              PHONE_NUMBER.replace(/\D/g, "");

            if (cleanNumber) {
              const code =
                await sock.requestPairingCode(
                  cleanNumber
                );

              console.log(
                `🔐 Pairing Code: ${code}`
              );
            }
          } catch (error) {
            console.error(
              "❌ Pairing code error:",
              error
            );
          }
        }
      }

      if (connection === "close") {
        const statusCode =
          new Boom(
            lastDisconnect?.error
          )?.output?.statusCode;

        console.log(
          "❌ Connection closed:",
          statusCode
        );

        if (
          statusCode ===
          DisconnectReason.loggedOut
        ) {
          console.log(
            "🚪 Logged out. Delete auth_info and pair again."
          );
          return;
        }

        if (statusCode === 403) {
          console.log(
            "⛔ WhatsApp returned 403."
          );
          return;
        }

        scheduleReconnect();
      }
    });

    /*
     * New member welcome
     */
    sock.ev.on(
      "group-participants.update",
      async update => {
        try {
          const {
            id: groupId,
            participants = [],
            action
          } = update;

          if (
            action !== "add" ||
            !isAllowedGroup(groupId)
          ) {
            return;
          }

          const metadata =
            await sock.groupMetadata(groupId);

          const groupName =
            metadata?.subject ||
            "Our Group";

          const groupParticipants =
            Array.isArray(metadata?.participants)
              ? metadata.participants
              : [];

          for (const rawParticipant of participants) {
            const participantId =
              typeof rawParticipant === "string"
                ? rawParticipant
                : (
                    rawParticipant?.id ||
                    rawParticipant?.lid ||
                    rawParticipant?.jid ||
                    ""
                  );

            const participant =
              findParticipant(
                groupParticipants,
                participantId
              );

            let memberName =
              participant
                ? getDisplayName(participant)
                : "Unknown Member";

            /*
             * Event থেকে name নেওয়ার চেষ্টা
             */
            if (
              (
                !memberName ||
                memberName === "Unknown Member"
              ) &&
              rawParticipant &&
              typeof rawParticipant === "object"
            ) {
              memberName =
                rawParticipant.notify ||
                rawParticipant.name ||
                rawParticipant.verifiedName ||
                rawParticipant.pushName ||
                "Unknown Member";
            }

            memberName =
              String(memberName || "").trim();

            if (
              !memberName ||
              memberName === "Unknown Member"
            ) {
              memberName = "Member";
            }

            /*
             * আসল WhatsApp mention ID
             */
            let mentionJid =
              getMentionJid(
                participant ||
                (
                  rawParticipant &&
                  typeof rawParticipant === "object"
                    ? rawParticipant
                    : null
                )
              );

            /*
             * participant পাওয়া না গেলে
             * সরাসরি ID থেকে চেষ্টা
             */
            if (!mentionJid) {
              mentionJid =
                getMentionJidFromId(
                  participantId
                );
            }

            const safeGroupName =
              String(groupName)
                .replace(/\n/g, " ")
                .trim();

            const mentionText =
              mentionJid
                ? `@${memberName}`
                : memberName;

            const welcomeMessage =
              WELCOME
                .replace(
                  "{member}",
                  mentionText
                )
                .replace(
                  "{group}",
                  safeGroupName
                );

            if (mentionJid) {
              await sock.sendMessage(
                groupId,
                {
                  text: welcomeMessage,
                  mentions: [mentionJid]
                }
              );
            } else {
              await sock.sendMessage(
                groupId,
                {
                  text: welcomeMessage
                }
              );
            }
          }
        } catch (error) {
          console.error(
            "❌ Welcome error:",
            error
          );
        }
      }
    );

    /*
     * Message Handler
     */
    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {
        try {
          const message =
            messages?.[0];

          if (!message?.message) {
            return;
          }

          if (message.key.fromMe) {
            return;
          }

          const remoteJid =
            message.key.remoteJid;

          if (!remoteJid) {
            return;
          }

          const messageText =
            getMessageText(
              message.message
            );

          if (!messageText) {
            return;
          }

          const command =
            messageText
              .split(/\s+/)[0]
              .toLowerCase();

          /*
           * /menu অথবা /bot
           */
          if (
            command === "/menu" ||
            command === "/bot"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: MENU
              }
            );

            continue;
          }

          /*
           * /rules
           */
          if (command === "/rules") {
            await sock.sendMessage(
              remoteJid,
              {
                text: RULES
              }
            );

            continue;
          }

          /*
           * /website
           */
          if (command === "/website") {
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🌐 *Website*\n\n${WEBSITE}\n\n❤️ *Piyas*`
              }
            );

            continue;
          }

          /*
           * /ping
           */
          if (command === "/ping") {
            const start =
              Date.now();

            const sent =
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "🏓 *Pong!*\n\n⏱️ Checking..."
                }
              );

            const latency =
              Date.now() - start;

            try {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🏓 *Pong!*\n\n⚡ Response: ${latency} ms\n\n❤️ *Piyas*`
                },
                {
                  quoted: message
                }
              );
            } catch {
              /*
               * দ্বিতীয় message fail করলে
               * প্রথম message-ই যথেষ্ট
               */
            }

            continue;
          }

          /*
           * /id
           */
          if (command === "/id") {
            const sender =
              message.key.participant ||
              message.key.remoteJid;

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🆔 *Your WhatsApp ID*\n\n\`${sender}\`\n\n❤️ *Piyas*`
              }
            );

            continue;
          }

          /*
           * Group commands-এর জন্য group check
           */
          if (
            command === "/groupinfo" ||
            command === "/members" ||
            command === "/admin"
          ) {
            if (
              !remoteJid.endsWith("@g.us")
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "❌ এই কমান্ডটি শুধু Group-এ ব্যবহার করা যাবে।"
                }
              );

              continue;
            }

            if (
              !isAllowedGroup(remoteJid)
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "❌ এই গ্রুপে Bot ব্যবহার করার অনুমতি নেই।"
                }
              );

              continue;
            }
          }

          /*
           * /groupinfo
           */
          if (
            command === "/groupinfo"
          ) {
            try {
              const metadata =
                await sock.groupMetadata(
                  remoteJid
                );

              const participants =
                Array.isArray(
                  metadata?.participants
                )
                  ? metadata.participants
                  : [];

              const admins =
                participants.filter(
                  p =>
                    p?.admin === "admin" ||
                    p?.admin === "superadmin" ||
                    p?.admin === true
                );

              const owner =
                metadata?.owner ||
                metadata?.ownerPn ||
                "Not available";

              const groupInfo = `
╭━━━〔 👥 *GROUP INFO* 〕━━━╮

📛 *Name:* ${metadata?.subject || "Unknown"}

🆔 *Group ID:*
${remoteJid}

👥 *Members:* ${participants.length} জন

👑 *Admins:* ${admins.length} জন

👤 *Owner:*
${owner}

╰━━━━━━━━━━━━━━━━━━━━╯

❤️ *Piyas*
`.trim();

              await sock.sendMessage(
                remoteJid,
                {
                  text: groupInfo
                }
              );
            } catch (error) {
              console.error(
                "Group info error:",
                error
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "❌ Group information পাওয়া যায়নি।"
                }
              );
            }

            continue;
          }

          /*
           * /members
           */
          if (
            command === "/members"
          ) {
            try {
              const metadata =
                await sock.groupMetadata(
                  remoteJid
                );

              const participants =
                Array.isArray(
                  metadata?.participants
                )
                  ? metadata.participants
                  : [];

              let memberText =
                "👥 *GROUP MEMBERS*\n\n";

              const mentions = [];

              for (
                let i = 0;
                i < participants.length;
                i++
              ) {
                const participant =
                  participants[i];

                let memberName =
                  getDisplayName(
                    participant
                  );

                if (
                  !memberName ||
                  memberName ===
                    "Unknown Member"
                ) {
                  memberName = "Member";
                }

                const mentionJid =
                  getMentionJid(
                    participant
                  );

                if (mentionJid) {
                  memberText +=
                    `${i + 1}️⃣ @${memberName}\n`;
                  mentions.push(
                    mentionJid
                  );
                } else {
                  memberText +=
                    `${i + 1}️⃣ 👤 ${memberName}\n`;
                }
              }

              memberText +=
                `\n👥 *মোট Member: ${participants.length} জন*\n\n❤️ *Piyas*`;

              await sock.sendMessage(
                remoteJid,
                {
                  text: memberText,
                  mentions: [
                    ...new Set(
                      mentions
                    )
                  ]
                }
              );
            } catch (error) {
              console.error(
                "Members command error:",
                error
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "❌ Members list বের করতে সমস্যা হয়েছে।"
                }
              );
            }

            continue;
          }

          /*
           * /admin
           *
           * শুধু Admin এবং Group Owner-কে
           * আসল WhatsApp mention করার চেষ্টা করবে।
           */
          if (
            command === "/admin"
          ) {
            try {
              const metadata =
                await sock.groupMetadata(
                  remoteJid
                );

              const participants =
                Array.isArray(
                  metadata?.participants
                )
                  ? metadata.participants
                  : [];

              const admins =
                participants.filter(
                  participant =>
                    participant?.admin ===
                      "admin" ||
                    participant?.admin ===
                      "superadmin" ||
                    participant?.admin ===
                      true
                );

              if (admins.length === 0) {
                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ এই গ্রুপে কোনো Admin পাওয়া যায়নি।"
                  }
                );

                continue;
              }

              let adminText =
                "╭━━━〔 👑 *GROUP ADMINS* 〕━━━╮\n\n";

              const mentions = [];

              let adminNumber = 1;

              for (
                const admin of admins
              ) {
                let adminName =
                  getDisplayName(
                    admin
                  );

                if (
                  !adminName ||
                  adminName ===
                    "Unknown Member"
                ) {
                  adminName =
                    "Admin";
                }

                /*
                 * Admin-এর আসল Phone JID
                 * বের করার চেষ্টা
                 */
                const mentionJid =
                  getMentionJid(
                    admin
                  );

                if (mentionJid) {
                  /*
                   * এই @নাম-টাই clickable
                   * WhatsApp mention হবে
                   */
                  adminText +=
                    `${adminNumber}️⃣ @${adminName}\n`;

                  if (
                    !mentions.includes(
                      mentionJid
                    )
                  ) {
                    mentions.push(
                      mentionJid
                    );
                  }
                } else {
                  /*
                   * JID পাওয়া না গেলে
                   * শুধু নাম দেখাবে
                   */
                  adminText +=
                    `${adminNumber}️⃣ 👤 ${adminName}\n`;
                }

                if (
                  admin?.admin ===
                  "superadmin"
                ) {
                  adminText +=
                    "   ⭐ *Group Owner*\n\n";
                } else {
                  adminText +=
                    "   👑 *Admin*\n\n";
                }

                adminNumber++;
              }

              adminText +=
                "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

              adminText +=
                `👥 *মোট Admin: ${admins.length} জন*\n\n`;

              adminText +=
                "❤️ *Piyas*";

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
            } catch (error) {
              console.error(
                "❌ Admin command error:",
                error
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    "❌ Admin list বের করতে সমস্যা হয়েছে।"
                }
              );
            }

            continue;
          }

          /*
           * /piyas
           */
          if (
            command === "/piyas"
          ) {
            await sock.sendMessage(
              remoteJid,
              {
                text: PIYAS_INFO
              }
            );

            continue;
          }
        } catch (error) {
          console.error(
            "❌ Message handler error:",
            error
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "❌ Bot start error:",
      error
    );

    scheduleReconnect();
  }
}

/*
 * HTTP Server
 */
const server = http.createServer(
  (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type":
          "application/json"
      });

      res.end(
        JSON.stringify({
          status: "ok",
          bot: Boolean(sock),
          uptime: process.uptime()
        })
      );

      return;
    }

    res.writeHead(200, {
      "Content-Type":
        "text/plain; charset=utf-8"
    });

    res.end(
      "🤖 Piyas WhatsApp Bot is running!"
    );
  }
);

server.listen(
  PORT,
  () => {
    console.log(
      `🌐 Server running on port ${PORT}`
    );

    startBot().catch(console.error);
  }
);

/*
 * Graceful Shutdown
 */
async function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  console.log(
    `\n🛑 ${signal} received. Shutting down...`
  );

  try {
    if (reconnectTimer) {
      clearTimeout(
        reconnectTimer
      );

      reconnectTimer = null;
    }

    if (sock) {
      try {
        sock.end(
          new Error(
            "Bot shutting down"
          )
        );
      } catch {}
    }

    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(0);
    }, 5000);
  } catch {
    process.exit(0);
  }
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Rejection:",
      error
    );
  }
);