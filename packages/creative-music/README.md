# 音乐工作台

creative.music0.1.0，最低MAM0.1.42。原始MusicWorkbench与核心保留ACE-Step/MusicGen/YuE2三引擎、纯音乐/歌曲、参考音频、作品库、收藏/归档、裁剪淡入淡出和资源管理。Python控制/工作进程与固定资源清单随包提供，不含权重。

宿主music任务管理生成/状态/取消；只有原生接收回执到达后显示排队。预览导出使用授权资产；参考音频与离线目录由宿主选择器处理。资源取消使用music.resources.cancel。

验证：真实MAM无资源状态和组件渲染、明确模拟宿主状态/引擎选择、720px明暗布局通过。资源安装和实际GPU推理未运行，不声明已安装。构建build-creative-music.mjs，验证verify-creative-music.mjs。原始依赖及适配来源哈希见provenance.json。
