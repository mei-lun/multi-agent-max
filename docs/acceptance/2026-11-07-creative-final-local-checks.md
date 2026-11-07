# 0.1.42 本地验收记录

2026-11-07，Windows x64，Node 24.19.0，Electron 43.2.0。原 LevelUp 与原 MAM 工作区均未修改；实现位于独立 `codex/creative-components` worktree。

## 检查结果

| 检查 | 结果与范围 |
| --- | --- |
| TypeScript | 完整类型检查通过 |
| oxlint | src/config 全范围通过，无提高 max-lines |
| 格式 | 本批修改范围通过；未重排全仓既有格式问题 |
| 生产构建 | core 与 Electron main/preload/renderer 构建通过 |
| 全仓 Vitest | 232 文件，716 通过、6 失败、1 跳过；5 个文件权限/Git校验失败与已复现基线一致，另1个 Pi CLI加载在并行负载下失败，单独重跑4项全通过 |
| 新增失败修复 | locale覆盖、组件关闭测试mock、3D资源状态fixture语法问题均已修复并定向通过 |
| 源码同步 | 6项Node回归通过；真实旧/新YuE2规范化函数更新继承与补丁重放通过 |
| 原生桌面 | 组件安装生命周期、图片/语音、写作、Spine、真实MP4视频、无资源全工作台六套生产宿主脚本均通过 |
| 原始星图执行器 | image/audio/video/writing/localTool/file 原UI执行fixture通过；模拟host数据不等于真实厂商生成 |
| 原始3D查看器 | 自定义协议加载带PNG贴图、skin和动画的GLB，红色像素与动画时间推进测试通过 |
| 正式二进制交付 | 流式CAS、授权输入、可移植目录、校验/物化与真实Git组件Attempt路径测试通过 |
| 角色组件工具 | 绑定模型、授权/批准、幂等、私有Job归属、生成结果再次编辑、Claim撤销测试通过 |
| 本地资源与进程 | tiny ZIP64/HTTP/受控子进程fixture通过；未下载多GiB模型或执行GPU生成 |
| 组件分发 | 八个未签名离线目录，7,815,613字节；逐文件哈希、运行时导入与来源许可检查通过 |
| Windows应用打包 | `electron-builder --win dir --x64 --publish never` 生成独立应用目录；隔离数据加载八组件目录并打开写作工作台通过 |

全仓未全绿，不将上述基线问题隐藏为通过。当前目录是验收版，没有正式线上发布或签名信任声明。

## 可复现入口

- `creative:test`：组件/原生服务/Artifact/工作流与来源同步定向测试。
- `creative:build`：生成八个本地组件包及catalog。
- `creative:verify:media`、`creative:verify:writing`、`creative:verify:spine`、`creative:verify:video`、`creative:verify:workbenches`：真实Electron宿主和本机服务fixture。
- `creative:verify:packaged`：打包后的EXE使用临时私有数据打开组件。
- `creative:traceability`：生成 `creative-traceability.json`，明确保留未完成的真实环境验收。

## 尚需真实环境的验收

实际厂商API、音乐/3D完整GPU推理、ComfyUI真实拆层、Spine编辑器往返、macOS实机、线上签名组件目录。没有把模拟数据和合成模型测试当作这些验收的替代。
