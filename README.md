# 1010 Trae 活动

1010 Trae 活动页面集合，纯静态 HTML 实现，无需构建工具。

## 页面说明

| 文件 | 说明 |
| --- | --- |
| [index.html](index.html) | 活动主页 |
| [lucky-wheel.html](lucky-wheel.html) | 幸运转盘 |
| [quiz-proto.html](quiz-proto.html) | AI 圈梗与常识快问快答，81 道题，每轮 5 题 |

## 本地预览

直接用浏览器打开 HTML 文件即可，或启动任意静态服务器：

```bash
python3 -m http.server 8080
```

## 目录结构

```
├── index.html                  # 活动主页
├── lucky-wheel.html            # 幸运转盘
├── quiz-proto.html             # AI 圈梗与常识快问快答
├── UI_DESIGN_GUIDELINES.md     # 视觉规范、现状记录与统一建议
├── ironspirit-activity.design  # 活动设计文件
└── trae活动统一风格.design/     # 统一风格设计资源（样式、图标、组件）
```

## 协作说明

### 快问快答整合与回退

- 排版以本地 `quick-quiz/index.html` 为主，配色与活动主页的紫靛色保持一致。
- 按题目 ID 合并：18 道圈梗题采用本地文本，保留仓库中另外 63 道常识题，共 81 道；每轮随机抽 5 道，选项顺序随机。
- 每题 5 秒，答错或超时结束本轮；五题全对由现场工作人员核验 1 次抽奖机会。
- 整合前的 Git 回退点为 `453c9b8`。本次整合使用独立提交，未自动推送到远端。
- 回退整合时先运行 `git log --oneline -5`，找到标题为「1. 融合本地快问快答排版并统一紫靛配色与题库」的提交，再执行 `git revert <该提交的哈希>`。此方式新增回退提交并保留历史；后续如有改动或冲突，应先处理本地工作。
- 本地原文件 `quick-quiz/index.html` 保持原样，未被替换。

- 提交信息使用中文，按序号分点描述变更内容
- `.trae/`、`.trae-html-share-packages/` 为 IDE 产物，已在 `.gitignore` 中忽略
