#!/usr/bin/env node
// later: one shared list of the work you and your agents agreed to do later.
//
// Every item is one JSON file in the plugin's herdr config folder, so any agent
// in any workspace can add one while another does, without a lock. Writes go
// to a temporary file first and are renamed into place. Node built-ins only,
// so it runs the same on macOS, Linux and Windows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "mmc.later";
const MARK = "# mmc.later";
const HOME_MARKER = ".later-home";
const HERDR = process.env.HERDR_BIN_PATH || "herdr";
const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(SELF), "..");
const IS_WINDOWS = process.platform === "win32";

// ---------- herdr and paths ----------

function herdr(args) {
  const r = spawnSync(HERDR, args, { encoding: "utf8", timeout: 4000, windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

function inHerdr() {
  return process.env.HERDR_ENV === "1";
}

function dataDir() {
  if (process.env.LATER_HOME) return process.env.LATER_HOME;
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) return process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (fs.existsSync(path.join(path.dirname(SELF), HOME_MARKER))) return path.dirname(SELF);
  return herdr(["plugin", "config-dir", PLUGIN_ID]) || path.join(os.homedir(), ".config", "herdr", "plugins", "config", PLUGIN_ID);
}

const DATA = dataDir();
const ITEMS = path.join(DATA, "items");
const STABLE = path.join(DATA, "later.mjs");
const RUNS_STABLE = path.resolve(SELF) === path.resolve(STABLE);
const TEMPLATE = RUNS_STABLE ? path.join(DATA, "skill", "SKILL.md") : path.join(PLUGIN_ROOT, "skill", "SKILL.md");
fs.mkdirSync(ITEMS, { recursive: true });

function forwardSlashes(p) {
  return p.split(path.sep).join("/");
}

function stableCommand() {
  return `node "${forwardSlashes(STABLE)}"`;
}

function configPath() {
  if (process.env.HERDR_CONFIG_PATH) return process.env.HERDR_CONFIG_PATH;
  const candidates = [path.join(os.homedir(), ".config", "herdr", "config.toml")];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "herdr", "config.toml"));
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// ---------- items ----------

function die(message) {
  process.stderr.write(`later: ${message}\n`);
  process.exit(1);
}

function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readItems() {
  const items = [];
  for (const name of fs.readdirSync(ITEMS)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    try {
      items.push(JSON.parse(fs.readFileSync(path.join(ITEMS, name), "utf8")));
    } catch {
      // a file being written or edited by hand: shown again once it is valid
    }
  }
  return items.sort((a, b) => a.project.localeCompare(b.project) || a.created - b.created);
}

const CONTEXT_LIMIT = 64 * 1024;

function contextFile(id) {
  return path.join(ITEMS, `${id}.md`);
}

function readContext(id) {
  try {
    return fs.readFileSync(contextFile(id), "utf8");
  } catch {
    return "";
  }
}

function saveItem(item) {
  writeAtomic(path.join(ITEMS, `${item.id}.json`), JSON.stringify(item, null, 2) + "\n");
}

function newId() {
  for (;;) {
    const id = crypto.randomBytes(2).toString("hex");
    if (!fs.existsSync(path.join(ITEMS, `${id}.json`))) return id;
  }
}

function resolve(ref) {
  if (!ref) die("give an item id (see: later list)");
  const matches = readItems().filter((i) => i.id.startsWith(ref));
  if (matches.length === 0) die(`no item '${ref}'`);
  if (matches.length > 1) die(`'${ref}' matches more than one item`);
  return matches[0];
}

function age(epoch) {
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function ago(epoch) {
  const a = age(epoch);
  return a === "now" ? "just now" : `${a} ago`;
}

function projectOf(cwd) {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  return path.basename(r.status === 0 ? r.stdout.trim() : cwd);
}

function sessionId() {
  return process.env.CLAUDE_CODE_SESSION_ID || "";
}

function agentName() {
  const env = process.env;
  if (env.LATER_AGENT) return env.LATER_AGENT;
  if (env.CLAUDECODE) return "claude";
  if (Object.keys(env).some((k) => k.startsWith("CODEX_"))) return "codex";
  if (env.GEMINI_CLI) return "gemini";
  if (Object.keys(env).some((k) => k.startsWith("COPILOT_"))) return "copilot";
  return "you";
}

// Where the agent runs: the tab name in the Herdr desktop app (herdr-core tells
// each terminal its id), or the workspace label in the herdr terminal app.
function workspaceLabel() {
  if (process.env.HC_TERMINAL_ID) {
    const r = spawnSync("hc", ["ls", "--json"], { encoding: "utf8", timeout: 4000, windowsHide: true });
    try {
      const where = JSON.parse(r.stdout).terminals.find((t) => t.address === process.env.HC_TERMINAL_ID)?.where || "";
      return where.split(" / ").pop();
    } catch {
      return "";
    }
  }
  if (!inHerdr() || !process.env.HERDR_WORKSPACE_ID) return "";
  try {
    return JSON.parse(herdr(["workspace", "get", process.env.HERDR_WORKSPACE_ID]) || "{}").result?.workspace?.label || "";
  } catch {
    return "";
  }
}

function agentLabel(by) {
  if (by) return by;
  const where = workspaceLabel();
  return where ? `${agentName()} · ${where}` : agentName();
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// One agent at a time may change an item: a lock folder can be created by only
// one process, on every system. A lock older than 10 seconds is left over from
// a crash and is taken over.
function withLock(id, fn) {
  const lock = path.join(ITEMS, `.lock-${id}`);
  for (let tries = 0; ; tries++) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      } catch {
        continue;
      }
      if (tries > 100) die(`item ${id} is busy, try again`);
      sleepMs(30);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function isMine(item, label) {
  return !item.for || label.toLowerCase().includes(item.for.toLowerCase());
}

// ---------- commands ----------

function parseFlags(args, flags) {
  const values = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const flag = flags[args[i]];
    if (!flag) rest.push(args[i]);
    else if (flag.boolean) values[flag.name] = true;
    else values[flag.name] = args[++i];
  }
  return { values, rest };
}

function cmdAdd(args) {
  const { values, rest } = parseFlags(args, {
    "-p": { name: "project" }, "--project": { name: "project" },
    "-n": { name: "note" }, "--note": { name: "note" }, "-b": { name: "note" }, "--brief": { name: "note" },
    "--for": { name: "for" },
    "--by": { name: "by" },
    "--session": { name: "session", boolean: true },
    "--context-file": { name: "contextFile" },
  });
  const text = rest.join(" ").trim();
  if (!text) die('usage: later add "what to do" [--project name] [--brief "…"] [--context-file file|-] [--session] [--for agent]');

  let context = "";
  if (values.contextFile) {
    try {
      context = fs.readFileSync(values.contextFile === "-" ? 0 : values.contextFile, "utf8").trim();
    } catch (e) {
      die(`could not read the context: ${e.message}`);
    }
    if (Buffer.byteLength(context) > CONTEXT_LIMIT) die(`the context is over ${CONTEXT_LIMIT / 1024} KB; keep it to what a new agent needs`);
  }
  const label = agentLabel(values.by);
  const now = Math.floor(Date.now() / 1000);

  const item = {
    id: newId(),
    text,
    project: values.project || projectOf(process.cwd()),
    note: values.note || "",
    for: values.for || "",
    addedBy: values.by || agentName(),
    workspace: workspaceLabel(),
    agent: agentName(),
    session: sessionId(),
    pane: process.env.HERDR_PANE_ID || "",
    cwd: process.cwd(),
    created: now,
    status: values.session ? "reserved" : "open",
    takenBy: values.session ? label : null,
    takenAt: values.session ? now : null,
    hasContext: Boolean(context),
    doneAt: null,
  };
  if (context) writeAtomic(contextFile(item.id), context + "\n");
  saveItem(item);
  console.log(`added ${item.id}  ${item.text}  [${item.project}]${values.session ? `  reserved for ${label} (this session)` : ""}${context ? "  (with context)" : ""}`);

  if (inHerdr()) {
    herdr(["notification", "show", `Later · ${item.project}`, "--body",
      `${item.text} (from ${item.addedBy}${item.workspace ? " · " + item.workspace : ""})`, "--sound", "none"]);
  }
}

function setStatus(ref, status) {
  const { id } = resolve(ref);
  return withLock(id, () => {
    const item = resolve(id);
    item.status = status;
    item.doneAt = status === "done" ? Math.floor(Date.now() / 1000) : null;
    if (status === "open") { item.takenBy = null; item.takenAt = null; }
    saveItem(item);
    return item;
  });
}

function cmdStatus(args, status) {
  if (args.length === 0) die(`usage: later ${status === "done" ? "done" : "reopen"} <id>...`);
  for (const ref of args) {
    const item = setStatus(ref, status);
    console.log(`${status} ${item.id}  ${item.text}`);
  }
}

function printItem(i) {
  console.log(`${i.id}  ${i.text}`);
  console.log(`  project: ${i.project}    folder: ${i.cwd}`);
  const status = i.status === "progress" ? `in progress · ${i.takenBy} (taken ${ago(i.takenAt)})`
    : i.status === "reserved" ? `reserved · ${i.takenBy} (this session)` : i.status;
  console.log(`  status: ${status}${i.for ? `    for: ${i.for}` : ""}`);
  console.log(`  added by: ${[i.addedBy, i.workspace].filter(Boolean).join(" · ")}, ${ago(i.created)}`);
  if (i.note) console.log(`  brief: ${i.note}`);
  if (i.session) console.log(`  session: ${i.session}${i.agent === "claude" ? `   (resume: claude --resume ${i.session})` : ""}`);
  const context = readContext(i.id);
  if (context) console.log(`\n--- context ---\n${context}\n---------------`);
}

function cmdShow(args) {
  if (args.length === 0) die("usage: later show <id>");
  for (const ref of args) printItem(resolve(ref));
}

// Marks an item in progress for this agent. Refuses an item that is done or
// that another agent has, so two agents never work on the same one.
function cmdTake(args) {
  const { values, rest } = parseFlags(args, { "--by": { name: "by" } });
  if (rest.length !== 1) die('usage: later take <id> [--by "agent · tab"]');
  const label = agentLabel(values.by);
  const { id } = resolve(rest[0]);
  const { item, refused } = withLock(id, () => {
    const i = resolve(id);
    if (i.status === "done") return { refused: `${i.id} is already done` };
    if (i.status === "progress" && i.takenBy !== label) return { refused: `${i.id} is in progress · ${i.takenBy} (taken ${ago(i.takenAt)})` };
    if (i.status === "reserved" && i.takenBy !== label) return { refused: `${i.id} is reserved for ${i.takenBy} (its session)` };
    i.status = "progress";
    i.takenBy = label;
    i.takenAt = Math.floor(Date.now() / 1000);
    saveItem(i);
    return { item: i };
  });
  if (refused) die(refused);
  console.log(`taken ${item.id} by ${label}`);
  if (!isMine(item, label)) console.log(`note: this item is for ${item.for}`);
  printItem(item);
}

function cmdUnassign(args) {
  if (args.length === 0) die("usage: later unassign <id>...");
  for (const ref of args) {
    const item = setStatus(ref, "open");
    console.log(`unassigned ${item.id}  ${item.text} (open again)`);
  }
}

function copyToClipboard(text) {
  const tries = IS_WINDOWS ? [["clip", []]]
    : process.platform === "darwin" ? [["pbcopy", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  return tries.some(([cmd, a]) => spawnSync(cmd, a, { input: text, windowsHide: true }).status === 0);
}

function cmdCopy(args) {
  const item = resolve(args[0]);
  if (!copyToClipboard(item.id)) die("no clipboard program found");
  console.log(`copied ${item.id}`);
}

function cmdRm(args) {
  if (args.length === 0) die("usage: later rm <id>...");
  for (const ref of args) {
    const item = resolve(ref);
    fs.rmSync(path.join(ITEMS, `${item.id}.json`), { force: true });
    fs.rmSync(contextFile(item.id), { force: true });
    console.log(`removed ${item.id}`);
  }
}

function cmdList(args) {
  const { values } = parseFlags(args, {
    "-a": { name: "all", boolean: true }, "--all": { name: "all", boolean: true },
    "-p": { name: "project" }, "--project": { name: "project" },
    "--here": { name: "here", boolean: true },
    "--available": { name: "available", boolean: true },
    "--json": { name: "json", boolean: true },
  });
  const project = values.here ? projectOf(process.cwd()) : values.project;
  const label = values.available ? agentLabel() : "";
  const items = readItems().filter((i) =>
    (values.all || i.status !== "done") &&
    (!project || i.project === project) &&
    (!values.available || (i.status === "open" && isMine(i, label))));

  if (values.json) return console.log(JSON.stringify(items.map((i) => ({ ...i, context: i.hasContext ? readContext(i.id) : "" })), null, 2));
  if (items.length === 0) return console.log(values.available ? "nothing available for you" : "nothing for later");

  let last = null;
  for (const i of items) {
    if (i.project !== last) {
      if (last !== null) console.log("");
      console.log(i.project);
      last = i.project;
    }
    const where = [i.addedBy, i.workspace, age(i.created)].filter(Boolean).join(" · ");
    const box = { done: "[x]", progress: "[~]", reserved: "[r]" }[i.status] || "[ ]";
    const state = [i.status === "progress" ? `in progress · ${i.takenBy}` : "", i.status === "reserved" ? `reserved · ${i.takenBy} (this session)` : "",
      i.for ? `for ${i.for}` : "", i.hasContext ? "context" : ""].filter(Boolean).join(", ");
    console.log(`  ${box} ${i.id}  ${i.text}  (${where})${state ? `  [${state}]` : ""}`);
    if (i.note) console.log(`         ${i.note}`);
  }
}

function cmdCount() {
  process.stdout.write(`☐ ${readItems().filter((i) => i.status !== "done").length} later`);
}

// ---------- the pane: a live list ----------

const C = { reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", blue: "\x1b[34m", yellow: "\x1b[33m", green: "\x1b[32m" };

function cut(text, width) {
  const chars = [...text];
  return chars.length <= width ? text : chars.slice(0, Math.max(0, width - 1)).join("") + "…";
}

function cmdPane() {
  const out = process.stdout;
  let showDone = false;
  let cursor = 0;
  let confirm = null;
  let selectable = [];

  function render() {
    const items = readItems();
    const rank = { reserved: 0, progress: 1, open: 2, done: 3 };
    const visible = items.filter((i) => showDone || i.status !== "done")
      .sort((a, b) => a.project.localeCompare(b.project) || rank[a.status] - rank[b.status] || a.created - b.created);
    const open = items.filter((i) => i.status !== "done").length;
    const width = Math.max(20, (out.columns || 80) - 6);
    selectable = visible.map((i) => i.id);
    cursor = Math.min(Math.max(cursor, 0), Math.max(selectable.length - 1, 0));

    const lines = [`${C.bold}${C.yellow}☐ Later${C.reset}  ${C.dim}${open} open · all workspaces${C.reset}`, ""];
    if (visible.length === 0) {
      lines.push(`  ${C.dim}Nothing for later.${C.reset}`, `  ${C.dim}Agents add items with: later add "…"${C.reset}`);
    }
    let last = null;
    visible.forEach((i, n) => {
      if (i.project !== last) {
        if (last !== null) lines.push("");
        lines.push(`${C.bold}${C.blue}${i.project}${C.reset}`);
        last = i.project;
      }
      const selected = n === cursor;
      const box = i.status === "done" ? `${C.green}☑${C.reset}` : i.status === "progress" ? `${C.yellow}◐${C.reset}` : i.status === "reserved" ? `${C.yellow}◑${C.reset}` : "☐";
      const style = (i.status === "done" ? C.dim : "") + (selected ? C.bold : "");
      const where = [i.id, i.addedBy, i.workspace, age(i.created)].filter(Boolean).join(" · ")
        + (i.status === "progress" ? ` · in progress · ${i.takenBy} ${age(i.takenAt)}` : "")
        + (i.status === "reserved" ? ` · reserved · ${i.takenBy}` : "")
        + (i.hasContext ? " · context" : "")
        + (i.for ? ` · for ${i.for}` : "");
      lines.push(`${selected ? `${C.yellow}›${C.reset}` : " "} ${box} ${style}${cut(i.text, width)}${C.reset}`);
      lines.push(`      ${C.dim}${cut(where, width - 6)}${C.reset}`);
    });
    lines.push("");
    lines.push(confirm
      ? `${C.yellow}Remove ${confirm}? y / n${C.reset}`
      : `${C.dim}j/k move · x done · u unassign · d remove · a ${showDone ? "hide" : "show"} done · q close${C.reset}`);
    out.write("\x1b[H\x1b[2J" + lines.join("\n"));
  }

  function quit() {
    out.write("\x1b[?25h\x1b[?1049l");
    process.exit(0);
  }

  out.write("\x1b[?1049h\x1b[?25l");
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on("keypress", (str, key = {}) => {
    const current = selectable[cursor];
    if (key.ctrl && key.name === "c") return quit();
    if (confirm) {
      if (str === "y") fs.rmSync(path.join(ITEMS, `${confirm}.json`), { force: true });
      confirm = null;
      return render();
    }
    if (str === "j" || key.name === "down") cursor++;
    else if (str === "k" || key.name === "up") cursor--;
    else if (str === "u" && current && ["progress", "reserved"].includes(readItems().find((i) => i.id === current)?.status)) setStatus(current, "open");
    else if ((str === "x" || key.name === "space") && current) {
      setStatus(current, readItems().find((i) => i.id === current)?.status === "done" ? "open" : "done");
    } else if (str === "d" && current) confirm = current;
    else if (str === "a") showDone = !showDone;
    else if (str === "q" || key.name === "escape") return quit();
    render();
  });

  let pending = null;
  const soon = () => {
    clearTimeout(pending);
    pending = setTimeout(render, 80);
  };
  try {
    fs.watch(ITEMS, soon);
  } catch {
    setInterval(render, 2000);
  }
  setInterval(render, 30000);
  out.on("resize", render);
  process.on("SIGTERM", quit);
  render();
}

function cmdOpenPane() {
  herdr(["plugin", "pane", "open", "--plugin", PLUGIN_ID, "--entrypoint", "list", "--placement", "split", "--direction", "right", "--no-focus"]);
}

// ---------- setting up this computer ----------

function writeIfChanged(file, text, mode) {
  try {
    if (fs.readFileSync(file, "utf8") === text) return false;
  } catch {
    // missing: written below
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, text);
  if (mode) fs.chmodSync(file, mode);
  return true;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "state.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  writeAtomic(path.join(DATA, "state.json"), JSON.stringify(state, null, 2) + "\n");
}

function skillTargets() {
  return [".claude", ".codex"]
    .map((d) => path.join(os.homedir(), d))
    .filter((d) => fs.existsSync(d))
    .map((d) => path.join(d, "skills", "later", "SKILL.md"));
}

function installSkills(log) {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const text = template.replaceAll("{{LATER}}", stableCommand());
  for (const file of skillTargets()) if (writeIfChanged(file, text)) log(`skill: ${file}`);
}

function installShim(log) {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  const candidates = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin")];
  const dir = candidates.find((c) => dirs.includes(c) && fs.existsSync(c));
  if (!dir) return;

  const file = path.join(dir, IS_WINDOWS ? "later.cmd" : "later");
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(PLUGIN_ID)) return;
  const text = IS_WINDOWS
    ? `@rem ${PLUGIN_ID}\r\n@node "${STABLE}" %*\r\n`
    : `#!/bin/sh\n# ${PLUGIN_ID}\nexec node "${STABLE}" "$@"\n`;
  if (writeIfChanged(file, text, IS_WINDOWS ? undefined : 0o755)) log(`command: ${file}`);
}

function configBlock() {
  return [
    "",
    `[[keys.command]] ${MARK}`,
    `key = "prefix+t" ${MARK}`,
    `type = "popup" ${MARK}`,
    `command = '${stableCommand()} pane' ${MARK}`,
    `description = "Later: the list of deferred work" ${MARK}`,
    `width = 80 ${MARK}`,
    `height = 24 ${MARK}`,
  ];
}

function counterEntry() {
  return `{ type = "command", command = '${stableCommand()} count', interval_seconds = 10, timeout_seconds = 3 }`;
}

function withoutOurLines(text) {
  return text.split("\n").filter((l) => !l.includes(MARK)).join("\n").replace(/\n+$/, "\n");
}

// Adds prefix+t and, when the tab bar has no right side yet, the counter. Every
// line ends with "# mmc.later" so uninstall removes exactly these. The file is
// backed up first and restored when herdr does not accept the result.
function installConfig(log) {
  const cfg = configPath();
  if (!cfg) return log("herdr config.toml not found: add prefix+t by hand (see the README)");

  const before = fs.readFileSync(cfg, "utf8");
  let lines = withoutOurLines(before).split("\n");
  const keyTaken = lines.some((l) => /^\s*key\s*=\s*"prefix\+t"/.test(l) || /=\s*"prefix\+t"/.test(l));

  if (!lines.some((l) => /^\s*tab_bar_right\s*=/.test(l))) {
    const entry = `tab_bar_right = [ ${counterEntry()} ] ${MARK}`;
    const ui = lines.findIndex((l) => /^\s*\[ui\]\s*(#.*)?$/.test(l));
    if (ui >= 0) lines.splice(ui + 1, 0, entry);
    else lines.push("", `[ui] ${MARK}`, entry);
  } else {
    log(`tab bar: tab_bar_right is already set; to show the counter add ${counterEntry()}`);
  }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!keyTaken) lines.push(...configBlock());
  else log("prefix+t is already bound: open the list with the plugin action instead");

  const after = lines.join("\n").replace(/\n*$/, "\n");
  if (after === before) return;

  fs.writeFileSync(`${cfg}.bak-later`, before);
  writeAtomic(cfg, after);
  const check = spawnSync(HERDR, ["config", "check"], { encoding: "utf8", windowsHide: true });
  if (check.status !== 0 || !/ok/.test(check.stdout)) {
    writeAtomic(cfg, before);
    return log(`herdr did not accept the change, so ${cfg} was restored`);
  }
  herdr(["server", "reload-config"]);
  log(`config: ${cfg} (backup: ${path.basename(cfg)}.bak-later)`);
}

// Runs on every herdr start. Keeps the command, the skills and the stable copy
// current. Changes config.toml only the first time, so a binding the person
// removes stays removed; "later setup" adds it again.
function cmdEnsure({ force = false, quiet = true } = {}) {
  const log = (m) => { if (!quiet) console.log(m); };
  fs.writeFileSync(path.join(DATA, HOME_MARKER), "");
  if (!RUNS_STABLE) {
    if (writeIfChanged(STABLE, fs.readFileSync(SELF, "utf8"))) log(`copy: ${STABLE}`);
    writeIfChanged(path.join(DATA, "skill", "SKILL.md"), fs.readFileSync(TEMPLATE, "utf8"));
  }
  installSkills(log);
  installShim(log);

  const state = readState();
  if (force || !state.configured) {
    installConfig(log);
    writeState({ ...state, configured: true });
  }
}

function cmdUninstall() {
  const cfg = configPath();
  if (cfg && fs.readFileSync(cfg, "utf8").includes(MARK)) {
    writeAtomic(cfg, withoutOurLines(fs.readFileSync(cfg, "utf8")));
    herdr(["server", "reload-config"]);
    console.log(`removed the later lines from ${cfg}`);
  }
  for (const file of skillTargets()) {
    if (fs.existsSync(file)) {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      console.log(`removed ${file}`);
    }
  }
  for (const file of [path.join(os.homedir(), ".local", "bin", "later"), path.join(os.homedir(), ".local", "bin", "later.cmd"), path.join(os.homedir(), "bin", "later"), path.join(os.homedir(), "bin", "later.cmd")]) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(PLUGIN_ID)) {
      fs.rmSync(file);
      console.log(`removed ${file}`);
    }
  }
  writeState({ ...readState(), configured: true });
  console.log(`your items are kept in ${ITEMS}`);
}

function usage() {
  console.log(`later: the work you and your agents agreed to do later, in one list for every herdr workspace.

  later add "text" [--project name] [--brief "…"] [--context-file file|-] [--session] [--for agent]
                            --session: reserved for this agent's session; --context-file: a handoff for a new agent
  later list [--all] [--here | --project name] [--available] [--json]
  later show <id>           the whole item, with its brief
  later take <id> [--by n]  mark it in progress for this agent (refused if another agent has it)
  later unassign <id>...    open again, so any agent can take it
  later done <id>...        mark done          later reopen <id>...   open again
  later copy <id>           copy the id        later rm <id>...       remove
  later count               the open count, for the tab bar
  later pane                the live list (herdr shows it as a pane or with prefix+t)
  later setup               set up this computer again, config.toml included
  later uninstall           undo the setup (your items stay)

Items: ${ITEMS}`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "add": cmdAdd(args); break;
  case "list": case "ls": cmdList(args); break;
  case "done": cmdStatus(args, "done"); break;
  case "reopen": cmdStatus(args, "open"); break;
  case "show": cmdShow(args); break;
  case "take": cmdTake(args); break;
  case "unassign": cmdUnassign(args); break;
  case "copy": cmdCopy(args); break;
  case "rm": case "remove": cmdRm(args); break;
  case "count": cmdCount(); break;
  case "pane": cmdPane(); break;
  case "open-pane": cmdOpenPane(); break;
  case "where": console.log(ITEMS); break;
  case "ensure": cmdEnsure(); break;
  case "setup": cmdEnsure({ force: true, quiet: false }); break;
  case "uninstall": cmdUninstall(); break;
  case undefined: case "help": case "-h": case "--help": usage(); break;
  default: die(`unknown command '${command}' (see: later help)`);
}
