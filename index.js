import "dotenv/config";

import http from "http";

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";


// ==================================================
// 🌐 RENDER SERVER
// ==================================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  if (req.url === "/" || req.url === "") {

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end(
      "WhatsApp Bot is running!"
    );

    return;
  }

  if (req.url === "/health") {

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });

    res.end(
      JSON.stringify({
        status: "ok",
        bot: "WhatsApp Bot",
        time: new Date().toISOString()
      })
    );

    return;
  }

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Not Found");

});


server.listen(PORT, () => {

  console.log(
    `🌐 Server running on port ${PORT}`
  );

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
// 🌐 OFFICIAL WEBSITE
// ==================================================

const WEBSITE_URL =
  "https://x-cyber-2025.github.io/X-cyber.web/";


// ==================================================
// 📜 GROUP RULES
// ==================================================

const RULES = `
📜 *গ্রুপের নিয়মাবলি*

1️⃣ সবাইকে সম্মান করে কথা বলুন।
2️⃣ অশ্লীল/আপত্তিকর মেসেজ দেওয়া যাবে না।
3️⃣ স্প্যাম বা অপ্রয়োজনীয় মেসেজ করবেন না।
4️⃣ অনুমতি ছাড়া কোনো লিংক/প্রচার করা যাবে না।
5️⃣ Account Buy/Sell করার সময় সতর্ক থাকুন।
6️⃣ Google Play Points সংক্রান্ত তথ্য গ্রুপে শেয়ার করা যাবে।
7️⃣ যেকোনো লেনদেন Admin-এর মাধ্যমে করার চেষ্টা করুন।
8️⃣ নিয়ম ভঙ্গ করলে Admin প্রয়োজনীয় ব্যবস্থা নিতে পারবেন।

❤️ সবাই নিয়ম মেনে গ্রুপে থাকুন।
`;


// ==================================================
// 🎉 WELCOME MESSAGE
// ==================================================

const WELCOME = `
🎉 স্বাগতম {member}! ❤️

🌟 আপনাকে আমাদের {group} গ্রুপে স্বাগতম।

👥 আপনি এখন আমাদের পরিবারের একজন সদস্য।
📌 গ্রুপের নিয়ম মেনে চলুন এবং সবার সাথে সুন্দর আচরণ করুন।

💰 Account Buy/Sell ও Google Play Points সংক্রান্ত আপডেট পেতে গ্রুপে থাকুন।

⚠️ *গুরুত্বপূর্ণ সতর্কতা:*

যেকোনো ডিল অবশ্যই গ্রুপের নির্ধারিত Admin-এর মাধ্যমে সম্পন্ন করবেন।

অন্য কারও সাথে সরাসরি লেনদেন করে প্রতারিত হলে তার দায়ভার Admin
বা গ্রুপ কর্তৃপক্ষ কোনোভাবেই বহন করবে না।

🌐 প্রয়োজন হলে আমাদের অফিসিয়াল ওয়েবসাইট ভিজিট করুন।
🔗 /website লিখে ওয়েবসাইটের লিংক নিন।

❤️ পাশে থাকার জন্য ধন্যবাদ।

❤️ *Piyas*
`;


// ==================================================
// 👤 CONTACT NAME CACHE
// ==================================================

const contactNames = new Map();


function saveContacts(contacts) {

  for (const contact of contacts || []) {

    if (!contact?.id) {
      continue;
    }

    const name =
      contact.notify ||
      contact.name ||
      contact.verifiedName ||
      "";

    if (name) {

      contactNames.set(
        contact.id,
        name
      );

    }

  }

}


// ==================================================
// 👤 GET DISPLAY NAME
// ==================================================

function getDisplayName(participant) {

  if (!participant?.id) {
    return "Unknown Member";
  }

  const name =
    contactNames.get(participant.id) ||
    participant.notify ||
    participant.name ||
    participant.verifiedName ||
    "";

  if (!name) {
    return "Unknown Member";
  }

  return name.trim();

}


// ==================================================
// 🧹 TEXT CLEANER
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
    ""
  ).trim();

}


// ==================================================
// 🔄 GLOBAL RECONNECT CONTROL
// ==================================================

let reconnectTimer = null;

let botStarting = false;

let currentSocket = null;


// ==================================================
// 🔄 SCHEDULE RECONNECT
// ==================================================

function scheduleReconnect(delay = 5000) {

  if (reconnectTimer) {

    console.log(
      "ℹ️ Reconnect already scheduled."
    );

    return;

  }

  console.log("");
  console.log(
    `🔄 ${delay / 1000} সেকেন্ড পর Reconnect করা হবে...`
  );
  console.log("");

  reconnectTimer = setTimeout(
    async () => {

      reconnectTimer = null;

      console.log("");
      console.log(
        "🔄 Reconnecting WhatsApp..."
      );
      console.log("");

      await startBot();

    },
    delay
  );

}


// ==================================================
// 🤖 START BOT
// ==================================================

async function startBot() {

  if (botStarting) {

    console.log(
      "ℹ️ Bot already starting. Duplicate start বন্ধ করা হয়েছে।"
    );

    return;

  }

  botStarting = true;

  console.log("");
  console.log("==========================================");
  console.log("🚀 WhatsApp Bot Starting...");
  console.log("==========================================");
  console.log("");

  try {

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(
      AUTH_FOLDER
    );


    // ==================================================
    // 🔍 CONFIG CHECK
    // ==================================================

    if (!PHONE_NUMBER) {

      console.log(
        "⚠️ PHONE_NUMBER Environment Variable পাওয়া যায়নি।"
      );

      console.log(
        "👉 SillyDev .env ফাইলে PHONE_NUMBER সেট করুন।"
      );

    }

    if (!GROUP_ID) {

      console.log(
        "⚠️ GROUP_ID Environment Variable পাওয়া যায়নি।"
      );

      console.log(
        "⚠️ নির্দিষ্ট Group restriction কাজ করবে না।"
      );

    } else {

      console.log(
        `🎯 Restricted Group: ${GROUP_ID}`
      );

    }


    // ==================================================
    // 📱 PAIRING CONTROL
    // ==================================================

    let pairingCodeRequested = false;


    // ==================================================
    // 🔌 CREATE SOCKET
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

      keepAliveIntervalMs: 25000,

      retryRequestDelayMs: 2000,

      markOnlineOnConnect: true

    });


    currentSocket = sock;


    // ==================================================
    // 💾 SAVE CREDENTIALS
    // ==================================================

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    // ==================================================
    // 👤 CONTACT UPDATE
    // ==================================================

    sock.ev.on(
      "contacts.upsert",
      (contacts) => {

        saveContacts(contacts);

      }
    );

    sock.ev.on(
      "contacts.update",
      (contacts) => {

        saveContacts(contacts);

      }
    );


    // ==================================================
    // 📱 PAIRING CODE
    // ==================================================

    if (
      !state.creds.registered &&
      PHONE_NUMBER
    ) {

      setTimeout(async () => {

        if (pairingCodeRequested) {
          return;
        }

        try {

          pairingCodeRequested = true;

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
            "📲 WhatsApp → Settings"
          );
          console.log(
            "➡️ Linked Devices"
          );
          console.log(
            "➡️ Link a device"
          );
          console.log(
            "➡️ Link with phone number instead"
          );
          console.log(
            `➡️ Pairing Code: ${formattedCode}`
          );
          console.log(
            "=========================================="
          );
          console.log("");

        } catch (error) {

          pairingCodeRequested = false;

          console.log("");
          console.log(
            "❌ Pairing Code তৈরি করা যায়নি।"
          );

          console.log(
            "❌ Error:",
            error?.message || error
          );

          console.log("");

        }

      }, 3000);

    }


    // ==================================================
    // 🔄 CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect
        } = update;


        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 WhatsApp connecting..."
          );

        }


        if (
          connection === "open"
        ) {

          botStarting = false;

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
              `🎯 Bot Group Restriction: ${GROUP_ID}`
            );

          }

          console.log(
            "🟢 Bot Status: ONLINE"
          );

          console.log("");

        }


        if (
          connection === "close"
        ) {

          botStarting = false;

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


          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "❌ WhatsApp Logout হয়েছে।"
            );

            console.log(
              "📱 আবার Pairing করতে হবে।"
            );

            return;

          }


          console.log(
            "🔄 Connection বন্ধ হয়েছে।"
          );

          console.log(
            "🔄 Automatic Reconnect চালু হচ্ছে..."
          );

          scheduleReconnect(5000);

        }

      }
    );


    // ==================================================
    // 👥 NEW GROUP MEMBER
    // ==================================================

    sock.ev.on(
      "group-participants.update",
      async (update) => {

        try {

          if (
            update.action !== "add"
          ) {

            return;

          }

          const groupId =
            update.id;

          if (
            GROUP_ID &&
            groupId !== GROUP_ID
          ) {

            return;

          }

          const metadata =
            await sock.groupMetadata(
              groupId
            );

          const groupName =
            metadata.subject;

          for (
            const participant
            of update.participants
          ) {

            try {

              const memberName =
                getDisplayName({
                  id: participant
                });

              const mentionText =
                memberName ===
                "Unknown Member"

                  ? "@New Member"

                  : `@${memberName}`;

              const message =
                WELCOME
                  .replace(
                    "{member}",
                    mentionText
                  )
                  .replace(
                    "{group}",
                    groupName
                  );

              await sock.sendMessage(
                groupId,
                {
                  text: message,

                  mentions: [
                    participant
                  ]
                }
              );

              console.log(
                `🎉 Welcome message sent to ${participant}`
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
            const msg
            of messages
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
                GROUP_ID &&
                remoteJid !== GROUP_ID
              ) {

                continue;

              }

              const messageText =
                getMessageText(
                  msg.message
                );

              if (!messageText) {

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
              // 1️⃣ /MENU
              // ==================================================

              if (
                command === "/menu"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `
🤖 *GROUP BOT MENU*

1️⃣ /menu — Bot Menu
2️⃣ /rules — গ্রুপের নিয়ম
3️⃣ /website — Official Website
4️⃣ /ping — Bot Status
5️⃣ /id — Group ID
6️⃣ /groupinfo — Group Information
7️⃣ /members — Member Count
8️⃣ /admins — Admin List
9️⃣ /users — সকল সদস্যের তালিকা

❤️ *Piyas*
`
                  }
                );

              }


              // ==================================================
              // 2️⃣ /RULES
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
              // 3️⃣ /WEBSITE
              // ==================================================

              else if (
                command === "/website"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `
🌐 *আমাদের অফিসিয়াল ওয়েবসাইট* 👇

🔗 ${WEBSITE_URL}

❤️ *Piyas*
`
                  }
                );

              }


              // ==================================================
              // 4️⃣ /PING
              // ==================================================

              else if (
                command === "/ping"
              ) {

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      "🏓 *Pong!*\n\n✅ Bot is online.\n🤖 Status: Active"
                  }
                );

              }


              // ==================================================
              // 5️⃣ /ID
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
              // 6️⃣ /GROUPINFO
              // ==================================================

              else if (
                command === "/groupinfo"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                await sock.sendMessage(
                  remoteJid,
                  {
                    text: `
ℹ️ *GROUP INFORMATION*

📌 নাম: ${metadata.subject}
👥 সদস্য: ${metadata.participants.length}
🆔 ID: ${remoteJid}
`
                  }
                );

              }


              // ==================================================
              // 7️⃣ /MEMBERS
              // ==================================================

              else if (
                command === "/members"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👥 *GROUP MEMBERS*\n\nএই গ্রুপে মোট *${metadata.participants.length} জন* সদস্য আছে।`
                  }
                );

              }


              // ==================================================
              // 8️⃣ /ADMINS
              // ==================================================

              else if (
                command === "/admins"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const adminParticipants =
                  metadata.participants.filter(
                    (p) =>
                      p.admin === "admin" ||
                      p.admin === "superadmin"
                  );

                if (
                  adminParticipants.length === 0
                ) {

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        "👑 কোনো Admin পাওয়া যায়নি।"
                    }
                  );

                  continue;

                }

                const admins =
                  adminParticipants.map(
                    (p, index) => {

                      const name =
                        getDisplayName(p);

                      return `${index + 1}️⃣ @${name}`;

                    }
                  );

                const mentions =
                  adminParticipants
                    .map(
                      (p) => p.id
                    )
                    .filter(Boolean);

                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👑 *GROUP ADMINS*\n\n${admins.join("\n")}\n\n❤️ *Piyas*`,

                    mentions
                  }
                );

              }


              // ==================================================
              // 9️⃣ /USERS
              // ==================================================

              else if (
                command === "/users"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );

                const participants =
                  metadata.participants ||
                  [];

                if (
                  participants.length === 0
                ) {

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        "👥 কোনো সদস্য পাওয়া যায়নি।"
                    }
                  );

                  continue;

                }

                const userList =
                  participants.map(
                    (p, index) => {

                      const name =
                        getDisplayName(p);

                      return {
                        number:
                          index + 1,

                        name:
                          `@${name}`,

                        id:
                          p.id
                      };

                    }
                  );

                const header = `
👥 *GROUP MEMBERS LIST*

📊 মোট সদস্য: *${participants.length} জন*

`;

                const footer = `

❤️ *Piyas*`;

                let currentMessage =
                  header;

                let currentMentions =
                  [];

                for (
                  const user
                  of userList
                ) {

                  const line =
                    `${user.number}️⃣ ${user.name}\n`;

                  if (
                    currentMessage.length +
                    line.length +
                    footer.length >
                    6000
                  ) {

                    await sock.sendMessage(
                      remoteJid,
                      {
                        text:
                          currentMessage,

                        mentions:
                          currentMentions
                      }
                    );

                    currentMessage =
                      header;

                    currentMentions =
                      [];

                  }

                  currentMessage +=
                    line;

                  if (user.id) {

                    currentMentions.push(
                      user.id
                    );

                  }

                }

                currentMessage +=
                  footer;

                if (
                  currentMessage.trim()
                ) {

                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        currentMessage,

                      mentions:
                        currentMentions
                    }
                  );

                }

              }

            } catch (messageError) {

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

    botStarting = false;

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

    scheduleReconnect(5000);

  }

}


// ==================================================
// 💥 GLOBAL ERROR HANDLING
// ==================================================

process.on(
  "uncaughtException",
  (error) => {

    console.log("");
    console.log(
      "❌ UNCAUGHT EXCEPTION"
    );

    console.log(
      error?.message ||
      error
    );

    console.log("");

    scheduleReconnect(5000);

  }
);


process.on(
  "unhandledRejection",
  (reason) => {

    console.log("");
    console.log(
      "❌ UNHANDLED PROMISE REJECTION"
    );

    console.log(
      reason?.message ||
      reason
    );

    console.log("");

  }
);


// ==================================================
// 🛑 RENDER / SERVER SHUTDOWN
// ==================================================

process.on(
  "SIGTERM",
  () => {

    console.log("");
    console.log(
      "🛑 SIGTERM received."
    );

    console.log(
      "🛑 Render server shutdown করছে..."
    );

    console.log("");

  }
);


process.on(
  "SIGINT",
  () => {

    console.log("");
    console.log(
      "🛑 SIGINT received."
    );

    console.log("");

  }
);


// ==================================================
// 🚀 START BOT
// ==================================================

startBot();