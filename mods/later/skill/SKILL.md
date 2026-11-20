---
name: later
description: Keep and work the shared "later" list of to-dos, shared by every agent. Use when you and the user agree that something should be done later, not now (a follow-up, technical debt you flagged, a separate change, "let's do that next time", "add that to later"); when the user asks you to pick, take or do a to-do ("pick a to-do", "do later item 8a70"); when the user asks what is on the list; or when you finish an item you took.
---

# Later

`later` is one list of to-dos, shared by every agent in every herdr space. The user sees it live in the Later panel, so what you change appears for them at once.

Run it as:

```
{{LATER}} <command>
```

## Adding an item

Add an item when **you and the user agree** to leave something for later:

- the user says "later", "next time", "not now", "separate change", "remember this", "add it to later";
- you flagged technical debt or a follow-up and the user chose not to do it now.

Do not add an item for something you are about to do in this session, for a guess the user did not agree to, or twice for the same thing (run `list --here` first when unsure).

Another agent, with none of your context, may do the item. So write a **brief**: what to do and why, the files or classes, and what "done" means.

```
{{LATER}} add "Cap JSON request bodies above 32 MB" --brief "Nothing caps a JSON body above 32 MB. Add a servlet filter on Content-Length in configuration/. Done when a 40 MB body gets 413 and the editor tests pass."
```

- The text is a short task that starts with a verb.
- The project is the git repository of the current folder. Use `--project <name>` when the item belongs to another repository.
- Use `--for <tab name>` only when the user says which agent should do it.
- After adding, tell the user in one line: `Added to later: <text> (<id>)`.

## Picking a to-do

When the user says "pick a to-do" (or similar) without an id:

1. Run `{{LATER}} list --here --available`: the open items of this repository that are not assigned to another agent.
2. Choose the one you can do best with what you know, and tell the user which one and why, in one or two lines. If none fits, say so. Do not take anything yet.
3. Take it only after the user says yes: `{{LATER}} take <id>`.

When the user names an item ("do later item 8a70"), take it at once: `{{LATER}} take 8a70`. The command prints the whole item with its brief.

`take` is refused when another agent has the item. Then tell the user who has it, and offer another item. Never work on an item you did not take.

## Finishing

- When the work is done, run `{{LATER}} done <id>` and tell the user.
- When you stop before it is done (the user changes plans, you are blocked), run `{{LATER}} unassign <id>` so another agent can take it, and say so.

## Other commands

```
{{LATER}} show <id>          # the whole item, with its brief
{{LATER}} list --here        # this repository's items, in progress included
{{LATER}} list --all         # every project, done items too
{{LATER}} reopen <id>
{{LATER}} rm <id>            # only when the user asks
```
