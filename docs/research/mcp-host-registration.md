# How does the installer register a stdio MCP server with each AI app?

Date: 2026-09-17
For: Clocktrace v0, the `clocktrace install` checklist

The server command is `clocktrace mcp`. All four hosts take a name, a command, and an args list. All four support an `env` map, which we do not need.

## Findings

- Claude Code. CLI: `claude mcp add --scope user clocktrace -- clocktrace mcp`. User scope is stored in `~/.claude.json` under `mcpServers`. A project scope writes `.mcp.json` at the project root. Config is read at session start, no hot reload. Source: https://code.claude.com/docs/en/mcp
- Codex CLI. CLI: `codex mcp add clocktrace -- clocktrace mcp`. File: `~/.codex/config.toml`, table `[mcp_servers.clocktrace]` with `command = "clocktrace"` and `args = ["mcp"]`. Read at startup, new session needed. Source: https://learn.chatgpt.com/docs/extend/mcp
- Hermes Agent (Nous Research). No add command for arbitrary servers, `hermes mcp` is a catalog picker. File: `~/.hermes/config.yaml`, top-level `mcp_servers:` mapping, entry `clocktrace:` with `command: "clocktrace"` and `args: ["mcp"]`. A running session auto-reloads the file, a fresh `hermes chat` is safest. Source: https://github.com/NousResearch/hermes-agent/blob/main/cli-config.yaml.example and https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md
- OpenClaw. CLI: `openclaw mcp add clocktrace --command clocktrace --arg mcp`, which probes the server before saving. File: `~/.openclaw/openclaw.json`, key `mcp.servers.clocktrace` with `command` and `args`. Picked up on the next agent turn, no gateway restart. Source: https://docs.openclaw.ai/cli/mcp/registry and https://docs.openclaw.ai/gateway/config-extensions#mcp

## Remove

Checked on 2026-09-22 against the installed CLIs.

- Claude Code. `claude mcp remove clocktrace --scope user` removes the `mcpServers.clocktrace` entry from `~/.claude.json`. When the name is absent it exits 1 and prints `No MCP server named "clocktrace" in user scope`.
- Codex CLI. `codex mcp remove clocktrace`. When the name is absent it exits 0 (not 1) and prints `No MCP server named 'clocktrace' found.`, so the text, not the exit code, tells the two apart.
- Hermes Agent. No remove command: delete the `mcp_servers.clocktrace` key from `~/.hermes/config.yaml` and keep the rest of the file.
- OpenClaw. `openclaw mcp unset clocktrace`. The docs say unset fails when the named server does not exist; the exact message is unknown.

## Installer rule

Use the host's own add command when it exists (Claude Code, Codex, OpenClaw) so we never parse or rewrite their files. Hermes has none, so the installer edits `~/.hermes/config.yaml` in place, adding only the `mcp_servers.clocktrace` block and keeping everything else byte for byte. Detect a host by its binary on PATH or its config folder, and pre-tick the ones found.

## Open

- The exact JSON nesting of a user-scope entry in `~/.claude.json` is not printed in the docs. Not needed while we go through `claude mcp add`.
- Whether Codex picks up a change mid-session. Treat a new session as required.
