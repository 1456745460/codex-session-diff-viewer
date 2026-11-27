---
id: workspace-watch-ignore
type: module-design
status: draft
title: 工作区忽略与文件监听
parent: session-diff-viewer
tags: [watch, ignore]
---

## Responsibility

决定工作区里哪些路径进入本回合基线/Diff，以及 begin 之后如何发现改动。

## Boundary

- 读：skill 根目录 `ignore-dirs.txt`、被监听项目的 `.gitignore` 与 `.git/info/exclude`。
- 写：该 session 的 `inventory.json`、`dirty.json`、`watch.pid`。
- 不负责 Diff 展示、after 快照语义、或浏览器查看器。

## Decisions

- **忽略目录的真源是 `ignore-dirs.txt`**（gitignore 语法，人手可改），对所有被 begin 的工作区生效。文件缺失时才回退内置清单。`.git` 始终忽略。工作区 `.gitignore` 仍可追加规则。
- **默认忽略 `.thinkrail/context/`**，避免任务草稿进会话 Diff。
- **不对工作区根做一次 recursive `fs.watch`。** macOS FSEvents 挂在根上无法排除 `node_modules/`、`target/` 等子树，事件一多就会合并或丢掉 `filename`，表现为「两个目录同时改文件却监听不到」。改为遍历目录树、跳过忽略目录，对每个剩余目录做非递归监听，用「目录相对路径 + filename」拼出文件路径。
- 新建的未忽略目录再补 watcher。`filename` 为空时只记下该监视目录；目录路径不当作文件纳入 Diff（收尾 inventory 扫描仍覆盖其子文件）。
- `dirty.json` 写入串行化，避免两个目录的 batch 互相覆盖。

## Invariants

- 同一回合里，工作区中任意未忽略文件被改到，收尾 Diff 都应收录，不论它们是否在不同目录、是否几乎同时写入。
- 忽略名单中的目录不进基线、不进 Diff、也不被监听。
