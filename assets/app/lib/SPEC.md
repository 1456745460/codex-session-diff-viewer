---
id: workspace-watch-ignore
type: module-design
status: draft
title: 工作区忽略与文件监听
parent: session-diff-viewer
tags: [watch, ignore]
---

## Responsibility

决定哪些路径进入本回合基线/Diff，以及 begin 之后如何发现改动。只遍历 / 拷贝 / 监听 `--workspace` 给出的项目根，不扫描它们的共同父目录。

## Boundary

- 读：skill 根目录 `ignore-dirs.txt`、每个被监听项目根的 `.gitignore` 与 `.git/info/exclude`。
- 写：该 session 的 `inventory.json`、`dirty.json`、`watch.pid`；收尾时剪枝 `baseline/`。
- 不负责 Diff 展示、after 快照语义、或浏览器查看器。

## Decisions

- **忽略目录的真源是 `ignore-dirs.txt`**（gitignore 语法，人手可改），对所有被 begin 的工作区生效。文件缺失时才回退内置清单。`.git` 始终忽略。每个项目根自己的 `.gitignore` 仍可追加规则。
- **默认忽略 `.thinkrail/context/`**，避免任务草稿进会话 Diff。
- **`--workspace` 可重复。** 只快照/监听这些项目根。相对路径相对它们的共同父目录，该父目录只用于拼路径，不扫描、不拷贝兄弟项目。
- **拒绝多项目篮子。** 目录自己没有项目标记（`.git` / `package.json` / `pom.xml` / `pyproject.toml` 等），但直接子目录里 ≥2 个看起来像独立项目 → begin 失败，提示改传具体项目根。根上有 `.git` 的 monorepo 允许。
- **收尾剪枝 baseline。** begin 仍拷贝这些项目根内未忽略文件（保证编码前内容）；summarize 后 `baseline/` 只留本回合 Diff 中的文件。
- **不对工作区根做一次 recursive `fs.watch`。** macOS FSEvents 挂在根上无法排除 `node_modules/`、`target/` 等子树，事件一多就会合并或丢掉 `filename`，表现为「两个目录同时改文件却监听不到」。改为遍历目录树、跳过忽略目录，对每个剩余目录做非递归监听，用「目录相对路径 + filename」拼出文件路径。
- 新建的未忽略目录再补 watcher。`filename` 为空时只记下该监视目录；目录路径不当作文件纳入 Diff（收尾 inventory 扫描仍覆盖其子文件）。
- `dirty.json` 写入串行化，避免两个目录的 batch 互相覆盖。

## Invariants

- 同一回合里，已 begin 的项目根中任意未忽略文件被改到，收尾 Diff 都应收录，不论它们是否在不同目录、是否几乎同时写入。
- 忽略名单中的目录不进基线、不进 Diff、也不被监听。
- 未作为 `--workspace` 传入的兄弟项目不进基线、不进 Diff、也不被监听。
