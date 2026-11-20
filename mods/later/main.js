import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, hc, run, agents, knownAgents, watchFolder, notify, appHome, home, theme } from "herdr";

// Every read and write goes through the later command, the same one the agents
// and the herdr TUI plugin use, so all of them share one list.
const CLI = `${appHome()}/mods/later/bin/later.mjs`;

// The app may start programs without the PATH of an interactive shell, where
// version managers such as nvm put node. So ask the login shells, then try the
// usual install places, and keep the first node that answers.
async function works(node) {
  try {
    return (await exec(node, ["--version"], { timeout: 5000 })).code === 0;
  } catch {
    return false;
  }
}

async function findNode() {
  const saved = localStorage.getItem("node");
  if (saved && await works(saved)) return saved;
  if (await works("node")) return "node";

  for (const shell of ["/bin/zsh", "/bin/bash", "/usr/bin/fish", "/opt/homebrew/bin/fish"]) {
    try {
      const r = await exec(shell, ["-ilc", "command -v node"], { timeout: 8000 });
      const found = r.stdout.trim().split("\n").pop();
      if (r.code === 0 && found && await works(found)) return found;
    } catch {
      // that shell is not installed
    }
  }
  for (const node of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", `${home()}/.volta/bin/node`]) {
    if (await works(node)) return node;
  }
  const nvm = await exec("/bin/sh", ["-c", `ls -1d "${home()}"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1`]).catch(() => null);
  const latest = nvm?.stdout.trim();
  if (latest && await works(latest)) return latest;
  return null;
}

const STALE_SECONDS = 4 * 3600;

function taskFor(i) {
  return `Do later item ${i.id}: ${i.text}. Use the later skill: take it first (later take ${i.id}), do the work, then mark it done.`;
}

function age(epoch) {
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default class Later extends View {
  init(_props, cx) {
    this.items = [];
    this.known = null;
    this.showDone = false;
    this.confirm = null;
    this.picker = null;
    this.problem = null;
    this.loading = true;
    this.programs = [];
    try { this.collapsed = new Set(JSON.parse(localStorage.getItem("collapsed") ?? "[]")); } catch { this.collapsed = new Set(); }
    cx.spawn(async (cx) => {
      try { this.programs = (await knownAgents()).filter((p) => p.installed); } catch {}
      cx.notify();
    });
    cx.spawn(async (cx) => {
      this.node = await findNode();
      if (!this.node) {
        this.problem = "Later needs Node.js 18 or later. Install it from nodejs.org, then restart the Herdr app.";
        this.loading = false;
        cx.notify();
        return;
      }
      try { localStorage.setItem("node", this.node); } catch {}
      try {
        const setup = await this.later(["ensure"]);
        if (setup.code !== 0) throw new Error(setup.stderr.trim() || "the later command failed");
        this.folder = (await this.later(["where"])).stdout.trim();
      } catch (e) {
        this.problem = `Later could not start: ${e}`;
        this.loading = false;
        cx.notify();
        return;
      }
      await this.load(cx);
      for (;;) {
        try {
          await watchFolder(this.folder);
        } catch {
          return;
        }
        await this.load(cx);
      }
    });
    cx.timer.every(60000, (cx) => cx.notify());
  }

  later(args) {
    return exec(this.node, [CLI, ...args], { timeout: 10000 });
  }

  async load(cx) {
    try {
      const r = await this.later(["list", "--all", "--json"]);
      if (r.code !== 0) throw new Error(r.stderr.trim());
      const items = JSON.parse(r.stdout);
      if (this.known) {
        for (const i of items) {
          const was = this.known.get(i.id);
          if (!was) notify({ title: `Later · ${i.project}`, body: `${i.text} (from ${i.addedBy})`, level: "info", timeout: 6000 });
          else if (was !== "progress" && i.status === "progress") notify({ title: `Taken · ${i.project}`, body: `${i.text} (${i.takenBy})`, level: "info", timeout: 5000 });
        }
      }
      for (const i of items) if (i.status === "progress" && this.known?.get(i.id) !== "progress") this.expand(i.project);
      this.known = new Map(items.map((i) => [i.id, i.status]));
      this.items = items;
      this.problem = null;
    } catch (e) {
      this.problem = `Could not read the list: ${e}`;
    }
    this.loading = false;
    cx.notify();
  }

  act(args, cx) {
    cx.spawn(async (cx) => {
      const r = await this.later(args);
      if (r.code !== 0) this.problem = r.stderr.trim();
      await this.load(cx);
    });
  }

  expand(project) {
    if (!this.collapsed.delete(project)) return;
    this.saveCollapsed();
  }

  toggleGroup(project) {
    if (this.collapsed.has(project)) this.collapsed.delete(project); else this.collapsed.add(project);
    this.saveCollapsed();
  }

  saveCollapsed() {
    try { localStorage.setItem("collapsed", JSON.stringify([...this.collapsed])); } catch {}
  }

  startAgent(i, program) {
    this.picker = null;
    run("tab.new", { name: `Later ${i.id}`, folder: i.cwd || undefined, argv: program.run, task: taskFor(i) });
    notify({ title: `Started ${program.name}`, body: `Later ${i.id}: ${i.text}`, level: "info", timeout: 5000 });
  }

  sendTo(i, agent, cx) {
    this.picker = null;
    cx.spawn(async (cx) => {
      const r = await hc(["send", "--if", "idle", agent.address, taskFor(i)]);
      if (r.code !== 0) this.problem = `${agent.tab_name || agent.address} is busy. Send it when the agent is idle. ${r.stderr.trim()}`;
      else notify({ title: `Sent to ${agent.tab_name || agent.address}`, body: i.text, level: "info", timeout: 5000 });
      cx.notify();
    });
  }

  copy(i, cx) {
    cx.spawn(async (cx) => {
      const r = await this.later(["copy", i.id]);
      if (r.code !== 0) this.problem = r.stderr.trim();
      else notify({ title: `Copied ${i.id}`, body: `Tell any agent: "do later item ${i.id}"`, level: "info", timeout: 4000 });
      cx.notify();
    });
  }

  button(id, label, t, onClick, strong) {
    return div().id(id).px(7).py(1).rounded(5).border_1().border_color(t.border).bg(t.raised).cursor_pointer()
      .text_size(11).text_color(strong ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground).border_color(t.accent))
      .on_click(onClick).child(label);
  }

  chip(label, color, t) {
    return div().px(6).rounded(999).border_1().border_color(color).text_size(10.5).text_color(color).child(label);
  }

  pickerRow(i, t) {
    if (this.picker?.id !== i.id) return null;
    if (this.picker.kind === "start") {
      return v_flex().mt(4).gap(2).child(div().text_size(11).text_color(t.dim).child(`Start a new agent in ${i.project}`))
        .child(h_flex().gap(4).flex_wrap().children(this.programs.length
          ? this.programs.map((p) => this.button(`later-start-${i.id}-${p.key}`, p.name, t, () => this.startAgent(i, p), true))
          : [div().text_size(11).text_color(t.dim).child("No agent programs found")]));
    }
    const open = agents();
    return v_flex().mt(4).gap(2).child(div().text_size(11).text_color(t.dim).child("Send to an open agent"))
      .child(h_flex().gap(4).flex_wrap().children(open.length
        ? open.map((a) => this.button(`later-send-${i.id}-${a.address}`, `${a.tab_name || a.address}${a.status === "working" ? " (busy)" : ""}`, t, (_e, cx) => this.sendTo(i, a, cx), a.status !== "working"))
        : [div().text_size(11).text_color(t.dim).child("No agents are open")]));
  }

  row(i, t) {
    const done = i.status === "done";
    const taken = i.status === "progress";
    const stale = taken && Math.floor(Date.now() / 1000) - i.takenAt > STALE_SECONDS;
    const asking = this.confirm === i.id;
    const meta = [i.id, i.addedBy, i.workspace, age(i.created)].filter(Boolean).join(" · ");
    const pick = (kind) => (_e, cx) => { this.picker = this.picker?.id === i.id && this.picker.kind === kind ? null : { id: i.id, kind }; cx.notify(); };
    const chips = [];
    if (taken) chips.push(this.chip(`in progress · ${i.takenBy}`, t.blocked, t));
    if (stale) chips.push(this.chip(`taken ${age(i.takenAt)} ago`, t.ansi1, t));
    if (i.for && !done && !taken) chips.push(this.chip(`for ${i.for}`, t.ansi5, t));
    const actions = done ? [] : taken
      ? [this.button(`later-unassign-${i.id}`, "Unassign", t, (_e, cx) => this.act(["unassign", i.id], cx)), this.button(`later-copy-${i.id}`, "Copy id", t, (_e, cx) => this.copy(i, cx))]
      : [this.button(`later-startbtn-${i.id}`, "Start agent", t, pick("start")), this.button(`later-sendbtn-${i.id}`, "Send to…", t, pick("send")), this.button(`later-copy-${i.id}`, "Copy id", t, (_e, cx) => this.copy(i, cx))];

    return h_flex().id(`later-${i.id}`).flex_none().px(8).py(6).gap(8).items_start().rounded(7).hover((s) => s.bg(t.hover))
      .child(div().id(`later-box-${i.id}`).w(16).flex_none().cursor_pointer().text_color(done ? t.ansi2 : taken ? t.blocked : t.muted)
        .on_click((_e, cx) => this.act([done ? "reopen" : "done", i.id], cx)).child(done ? "☑" : taken ? "◐" : "☐"))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_color(done ? t.dim : t.foreground).when(done, (e) => e.line_through()).child(i.text))
        .when(Boolean(i.note) && !done, (e) => e.child(div().pl(8).border_l(2).border_color(t.border).text_size(11.5).text_color(t.muted).child(i.note)))
        .child(div().text_size(11).text_color(t.dim).truncate().child(meta))
        .when(chips.length > 0, (e) => e.child(h_flex().gap(4).flex_wrap().children(chips)))
        .when(actions.length > 0, (e) => e.child(h_flex().gap(3).flex_wrap().pt(2).children(actions)))
        .children([this.pickerRow(i, t)].filter(Boolean)))
      .child(asking
        ? h_flex().flex_none().gap(6).text_size(11)
          .child(div().id(`later-yes-${i.id}`).cursor_pointer().text_color(t.ansi1).on_click((_e, cx) => { this.confirm = null; this.act(["rm", i.id], cx); }).child("Remove"))
          .child(div().id(`later-no-${i.id}`).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.confirm = null; cx.notify(); }).child("Keep"))
        : div().id(`later-rm-${i.id}`).flex_none().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.confirm = i.id; cx.notify(); }).child("×"));
  }

  render(cx) {
    const t = theme();
    const rank = { progress: 0, open: 1, done: 2 };
    const open = this.items.filter((i) => i.status !== "done").length;
    const shown = this.items.filter((i) => this.showDone || i.status !== "done")
      .sort((a, b) => a.project.localeCompare(b.project) || rank[a.status] - rank[b.status] || a.created - b.created);
    const groups = [];
    for (const i of shown) {
      if (groups.at(-1)?.project !== i.project) groups.push({ project: i.project, items: [] });
      groups.at(-1).items.push(i);
    }
    const allClosed = groups.length > 0 && groups.every((g) => this.collapsed.has(g.project));

    const empty = this.problem || (this.loading ? "Loading…" : "Nothing for later. When you and an agent agree to do something later, it appears here.");
    return v_flex().id("later").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Later"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${open} open`))
        .child(div().flex_1())
        .when(groups.length > 0, (e) => e.child(div().id("later-collapse-all").cursor_pointer().text_size(11).text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            for (const g of groups) if (allClosed) this.collapsed.delete(g.project); else this.collapsed.add(g.project);
            this.saveCollapsed();
            cx.notify();
          }).child(allClosed ? "Expand all" : "Collapse all")))
        .child(div().id("later-show-done").cursor_pointer().text_size(11).text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); }).child(this.showDone ? "Hide done" : "Show done")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("later-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .when(shown.length === 0, (e) => e.child(div().p(8).text_color(this.problem ? t.ansi1 : t.dim).child(empty)))
          .children(groups.map((g) => {
            const closed = this.collapsed.has(g.project);
            const gOpen = g.items.filter((i) => i.status !== "done").length;
            const gTaken = g.items.filter((i) => i.status === "progress").length;
            return v_flex().flex_none().gap(2).pb(4)
              .child(h_flex().id(`later-group-${g.project}`).px(8).py(4).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
                .on_click((_e, cx) => { this.toggleGroup(g.project); cx.notify(); })
                .child(div().w(10).text_size(10).text_color(t.dim).child(closed ? "▸" : "▾"))
                .child(div().text_size(11).font_semibold().text_color(t.accent).child(g.project))
                .child(div().text_size(10).text_color(t.dim).child(`${gOpen} open`))
                .when(gTaken > 0, (e) => e.child(div().text_size(10).text_color(t.blocked).child(`· ${gTaken} in progress`))))
              .when(!closed, (e) => e.children(g.items.map((i) => this.row(i, t))));
          })))
        .child(Scrollbar.vertical("later-list").absolute().inset_0()))
      .when(Boolean(this.problem) && shown.length > 0, (e) => e.child(h_flex().px(12).py(6).gap(8).items_start()
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.ansi1).child(this.problem))
        .child(div().id("later-problem-x").cursor_pointer().text_size(11).text_color(t.dim).on_click((_e, cx) => { this.problem = null; cx.notify(); }).child("×"))));
  }
}
