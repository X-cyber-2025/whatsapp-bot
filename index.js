import http from "http";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";

// ==========================================
// 🌐 RENDER SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("WhatsApp Bot is running!");
}).listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});


// ==========================================
// ⚙️ BOT SETTINGS
// ==========================================

const PREFIX = "/";

const AUTH_FOLDER = "./auth_info";

// Render Environment Variable থেকে WhatsApp Number নেওয়া হবে
const PHONE_NUMBER = process.env.PHONE_NUMBER;


// ==========================================
// 📜 GROUP RULES
// ==========================================

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


// ==========================================
// 🎉 WELCOME MESSAGE
// ==========================================

const WELCOME = `
🎉 স্বাগতম {member}! ❤️

🌟 আপনাকে আমাদের {group} গ্রুপে স্বাগতম।

👥 আপনি এখন আমাদের পরিবারের একজন সদস্য।
📌 গ্রুপের নিয়ম মেনে চলুন এবং সবার সাথে সুন্দর আচরণ করুন।

💰 Account Buy/Sell ও Google Play Points সংক্রান্ত আপডেট পেতে গ্রুপে থাকুন।

⚠️ গুরুত্বপূর্ণ সতর্কতা:

যেকোনো ডিল অবশ্যই গ্রুপের নির্ধারিত Admin-এর মাধ্যমে সম্পন্ন করবেন।

অন্য কারও সাথে সরাসরি লেনদেন করে প্রতারিত হলে তার দায়ভার Admin
বা গ্রুপ কর্তৃপক্ষ কোনোভাবেই বহন করবে না।

🌐 প্রয়োজন হলে আমাদের ওয়েবসাইট ভিজিট করুন।
🔗 ওয়েবসাইটে যেতে গ্রুপের পিন করা মেসেজ চেক করুন।

❤️ পাশে থাকার জন্য ধন্যবাদ।
`;


// ==========================================
// 🤖 START BOT
// ==========================================

async function startBot() {

  try {

    console.log("🚀 WhatsApp Bot Starting...");


    // ======================================
    // 🔐 AUTHENTICATION
    // ======================================

    const {
      state,
      saveCreds
    } = await useMultiFileAuthState(AUTH_FOLDER);


    // ======================================
    // 📱 PAIRING CODE CONTROL
    // ======================================

    let pairingCodeRequested = false;


    // ======================================
    // 🔌 CREATE WHATSAPP SOCKET
    // ======================================

    const sock = makeWASocket({

      auth: state,

      // Terminal-এ QR দেখাবে না
      printQRInTerminal: false,

      // Silent logger
      logger: P({
        level: "silent"
      })

    });


    // ======================================
    // 💾 SAVE LOGIN INFORMATION
    // ======================================

    sock.ev.on("creds.update", saveCreds);


    // ======================================
    // 🔄 CONNECTION UPDATE
    // ======================================

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect,
          qr
        } = update;


        // ==================================
        // 📱 PHONE NUMBER PAIRING CODE
        // ==================================

        if (
          qr &&
          !state.creds.registered &&
          PHONE_NUMBER &&
          !pairingCodeRequested
        ) {

          pairingCodeRequested = true;

          try {

            // শুধু Number রাখা হবে
            // +8801712345678
            // অথবা
            // 8801712345678
            // দুটোই কাজ করবে

            const number =
              PHONE_NUMBER.replace(/\D/g, "");


            if (!number) {

              throw new Error(
                "PHONE_NUMBER সঠিকভাবে দেওয়া হয়নি।"
              );

            }


            console.log("");
            console.log("=================================");
            console.log("📱 WhatsApp Pairing Code তৈরি হচ্ছে...");
            console.log("=================================");


            // Pairing Code Request
            const code =
              await sock.requestPairingCode(number);


            // Code-কে ৪+৪ করে দেখানো হবে
            const formattedCode =
              code?.match(/.{1,4}/g)?.join("-") || code;


            console.log("");
            console.log("=================================");
            console.log("📱 WHATSAPP PAIRING CODE");
            console.log("=================================");
            console.log(`🔑 ${formattedCode}`);
            console.log(`🔑 Raw Code: ${code}`);
            console.log("=================================");
            console.log("");
            console.log(
              "📲 WhatsApp → Settings → Linked Devices"
            );
            console.log(
              "➡️ Link a device"
            );
            console.log(
              "➡️ Link with phone number instead"
            );
            console.log(
              "➡️ উপরের Code লিখুন"
            );
            console.log("");
            console.log("=================================");

          } catch (error) {

            console.log("");
            console.log("❌ Pairing Code Error:");
            console.log(error);
            console.log("");

            // পরবর্তী QR event এ আবার চেষ্টা করার সুযোগ
            pairingCodeRequested = false;

          }

        }


        // ==================================
        // ✅ WHATSAPP CONNECTED
        // ==================================

        if (connection === "open") {

          console.log("");
          console.log("=================================");
          console.log("✅ WhatsApp Bot Connected!");
          console.log("=================================");
          console.log("");

        }


        // ==================================
        // ❌ CONNECTION CLOSED
        // ==================================

        if (connection === "close") {

          const statusCode =
            new Boom(
              lastDisconnect?.error
            )?.output?.statusCode;


          console.log("");
          console.log(
            `⚠️ Connection Closed. Status: ${statusCode}`
          );


          // যদি WhatsApp থেকে Logout না করা হয়
          if (
            statusCode !== DisconnectReason.loggedOut
          ) {

            console.log(
              "🔄 আবার WhatsApp কানেক্ট করার চেষ্টা হচ্ছে..."
            );

            setTimeout(() => {
              startBot();
            }, 3000);

          } else {

            console.log(
              "❌ WhatsApp লগআউট হয়েছে।"
            );

            console.log(
              "📱 আবার Phone Number দিয়ে Pair করতে হবে।"
            );

          }

        }

      }
    );


    // ==========================================
    // 👥 GROUP PARTICIPANT UPDATE
    // ==========================================

    sock.ev.on(
      "group-participants.update",
      async (update) => {

        try {

          // শুধু নতুন Member হলে কাজ করবে
          if (update.action !== "add") {
            return;
          }


          const groupId = update.id;


          // Group Information
          const metadata =
            await sock.groupMetadata(groupId);


          const groupName =
            metadata.subject;


          // একাধিক Member Join করলে
          // সবাইকে Welcome Message পাঠাবে

          for (
            const participant of update.participants
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


            } catch (error) {

              console.log(
                "❌ Individual Welcome Error:",
                error
              );

            }

          }


        } catch (error) {

          console.log(
            "❌ Welcome Error:",
            error
          );

        }

      }
    );


    // ==========================================
    // 💬 MESSAGE HANDLER
    // ==========================================

    sock.ev.on(
      "messages.upsert",
      async ({ messages }) => {

        try {

          const msg = messages[0];


          // Message না থাকলে Stop
          if (!msg?.message) {
            return;
          }


          // Bot নিজের Message-এর Reply করবে না
          if (msg.key.fromMe) {
            return;
          }


          const remoteJid =
            msg.key.remoteJid;


          // ==================================
          // 👥 ONLY GROUP MESSAGE
          // ==================================

          if (
            !remoteJid ||
            !remoteJid.endsWith("@g.us")
          ) {
            return;
          }


          // ==================================
          // 📝 MESSAGE TEXT
          // ==================================

          const messageText =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";


          // ==================================
          // 🔎 COMMAND
          // ==================================

          const command =
            messageText
              .trim()
              .split(/\s+/)[0]
              .toLowerCase();


          // ==================================
          // 📋 /MENU
          // ==================================

          if (command === "/menu") {

            await sock.sendMessage(
              remoteJid,
              {
                text: `
🤖 *GROUP BOT MENU*

📜 /rules — গ্রুপের নিয়ম
🏓 /ping — Bot status
🆔 /id — Group ID
ℹ️ /groupinfo — Group information
👥 /members — Member count
👑 /admins — Admin list

❤️ Play Point League
`
              }
            );

          }


          // ==================================
          // 📜 /RULES
          // ==================================

          else if (command === "/rules") {

            await sock.sendMessage(
              remoteJid,
              {
                text: RULES
              }
            );

          }


          // ==================================
          // 🏓 /PING
          // ==================================

          else if (command === "/ping") {

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  "🏓 Pong!\n✅ Bot is online."
              }
            );

          }


          // ==================================
          // 🆔 /ID
          // ==================================

          else if (command === "/id") {

            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🆔 Group ID:\n${remoteJid}`
              }
            );

          }


          // ==================================
          // ℹ️ /GROUPINFO
          // ==================================

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


          // ==================================
          // 👥 /MEMBERS
          // ==================================

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
                  `👥 এই গ্রুপে মোট ${metadata.participants.length} জন সদস্য আছে।`
              }
            );

          }


          // ==================================
          // 👑 /ADMINS
          // ==================================

          else if (
            command === "/admins"
          ) {

            const metadata =
              await sock.groupMetadata(
                remoteJid
              );


            // Group Admin বের করা
            const adminParticipants =
              metadata.participants.filter(
                (p) =>
                  p.admin === "admin" ||
                  p.admin === "superadmin"
              );


            // Admin Mention তৈরি
            const admins =
              adminParticipants.map(
                (p) =>
                  `@${p.id.split("@")[0]}`
              );


            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `👑 *GROUP ADMINS*\n\n${admins.join("\n")}`,

                mentions:
                  adminParticipants.map(
                    (p) => p.id
                  )
              }
            );

          }

        } catch (error) {

          console.log(
            "❌ Command Error:",
            error
          );

        }

      }
    );


  } catch (error) {

    console.log("");
    console.log(
      "❌ Bot Start Error:"
    );
    console.log(error);
    console.log("");

    // Error হলে 5 সেকেন্ড পর আবার চেষ্টা
    setTimeout(() => {
      startBot();
    }, 5000);

  }

}


// ==========================================
// 🚀 START BOT
// ==========================================

startBot();