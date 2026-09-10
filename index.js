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
// 🤖 START BOT
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
    } = await useMultiFileAuthState(AUTH_FOLDER);


    // ==================================================
    // 🔍 BASIC CONFIG CHECK
    // ==================================================

    if (!PHONE_NUMBER) {

      console.log(
        "⚠️ PHONE_NUMBER Environment Variable পাওয়া যায়নি।"
      );

      console.log(
        "👉 Render → Environment → PHONE_NUMBER সেট করুন।"
      );

    }


    if (!GROUP_ID) {

      console.log(
        "⚠️ GROUP_ID Environment Variable পাওয়া যায়নি।"
      );

      console.log(
        "👉 Bot সব Group-এর command গ্রহণ করতে পারে।"
      );

      console.log(
        "🔐 নির্দিষ্ট Group restriction চাইলে GROUP_ID সেট করুন।"
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

    let reconnectTimer = null;


    // ==================================================
    // 🔌 CREATE SOCKET
    // ==================================================

    const sock = makeWASocket({

      auth: state,

      logger: P({
        level: "silent"
      }),

      printQRInTerminal: false,

      browser: Browsers.ubuntu("Chrome"),

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
            PHONE_NUMBER.replace(/\D/g, "");


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
              ?.join("-") || code;


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


        // ==================================================
        // ✅ CONNECTED
        // ==================================================

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

          if (GROUP_ID) {

            console.log(
              `🎯 Bot Group Restriction: ${GROUP_ID}`
            );

          }

          console.log("");

        }


        // ==================================================
        // ❌ CONNECTION CLOSED
        // ==================================================

        if (connection === "close") {

          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output?.statusCode;


          console.log("");
          console.log(
            "=========================================="
          );
          console.log(
            `⚠️ WhatsApp Connection Closed`
          );
          console.log(
            `⚠️ Status Code: ${statusCode}`
          );
          console.log(
            "=========================================="
          );


          // ------------------------------------------
          // 🚪 LOGGED OUT
          // ------------------------------------------

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


          // ------------------------------------------
          // 🔄 AUTO RECONNECT
          // ------------------------------------------

          if (!reconnectTimer) {

            console.log(
              "🔄 5 সেকেন্ড পর Reconnect করা হবে..."
            );


            reconnectTimer =
              setTimeout(() => {

                reconnectTimer = null;

                console.log(
                  "🔄 Reconnecting WhatsApp..."
                );

                startBot();

              }, 5000);

          }

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

          // ------------------------------------------
          // শুধু নতুন Member
          // ------------------------------------------

          if (
            update.action !== "add"
          ) {
            return;
          }


          const groupId =
            update.id;


          // ------------------------------------------
          // GROUP_ID RESTRICTION
          // ------------------------------------------

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
                participant.split("@")[0];


              const message =
                WELCOME
                  .replace(
                    "{member}",
                    `@${memberName}`
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
                error?.message || error
              );

            }

          }


        } catch (error) {

          console.log(
            "❌ Group Welcome Error:",
            error?.message || error
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

          // ------------------------------------------
          // একাধিক Message Process
          // ------------------------------------------

          for (
            const msg
            of messages
          ) {

            try {

              if (!msg?.message) {
                continue;
              }


              // ----------------------------------------
              // নিজের Message Ignore
              // ----------------------------------------

              if (
                msg.key?.fromMe
              ) {
                continue;
              }


              const remoteJid =
                msg.key?.remoteJid;


              // ----------------------------------------
              // Group ছাড়া অন্য কোথাও কাজ করবে না
              // ----------------------------------------

              if (
                !remoteJid ||
                !remoteJid.endsWith("@g.us")
              ) {
                continue;
              }


              // ----------------------------------------
              // নির্দিষ্ট Group Restriction
              // ----------------------------------------

              if (
                GROUP_ID &&
                remoteJid !== GROUP_ID
              ) {

                continue;
              }


              // ----------------------------------------
              // Message Text
              // ----------------------------------------

              const messageText =
                getMessageText(
                  msg.message
                );


              if (!messageText) {
                continue;
              }


              // ----------------------------------------
              // Command
              // ----------------------------------------

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
                        p.notify ||
                        p.name ||
                        p.id?.split("@")[0] ||
                        "Unknown";

                      return `${index + 1}️⃣ ${name}`;
                    }
                  );


                await sock.sendMessage(
                  remoteJid,
                  {
                    text:
                      `👑 *GROUP ADMINS*\n\n${admins.join("\n")}`
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
                  metadata.participants || [];


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
                        p.notify ||
                        p.name ||
                        p.id?.split("@")[0] ||
                        "Unknown";

                      return `${index + 1}️⃣ ${name}`;
                    }
                  );


                // ------------------------------------------
                // WhatsApp message খুব বড় হয়ে যাওয়া ঠেকানো
                // ------------------------------------------

                const header = `
👥 *GROUP MEMBERS LIST*

📊 মোট সদস্য: *${participants.length} জন*

`;


                const footer = `

❤️ *Piyas*`;


                let currentMessage =
                  header;


                for (
                  const user
                  of userList
                ) {

                  if (
                    (
                      currentMessage.length +
                      user.length +
                      footer.length +
                      2
                    ) > 6000
                  ) {

                    await sock.sendMessage(
                      remoteJid,
                      {
                        text:
                          currentMessage
                      }
                    );


                    currentMessage = "";
                  }


                  currentMessage +=
                    user + "\n";

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
                        currentMessage
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
            error?.message || error
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
      error?.message || error
    );
    console.log("");


    // ------------------------------------------
    // 🔄 Start Error হলে আবার চেষ্টা
    // ------------------------------------------

    setTimeout(() => {

      console.log(
        "🔄 Restarting Bot..."
      );

      startBot();

    }, 5000);

  }

}


// ==================================================
// 🚀 START BOT
// ==================================================

startBot();