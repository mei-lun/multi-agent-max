# 创作星图

creative.constellation0.1.0，最低MAM0.1.42。保留原始12类节点、画布编辑器、概览、蓝图、撤销/重做、工程引用与持久化。模型节点调用宿主文本/视觉/图像/视频/语音任务；媒体等待状态由实际任务刷新。手动工具通过宿主检查/单次令牌执行。会话节点是瞬时模型调用，不创建独立MAM会话；MAM历史会话浏览尚无接口。

本地文件使用mam-asset字符串标识与完整附件元数据。通用文档仅向下游传递明确标注的文件元数据，不声称解析正文；手动文件路径不能绕过选择器。原始源码保持只读；构建时对constellationFileOutputs加入元数据文本的锚点变换，记录于provenance.json。缺失依赖的提交/哈希见upstream-input/manifest.json。

验证：原始DAG纯函数、原生工程创建/重载/720px明暗、真实MAM组件渲染与关闭、模拟宿主下实际原始执行器图像/语音/视频/写作/工具/文件六条路线通过。详见QA.md与FILE-IMPORT-REVIEW-FIX.md。实际GPU与付费提供商质量未验证。构建build-creative-constellation.mjs，验证verify-creative-constellation.mjs与verify-constellation-executor.mjs。
