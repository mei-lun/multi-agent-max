# MAM主分支集成记录

日期：2026-11-08。目标目录：D:/Github-Poj/multi-agent-max。目标分支：main。版本：0.1.43。

## 合并范围和保留

- 用户明确授权将全部创作接入合入MAM主分支并提交。本次仅本地Git操作，不推送远端。
- 原main工作区0.1.39的连线标签布局、测试、版本说明和接入计划先保存为905d81a，未丢弃原始改动。
- 创作分支codex/creative-components的最终文档和九场景历史验收证据保存为c1d4cb5，一并合入。
- 三处冲突仅涉及package.json版本号、版本索引及计划状态说明。采用0.1.43和当前实施状态；原计划正文及0.1.39历史记录保留。
- 合并后src、config、vendor、migration、package.json和pnpm-lock.yaml与c1d4cb5一致。新增集成说明和安装文档纠正不改变运行时行为，因此沿用0.1.43，不另造运行时版本。
- LevelUp来源仓库保持只读。预览和日常MAM用户数据均未迁移或覆盖。

## 主目录验证

| 检查 | 结果 |
| --- | --- |
| 依赖 | Node24.19.0，pnpm10.24.0离线安装，frozen-lockfile；补齐yauzl及类型，不修改锁文件 |
| TypeScript | 全项目noEmit与core生产编译通过 |
| 全仓Vitest | 251个测试文件全部通过，768项通过、1项按平台跳过；maxWorkers=2 |
| lint | src/config全范围通过 |
| Electron构建 | main/preload/renderer生产构建通过 |
| 创作组件构建 | 八组件0.3.0/API2.0.0构建通过，输出release/creative-components/0.1.43 |
| Node环境/打包测试 | 9通过、2个macOS场景按平台跳过 |
| 打包应用 | 在主目录运行EXE，加载八组件、打开工作台、执行独立后台、核验导出字节通过 |
| 星图生产验证 | 真实Electron/包后台读取授权文件正文、执行批准工具、保存并继续会话通过 |
| 合并审查 | 原工作区改动保留，无冲突标记，无运行时代码差异；独立审查无可行动问题 |

首次Vitest完整运行在类型/组件/桌面构建并发期间为767通过、1跳过、1个真实Git用例超时。随后停止构建并以maxWorkers=2重新完整运行，251文件、768项通过、1跳过，耗时153.92秒；未放宽测试超时或修改测试。跳过项是仅非Windows执行的知识库符号链接越界用例。

## 原目录使用入口

- 开发：在D:/Github-Poj/multi-agent-max使用Node24（项目要求至少22.22）和pnpm10.24.0，执行pnpm dev。
- 隔离预览：release/start-creative-preview.cmd，使用独立预览数据。
- 已构建应用：release/win-unpacked/Multi-Agent Max.exe。
- 安装组件：创作组件页逐个导入release/creative-components/0.1.43中的creative-*目录。

原目录out的11个生产文件逐字节匹配已验证的候选app.asar，因此复用该完整应用目录；在原目录重新运行打包应用验证通过。原来未完成打包的win-unpacked保留为release/win-unpacked-before-integration-98d41ca0-9f62-404d-a076-ed0e07d34e84，没有删除旧文件。

主目录重建的组件候选位于.mam-local/component-packages。Windows检出换行会改变复制型UI文件与来源哈希，后台bundle字节仍一致；release交付目录保留已验证0.3.0包的原始字节和catalog，避免同版本清单变化导致已有安装被拒绝。八包总15,264,321字节；目录外安装说明已更正为0.1.43。

应用EXE SHA-256：4fb439fdefca5e376fae8239929ac27bcd6b322c0521036e8b9be0316b16dbe8。

## 验收证据边界

creative-traceability.json保留原b3f447a提交的九场景证据，不冒充新合并提交；本报告补充实际主目录重建和验证。原报告中的相对本地产物仍在独立工作区保存，独立工作区保留供恢复与对照。真实厂商生成、完整GPU、Spine商业编辑器往返和macOS实机未因本次合并变为已验收。
