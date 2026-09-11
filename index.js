import http from "http";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";


// ==================================================
// 🌐 SERVER
// ==================================================

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("WhatsApp Bot is running!");
}).listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});


// ==================================================
// ⚙️ BOT SETTINGS
// ==================================================

const AUTH_FOLDER = "./auth_info";

const PHONE_NUMBER =
  process.env.PHONE_NUMBER || "";

const GROUP_ID =
  process.env.GROUP_ID || "";


// ==================================================
// 🌐 WEBSITE
// ==================================================

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";


// ==================================================
// 📜 GROUP RULES
// ==================================================

const RULES = `
📜 *গ্রুপের নিয়মাবলি*

1️⃣ সবাইকে সম্মান করে কথা বলুন।
2️⃣ অশ্লীল/আপত্তিকর কোনো কনটেন্ট শেয়ার করা যাবে না।
3️⃣ Spam বা অতিরিক্ত মেসেজ করা যাবে না।
4️⃣ কোনো সদস্যকে বিরক্ত করা যাবে না।
5️⃣ Account Buy/Sell করা যাবে না।
6️⃣ Google Play Points সম্পর্কিত আর্নিংয়ে সবাইকে সহযোগিতা করুন।
7️⃣ কোনো সমস্যায় পড়লে Admin-কে জানাবেন।
8️⃣ নিয়ম ভঙ্গ করলে প্রয়োজন অনুযায়ী ব্যবস্থা নেওয়া হবে।

⚠️ গ্রুপের নিয়ম সবাইকে মেনে চলতে হবে।
`.trim();


// ==================================================
// 👋 WELCOME
// ==================================================

const WELCOME = `
🎉 *স্বাগতম {member}!* ❤️

🌸 আপনাকে *{group}* গ্রুপে স্বাগতম।

💬 এখানে সবাই একে অপরকে সহযোগিতা করবেন।

📌 গ্রুপের নিয়ম দেখতে লিখুন:
*/rules*

🌐 Website দেখতে লিখুন:
*/website*

⚡ Account Buy/Sell ও Google Play Points সম্পর্কিত তথ্য এখানে শেয়ার করা হয়।

⚠️ *বিশেষ সতর্কতা:*

যেকোনো সমস্যায় পড়লে সরাসরি Admin-কে জানাবেন।

কোনো ধরনের প্রতারণা বা সন্দেহজনক বিষয় দেখলে Admin-কে জানান।

🌐 আমাদের Website:
${WEBSITE_URL}

❤️ *Piyas*
`.trim();


// ==================================================
// 🤖 MENU
// ==================================================

const MENU = `
╭━━━〔 🤖 *PIYAS BOT* 〕━━━╮

📌 *Available Commands*

1️⃣ /menu অথবা /bot
   ➜ Bot Menu

2️⃣ /rules
   ➜ গ্রুপের নিয়ম

3️⃣ /website
   ➜ Official Website

4️⃣ /ping
   ➜ Bot Status

5️⃣ /id
   ➜ Group ID

6️⃣ /groupinfo
   ➜ Group Information

7️⃣ /members
   ➜ Member Count

8️⃣ /admins
   ➜ শুধু Admin-দের Mention

9️⃣ /users
   ➜ সব Members-এর List

╰━━━━━━━━━━━━━━━━━━━━╯

❤️ *Piyas*
`.trim();


// ==================================================
// 📇 CONTACT NAME CACHE
// ==================================================

const contactNames = new Map();


// ==================================================
// 📇 SAVE CONTACTS
// ==================================================

function saveContacts(contacts = []) {
  for (const contact of contacts) {
    if (!contact?.id) {
      continue;
    }

    const name =
      contact.notify ||
      contact.name ||
      contact.verifiedName ||
      contact.pushName ||
      "";

    if (name) {
      contactNames.set(
        contact.id,
        String(name).trim()
      );
    }

    /*
     * Phone JID থাকলে সেটার নামও cache করি
     */
    if (
      contact.phoneNumber &&
      name
    ) {
      contactNames.set(
        contact.phoneNumber,
        String(name).trim()
      );
    }

    /*
     * LID থাকলে LID-এর নামও cache করি
     */
    if (
      contact.lid &&
      name
    ) {
      contactNames.set(
        contact.lid,
        String(name).trim()
      );
    }
  }
}


// ==================================================
// 🆔 NORMALIZE JID
// ==================================================

function normalizeJid(jid) {
  if (
    !jid ||
    typeof jid !== "string"
  ) {
    return null;
  }

  return jid.includes(":")
    ? jid.split(":")[0]
    : jid;
}


// ==================================================
// 📱 PHONE JID CHECK
// ==================================================

function isPhoneJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith("@s.whatsapp.net")
  );
}


// ==================================================
// 🔐 LID CHECK
// ==================================================

function isLidJid(jid) {
  return (
    typeof jid === "string" &&
    jid.endsWith("@lid")
  );
}


// ==================================================
// 👤 GET DISPLAY NAME
// ==================================================

function getDisplayName(participant) {
  if (!participant) {
    return "Unknown Member";
  }

  const id =
    participant.id ||
    participant.jid ||
    participant.lid ||
    "";

  const cachedName =
    contactNames.get(id);

  const name =
    participant.notify ||
    participant.name ||
    participant.verifiedName ||
    participant.pushName ||
    cachedName ||
    "";

  if (
    name &&
    String(name).trim()
  ) {
    return String(name).trim();
  }

  if (isPhoneJid(id)) {
    return id.split("@")[0];
  }

  return "Unknown Member";
}


// ==================================================
// 👤 FIND PARTICIPANT
// ==================================================

function findParticipant(
  participants,
  id
) {
  if (
    !Array.isArray(participants) ||
    !id
  ) {
    return null;
  }

  const target =
    normalizeJid(id);

  return (
    participants.find(
      participant => {
        const participantId =
          normalizeJid(
            participant?.id ||
            participant?.jid ||
            participant?.lid
          );

        return (
          participantId === target
        );
      }
    ) || null
  );
}


// ==================================================
// 📱 GET REAL PHONE JID
// FOR CLICKABLE MENTION
// ==================================================

function getMentionJid(
  participant
) {
  if (!participant) {
    return null;
  }

  /*
   * বিভিন্ন Baileys version-এ
   * Phone JID বিভিন্ন field-এ থাকতে পারে।
   */

  const possibleJids = [
    participant.phoneNumber,
    participant.pn,
    participant.phone,
    participant.phone_jid,
    participant.jid
  ];

  for (
    const jid of possibleJids
  ) {
    if (isPhoneJid(jid)) {
      return normalizeJid(jid);
    }
  }

  /*
   * ID নিজেই Phone JID হলে
   */
  if (
    isPhoneJid(
      participant.id
    )
  ) {
    return normalizeJid(
      participant.id
    );
  }

  /*
   * LID-এর cached mapping
   */
  const possibleLids = [
    participant.id,
    participant.lid
  ];

  for (
    const lid of possibleLids
  ) {
    if (!isLidJid(lid)) {
      continue;
    }

    /*
     * Cache-এ Phone JID থাকলে
     */
    const cached =
      contactNames.get(lid);

    /*
     * contactNames শুধু নাম রাখে,
     * তাই এখানে participant-এর
     * অন্য field-গুলোই priority।
     */
    if (cached) {
      const cachedContact =
        participant;

      const phone =
        cachedContact?.phoneNumber ||
        cachedContact?.pn ||
        cachedContact?.phone ||
        cachedContact?.phone_jid;

      if (
        isPhoneJid(phone)
      ) {
        return normalizeJid(
          phone
        );
      }
    }
  }

  return null;
}


// ==================================================
// 📝 MESSAGE TEXT
// ==================================================

function getMessageText(message) {
  if (!message) {
    return "";
  }

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


// ==================================================
// 🔒 GROUP RESTRICTION
// ==================================================

function isAllowedGroup(jid) {
  if (
    !jid ||
    !jid.endsWith("@g.us")
  ) {
    return false;
  }

  if (!GROUP_ID) {
    return true;
  }

  return jid === GROUP_ID;
}


// ==================================================
// 🚀 START BOT
// ==================================================

async function startBot() {
  console.log("");
  console.log("==========================================");
  console.log("🚀 WhatsApp Bot Starting...");
  console.log("==========================================");
  console.log("");

  try {

    // ==================================================
    // 🔐 AUTH
    // ==================================================

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      AUTH_FOLDER
    );


    // ==================================================
    // ⚙️ CONFIG CHECK
    // ==================================================

    if (!PHONE_NUMBER) {
      console.log(
        "⚠️ PHONE_NUMBER Environment Variable পাওয়া যায়নি।"
      );
    }

    if (!GROUP_ID) {
      console.log(
        "⚠️ GROUP_ID দেওয়া হয়নি। Bot সব Group-এ কাজ করবে।"
      );
    } else {
      console.log(
        `🔒 Restricted Group: ${GROUP_ID}`
      );
    }


    // ==================================================
    // 📱 CREATE SOCKET
    // ==================================================

    const sock = makeWASocket({
      auth: state,

      logger: P({
        level: "silent"
      }),

      printQRInTerminal: false,

      browser:
        Browsers.ubuntu("Chrome"),

      connectTimeoutMs: 60000,

      keepAliveIntervalMs: 25000
    });


    // ==================================================
    // 💾 SAVE CREDENTIALS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ==================================================
    // 📇 CONTACTS
    // ==================================================

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


    // ==================================================
    // 📱 PAIRING CODE
    // ==================================================

    let pairingCodeRequested =
      false;

    if (
      !state.creds.registered &&
      PHONE_NUMBER
    ) {

      setTimeout(
        async () => {

          if (
            pairingCodeRequested
          ) {
            return;
          }

          try {

            pairingCodeRequested =
              true;

            const number =
              PHONE_NUMBER.replace(
                /\D/g,
                ""
              );

            if (!number) {
              throw new Error(
                "PHONE_NUMBER সঠিক নয়।"
              );
            }

            console.log("");
            console.log(
              "📱 WhatsApp Pairing Code তৈরি হচ্ছে..."
            );
            console.log("");

            const code =
              await sock.requestPairingCode(
                number
              );

            const formattedCode =
              code
                ?.match(/.{1,4}/g)
                ?.join("-") ||
              code;

            console.log("");
            console.log(
              "=========================================="
            );
            console.log(
              "📱 WHATSAPP PAIRING CODE"
            );
            console.log(
              "=========================================="
            );
            console.log(
              `🔑 ${formattedCode}`
            );
            console.log(
              "=========================================="
            );
            console.log(
              "📱 WhatsApp → Settings"
            );
            console.log(
              "→ Linked Devices"
            );
            console.log(
              "→ Link a device"
            );
            console.log(
              "→ Link with phone number instead"
            );
            console.log(
              `→ Pairing Code: ${formattedCode}`
            );
            console.log(
              "=========================================="
            );
            console.log("");

          } catch (error) {

            pairingCodeRequested =
              false;

            console.log("");
            console.log(
              "❌ Pairing Code Error:"
            );

            console.log(
              error?.message ||
              error
            );

            console.log("");
          }

        },
        3000
      );
    }


    // ==================================================
    // 🔌 CONNECTION UPDATE
    // ==================================================

    let reconnectTimer =
      null;

    sock.ev.on(
      "connection.update",
      async update => {

        const {
          connection,
          lastDisconnect
        } = update;


        // ==================================================
        // ✅ CONNECTED
        // ==================================================

        if (
          connection === "open"
        ) {

          console.log("");
          console.log(
            "=========================================="
          );
          console.log(
            "✅ WhatsApp Bot Connected Successfully!"
          );
          console.log(
            "=========================================="
          );

          if (GROUP_ID) {
            console.log(
              `🔒 Bot Group Restriction: ${GROUP_ID}`
            );
          }

          console.log("");
        }


        // ==================================================
        // ❌ CLOSED
        // ==================================================

        if (
          connection === "close"
        ) {

          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output?.statusCode;

          console.log("");
          console.log(
            "=========================================="
          );
          console.log(
            "⚠️ WhatsApp Connection Closed"
          );
          console.log(
            `⚠️ Status Code: ${statusCode}`
          );
          console.log(
            "=========================================="
          );


          // ==================================================
          // 🚪 LOGGED OUT
          // ==================================================

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "🚪 WhatsApp Logout হয়েছে।"
            );

            console.log(
              "📱 আবার Pairing করতে হবে।"
            );

            return;
          }


          // ==================================================
          // 🔄 AUTO RECONNECT
          // ==================================================

          if (
            !reconnectTimer
          ) {

            console.log(
              "🔄 5 সেকেন্ড পর Reconnect হবে..."
            );

            reconnectTimer =
              setTimeout(
                () => {

                  reconnectTimer =
                    null;

                  console.log(
                    "🔄 Reconnecting WhatsApp..."
                  );

                  startBot();

                },
                5000
              );
          }
        }
      }
    );


    // ==================================================
    // 👋 NEW GROUP MEMBER
    // ==================================================

    sock.ev.on(
      "group-participants.update",
      async update => {

        try {

          if (
            update.action !== "add"
          ) {
            return;
          }

          const groupId =
            update.id;

          if (
            !isAllowedGroup(
              groupId
            )
          ) {
            return;
          }

          const metadata =
            await sock.groupMetadata(
              groupId
            );

          const groupName =
            metadata?.subject ||
            "Our Group";

          const participants =
            metadata?.participants ||
            [];

          for (
            const rawParticipant
            of update.participants
          ) {

            try {

              const participant =
                findParticipant(
                  participants,
                  typeof rawParticipant ===
                    "string"
                    ? rawParticipant
                    : rawParticipant?.id
                );

              let memberName =
                getDisplayName(
                  participant ||
                  (
                    typeof rawParticipant ===
                      "object"
                      ? rawParticipant
                      : {
                          id:
                            rawParticipant
                        }
                  )
                );

              if (
                !memberName ||
                memberName ===
                  "Unknown Member"
              ) {
                memberName =
                  "Member";
              }

              const mentionJid =
                getMentionJid(
                  participant ||
                  (
                    typeof rawParticipant ===
                      "object"
                      ? rawParticipant
                      : null
                  )
                );

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
                    groupName
                  );

              if (mentionJid) {

                await sock.sendMessage(
                  groupId,
                  {
                    text:
                      welcomeMessage,

                    mentions: [
                      mentionJid
                    ]
                  }
                );

              } else {

                await sock.sendMessage(
                  groupId,
                  {
                    text:
                      welcomeMessage
                  }
                );
              }

              console.log(
                `👋 Welcome sent to ${memberName}`
              );

            } catch (error) {

              console.log(
                "❌ Welcome Message Error:",
                error?.message ||
                error
              );
            }
          }

        } catch (error) {

          console.log(
            "❌ Group Welcome Error:",
            error?.message ||
            error
          );
        }
      }
    );


    // ==================================================
    // 💬 MESSAGE HANDLER
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        try {

          for (
            const msg of messages
          ) {

            try {

              if (
                !msg?.message
              ) {
                continue;
              }

              if (
                msg.key?.fromMe
              ) {
                continue;
              }

              const remoteJid =
                msg.key?.remoteJid;

              if (
                !remoteJid ||
                !remoteJid.endsWith(
                  "@g.us"
                )
              ) {
                continue;
              }

              if (
                !isAllowedGroup(
                  remoteJid
                )
              ) {
                continue;
              }

              const messageText =
                getMessageText(
                  msg.message
                );

              if (
                !messageText
              ) {
                continue;
              }

              const command =
                messageText
                  .split(/\s+/)[0]
                  .toLowerCase();

              console.log(
                `📩 Command: ${command} | Group: ${remoteJid}`
              );


              // ==================================================
              // /MENU
              // ==================================================

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

              }


              // ==================================================
              // /RULES
              // ==================================================

              else if (
                command === "/rules"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: RULES
                  }
                );

              }


              // ==================================================
              // /WEBSITE
              // ==================================================

              else if (
                command === "/website"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `
🌐 *Official Website*

🔗 ${WEBSITE_URL}

❤️ *Piyas*
`.trim()
                  }
                );

              }


              // ==================================================
              // /PING
              // ==================================================

              else if (
                command === "/ping"
              ) {

                const start =
                  Date.now();

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "🏓 *Pong!*\n\n⏳ Checking..."
                  }
                );

                const latency =
                  Date.now() -
                  start;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `🏓 *Pong!*\n\n✅ Bot is online.\n⚡ Response: ${latency} ms\n📡 Status: Active`
                  }
                );

              }


              // ==================================================
              // /ID
              // ==================================================

              else if (
                command === "/id"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `🆔 *GROUP ID*\n\n${remoteJid}`
                  }
                );

              }


              // ==================================================
              // /GROUPINFO
              // ==================================================

              else if (
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

                const admins =
                  participants.filter(
                    p =>
                      p?.admin ===
                        "admin" ||
                      p?.admin ===
                        "superadmin" ||
                      p?.admin ===
                        true
                  );

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `
╭━━━〔 👥 *GROUP INFORMATION* 〕━━━╮

📛 *Group Name:*
${metadata?.subject || "Unknown"}

👥 *Members:*
${participants.length} জন

👑 *Admins:*
${admins.length} জন

🆔 *Group ID:*
${remoteJid}

╰━━━━━━━━━━━━━━━━━━━━╯

❤️ *Piyas*
`.trim()
                  }
                );

              }


              // ==================================================
              // /MEMBERS
              // ==================================================

              else if (
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

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👥 *GROUP MEMBERS*\n\n📊 এই গ্রুপে মোট *${participants.length} জন* Member আছে।\n\n❤️ *Piyas*`
                  }
                );

              }


              // ==================================================
              // /ADMINS
              //
              // শুধু Admin-দের @mention করবে
              // ==================================================

              else if (
                command === "/admins"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata?.participants ||
                  [];

                const adminParticipants =
                  participants.filter(
                    p =>
                      p?.admin ===
                        "admin" ||
                      p?.admin ===
                        "superadmin" ||
                      p?.admin ===
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
                        "❌ এই গ্রুপে কোনো Admin পাওয়া যায়নি।"
                    }
                  );

                  continue;
                }


                let adminText =
                  "╭━━━〔 👑 *GROUP ADMINS* 〕━━━╮\n\n";

                const mentions = [];


                for (
                  let index = 0;
                  index <
                  adminParticipants.length;
                  index++
                ) {

                  const admin =
                    adminParticipants[
                      index
                    ];

                  let name =
                    getDisplayName(
                      admin
                    );

                  if (
                    !name ||
                    name ===
                      "Unknown Member"
                  ) {
                    name =
                      "Admin";
                  }


                  /*
                   * আসল WhatsApp Phone JID
                   * বের করার চেষ্টা
                   */
                  const mentionJid =
                    getMentionJid(
                      admin
                    );


                  if (
                    mentionJid
                  ) {

                    /*
                     * @Name clickable mention
                     */
                    adminText +=
                      `${index + 1}️⃣ @${name}\n`;

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
                     * JID না পাওয়া গেলে
                     * শুধু নাম দেখাবে
                     */
                    adminText +=
                      `${index + 1}️⃣ 👤 ${name}\n`;
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
                }


                adminText +=
                  "╰━━━━━━━━━━━━━━━━━━━━╯\n\n";

                adminText +=
                  `👥 *মোট Admin: ${adminParticipants.length} জন*\n\n`;

                adminText +=
                  "❤️ *Piyas*";


                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      adminText,

                    /*
                     * এখানে শুধু Admin-এর
                     * JID থাকবে
                     */
                    mentions: [
                      ...new Set(
                        mentions
                      )
                    ]
                  }
                );

              }


              // ==================================================
              // /USERS
              // ==================================================

              else if (
                command === "/users"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata?.participants ||
                  [];

                if (
                  participants.length ===
                  0
                ) {

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        "❌ কোনো Member পাওয়া যায়নি।"
                    }
                  );

                  continue;
                }


                let currentText =
                  `
👥 *GROUP MEMBERS LIST*

📊 মোট Member:
*${participants.length} জন*

`;


                let currentMentions =
                  [];


                for (
                  let index = 0;
                  index <
                  participants.length;
                  index++
                ) {

                  const participant =
                    participants[
                      index
                    ];

                  let name =
                    getDisplayName(
                      participant
                    );

                  if (
                    !name ||
                    name ===
                      "Unknown Member"
                  ) {
                    name =
                      "Member";
                  }

                  const mentionJid =
                    getMentionJid(
                      participant
                    );

                  const line =
                    mentionJid
                      ? `${index + 1}️⃣ @${name}\n`
                      : `${index + 1}️⃣ 👤 ${name}\n`;


                  /*
                   * WhatsApp message বড় হয়ে গেলে
                   * ভাগ করে পাঠাবে
                   */
                  if (
                    currentText.length +
                    line.length >
                    5500
                  ) {

                    currentText +=
                      "\n❤️ *Piyas*";

                    await sock.sendMessage(
                      remoteJid,
                      {
                        text:
                          currentText,

                        mentions:
                          [
                            ...new Set(
                              currentMentions
                            )
                          ]
                      }
                    );

                    currentText =
                      `
👥 *GROUP MEMBERS LIST — CONTINUED*

`;

                    currentMentions =
                      [];
                  }


                  currentText +=
                    line;


                  if (
                    mentionJid
                  ) {

                    currentMentions.push(
                      mentionJid
                    );
                  }
                }


                currentText +=
                  "\n❤️ *Piyas*";


                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      currentText,

                    mentions:
                      [
                        ...new Set(
                          currentMentions
                        )
                      ]
                  }
                );
              }


            } catch (
              messageError
            ) {

              console.log("");
              console.log(
                "❌ Individual Message Error:"
              );

              console.log(
                messageError?.message ||
                messageError
              );

              console.log("");
            }
          }

        } catch (error) {

          console.log("");
          console.log(
            "❌ Message Handler Error:"
          );

          console.log(
            error?.message ||
            error
          );

          console.log("");
        }
      }
    );


  } catch (error) {

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "❌ BOT START ERROR"
    );
    console.log(
      "=========================================="
    );

    console.log(
      error?.message ||
      error
    );

    console.log("");

    setTimeout(() => {

      console.log(
        "🔄 Restarting Bot..."
      );

      startBot();

    }, 5000);
  }
}


// ==================================================
// 🚀 START
// ==================================================

startBot();