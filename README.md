# oh-my-agy (OMA / OMY)

<p align="center">
  <img src="assets/oma-character.png" alt="oh-my-agy character" width="300">
  <br>
  <em>Antigravity-native orchestration, canonical specialist agents, and durable managed workflows.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/host-Antigravity%20CLI-black" alt="Antigravity CLI">
</p>

English | [简体中文](docs/readme/README.zh.md) | [繁體中文](docs/readme/README.zh-TW.md)

**OMA is an orchestration layer for Google Antigravity CLI (`agy`).** It keeps Antigravity as the execution host while adding session skills, a durable `oma` CLI, safe Team/worktree infrastructure, and seven native custom agents with deterministic routing.

> **Unofficial.** This project is not affiliated with Google or Antigravity. A working, authenticated `agy` on `PATH` is required for live/native host features.

## Repository and lineage

This repository, **`zxjte9411/oh-my-agy`**, is the maintained distribution source for this fork. Installation, issues, release assets, and package metadata all resolve here.

The project was forked from [`ImL1s/oh-my-agy`](https://github.com/ImL1s/oh-my-agy). Upstream remains credited as project lineage, but upstream releases are not the installation source for this fork.

## What OMA adds

| Layer | Responsibility |
|---|---|
| `agy` | Native agent runtime, tools, conversations, `invoke_subagent` |
| Session skills | `/autopilot`, `/ralph`, `/ultrawork`, `/team`, and related workflows |
| Native agents | `orchestrator`, `explorer`, `librarian`, `oracle`, `fixer`, `designer`, `observer` |
| `oma` / `omy` | Setup, native capability inspection, agent install/doctor, managed modes, durable state |
| Team runtime | tmux/worktree workers, claims, mailbox, delivery, reconciliation |
| OMA MCP | Stable public six-op MCP plus an agent-private delegation MCP surface |

## Requirements

- Node.js 20+
- Git
- Antigravity CLI (`agy`) for live/native host functionality
- `curl`, `tar`, and SHA-256 tooling for verified release installation

## Install

### Recommended: verified GitHub Release

The official distribution channel for this fork is the GitHub Release of `zxjte9411/oh-my-agy`. Release assets are checksum-verified before candidate bytes execute.

Install the latest release:

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github
```

Pin an exact release:

```bash
bash /tmp/oma-install.sh --github --tag v0.7.0
```

A release contains:

```text
zxjte9411-oh-my-agy-X.Y.Z.tgz
SHA256SUMS
```

The installer verifies SHA-256, extracts into a sealed staging directory, performs candidate preflight, switches the Antigravity plugin, runs doctor/readback, and writes an ownership receipt.

### Source / development install

Use this when testing `main` or a branch before a release exists:

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

If `~/.local/bin` is not on `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then verify the CLI:

```bash
oma --version
oma doctor --no-strict-plugin
```

### Offline release install

After downloading the exact release tarball and `SHA256SUMS`:

```bash
bash /tmp/oma-install.sh \
  --asset ./zxjte9411-oh-my-agy-0.7.0.tgz \
  --checksums ./SHA256SUMS
```

See [`docs/RELEASE.md`](docs/RELEASE.md) for the complete release and verification contract.

## Install the seven native Antigravity agents

First inspect the real host capability surface:

```bash
oma native capabilities
oma native probe --live
```

`oma native capabilities` is passive evidence and does not prove live host parity. `oma native probe --live` is the opt-in live probe. `oma doctor --native` reports the native-capability view in the broader doctor flow.

Install the agents for the current user:

```bash
oma agents list
oma agents install --scope user
oma agents doctor --scope user
```

User-scope agents are installed under:

```text
~/.gemini/config/agents/<agent>/agent.md
```

Or install only for the current repository:

```bash
oma agents install --scope project
oma agents doctor --scope project
```

Project-scope agents are installed under:

```text
.agents/agents/<agent>/agent.md
```

Restart the Antigravity session and use `/agents` to confirm discovery.

### Canonical agents

| Agent | Purpose | Default posture |
|---|---|---|
| `orchestrator` | Dependency-aware planning, native delegation, reconciliation, verification | bounded write + native delegation when proven |
| `explorer` | Codebase discovery | read-only |
| `librarian` | External/current documentation research | read-only |
| `oracle` | Architecture, security, difficult diagnosis | read-only |
| `fixer` | Bounded implementation | bounded write |
| `designer` | UI/UX implementation | bounded write |
| `observer` | Image/PDF/screenshot observation | read-only |

Legacy roles remain compatible through aliases; they are not installed as duplicate visible agents.

## Native orchestration

When native delegation is capability-proven, `orchestrator` uses Antigravity's native `invoke_subagent`. OMA owns deterministic lane routing and dependency waves, while Antigravity owns child-agent lifecycle and execution.

The orchestrator uses a private MCP server:

```yaml
mcpServers:
  oh-my-agy-agents:
    command: oma
    args:
      - agents
      - mcp-server
```

That private surface exposes `delegation.plan` and `delegation.reconcile`. The existing public `oma mcp-server` remains a backward-compatible six-operation surface.

## Session-first workflows

After `oma setup`, restart the host session.

```text
# Antigravity
/autopilot <goal>

# Claude Code / Grok
/oh-my-agy:autopilot <goal>
```

Other session skills include `ralph`, `ultrawork`, `team`, `search`, `workflow`, `ask`, `wiki`, `hud`, `plan`, and `trace`.

## Useful CLI commands

```bash
oma --help
oma skill list
oma agents list
oma agents inspect oracle
oma native capabilities
oma native probe --live
oma doctor --native
oma doctor --no-strict-plugin
oma ralph -- "<task>"
oma ultrawork -- "<task>"
oma team status --team <id>
oma mcp-server
```

## Release channel

The fork package identity is **`@zxjte9411/oh-my-agy`**, but npmjs and GitHub Packages publication are intentionally disabled. Do not assume a registry package exists and do not install the unrelated unscoped `oh-my-agy` package from npmjs.org.

A `v*` tag whose version matches all public manifests triggers the release workflow. The workflow runs build/unit/package/compiled-E2E/smoke gates, packs `zxjte9411-oh-my-agy-X.Y.Z.tgz`, writes `SHA256SUMS`, creates the GitHub Release in this repository, downloads both assets back, and verifies the published bytes.

## Development

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
npm ci
npm run build
npm run test:unit
TEST_DIST=true npm run test:e2e
npm run test:package
npm run smoke
```

The live production evidence gate is separate and requires an authenticated Antigravity host:

```bash
npm run test:production
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`docs/security.md`](docs/security.md), and [`docs/RELEASE.md`](docs/RELEASE.md) before changing safety or release contracts.

## License

MIT. See [`LICENSE`](LICENSE).
