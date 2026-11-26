# 会话变更工作流细节

## 核心原则

**一轮对话（用户一次请求）= 一个 session。**

- 新的用户请求若会改代码：必须重新 `begin`
- 不要把整条聊天线程累计进同一个 session
- `latest` 只代表最近一次 begin，仅限同一回合内使用
- 不必预列 `--files`，也不必中途 `track`

## 存储位置

- 根目录：`$CODEX_HOME/session-diffs`（默认 `~/.codex/session-diffs`）
- 会话：`session-diffs/<sessionId>/`
  - `meta.json`：工作区、跟踪文件、时间、本回合标题/摘要、`afterCapturedAt`、watch 状态
  - `baseline/**`：本回合编码前文件快照（版本 1）
  - `after/**`：本回合改完后文件快照（版本 2，summarize/open 或下一轮 begin 时冻结）
  - `inventory.json`：begin 时的工作区文件索引（size/mtime）
  - `dirty.json`：监听进程记录的脏路径
  - `watch.pid`：监听守护进程
- `session-diffs/latest.json`：最近一次 begin 的 sessionId

## begin 语义

| 文件状态 | 基线 | 完成后展示 |
|---------|------|-----------|
| 已存在 | begin 时 clone/复制当前内容 | 修改/删除 |
| 不存在 | 无基线文件 | 新增 |

每次 `begin` 都会创建**新的** `sessionId`，即使工作区相同、聊天线程相同。

begin **不必** `--files`：先快照可跟踪文件（尊重 `.gitignore` 与 `node_modules/`、`target/` 等），再启动 `fs.watch`。监听事件发生在写入之后，所以「改前内容」来自 begin 快照，而不是事件本身。

收尾时合并 `dirty.json` 与 inventory 扫描（mtime/size），漏掉的事件也能被发现。

若上一轮还没有 `after` 快照，新 `begin` 会在切换 latest 之前，用当时工作区内容把上一轮冻成 after（避免历史会话之后一直跟最新文件对比）。

## track 语义

- 监听模式下通常不必 track
- 仅用于强制纳入被 ignore 的路径，或尚未创建的占位文件
- `track --session latest` 只有在“本回合刚 begin 过”时才安全

## open / summarize 语义

- 若该 session 仍是 latest：先同步监听/扫描到的路径，再把工作区当前内容写入 `after/**`
- 对每个文件比较 `baseline` 与 `after`（有 after 快照时）；尚未冻结才回退到工作区当前内容
- 切换到历史会话时只用该轮自己的 baseline/after，不会掺进后来的修改
- 未变化文件不进入列表
- 服务默认端口 3847
- **单实例策略**：
  1. 先探测 `http://127.0.0.1:3847/api/health`
  2. 健康检查必须带当前协议 `session-watch-v1`、`supportsAfterSnapshot`、代码指纹和 appRoot；缺字段或与本 skill 不一致视为过期进程，必须重启，不能复用
  3. 若服务可用且协议兼容：调用 `/api/focus` 广播最新 session
  4. 若已有浏览器页通过 SSE(`/api/events`) 在线：只刷新该页并切换会话下拉，**不新开标签**
  5. 若服务可用但无在线页面：才打开浏览器
  6. 若服务不可用或协议过期：结束旧进程并启动新服务，固定复用 3847（不递增端口）

## 与 git 的区别

- git diff：相对 HEAD/index 的工作区状态，可能混入更早未提交改动
- session diff：仅相对**本回合 begin 基线 vs 本回合 after 快照**。发现集合来自本回合监听/扫描，不是 git status

## 与“整条聊天累计 diff”的区别

- 错误：整个聊天线程共用 session-1，后面每轮都 open 同一个
- 正确：每轮 begin 新 session，历史轮次通过页面下拉分别查看
