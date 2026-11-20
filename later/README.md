# later

A herdr mod: one shared list of the work you and your agents agreed to do **later**.

This is the mod for the herdr terminal app. For the Herdr desktop app, use the mod in [`../mods/later`](../mods/later/RECIPE.md); both show the same list.

While you talk to an agent, you often agree that something is for another day: a follow-up, technical debt, a separate change. `later` keeps those items in one list that every agent, in every herdr workspace, can add to, and shows it live next to your agents.

```
☐ Later  3 open · all workspaces

api-service
› ◐ Write the migration for the orders table
      3bc9 · claude · Backend · 1d · in progress · codex · Database
  ☐ Cap JSON request bodies above 32 MB
      ff63 · claude · Backend · 2h · context

web-app
  ☐ Show the order history on the profile page
      682d · claude · Frontend · 5d · context

j/k move · x done · u unassign · d remove · a show done · q close
```

## Install

```sh
herdr plugin install mmcorrelo/herdr-mmc-mods/later
```

Restart herdr, and it works. macOS, Linux and Windows; it needs Node.js 18 or later on your `PATH`.

## This session or a new one

When you defer something, the agent decides who does it, and asks you only when your words do not say:

- **This session**: the agent will do it itself before the conversation ends. It adds the item with `--session`; the item is **reserved** for that agent and other agents skip it.
- **A new session**: another agent will do it, so the agent writes a **context** for it (Goal, Why, Background, Where, Done when, Watch out) and saves it with the item (`--context-file`). It writes the context itself and asks you only for a decision that is missing.

Each item from Claude Code also keeps the id of the session where it was added, so the desktop panel can **resume** that conversation.

## Agents doing the to-dos

Tell an agent **"pick a to-do"**: it lists the open items of its repository, proposes one and says why, and takes it only after you say yes. Or name one: **"do later item 8a70"**. When it finishes it marks the item done; when it stops early it unassigns it.

## Use

- **`prefix+t`** opens the list as a popup. Press `q` to close it.
- The **"Later: open the list beside this pane"** action opens it as a split pane that stays open.
- **`☐ 3 later`** in the tab bar shows the open count (see *What it sets up*).
- Tell your agent "add that to later", or just agree to leave something for later: Claude Code and Codex agents know when to add an item.

In the list: `j`/`k` or the arrows move, `x` marks done (or open again), `u` unassigns an item in progress, `d` removes, `a` shows or hides done items, `q` closes.

## How it works

1. You and an agent agree to do something later.
2. The agent runs `later add "…"`. Its skill tells it when.
3. The item is saved as one small JSON file in this plugin's herdr config folder (`herdr plugin config-dir mmc.later`, then `items/`). One file per item, so two agents can add at the same time.
4. The list watches the folder and redraws at once. herdr shows a notification with the item and who added it.

An item's project is the git repository the agent works in, so the list groups itself by project.

## What it sets up

Each time herdr starts, the mod makes sure that:

- a stable copy of the command is in its config folder, so agents can call it with a path that does not change when the mod updates
- the agent skill is in `~/.claude/skills/later/` (Claude Code) and `~/.codex/skills/later/` (Codex), for the ones you have installed
- a `later` command is in `~/.local/bin` or `~/bin`, when one of them is on your `PATH`

The **first** time only, it adds to herdr's `config.toml`, backing the file up as `config.toml.bak-later` and restoring it if herdr does not accept the result:

- `prefix+t` for the popup, unless you already use that key
- the tab bar counter, if your tab bar's right side is still empty; otherwise it prints the entry to add yourself:

  ```toml
  { type = "command", command = 'later count', interval_seconds = 10, timeout_seconds = 3 }
  ```

Every line it adds ends with `# mmc.later`. If you remove them, they stay removed; the **"Later: set up this computer again"** action adds them back. The **"Later: undo the setup"** action removes the lines, the skills and the command. Your items stay.

## Commands

```
later add "text" [--project name] [--brief "…"] [--context-file file|-] [--session] [--for agent] [--by name]
later list [--all] [--here | --project name] [--available] [--json]
later show <id>        later take <id> [--by name]     later unassign <id>...
later done <id>...     later reopen <id>...            later rm <id>...
later copy <id>        later count                     later pane
later setup            later uninstall
```

`take` marks an item in progress for the agent that runs it and is refused when another agent already has it, so two agents never work on the same item (a lock makes this safe when they try at the same moment). `unassign` makes it open again. `list --available` shows the open items that are not assigned to another agent with `--for`. `show` prints an item's context; `list --json` includes it. A context is a markdown file next to the item (`items/<id>.md`), at most 64 KB.

An id can be shortened to any unique prefix. `LATER_HOME` moves the item folder, for example to try the mod without touching your list.
