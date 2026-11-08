# 视频工作台

creative.video0.1.0，最低MAM0.1.42。使用宿主实际视频模型能力，支持文本/参考输入、持久化生成任务、远端回执刷新、历史预览与原始资产导出。服务路由video.generate/video.edit/video.refresh；实际模式由模型能力限制。

验证：组件原生UI与真实宿主本地HTTP集成证据位于.mam-local/creative-video-qa与video-desktop-qa；原生MediaRecorder生成的H.264MP4夹具供播放验证。该证据不代表付费提供商或GPU生成质量。构建build-creative-video.mjs，验证verify-creative-video.mjs。源与手动适配映射见provenance.json。
