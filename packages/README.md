# 本地创作组件

参阅 [安装说明](INSTALL.zh-CN.md)。八个组件可以分别选择本地导入和启用；生成服务需要在 MAM 中配置模型，音乐与3D资源需要单独安装，组件包不含权重或凭据。

执行 `node config/scripts/build-creative-components.mjs` 构建并核验全部包。开发目录：`.mam-local/component-packages`；本地未签名候选包：`release/creative-components/0.1.42`。后者含 `catalog.json`、兼容表、清单哈希和许可证，可选择任一 `creative-*` 子目录安装。没有网络发布或签名。
