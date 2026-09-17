import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import P from "pino";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import http from "http";

dotenv.config();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 3000);

const PHONE_NUMBER =
    process.env.PHONE_NUMBER || "";

const WEBSITE_URL =
    process.env.WEBSITE_URL ||
    "https://x-cyber-2025.github.io/X-cyber.web/";

const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY_1 || "",
    process.env.GEMINI_API_KEY_2 || "",
    process.env.GEMINI_API_KEY_3 || "",
    process.env.GEMINI_API_KEY_4 || "",
    process.env.GEMINI_API_KEY_5 || ""
].filter(Boolean);

const GEMINI_MODEL =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash-lite";

const GEMINI_MODERATION_ENABLED =
    String(
        process.env.GEMINI_MODERATION_ENABLED ?? "true"
    ).toLowerCase() === "true";

const TEXT_MODERATION_ENABLED =
    String(
        process.env.TEXT_MODERATION_ENABLED ?? "true"
    ).toLowerCase() === "true";

const IMAGE_MODERATION_ENABLED =
    String(
        process.env.IMAGE_MODERATION_ENABLED ?? "true"
    ).toLowerCase() === "true";

const DUPLICATE_SPAM_WINDOW =
    1 * 60 * 1000;

const AUTH_DIR =
    "./auth_info";

const DATA_DIR =
    "./data";

const BLACKLIST_FILE =
    path.join(
        DATA_DIR,
        "blacklist.json"
    );

const BOT_STATUS_FILE =
    path.join(
        DATA_DIR,
        "bot_status.json"
    );

const REPORTS_FILE =
    path.join(
        DATA_DIR,
        "reports.json"
    );

const WELCOME_STATUS_FILE =
    path.join(
        DATA_DIR,
        "welcome_status.json"
    );

/* =========================================================
   GEMINI KEY ROTATION
========================================================= */

let geminiKeyIndex = 0;

function getNextGeminiKey() {
    if (!GEMINI_KEYS.length) {
        return "";
    }

    const key =
        GEMINI_KEYS[
            geminiKeyIndex % GEMINI_KEYS.length
        ];

    geminiKeyIndex =
        (geminiKeyIndex + 1) %
        GEMINI_KEYS.length;

    return key;
}

/* =========================================================
   DATA HELPERS
========================================================= */

function ensureDataDirectory() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(
            DATA_DIR,
            {
                recursive: true
            }
        );
    }
}

function ensureJsonFile(
    file,
    defaultValue
) {
    ensureDataDirectory();

    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(
                defaultValue,
                null,
                2
            )
        );
    }
}

function loadJson(
    file,
    defaultValue
) {
    try {
        ensureJsonFile(
            file,
            defaultValue
        );

        const raw =
            fs.readFileSync(
                file,
                "utf8"
            );

        if (!raw.trim()) {
            return defaultValue;
        }

        return JSON.parse(raw);

    } catch (error) {
        console.error(
            "JSON LOAD ERROR:",
            file,
            error.message
        );

        return defaultValue;
    }
}

function saveJson(
    file,
    data
) {
    try {
        ensureDataDirectory();

        fs.writeFileSync(
            file,
            JSON.stringify(
                data,
                null,
                2
            )
        );

        return true;

    } catch (error) {
        console.error(
            "JSON SAVE ERROR:",
            file,
            error.message
        );

        return false;
    }
}

ensureDataDirectory();

ensureJsonFile(
    BLACKLIST_FILE,
    {}
);

ensureJsonFile(
    BOT_STATUS_FILE,
    {}
);

ensureJsonFile(
    REPORTS_FILE,
    {}
);

ensureJsonFile(
    WELCOME_STATUS_FILE,
    {}
);

/* =========================================================
   MEMORY CACHE
========================================================= */

const participantCache =
    new Map();

const contactCache =
    new Map();

const duplicateCache =
    new Map();

/* =========================================================
   BASIC HELPERS
========================================================= */

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function normalizePhone(value) {
    if (!value) {
        return "";
    }

    return String(value)
        .replace(
            /[^\d]/g,
            ""
        )
        .replace(
            /^0+/,
            ""
        );
}

function jidToPhone(jid) {
    if (!jid) {
        return "";
    }

    const value =
        String(jid)
            .split(":")[0]
            .split("@")[0];

    return normalizePhone(value);
}

function cleanJid(jid) {
    if (!jid) {
        return "";
    }

    return String(jid)
        .trim()
        .toLowerCase();
}

function sameUser(a, b) {
    if (!a || !b) {
        return false;
    }

    const aa =
        cleanJid(a);

    const bb =
        cleanJid(b);

    if (aa === bb) {
        return true;
    }

    const ap =
        jidToPhone(aa);

    const bp =
        jidToPhone(bb);

    return Boolean(
        ap &&
        bp &&
        ap === bp
    );
}

function getBotJid(sock) {
    return cleanJid(
        sock?.user?.id || ""
    );
}

function getBotPhone(sock) {
    return normalizePhone(
        jidToPhone(
            getBotJid(sock)
        )
    );
}

function isGroupJid(jid) {
    return Boolean(
        jid &&
        String(jid).endsWith(
            "@g.us"
        )
    );
}

/* =========================================================
   IDENTITY
========================================================= */

function extractUserIdentity(item) {
    if (!item) {
        return null;
    }

    const id =
        item.id ||
        item.jid ||
        item.participant ||
        item.userJid ||
        "";

    const phone =
        normalizePhone(
            item.phone ||
            item.phoneNumber ||
            item.number ||
            jidToPhone(id)
        );

    const lid =
        item.lid ||
        item.lidJid ||
        (
            String(id).endsWith("@lid")
                ? id
                : ""
        );

    return {
        id: cleanJid(id),
        phone,
        lid: cleanJid(lid),
        name:
            item.name ||
            item.notify ||
            item.pushName ||
            ""
    };
}

function cacheIdentity(identity) {
    const data =
        extractUserIdentity(
            identity
        );

    if (!data) {
        return;
    }

    if (data.id) {
        contactCache.set(
            data.id,
            data
        );
    }

    if (data.phone) {
        contactCache.set(
            `phone:${data.phone}`,
            data
        );
    }

    if (data.lid) {
        contactCache.set(
            data.lid,
            data
        );
    }
}

/* =========================================================
   ALLOWED GROUPS
========================================================= */

function getAllowedGroups() {
    return String(
        process.env.ALLOWED_GROUPS ||
        ""
    )
        .split(",")
        .map(
            value =>
                value.trim()
        )
        .filter(Boolean);
}

function isAllowedGroup(groupId) {
    const allowed =
        getAllowedGroups();

    if (!allowed.length) {
        return true;
    }

    return allowed.includes(
        groupId
    );
}

/* =========================================================
   BLACKLIST
========================================================= */

function loadBlacklist() {
    return loadJson(
        BLACKLIST_FILE,
        {}
    );
}

function saveBlacklist(data) {
    saveJson(
        BLACKLIST_FILE,
        data
    );
}

function identitiesMatch(a, b) {
    if (!a || !b) {
        return false;
    }

    const aa =
        extractUserIdentity(a);

    const bb =
        extractUserIdentity(b);

    if (!aa || !bb) {
        return false;
    }

    if (
        aa.id &&
        bb.id &&
        sameUser(
            aa.id,
            bb.id
        )
    ) {
        return true;
    }

    if (
        aa.phone &&
        bb.phone &&
        aa.phone === bb.phone
    ) {
        return true;
    }

    if (
        aa.lid &&
        bb.lid &&
        cleanJid(aa.lid) ===
        cleanJid(bb.lid)
    ) {
        return true;
    }

    return false;
}

function isBlacklisted(
    groupId,
    identity
) {
    const data =
        loadBlacklist();

    const list =
        data[groupId] || [];

    return list.some(
        entry =>
            identitiesMatch(
                entry,
                identity
            )
    );
}

function addToBlacklist(
    groupId,
    identity
) {
    const user =
        extractUserIdentity(
            identity
        );

    if (!user) {
        return false;
    }

    const data =
        loadBlacklist();

    if (!data[groupId]) {
        data[groupId] = [];
    }

    const exists =
        data[groupId].some(
            entry =>
                identitiesMatch(
                    entry,
                    user
                )
        );

    if (exists) {
        return false;
    }

    data[groupId].push(
        user
    );

    saveBlacklist(
        data
    );

    return true;
}

function removeFromBlacklist(
    groupId,
    identity
) {
    const data =
        loadBlacklist();

    const list =
        data[groupId] || [];

    const filtered =
        list.filter(
            entry =>
                !identitiesMatch(
                    entry,
                    identity
                )
        );

    const changed =
        filtered.length !==
        list.length;

    data[groupId] =
        filtered;

    saveBlacklist(
        data
    );

    return changed;
}

function getBlacklist(groupId) {
    const data =
        loadBlacklist();

    return data[groupId] || [];
}

/* =========================================================
   BOT STATUS
========================================================= */

function isBotEnabled(groupId) {
    const data =
        loadJson(
            BOT_STATUS_FILE,
            {}
        );

    if (
        typeof data[groupId] ===
        "undefined"
    ) {
        return true;
    }

    return Boolean(
        data[groupId]
    );
}

function setBotStatus(
    groupId,
    status
) {
    const data =
        loadJson(
            BOT_STATUS_FILE,
            {}
        );

    data[groupId] =
        Boolean(status);

    saveJson(
        BOT_STATUS_FILE,
        data
    );
}

/* =========================================================
   WELCOME STATUS
========================================================= */

function isWelcomeEnabled(groupId) {
    const data =
        loadJson(
            WELCOME_STATUS_FILE,
            {}
        );

    if (
        typeof data[groupId] ===
        "undefined"
    ) {
        return true;
    }

    return Boolean(
        data[groupId]
    );
}

function setWelcomeStatus(
    groupId,
    status
) {
    const data =
        loadJson(
            WELCOME_STATUS_FILE,
            {}
        );

    data[groupId] =
        Boolean(status);

    saveJson(
        WELCOME_STATUS_FILE,
        data
    );
}

/* =========================================================
   GROUP METADATA
========================================================= */

async function getGroupMetadata(
    sock,
    groupId
) {
    try {
        return await sock.groupMetadata(
            groupId
        );
    } catch (error) {
        console.error(
            "GROUP METADATA ERROR:",
            error.message
        );

        return null;
    }
}

async function loadGroupParticipants(
    sock,
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

        const map =
            new Map();

        for (
            const participant
            of participants
        ) {
            const identity =
                extractUserIdentity(
                    participant
                );

            if (!identity) {
                continue;
            }

            map.set(
                cleanJid(
                    participant.id
                ),
                {
                    ...participant,
                    ...identity
                }
            );

            cacheIdentity(
                identity
            );
        }

        participantCache.set(
            groupId,
            map
        );

        return participants;

    } catch (error) {
        console.error(
            "PARTICIPANT LOAD ERROR:",
            error.message
        );

        return [];
    }
}

/* =========================================================
   ADMIN CHECK
========================================================= */

async function isGroupAdmin(
    sock,
    groupId,
    userJid
) {
    try {
        const metadata =
            await getGroupMetadata(
                sock,
                groupId
            );

        if (!metadata) {
            return false;
        }

        const target =
            cleanJid(
                userJid
            );

        const phone =
            jidToPhone(target);

        const participant =
            metadata.participants
                ?.find(
                    item => {
                        const id =
                            cleanJid(
                                item.id
                            );

                        return (
                            id === target ||
                            (
                                phone &&
                                jidToPhone(id) ===
                                phone
                            )
                        );
                    }
                );

        if (!participant) {
            return false;
        }

        return (
            participant.admin ===
            "admin" ||
            participant.admin ===
            "superadmin"
        );

    } catch {
        return false;
    }
}

async function isBotAdmin(
    sock,
    groupId
) {
    return await isGroupAdmin(
        sock,
        groupId,
        getBotJid(sock)
    );
}

function isOwner(userJid) {
    const owners =
        String(
            process.env.OWNER_NUMBERS ||
            process.env.OWNER_NUMBER ||
            ""
        )
            .split(",")
            .map(
                value =>
                    normalizePhone(value)
            )
            .filter(Boolean);

    if (!owners.length) {
        return false;
    }

    const phone =
        normalizePhone(
            jidToPhone(
                userJid
            )
        );

    return owners.includes(
        phone
    );
}

async function isAdminOrOwner(
    sock,
    groupId,
    userJid
) {
    if (
        isOwner(userJid)
    ) {
        return true;
    }

    return await isGroupAdmin(
        sock,
        groupId,
        userJid
    );
}

/* =========================================================
   MESSAGE TEXT
========================================================= */

function getMessageText(message) {
    if (!message) {
        return "";
    }

    if (
        message.conversation
    ) {
        return message.conversation;
    }

    if (
        message.extendedTextMessage
            ?.text
    ) {
        return message.extendedTextMessage.text;
    }

    if (
        message.imageMessage
            ?.caption
    ) {
        return message.imageMessage.caption;
    }

    if (
        message.videoMessage
            ?.caption
    ) {
        return message.videoMessage.caption;
    }

    if (
        message.documentMessage
            ?.caption
    ) {
        return message.documentMessage.caption;
    }

    return "";
}

function getMentionedJids(message) {
    return (
        message
            ?.extendedTextMessage
            ?.contextInfo
            ?.mentionedJid ||
        []
    );
}

/* =========================================================
   LARGE LOCAL BAD WORD FILTER
========================================================= */

const BAD_WORDS = [
    "fuck",
    "fucking",
    "fucker",
    "motherfuck",
    "motherfucker",
    "shit",
    "bullshit",
    "bitch",
    "bastard",
    "asshole",
    "dick",
    "pussy",
    "porn",
    "xxx",
    "sex",

    "সালা",
    "শালা",
    "সালি",
    "সালী",
    "শালি",
    "শালী",
    "ষালি",
    "ষালী",

    "খাংকি",
    "খাংকী",
    "খানকি",
    "খানকী",

    "মাগি",
    "মাগী",

    "বেসসা",
    "বেশ্যা",
    "বেশসা",
    "বেস্যা",

    "চুদা",
    "চুদি",
    "চুদী",
    "চোদা",
    "চোদি",
    "চোদী",
    "ছোদি",
    "ছোদী",
    "ছোদা",
    "ছুদা",
    "ছুদি",
    "ছোডি",

    "চুদমু",
    "চোদমু",
    "ছুদমু",
    "ছোদমু",

    "মাদারচুদ",
    "মাধারচুদ",
    "মাদারচোদ",
    "মাদারছোদ",
    "মাদারছুদ",

    "নটি",
    "নটী",
    "নডি",
    "নডী",

    "লাং",
    "লাঙ্গ",
    "লের",

    "মাং শাওয়্যা",
    "সাওয়্যা",
    "সাওয়া",

    "বাল",
    "আবাল",

    "বোকাচুদা",
    "বুকাচুদা",
    "বোকাছোদা",
    "বুকাছোদা",
    "বুকাচুধা",
    "বোকাছুদা",

    "হারামি",
    "হারামজাদা",
    "হারামখোর",
    "জারজ",
    "জারজের",
    "কুত্তা",
    "কুত্তারবাচ্চা",
    "শুয়োর",
    "শুয়োরেরবাচ্চা",

    "সেক্স",
    "এক্সক্সক্স",

    "🖕"
];

/* =========================================================
   BAD WORD NORMALIZER
========================================================= */

function normalizeBadWordText(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFKC")
        .replace(
            /[\u200B-\u200D\uFEFF]/g,
            ""
        )
        .replace(
            /[\s]+/g,
            " "
        )
        .trim();
}

function containsBadWord(text) {
    if (!text) {
        return false;
    }

    const normalized =
        normalizeBadWordText(
            text
        );

    return BAD_WORDS.some(
        word => {
            const target =
                normalizeBadWordText(
                    word
                );

            return (
                target &&
                normalized.includes(
                    target
                )
            );
        }
    );
}

/* =========================================================
   LINK DETECTION
========================================================= */

function containsLink(text) {
    if (!text) {
        return false;
    }

    const cleaned =
        String(text)
            .replace(
                /[<>(){}[\]"'`]/g,
                " "
            );

    const fullUrlRegex =
        /\bhttps?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?/i;

    const wwwRegex =
        /\bwww\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?/i;

    const whatsappGroupRegex =
        /\bchat\.whatsapp\.com\/[A-Za-z0-9_-]+/i;

    const whatsappDirectRegex =
        /\bwa\.me\/[A-Za-z0-9_?=&+./-]+/i;

    const telegramRegex =
        /\b(?:t\.me|telegram\.me)\/[A-Za-z0-9_+./?=&-]+/i;

    const bareDomainRegex =
        /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s<>"']*)?/i;

    return (
        fullUrlRegex.test(cleaned) ||
        wwwRegex.test(cleaned) ||
        whatsappGroupRegex.test(cleaned) ||
        whatsappDirectRegex.test(cleaned) ||
        telegramRegex.test(cleaned) ||
        bareDomainRegex.test(cleaned)
    );
}

/* =========================================================
   DUPLICATE SPAM
========================================================= */

function normalizeSpamText(text) {
    return String(text || "")
        .trim()
        .toLowerCase()
        .replace(
            /\s+/g,
            " "
        );
}

function isDuplicateSpam(
    groupId,
    sender,
    text
) {
    if (
        !groupId ||
        !sender ||
        !text
    ) {
        return false;
    }

    const normalizedText =
        normalizeSpamText(
            text
        );

    if (!normalizedText) {
        return false;
    }

    const key =
        `${groupId}:${cleanJid(sender)}:${normalizedText}`;

    const now =
        Date.now();

    const old =
        duplicateCache.get(
            key
        );

    duplicateCache.set(
        key,
        now
    );

    return Boolean(
        old &&
        now - old <=
        DUPLICATE_SPAM_WINDOW
    );
}

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const [
                key,
                timestamp
            ]
            of duplicateCache.entries()
        ) {
            if (
                now - timestamp >
                DUPLICATE_SPAM_WINDOW
            ) {
                duplicateCache.delete(
                    key
                );
            }
        }
    },
    60 * 1000
);

/* =========================================================
   GEMINI API
========================================================= */

async function callGemini(contents) {
    if (
        !GEMINI_MODERATION_ENABLED ||
        !GEMINI_KEYS.length
    ) {
        return null;
    }

    const totalKeys =
        GEMINI_KEYS.length;

    let lastError =
        null;

    for (
        let attempt = 0;
        attempt < totalKeys;
        attempt++
    ) {
        const apiKey =
            getNextGeminiKey();

        if (!apiKey) {
            continue;
        }

        try {
            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

            const response =
                await fetch(
                    url,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "x-goog-api-key":
                                apiKey
                        },

                        body:
                            JSON.stringify({
                                contents,

                                generationConfig: {
                                    temperature: 0,

                                    responseMimeType:
                                        "application/json"
                                }
                            })
                    }
                );

            if (
                response.ok
            ) {
                return await response.json();
            }

            const errorText =
                await response.text();

            lastError =
                new Error(
                    `Gemini HTTP ${response.status}: ${errorText.slice(0, 300)}`
                );

            console.error(
                "Gemini key failed:",
                response.status
            );

            if (
                response.status === 401 ||
                response.status === 403 ||
                response.status === 429
            ) {
                continue;
            }

            continue;

        } catch (error) {
            lastError =
                error;

            console.error(
                "GEMINI REQUEST ERROR:",
                error.message
            );
        }
    }

    if (lastError) {
        console.error(
            "ALL GEMINI KEYS FAILED:",
            lastError.message
        );
    }

    return null;
}

/* =========================================================
   GEMINI TEXT MODERATION
========================================================= */

async function moderateText(text) {
    if (
        !GEMINI_MODERATION_ENABLED ||
        !TEXT_MODERATION_ENABLED ||
        !text ||
        !GEMINI_KEYS.length
    ) {
        return {
            flagged: false,
            violation: "none",
            severity: "low",
            reason: ""
        };
    }

    const prompt = `
You are a strict but context-aware WhatsApp group safety moderator.

Analyze the following user message.

You MUST understand meaning and context, not just keywords.

Detect:
- profanity
- abusive insults
- sexual harassment
- sexual threats
- rape threats
- threats or encouragement of sexual violence
- explicit sexual content
- pornography
- sexual content involving minors
- grooming or sexual exploitation of minors
- severe harassment
- threats of physical violence
- hate or severe abusive content

Also detect Bengali, Banglish and English.
Understand common spelling variations, slang, intentional spacing,
repeated letters and altered spellings.

IMPORTANT:
A message mentioning a sensitive word does NOT automatically mean
a violation. Educational, news, warning, reporting or normal
non-explicit discussion should not be flagged solely because of
a keyword.

For actual threats of rape, sexual assault or sexual violence,
flag the message.

Return ONLY valid JSON.

Required format:

{
  "flagged": true,
  "violation": "profanity|sexual_harassment|rape_threat|sexual_violence|explicit_sexual_content|minor_sexual_content|grooming|violent_threat|severe_harassment|hate_or_abuse|other|none",
  "severity": "low|medium|high|critical",
  "reason": "short explanation"
}

Message:
${JSON.stringify(
    String(text)
)}
`;

    try {
        const data =
            await callGemini([
                {
                    role: "user",
                    parts: [
                        {
                            text: prompt
                        }
                    ]
                }
            ]);

        const raw =
            data?.candidates?.[0]
                ?.content?.parts
                ?.map(
                    part =>
                        part.text || ""
                )
                .join("")
                .trim() || "";

        if (!raw) {
            return {
                flagged: false,
                violation: "none",
                severity: "low",
                reason: ""
            };
        }

        const cleaned =
            raw
                .replace(
                    /^```json\s*/i,
                    ""
                )
                .replace(
                    /^```\s*/i,
                    ""
                )
                .replace(
                    /\s*```$/i,
                    ""
                )
                .trim();

        const parsed =
            JSON.parse(
                cleaned
            );

        return {
            flagged:
                Boolean(
                    parsed.flagged
                ),

            violation:
                String(
                    parsed.violation ||
                    "none"
                ),

            severity:
                String(
                    parsed.severity ||
                    "low"
                ),

            reason:
                String(
                    parsed.reason ||
                    ""
                )
        };

    } catch (error) {
        console.error(
            "GEMINI TEXT MODERATION ERROR:",
            error.message
        );

        return {
            flagged: false,
            violation: "none",
            severity: "low",
            reason: ""
        };
    }
}

/* =========================================================
   GEMINI IMAGE MODERATION
========================================================= */

async function moderateImage(
    buffer,
    mimeType = "image/jpeg"
) {
    if (
        !GEMINI_MODERATION_ENABLED ||
        !IMAGE_MODERATION_ENABLED ||
        !buffer ||
        !GEMINI_KEYS.length
    ) {
        return {
            flagged: false,
            violation: "none",
            severity: "low",
            reason: ""
        };
    }

    try {
        const base64 =
            buffer.toString(
                "base64"
            );

        const safeMimeType =
            String(
                mimeType ||
                "image/jpeg"
            )
                .split(";")[0]
                .trim();

        const prompt = `
You are a strict WhatsApp group image safety moderator.

Analyze this image.

Flag the image if it contains:
- pornography
- explicit sexual activity
- visible genital exposure
- clearly exposed sexual body parts
- explicit adult sexual content
- sexual exploitation
- sexual content involving minors
- sexual violence or sexual assault imagery
- clearly obscene explicit content

Do NOT flag normal:
- clothing
- fashion
- beachwear
- swimwear
- ordinary selfies
- medical/educational images
- non-explicit romantic content
- normal human bodies without explicit sexual context

Return ONLY valid JSON:

{
  "flagged": true,
  "violation": "explicit_sexual_content|minor_sexual_content|sexual_violence|pornography|other|none",
  "severity": "low|medium|high|critical",
  "reason": "short explanation"
}
`;

        const data =
            await callGemini([
                {
                    role: "user",
                    parts: [
                        {
                            text: prompt
                        },
                        {
                            inlineData: {
                                mimeType:
                                    safeMimeType,

                                data:
                                    base64
                            }
                        }
                    ]
                }
            ]);

        const raw =
            data?.candidates?.[0]
                ?.content?.parts
                ?.map(
                    part =>
                        part.text || ""
                )
                .join("")
                .trim() || "";

        if (!raw) {
            return {
                flagged: false,
                violation: "none",
                severity: "low",
                reason: ""
            };
        }

        const cleaned =
            raw
                .replace(
                    /^```json\s*/i,
                    ""
                )
                .replace(
                    /^```\s*/i,
                    ""
                )
                .replace(
                    /\s*```$/i,
                    ""
                )
                .trim();

        const parsed =
            JSON.parse(
                cleaned
            );

        return {
            flagged:
                Boolean(
                    parsed.flagged
                ),

            violation:
                String(
                    parsed.violation ||
                    "none"
                ),

            severity:
                String(
                    parsed.severity ||
                    "low"
                ),

            reason:
                String(
                    parsed.reason ||
                    ""
                )
        };

    } catch (error) {
        console.error(
            "GEMINI IMAGE MODERATION ERROR:",
            error.message
        );

        return {
            flagged: false,
            violation: "none",
            severity: "low",
            reason: ""
        };
    }
}

/* =========================================================
   MESSAGE DELETE
========================================================= */

async function deleteMessage(
    sock,
    groupId,
    messageKey
) {
    try {
        await sock.sendMessage(
            groupId,
            {
                delete:
                    messageKey
            }
        );

        return true;

    } catch (error) {
        console.error(
            "DELETE ERROR:",
            error.message
        );

        return false;
    }
}

/* =========================================================
   REPLY
========================================================= */

async function reply(
    sock,
    groupId,
    text,
    quoted
) {
    try {
        return await sock.sendMessage(
            groupId,
            {
                text
            },
            quoted
                ? {
                    quoted
                }
                : undefined
        );

    } catch (error) {
        console.error(
            "REPLY ERROR:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   MENU
========================================================= */

function menuText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
🤖 *PIYAS BOT*
╰━━━━━━━━━━━━━━━━━━━━╯

📋 *GROUP COMMANDS*

• /menu
• /bot
• /rules
• /admin
• /members
• /groupinfo
• /id
• /ping

🛠️ *UTILITY*

• /deal
• /ডিল
• /piyas
• /website

🚨 *REPORT*

• /report @user কারণ
• /reports

👮 *ADMIN CONTROL*

• /adminpanel
• /cmdlist
• /on
• /off
• /boton
• /botoff
• /onbot
• /offbot
• /fullbotstatus

👋 *WELCOME*

• /welcomeon
• /welcomeoff

🚫 *BLACKLIST*

• /allowback @user
• /unleave @user

━━━━━━━━━━━━━━━━━━━━━━
⚠️ সব Command-এর আগে / দিতে হবে।
━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

function commandListText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
📋 *COMMAND LIST*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 *PUBLIC*

/menu
/bot
/rules
/admin
/members
/groupinfo
/id
/ping

💰 *DEAL*

/deal
/ডিল

🤍 *PIYAS*

/piyas
/website

🚨 *REPORT*

/report @user কারণ
/reports

👮 *ADMIN*

/adminpanel
/cmdlist
/boton
/botoff
/on
/off
/onbot
/offbot
/fullbotstatus

👋 *WELCOME*

/welcomeon
/welcomeoff

🚫 *BLACKLIST*

/allowback @user
/unleave @user

━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

function adminPanelText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
👮 *ADMIN PANEL*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 *BOT CONTROL*

/on
/off
/boton
/botoff
/onbot
/offbot
/fullbotstatus

👋 *WELCOME CONTROL*

/welcomeon
/welcomeoff

🚫 *BLACKLIST CONTROL*

/allowback @user
/unleave @user

🚨 *REPORT*

/reports

📋 *COMMAND LIST*

/cmdlist

━━━━━━━━━━━━━━━━━━━━━━
⚠️ শুধুমাত্র Admin/Owner ব্যবহার করতে পারবেন।
━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

function rulesText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
📜 *GROUP RULES*
╰━━━━━━━━━━━━━━━━━━━━╯

1️⃣ অপ্রয়োজনীয় Spam করা যাবে না।
2️⃣ একই Message বারবার পাঠানো যাবে না।
3️⃣ কোনো ধরনের নিষিদ্ধ Link শেয়ার করা যাবে না।
4️⃣ অশালীন ভাষা ব্যবহার করা যাবে না।
5️⃣ 18+/Explicit Content শেয়ার করা যাবে না।
6️⃣ অন্য সদস্যকে বিরক্ত করা যাবে না।
7️⃣ Threat/Harassment অনুমোদিত নয়।
8️⃣ Sexual Violence/Rape Threat অনুমোদিত নয়।
9️⃣ Admin-এর নির্দেশনা মেনে চলতে হবে।

⚠️ নিয়ম ভঙ্গ করলে Bot Message Remove করতে পারে এবং Admin প্রয়োজনীয় ব্যবস্থা নিতে পারেন।

🤍 *PIYAS BOT*
`.trim();
}

/* =========================================================
   ADMIN TEXT
========================================================= */

function adminText(metadata) {
    const admins =
        metadata?.participants
            ?.filter(
                participant =>
                    participant.admin ===
                    "admin" ||
                    participant.admin ===
                    "superadmin"
            ) || [];

    if (!admins.length) {
        return `
╭━━━━━━━━━━━━━━━━━━━━╮
👮 *GROUP ADMIN*
╰━━━━━━━━━━━━━━━━━━━━╯

কোনো Admin তথ্য পাওয়া যায়নি।
`.trim();
    }

    const lines =
        admins.map(
            (
                admin,
                index
            ) =>
                `${index + 1}. @${jidToPhone(admin.id) || admin.id}`
        );

    return `
╭━━━━━━━━━━━━━━━━━━━━╮
👮 *GROUP ADMIN*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join("\n")}

🤍 *PIYAS BOT*
`.trim();
}

function membersText(metadata) {
    const total =
        metadata?.participants
            ?.length || 0;

    const admins =
        metadata?.participants
            ?.filter(
                participant =>
                    participant.admin ===
                    "admin" ||
                    participant.admin ===
                    "superadmin"
            )
            .length || 0;

    return `
╭━━━━━━━━━━━━━━━━━━━━╮
👥 *MEMBERS INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

👥 Total Members: *${total}*
👮 Admins: *${admins}*
👤 Members: *${Math.max(
        0,
        total - admins
    )}*

🤖 *PIYAS BOT*
`.trim();
}

function groupInfoText(metadata) {
    if (!metadata) {
        return `
╭━━━━━━━━━━━━━━━━━━━━╮
ℹ️ *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

Group information পাওয়া যায়নি।
`.trim();
    }

    const subject =
        metadata.subject ||
        "Unknown";

    const owner =
        metadata.owner ||
        metadata.subjectOwner ||
        "";

    const total =
        metadata.participants
            ?.length || 0;

    return `
╭━━━━━━━━━━━━━━━━━━━━╮
ℹ️ *GROUP INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

🏷️ Name: *${subject}*
👥 Members: *${total}*

🆔 Group ID:
${metadata.id}

${
    owner
        ? `👑 Owner: @${jidToPhone(owner) || owner}`
        : ""
}

🤖 *PIYAS BOT*
`.trim();
}

function piyasText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
🤍 *PIYAS*
╰━━━━━━━━━━━━━━━━━━━━╯

PIYAS BOT-এর Official Information।

🌐 Website:
${WEBSITE_URL}

🤖 Powered by PIYAS BOT
`.trim();
}

/* =========================================================
   REPORT SYSTEM
========================================================= */

function addReport(
    groupId,
    reporter,
    target,
    reason
) {
    const data =
        loadJson(
            REPORTS_FILE,
            {}
        );

    if (!data[groupId]) {
        data[groupId] = [];
    }

    data[groupId].push({
        id: Date.now(),

        reporter:
            extractUserIdentity(
                reporter
            ),

        target:
            extractUserIdentity(
                target
            ),

        reason:
            String(
                reason || ""
            ).trim(),

        time:
            new Date()
                .toISOString()
    });

    saveJson(
        REPORTS_FILE,
        data
    );

    return true;
}

function getReportsText(groupId) {
    const data =
        loadJson(
            REPORTS_FILE,
            {}
        );

    const reports =
        data[groupId] || [];

    if (!reports.length) {
        return `
╭━━━━━━━━━━━━━━━━━━━━╮
🚨 *REPORTS*
╰━━━━━━━━━━━━━━━━━━━━╯

বর্তমানে কোনো Report নেই।
`.trim();
    }

    const lines =
        reports.map(
            (
                report,
                index
            ) => {
                const reporter =
                    report.reporter
                        ?.phone ||
                    jidToPhone(
                        report.reporter?.id
                    ) ||
                    "Unknown";

                const target =
                    report.target
                        ?.phone ||
                    jidToPhone(
                        report.target?.id
                    ) ||
                    "Unknown";

                return [
                    `${index + 1}. 👤 Target: ${target}`,
                    `   📢 Reporter: ${reporter}`,
                    `   📝 Reason: ${report.reason || "No reason"}`,
                    `   🕒 ${report.time}`
                ].join(
                    "\n"
                );
            }
        );

    return `
╭━━━━━━━━━━━━━━━━━━━━╮
🚨 *REPORTS*
╰━━━━━━━━━━━━━━━━━━━━╯

${lines.join(
        "\n\n"
    )}
`.trim();
}

/* =========================================================
   WELCOME
========================================================= */

async function sendWelcome(
    sock,
    groupId,
    participant
) {
    if (
        !isWelcomeEnabled(
            groupId
        )
    ) {
        return;
    }

    try {
        const metadata =
            await getGroupMetadata(
                sock,
                groupId
            );

        const groupName =
            metadata?.subject ||
            "Group";

        const phone =
            jidToPhone(
                participant
            );

        const mention =
            `@${phone || participant}`;

        const text = `
╭━━━━━━━━━━━━━━━━━━━━╮
🎉 *স্বাগতম*
╰━━━━━━━━━━━━━━━━━━━━╯

🎉 *স্বাগতম ${mention}!* ❤️

🌸 আপনাকে *${groupName}*
গ্রুপে স্বাগতম।

📜 গ্রুপের নিয়ম মেনে চলুন।
🤝 সবাইকে সম্মান করুন।
🚫 Spam/Link/অশালীন Content থেকে বিরত থাকুন।

🤖 *PIYAS BOT*
`.trim();

        await sock.sendMessage(
            groupId,
            {
                text,
                mentions: [
                    participant
                ]
            }
        );

    } catch (error) {
        console.error(
            "WELCOME ERROR:",
            error.message
        );
    }
}

/* =========================================================
   BLACKLIST REJOIN
========================================================= */

async function handleBlacklistedJoin(
    sock,
    groupId,
    participant
) {
    try {
        if (
            !isBlacklisted(
                groupId,
                participant
            )
        ) {
            return;
        }

        const botAdmin =
            await isBotAdmin(
                sock,
                groupId
            );

        if (!botAdmin) {
            console.log(
                "Bot is not admin; cannot remove blacklisted user."
            );

            return;
        }

        await sock.groupParticipantsUpdate(
            groupId,
            [
                participant
            ],
            "remove"
        );

        await reply(
            sock,
            groupId,
            `
🚫 *BLACKLIST USER*

এই User পূর্বে নিজে Group Leave করেছিলেন।

⚠️ Blacklist থাকার কারণে পুনরায় Join করার পর Remove করা হয়েছে।

🤖 *PIYAS BOT*
`.trim()
        );

    } catch (error) {
        console.error(
            "BLACKLIST REJOIN ERROR:",
            error.message
        );
    }
}

/* =========================================================
   PARTICIPANT UPDATE
========================================================= */

async function handleParticipantUpdate(
    sock,
    update
) {
    const {
        id: groupId,
        participants = [],
        action,
        author,
        authorPn
    } = update;

    if (
        !isGroupJid(groupId) ||
        !isAllowedGroup(groupId)
    ) {
        return;
    }

    await loadGroupParticipants(
        sock,
        groupId
    );

    if (
        action === "add"
    ) {
        for (
            const participant
            of participants
        ) {
            cacheIdentity({
                id: participant
            });

            await handleBlacklistedJoin(
                sock,
                groupId,
                participant
            );

            if (
                !isBlacklisted(
                    groupId,
                    participant
                )
            ) {
                await sendWelcome(
                    sock,
                    groupId,
                    participant
                );
            }
        }

        return;
    }

    if (
        action !== "remove"
    ) {
        return;
    }

    const botJid =
        getBotJid(sock);

    for (
        const participant
        of participants
    ) {
        const identity =
            extractUserIdentity({
                id: participant
            });

        cacheIdentity(
            identity
        );

        if (
            sameUser(
                participant,
                botJid
            )
        ) {
            console.log(
                "Bot was removed from group."
            );

            continue;
        }

        const removedBy =
            author ||
            authorPn ||
            "";

        const selfLeave =
            !removedBy ||
            sameUser(
                removedBy,
                participant
            );

        if (selfLeave) {
            addToBlacklist(
                groupId,
                identity
            );

            console.log(
                "Self-leave blacklisted:",
                participant
            );
        }
    }
}

/* =========================================================
   COMMAND PARSER
========================================================= */

function parseCommand(text) {
    const value =
        String(text || "")
            .trim();

    if (
        !value.startsWith("/")
    ) {
        return {
            command: "",
            args: []
        };
    }

    const withoutSlash =
        value
            .slice(1)
            .trim();

    if (!withoutSlash) {
        return {
            command: "",
            args: []
        };
    }

    const parts =
        withoutSlash.split(
            /\s+/
        );

    const command =
        String(
            parts.shift() || ""
        ).toLowerCase();

    return {
        command,
        args: parts
    };
}

/* =========================================================
   ADMIN COMMANDS
========================================================= */

const ADMIN_CONTROL_COMMANDS = [
    "adminpanel",
    "cmdlist",
    "on",
    "off",
    "boton",
    "botoff",
    "onbot",
    "offbot",
    "fullbotstatus",
    "welcomeon",
    "welcomeoff",
    "allowback",
    "unleave",
    "reports"
];

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(
    sock,
    msg,
    groupId,
    sender,
    text,
    metadata
) {
    const {
        command,
        args
    } =
        parseCommand(text);

    if (!command) {
        return false;
    }

    const admin =
        await isAdminOrOwner(
            sock,
            groupId,
            sender
        );

    if (
        !isBotEnabled(groupId) &&
        !ADMIN_CONTROL_COMMANDS.includes(
            command
        )
    ) {
        return true;
    }

    if (
        command === "menu" ||
        command === "bot"
    ) {
        await reply(
            sock,
            groupId,
            menuText(),
            msg
        );

        return true;
    }

    if (
        command === "rules"
    ) {
        await reply(
            sock,
            groupId,
            rulesText(),
            msg
        );

        return true;
    }

    if (
        command === "admin"
    ) {
        const adminMessage =
            adminText(
                metadata
            );

        const mentions =
            (
                metadata?.participants ||
                []
            )
                .filter(
                    participant =>
                        participant.admin ===
                        "admin" ||
                        participant.admin ===
                        "superadmin"
                )
                .map(
                    participant =>
                        participant.id
                );

        await sock.sendMessage(
            groupId,
            {
                text:
                    adminMessage,

                mentions
            },
            {
                quoted: msg
            }
        );

        return true;
    }

    if (
        command === "members"
    ) {
        await reply(
            sock,
            groupId,
            membersText(
                metadata
            ),
            msg
        );

        return true;
    }

    if (
        command === "groupinfo"
    ) {
        await reply(
            sock,
            groupId,
            groupInfoText(
                metadata
            ),
            msg
        );

        return true;
    }

    if (
        command === "id"
    ) {
        const mentioned =
            getMentionedJids(
                msg.message
            );

        const target =
            mentioned[0] ||
            sender;

        await reply(
            sock,
            groupId,
            `
╭━━━━━━━━━━━━━━━━━━━━╮
🆔 *ID INFO*
╰━━━━━━━━━━━━━━━━━━━━╯

👤 User ID:
${target}

📱 Number:
${jidToPhone(target) || "Unavailable"}

👥 Group ID:
${groupId}

🤖 *PIYAS BOT*
`.trim(),
            msg
        );

        return true;
    }

    if (
        command === "ping"
    ) {
        const start =
            Date.now();

        const sent =
            await reply(
                sock,
                groupId,
                "🏓 Pinging...",
                msg
            );

        const ms =
            Date.now() -
            start;

        if (sent) {
            await reply(
                sock,
                groupId,
                `🏓 *PONG!*\n\n⚡ Response: ${ms} ms\n🤖 PIYAS BOT`,
                sent
            );
        }

        return true;
    }

    if (
        command === "deal" ||
        command === "ডিল"
    ) {
        await reply(
            sock,
            groupId,
            `
╭━━━━━━━━━━━━━━━━━━━━╮
💰 *DEAL*
╰━━━━━━━━━━━━━━━━━━━━╯

📢 Deal information-এর জন্য
Admin-এর সাথে যোগাযোগ করুন।

🤍 *PIYAS BOT*
`.trim(),
            msg
        );

        return true;
    }

    if (
        command === "piyas"
    ) {
        await reply(
            sock,
            groupId,
            piyasText(),
            msg
        );

        return true;
    }

    if (
        command === "website"
    ) {
        await reply(
            sock,
            groupId,
            `
🌐 *PIYAS WEBSITE*

${WEBSITE_URL}

🤖 *PIYAS BOT*
`.trim(),
            msg
        );

        return true;
    }

    /* =====================================================
       REPORT
    ===================================================== */

    if (
        command === "report"
    ) {
        const mentioned =
            getMentionedJids(
                msg.message
            );

        if (
            !mentioned.length
        ) {
            await reply(
                sock,
                groupId,
                "⚠️ ব্যবহার করুন:\n/report @user কারণ",
                msg
            );

            return true;
        }

        const target =
            mentioned[0];

        const reason =
            args
                .filter(
                    arg =>
                        !arg.startsWith("@")
                )
                .join(" ")
                .trim();

        if (!reason) {
            await reply(
                sock,
                groupId,
                "⚠️ Report করার সময় কারণ লিখুন।",
                msg
            );

            return true;
        }

        addReport(
            groupId,
            sender,
            target,
            reason
        );

        await reply(
            sock,
            groupId,
            `
🚨 *REPORT SUBMITTED*

👤 Target: @${jidToPhone(target) || target}
📝 Reason: ${reason}

Admin বিষয়টি দেখতে পারবেন।

🤖 *PIYAS BOT*
`.trim(),
            msg
        );

        return true;
    }

    /* =====================================================
       ADMIN PANEL
    ===================================================== */

    if (
        command ===
        "adminpanel"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 এই Command শুধুমাত্র Admin/Owner-এর জন্য।",
                msg
            );

            return true;
        }

        await reply(
            sock,
            groupId,
            adminPanelText(),
            msg
        );

        return true;
    }

    if (
        command ===
        "cmdlist"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 এই Command শুধুমাত্র Admin/Owner-এর জন্য।",
                msg
            );

            return true;
        }

        await reply(
            sock,
            groupId,
            commandListText(),
            msg
        );

        return true;
    }

    /* =====================================================
       BOT ON
    ===================================================== */

    if (
        [
            "on",
            "boton",
            "onbot"
        ].includes(command)
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner Bot চালু করতে পারবেন।",
                msg
            );

            return true;
        }

        setBotStatus(
            groupId,
            true
        );

        await reply(
            sock,
            groupId,
            "✅ *PIYAS BOT চালু করা হয়েছে।*",
            msg
        );

        return true;
    }

    /* =====================================================
       BOT OFF
    ===================================================== */

    if (
        [
            "off",
            "botoff",
            "offbot"
        ].includes(command)
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner Bot বন্ধ করতে পারবেন।",
                msg
            );

            return true;
        }

        setBotStatus(
            groupId,
            false
        );

        await reply(
            sock,
            groupId,
            "⛔ *PIYAS BOT বন্ধ করা হয়েছে।*\n\nAdmin control commands চালু থাকবে।",
            msg
        );

        return true;
    }

    /* =====================================================
       FULL BOT STATUS
    ===================================================== */

    if (
        command ===
        "fullbotstatus"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner এই Command ব্যবহার করতে পারবেন।",
                msg
            );

            return true;
        }

        const botStatus =
            isBotEnabled(
                groupId
            );

        const welcomeStatus =
            isWelcomeEnabled(
                groupId
            );

        const blacklist =
            getBlacklist(
                groupId
            );

        await reply(
            sock,
            groupId,
            `
╭━━━━━━━━━━━━━━━━━━━━╮
🤖 *BOT STATUS*
╰━━━━━━━━━━━━━━━━━━━━╯

🤖 Bot:
${
    botStatus
        ? "🟢 ON"
        : "🔴 OFF"
}

👋 Welcome:
${
    welcomeStatus
        ? "🟢 ON"
        : "🔴 OFF"
}

🚫 Blacklist:
${blacklist.length} User

🔗 Link Moderation:
🟢 Active

📩 Duplicate Spam:
🟢 Active

⏱️ Duplicate Window:
*1 Minute*

🤖 Gemini Text Moderation:
${
    GEMINI_KEYS.length &&
    GEMINI_MODERATION_ENABLED &&
    TEXT_MODERATION_ENABLED
        ? "🟢 Active"
        : "⚪ Disabled"
}

🖼️ Gemini Image Moderation:
${
    GEMINI_KEYS.length &&
    GEMINI_MODERATION_ENABLED &&
    IMAGE_MODERATION_ENABLED
        ? "🟢 Active"
        : "⚪ Disabled"
}

🔑 Gemini Keys:
${GEMINI_KEYS.length}

🧠 Model:
${GEMINI_MODEL}

━━━━━━━━━━━━━━━━━━━━━━
`.trim(),
            msg
        );

        return true;
    }

    /* =====================================================
       WELCOME ON
    ===================================================== */

    if (
        command ===
        "welcomeon"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner Welcome চালু করতে পারবেন।",
                msg
            );

            return true;
        }

        setWelcomeStatus(
            groupId,
            true
        );

        await reply(
            sock,
            groupId,
            "✅ *Welcome System চালু হয়েছে।*",
            msg
        );

        return true;
    }

    /* =====================================================
       WELCOME OFF
    ===================================================== */

    if (
        command ===
        "welcomeoff"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner Welcome বন্ধ করতে পারবেন।",
                msg
            );

            return true;
        }

        setWelcomeStatus(
            groupId,
            false
        );

        await reply(
            sock,
            groupId,
            "⛔ *Welcome System বন্ধ হয়েছে।*",
            msg
        );

        return true;
    }

    /* =====================================================
       BLACKLIST CONTROL
    ===================================================== */

    if (
        command === "allowback" ||
        command === "unleave"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner এই Command ব্যবহার করতে পারবেন।",
                msg
            );

            return true;
        }

        const mentioned =
            getMentionedJids(
                msg.message
            );

        if (
            !mentioned.length
        ) {
            await reply(
                sock,
                groupId,
                "⚠️ ব্যবহার করুন:\n/allowback @user",
                msg
            );

            return true;
        }

        const target =
            mentioned[0];

        const removed =
            removeFromBlacklist(
                groupId,
                {
                    id: target
                }
            );

        await reply(
            sock,
            groupId,
            removed
                ? "✅ User-কে Blacklist থেকে Remove করা হয়েছে।"
                : "ℹ️ এই User Blacklist-এ ছিল না।",
            msg
        );

        return true;
    }

    /* =====================================================
       REPORT LIST
    ===================================================== */

    if (
        command === "reports"
    ) {
        if (!admin) {
            await reply(
                sock,
                groupId,
                "🚫 শুধুমাত্র Admin/Owner Reports দেখতে পারবেন।",
                msg
            );

            return true;
        }

        await reply(
            sock,
            groupId,
            getReportsText(
                groupId
            ),
            msg
        );

        return true;
    }

    return true;
}

/* =========================================================
   WARNING TEXT
========================================================= */

function spamWarningText() {
    return `
╭━━━━━━━━━━━━━━━━━━━━╮
⚠️ *SPAM WARNING*
╰━━━━━━━━━━━━━━━━━━━━╯

🚫 একই Message বারবার পাঠানো অনুমোদিত নয়।

🗑️ আপনার Spam Message
সাথে সাথে Remove করা হয়েছে।

⏱️ একই Message *১ মিনিটের মধ্যে*
আবার পাঠালে Spam হিসেবে
ধরা হবে।

⚠️ আবার Spam করলে Admin
প্রয়োজনীয় ব্যবস্থা নিতে পারেন।

🤍 *PIYAS BOT*
`.trim();
}

async function sendModerationWarning(
    sock,
    groupId,
    sender,
    type
) {
    let text = "";

    if (
        type === "link"
    ) {
        text = `
╭━━━━━━━━━━━━━━━━━━━━╮
🚫 *LINK WARNING*
╰━━━━━━━━━━━━━━━━━━━━╯

🔗 Group-এ Link Share করা
অনুমোদিত নয়।

🗑️ আপনার Message Remove করা হয়েছে।

⚠️ পুনরায় Link Share করলে
Admin প্রয়োজনীয় ব্যবস্থা নিতে পারেন।

🤍 *PIYAS BOT*
`.trim();
    }

    if (
        type === "badword"
    ) {
        text = `
╭━━━━━━━━━━━━━━━━━━━━╮
🚫 *WARNING*
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ অশালীন ভাষা ব্যবহার করা
অনুমোদিত নয়।

🗑️ আপনার Message Remove করা হয়েছে।

🤍 *PIYAS BOT*
`.trim();
    }

    if (
        type === "ai-text"
    ) {
        text = `
╭━━━━━━━━━━━━━━━━━━━━╮
🤖 *AI MODERATION*
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ আপনার Message Group-এর
Safety Rules ভঙ্গ করেছে।

🗑️ Message Remove করা হয়েছে।

🚫 অশালীন ভাষা, যৌন হয়রানি,
হুমকি, Sexual Violence,
Explicit Content বা অন্য
ক্ষতিকর Content অনুমোদিত নয়।

🤍 *PIYAS BOT*
`.trim();
    }

    if (
        type === "image"
    ) {
        text = `
╭━━━━━━━━━━━━━━━━━━━━╮
🔞 *IMAGE WARNING*
╰━━━━━━━━━━━━━━━━━━━━╯

⚠️ 18+/Explicit Image
Group-এ অনুমোদিত নয়।

🗑️ Image Remove করা হয়েছে।

🤍 *PIYAS BOT*
`.trim();
    }

    if (text) {
        try {
            await sock.sendMessage(
                groupId,
                {
                    text,
                    mentions: [
                        sender
                    ]
                }
            );
        } catch (error) {
            console.error(
                "WARNING SEND ERROR:",
                error.message
            );
        }
    }
}

/* =========================================================
   MESSAGE MODERATION
========================================================= */

async function moderateMessage(
    sock,
    msg,
    groupId,
    sender
) {
    if (
        !groupId ||
        !msg?.message
    ) {
        return false;
    }

    const admin =
        await isAdminOrOwner(
            sock,
            groupId,
            sender
        );

    if (admin) {
        return false;
    }

    const botAdmin =
        await isBotAdmin(
            sock,
            groupId
        );

    if (!botAdmin) {
        console.log(
            "Bot is not admin. Cannot delete messages."
        );

        return false;
    }

    const text =
        getMessageText(
            msg.message
        );

    /* =====================================================
       LOCAL BAD WORD
    ===================================================== */

    if (
        text &&
        containsBadWord(text)
    ) {
        await deleteMessage(
            sock,
            groupId,
            msg.key
        );

        await sendModerationWarning(
            sock,
            groupId,
            sender,
            "badword"
        );

        return true;
    }

    /* =====================================================
       LINK
    ===================================================== */

    if (
        text &&
        containsLink(text)
    ) {
        await deleteMessage(
            sock,
            groupId,
            msg.key
        );

        await sendModerationWarning(
            sock,
            groupId,
            sender,
            "link"
        );

        return true;
    }

    /* =====================================================
       DUPLICATE SPAM
    ===================================================== */

    if (
        text &&
        isDuplicateSpam(
            groupId,
            sender,
            text
        )
    ) {
        await deleteMessage(
            sock,
            groupId,
            msg.key
        );

        await sock.sendMessage(
            groupId,
            {
                text:
                    spamWarningText(),

                mentions: [
                    sender
                ]
            }
        );

        return true;
    }

    /* =====================================================
       GEMINI TEXT
    ===================================================== */

    if (
        text &&
        GEMINI_MODERATION_ENABLED &&
        TEXT_MODERATION_ENABLED &&
        GEMINI_KEYS.length
    ) {
        const result =
            await moderateText(
                text
            );

        if (
            result.flagged
        ) {
            console.log(
                "GEMINI TEXT VIOLATION:",
                {
                    sender,
                    violation:
                        result.violation,
                    severity:
                        result.severity,
                    reason:
                        result.reason
                }
            );

            await deleteMessage(
                sock,
                groupId,
                msg.key
            );

            await sendModerationWarning(
                sock,
                groupId,
                sender,
                "ai-text"
            );

            return true;
        }
    }

    /* =====================================================
       IMAGE MODERATION
    ===================================================== */

    const imageMessage =
        msg.message
            ?.imageMessage;

    if (
        imageMessage &&
        GEMINI_MODERATION_ENABLED &&
        IMAGE_MODERATION_ENABLED &&
        GEMINI_KEYS.length
    ) {
        try {
            const buffer =
                await downloadMediaMessage(
                    msg,
                    "buffer",
                    {},
                    {
                        logger:
                            P({
                                level:
                                    "silent"
                            }),

                        reuploadRequest:
                            sock.updateMediaMessage
                    }
                );

            if (buffer) {
                const result =
                    await moderateImage(
                        buffer,
                        imageMessage.mimetype ||
                        "image/jpeg"
                    );

                if (
                    result.flagged
                ) {
                    console.log(
                        "GEMINI IMAGE VIOLATION:",
                        {
                            sender,
                            violation:
                                result.violation,
                            severity:
                                result.severity,
                            reason:
                                result.reason
                        }
                    );

                    await deleteMessage(
                        sock,
                        groupId,
                        msg.key
                    );

                    await sendModerationWarning(
                        sock,
                        groupId,
                        sender,
                        "image"
                    );

                    return true;
                }
            }

        } catch (error) {
            console.error(
                "IMAGE PROCESS ERROR:",
                error.message
            );
        }
    }

    return false;
}

/* =========================================================
   MESSAGE HANDLER
========================================================= */

async function handleMessage(
    sock,
    msg
) {
    try {
        if (!msg?.message) {
            return;
        }

        /*
           Ignore bot's own messages.
           This prevents the bot from moderating itself.
        */

        if (
            msg.key?.fromMe
        ) {
            return;
        }

        const remoteJid =
            msg.key?.remoteJid;

        if (
            !isGroupJid(
                remoteJid
            )
        ) {
            return;
        }

        const groupId =
            remoteJid;

        if (
            !isAllowedGroup(
                groupId
            )
        ) {
            return;
        }

        const sender =
            cleanJid(
                msg.key?.participant ||
                msg.participant ||
                ""
            );

        if (!sender) {
            return;
        }

        cacheIdentity({
            id: sender
        });

        const metadata =
            await getGroupMetadata(
                sock,
                groupId
            );

        if (!metadata) {
            return;
        }

        const text =
            getMessageText(
                msg.message
            );

        const parsed =
            parseCommand(
                text
            );

        const command =
            parsed.command;

        if (
            !isBotEnabled(
                groupId
            ) &&
            !ADMIN_CONTROL_COMMANDS.includes(
                command
            )
        ) {
            return;
        }

        /*
           Commands MUST start with /
        */

        if (
            text.startsWith("/")
        ) {
            await handleCommand(
                sock,
                msg,
                groupId,
                sender,
                text,
                metadata
            );

            return;
        }

        /*
           Normal messages go through moderation.
        */

        await moderateMessage(
            sock,
            msg,
            groupId,
            sender
        );

    } catch (error) {
        console.error(
            "MESSAGE HANDLER ERROR:",
            error
        );
    }
}

/* =========================================================
   GROUP UPDATE
========================================================= */

async function handleGroupUpdate(
    sock,
    update
) {
    try {
        const groupId =
            update?.id;

        if (
            !groupId ||
            !isGroupJid(groupId)
        ) {
            return;
        }

        console.log(
            "GROUP UPDATED:",
            groupId
        );

    } catch (error) {
        console.error(
            "GROUP UPDATE ERROR:",
            error.message
        );
    }
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server =
    http.createServer(
        (
            req,
            res
        ) => {
            res.writeHead(
                200,
                {
                    "Content-Type":
                        "text/plain; charset=utf-8"
                }
            );

            res.end(
                "WhatsApp Bot Running Successfully!"
            );
        }
    );

server.listen(
    PORT,
    () => {
        console.log(
            `HTTP Server running on port ${PORT}`
        );
    }
);

/* =========================================================
   START BOT
========================================================= */

let reconnecting =
    false;

async function startBot() {
    try {
        const {
            state,
            saveCreds
        } =
            await useMultiFileAuthState(
                AUTH_DIR
            );

        const {
            version
        } =
            await fetchLatestBaileysVersion();

        const sock =
            makeWASocket({
                version,

                auth:
                    state,

                logger:
                    P({
                        level:
                            "silent"
                    }),

                printQRInTerminal:
                    false,

                browser: [
                    "PIYAS BOT",
                    "Chrome",
                    "1.0.0"
                ],

                generateHighQualityLinkPreview:
                    true,

                syncFullHistory:
                    false,

                markOnlineOnConnect:
                    false
            });

        sock.ev.on(
            "creds.update",
            saveCreds
        );

        console.log(
            "================================"
        );

        console.log(
            "Gemini Keys:",
            GEMINI_KEYS.length
        );

        console.log(
            "Gemini Model:",
            GEMINI_MODEL
        );

        console.log(
            "Gemini Moderation:",
            GEMINI_MODERATION_ENABLED
                ? "ON"
                : "OFF"
        );

        console.log(
            "Text Moderation:",
            TEXT_MODERATION_ENABLED
                ? "ON"
                : "OFF"
        );

        console.log(
            "Image Moderation:",
            IMAGE_MODERATION_ENABLED
                ? "ON"
                : "OFF"
        );

        console.log(
            "================================"
        );

        sock.ev.on(
            "connection.update",
            async ({
                connection,
                lastDisconnect
            }) => {
                if (
                    connection ===
                    "open"
                ) {
                    reconnecting =
                        false;

                    console.log(
                        "================================"
                    );

                    console.log(
                        "PIYAS BOT CONNECTED SUCCESSFULLY"
                    );

                    console.log(
                        "Bot JID:",
                        getBotJid(sock)
                    );

                    console.log(
                        "Bot Phone:",
                        getBotPhone(sock)
                    );

                    console.log(
                        "Gemini Keys:",
                        GEMINI_KEYS.length
                    );

                    console.log(
                        "================================"
                    );

                    try {
                        const groups =
                            await sock.groupFetchAllParticipating();

                        for (
                            const groupId
                            of Object.keys(
                                groups || {}
                            )
                        ) {
                            await loadGroupParticipants(
                                sock,
                                groupId
                            );
                        }

                        console.log(
                            "Group participant cache loaded."
                        );

                    } catch (error) {
                        console.error(
                            "GROUP CACHE ERROR:",
                            error.message
                        );
                    }
                }

                if (
                    connection ===
                    "close"
                ) {
                    const statusCode =
                        new Boom(
                            lastDisconnect
                                ?.error
                        )?.output
                            ?.statusCode;

                    const loggedOut =
                        statusCode ===
                        DisconnectReason.loggedOut;

                    console.error(
                        "Connection closed.",
                        {
                            statusCode,
                            loggedOut
                        }
                    );

                    if (
                        loggedOut
                    ) {
                        console.error(
                            "WhatsApp session logged out. Delete auth_info and pair again."
                        );

                        return;
                    }

                    if (
                        !reconnecting
                    ) {
                        reconnecting =
                            true;

                        console.log(
                            "Reconnecting in 3 seconds..."
                        );

                        await sleep(
                            3000
                        );

                        reconnecting =
                            false;

                        startBot();
                    }
                }
            }
        );

        /* =================================================
           PARTICIPANT UPDATE
        ================================================= */

        sock.ev.on(
            "group-participants.update",
            async update => {
                await handleParticipantUpdate(
                    sock,
                    update
                );
            }
        );

        /* =================================================
           GROUP UPDATE
        ================================================= */

        sock.ev.on(
            "groups.update",
            async updates => {
                for (
                    const update
                    of updates || []
                ) {
                    await handleGroupUpdate(
                        sock,
                        update
                    );
                }
            }
        );

        /* =================================================
           MESSAGES
        ================================================= */

        sock.ev.on(
            "messages.upsert",
            async ({
                messages,
                type
            }) => {
                if (
                    type !==
                    "notify"
                ) {
                    return;
                }

                for (
                    const msg
                    of messages || []
                ) {
                    await handleMessage(
                        sock,
                        msg
                    );
                }
            }
        );

        return sock;

    } catch (error) {
        console.error(
            "START BOT ERROR:",
            error
        );

        await sleep(
            5000
        );

        return startBot();
    }
}

/* =========================================================
   PROCESS HANDLERS
========================================================= */

process.on(
    "uncaughtException",
    error => {
        console.error(
            "UNCAUGHT EXCEPTION:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "UNHANDLED REJECTION:",
            error
        );
    }
);

process.on(
    "SIGINT",
    () => {
        console.log(
            "Bot shutting down..."
        );

        process.exit(0);
    }
);

process.on(
    "SIGTERM",
    () => {
        console.log(
            "Bot shutting down..."
        );

        process.exit(0);
    }
);

/* =========================================================
   RUN
========================================================= */

startBot();