# 会话变更工作流细节

## 存储位置

- 根目录：`$CODEX_HOME/session-diffs`（默认 `~/.codex/session-diffs`）
- 会话：`session-diffs/<sessionId>/`
  - `meta.json`：工作区、跟踪文件、时间
  - `baseline/**`：编码前文件快照
- `session-diffs/latest.json`：最近一次 begin 的 sessionId

## begin 语义

| 文件状态 | 基线 | 完成后展示 |
|---------|------|-----------|
| 已存在 | 复制当前内容 | 修改/删除 |
| 不存在 | 无基线文件 | 新增 |

## open 语义

- 读取 session 跟踪文件列表
- 对每个文件比较 baseline 与 workspace 当前内容
- 未变化文件不进入列表
- 服务默认端口 3847
- **单实例策略**：
  1. 先探测 `http://127.0.0.1:3847/api/health`
  2. 若服务可用：调用 `/api/focus` 广播最新 session
  3. 若已有浏览器页通过 SSE(`/api/events`) 在线：只刷新该页并切换会话下拉，**不新开标签**
  4. 若服务可用但无在线页面：才打开浏览器
  5. 若服务不可用：结束旧进程并启动新服务，固定复用 3847（不递增端口）

## 与 git 的区别

- git diff：相对 HEAD/index 的工作区状态，可能混入更早未提交改动
- session diff：仅相对本次 begin 基线，精确对应此次 Codex 编码动作
