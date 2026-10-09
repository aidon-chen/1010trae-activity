# 1010 Trae 活动

1010 Trae 活动页面集合，纯静态 HTML 实现，无需构建工具。

## 页面说明

| 文件 | 说明 |
| --- | --- |
| [index.html](index.html) | 活动主页 |
| [lucky-wheel.html](lucky-wheel.html) | 幸运转盘 |
| [quiz.html](quiz.html) | 知识问答 |

## 本地预览

直接用浏览器打开 HTML 文件即可，或启动任意静态服务器：

```bash
python3 -m http.server 8080
```

## 目录结构

```
├── index.html                  # 活动主页
├── lucky-wheel.html            # 幸运转盘
├── quiz.html                   # 知识问答
├── ironspirit-activity.design  # 活动设计文件
└── trae活动统一风格.design/     # 统一风格设计资源（样式、图标、组件）
```

## 协作说明

- 提交信息使用中文，按序号分点描述变更内容
- `.trae/`、`.trae-html-share-packages/` 为 IDE 产物，已在 `.gitignore` 中忽略
