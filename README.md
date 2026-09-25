# Clocktrace

Clocktrace records where your time goes on your Mac, and on your iPhone and iPad. There is no dashboard. You ask your AI app, for example "how much time did I spend coding this week?", and it answers from your own data.

## What it records

- The app in front on your Mac, its window title, and the URL in Safari, Chrome, Brave, and Edge.
- The apps you use on your iPhone and iPad, through Apple's Screen Time sync. Only app names and times arrive, no URLs.

All data stays in one file on your Mac, `~/Library/Application Support/clocktrace/clocktrace.db`. Clocktrace sends only one thing out: the ID of an iPhone or iPad app, to Apple's App Store, to look up its name. When you ask a question, your AI app sends the answer to its model, as it does with any chat. Private browser windows get no title and no URL. After 15 minutes with no keyboard or mouse input, the time is not counted, unless the app in front keeps the screen on, as a video or a call does, for at most 3 hours.

## What you need

- A Mac with Apple silicon, on macOS 27.
- One AI app that Clocktrace can connect to: Claude Code, Codex, Hermes Agent, or OpenClaw.
- For iPhone and iPad time: the same Apple Account on every device, and **Share Across Devices** on in Screen Time, on the iPhone or iPad and on the Mac.

## Install

A Homebrew install comes with the first release. Until then, install from source. You need Node 22.12 or newer, pnpm 9, and the Xcode Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/linhvu0711/clocktrace.git
cd clocktrace
pnpm install
pnpm build
cd apps/cli && pnpm link --global
```

`pnpm link --global` puts the `clocktrace` command on your PATH. If pnpm says there is no global bin directory, run `pnpm setup` once, open a new terminal, and try again. Keep the folder where it is: the app and the AI app registrations point into it. If you move it, run `clocktrace setup` again.

## Set up

```sh
clocktrace setup
```

`setup` does all of it in one run:

1. It creates the database and starts the Collector, the background process that records your time. It starts again on its own after a restart.
2. It asks for three macOS permissions. Each prompt names Clocktrace.
   - **Accessibility**: to read window titles.
   - **Automation**, one per browser: to read the URL of the tab in front.
   - **Full Disk Access**: to read the iPhone and iPad data that Apple syncs to the Mac.
3. It shows the AI apps it found on this Mac and connects Clocktrace to the ones you pick.

A permission you skip only turns off what it is for. Run `clocktrace permissions` later to grant it.

## Ask questions

Open your AI app and ask in your own words:

- "How much time did I spend on my phone yesterday?"
- "What did I work on this week?"
- "How much time did I spend on YouTube today?"
- "Show my timeline for this morning."
- "Mark every page on mybank.com as private."

The same answers are in the terminal. `clocktrace summary --from 2026-09-24 --to 2026-09-24` gives one day by category. The command reference is in [`apps/cli/README.md`](apps/cli/README.md).

## Check that it works

```sh
clocktrace status
```

- **Collector**: `running` means your time is being recorded.
- **Permissions**: each one is `granted`, or it says what is missing.
- **iOS import**: one line per iPhone and iPad, with the time its data reaches. `not syncing` means Apple has not sent new data from that device for a long time. An old device you no longer use shows this too, and you can ignore it.
- **Last activity**: the newest recorded time from any device, the Mac or an iPhone or iPad.

## Make it yours

Time is grouped into **Categories**, such as Coding, Communication, AI, Social, and Entertainment. A fresh install comes with a Starter set of Categories and **Rules** for common apps and sites. A Rule says, for example, "the domain ends with github.com, so it is Coding". Time that no Rule matches shows as Uncategorized.

You can also group time by **Project**, for example one client or one product. A Rule can also mark matches **Private**, so their titles and URLs are never saved.

Change any of this by asking your AI app, or with `clocktrace rules`, `clocktrace categories`, and `clocktrace projects`. A Category or Project Rule also applies to time recorded before you added it. A Private Rule works only from the time you add it.

## Common questions

**My iPhone time is missing or behind Screen Time.** Clocktrace reads the data Apple syncs to the Mac. That sync is often hours late, and sometimes more than a day. `clocktrace status` shows how far each device has arrived. If it stays stuck, turn Share Across Devices off and on again in Screen Time on the iPhone.

**Some iPhone apps show a raw ID, like `com.example.app`.** Clocktrace looks up app names in the App Store. An app that is not in the store, or a lookup that failed, shows the ID. A failed lookup is tried again after one day.

**Time is missing while I read.** After 15 minutes with no input, the time is not counted. A video or a call in front keeps it counted, for at most 3 hours after your last input.

**Remove Clocktrace.** `clocktrace uninstall` removes the Collector, the app, and the AI app registrations, and keeps your data. `clocktrace uninstall --purge` also deletes the database and the logs. Then run `pnpm unlink --global` in `apps/cli`.

## Develop

`CONTEXT.md` holds the language and `docs/adr` the decisions.

Needs Node 22.12 or newer and pnpm 9 (`corepack enable` gives you the pinned version).

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm lint` runs Biome. A `pre-push` hook runs lint, build, typecheck, and test before every push and blocks the push when one fails, or when the pushed commit is not the clean checkout; `pnpm install` turns it on (`scripts/install-hooks.sh`). The GitHub workflow runs the same gates on macOS, only when started by hand from the Actions tab.

Run the summary benchmark by hand with `pnpm --filter core bench`; the target is under 2 seconds on a Mac. CI does not run it.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Activities, categories, projects, rules, queries, storage. Imported by every app. |
| `packages/helper` | The Swift `clocktrace-helper` binary the Collector runs: `watch` prints app, title, URL, idle as JSON lines. |
| `packages/collector` | The Collector: the loop, the Helper service, launchd control, permissions, status. The launchd agent runs its private `dist/main.js`. |
| `packages/mcp` | The MCP server. A Host starts it through `clocktrace mcp`. |
| `apps/cli` | The `clocktrace` command: setup, uninstall, start, stop, status, permissions, mcp. |

Where code goes, and the rest of the rules, are in `CODING_STANDARDS.md`.

The root lists `@clocktrace/cli` as a dev dependency only so the `clocktrace` bin is linked at the workspace root. After `pnpm build`, `pnpm --filter cli exec clocktrace --version` prints the CLI version.

<!-- embed-source:start -->
## Embedded library source

`repos/` holds a full copy of some dependencies' source, so coding agents can read the real implementation and tests instead of guessing from docs. `docs/idioms/` holds short notes that quote the idioms this project uses, with a path into `repos/` above each snippet. `CLAUDE.md` tells agents to start there.

| lib | version | fetched from |
| --- | --- | --- |
| effect | 3.22.2 | https://github.com/Effect-TS/effect at tag `effect@3.22.2` |

Rules:

- Never import from `repos/`. Import from the installed package.
- Never edit files under `repos/`. They are replaced wholesale on the next fetch.
- Lint, type-check, and tests skip `repos/`.

`repos/` is not in git. `pnpm install` runs `scripts/sync-repos.sh`, which reads the table in `repos/README.md` and does a shallow clone of each pinned tag. Run the script by hand if the folder is missing. Set `EMBED_SOURCE_SKIP=1` to skip the fetch.

After bumping a package, change its tag in `repos/README.md`, run `scripts/sync-repos.sh`, and change the version in this table, in the `CLAUDE.md` table, and in the first line of each `docs/idioms/effect-*.md` file.
<!-- embed-source:end -->
