import "dotenv/config";

import http from "http";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 3000;

const AUTH_FOLDER = "./auth_info";

const PHONE_NUMBER =
  process.env.PHONE_NUMBER || "";

const GROUP_ID =
  process.env.GROUP_ID || "";

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("WhatsApp Bot is running.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("WhatsApp Bot is Online.");
});

server.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});

// ======================================================
// GROUP RULES
// ======================================================

const RULES = `
📜 *গ্রুপের নিয়মাবলি*

1️⃣ সবাইকে সম্মান করে কথা বলুন।

2️⃣ অশ্লীল, আপত্তিকর বা অসম্মানজনক মেসেজ দেওয়া যাবে না।

3️⃣ স্প্যাম বা একই মেসেজ বারবার পাঠানো যাবে না।

4️⃣ অনুমতি ছাড়া কোনো লিংক, বিজ্ঞাপন বা প্রচারণা করা যাবে না।

5️⃣ অন্য কোনো গ্রুপের Invite Link অপ্রয়োজনে শেয়ার করা যাবে না।

6️⃣ সন্দেহজনক Link, APK, File বা Website শেয়ার করা নিষেধ।

7️⃣ কারও ব্যক্তিগত তথ্য, ফোন নম্বর বা Screenshot অনুমতি ছাড়া শেয়ার করবেন না।

8️⃣ Fake Account, Scam বা প্রতারণামূলক কার্যক্রম সম্পূর্ণ নিষিদ্ধ।

9️⃣ Account Buy/Sell করার সময় অবশ্যই সতর্ক থাকুন।

🔟 Google Play Points সংক্রান্ত তথ্য ও আলোচনা গ্রুপে শেয়ার করা যাবে।

1️⃣1️⃣ যেকোনো লেনদেনের আগে Buyer/Seller-এর তথ্য ভালোভাবে যাচাই করুন।

1️⃣2️⃣ বড় ধরনের লেনদেনের ক্ষেত্রে Admin-এর পরামর্শ নেওয়া ভালো।

1️⃣3️⃣ লেনদেনের Screenshot ও প্রয়োজনীয় প্রমাণ সংরক্ষণ করুন।

1️⃣4️⃣ শুধু পরিচিত বা বিশ্বাসের ভিত্তিতে টাকা পাঠাবেন না।

1️⃣5️⃣ অপ্রয়োজনীয় Mention, Tag বা Group Call করা থেকে বিরত থাকুন।

1️⃣6️⃣ ধর্ম, রাজনীতি বা ব্যক্তিগত বিষয় নিয়ে ঝগড়া/বিতর্ক করা যাবে না।

1️⃣7️⃣ Admin-এর সিদ্ধান্ত নিয়ে গ্রুপে অপ্রয়োজনীয় বিশৃঙ্খলা সৃষ্টি করা যাবে না।

1️⃣8️⃣ কোনো সমস্যা, Scam বা সন্দেহজনক কার্যক্রম দেখলে Admin-কে জানান।

1️⃣9️⃣ Private Deal করলে সম্পূর্ণ নিজ দায়িত্বে করবেন।

2️⃣0️⃣ নিয়ম ভঙ্গ করলে Admin প্রয়োজন অনুযায়ী Warning, Message Delete বা Group থেকে Remove করতে পারবেন।

⚠️ *Buy/Sell ও লেনদেনের সতর্কতা:*

যেকোনো Buy/Sell বা লেনদেনের ক্ষেত্রে অবশ্যই Admin-এর মাধ্যমে ডিল করুন।

Admin-এর উপস্থিতি বা পরামর্শ ছাড়া কোনো লেনদেন করলে সম্পূর্ণ দায়ভার আপনার নিজের।

নিজে যাচাই করার পরেও কোনো Scam হলে তার দায়ভার Admin বা গ্রুপ কর্তৃপক্ষ বহন করবে না।

🔒 *তাই নিরাপদে লেনদেন করুন এবং সম্ভব হলে Admin-কে সঙ্গে রাখুন।*

❤️ সবাই নিয়ম মেনে চলুন এবং সুন্দর পরিবেশ বজায় রাখুন।

❤️ *Piyas*
`;

// ======================================================
// WELCOME MESSAGE
// ======================================================

const WELCOME = `
🎉 স্বাগতম {member}! ❤️

🌟 আপনাকে আমাদের {group} গ্রুপে স্বাগতম।

👥 আপনি এখন আমাদের পরিবারের একজন সদস্য।
📌 গ্রুপের নিয়ম মেনে চলুন এবং সবার সাথে সুন্দর আচরণ করুন।

💰 Account Buy/Sell ও Google Play Points সংক্রান্ত আপডেট পেতে গ্রুপে থাকুন।

⚠️ *গুরুত্বপূর্ণ সতর্কতা:*

যেকোনো Buy/Sell বা লেনদেনের ক্ষেত্রে অবশ্যই Admin-এর মাধ্যমে ডিল করুন।

Admin-এর উপস্থিতি বা পরামর্শ ছাড়া কোনো লেনদেন করলে সম্পূর্ণ দায়ভার আপনার নিজের।

নিজে যাচাই করার পরেও কোনো Scam হলে তার দায়ভার Admin বা গ্রুপ কর্তৃপক্ষ বহন করবে না।

🌐 প্রয়োজন হলে আমাদের অফিসিয়াল ওয়েবসাইট ভিজিট করুন।
🔗 /website লিখে ওয়েবসাইটের লিংক নিন।

❤️ পাশে থাকার জন্য ধন্যবাদ।

❤️ *Piyas*
`;

// ======================================================
// MENU
// ======================================================

const MENU = `
🤖 *GROUP BOT MENU*

1️⃣ /menu — Bot Menu
2️⃣ /rules — গ্রুপের নিয়ম
3️⃣ /website — Official Website
4️⃣ /ping — Bot Status
5️⃣ /id — Group ID
6️⃣ /groupinfo — Group Information
7️⃣ /members — Member Count

❤️ *Piyas*
`;

// ======================================================
// CONTACT CACHE
// ======================================================

const contactNames = new Map();

// ======================================================
// SAVE CONTACTS
// ======================================================

function saveContacts(contacts = []) {
  for (const contact of contacts) {
    try {
      if (!contact || typeof contact !== "object") {
        continue;
      }

      const id =
        typeof contact.id === "string"
          ? contact.id
          : null;

      if (!id) {
        continue;
      }

      const name =
        contact.username ||
        contact.notify ||
        contact.name ||
        contact.verifiedName ||
        contact.pushName ||
        null;

      if (
        typeof name === "string" &&
        name.trim()
      ) {
        contactNames.set(
          id,
          name.trim()
        );
      }

      // LID
      if (
        typeof contact.lid === "string" &&
        typeof name === "string" &&
        name.trim()
      ) {
        contactNames.set(
          contact.lid,
          name.trim()
        );
      }

      // Phone number
      if (
        typeof contact.phoneNumber === "string" &&
        typeof name === "string" &&
        name.trim()
      ) {
        contactNames.set(
          contact.phoneNumber,
          name.trim()
        );
      }

    } catch (error) {
      console.log(
        "⚠️ Contact Cache Error:",
        error?.message || error
      );
    }
  }
}

// ======================================================
// SAVE PUSH NAME
// ======================================================

function savePushName(
  id,
  pushName
) {
  if (
    typeof id !== "string" ||
    !id
  ) {
    return;
  }

  if (
    typeof pushName === "string" &&
    pushName.trim()
  ) {
    contactNames.set(
      id,
      pushName.trim()
    );
  }
}

// ======================================================
// GET DISPLAY NAME
// ======================================================

function getDisplayName(
  participant
) {
  if (
    !participant ||
    typeof participant !== "object"
  ) {
    return "Unknown Member";
  }

  const possibleIds = [
    participant.id,
    participant.lid,
    participant.phoneNumber
  ];

  // Cache check
  for (const id of possibleIds) {
    if (
      typeof id === "string" &&
      contactNames.has(id)
    ) {
      const cached =
        contactNames.get(id);

      if (
        typeof cached === "string" &&
        cached.trim()
      ) {
        return cached.trim();
      }
    }
  }

  // Direct names
  const possibleNames = [
    participant.username,
    participant.notify,
    participant.name,
    participant.verifiedName,
    participant.pushName
  ];

  for (const name of possibleNames) {
    if (
      typeof name === "string" &&
      name.trim()
    ) {
      return name.trim();
    }
  }

  // Phone JID
  const id =
    typeof participant.id === "string"
      ? participant.id
      : "";

  if (
    id.includes("@s.whatsapp.net")
  ) {
    return id
      .split("@")[0];
  }

  return "Unknown Member";
}

// ======================================================
// FIND PARTICIPANT
// ======================================================

function findParticipant(
  participants,
  participantId
) {
  if (
    !Array.isArray(participants) ||
    typeof participantId !== "string"
  ) {
    return null;
  }

  return (
    participants.find(
      participant =>
        participant?.id === participantId
    ) ||

    participants.find(
      participant =>
        participant?.lid === participantId
    ) ||

    participants.find(
      participant =>
        participant?.phoneNumber === participantId
    ) ||

    null
  );
}

// ======================================================
// GET MESSAGE TEXT
// ======================================================

function getMessageText(
  message
) {
  if (!message) {
    return "";
  }

  if (
    typeof message.conversation === "string"
  ) {
    return message.conversation;
  }

  if (
    message.extendedTextMessage &&
    typeof message.extendedTextMessage.text === "string"
  ) {
    return message.extendedTextMessage.text;
  }

  if (
    message.imageMessage &&
    typeof message.imageMessage.caption === "string"
  ) {
    return message.imageMessage.caption;
  }

  if (
    message.videoMessage &&
    typeof message.videoMessage.caption === "string"
  ) {
    return message.videoMessage.caption;
  }

  if (
    message.documentMessage &&
    typeof message.documentMessage.caption === "string"
  ) {
    return message.documentMessage.caption;
  }

  return "";
}

// ======================================================
// RECONNECT CONTROL
// ======================================================

let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(
    () => {
      reconnectTimer = null;

      console.log(
        "🔄 Restarting WhatsApp Bot..."
      );

      startBot();
    },
    5000
  );
}

// ======================================================
// START BOT
// ======================================================

async function startBot() {
  try {
    console.log("");
    console.log("==========================================");
    console.log("🚀 WhatsApp Bot Starting...");
    console.log("==========================================");

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      AUTH_FOLDER
    );

    const sock = makeWASocket({
      auth: state,

      logger: P({
        level: "silent"
      }),

      printQRInTerminal: false,

      browser:
        Browsers.ubuntu("Chrome"),

      connectTimeoutMs: 60000,

      keepAliveIntervalMs: 25000,

      retryRequestDelayMs: 2000,

      markOnlineOnConnect: true
    });

    // ==================================================
    // SAVE CREDENTIALS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );

    // ==================================================
    // CONTACT EVENTS
    // ==================================================

    sock.ev.on(
      "contacts.upsert",
      contacts => {
        saveContacts(contacts);
      }
    );

    sock.ev.on(
      "contacts.update",
      contacts => {
        saveContacts(contacts);
      }
    );

    // ==================================================
    // MESSAGE PUSH NAME
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      ({ messages }) => {
        try {
          for (const message of messages || []) {
            const sender =
              message?.key?.participant ||
              message?.key?.remoteJid;

            const pushName =
              message?.pushName;

            if (
              typeof sender === "string" &&
              typeof pushName === "string"
            ) {
              savePushName(
                sender,
                pushName
              );
            }
          }
        } catch (error) {
          console.log(
            "⚠️ Push Name Error:",
            error?.message || error
          );
        }
      }
    );

    // ==================================================
    // PAIRING CODE
    // ==================================================

    if (
      !sock.authState?.creds?.registered &&
      PHONE_NUMBER
    ) {
      setTimeout(
        async () => {
          try {
            const cleanNumber =
              PHONE_NUMBER.replace(
                /[^0-9]/g,
                ""
              );

            if (!cleanNumber) {
              console.log(
                "❌ Invalid PHONE_NUMBER"
              );

              return;
            }

            const code =
              await sock.requestPairingCode(
                cleanNumber
              );

            console.log("");
            console.log(
              "=========================================="
            );
            console.log(
              "🔐 WHATSAPP PAIRING CODE"
            );
            console.log(
              "=========================================="
            );
            console.log(
              `📱 Number: ${cleanNumber}`
            );
            console.log(
              `🔑 Pairing Code: ${code}`
            );
            console.log(
              "=========================================="
            );
            console.log("");
          } catch (error) {
            console.log("");
            console.log(
              "❌ Pairing Code Error:"
            );
            console.log(
              error?.message || error
            );
            console.log("");
          }
        },
        3000
      );
    }

    // ==================================================
    // CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async ({
        connection,
        lastDisconnect
      }) => {

        if (connection === "connecting") {
          console.log(
            "🔄 WhatsApp connecting..."
          );
        }

        if (connection === "open") {
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

          console.log(
            `🎯 Bot Group Restriction: ${
              GROUP_ID || "ALL GROUPS"
            }`
          );

          console.log(
            "🟢 Bot Status: ONLINE"
          );

          console.log(
            "=========================================="
          );
          console.log("");
        }

        if (connection === "close") {
          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output?.statusCode;

          console.log("");
          console.log(
            "❌ WhatsApp Connection Closed"
          );

          console.log(
            "Status Code:",
            statusCode
          );

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {
            console.log(
              "🚪 WhatsApp Logged Out."
            );

            console.log(
              "⚠️ Delete auth_info and pair again."
            );

            return;
          }

          console.log(
            "🔄 Reconnecting in 5 seconds..."
          );

          scheduleReconnect();
        }
      }
    );

    // ==================================================
    // NEW MEMBER WELCOME
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
            typeof update.id === "string"
              ? update.id
              : "";

          if (!groupId) {
            return;
          }

          // Group restriction
          if (
            GROUP_ID &&
            groupId !== GROUP_ID
          ) {
            return;
          }

          // Get fresh group metadata
          const metadata =
            await sock.groupMetadata(
              groupId
            );

          const groupName =
            typeof metadata?.subject === "string"
              ? metadata.subject
              : "আমাদের গ্রুপ";

          const participants =
            Array.isArray(
              metadata?.participants
            )
              ? metadata.participants
              : [];

          // Loop new members
          for (
            const participantData
            of update.participants || []
          ) {
            try {

              // =========================================
              // GET PARTICIPANT ID SAFELY
              // =========================================

              let participantId =
                participantData;

              // Baileys may provide an object
              if (
                typeof participantData === "object" &&
                participantData !== null
              ) {
                participantId =
                  participantData.id ||
                  participantData.lid ||
                  participantData.phoneNumber ||
                  participantData.jid ||
                  null;
              }

              // Must be string
              if (
                typeof participantId !== "string" ||
                !participantId
              ) {
                console.log(
                  "⚠️ Invalid participant ID:",
                  participantData
                );

                continue;
              }

              // =========================================
              // FIND FULL PARTICIPANT
              // =========================================

              const participant =
                findParticipant(
                  participants,
                  participantId
                );

              // =========================================
              // ACTUAL ID
              // =========================================

              let actualId =
                participant?.id ||
                participant?.phoneNumber ||
                participant?.lid ||
                participantId;

              if (
                typeof actualId !== "string" ||
                !actualId
              ) {
                console.log(
                  "⚠️ Invalid actualId:",
                  actualId
                );

                continue;
              }

              // =========================================
              // GET MEMBER NAME
              // =========================================

              let memberName =
                participant
                  ? getDisplayName(
                      participant
                    )
                  : "Unknown Member";

              // Check cache
              if (
                !memberName ||
                memberName ===
                  "Unknown Member"
              ) {
                const cachedName =
                  contactNames.get(
                    actualId
                  ) ||
                  contactNames.get(
                    participantId
                  );

                if (
                  typeof cachedName === "string" &&
                  cachedName.trim()
                ) {
                  memberName =
                    cachedName.trim();
                }
              }

              // Final fallback
              if (
                !memberName ||
                memberName ===
                  "Unknown Member"
              ) {
                memberName =
                  "New Member";
              }

              // Force string
              memberName =
                String(memberName);

              actualId =
                String(actualId);

              const safeGroupName =
                String(groupName);

              // Save name
              if (
                memberName !==
                "New Member"
              ) {
                contactNames.set(
                  actualId,
                  memberName
                );
              }

              // =========================================
              // CREATE WELCOME MESSAGE
              // =========================================

              const mentionText =
                `@${memberName}`;

              const message =
                String(
                  WELCOME
                    .replace(
                      "{member}",
                      mentionText
                    )
                    .replace(
                      "{group}",
                      safeGroupName
                    )
                );

              // =========================================
              // SEND WELCOME + REAL MENTION
              // =========================================

              await sock.sendMessage(
                groupId,
                {
                  text: message,

                  mentions: [
                    actualId
                  ]
                }
              );

              console.log("");
              console.log(
                "=========================================="
              );
              console.log(
                "🎉 NEW MEMBER JOINED"
              );
              console.log(
                `👤 Name: ${memberName}`
              );
              console.log(
                `🆔 ID: ${actualId}`
              );
              console.log(
                `👥 Group: ${safeGroupName}`
              );
              console.log(
                `📢 Mention: @${memberName}`
              );
              console.log(
                "✅ Welcome message sent."
              );
              console.log(
                "=========================================="
              );
              console.log("");

            } catch (memberError) {
              console.log("");
              console.log(
                "❌ Individual Welcome Error:"
              );

              console.log(
                memberError?.message ||
                memberError
              );

              console.log("");
            }
          }

        } catch (error) {
          console.log("");
          console.log(
            "❌ Group Welcome Error:"
          );

          console.log(
            error?.message ||
            error
          );

          console.log("");
        }
      }
    );

    // ==================================================
    // MESSAGE HANDLER
    // ==================================================

    sock.ev.on(
      "messages.upsert",
      async ({
        messages
      }) => {

        try {

          for (
            const msg of messages || []
          ) {

            // Ignore invalid message
            if (!msg?.message) {
              continue;
            }

            // Ignore own messages
            if (
              msg.key?.fromMe
            ) {
              continue;
            }

            const remoteJid =
              msg.key?.remoteJid;

            // Only group messages
            if (
              typeof remoteJid !== "string" ||
              !remoteJid.endsWith(
                "@g.us"
              )
            ) {
              continue;
            }

            // Group restriction
            if (
              GROUP_ID &&
              remoteJid !== GROUP_ID
            ) {
              continue;
            }

            const text =
              getMessageText(
                msg.message
              ).trim();

            if (!text) {
              continue;
            }

            // ==========================================
            // COMMAND
            // ==========================================

            const command =
              text
                .split(/\s+/)[0]
                .toLowerCase();

            // ==========================================
            // /MENU
            // ==========================================

            if (
              command === "/menu"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text: MENU
                }
              );

              continue;
            }

            // ==========================================
            // /RULES
            // ==========================================

            if (
              command === "/rules"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text: RULES
                }
              );

              continue;
            }

            // ==========================================
            // /WEBSITE
            // ==========================================

            if (
              command === "/website"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🌐 *Official Website*\n\n${WEBSITE_URL}`
                }
              );

              continue;
            }

            // ==========================================
            // /PING
            // ==========================================

            if (
              command === "/ping"
            ) {
              const start =
                Date.now();

              const sent =
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
                    `🏓 *PONG!*\n\n🟢 Bot Status: ONLINE\n⚡ Response: ${ping}ms\n🤖 WhatsApp Bot is working perfectly.`
                },
                {
                  quoted: sent
                }
              );

              continue;
            }

            // ==========================================
            // /ID
            // ==========================================

            if (
              command === "/id"
            ) {
              await sock.sendMessage(
                remoteJid,
                {
                  text:
                    `🆔 *Group ID*\n\n\`${remoteJid}\``
                }
              );

              continue;
            }

            // ==========================================
            // /GROUPINFO
            // ==========================================

            if (
              command === "/groupinfo"
            ) {

              try {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata?.participants ||
                  [];

                const admins =
                  participants.filter(
                    participant =>
                      participant?.admin
                  );

                const owner =
                  metadata?.owner ||
                  "Unknown";

                const subject =
                  metadata?.subject ||
                  "Unknown Group";

                const desc =
                  metadata?.desc ||
                  "No description";

                const info = `
👥 *GROUP INFORMATION*

📛 Name:
${subject}

👤 Members:
${participants.length}

👑 Admins:
${admins.length}

🆔 Group ID:
${remoteJid}

📌 Owner:
${owner}

📝 Description:
${desc}
`;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: info
                  }
                );

              } catch (error) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Group information পাওয়া যায়নি।"
                  }
                );

                console.log(
                  "❌ GroupInfo Error:",
                  error?.message ||
                    error
                );
              }

              continue;
            }

            // ==========================================
            // /MEMBERS
            // ==========================================

            if (
              command === "/members"
            ) {

              try {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const count =
                  metadata?.participants
                    ?.length || 0;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👥 *Group Members*\n\nমোট সদস্য: *${count} জন*`
                  }
                );

              } catch (error) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Member count পাওয়া যায়নি।"
                  }
                );

                console.log(
                  "❌ Members Error:",
                  error?.message ||
                    error
                );
              }

              continue;
            }

            // ==========================================
            // /USERS
            // ==========================================

            if (
              command === "/users"
            ) {

              try {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata?.participants ||
                  [];

                if (
                  participants.length === 0
                ) {
                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        "❌ কোনো সদস্য পাওয়া যায়নি।"
                    }
                  );

                  continue;
                }

                let userList =
                  "👥 *GROUP MEMBERS*\n\n";

                const mentions = [];

                let number = 1;

                for (
                  const participant
                  of participants
                ) {

                  let id =
                    participant?.id;

                  if (
                    typeof id !== "string"
                  ) {
                    continue;
                  }

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

                  name =
                    String(name);

                  userList +=
                    `${number}️⃣ @${name}\n`;

                  mentions.push(id);

                  number++;
                }

                userList +=
                  `\n👥 Total: ${mentions.length}`;

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: userList,
                    mentions
                  }
                );

              } catch (error) {

                console.log(
                  "❌ Users Error:",
                  error?.message ||
                    error
                );

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "❌ Member list পাওয়া যায়নি।"
                  }
                );
              }

              continue;
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

    // ==================================================
    // BOT READY
    // ==================================================

    console.log(
      "📡 WhatsApp connecting..."
    );

  } catch (error) {

    console.log("");
    console.log(
      "❌ START BOT ERROR:"
    );

    console.log(
      error?.message ||
      error
    );

    console.log(
      "🔄 Retrying in 5 seconds..."
    );

    scheduleReconnect();
  }
}

// ======================================================
// GLOBAL ERROR HANDLERS
// ======================================================

process.on(
  "uncaughtException",
  error => {
    console.log("");
    console.log(
      "❌ Uncaught Exception:"
    );

    console.log(
      error?.message ||
      error
    );

    console.log("");
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.log("");
    console.log(
      "❌ Unhandled Rejection:"
    );

    console.log(
      error?.message ||
      error
    );

    console.log("");
  }
);

// ======================================================
// SHUTDOWN
// ======================================================

process.on(
  "SIGINT",
  () => {
    console.log(
      "🛑 Bot shutting down..."
    );

    process.exit(0);
  }
);

process.on(
  "SIGTERM",
  () => {
    console.log(
      "🛑 Bot shutting down..."
    );

    process.exit(0);
  }
);

// ======================================================
// START
// ======================================================

startBot();