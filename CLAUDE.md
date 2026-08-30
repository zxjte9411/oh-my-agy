# oh-my-agy 專案開發指引

此文件記載本專案的建置、測試指令以及程式碼風格與規範。請開發人員嚴格遵守。

## 建置與測試指令

### 1. 安裝相依項目
```bash
npm ci
```

### 2. 建置與編譯專案
```bash
npm run build
```

### 3. 執行單元測試
```bash
npm run test:unit
```
涵蓋 runtime、CLI、Autopilot FSM、Team/tmux/temp-Git、plugin setup 等契約測試。

### 4. 執行 E2E 測試
```bash
TEST_DIST=true npm run test:e2e
```
或單一階段：
```bash
TEST_DIST=true npx jest e2e/tier1.spec.ts --runInBand
```

### 5. Package surface
```bash
npm run test:package
```

### 6. Smoke 與 production gate
```bash
npm run smoke
npm run test:production
```
`test:production` 不是一般 deterministic 測試；它需要 fresh、exact-Git-OID-bound live evidence。未提供時以 `E_PRODUCTION_EVIDENCE` exit 1 是正確的 fail-closed 行為。

### 7. 新增 public composition surfaces

* `src/workflows/*`：DAG / permission / replay / independent review；CLI adapter 必須保持薄層，不重做 state machine。
* `src/mcp/*`：固定六個 public read/proposal operations，禁止 generic command runner；agent-private delegation MCP 不得擴張 public six-op surface。
* `src/native/*`：只報 public evidence；不得從 UI 或 private files 推論 native team/workflow/LSP。
* `src/continuation/recovery.ts`：partial recovery 必須保留 `W_BROKEN_CHAIN` / unknown-record warnings。
* `src/setup/update.ts` / `uninstall.ts`：immutable, receipt-owned lifecycle。

## 程式碼風格與開發規範

### 命名規範
* **類別 (Class)、型別 (Type) 及介面 (Interface)**：`PascalCase`
* **變數 (Variable)、函式 (Function) 及引數 (Argument)**：`camelCase`
* **常數 (Constant)**：`UPPER_SNAKE_CASE`

### 註解規範
* 所有註解必須使用**繁體中文**，並採用台灣軟體專業術語。
* 註解內必須包含明確的**設計概念映射**（例如參考 `oh-my-claudecode` / `oh-my-codex`）。

### 安全規範
* 禁止使用 `exec` 執行外部命令；必須使用 `spawn` / `spawnSync` 與引數陣列。
* Circuit breaker **禁止** `git reset --hard` / `git clean -fd`。
* 不得修改 `AGENTS.md`。
* `v*` tag 是特權發布邊界：推 tag 前必須在 exact candidate OID 上完成 live production gate；`.github/workflows/release.yml` 只能在 deterministic gates 全綠後建立本 fork GitHub Release，且必須下載已發布 asset 做 external byte/checksum readback。
* Release workflow 不得發布 npmjs.org 或 GitHub Packages；目前只允許 `zxjte9411/oh-my-agy` GitHub Release。
* 不得宣稱 `@zxjte9411/oh-my-agy` 已存在於 npmjs.org 或 GitHub Packages。
