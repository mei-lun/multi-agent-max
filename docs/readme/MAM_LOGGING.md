# 开发日志

日志用于开发排障，使用现有本地 JSON/JSONL 文件，无需日志服务或额外配置。

## 在哪里读

在“设置 → 本机绑定 → 日志目录”查看和修改目录；初始值为 Electron 的 `app.getPath('userData')/mam/diagnostics`。支持输入绝对路径或选择文件夹，保存本机设置后重启生效。以下路径相对于生效的日志目录：

| 文件 | 内容 |
| --- | --- |
| `runtime.jsonl` | 应用版本和运行时版本、窗口异常、前端 warning/error、未处理异常、IPC 开始/结束/失败、自动调度启动失败 |
| `events.json` | Run/Task/Attempt/Invocation 关联的执行事件、模型与接口、工作目录、失败堆栈、工具活动及用量 |
| `invocations/<Invocation ID 的 SHA-256>/rpc.jsonl` | Pi 命令、压缩事件及 stderr；首条 `mam.invocation_start` 记录原始关联 ID 和日志路径 |

Pi 的配置和会话仍放在内置或自定义 Executor 的 `configRoot`，日志目录可单独指定。`runtime.jsonl` 的 `app_start` 记录实际诊断目录。开发模式的 userData 通常位于 Windows `%APPDATA%/multi-agent-max`、macOS `~/Library/Application Support/multi-agent-max`；打包版本名称可能不同。

排查时先按问题时间查 `runtime.jsonl`，用 `requestId` 关联一次 IPC 调用，用 `workflowRunId`、`taskId`、`attemptId` 和 `executorInvocationId` 查业务事件及 RPC 日志。错误包含 message、stack、cause，以及存在时的 code、exitCode 和 stderr。接口地址省略 URL 用户名、密码、查询参数和 fragment；IPC 只记录标识字段，不转储请求参数或密钥。

## 24 小时保留

- 按记录中的 `at` / `timestamp` 判断，恰好满 24 小时的记录也会过期；不是按日历日期或文件修改时间删除整个活跃日志。
- 应用启动和运行期间每分钟清理；应用关闭或系统休眠期间不会后台清理，恢复运行后继续。
- 最近 24 小时的记录不再受旧的 5 MB / 3000 条截断限制。日志量大时文件和内存占用也会增加。
- 旧版 `runtime.jsonl.1` 同样按时间清理。Pi 清理只处理日志目录及内置/当前已配置 Executor 的 invocation 目录中的 `rpc.jsonl`，不删除配置、内部会话、worktree 或正式产物。
- 修改目录不会搬迁旧日志；应用在本机 `mam/log-directories.json` 记录曾使用的日志目录，重启后继续清理其中过期的 runtime/events/RPC 日志。新目录的实时观测只加载新目录中的业务事件。
- 手动导出的文件不自动清理。设置中的 Export diagnostics 仍导出业务事件；完整排查请同时读取桌面和 RPC 日志。

这是开发阶段的简洁实现：同步文件写入及定时过滤，不增加索引、上传、自动诊断包或可靠性子系统。Git 权威历史与正式结果永久保留，本地日志过期不影响状态回放。
