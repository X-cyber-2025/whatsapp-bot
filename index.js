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

  // ------------------------------------------
  // 🌐 Main Page
  // ------------------------------------------

  if (req.url === "/" || req.url === "") {

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });

    res.end(
      "WhatsApp Bot is running!"
    );

    return;
  }


  // ------------------------------------------
  // ❤️ Health Check
  // ------------------------------------------

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


  // ------------------------------------------
  // 404
  // ------------------------------------------

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

⚠️ *গুরুত্বপূর্ণ সতর্কতা:*

যেকোনো Buy/Sell বা লেনদেনের ক্ষেত্রে অবশ্যই সতর্ক থাকুন।

⚠️ Buy/Sell ও লেনদেনের ক্ষেত্রে অবশ্যই Admin-এর মাধ্যমে ডিল করুন।
Admin-এর উপস্থিতি বা পরামর্শ ছাড়া কোনো লেনদেন করলে সম্পূর্ণ দায়ভার আপনার নিজের,আপনি যাচাই করার পরও কোনো Scam হলে তার দায়ভার Admin বা গ্রুপ কর্তৃপক্ষ বহন করবে না।

🔒তাই নিরাপদে লেনদেন করুন এবং সম্ভব হলে Admin-কে সঙ্গে রাখুন।

❤️ সবাই নিয়ম মেনে চলুন এবং সুন্দর পরিবেশ বজায় রাখুন।



ᴘɪʏᴀꜱ
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


// ==================================================
// 👤 SAVE CONTACTS
// ==================================================

function saveContacts(contacts) {

  for (const contact of contacts || []) {

    if (!contact?.id) {
      continue;
    }


    const name =
      contact.username ||
      contact.notify ||
      contact.name ||
      contact.verifiedName ||
      "";


    if (
      name &&
      name.trim()
    ) {

      const cleanName =
        name.trim();


      // ------------------------------------------
      // Main ID
      // ------------------------------------------

      contactNames.set(
        contact.id,
        cleanName
      );


      // ------------------------------------------
      // LID
      // ------------------------------------------

      if (contact.lid) {

        contactNames.set(
          contact.lid,
          cleanName
        );

      }


      // ------------------------------------------
      // Phone Number
      // ------------------------------------------

      if (contact.phoneNumber) {

        contactNames.set(
          contact.phoneNumber,
          cleanName
        );

      }

    }

  }

}


// ==================================================
// 👤 SAVE PUSH NAME
// ==================================================

function savePushName(
  id,
  pushName
) {

  if (
    !id ||
    !pushName
  ) {

    return;

  }


  const cleanName =
    String(pushName).trim();


  if (!cleanName) {
    return;
  }


  /*
   * আগে থেকে ভালো নাম থাকলে
   * সেটি overwrite করা হবে না।
   */

  if (
    !contactNames.has(id)
  ) {

    contactNames.set(
      id,
      cleanName
    );

  }

}


// ==================================================
// 👤 GET DISPLAY NAME
// ==================================================

function getDisplayName(participant) {

  if (!participant?.id) {

    return "Unknown Member";

  }


  const id =
    participant.id;


  // ------------------------------------------
  // 1️⃣ Cached Name
  // ------------------------------------------

  const cachedName =
    contactNames.get(id);


  if (
    cachedName &&
    String(cachedName).trim()
  ) {

    return String(
      cachedName
    ).trim();

  }


  // ------------------------------------------
  // 2️⃣ Username
  // ------------------------------------------

  const username =
    participant.username;


  if (
    username &&
    String(username).trim()
  ) {

    const cleanUsername =
      String(username).trim();


    contactNames.set(
      id,
      cleanUsername
    );


    return cleanUsername;

  }


  // ------------------------------------------
  // 3️⃣ Notify
  // ------------------------------------------

  const notify =
    participant.notify;


  if (
    notify &&
    String(notify).trim()
  ) {

    const cleanNotify =
      String(notify).trim();


    contactNames.set(
      id,
      cleanNotify
    );


    return cleanNotify;

  }


  // ------------------------------------------
  // 4️⃣ Saved Contact Name
  // ------------------------------------------

  const savedName =
    participant.name;


  if (
    savedName &&
    String(savedName).trim()
  ) {

    const cleanName =
      String(savedName).trim();


    contactNames.set(
      id,
      cleanName
    );


    return cleanName;

  }


  // ------------------------------------------
  // 5️⃣ Verified Name
  // ------------------------------------------

  const verifiedName =
    participant.verifiedName;


  if (
    verifiedName &&
    String(verifiedName).trim()
  ) {

    const cleanVerifiedName =
      String(verifiedName).trim();


    contactNames.set(
      id,
      cleanVerifiedName
    );


    return cleanVerifiedName;

  }


  // ------------------------------------------
  // 6️⃣ Phone Number
  // ------------------------------------------

  const phoneNumber =
    participant.phoneNumber;


  if (phoneNumber) {

    const number =
      String(phoneNumber)
        .replace(
          "@s.whatsapp.net",
          ""
        )
        .trim();


    if (
      number &&
      /^\+?\d+$/.test(number)
    ) {

      return number.startsWith("+")
        ? number
        : `+${number}`;

    }

  }


  // ------------------------------------------
  // 7️⃣ Normal WhatsApp JID
  // ------------------------------------------

  if (
    id.endsWith("@s.whatsapp.net")
  ) {

    const number =
      id
        .split("@")[0]
        .split(":")[0];


    if (
      number &&
      /^\d+$/.test(number)
    ) {

      return `+${number}`;

    }

  }


  // ------------------------------------------
  // 8️⃣ LID
  // ------------------------------------------

  /*
   * LID-এর সংখ্যা phone number নয়।
   * তাই LID-কে fake phone number হিসেবে
   * দেখানো হবে না।
   */

  if (
    id.endsWith("@lid")
  ) {

    return "Unknown Member";

  }


  return "Unknown Member";

}


// ==================================================
// 🔎 FIND MEMBER FROM GROUP METADATA
// ==================================================

function findParticipant(
  participants,
  participantId
) {

  if (
    !participantId
  ) {

    return null;

  }


  return (
    participants.find(
      (participant) =>
        participant?.id === participantId
    ) ||

    participants.find(
      (participant) =>
        participant?.lid === participantId
    ) ||

    participants.find(
      (participant) =>
        participant?.phoneNumber === participantId
    ) ||

    null
  );

}


// ==================================================
// 🧹 GET MESSAGE TEXT
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

function scheduleReconnect(
  delay = 5000
) {

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


  reconnectTimer =
    setTimeout(
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


  try {

    // ==================================================
    // 🔐 AUTH
    // ==================================================

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
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
        "👉 .env ফাইলে PHONE_NUMBER সেট করুন।"
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

    const sock =
      makeWASocket({

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


    currentSocket =
      sock;


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

        saveContacts(
          contacts
        );

      }
    );


    sock.ev.on(
      "contacts.update",
      (contacts) => {

        saveContacts(
          contacts
        );

      }
    );


    // ==================================================
    // 📱 PAIRING CODE
    // ==================================================

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

            pairingCodeRequested =
              false;


            console.log("");
            console.log(
              "❌ Pairing Code তৈরি করা যায়নি।"
            );

            console.log(
              "❌ Error:",
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
    // 🔄 CONNECTION UPDATE
    // ==================================================

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect
        } = update;


        // ------------------------------------------
        // 🟢 CONNECTING
        // ------------------------------------------

        if (
          connection === "connecting"
        ) {

          console.log(
            "🔄 WhatsApp connecting..."
          );

        }


        // ------------------------------------------
        // ✅ CONNECTED
        // ------------------------------------------

        if (
          connection === "open"
        ) {

          botStarting =
            false;


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


        // ------------------------------------------
        // ❌ CONNECTION CLOSED
        // ------------------------------------------

        if (
          connection === "close"
        ) {

          botStarting =
            false;


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


          // ----------------------------------------
          // 🚪 LOGGED OUT
          // ----------------------------------------

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


          // ----------------------------------------
          // 🔄 RECONNECT
          // ----------------------------------------

          console.log(
            "🔄 Connection বন্ধ হয়েছে।"
          );

          console.log(
            "🔄 Automatic Reconnect চালু হচ্ছে..."
          );


          scheduleReconnect(
            5000
          );

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
          // শুধু নতুন member যোগ হলে
          // ------------------------------------------

          if (
            update.action !== "add"
          ) {

            return;

          }


          const groupId =
            update.id;


          // ------------------------------------------
          // 🎯 GROUP RESTRICTION
          // ------------------------------------------

          if (
            GROUP_ID &&
            groupId !== GROUP_ID
          ) {

            return;

          }


          // ------------------------------------------
          // 🔄 Fresh Group Metadata
          // ------------------------------------------

          const metadata =
            await sock.groupMetadata(
              groupId
            );


          const groupName =
            metadata?.subject ||
            "আমাদের গ্রুপ";


          const participants =
            metadata?.participants ||
            [];


          // ------------------------------------------
          // 👥 Every New Member
          // ------------------------------------------

          for (
            const participantId
            of update.participants || []
          ) {

            try {

              // --------------------------------------
              // 🔍 Find full participant object
              // --------------------------------------

              const participant =
                findParticipant(
                  participants,
                  participantId
                );


              // --------------------------------------
              // 🆔 Actual WhatsApp ID
              // --------------------------------------

              const actualId =
                participant?.id ||
                participantId;


              // --------------------------------------
              // 👤 Find Member Name
              // --------------------------------------

              let memberName =
                participant
                  ? getDisplayName(
                      participant
                    )
                  : "Unknown Member";


              // --------------------------------------
              // 🔍 Cache fallback
              // --------------------------------------

              if (
                memberName ===
                "Unknown Member"
              ) {

                const cachedName =
                  contactNames.get(
                    participantId
                  );


                if (
                  cachedName &&
                  String(cachedName).trim()
                ) {

                  memberName =
                    String(
                      cachedName
                    ).trim();

                }

              }


              // --------------------------------------
              // 📱 Final fallback
              // --------------------------------------

              if (
                !memberName ||
                memberName ===
                "Unknown Member"
              ) {

                memberName =
                  "New Member";

              }


              // --------------------------------------
              // 💾 Save name
              // --------------------------------------

              if (
                memberName !==
                "New Member"
              ) {

                contactNames.set(
                  actualId,
                  memberName
                );

              }


              // --------------------------------------
              // 📌 Mention Text
              // --------------------------------------

              const mentionText =
                `@${memberName}`;


              // --------------------------------------
              // 📝 Create Welcome Message
              // --------------------------------------

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


              // --------------------------------------
              // 📤 Send Actual Mention
              // --------------------------------------

              await sock.sendMessage(
                groupId,
                {
                  text: message,

                  mentions: [
                    actualId
                  ]
                }
              );


              // --------------------------------------
              // 🖥️ Console
              // --------------------------------------

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
                `👥 Group: ${groupName}`
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

              // ----------------------------------------
              // Message Check
              // ----------------------------------------

              if (
                !msg?.message
              ) {

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
              // 👤 Sender ID
              // ----------------------------------------

              const senderId =
                msg.key?.participant ||
                msg.key?.remoteJid;


              // ----------------------------------------
              // 👤 Sender Push Name
              // ----------------------------------------

              const senderName =
                msg.pushName;


              if (
                senderId &&
                senderName
              ) {

                savePushName(
                  senderId,
                  senderName
                );

              }


              // ----------------------------------------
              // 👥 Group Check
              // ----------------------------------------

              if (
                !remoteJid ||
                !remoteJid.endsWith(
                  "@g.us"
                )
              ) {

                continue;

              }


              // ----------------------------------------
              // 🎯 GROUP RESTRICTION
              // ----------------------------------------

              if (
                GROUP_ID &&
                remoteJid !== GROUP_ID
              ) {

                continue;

              }


              // ----------------------------------------
              // 📝 Message Text
              // ----------------------------------------

              const messageText =
                getMessageText(
                  msg.message
                );


              if (!messageText) {

                continue;

              }


              // ----------------------------------------
              // 🧩 Command
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
              // 8️⃣ /USERS
              // ==================================================

              else if (
                command === "/users"
              ) {

                const metadata =
                  await sock.groupMetadata(
                    remoteJid
                  );


                const participants =
                  metadata?.participants || [];


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


                // ------------------------------------------
                // 👥 Create User List
                // ------------------------------------------

                const userList =
                  participants.map(
                    (participant, index) => {

                      const name =
                        getDisplayName(
                          participant
                        );


                      return {

                        number:
                          index + 1,

                        name:
                          `@${name}`,

                        id:
                          participant.id

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


                // ------------------------------------------
                // 📤 Send Members
                // ------------------------------------------

                for (
                  const user
                  of userList
                ) {

                  const line =
                    `${user.number}️⃣ ${user.name}\n`;


                  // ----------------------------------------
                  // Message length protection
                  // ----------------------------------------

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


                  if (
                    user.id
                  ) {

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

    botStarting =
      false;


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


    scheduleReconnect(
      5000
    );

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


    scheduleReconnect(
      5000
    );

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