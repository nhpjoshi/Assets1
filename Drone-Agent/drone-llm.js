const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");

const LOG_DIR = "/Users/nitish.joshi/Documents/Assets1/Drone-Agent/drone-logs";
const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const MAVLINK_URL = "http://127.0.0.1:8000/mode";
const MODEL = "qwen2.5:0.5b";

const VALID_ACTIONS = [
    "RTL",
    "LAND",
    "LOITER",
    "GUIDED",
    "AUTO",
    "NONE"
];

/* -----------------------------
   TELEMETRY
----------------------------- */

function getLatestTelemetry() {

    const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.endsWith(".jsonl"))
        .map(f => ({
            name: f,
            time: fs.statSync(
                path.join(LOG_DIR, f)
            ).mtimeMs
        }))
        .sort((a, b) => b.time - a.time);

    if (!files.length) {
        throw new Error(
            "No telemetry logs found"
        );
    }

    const latestFile = path.join(
        LOG_DIR,
        files[0].name
    );

    const lines = fs.readFileSync(
        latestFile,
        "utf8"
    )
    .split("\n")
    .filter(Boolean);

    for (
        let i = lines.length - 1;
        i >= 0;
        i--
    ) {
        try {
            return JSON.parse(
                lines[i]
            );
        }
        catch (e) {}
    }

    throw new Error(
        "No valid telemetry found"
    );
}

/* -----------------------------
   HEALTH CHECK
----------------------------- */

function getHealth(t) {

    const health = {
        status: "UNKNOWN",
        battery: "UNKNOWN",
        gps: "UNKNOWN",
        recommendation: ""
    };

    if (!t.connected) {

        health.status =
            "DISCONNECTED";

        health.recommendation =
            "Flight controller not connected.";

        return health;
    }

    if (t.voltage >= 11.5)
        health.battery = "GOOD";
    else if (t.voltage >= 10.8)
        health.battery = "LOW";
    else
        health.battery = "CRITICAL";

    if (
        t.gps_fix === "3D FIX" ||
        t.sats >= 8
    ) {
        health.gps = "GOOD";
    } else {
        health.gps = "NO FIX";
    }

    health.status = "READY";

    return health;
}

/* -----------------------------
   FAST-PATH KEYWORD DETECTION
   (skips the LLM entirely for
   exact / near-exact commands —
   fast and 100% deterministic)
----------------------------- */

function detectActionFastPath(command) {

    const text = command.toLowerCase().trim();

    const table = [
        { action: "RTL",    words: ["rtl", "return to launch"] },
        { action: "LAND",   words: ["land"] },
        { action: "LOITER", words: ["loiter"] },
        { action: "GUIDED", words: ["guided"] },
        { action: "AUTO",   words: ["auto"] }
    ];

    for (const entry of table) {
        if (entry.words.some(w => text === w || text.includes(w))) {
            return entry.action;
        }
    }

    return null;
}

/* -----------------------------
   INTENT ROUTER
   (STATUS vs everything else —
   still cheap keyword check, no
   need for the LLM here)
----------------------------- */

function isStatusRequest(command) {

    const text = command.toLowerCase();

    const statusWords = [
        "health",
        "status",
        "battery",
        "gps",
        "telemetry",
        "condition"
    ];

    return statusWords.some(
        word => text.includes(word)
    );
}

/* -----------------------------
   MAVLINK
----------------------------- */

async function sendMode(mode) {

    try {
        const res = await axios.post(
            MAVLINK_URL,
            { mode },
            { timeout: 10000 }
        );

        return res.data;
    } catch (err) {
        console.log(
            `\n❌ Failed to send ${mode}: ${err.message}`
        );
        return null;
    }
}

/* -----------------------------
   LLM ACTION CLASSIFIER
   Forces strict JSON output so
   natural-language commands like
   "come back home" / "hover" /
   "hold position" still map to
   a real flight mode.
----------------------------- */

async function classifyAction(command) {

    const prompt = `
You are a flight command classifier for a drone.
Map the user's message to exactly one of these actions:

RTL     - return to launch / come home / go back / bring it home
LAND    - land now / put it down
LOITER  - hover / hold position / stay here / pause in place
GUIDED  - switch to guided mode
AUTO    - switch to auto / mission mode
NONE    - not a flight command (greetings, questions, chit-chat)

Examples:
"come back to home location" -> {"action":"RTL"}
"bring the drone home" -> {"action":"RTL"}
"hover it" -> {"action":"LOITER"}
"hold position" -> {"action":"LOITER"}
"how's the battery" -> {"action":"NONE"}
"hello" -> {"action":"NONE"}

Respond with ONLY a JSON object of the form {"action": "<ACTION>"}.
No explanation, no extra text.

User message: "${command}"
`;

    try {

        const response = await axios.post(
            OLLAMA_URL,
            {
                model: MODEL,
                prompt,
                stream: false,
                format: "json",
                options: {
                    temperature: 0
                }
            },
            {
                timeout: 30000
            }
        );

        const parsed = JSON.parse(
            response.data.response
        );

        if (VALID_ACTIONS.includes(parsed.action)) {
            return parsed.action;
        }

        return "NONE";

    } catch (err) {
        console.log(
            `\n⚠️ Action classification failed: ${err.message}`
        );
        return "NONE";
    }
}

/* -----------------------------
   HUMAN CHAT / STATUS EXPLAIN
----------------------------- */

async function askLLM(question, telemetry, health) {

    const prompt = `
You are an onboard drone assistant.

Current telemetry:

${JSON.stringify(telemetry, null, 2)}

Drone health:

${JSON.stringify(health, null, 2)}

Instructions:

- Answer naturally.
- Never invent battery values.
- Never invent GPS status.
- If telemetry is unavailable,
  clearly explain that.
- Keep responses under 100 words.
- Do NOT return JSON.

User:
${question}
`;

    const response = await axios.post(
        OLLAMA_URL,
        {
            model: MODEL,
            prompt,
            stream: false,
            options: {
                temperature: 0.3
            }
        },
        {
            timeout: 120000
        }
    );

    return response.data.response;
}

async function askChat(question) {

    const prompt = `
You are a friendly drone assistant embedded on a real physical drone.
Never claim you are unable to interact with the drone -- you are the
drone's onboard copilot.

Respond naturally and briefly.

Do not discuss telemetry,
GPS, battery, flight status,
or drone health unless asked.

User:
${question}
`;

    const response = await axios.post(
        OLLAMA_URL,
        {
            model: MODEL,
            prompt,
            stream: false,
            options: {
                temperature: 0.3
            }
        }
    );

    return response.data.response;
}

/* -----------------------------
   STATUS REPORT
----------------------------- */

function printStatus(telemetry, health) {

    console.log("\n🚁 Drone Status\n");
    console.log(`Connected : ${telemetry.connected}`);
    console.log(`GPS Fix   : ${telemetry.gps_fix}`);
    console.log(`Satellites: ${telemetry.sats}`);
    console.log(`Voltage   : ${telemetry.voltage}`);
    console.log(`Altitude  : ${telemetry.alt}`);
    console.log(`Health    : ${health.status}`);
}

/* -----------------------------
   MAIN COMMAND PROCESSOR
----------------------------- */

async function processCommand(command) {

    const telemetry = getLatestTelemetry();
    const health = getHealth(telemetry);

    // 1. Fast-path exact keyword match (no LLM round trip)
    let action = detectActionFastPath(command);

    // 2. Status requests
    if (!action && isStatusRequest(command)) {

        printStatus(telemetry, health);

        const reply = await askLLM(command, telemetry, health);

        console.log("\n🤖 Drone Health\n");
        console.log(reply);

        return;
    }

    // 3. Natural-language action classification via LLM
    if (!action) {
        const classified = await classifyAction(command);
        if (classified !== "NONE") {
            action = classified;
        }
    }

    // 4. Dispatch the action if we found one
    if (action) {

        if (!telemetry.connected && action !== "RTL") {
            console.log("\n❌ Drone not connected");
            return;
        }

        const result = await sendMode(action);

        if (result !== null) {
            console.log(`\n🚁 ${action} sent`);
        }

        return;
    }

    // 5. Plain conversation
    const reply = await askChat(command);

    console.log("\n🤖 Assistant\n");
    console.log(reply);
}

/* -----------------------------
   MAIN LOOP
----------------------------- */

async function startAgent() {

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log("\n🚁 Drone Copilot Ready");
    console.log("Type exit to quit\n");

    const ask = () => {

        rl.question("Command> ", async cmd => {

            try {

                if (cmd.toLowerCase() === "exit") {
                    process.exit(0);
                }

                await processCommand(cmd);

            } catch (err) {
                console.error("\nERROR:", err.message);
            }

            ask();
        });
    };

    ask();
}

startAgent();