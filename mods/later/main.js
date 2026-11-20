import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, watchFolder, notify, appHome, home, theme } from "herdr";

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
    this.problem = null;
    this.loading = true;
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
          if (!this.known.has(i.id)) notify({ title: `Later · ${i.project}`, body: `${i.text} (from ${i.addedBy})`, level: "info", timeout: 6000 });
        }
      }
      this.known = new Set(items.map((i) => i.id));
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

  row(i, t) {
    const done = i.status === "done";
    const asking = this.confirm === i.id;
    const meta = [i.id, i.addedBy, i.workspace, age(i.created)].filter(Boolean).join(" · ");
    return h_flex().id(`later-${i.id}`).flex_none().px(8).py(6).gap(8).items_start().rounded(7).hover((s) => s.bg(t.hover))
      .child(div().id(`later-box-${i.id}`).w(16).flex_none().cursor_pointer().text_color(done ? t.ansi2 : t.muted)
        .on_click((_e, cx) => this.act([done ? "reopen" : "done", i.id], cx)).child(done ? "☑" : "☐"))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_color(done ? t.dim : t.foreground).when(done, (e) => e.line_through()).child(i.text))
        .when(Boolean(i.note), (e) => e.child(div().text_size(11).text_color(t.muted).child(i.note)))
        .child(div().text_size(11).text_color(t.dim).truncate().child(meta)))
      .child(asking
        ? h_flex().flex_none().gap(6).text_size(11)
          .child(div().id(`later-yes-${i.id}`).cursor_pointer().text_color(t.ansi1).on_click((_e, cx) => { this.confirm = null; this.act(["rm", i.id], cx); }).child("Remove"))
          .child(div().id(`later-no-${i.id}`).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.confirm = null; cx.notify(); }).child("Keep"))
        : div().id(`later-rm-${i.id}`).flex_none().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.confirm = i.id; cx.notify(); }).child("×"));
  }

  render(cx) {
    const t = theme();
    const open = this.items.filter((i) => i.status === "open").length;
    const shown = this.items.filter((i) => this.showDone || i.status === "open");
    const groups = [];
    for (const i of shown) {
      if (groups.at(-1)?.project !== i.project) groups.push({ project: i.project, items: [] });
      groups.at(-1).items.push(i);
    }

    const empty = this.problem || (this.loading ? "Loading…" : "Nothing for later. When you and an agent agree to do something later, it appears here.");
    return v_flex().id("later").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Later"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${open} open`))
        .child(div().flex_1())
        .child(div().id("later-show-done").cursor_pointer().text_size(11).text_color(t.muted).hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); }).child(this.showDone ? "Hide done" : "Show done")))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("later-list").absolute().inset_0().overflow_y_scroll().p(6).gap(2)
          .when(shown.length === 0, (e) => e.child(div().p(8).text_color(this.problem ? t.ansi1 : t.dim).child(empty)))
          .children(groups.map((g) => v_flex().flex_none().gap(2).pb(6)
            .child(h_flex().px(8).pt(6).pb(2).gap(6).items_center()
              .child(div().text_size(11).font_semibold().text_color(t.accent).child(g.project))
              .child(div().text_size(10).text_color(t.dim).child(`${g.items.filter((i) => i.status === "open").length} open`)))
            .children(g.items.map((i) => this.row(i, t))))))
        .child(Scrollbar.vertical("later-list").absolute().inset_0()))
      .when(Boolean(this.problem) && shown.length > 0, (e) => e.child(div().px(12).py(6).text_size(11).text_color(t.ansi1).child(this.problem)));
  }
}
