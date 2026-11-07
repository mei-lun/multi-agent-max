# 3D工作台

creative.model3d0.1.0，最低MAM0.1.42。原始ModelWorkbench/Viewer/ReferenceEditor保留形状、纹理、骨骼动画、关节编辑、资源/硬件/导出界面。Python控制/工作进程及固定资源清单随包提供，不含模型权重。参考图用宿主AssetRef，资源目录与输出文件由原生对话框管理。

验证：真实宿主无资源状态、720px明暗布局，以及原始Viewer通过组件协议加载真实合成GLB（PNG纹理、UV、蒙皮、骨骼、Lift动画）；已断言动画推进与截图彩色像素。详见QA.md。未运行实际GPU生成。构建build-creative-model3d.mjs，验证verify-creative-model3d.mjs与verify-model3d-viewer.mjs。原始viewer许可证与来源哈希随包提供。
