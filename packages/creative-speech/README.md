# 语音工作台

creative.speech0.1.0，最低宿主0.1.41，与MAM0.1.42集成。支持宿主语音模型/音色/格式、生成任务、历史、播放、原音频导出、复用/重试/取消/删除。模型缺失时引导MAM设置；窗口关闭不取消已提交任务。

验证：清单哈希、模拟宿主实际提交/复用/重试按钮、真实WAV解码播放、720px明暗布局通过。付费提供商质量未验证。构建build-creative-speech.mjs，验证verify-creative-speech.mjs。源MediaStudio/media.rs与独立UI映射记录于产物provenance.json。
