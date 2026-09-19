import "dotenv/config";
import http from "http";
import fs from "fs";

import makeWASocket, {
    Browsers,
    DisconnectReason,
    useMultiFileAuthState,
    generateWAMessageFromContent,
    proto
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";

/* =========================================================
   CONFIG
========================================================= */

const BOT_NAME = "আর-রাইয়ান";

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER = String(
    process.env.PHONE_NUMBER || ""
).replace(/[^0-9]/g, "");

const WEBSITE_URL =
    "https://x-cyber-2025.github.io/X-cyber.web/";

const BACKUP_GROUP_URL =
    "https://chat.whatsapp.com/KsIJqeOdSTVC2FBIuWCvlN?s=cl&p=a&mlu=4&ilr=4";

const AUTH_DIR = "./auth_info";

const BOT_STATUS_FILE = "./bot_status.json";
const WARNING_FILE = "./warnings.json";
const LOCK_FILE = "./ar_raiyan_locks.json";

const MAX_LOCK_TIME =
    24 * 60 * 60 * 1000;

/* =========================================================
   BOT STATE
========================================================= */

let sock = null;
let reconnecting = false;
let pairingRequested = false;

let botStatus = {};
let warnings = {};
let groupLocks = {};

const lockTimers = new Map();

const contactNames = new Map();
const contactPhoneJids = new Map();
const lidToPhoneJid = new Map();

const spamTracker = new Map();

const SPAM_WINDOW =
    60 * 1000;

/* =========================================================
   LOGGER
========================================================= */

const logger = P({
    level: "silent"
});

/* =========================================================
   MODERATION
========================================================= */

const MODERATION_DEFAULTS = {
    badWords: true,
    links: true,
    spam: true,
    warnings: true
};

const BAD_WORDS = [
    "সালা",
    "শালা",
    "সালি",
    "সালী",
    "শালি",
    "খানকি",
    "খানকী",
    "খাংকি",
    "খাংকী",
    "মাগি",
    "মাগী",
    "বেশ্যা",
    "চোদা",
    "চোদন",
    "চুদ",
    "চুদা",
    "চুদাচুদি",
    "হারামি",
    "হারামী",
    "হারামজাদা",
    "হারামজাদী",
    "কুত্তা",
    "কুত্তার",
    "শুয়োর",
    "শুয়োর",
    "বাঞ্চোদ",
    "বাল",
    "ফাক",
    "fuck",
    "fucking",
    "fucker",
    "motherfucker",
    "bitch",
    "bastard",
    "asshole",
    "dick",
    "pussy",
    "porn"
];

/* =========================================================
   COMMANDS
========================================================= */

const COMMAND_DEFINITIONS = [
    {
        key: "menu",
        command: "/menu"
    },
    {
        key: "bot",
        command: "/bot"
    },
    {
        key: "rules",
        command: "/rules"
    },
    {
        key: "admin",
        command: "/admin"
    },
    {
        key: "members",
        command: "/members"
    },
    {
        key: "groupinfo",
        command: "/groupinfo"
    },
    {
        key: "id",
        command: "/id"
    },
    {
        key: "ping",
        command: "/ping"
    },
    {
        key: "deal",
        command: "/deal"
    },
    {
        key: "piyas",
        command: "/piyas"
    },
    {
        key: "website",
        command: "/website"
    }
];

const COMMAND_ALIASES = {
    "ডিল": "deal"
};

const ADMIN_ONLY_COMMANDS = [
    "adminpanel",
    "cmdlist",
    "on",
    "off",
    "boton",
    "botoff",
    "mod",
    "moderation",
    "modstatus",
    "modon",
    "modoff"
];

/* =========================================================
   FILE HELPERS
========================================================= */

function readJsonFile(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const data = JSON.parse(
            fs.readFileSync(file, "utf8")
        );

        return data || fallback;
    } catch {
        return fallback;
    }
}

function writeJsonFile(file, data) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.log(
            `File save error: ${file}`,
            error?.message
        );
    }
}

/* =========================================================
   LOAD / SAVE
========================================================= */

function loadAllData() {
    botStatus = readJsonFile(
        BOT_STATUS_FILE,
        {}
    );

    warnings = readJsonFile(
        WARNING_FILE,
        {}
    );

    groupLocks = readJsonFile(
        LOCK_FILE,
        {}
    );

    console.log("📂 Bot data loaded.");
}

function saveBotStatus() {
    writeJsonFile(
        BOT_STATUS_FILE,
        botStatus
    );
}

function saveWarnings() {
    writeJsonFile(
        WARNING_FILE,
        warnings
    );
}

function saveGroupLocks() {
    writeJsonFile(
        LOCK_FILE,
        groupLocks
    );
}

/* =========================================================
   GROUP STATUS
========================================================= */

function getGroupStatus(groupId) {
    if (!botStatus[groupId]) {
        botStatus[groupId] = {
            enabled: true,
            disabledCommands: [],
            moderation: {
                ...MODERATION_DEFAULTS
            }
        };
    }

    if (
        !Array.isArray(
            botStatus[groupId].disabledCommands
        )
    ) {
        botStatus[groupId].disabledCommands = [];
    }

    if (
        !botStatus[groupId].moderation ||
        typeof botStatus[groupId].moderation !==
            "object"
    ) {
        botStatus[groupId].moderation = {
            ...MODERATION_DEFAULTS
        };
    }

    for (
        const [key, value] of Object.entries(
            MODERATION_DEFAULTS
        )
    ) {
        if (
            typeof botStatus[groupId]
                .moderation[key] !==
            "boolean"
        ) {
            botStatus[groupId].moderation[key] =
                value;
        }
    }

    return botStatus[groupId];
}

function isBotEnabled(groupId) {
    return (
        getGroupStatus(groupId).enabled !==
        false
    );
}

function setBotEnabled(groupId, value) {
    getGroupStatus(groupId).enabled =
        Boolean(value);

    saveBotStatus();
}

/* =========================================================
   COMMAND HELPERS
========================================================= */

function normalizeText(text) {
    return String(text || "")
        .normalize("NFC")
        .replace(
            /[\u200B-\u200D\uFEFF]/g,
            ""
        )
        .trim();
}

function normalizeCommandName(command) {
    return normalizeText(command)
        .toLowerCase()
        .replace(/^\/+/, "");
}

function canonicalCommand(command) {
    const commandName =
        normalizeCommandName(command);

    return (
        COMMAND_ALIASES[commandName] ||
        commandName
    );
}

function isKnownCommand(command) {
    const name =
        canonicalCommand(command);

    return COMMAND_DEFINITIONS.some(
        item => item.key === name
    );
}

function isCommandEnabled(groupId, command) {
    const name =
        canonicalCommand(command);

    return !getGroupStatus(
        groupId
    ).disabledCommands.includes(name);
}

function setCommandEnabled(
    groupId,
    command,
    enabled
) {
    const name =
        canonicalCommand(command);

    if (!isKnownCommand(name)) {
        return false;
    }

    const list =
        getGroupStatus(
            groupId
        ).disabledCommands;

    const index =
        list.indexOf(name);

    if (enabled) {
        if (index !== -1) {
            list.splice(index, 1);
        }
    } else {
        if (index === -1) {
            list.push(name);
        }
    }

    saveBotStatus();

    return true;
}

/* =========================================================
   BANGLA NUMBER
========================================================= */

function banglaDigitsToEnglish(text) {
    const digits = "০১২৩৪৫৬৭৮৯";

    return String(text || "").replace(
        /[০-৯]/g,
        digit => String(
            digits.indexOf(digit)
        )
    );
}

/* =========================================================
   BANGLA NUMBER WORDS
========================================================= */

const BANGLA_NUMBER_WORDS = {
    "শূন্য": 0,
    "এক": 1,
    "দুই": 2,
    "দু": 2,
    "তিন": 3,
    "চার": 4,
    "পাঁচ": 5,
    "ছয়": 6,
    "ছয়": 6,
    "সাত": 7,
    "আট": 8,
    "নয়": 9,
    "নয়": 9,
    "দশ": 10,
    "এগারো": 11,
    "বারো": 12,
    "তেরো": 13,
    "চৌদ্দ": 14,
    "পনেরো": 15,
    "ষোল": 16,
    "সতেরো": 17,
    "আঠারো": 18,
    "উনিশ": 19,
    "বিশ": 20,
    "একুশ": 21,
    "বাইশ": 22,
    "তেইশ": 23,
    "চব্বিশ": 24
};

function replaceBanglaNumberWords(text) {
    let result = String(text || "");

    const words =
        Object.keys(
            BANGLA_NUMBER_WORDS
        ).sort(
            (a, b) =>
                b.length - a.length
        );

    for (const word of words) {
        result = result.replace(
            new RegExp(
                `(^|\\s)${word}(?=\\s|$)`,
                "gi"
            ),
            match => {
                const prefix =
                    match.startsWith(" ")
                        ? " "
                        : "";

                return (
                    prefix +
                    BANGLA_NUMBER_WORDS[word]
                );
            }
        );
    }

    return result;
}

/* =========================================================
   LOCK COMMAND NORMALIZER
========================================================= */

function normalizeLockCommand(text) {
    let value =
        normalizeText(text);

    value =
        value
            .replace(
                /রাইয়ান/g,
                "রাইয়ান"
            )
            .replace(
                /আর\s*-\s*রাইয়ান/g,
                "আর-রাইয়ান"
            )
            .replace(
                /আর\s*–\s*রাইয়ান/g,
                "আর-রাইয়ান"
            )
            .replace(
                /আর\s*—\s*রাইয়ান/g,
                "আর-রাইয়ান"
            );

    return value;
}

/* =========================================================
   LOCK COMMAND DETECTION
========================================================= */

function isRaiyanCommand(text) {
    const value =
        normalizeLockCommand(text);

    return /^\/আর-রাইয়ান(?:\s|$)/i.test(
        value
    );
}

/* =========================================================
   DURATION PARSER
========================================================= */

function parseLockDuration(text) {
    let value =
        normalizeLockCommand(text);

    value =
        banglaDigitsToEnglish(value);

    value =
        replaceBanglaNumberWords(value);

    value =
        value.toLowerCase();

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    const hourMatch =
        value.match(
            /(\d+)\s*(?:ঘণ্টা|ঘন্টা|ঘণ্টার|ঘন্টার|hour|hours|hr|hrs)\b/i
        );

    const minuteMatch =
        value.match(
            /(\d+)\s*(?:মিনিট|মিনিটের|minute|minutes|min|mins)\b/i
        );

    const secondMatch =
        value.match(
            /(\d+)\s*(?:সেকেন্ড|সেকেন্ডের|second|seconds|sec|secs)\b/i
        );

    if (hourMatch) {
        hours =
            Number(hourMatch[1]);
    }

    if (minuteMatch) {
        minutes =
            Number(minuteMatch[1]);
    }

    if (secondMatch) {
        seconds =
            Number(secondMatch[1]);
    }

    const totalMs =
        hours * 60 * 60 * 1000 +
        minutes * 60 * 1000 +
        seconds * 1000;

    if (
        !Number.isFinite(totalMs) ||
        totalMs <= 0
    ) {
        return null;
    }

    let display = "";

    if (hours > 0) {
        display +=
            `${hours} ঘণ্টা`;
    }

    if (
        hours > 0 &&
        minutes > 0
    ) {
        display += " ";
    }

    if (minutes > 0) {
        display +=
            `${minutes} মিনিট`;
    }

    if (
        seconds > 0 &&
        (
            minutes > 0 ||
            hours === 0
        )
    ) {
        if (display) {
            display += " ";
        }

        display +=
            `${seconds} সেকেন্ড`;
    }

    return {
        ms: totalMs,
        display
    };
}

/* =========================================================
   LOCK TIME FORMAT
========================================================= */

function formatRemaining(ms) {
    const totalSeconds =
        Math.ceil(
            Math.max(0, ms) / 1000
        );

    const hours =
        Math.floor(
            totalSeconds / 3600
        );

    const minutes =
        Math.floor(
            (totalSeconds % 3600) /
                60
        );

    const seconds =
        totalSeconds % 60;

    const parts = [];

    if (hours > 0) {
        parts.push(
            `${hours} ঘণ্টা`
        );
    }

    if (minutes > 0) {
        parts.push(
            `${minutes} মিনিট`
        );
    }

    if (
        seconds > 0 &&
        hours === 0
    ) {
        parts.push(
            `${seconds} সেকেন্ড`
        );
    }

    return (
        parts.join(" ") ||
        "কয়েক সেকেন্ড"
    );
}

/* =========================================================
   LOCK TIMER
========================================================= */

function clearLockTimer(groupId) {
    const timer =
        lockTimers.get(groupId);

    if (timer) {
        clearTimeout(timer);
    }

    lockTimers.delete(groupId);
}

/* =========================================================
   OPEN GROUP
========================================================= */

async function openGroup(
    groupId,
    sendMessage = true
) {
    try {
        if (!sock) {
            return false;
        }

        clearLockTimer(groupId);

        await sock.groupSettingUpdate(
            groupId,
            "not_announcement"
        );

        delete groupLocks[groupId];

        saveGroupLocks();

        if (sendMessage) {
            await sock.sendMessage(
                groupId,
                {
                    text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🔓 *${BOT_NAME}*
╰━━━━━━━━━━━━━━━━━━━━╯

✅ নির্ধারিত সময় শেষ হয়েছে।

💬 এখন থেকে Group-এর
সকল Member আবার
Message দিতে পারবেন।

🤍 *${BOT_NAME}*
`
                }
            );
        }

        console.log(
            `🔓 GROUP OPENED: ${groupId}`
        );

        return true;
    } catch (error) {
        console.log(
            "❌ Group open error:",
            error?.message
        );

        return false;
    }
}

/* =========================================================
   SCHEDULE GROUP OPEN
========================================================= */

function scheduleGroupOpen(
    groupId,
    expiresAt
) {
    clearLockTimer(groupId);

    const remaining =
        Number(expiresAt) -
        Date.now();

    if (remaining <= 0) {
        openGroup(
            groupId,
            true
        );

        return;
    }

    const delay =
        Math.min(
            remaining,
            2147483647
        );

    const timer =
        setTimeout(
            async () => {
                const current =
                    groupLocks[groupId];

                if (!current) {
                    return;
                }

                if (
                    Number(
                        current.expiresAt
                    ) !==
                    Number(expiresAt)
                ) {
                    return;
                }

                const left =
                    Number(expiresAt) -
                    Date.now();

                if (left > 0) {
                    scheduleGroupOpen(
                        groupId,
                        expiresAt
                    );

                    return;
                }

                await openGroup(
                    groupId,
                    true
                );
            },
            delay
        );

    lockTimers.set(
        groupId,
        timer
    );

    console.log(
        `⏰ ${BOT_NAME} timer: ${groupId} | ${formatRemaining(remaining)}`
    );
}

/* =========================================================
   RESTORE LOCKS AFTER SERVER RESTART
========================================================= */

function restoreGroupLocks() {
    for (
        const [
            groupId,
            lock
        ] of Object.entries(
            groupLocks
        )
    ) {
        if (
            !lock ||
            !lock.expiresAt
        ) {
            delete groupLocks[groupId];
            continue;
        }

        scheduleGroupOpen(
            groupId,
            Number(
                lock.expiresAt
            )
        );
    }

    saveGroupLocks();
}

/* =========================================================
   LOCK GROUP
========================================================= */

async function lockGroup(
    groupId,
    duration
) {
    try {
        if (!sock) {
            return false;
        }

        const botAdmin =
            await isBotAdminInGroup(
                groupId
            );

        if (!botAdmin) {
            await sock.sendMessage(
                groupId,
                {
                    text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       ⚠️ *${BOT_NAME}*
╰━━━━━━━━━━━━━━━━━━━━╯

❌ Group বন্ধ করা সম্ভব হয়নি।

কারণ Bot-এর WhatsApp Number
এই Group-এর Admin নয়।

👑 প্রথমে Bot-কে Group Admin করুন।
`
                }
            );

            return false;
        }

        clearLockTimer(groupId);

        const expiresAt =
            Date.now() +
            duration.ms;

        await sock.groupSettingUpdate(
            groupId,
            "announcement"
        );

        groupLocks[groupId] = {
            expiresAt,
            durationMs:
                duration.ms,
            durationText:
                duration.display,
            lockedAt:
                Date.now()
        };

        saveGroupLocks();

        scheduleGroupOpen(
            groupId,
            expiresAt
        );

        await sock.sendMessage(
            groupId,
            {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🔒 *${BOT_NAME}*
      *GROUP CLOSED*
╰━━━━━━━━━━━━━━━━━━━━╯

🔒 Group সাময়িকভাবে বন্ধ করা হয়েছে।

⏳ *সময়:* ${duration.display}

👥 সাধারণ Member এই সময়ে
Message পাঠাতে পারবেন না।

👑 Group Adminরা Message
পাঠাতে পারবেন।

⏰ সময় শেষ হলে Group
স্বয়ংক্রিয়ভাবে আবার
চালু হয়ে যাবে।

🤍 *${BOT_NAME}*
`
            }
        );

        console.log(
            `🔒 GROUP CLOSED: ${groupId}`
        );

        return true;
    } catch (error) {
        console.log(
            "❌ Group lock error:",
            error?.message
        );

        return false;
    }
}

/* =========================================================
   RAIYAN COMMAND
========================================================= */

async function handleRaiyanCommand(
    groupId,
    message,
    text
) {
    if (!isRaiyanCommand(text)) {
        return false;
    }

    if (
        !groupId ||
        !groupId.endsWith("@g.us")
    ) {
        return true;
    }

    const admin =
        await isSenderAdmin(
            groupId,
            message
        );

    if (!admin) {
        await sock.sendMessage(
            groupId,
            {
                text: `
⚠️ *${BOT_NAME}*

এই Command শুধুমাত্র
Group Admin ব্যবহার করতে পারবেন।
`
            }
        );

        return true;
    }

    const normalized =
        normalizeLockCommand(text);

    const parts =
        normalized.split(/\s+/);

    parts.shift();

    const instruction =
        parts.join(" ").trim();

    /* =========================================
       NO ARGUMENT
    ========================================= */

    if (!instruction) {
        const lock =
            groupLocks[groupId];

        if (
            lock &&
            lock.expiresAt
        ) {
            const remaining =
                Number(
                    lock.expiresAt
                ) -
                Date.now();

            if (remaining > 0) {
                await sock.sendMessage(
                    groupId,
                    {
                        text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🔒 *${BOT_NAME}*
╰━━━━━━━━━━━━━━━━━━━━╯

🔒 Group বর্তমানে CLOSED।

⏳ *বাকি সময়:*
${formatRemaining(
    remaining
)}

📌 সময় শেষ হলে
স্বয়ংক্রিয়ভাবে খুলে যাবে।
`
                    }
                );

                return true;
            }
        }

        await sock.sendMessage(
            groupId,
            {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤖 *${BOT_NAME}*
╰━━━━━━━━━━━━━━━━━━━━╯

📌 Group বন্ধ করতে লিখুন:

/আর-রাইয়ান ১ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ২ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান এক মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ১ ঘন্টার জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ২ ঘন্টা ৩০ মিনিটের জন্য গ্রুপ বন্ধ

👑 শুধুমাত্র Group Admin
এই Command ব্যবহার করতে পারবেন।
`
            }
        );

        return true;
    }

    const closeRequested =
        /গ্রুপ\s*বন্ধ/i.test(
            instruction
        ) ||
        /group\s*(?:close|closed|lock)/i.test(
            instruction
        );

    if (!closeRequested) {
        await sock.sendMessage(
            groupId,
            {
                text: `
⚠️ *${BOT_NAME}*

Command বুঝতে পারিনি।

📌 উদাহরণ:

/আর-রাইয়ান ১ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ২ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান এক মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ১ ঘন্টার জন্য গ্রুপ বন্ধ
`
            }
        );

        return true;
    }

    const duration =
        parseLockDuration(
            instruction
        );

    if (!duration) {
        await sock.sendMessage(
            groupId,
            {
                text: `
⚠️ *${BOT_NAME}*

সময় বুঝতে পারিনি।

📌 সঠিক উদাহরণ:

/আর-রাইয়ান ১ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ২ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান এক মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ১ ঘন্টা ৩০ মিনিটের জন্য গ্রুপ বন্ধ
`
            }
        );

        return true;
    }

    if (
        duration.ms >
        MAX_LOCK_TIME
    ) {
        await sock.sendMessage(
            groupId,
            {
                text: `
⚠️ *${BOT_NAME}*

❌ সর্বোচ্চ ২৪ ঘণ্টার জন্য
Group বন্ধ রাখা যাবে।
`
            }
        );

        return true;
    }

    await lockGroup(
        groupId,
        duration
    );

    return true;
}

/* =========================================================
   JID HELPERS
========================================================= */

function isPhoneJid(jid) {
    return (
        typeof jid === "string" &&
        jid.endsWith(
            "@s.whatsapp.net"
        )
    );
}

function isLidJid(jid) {
    return (
        typeof jid === "string" &&
        jid.endsWith("@lid")
    );
}

function phoneToJid(phone) {
    if (!phone) {
        return null;
    }

    const number =
        String(phone)
            .replace(
                /@s.whatsapp.net/g,
                ""
            )
            .replace(
                /[^0-9]/g,
                ""
            );

    if (number.length < 8) {
        return null;
    }

    return (
        number +
        "@s.whatsapp.net"
    );
}

/* =========================================================
   CONTACTS
========================================================= */

function cleanName(name) {
    if (!name) {
        return null;
    }

    const value =
        String(name)
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    return value
        ? value.slice(0, 80)
        : null;
}

function saveContacts(
    contacts = []
) {
    for (
        const contact of contacts
    ) {
        if (!contact) {
            continue;
        }

        const id =
            contact.id;

        const lid =
            contact.lid;

        let phoneJid =
            null;

        if (
            contact.phoneNumber
        ) {
            phoneJid =
                isPhoneJid(
                    contact.phoneNumber
                )
                    ? contact.phoneNumber
                    : phoneToJid(
                        contact.phoneNumber
                    );
        }

        if (
            !phoneJid &&
            isPhoneJid(id)
        ) {
            phoneJid = id;
        }

        const name =
            cleanName(
                contact.name ||
                contact.notify ||
                contact.verifiedName ||
                contact.pushName ||
                contact.username
            );

        if (name) {
            if (id) {
                contactNames.set(
                    id,
                    name
                );
            }

            if (lid) {
                contactNames.set(
                    lid,
                    name
                );
            }

            if (phoneJid) {
                contactNames.set(
                    phoneJid,
                    name
                );
            }
        }

        if (
            phoneJid &&
            id &&
            isLidJid(id)
        ) {
            lidToPhoneJid.set(
                id,
                phoneJid
            );
        }

        if (
            phoneJid &&
            lid
        ) {
            lidToPhoneJid.set(
                lid,
                phoneJid
            );
        }
    }
}

/* =========================================================
   PARTICIPANT CACHE
========================================================= */

async function cacheParticipants(
    participants = []
) {
    for (
        const participant of
            participants
    ) {
        if (!participant) {
            continue;
        }

        const name =
            cleanName(
                participant.name ||
                participant.notify ||
                participant.pushName ||
                participant.username
            );

        const id =
            participant.id;

        const lid =
            participant.lid;

        const phoneNumber =
            participant.phoneNumber;

        let phoneJid =
            null;

        if (
            phoneNumber
        ) {
            phoneJid =
                isPhoneJid(
                    phoneNumber
                )
                    ? phoneNumber
                    : phoneToJid(
                        phoneNumber
                    );
        }

        if (
            !phoneJid &&
            isPhoneJid(id)
        ) {
            phoneJid = id;
        }

        if (name) {
            if (id) {
                contactNames.set(
                    id,
                    name
                );
            }

            if (lid) {
                contactNames.set(
                    lid,
                    name
                );
            }

            if (phoneJid) {
                contactNames.set(
                    phoneJid,
                    name
                );
            }
        }

        if (
            phoneJid &&
            id &&
            isLidJid(id)
        ) {
            lidToPhoneJid.set(
                id,
                phoneJid
            );
        }

        if (
            phoneJid &&
            lid
        ) {
            lidToPhoneJid.set(
                lid,
                phoneJid
            );
        }
    }
}

/* =========================================================
   RESOLVE LID
========================================================= */

async function resolveLid(
    lid
) {
    if (!lid) {
        return null;
    }

    if (isPhoneJid(lid)) {
        return lid;
    }

    const cached =
        lidToPhoneJid.get(lid);

    if (cached) {
        return cached;
    }

    try {
        const mapping =
            sock?.signalRepository
                ?.lidMapping;

        if (
            mapping &&
            typeof mapping.getPNForLID ===
                "function"
        ) {
            const pn =
                await mapping.getPNForLID(
                    lid
                );

            const phoneJid =
                isPhoneJid(pn)
                    ? pn
                    : phoneToJid(pn);

            if (phoneJid) {
                lidToPhoneJid.set(
                    lid,
                    phoneJid
                );

                return phoneJid;
            }
        }
    } catch {}

    return null;
}

/* =========================================================
   PARTICIPANT PHONE
========================================================= */

async function getPhoneJid(
    participant = {}
) {
    if (
        participant.phoneNumber
    ) {
        const jid =
            isPhoneJid(
                participant.phoneNumber
            )
                ? participant.phoneNumber
                : phoneToJid(
                    participant.phoneNumber
                );

        if (jid) {
            return jid;
        }
    }

    if (
        isPhoneJid(
            participant.id
        )
    ) {
        return participant.id;
    }

    if (
        participant.id
    ) {
        const resolved =
            await resolveLid(
                participant.id
            );

        if (resolved) {
            return resolved;
        }
    }

    if (
        participant.lid
    ) {
        const resolved =
            await resolveLid(
                participant.lid
            );

        if (resolved) {
            return resolved;
        }
    }

    return null;
}

/* =========================================================
   ADMIN HELPERS
========================================================= */

function isAdminParticipant(
    participant
) {
    return (
        participant?.admin ===
            "admin" ||
        participant?.admin ===
            "superadmin" ||
        participant?.admin === true ||
        participant?.isAdmin === true ||
        participant?.isSuperAdmin === true
    );
}

function findParticipant(
    participants,
    jid
) {
    return (
        participants.find(
            p =>
                p?.id === jid ||
                p?.lid === jid ||
                p?.phoneNumber === jid
        ) || null
    );
}

/* =========================================================
   BOT PHONE
========================================================= */

function getBotPhoneJid() {
    const ownId =
        sock?.user?.id;

    if (isPhoneJid(ownId)) {
        return ownId.split(":")[0];
    }

    if (isLidJid(ownId)) {
        const mapped =
            lidToPhoneJid.get(
                ownId
            );

        if (mapped) {
            return mapped;
        }
    }

    if (PHONE_NUMBER) {
        return phoneToJid(
            PHONE_NUMBER
        );
    }

    return null;
}

/* =========================================================
   BOT ADMIN CHECK
========================================================= */

async function isBotAdminInGroup(
    groupId
) {
    try {
        const metadata =
            await sock.groupMetadata(
                groupId
            );

        const participants =
            metadata?.participants ||
            [];

        await cacheParticipants(
            participants
        );

        const botId =
            sock?.user?.id;

        const botPhone =
            getBotPhoneJid();

        let participant =
            findParticipant(
                participants,
                botId
            );

        if (
            !participant &&
            botPhone
        ) {
            participant =
                findParticipant(
                    participants,
                    botPhone
                );
        }

        if (!participant) {
            const botNumber =
                String(
                    botPhone || ""
                )
                    .split("@")[0]
                    .replace(
                        /[^0-9]/g,
                        ""
                    );

            participant =
                participants.find(
                    p => {
                        const number =
                            String(
                                p?.phoneNumber ||
                                ""
                            )
                                .replace(
                                    /@s.whatsapp.net/g,
                                    ""
                                )
                                .replace(
                                    /[^0-9]/g,
                                    ""
                                );

                        return (
                            number &&
                            number ===
                                botNumber
                        );
                    }
                );
        }

        return isAdminParticipant(
            participant
        );
    } catch (error) {
        console.log(
            "Bot admin check error:",
            error?.message
        );

        return false;
    }
}

/* =========================================================
   SENDER ADMIN CHECK
========================================================= */

async function isSenderAdmin(
    groupId,
    message
) {
    try {
        const sender =
            message?.key?.participant;

        if (!sender) {
            return false;
        }

        const metadata =
            await sock.groupMetadata(
                groupId
            );

        const participants =
            metadata?.participants ||
            [];

        await cacheParticipants(
            participants
        );

        let participant =
            findParticipant(
                participants,
                sender
            );

        if (!participant) {
            const phone =
                await resolveLid(
                    sender
                );

            if (phone) {
                participant =
                    findParticipant(
                        participants,
                        phone
                    );
            }
        }

        return isAdminParticipant(
            participant
        );
    } catch {
        return false;
    }
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(
    message
) {
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
        msg.buttonsResponseMessage
            ?.selectedButtonId ||
        msg.listResponseMessage
            ?.singleSelectReply
            ?.selectedRowId ||
        ""
    ).trim();
}

/* =========================================================
   MODERATION STATUS
========================================================= */

function getModeration(
    groupId
) {
    return getGroupStatus(
        groupId
    ).moderation;
}

/* =========================================================
   BAD WORD
========================================================= */

function containsBadWord(text) {
    const normalized =
        String(text || "")
            .toLowerCase()
            .replace(
                /[\s\-_.,!?()[\]{}:;'"`~|\\/]+/g,
                ""
            );

    for (
        const word of BAD_WORDS
    ) {
        const check =
            String(word)
                .toLowerCase()
                .replace(
                    /[\s\-_.,!?()[\]{}:;'"`~|\\/]+/g,
                    ""
                );

        if (
            check &&
            normalized.includes(check)
        ) {
            return word;
        }
    }

    return null;
}

/* =========================================================
   LINK CHECK
========================================================= */

function containsLink(text) {
    return [
        /https?:\/\/\S+/i,
        /www\.\S+/i,
        /\bt\.me\/\S+/i,
        /\bwa\.me\/\S+/i,
        /\bchat\.whatsapp\.com\/\S+/i,
        /\b[a-z0-9-]+\.(com|net|org|xyz|bd|me|io|co|app|site|online|info|dev|ly|gg)\b/i
    ].some(
        regex => regex.test(text)
    );
}

/* =========================================================
   SPAM
========================================================= */

function isDuplicateSpam(
    groupId,
    sender,
    text
) {
    const normalized =
        String(text || "")
            .toLowerCase()
            .replace(
                /\s+/g,
                " "
            )
            .trim();

    if (!normalized) {
        return false;
    }

    const key =
        `${groupId}:${sender}`;

    const now = Date.now();

    const old =
        spamTracker.get(key);

    spamTracker.set(
        key,
        {
            text: normalized,
            time: now
        }
    );

    if (
        old &&
        old.text === normalized &&
        now - old.time <
            SPAM_WINDOW
    ) {
        return true;
    }

    return false;
}

/* =========================================================
   WARNINGS
========================================================= */

function getWarningCount(
    groupId,
    sender
) {
    if (!warnings[groupId]) {
        warnings[groupId] = {};
    }

    return Number(
        warnings[groupId][sender] || 0
    );
}

function addWarning(
    groupId,
    sender
) {
    if (!warnings[groupId]) {
        warnings[groupId] = {};
    }

    warnings[groupId][sender] =
        getWarningCount(
            groupId,
            sender
        ) + 1;

    saveWarnings();

    return warnings[groupId][sender];
}

/* =========================================================
   DELETE MESSAGE
========================================================= */

async function deleteMessage(
    groupId,
    message
) {
    try {
        await sock.sendMessage(
            groupId,
            {
                delete:
                    message.key
            }
        );

        return true;
    } catch {
        return false;
    }
}

/* =========================================================
   MODERATION
========================================================= */

async function moderateMessage(
    groupId,
    message,
    text
) {
    const moderation =
        getModeration(groupId);

    if (!isBotEnabled(groupId)) {
        return false;
    }

    const sender =
        message?.key?.participant;

    if (sender) {
        const admin =
            await isSenderAdmin(
                groupId,
                message
            );

        if (admin) {
            return false;
        }
    }

    let reason = "";

    if (
        moderation.badWords
    ) {
        const badWord =
            containsBadWord(text);

        if (badWord) {
            reason =
                `Bad Word: ${badWord}`;
        }
    }

    if (
        !reason &&
        moderation.links &&
        containsLink(text)
    ) {
        reason =
            "Link / URL";
    }

    if (
        !reason &&
        moderation.spam &&
        sender &&
        isDuplicateSpam(
            groupId,
            sender,
            text
        )
    ) {
        reason =
            "Duplicate Spam";
    }

    if (!reason) {
        return false;
    }

    const deleted =
        await deleteMessage(
            groupId,
            message
        );

    if (
        deleted &&
        moderation.warnings &&
        sender
    ) {
        const count =
            addWarning(
                groupId,
                sender
            );

        await sock.sendMessage(
            groupId,
            {
                text: `
⚠️ *${BOT_NAME} MODERATION*

🚫 Message Delete করা হয়েছে।

📌 *কারণ:* ${reason}

⚠️ *Warning:* ${count}

❗ Group Rules মেনে চলুন।
`
            }
        );
    }

    return deleted;
}

/* =========================================================
   MENU
========================================================= */

function menuText(groupId) {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
        🤖 *${BOT_NAME}*
╰━━━━━━━━━━━━━━━━━━━━╯

╭─❖ 👥 *GROUP COMMANDS*
│
│ 1️⃣ /menu
│ 2️⃣ /bot
│ 3️⃣ /rules
│ 4️⃣ /admin
│ 5️⃣ /members
│ 6️⃣ /groupinfo
│ 7️⃣ /id
╰────────────────────

╭─❖ ⚙️ *UTILITY*
│
│ 8️⃣ /ping
╰────────────────────

╭─❖ 💰 *BUY / SELL*
│
│ 9️⃣ /deal /ডিল
╰────────────────────

╭─❖ 🤍 *PIYAS*
│
│ 🔟 /piyas
╰────────────────────

╭─❖ 🌐 *WEBSITE*
│
│ 1️⃣1️⃣ /website
╰────────────────────

━━━━━━━━━━━━━━━━━━━━

👑 *Admin Group Control:*

/আর-রাইয়ান ১ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ২ মিনিটের জন্য গ্রুপ বন্ধ

/আর-রাইয়ান ১ ঘন্টার জন্য গ্রুপ বন্ধ

━━━━━━━━━━━━━━━━━━━━

📌 Command-এর আগে "/" ব্যবহার করুন।

🤍 *${BOT_NAME}*
`;
}

/* =========================================================
   COPY BUTTON
========================================================= */

async function sendCopyButton(
    groupId,
    command
) {
    try {
        const message =
            generateWAMessageFromContent(
                groupId,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage:
                                proto.Message
                                    .InteractiveMessage
                                    .create({
                                        body:
                                            proto.Message
                                                .InteractiveMessage
                                                .Body
                                                .create({
                                                    text:
                                                        `📋 ${command}`
                                                }),
                                        footer:
                                            proto.Message
                                                .InteractiveMessage
                                                .Footer
                                                .create({
                                                    text:
                                                        BOT_NAME
                                                }),
                                        nativeFlowMessage:
                                            proto.Message
                                                .InteractiveMessage
                                                .NativeFlowMessage
                                                .create({
                                                    buttons: [
                                                        {
                                                            name:
                                                                "cta_copy",
                                                            buttonParamsJson:
                                                                JSON.stringify({
                                                                    display_text:
                                                                        "📋 Copy",
                                                                    id:
                                                                        "copy",
                                                                    copy_code:
                                                                        command
                                                                })
                                                        }
                                                    ]
                                                })
                                    })
                        }
                    }
                },
                {
                    userJid:
                        sock?.user?.id
                }
            );

        await sock.relayMessage(
            groupId,
            message.message,
            {
                messageId:
                    message.key.id
            }
        );
    } catch {
        // Copy button is optional.
    }
}

/* =========================================================
   RULES
========================================================= */

const RULES = `
╭━━━━━━━━━━━━━━━━━━━━╮
        📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ সবাইকে সম্মান করে কথা বলুন।

2️⃣ অশ্লীল বা আপত্তিকর
কোনো Content শেয়ার করবেন না।

3️⃣ Spam করবেন না।

4️⃣ একই Message বারবার
পাঠাবেন না।

5️⃣ সন্দেহজনক Link শেয়ার
করবেন না।

6️⃣ অন্য Member-কে হয়রানি
করবেন না।

7️⃣ কোনো সমস্যা হলে
Admin-কে জানান।

🛡️ Bad Word, Link এবং
Duplicate Spam Filter চালু আছে।

🚫 Bot Member Kick/Ban করবে না।

🤍 *${BOT_NAME}*
`;

/* =========================================================
   WEBSITE
========================================================= */

const WEBSITE = `
╭━━━━━━━━━━━━━━━━━━━━╮
        🌐 *WEBSITE*
╰━━━━━━━━━━━━━━━━━━━━╯

🌐 ${WEBSITE_URL}

🤍 *${BOT_NAME}*
`;

/* =========================================================
   PIYAS
========================================================= */

const PIYAS = `
╭━━━━━━━━━━━━━━━━━━━━╮
          🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯

☪️ আলহামদুলিল্লাহ।

🌐 Official Website:
${WEBSITE_URL}

🤖 Bot Name:
${BOT_NAME}

🤍 Thank You
`;

/* =========================================================
   ADMIN LIST
========================================================= */

async function sendAdminList(
    groupId
) {
    try {
        const metadata =
            await sock.groupMetadata(
                groupId
            );

        const participants =
            metadata?.participants ||
            [];

        await cacheParticipants(
            participants
        );

        const admins =
            participants.filter(
                isAdminParticipant
            );

        const mentions = [];
        const lines = [];

        let number = 1;

        for (
            const admin of admins
        ) {
            const phone =
                await getPhoneJid(
                    admin
                );

            if (phone) {
                const numberText =
                    phone
                        .split("@")[0]
                        .replace(
                            /[^0-9]/g,
                            ""
                        );

                mentions.push(phone);

                lines.push(
                    `${number}️⃣ @${numberText} 👑`
                );
            } else {
                lines.push(
                    `${number}️⃣ Admin`
                );
            }

            number++;
        }

        await sock.sendMessage(
            groupId,
            {
                text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       👑 *GROUP ADMINS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n\n")}

👥 মোট Admin: ${admins.length}

🤍 *${BOT_NAME}*
`,
                mentions
            }
        );
    } catch (error) {
        console.log(
            "Admin list error:",
            error?.message
        );
    }
}

/* =========================================================
   DEAL
========================================================= */

async function sendDeal(
    groupId
) {
    const metadata =
        await sock.groupMetadata(
            groupId
        );

    const participants =
        metadata?.participants ||
        [];

    const admins =
        participants.filter(
            isAdminParticipant
        );

    const mentions = [];
    const lines = [];

    let number = 1;

    for (
        const admin of admins
    ) {
        const phone =
            await getPhoneJid(
                admin
            );

        if (phone) {
            const n =
                phone
                    .split("@")[0]
                    .replace(
                        /[^0-9]/g,
                        ""
                    );

            mentions.push(phone);

            lines.push(
                `${number}️⃣ @${n} 👑`
            );
        } else {
            lines.push(
                `${number}️⃣ Admin`
            );
        }

        number++;
    }

    await sock.sendMessage(
        groupId,
        {
            text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       🤝 *DEAL NOTICE*
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ কোনো ধরনের Account Buy/Sell
বা অন্য কোনো Deal করার আগে
অবশ্যই Group Admin-এর সাথে
যোগাযোগ করুন।

🚫 Admin ছাড়া কারো সাথে
Deal করবেন না।

👑 *Group Admin:*

${lines.join("\n\n")}

📌 নিরাপদ থাকতে সবসময়
Admin-এর মাধ্যমে Deal করুন।

🤍 *${BOT_NAME}*
`,
            mentions
        }
    );
}

/* =========================================================
   GROUP INFO
========================================================= */

async function sendGroupInfo(
    groupId
) {
    const metadata =
        await sock.groupMetadata(
            groupId
        );

    const participants =
        metadata?.participants ||
        [];

    const admins =
        participants.filter(
            isAdminParticipant
        );

    const lock =
        groupLocks[groupId];

    let lockText =
        "🟢 OPEN";

    if (
        lock &&
        lock.expiresAt >
            Date.now()
    ) {
        lockText =
            `🔴 CLOSED\n⏳ ${formatRemaining(
                lock.expiresAt -
                    Date.now()
            )}`;
    }

    await sock.sendMessage(
        groupId,
        {
            text: `
╭━━━━━━━━━━━━━━━━━━━━╮
       👥 *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

📛 Name:
${metadata?.subject || "Unknown"}

🆔 ID:
${groupId}

👥 Members:
${participants.length}

👑 Admins:
${admins.length}

🤖 Bot:
${
    isBotEnabled(groupId)
        ? "🟢 ON"
        : "🔴 OFF"
}

🔒 Group Lock:
${lockText}

🛡️ Moderation:
${
    Object.values(
        getModeration(groupId)
    ).every(Boolean