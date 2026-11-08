# 图像工作台

creative.image0.2.0，最低宿主0.1.41；本地候选与MAM0.1.42集成。支持模型生成、参考图编辑、透明蒙版重绘/扩图、批次、历史、重试/复用/取消/删除、原图预览导出，以及原始spineMatting本地纯色抠图。模型格式及蒙版能力来自宿主。

验证：原始抠图算法与真实PNG导入/处理/导出、720px明暗布局、延迟批次/蒙版竞态和模拟宿主按钮测试通过。真实宿主本地HTTP提供商链路另有集成证据，不代表付费提供商质量。构建build-creative-image.mjs，验证verify-creative-image.mjs（均位于config/scripts）。原始算法与手动UI适配映射、哈希见产物provenance.json。
