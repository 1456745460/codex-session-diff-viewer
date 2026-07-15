# Codex Session Diff Viewer

本地网页端工具：查看 **Codex 本次会话编码变更**（编码前基线 vs 改完后），不是 `git diff` / 工作区相对 HEAD 的变更。

## 功能

- 左侧：本次会话改动文件列表（新增 / 删除 / 修改）
- 右侧：编码前 vs 本次后 Diff（并排 / 统一）
- 同步滚动、收起未更改片段、差异块导航
- 语法高亮、字体/字号、侧栏拖拽
- 会话下拉：`时间 · 项目文件夹名 · 改动概括 · N 个文件`
- 撤销当前文件 / 撤销全部（回滚到 begin 基线）

## 安装与启动

```bash
cd assets/app
npm install
```

脚本入口：

```bash
./scripts/session_diff.sh begin --workspace "/path/to/project" --files "src/a.js,src/b.ts"
# 编码...
./scripts/session_diff.sh summarize --session latest
./scripts/session_diff.sh open --session latest
```

默认地址：`http://127.0.0.1:3847`

## 项目名说明

会话下拉中的 **项目名** 取自 `--workspace` 工作区路径：去掉当前用户主目录前缀，保留剩余路径形态。

示例：
- `/Users/wangbingbing/javaProject/traceback/backend` → `/javaProject/traceback/backend`
- `/Users/you/demo/app` → `/demo/app`

不使用 `--title` 任务标题，避免出现各种临时标题混在项目名里。

## 目录结构

```text
codex-session-diff-viewer/
├── SKILL.md                 # Codex skill 说明
├── README.md
├── scripts/session_diff.sh  # CLI 入口
├── agents/
├── references/
└── assets/app/              # Node 服务 + 前端
    ├── bin/cli.js
    ├── lib/
    ├── public/
    └── server.js
```

基线与会话数据默认保存在：`~/.codex/session-diffs/`

## Codex 会话代码变更复查（强制）

只要本回合会创建/修改/删除代码或项目文件，必须使用 skill `codex-session-diff-viewer`，展示**本次会话变更**，禁止用 git 工作区相对仓库的 diff 代替。

### 必须流程
1. **首次改文件前**执行 begin，捕获编码前基线：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" begin \
     --workspace "<绝对工作区路径>" \
     --files "相对路径1,相对路径2"
   ```
2. 正常编码。
3. 若中途要改未跟踪文件：先 `track --session <id|latest> --files ...`，再修改。
4. **编码任务收尾**（最终回复前）执行 summarize + open：
   ```bash
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" summarize --session latest
   "$HOME/.codex/skills/codex-session-diff-viewer/scripts/session_diff.sh" open --session latest
   ```
   - 若本回合改动点已明确，可用 `--summary "一句话概括"` 写入更准确摘要
   - `open` 也会自动补齐智能概括（时间/项目名/改动点/文件数用于会话下拉）
5. 在最终回复提供可点击地址，例如：
   `[查看本次代码变更](http://127.0.0.1:3847)`
6. 文案必须写明：这是“本次会话编码前 vs 改完后”的变更，不是 git HEAD/工作区 diff。

### 禁止
- 不要用 `git diff`、`git diff HEAD`、`git status` 结果充当“此次 Codex 变更”
- 不要在未 begin 的情况下假装有会话级 diff

### 说明
- skill 详情见：`~/.codex/skills/codex-session-diff-viewer/SKILL.md`
- 基线保存在：`~/.codex/session-diffs/`

## License

MIT
