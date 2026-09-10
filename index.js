import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import P from "pino";

const PREFIX = "/";
const AUTH_FOLDER = "./auth_info";

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

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState(AUTH_FOLDER);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 WhatsApp থেকে স্ক্যান করার জন্য QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Bot Connected!");
    }

    if (connection === "close") {
      const statusCode =
        new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("🔄 আবার কানেক্ট হচ্ছে...");
        startBot();
      } else {
        console.log("❌ WhatsApp লগআউট হয়েছে।");
      }
    }
  });

  // নতুন সদস্য যোগ হলে Welcome Message
  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (update.action !== "add") return;

      const groupId = update.id;

      const metadata =
        await sock.groupMetadata(groupId);

      const groupName = metadata.subject;

      for (const participant of update.participants) {
        const memberName =
          participant.split("@")[0];

        const message = WELCOME
          .replace("{member}", `@${memberName}`)
          .replace("{group}", groupName);

        await sock.sendMessage(groupId, {
          text: message,
          mentions: [participant]
        });
      }
    } catch (error) {
      console.log("Welcome Error:", error);
    }
  });

  // Commands
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg.message) return;
      if (msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;

      // শুধু Group-এ কাজ করবে
      if (!remoteJid?.endsWith("@g.us")) return;

      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      const command = messageText
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();

      // /menu
      if (command === "/menu") {
        await sock.sendMessage(remoteJid, {
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
        });
      }

      // /rules
      else if (command === "/rules") {
        await sock.sendMessage(remoteJid, {
          text: RULES
        });
      }

      // /ping
      else if (command === "/ping") {
        await sock.sendMessage(remoteJid, {
          text: "🏓 Pong!\n✅ Bot is online."
        });
      }

      // /id
      else if (command === "/id") {
        await sock.sendMessage(remoteJid, {
          text: `🆔 Group ID:\n${remoteJid}`
        });
      }

      // /groupinfo
      else if (command === "/groupinfo") {
        const metadata =
          await sock.groupMetadata(remoteJid);

        await sock.sendMessage(remoteJid, {
          text: `
ℹ️ *GROUP INFORMATION*

📌 নাম: ${metadata.subject}
👥 সদস্য: ${metadata.participants.length}
🆔 ID: ${remoteJid}
`
        });
      }

      // /members
      else if (command === "/members") {
        const metadata =
          await sock.groupMetadata(remoteJid);

        await sock.sendMessage(remoteJid, {
          text:
            `👥 এই গ্রুপে মোট ${metadata.participants.length} জন সদস্য আছে।`
        });
      }

      // /admins
      else if (command === "/admins") {
        const metadata =
          await sock.groupMetadata(remoteJid);

        const admins = metadata.participants
          .filter(
            (p) =>
              p.admin === "admin" ||
              p.admin === "superadmin"
          )
          .map(
            (p) =>
              `@${p.id.split("@")[0]}`
          );

        await sock.sendMessage(remoteJid, {
          text:
            `👑 *GROUP ADMINS*\n\n${admins.join("\n")}`,
          mentions: metadata.participants
            .filter(
              (p) =>
                p.admin === "admin" ||
                p.admin === "superadmin"
            )
            .map((p) => p.id)
        });
      }
    } catch (error) {
      console.log("Command Error:", error);
    }
  });
}

startBot();
