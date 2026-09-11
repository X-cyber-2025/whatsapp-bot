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

const GROUP_IDS = (process.env.GROUP_ID || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer(
  (req, res) => {

    if (req.url === "/health") {

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
      });

      res.end(
        "WhatsApp Bot is running."
      );

      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end(
      "WhatsApp Bot is Online."
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

7️⃣ কারও ব্যক্তিগত তথ্য, ফোন নম্বর বা Screenshot অনুমতি ছাড়া শেয়ার করা যাবে না।

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
// PIYAS INFORMATION
// ======================================================

const PIYAS_INFO = `
👤 *PIYAS — PERSONAL INFORMATION*

📛 নাম:
মোঃ আল আমিন

📝 Name:
MD. AL AMIN

👨 পিতা:
মোঃ মোশারফ হোসেন

👩 মাতা:
মোসাম্মৎ রীপা বেগম

🎂 জন্মতারিখ:
০৯ জানুয়ারি ২০০৬

🩸 রক্তের গ্রুপ:
A+ (A Positive)

💍 বৈবাহিক অবস্থা:
Unmarried (অবিবাহিত)

🏠 ঠিকানা:
গ্রাম/রাস্তা: বলদার চর, নান্দাইল
ডাকঘর: হেমগঞ্জ বাজার - ২২৯০
নান্দাইল, ময়মনসিংহ

🆔 NID:
9172******24

❤️ *Piyas*
`;

// ======================================================
// MENU
// ======================================================

const MENU = `
🤖 *GROUP BOT MENU*

1️⃣ /menu অথবা /bot — Bot Menu
2️⃣ /rules — গ্রুপের নিয়ম
3️⃣ /website — Official Website
4️⃣ /ping — Bot Status
5️⃣ /id — Group ID
6️⃣ /groupinfo — Group Information
7️⃣ /members — Member Count
8️⃣ /admin — Admin List + Mention
9️⃣ /admins — Admin List + Mention
🔟 /piyas — Piyas Information

❤️ *Piyas*
`;

// ======================================================
// CONTACT NAME CACHE
// ======================================================

const contactNames = new Map();

// ======================================================
// CONTACT PHONE JID CACHE
// ======================================================

const contactPhoneJids = new Map();

// ======================================================
// CLEAN PHONE
// ======================================================

function cleanPhoneNumber(
  value
) {

  if (
    typeof value !== "string"
  ) {

    return null;

  }

  if (
    value.includes("@s.whatsapp.net")
  ) {

    return value;

  }

  const phone =
    value.replace(
      /[^0-9]/g,
      ""
    );

  if (
    phone.length < 8
  ) {

    return null;

  }

  return `${phone}@s.whatsapp.net`;

}

// ======================================================
// SAVE CONTACTS
// ======================================================

function saveContacts(
  contacts = []
) {

  if (
    !Array.isArray(contacts)
  ) {

    return;

  }

  for (
    const contact
    of contacts
  ) {

    try {

      if (
        !contact ||
        typeof contact !== "object"
      ) {

        continue;

      }

      const name =
        contact.username ||
        contact.notify ||
        contact.name ||
        contact.verifiedName ||
        contact.pushName ||
        null;

      const cleanName =
        typeof name === "string" &&
        name.trim()
          ? name.trim()
          : null;

      const phoneJid =
        cleanPhoneNumber(
          contact.phoneNumber
        ) ||
        (
          typeof contact.id === "string" &&
          contact.id.endsWith(
            "@s.whatsapp.net"
          )
            ? contact.id
            : null
        );

      const ids = [
        contact.id,
        contact.lid,
        contact.phoneNumber
      ];

      for (
        const id
        of ids
      ) {

        if (
          typeof id !== "string" ||
          !id.trim()
        ) {

          continue;

        }

        const cleanId =
          id.trim();

        if (cleanName) {

          contactNames.set(
            cleanId,
            cleanName
          );

        }

        if (phoneJid) {

          contactPhoneJids.set(
            cleanId,
            phoneJid
          );

        }

      }

    } catch (
      error
    ) {

      console.log(
        "⚠️ Contact Cache Error:",
        error?.message || error
      );

    }

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

  for (
    const id
    of possibleIds
  ) {

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

  const possibleNames = [
    participant.username,
    participant.notify,
    participant.name,
    participant.verifiedName,
    participant.pushName
  ];

  for (
    const name
    of possibleNames
  ) {

    if (
      typeof name === "string" &&
      name.trim()
    ) {

      return name.trim();

    }

  }

  const id =
    typeof participant.id === "string"
      ? participant.id
      : "";

  if (
    id.endsWith(
      "@s.whatsapp.net"
    )
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
// GET PHONE JID
// ======================================================

function getPhoneJid(
  participant
) {

  if (
    !participant ||
    typeof participant !== "object"
  ) {

    return null;

  }

  // ------------------------------------------
  // Direct phoneNumber
  // ------------------------------------------

  if (
    typeof participant.phoneNumber ===
      "string"
  ) {

    const direct =
      cleanPhoneNumber(
        participant.phoneNumber
      );

    if (direct) {

      return direct;

    }

  }

  // ------------------------------------------
  // Direct ID
  // ------------------------------------------

  if (
    typeof participant.id === "string" &&
    participant.id.endsWith(
      "@s.whatsapp.net"
    )
  ) {

    return participant.id;

  }

  // ------------------------------------------
  // LID -> Phone JID cache
  // ------------------------------------------

  const possibleIds = [
    participant.id,
    participant.lid
  ];

  for (
    const id
    of possibleIds
  ) {

    if (
      typeof id !== "string"
    ) {

      continue;

    }

    const cached =
      contactPhoneJids.get(id);

    if (
      typeof cached === "string" &&
      cached.endsWith(
        "@s.whatsapp.net"
      )
    ) {

      return cached;

    }

  }

  return null;

}

// ======================================================
// GET MENTION DATA
// ======================================================

function getMentionData(
  participant,
  participants = []
) {

  let person =
    participant;

  // ------------------------------------------
  // Try to find complete participant
  // ------------------------------------------

  if (
    typeof participant === "string"
  ) {

    person =
      findParticipant(
        participants,
        participant
      ) || {
        id: participant
      };

  }

  if (
    !person ||
    typeof person !== "object"
  ) {

    return {
      name: "Member",
      jid: null
    };

  }

  const name =
    getDisplayName(
      person
    );

  const jid =
    getPhoneJid(
      person
    );

  return {
    name:
      name === "Unknown Member"
        ? "Member"
        : name,
    jid
  };

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
    typeof message.conversation ===
    "string"
  ) {

    return message.conversation;

  }

  if (
    message.extendedTextMessage &&
    typeof message.extendedTextMessage.text ===
      "string"
  ) {

    return message.extendedTextMessage.text;

  }

  if (
    message.imageMessage &&
    typeof message.imageMessage.caption ===
      "string"
  ) {

    return message.imageMessage.caption;

  }

  if (
    message.videoMessage &&
    typeof message.videoMessage.caption ===
      "string"
  ) {

    return message.videoMessage.caption;

  }

  if (
    message.documentMessage &&
    typeof message.documentMessage.caption ===
      "string"
  ) {

    return message.documentMessage.caption;

  }

  return "";

}

// ======================================================
// GROUP CHECK
// ======================================================

function isAllowedGroup(
  groupId
) {

  if (
    GROUP_IDS.length === 0
  ) {

    return true;

  }

  return GROUP_IDS.includes(
    groupId
  );

}

// ======================================================
// RECONNECT CONTROL
// ======================================================

let reconnectTimer = null;

let botStarting = false;

let pairingTimer = null;

// ======================================================
// SCHEDULE RECONNECT
// ======================================================

function scheduleReconnect() {

  if (reconnectTimer) {

    return;

  }

  reconnectTimer =
    setTimeout(
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

  if (botStarting) {

    return;

  }

  botStarting = true;

  try {

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "🚀 WhatsApp Bot Starting..."
    );
    console.log(
      "=========================================="
    );
    console.log("");

    // ==================================================
    // AUTH
    // ==================================================

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        AUTH_FOLDER
      );

    // ==================================================
    // SOCKET
    // ==================================================

    const sock =
      makeWASocket({

        auth:
          state,

        logger:
          P({
            level: "info"
          }),

        printQRInTerminal:
          false,

        browser:
          Browsers.ubuntu(
            "Chrome"
          ),

        connectTimeoutMs:
          60000,

        keepAliveIntervalMs:
          25000,

        retryRequestDelayMs:
          2000,

        markOnlineOnConnect:
          true,

        syncFullHistory:
          false,

        shouldSyncHistoryMessage:
          () => false

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
    // PAIRING CODE
    // ==================================================

    if (
      !state.creds.registered &&
      PHONE_NUMBER
    ) {

      pairingTimer =
        setTimeout(
          async () => {

            try {

              const cleanNumber =
                PHONE_NUMBER.replace(
                  /[^0-9]/g,
                  ""
                );

              if (
                !cleanNumber
              ) {

                console.log(
                  "❌ Invalid PHONE_NUMBER"
                );

                return;

              }

              console.log("");
              console.log(
                "📱 WhatsApp number detected."
              );

              console.log(
                "🔐 Requesting pairing code..."
              );

              const code =
                await sock.requestPairingCode(
                  cleanNumber
                );

              const formattedCode =
                typeof code === "string"
                  ? (
                      code
                        .match(/.{1,4}/g)
                        ?.join("-") ||
                      code
                    )
                  : code;

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
                `🔑 Pairing Code: ${formattedCode}`
              );
              console.log(
                "=========================================="
              );
              console.log("");

              console.log(
                "📱 WhatsApp → Settings → Linked Devices"
              );

              console.log(
                "➡️ Link a Device"
              );

              console.log(
                "➡️ Link with phone number instead"
              );

              console.log("");

            } catch (
              error
            ) {

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

    } else if (
      state.creds.registered
    ) {

      console.log(
        "🔐 Existing WhatsApp session found."
      );

    } else {

      console.log(
        "⚠️ PHONE_NUMBER is not set."
      );

    }

    // ==================================================
    // CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      ({
        connection,
        lastDisconnect
      }) => {

        if (
          connection ===
          "connecting"
        ) {

          console.log(
            "🔄 WhatsApp connecting..."
          );

        }

        if (
          connection ===
          "open"
        ) {

          botStarting =
            false;

          if (pairingTimer) {

            clearTimeout(
              pairingTimer
            );

            pairingTimer =
              null;

          }

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
            `🎯 Allowed Groups: ${
              GROUP_IDS.length > 0
                ? GROUP_IDS.join(", ")
                : "ALL GROUPS"
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

        if (
          connection ===
          "close"
        ) {

          botStarting =
            false;

          if (pairingTimer) {

            clearTimeout(
              pairingTimer
            );

            pairingTimer =
              null;

          }

          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output
              ?.statusCode;

          const errorMessage =
            lastDisconnect?.error?.message ||
            "";

          console.log("");
          console.log(
            "=========================================="
          );
          console.log(
            "❌ WhatsApp Connection Closed"
          );
          console.log(
            "=========================================="
          );

          console.log(
            "Status Code:",
            statusCode
          );

          if (
            errorMessage
          ) {

            console.log(
              "Error:",
              errorMessage
            );

          }

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

          if (
            statusCode ===
            403
          ) {

            console.log(
              "🚫 WhatsApp rejected the connection."
            );

            return;

          }

          scheduleReconnect();

        }

      }
    );

    // ==================================================
    // NEW GROUP MEMBER
    // ==================================================

    sock.ev.on(
      "group-participants.update",
      async update => {

        try {

          if (
            update.action !==
            "add"
          ) {

            return;

          }

          const groupId =
            typeof update.id ===
            "string"
              ? update.id
              : "";

          if (!groupId) {

            return;

          }

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
            typeof metadata?.subject ===
            "string"
              ? metadata.subject
              : "আমাদের গ্রুপ";

          const participants =
            Array.isArray(
              metadata?.participants
            )
              ? metadata.participants
              : [];

          for (
            const rawParticipant
            of update.participants || []
          ) {

            try {

              const mentionData =
                getMentionData(
                  rawParticipant,
                  participants
                );

              const memberName =
                mentionData.name;

              const mentionJid =
                mentionData.jid;

              const welcomeMessage =
                WELCOME
                  .replace(
                    "{member}",
                    mentionJid
                      ? `@${memberName}`
                      : memberName
                  )
                  .replace(
                    "{group}",
                    String(groupName)
                  );

              if (
                mentionJid
              ) {

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
                `🎉 Welcome sent to ${memberName}`
              );

            } catch (
              error
            ) {

              console.log(
                "❌ Welcome Member Error:",
                error?.message ||
                error
              );

            }

          }

        } catch (
          error
        ) {

          console.log(
            "❌ Group Welcome Error:",
            error?.message ||
            error
          );

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
            const msg
            of messages || []
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
                typeof remoteJid !==
                  "string" ||
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

              const text =
                getMessageText(
                  msg.message
                ).trim();

              if (!text) {

                continue;

              }

              const command =
                text
                  .split(/\s+/)[0]
                  .toLowerCase();

              console.log(
                `📩 Command: ${command} | Group: ${remoteJid}`
              );

              // ==========================================
              // /MENU অথবা /BOT
              // ==========================================

              if (
                command === "/menu" ||
                command === "/bot"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      MENU
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
                    text:
                      RULES
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
                      `🆔 *GROUP ID*\n\n${remoteJid}`
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
                    Array.isArray(
                      metadata?.participants
                    )
                      ? metadata.participants
                      : [];

                  const admins =
                    participants.filter(
                      participant =>
                        participant?.admin === "admin" ||
                        participant?.admin === "superadmin" ||
                        participant?.admin === true
                    );

                  const subject =
                    typeof metadata?.subject ===
                    "string"
                      ? metadata.subject
                      : "Unknown Group";

                  const description =
                    typeof metadata?.desc ===
                    "string"
                      ? metadata.desc
                      : "No description";

                  const owner =
                    typeof metadata?.owner ===
                    "string"
                      ? metadata.owner
                      : "Unknown";

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
${description}
`;

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        info
                    }
                  );

                } catch (
                  error
                ) {

                  console.log(
                    "❌ GroupInfo Error:",
                    error?.message ||
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
                    Array.isArray(
                      metadata?.participants
                    )
                      ? metadata.participants.length
                      : 0;

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        `👥 *GROUP MEMBERS*\n\nমোট সদস্য: *${count} জন*`
                    }
                  );

                } catch (
                  error
                ) {

                  console.log(
                    "❌ Members Error:",
                    error?.message ||
                    error
                  );

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

              // ==========================================
              // /ADMIN অথবা /ADMINS
              // ==========================================

              if (
                command === "/admin" ||
                command === "/admins"
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

                  // ----------------------------------------
                  // ONLY GROUP ADMINS
                  // ----------------------------------------

                  const adminParticipants =
                    participants.filter(
                      participant =>
                        participant?.admin === "admin" ||
                        participant?.admin === "superadmin" ||
                        participant?.admin === true
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

                    continue;

                  }

                  let adminText =
                    "👑 *GROUP ADMINS*\n\n";

                  const mentions = [];

                  let number =
                    1;

                  // ----------------------------------------
                  // ADMIN LIST
                  // ----------------------------------------

                  for (
                    const admin
                    of adminParticipants
                  ) {

                    const mentionData =
                      getMentionData(
                        admin,
                        participants
                      );

                    let adminName =
                      mentionData.name;

                    const mentionJid =
                      mentionData.jid;

                    if (
                      !adminName ||
                      adminName ===
                        "Unknown Member"
                    ) {

                      adminName =
                        "Admin";

                    }

                    // --------------------------------------
                    // CLICKABLE MENTION
                    // --------------------------------------

                    if (
                      mentionJid
                    ) {

                      adminText +=
                        `${number}️⃣ @${adminName}`;

                      mentions.push(
                        mentionJid
                      );

                    } else {

                      // ------------------------------------
                      // Name পাওয়া গেছে কিন্তু JID পাওয়া যায়নি
                      // ------------------------------------

                      adminText +=
                        `${number}️⃣ ${adminName}`;

                    }

                    // --------------------------------------
                    // ADMIN ROLE
                    // --------------------------------------

                    if (
                      admin?.admin ===
                      "superadmin"
                    ) {

                      adminText +=
                        " ⭐ Group Owner";

                    } else {

                      adminText +=
                        " 👑 Admin";

                    }

                    adminText +=
                      "\n\n";

                    number++;

                  }

                  adminText +=
                    `👥 *মোট Admin: ${adminParticipants.length} জন*\n\n❤️ *Piyas*`;

                  // ----------------------------------------
                  // SEND ADMIN LIST
                  // ----------------------------------------

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        adminText,

                      mentions
                    }
                  );

                  console.log(
                    `👑 Admin list sent: ${adminParticipants.length} admins`
                  );

                } catch (
                  error
                ) {

                  console.log("");
                  console.log(
                    "❌ Admin List Error:"
                  );

                  console.log(
                    error?.message ||
                    error
                  );

                  if (
                    error?.stack
                  ) {

                    console.log(
                      error.stack
                    );

                  }

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

              // ==========================================
              // /PIYAS
              // ==========================================

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

                continue;

              }

              // ==========================================
              // UNKNOWN COMMAND
              // ==========================================

              // Unknown command হলে কোনো reply হবে না.

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

        } catch (
          error
        ) {

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
    // BOT STARTED
    // ==================================================

    console.log(
      "📡 WhatsApp connecting..."
    );

  } catch (
    error
  ) {

    botStarting =
      false;

    console.log("");
    console.log(
      "❌ START BOT ERROR:"
    );

    console.log(
      error?.message ||
      error
    );

    if (
      error?.stack
    ) {

      console.log(
        error.stack
      );

    }

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

    if (
      error?.stack
    ) {

      console.log(
        error.stack
      );

    }

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
      "Error:",
      error?.message ||
      error
    );

    if (
      error?.stack
    ) {

      console.log(
        error.stack
      );

    }

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