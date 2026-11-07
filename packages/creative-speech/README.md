# 语音工作台

安装包 ID `creative.speech`，版本 `0.1.0`，最低 MAM `0.1.41`。通过 `componentHost.request` 调用宿主管理的语音模型和持久化任务，不读取密钥、端点或原始文件路径。模型仅显示 `kind=speech` 且支持 `speech.generate` 的条目；音色与格式从模型能力获取。提交前捕获参数并锁定表单。

支持文本生成、音色/格式、关闭窗口后继续任务、历史、音频播放、原始文件导出、复用、重试、取消和终态记录删除。轮询使用 single-flight 与 afterSequence，未变化卡片保留播放状态。空模型指引前往 MAM 设置。删除记录不删除宿主资产。

构建：Node24 执行 `config/scripts/build-creative-speech.mjs`。验证：`config/scripts/verify-creative-speech.mjs`。产物在 `.mam-local/component-packages/creative-speech`；原始 MediaStudio.tsx/media.rs 和独立实现 speech.js SHA256 映射位于产物 provenance.json。

原生 Electron 测试通过：清单文件哈希、实际提交/复用/重试按钮、音色/格式传参、真实 WAV 解码与一秒时长播放、720px 浅色/深色无横向溢出。证据 `.mam-local/creative-speech-qa/result.json` 和截图。宿主在此测试中明确模拟；真实 HTTP 提供商路径由集成测试另行验证。未验证付费提供商质量。未修改原始或 vendor 源码，无提交。
