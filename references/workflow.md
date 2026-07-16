# 会话变更工作流细节

## 核心原则

**一轮对话（用户一次请求）= 一个 session。**

- 新的用户请求若会改代码：必须重新 `begin`
- 不要把整条聊天线程累计进同一个 session
- `latest` 只代表最近一次 begin，仅限同一回合内使用

## 存储位置

- 根目录：`$CODEX_HOME/session-diffs`（默认 `~/.codex/session-diffs`）
- 会话：`session-diffs/<sessionId>/`
  - `meta.json`：工作区、跟踪文件、时间、本回合标题/摘要
  - `baseline/**`：本回合编码前文件快照
- `session-diffs/latest.json`：最近一次 begin 的 sessionId

## begin 语义

| 文件状态 | 基线 | 完成后展示 |
|---------|------|-----------|
| 已存在 | 复制当前内容（本回合开始时） | 修改/删除 |
| 不存在 | 无基线文件 | 新增 |

每次 `begin` 都会创建**新的** `sessionId`，即使工作区相同、聊天线程相同。

## track 语义

- 仅允许 track 到**当前回合** session
- 新一轮不要把新文件 track 到上一轮 session
- `track --session latest` 只有在“本回合刚 begin 过”时才安全

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
- session diff：仅相对**本回合 begin 基线**，精确对应本回合 Codex 编码动作

## 与“整条聊天累计 diff”的区别

- 错误：整个聊天线程共用 session-1，后面每轮都 track/open 同一个
- 正确：每轮 begin 新 session，历史轮次通过页面下拉分别查看
