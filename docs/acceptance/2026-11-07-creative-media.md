# 图片与语音接入验收

日期：2026-11-07。MAM 开发版本 0.1.41，图片包 0.2.0，语音包 0.1.0。

## 验证范围

1. `verify-media-desktop.mjs` 使用正式 Electron 构建、正式组件 IPC/Job/AssetStore，以及临时本机 HTTP 服务。通过 MAM 模型连接入口写入测试凭据，组件只获得无密钥的模型目录。
2. 图片生成请求到 `/v1/images/generations`；参考图编辑到 `/v1/images/edits`；语音到 `/v1/audio/speech`。请求真实经过本机网络，模型输出由测试服务提供，没有真实外部模型调用。
3. 提交后关闭工作台，重新打开取得完成的 Job；同一幂等键返回原 Job，未重复请求。结果通过专用资产协议解码成 8×8 图片；导出与源返回字节一致。
4. 语音结果为 24kHz 单声道 1 秒 WAV，实际 Audio 元素解析时长并导出原始字节。语音窗口不能读取图片组件的 Job。
5. 图片原生 QA 另覆盖批次准备时修改界面、异步存储蒙版时改变参考、模型格式切换、蒙版能力过滤、重试/复用与浅深色 720px 布局。
6. 协议单元回归覆盖声明支持的路由、密钥固定、缺少密钥时不发请求、mask 限制、批量单张并发与部分失败、取消、HTTP 错误、输出验证及安全下载。具体路由仍以 `src/main/mam/media/` 的能力目录和测试为准。

## 复现

在支持的 Node 版本下执行：

```text
node config/scripts/build-creative-image.mjs
node config/scripts/build-creative-speech.mjs
pnpm build
node config/scripts/verify-media-desktop.mjs
node config/scripts/verify-creative-image.mjs
node config/scripts/verify-creative-speech.mjs
```

本机证据位于 `.mam-local/media-desktop-qa/latest.json`、`light.png`、`dark.png`，图片和语音专门 QA 位于各自 `.mam-local/*-qa/` 目录。这些是可重建的本机产物，不包含个人模型凭据。

## 当前边界

这证明图片/语音的 MAM 调用与交付路径工作，不证明所有厂商在线兼容、视频生成或其他工作台已完成。完整计划状态继续以执行进度表为准。
