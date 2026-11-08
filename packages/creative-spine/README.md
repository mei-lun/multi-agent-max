# 骨骼动画工作台

creative.spine0.1.0，最低MAM0.1.42。保留原始Studio/Canvas/各面板及骨骼算法，支持部件、绑定、蒙皮、关键帧、动作、姿态研究、工程保存与含PNG/JSON/atlas工程的Spine4.2ZIP导出。稳定宿主分区保存IndexedDB，关闭等待保存完成。

图像生成/编辑及视觉文本助手通过宿主资产授权与模型任务运行。ComfyUI端点在原始面板配置，宿主受控连接；RIFE使用MAM原生选择器选择程序和模型目录。两者需用户已有本地安装。

验证：原始机器人示例、编辑保存/重载、真实ZIP导出及图片解码、720px明暗布局和真实宿主组件集成通过。实际CUDA推理、用户ComfyUI/RIFE环境与提供商输出质量未验证。构建build-creative-spine.mjs，验证verify-creative-spine.mjs。源哈希及桥接适配见provenance.json。
