# 创作组件0.1.43交付与验收清单

日期：2026-11-08。继续执行[独立审计](2026-11-07-creative-integration-audit.md)的R0–R5；旧审计作为修复前记录保留。

## 交付位置

| 内容 | 位置 |
| --- | --- |
| 源代码 | D:/Github-Poj/multi-agent-max-creative-components，codex/creative-components |
| Windows启动器 | release/start-creative-preview.cmd；独立预览数据，不覆盖日常配置 |
| 应用 | release/win-unpacked/；保留整个目录，不能只移动EXE |
| 八个可选包 | release/creative-components/0.1.43/creative-*；组件0.3.0、后台API2.0 |
| 来源 | 各包provenance.json、backend-provenance.json、manifest |
| 验收绑定 | creative-traceability.json |

LevelUp代码、配置、Git及用户数据未写入。原MAM的0.1.39连线改动已复制到候选分支，原始未提交内容保留；没有自动合并/推送原分支。

## 审计问题的实现结果

| 原问题 | 本次实现 |
| --- | --- |
| 后台内嵌宿主 | 包含实际backend.cjs，独立进程执行；同宿主两版本、旧任务固定版本 |
| 任务权限绕过 | Role/组件任务共用策略，身份先于批准，内部图/Goal操作也受授权 |
| Role素材不能交付 | CAS、合同、宿主交付记录进入标准收集器；多合同/只读Role支持 |
| 手动成果不能审核 | 项目/哈希草稿经正常Task/Claim/Attempt提交，Kernel创建审核面板 |
| 新克隆只有清单 | 产品交付区导入/导出，恢复验证后的CAS及正式元数据供下游授权 |
| 星图会话/文件/多图缺口 | 持久历史、真实文本内容、全部候选；失败/待选择标partial阻止正式交付 |
| Goal/图依赖界面 | 原业务后台执行，关闭继续、重开查询、检查点恢复、持久保存后确认 |
| 版本漂移/项目混用 | Attempt版本/哈希冻结，MAM项目窗口/作品隔离，共享资源独立 |
| 原生恢复/rig额外下载 | 逐资源原子登记、失败恢复、Blender轻量rig、等待进程树退出 |
| 用量/设计助手不完整 | 已知用量累计、未知不伪造，设计schema/materializer支持创作节点 |
| 旧验收可冒充当前 | wrapper重新运行、核对源码指纹及包哈希，过期结果为not_run |

## 建议验收顺序

1. 使用本次启动器，在“创作组件”逐个导入需要的creative-*目录、启用、打开。未安装组件不下载资源；API1.0旧包升级到0.3.0，旧工程保留。
2. 连接一个MAM Git项目，选择当前项目创作空间；再用第二项目验证工程和音乐作品隔离。“本机草稿”保留之前的预览作品。
3. 配置文本/图像/视频/语音模型，视觉模型声明图片输入能力。检查实际生成、预览、取消、保存重开。写作检查Goal关闭后恢复，星图检查文件正文、多候选及会话继续。
4. 在创作组件页保存已完成Job为交付草稿；在工作流选择组件任务、Role和草稿/生成操作，设置输出合同。草稿仍需授权并进入正常审核。
5. Role通过component.publishOutputs提交正式成果，审核后交下一角色。导出交付包，在新克隆中导入，验证缺对象阻断、合法对象恢复、篡改拒绝。
6. Spine检查机器人/实际角色、动作姿态、ZIP导出；外部ComfyUI/RIFE配置后检查实际流程。Spine编辑器导入/编辑/保存/重开单独签收。
7. 音乐安装所选引擎，检查生成、旋律、去人声、剪辑、导出。3D检查形状、贴图、绑定、动画、导出。硬件/资源不足应显示实际状态。
8. 旧任务运行时启用新组件，验证旧任务仍用原版；结束后卸载旧版。源更新走候选同步和冲突报告，始终不改LevelUp。

## 工程验证

最终源码基线：b3f447ae7d6a0f694f06e12c250f5fcb383b2f7b（运行时实现fc52f01，后续提交仅修正Windows验收临时路径）。2026-11-08完成以下验证，不把未运行的外部项目写成通过。

| 检查 | 最终结果 |
| --- | --- |
| 全仓Vitest | 251文件通过，768项通过、1项跳过；使用maxWorkers=4避免实Git测试并发负载超时 |
| 类型/lint/格式 | 全类型检查、src/config lint、修改范围格式通过 |
| 构建 | core、Electron main/preload/renderer生产构建及八组件构建通过 |
| 额外回归 | 四个原业务/桥接脚本通过；三个实际UI转换保存竞争测试通过；签名/证据绑定测试通过；来源/环境/打包脚本15项通过、2个macOS项跳过 |
| 桌面验收 | 九类全部通过，绑定当前提交、源码指纹、平台、Node24.19.0和八包manifest哈希 |
| 写作/星图 | 真实Electron+包进程；Goal关闭窗口后完成两步；文件正文、批准工具、会话继续通过 |
| Spine | 原UI和SDK实际导出均322753字节，ZIP包含atlas/PNG；视觉/Comfy本地协议fixture通过 |
| Windows打包 | electron-builder --win dir --x64 --publish never成功；打包EXE加载八组件、执行包后台、预览实际导出字节通过 |
| 文件一致性 | 八包逐文件及catalog哈希通过，总15264321字节；打包主入口与当前out一致 |
| 独立审查 | 最终复核没有剩余可行动P1/P2；早期发现均修复并回归 |

EXE SHA-256：4fb439fdefca5e376fae8239929ac27bcd6b322c0521036e8b9be0316b16dbe8。
app.asar SHA-256：592d48a926b2efcee1ba38bd58c9b7cd440149059bd74d87781d7a1ff2385831。

早期并行媒体场景曾因音频元数据回调失败，单独重跑通过；原生场景曾因临时路径过长导致LevelDB打开失败，修正短临时目录后通过。记录保留失败事实，不把第一次运行写成通过。当前traceability的九项均为最终实际重跑结果。全仓曾有Windows命令引用/权限测试基线问题，本版修复后全仓通过。

- 单元/集成覆盖：权限拒绝/批准、固定版本/篡改、真实进程树退出、共享资源与项目隔离、正式草稿/Role合同、Kernel审核、全新克隆消费、原Goal/星图算法、保存竞争。
- 九类桌面场景：安装生命周期、图片/语音、视频、写作/后台Goal、Spine原UI/SDK导出、星图文件/工具/会话、原生无资源状态、离屏算法、打包EXE后台执行。
- 入口：creative:evidence <lifecycle|media|video|writing|spine|graph|native|offscreen|packaged>，然后creative:traceability。报告与实际源码及包绑定。

## 后续更新与发布

UI/业务更新在MAM候选树重放适配补丁、测试、构建新组件。已演练真实UI/纯函数继承；Rust/Python/资源协议变更列人工适配清单并重做合同测试。宿主API不变时随组件更新；API变化才要求升级宿主。不承诺任意大改都可无人值守迁移。

离线签名catalog工具及外部公钥验证见[说明](creative-offline-catalog.md)。没有伪造官方签名、部署线上市场或自动发布。跨克隆已走显式交付包，LFS自动同步不属于当前交付路径。

## 当前环境未完成的验证

- Windows本机对GitHub资源下载端点的三次小manifest连接均超时；未下载多GiB引擎，真实MusicGen/ACE-Step/YuE2、3D形状/贴图及GPU质量未签收。
- 本地HTTP厂商fixture不代表真实图像/视频/语音质量通过；实际ComfyUI/RIFE、Spine商业编辑器往返需对应环境。
- 当前无macOS实机，未声称macOS原生音乐/3D支持。
- 已报告用量按Attempt累计限制，未知价格无法在调用前精确封顶，已发请求的计费无法撤销。

这些是外部环境和质量验收项目。源码、可运行包和具体测试证据才是本次交付依据。

