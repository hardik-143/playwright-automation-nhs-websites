const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "dashboard-public")));
app.use("/test-results", express.static(path.join(__dirname, "test-results")));
app.use("/trace-viewer", express.static(path.join(__dirname, "node_modules/playwright-core/lib/vite/traceViewer")));

const TEST_DATA_PATH = path.join(__dirname, "tests/fixtures/test-data.ts");
const PHARMACIES_PATH = path.join(__dirname, "tests/fixtures/pharmacies.ts");

// ── Pharmacy + test discovery ─────────────────────────────────────────────────

function readPharmacies() {
  const src = fs.readFileSync(PHARMACIES_PATH, "utf8");
  const list = [];
  const lines = src.split("\n");
  let cur = null;
  for (const line of lines) {
    const nameM  = line.match(/\bname\s*:\s*["']([^"']+)["']/);
    const urlM   = line.match(/\bbaseURL\s*:\s*["']([^"']+)["']/);
    const skipM  = line.match(/\bciSkip\s*:\s*(true|false)/);
    const projM  = line.match(/\bsanityProjectId\s*:\s*["']([^"']+)["']/);
    // Only start a new entry on name: lines inside the PHARMACY_SITES array
    // (interface fields have no string literal after the colon, so nameM won't match there)
    if (nameM) cur = { name: nameM[1], baseURL: "", ciSkip: false };
    if (cur && urlM)  cur.baseURL = urlM[1];
    if (cur && skipM) cur.ciSkip  = skipM[1] === "true";
    if (cur && projM) cur.sanityProjectId = projM[1];
    if (cur && cur.baseURL && /^\s*\},?\s*$/.test(line)) {
      list.push({ ...cur });
      cur = null;
    }
  }
  return list;
}

let _testListCache = null;
let _testListCacheAt = 0;
const TEST_LIST_TTL_MS = 30_000;
let lastRunStartTime = 0;
const activeProcs = new Map(); // runId → { proc, startTime }
const completedRunIds = new Set(); // prevent EventSource auto-reconnect from restarting tests
const MAX_RUN_MS = 10 * 60 * 1000; // 10-minute hard timeout per run

function flattenSuites(suites, parentTitles = [], depth = 0) {
  const out = [];
  for (const s of suites || []) {
    // Skip file-level suite title (depth 0); keep describe titles
    const titles = depth === 0 ? parentTitles : [...parentTitles, s.title].filter(Boolean);
    for (const spec of s.specs || []) {
      out.push({
        title: spec.title,
        fullTitle: [...titles, spec.title].filter(Boolean).join(" > "),
        file: spec.file || s.file || "",
        line: spec.line || 0,
      });
    }
    if (s.suites) out.push(...flattenSuites(s.suites, titles, depth + 1));
  }
  return out;
}

function listTests() {
  if (_testListCache && Date.now() - _testListCacheAt < TEST_LIST_TTL_MS) {
    return Promise.resolve(_testListCache);
  }
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["playwright", "test", "--list", "--reporter=json"], {
      cwd: __dirname,
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c.toString()));
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.on("close", () => {
      try {
        const json = JSON.parse(out);
        // Dedupe by fullTitle (same test repeats per project)
        const all = flattenSuites(json.suites || []);
        const seen = new Set();
        const unique = [];
        for (const t of all) {
          const key = `${t.file}::${t.fullTitle}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(t);
          }
        }
        _testListCache = unique;
        _testListCacheAt = Date.now();
        resolve(unique);
      } catch (e) {
        reject(new Error(`Failed to list tests: ${e.message}\n${err}`));
      }
    });
  });
}

// ── Flow configs (mirrors flow-configs.ts — JS copy for dashboard) ────────────
const FLOW_CONFIGS = [
  { name: "NHS — next available slot",              group: "NHS",     conditionJourneyType: "nhs" },
  { name: "NHS — specific date and time",           group: "NHS",     conditionJourneyType: "nhs" },
  { name: "Private — next available slot, new card",  group: "Private", conditionJourneyType: "private" },
  { name: "Private — next available slot, saved card", group: "Private", conditionJourneyType: "private" },
  { name: "Private — specific date, new card",      group: "Private", conditionJourneyType: "private" },
  { name: "Private — specific date, saved card",    group: "Private", conditionJourneyType: "private" },
];

// ── Journey flows (mirrors journey-flows.ts — JS copy for dashboard) ─────────
const JOURNEY_FLOWS_JS = [
  { id: "F1", pattern: ["sign_up", "questionnaire_submit", "appointment_booking"] },
  { id: "F2", pattern: ["questionnaire_submit", "sign_up", "appointment_booking"] },
  { id: "F3", pattern: ["questionnaire_submit", "appointment_booking", "sign_up"] },
  { id: "F4", pattern: ["sign_up", "appointment_booking"] },
  { id: "F5", pattern: ["appointment_booking", "sign_up"] },
];

function normaliseUserJourneyFlow(raw) {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw)) return raw;
  return Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map(k => raw[k]);
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function fetchSanityConditions(projectId) {
  const query = `
    *[
      _type == 'singleCondition' && 
      conditionLogStatus != 'disabled' && 
      status != 'disabled' && 
      categoryType == 'pre_consult'
    ]{
      userJourneyFlow, 
      title, 
      conditionId, 
      corporateId, 
      categoryType,
      "isNHS": categoryType == 'pre_consult' && services == 'NHS'
    }
  `;
  const url = `https://${projectId}.api.sanity.io/v2026-05-13/data/query/dev?query=${encodeURIComponent(query)}&perspective=drafts`;
  // console.log(`Fetching conditions from Sanity project ${projectId}...`,url);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: "application/json" } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Sanity returned HTTP ${res.statusCode}`));
      }
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data).result || []); }
        catch (e) { reject(new Error(`Sanity parse error: ${e.message}`)); }
      });
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Sanity request timed out")); });
    req.on("error", reject);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readTestData() {
  const src = fs.readFileSync(TEST_DATA_PATH, "utf8");

  // Direct literal: key: "value"
  const get = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*"([^"]*)"`));
    return m ? m[1] : "";
  };
  // Env-var pattern: TD_KEY || "fallback"  (handles both direct and cast forms)
  const getEnv = (tdKey) => {
    const m = src.match(new RegExp(`${tdKey}\\s*\\|\\|\\s*"([^"]*)"`));
    return m ? m[1] : "";
  };
  const getNum = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*(\\d+)`));
    return m ? parseInt(m[1]) : 0;
  };
  const getBool = (key) => {
    const m = src.match(new RegExp(`${key}:\\s*(true|false)`));
    return m ? m[1] === "true" : false;
  };

  // Active condition — find the uncommented journeyType line inside ACTIVE_CONDITION block
  const activeCondBlock = src.match(/ACTIVE_CONDITION\s*=\s*\{([^}]+)\}/s);
  let journeyType = "nhs";
  if (activeCondBlock) {
    const uncommented = activeCondBlock[1]
      .split("\n")
      .find((l) => l.includes("journeyType") && !l.trim().startsWith("//"));
    if (uncommented) {
      const jm = uncommented.match(/"(nhs|private|lifestyle)"/);
      if (jm) journeyType = jm[1];
    }
  }

  return {
    user: {
      gender:          getEnv("TD_GENDER"),
      firstName:       getEnv("TD_FIRST_NAME"),
      lastName:        getEnv("TD_LAST_NAME"),
      postcode:        getEnv("TD_POSTCODE"),
      email:           getEnv("TD_EMAIL"),
      phone:           getEnv("TD_PHONE"),
      guardianName:    getEnv("TD_GUARDIAN_NAME"),
      dobDay:          getEnv("TD_DOB_DAY"),
      dobMonth:        getEnv("TD_DOB_MONTH"),
      dobYear:         getEnv("TD_DOB_YEAR"),
      password:        getEnv("TD_PASSWORD"),
      confirmPassword: getEnv("TD_CONFIRM_PASSWORD"),
    },
    payment: {
      cardholderName: getEnv("TD_CARD_HOLDER"),
      cardNumber:     getEnv("TD_CARD_NUMBER"),
      expiryDate:     getEnv("TD_CARD_EXPIRY"),
      securityCode:   getEnv("TD_CARD_CVV"),
    },
    condition: { journeyType },
    appointment: {
      appointmentType: getEnv("TD_APPOINTMENT_TYPE") || "Video",
    },
    booking: {
      useNextAvailableSlot: getBool("useNextAvailableSlot"),
      preferredMonth:     get("preferredMonth"),
      preferredDate:      get("preferredDate"),
      preferredTime:      get("preferredTime"),
      autoMoveToNextDate: getBool("autoMoveToNextDate"),
      maxDateAttempts:    getNum("maxDateAttempts"),
    },
    drug: {
      strength: get("strength"),
      packSize: get("packSize"),
    },
    cart: {
      quantityAction:  get("quantityAction"),
      quantityClicks:  getNum("quantityClicks"),
      deleteProduct:   getBool("deleteProduct"),
      couponCode: (() => { const m = src.match(/couponCode:\s*"([^"]*)"/); return m ? m[1] : ""; })(),
      action: (() => { const m = src.match(/CART_PREFERENCES[\s\S]*?action:\s*"([^"]*)"/); return m ? m[1] : "Proceed To Checkout"; })(),
    },
    shipping: {
      shippingMode:   getEnv("TD_SHIP_MODE"),
      addressType:    getEnv("TD_SHIP_ADDRESS_TYPE"),
      addressLine1:   getEnv("TD_SHIP_ADDRESS1"),
      addressLine2:   getEnv("TD_SHIP_ADDRESS2"),
      townCity:       getEnv("TD_SHIP_CITY"),
      postalCode:     getEnv("TD_SHIP_POSTCODE"),
      addressAction:  getEnv("TD_SHIP_ADDRESS_ACTION"),
      paymentMethod:  getEnv("TD_PAYMENT_METHOD"),
    },
    thankYou: {
      action: (() => { const m = src.match(/THANK_YOU_PREFERENCES[\s\S]*?action:\s*"([^"]*)"/); return m ? m[1] : "My Orders"; })(),
    },
  };
}

// ── Playwright UI process ─────────────────────────────────────────────────────

const UI_PORT = 8081;
let uiProc = null;
let uiReady = false;

function launchUI() {
  if (uiProc) return { already: true };

  uiReady = false;
  uiProc = spawn(
    "npx",
    ["playwright", "test", "--ui", `--ui-host=127.0.0.1`, `--ui-port=${UI_PORT}`],
    { cwd: __dirname, env: { ...process.env } }
  );

  const onData = (chunk) => {
    const text = chunk.toString();
    if (text.includes("listening") || text.includes(String(UI_PORT)) || text.includes("Listening")) {
      uiReady = true;
    }
  };

  uiProc.stdout.on("data", onData);
  uiProc.stderr.on("data", onData);

  // Give it time to boot even if we miss the log line
  setTimeout(() => { uiReady = true; }, 4000);

  uiProc.on("close", () => {
    uiProc = null;
    uiReady = false;
  });

  return { started: true };
}

function stopUI() {
  if (!uiProc) return { already: true };
  uiProc.kill();
  uiProc = null;
  uiReady = false;
  return { stopped: true };
}

// ── Artifact discovery ───────────────────────────────────────────────────────

function findArtifactsAfter(since) {
  const dir = path.join(__dirname, "test-results");
  const artifacts = { videos: [], traces: [] };
  if (!fs.existsSync(dir)) return artifacts;

  function scan(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs >= since) {
            const url = "/" + path.relative(__dirname, full).replace(/\\/g, "/");
            if (entry.name.endsWith(".webm")) artifacts.videos.push(url);
            else if (entry.name === "trace.zip") artifacts.traces.push(url);
          }
        } catch (_) {}
      }
    }
  }

  scan(dir);
  return artifacts;
}

function findArtifactsInDir(dir) {
  const artifacts = { videos: [], traces: [] };
  if (!fs.existsSync(dir)) return artifacts;

  function scan(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        const url = "/" + path.relative(__dirname, full).replace(/\\/g, "/");
        if (entry.name.endsWith(".webm")) artifacts.videos.push(url);
        else if (entry.name === "trace.zip") artifacts.traces.push(url);
      }
    }
  }

  scan(dir);
  return artifacts;
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/test-data", (req, res) => {
  try {
    res.json(readTestData());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/test-data", (_req, res) => {
  // Test data overrides are now browser-side only (passed as env vars at run time).
  // This endpoint is kept for compatibility but does nothing.
  res.json({ ok: true });
});

app.get("/api/flow-configs", (_req, res) => {
  res.json(FLOW_CONFIGS);
});

app.get("/api/journey-conditions", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { pharmacyName } = req.query;
  if (!pharmacyName) return res.status(400).json({ error: "pharmacyName required" });
  const pharmacies = readPharmacies();
  const pharmacy = pharmacies.find(p => p.name === pharmacyName);
  if (!pharmacy) return res.status(404).json({ error: "Pharmacy not found" });
  if (!pharmacy.sanityProjectId) return res.json({ F1: [], F2: [], F3: [], F4: [], F5: [] });
  try {
    const conditions = await fetchSanityConditions(pharmacy.sanityProjectId);
// console.log(`Fetched ${conditions.length} conditions from Sanity for project ${pharmacy.sanityProjectId}`,conditions);
    const result = {};
    for (const flow of JOURNEY_FLOWS_JS) {
      result[flow.id] = conditions
        .filter(c => arraysEqual(normaliseUserJourneyFlow(c.userJourneyFlow), flow.pattern))
        .map(c => ({ conditionId: c.conditionId, title: c.title }));
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/pharmacies", (_req, res) => {
  // No-store prevents Codespaces proxy and browsers from caching stale [] responses
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    res.json(readPharmacies());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/tests", async (_req, res) => {
  try {
    const tests = await listTests();
    res.json(tests);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSE stream for running tests
app.get("/api/run-tests", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (type, data) => {
    try {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch (_) {}
  };

  const runId = req.query.runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // EventSource auto-reconnects when server closes the stream — prevent restarting a completed run
  if (completedRunIds.has(runId)) {
    send("done", { code: 0, success: true, reconnect: true, passed: "", failed: "", skipped: "", artifacts: { videos: [], traces: [] } });
    res.end();
    return;
  }

  const grep = req.query.grep;
  const project = req.query.project;
  const file = req.query.file;
  const line = req.query.line;
  const label = req.query.label;
  const tdOverridesB64 = req.query.td; // base64 JSON test data overrides from browser
  // Playwright's --grep is a regex matched against the test's own title (not the
  // describe-joined fullTitle). Use only the part after the last " > " separator,
  // and escape regex metacharacters so titles with `→`, `:`, `(`, `)`, etc. match
  // literally. Required for loop-generated tests that share the same line number.
  const grepArg = grep
    ? grep.split(" > ").pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : null;
  const parts = [];
  if (project) parts.push(project);
  parts.push(label || (file ? `${file}${line ? ":" + line : ""}` : "all tests"));
  send("start", `Starting Playwright — ${parts.join(" · ")}...`);

  const runStartTime = Date.now();
  lastRunStartTime = runStartTime;

  // Build TD_* env vars from browser-side overrides — no file modification needed
  const tdEnv = {};
  if (tdOverridesB64) {
    try {
      const td = JSON.parse(Buffer.from(tdOverridesB64, "base64").toString("utf8"));
      const u  = td.user     || {};
      const p  = td.payment  || {};
      const sh = td.shipping || {};
      const a  = td.appointment || {};
      const set = (key, val) => { if (val != null && String(val).trim() !== "") tdEnv[key] = String(val); };
      set("TD_FIRST_NAME",          u.firstName);
      set("TD_LAST_NAME",           u.lastName);
      set("TD_GENDER",              u.gender);
      set("TD_EMAIL",               u.email);
      set("TD_PHONE",               u.phone);
      set("TD_POSTCODE",            u.postcode);
      set("TD_GUARDIAN_NAME",       u.guardianName);
      set("TD_PASSWORD",            u.password);
      set("TD_CONFIRM_PASSWORD",    u.confirmPassword);
      set("TD_DOB_DAY",             u.dobDay);
      set("TD_DOB_MONTH",           u.dobMonth);
      set("TD_DOB_YEAR",            u.dobYear);
      set("TD_CARD_HOLDER",         p.cardholderName);
      set("TD_CARD_NUMBER",         p.cardNumber);
      set("TD_CARD_EXPIRY",         p.expiryDate);
      set("TD_CARD_CVV",            p.securityCode);
      set("TD_SHIP_MODE",           sh.shippingMode);
      set("TD_SHIP_ADDRESS_TYPE",   sh.addressType);
      set("TD_SHIP_ADDRESS1",       sh.addressLine1);
      set("TD_SHIP_ADDRESS2",       sh.addressLine2);
      set("TD_SHIP_CITY",           sh.townCity);
      set("TD_SHIP_POSTCODE",       sh.postalCode);
      set("TD_SHIP_ADDRESS_ACTION", sh.addressAction);
      set("TD_PAYMENT_METHOD",      sh.paymentMethod);
      set("TD_APPOINTMENT_TYPE",    a.appointmentType);
      set("USER_JOURNEY_CONDITION_ID", td.ujConditionId);
      const overrideCount = Object.keys(tdEnv).length;
      if (overrideCount > 0) {
        const summary = Object.entries(tdEnv)
          .map(([k, v]) => `${k.replace("TD_", "")}="${v}"`)
          .join(", ");
        send("log", `📋 Test data overrides (${overrideCount}): ${summary}`);
      }
    } catch (err) {
      send("log", `⚠ Could not parse test data overrides: ${err.message}`);
    }
  }

  const runOutputDir = path.join(__dirname, "test-results", `run-${runId}`);
  const args = ["playwright", "test", "--reporter=list", `--output=${runOutputDir}`];
  if (project) args.push(`--project=${project}`);
  // When grep is present it uniquely identifies the test; file:line is redundant and
  // fragile (cached line numbers go stale after spec edits). Use just the file in that
  // case. Only fall back to file:line targeting when there is no grep pattern.
  if (file) {
    args.push(grepArg ? file : line ? `${file}:${line}` : file);
    if (grepArg) args.push("--grep", grepArg);
  } else if (grepArg) {
    args.push("--grep", grepArg);
  }
  send("log", `⚙ Running: npx ${args.join(" ")}`);

  const proc = spawn("npx", args, {
    cwd: __dirname,
    env: { ...process.env, ...tdEnv },
    detached: true, // allows killing the whole process group
  });
  activeProcs.set(runId, { proc, startTime: runStartTime });

  let stdout = "";
  let stderr = "";
  let finished = false;

  // Heartbeat — keeps SSE alive and prevents proxy timeouts
  const heartbeat = setInterval(() => send("ping", null), 15_000);

  // Hard timeout — kill stuck processes after MAX_RUN_MS
  const killTimeout = setTimeout(() => {
    if (!finished) {
      send("log", `⚠ Process timed out after ${MAX_RUN_MS / 60000} minutes — killing.`);
      try { process.kill(-proc.pid, "SIGKILL"); } catch (_) { try { proc.kill("SIGKILL"); } catch (_2) {} }
    }
  }, MAX_RUN_MS);

  // Strip ANSI colour/style escape codes (e.g. ␛[32m, ␛[2m) from log lines.
  const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
  function stripAnsi(line) {
    return line.replace(ANSI_RE, "");
  }

  // Lines from Playwright's failure output that are redundant noise in the
  // dashboard log stream (traces/artifacts are surfaced via the artifacts panel).
  function isNoisyLine(line) {
    const t = line.trim();
    return (
      /^Error Context:\s+test-results\//i.test(t) ||
      /^attachment\s+#\d+:/i.test(t) ||
      /^test-results\/run-run-/i.test(t) ||
      /^Usage:$/i.test(t) ||
      /playwright show-trace/i.test(t) ||
      /^─{8,}/.test(t)
    );
  }

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    text.split("\n").forEach((line) => {
      const clean = stripAnsi(line);
      if (clean.trim() && !isNoisyLine(clean)) send("log", clean);
    });
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    text.split("\n").forEach((line) => {
      const clean = stripAnsi(line);
      if (clean.trim() && !isNoisyLine(clean)) send("log", clean);
    });
  });

  proc.on("exit", (code) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    clearTimeout(killTimeout);
    activeProcs.delete(runId);
    completedRunIds.add(runId);
    // Trim completedRunIds to avoid unbounded growth
    if (completedRunIds.size > 500) {
      const [oldest] = completedRunIds;
      completedRunIds.delete(oldest);
    }
    // Force-drain stdio — browser subprocesses can hold pipes open even after playwright exits
    try { proc.stdout.destroy(); } catch (_) {}
    try { proc.stderr.destroy(); } catch (_) {}
    // Delay scan to allow Playwright to finish flushing .webm video files to disk
    setTimeout(() => {
      const passed = (stdout.match(/\d+ passed/)?.[0] || "").trim();
      const failed = (stdout.match(/\d+ failed/)?.[0] || "").trim();
      const skipped = (stdout.match(/\d+ skipped/)?.[0] || "").trim();
      const artifacts = findArtifactsInDir(runOutputDir);
      send("done", { code, passed, failed, skipped, success: code === 0, artifacts });
      res.end();
    }, 1500);
  });

  req.on("close", () => {
    // Client disconnected — only kill if not already finished
    if (!finished) {
      activeProcs.delete(runId);
      try { process.kill(-proc.pid, "SIGKILL"); } catch (_) { try { proc.kill(); } catch (_2) {} }
    }
    clearInterval(heartbeat);
    clearTimeout(killTimeout);
  });
});

app.get("/api/latest-artifacts", (req, res) => {
  res.json(findArtifactsAfter(lastRunStartTime - 1000));
});

app.post("/api/stop-test", (req, res) => {
  const { runId } = req.body || {};
  if (runId) {
    const entry = activeProcs.get(runId);
    if (!entry) return res.json({ stopped: false, reason: "run not found" });
    try { process.kill(-entry.proc.pid, "SIGKILL"); } catch (_) {
      try { entry.proc.kill("SIGKILL"); } catch (_2) {}
    }
    activeProcs.delete(runId);
    return res.json({ stopped: true });
  }
  // Stop all
  let count = 0;
  for (const [, entry] of activeProcs) {
    try { process.kill(-entry.proc.pid, "SIGKILL"); } catch (_) {
      try { entry.proc.kill("SIGKILL"); } catch (_2) {}
    }
    count++;
  }
  activeProcs.clear();
  res.json({ stopped: count > 0, count });
});

app.post("/api/launch-ui", (_req, res) => {
  res.json({ ...launchUI(), port: UI_PORT });
});

app.post("/api/stop-ui", (_req, res) => {
  res.json(stopUI());
});

app.get("/api/ui-status", (_req, res) => {
  res.json({ running: !!uiProc, ready: uiReady, port: UI_PORT });
});

app.get("/api/last-result", (req, res) => {
  const lastRun = path.join(__dirname, "test-results/.last-run.json");
  if (fs.existsSync(lastRun)) {
    res.json(JSON.parse(fs.readFileSync(lastRun, "utf8")));
  } else {
    res.json(null);
  }
});

// ── Serve dashboard ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard-public/index.html"));
});

const PORT = 7890;
app.listen(PORT, () => {
  console.log(`\n  Dashboard running at http://localhost:${PORT}\n`);
});
