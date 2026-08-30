# oh-my-agy (OMA / OMY)

[English](README.md) | 简体中文 | [繁體中文](README.zh-TW.md)

这是维护分支 **`zxjte9411/oh-my-agy`** 的简体中文入口。英文主文档位于 [`../../README.md`](../../README.md)。

OMA 保留 Google Antigravity CLI (`agy`) 作为执行宿主，并加入 session skills、持久化编排、Team/worktree 安全机制，以及七个原生 custom agents：`orchestrator`、`explorer`、`librarian`、`oracle`、`fixer`、`designer`、`observer`。

本项目源自 [`ImL1s/oh-my-agy`](https://github.com/ImL1s/oh-my-agy)。上游仅作为项目沿革与署名来源；本 fork 的安装、Issue 与 Release 均以 `zxjte9411/oh-my-agy` 为准。

## 安装

验证过的 GitHub Release：

```bash
curl -fsSLo /tmp/oma-install.sh \
  https://raw.githubusercontent.com/zxjte9411/oh-my-agy/main/scripts/install.sh
bash /tmp/oma-install.sh --github --tag v0.7.0
```

源码 / 开发版本：

```bash
git clone https://github.com/zxjte9411/oh-my-agy.git
cd oh-my-agy
bash scripts/install.sh --local-dev .
```

正式 Release 资产名称为 `zxjte9411-oh-my-agy-X.Y.Z.tgz`，并附带 `SHA256SUMS`。目前不会发布到 npmjs 或 GitHub Packages。

## 安装原生 Agents

```bash
oma native probe --live
oma agents list
oma agents install --scope user
oma agents doctor --scope user
```

若只想安装到当前项目，请使用 `oma agents install --scope project`。

完成后重启 Antigravity，并使用 `/agents` 确认七个 canonical agents 已被发现。

## 故障排除

OMA 的失败模式通常是刻意的 **fail-closed** 或 **静默 fail-open**。先运行 `oma doctor`。本发行版 **没有** `oma hooks status` 诊断指令，不要把它当成可执行命令。

| 症状 | 诊断 | 修法 |
|------|------|------|
| hooks 没有触发 | `oma doctor`（plugin 已安装且启用）。检查 `DISABLE_OMA` / `OMA_SKIP_HOOKS`。在 `OMA_HOOK_DEBUG=1` 且已设 `OMA_STATE_ROOT` 时查看 `<state-root>/logs/hook-debug.jsonl`。 | `oma setup`，然后 **重启 host**。取消 kill-switch 环境变量。可选项目级 `.agents/hooks.json`。 |
| `E_PLUGIN_NOT_ACTIVE` | `oma doctor` / `oma doctor --json`，检查 plugin registry。 | `oma setup`，再用 `oma doctor` 确认。仅 slash 的 host 可用 `oma doctor --no-strict-plugin`。 |
| `oma setup` 后 slash skill 没出现 | `oma skill list`；`oma doctor` 检查 `slash_skills` 与 `slash_collision`。 | 重启 host session。Claude/Grok 使用 `/oh-my-agy:autopilot`。 |
| Legacy magic 只印模式横幅然后没输出 | 非 TTY（CI）会忽略子进程 stdio，除非 `OMA_LEGACY_STDIO=inherit`。 | 优先用 managed `oma ralph -- "task"`；可显式设置 `OMA_LEGACY_STDIO=inherit` 或 `ignore`。 |

### 环境变量

只列出操作者会设的变量。Binding env 由 managed launch 注入，不要手设。没有 `OMA_STATE_DIR`；出货名称是 `OMA_STATE_ROOT`。

| 变量 | 默认值 | 作用 |
|------|--------|------|
| `DISABLE_OMA` | 未设置（关） | `1` 或 `true` 关闭全部 Antigravity hook。 |
| `OMA_SKIP_HOOKS` | 未设置 | 逗号分隔要跳过的逻辑 hook 名。 |
| `OMA_HOOK_DEBUG` | 未设置（关） | 把已脱敏诊断追加到 `<OMA_STATE_ROOT>/logs/hook-debug.jsonl`；未设 state root 时不写。 |
| `OMA_LEGACY_STDIO` | TTY 闸门 | Legacy magic spawn 的 stdio；显式 `inherit` 或 `ignore` 可覆写。 |
| `OMA_TIMEOUT_MS` | 依路径 | 正的毫秒数；用于有界 headless / managed 路径。 |
| `OMA_LAUNCH_POLICY` | `auto` | 裸 host-launch 传输：`auto`、`direct`、`tmux` 或 `detached-tmux`。 |
| `OMA_STATE_ROOT` | 平台默认 | 持久 state root。 |

完整发布与校验规则请看 [`../RELEASE.zh.md`](../RELEASE.zh.md)，完整功能说明请看 [`../../README.md`](../../README.md)。
