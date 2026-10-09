# 1010 Trae 活动

1010 Trae 活动页面集合。主页和快问快答使用静态 HTML；幸运转盘由本机 Node.js + SQLite 服务保存库存和抽奖记录，无需构建工具或第三方运行依赖。

## 页面说明

| 文件 | 说明 |
| --- | --- |
| [index.html](index.html) | 活动主页 |
| [lucky-wheel.html](lucky-wheel.html) | 幸运转盘 |
| [quiz-proto.html](quiz-proto.html) | AI 圈梗与常识快问快答，81 道题，每轮 5 题 |

## 本地预览

安装 Node.js 24.15+ 的 24.x，在此仓库目录启动后台服务：

```powershell
node scripts/service.cjs start
# 停止后台服务，保留库存和记录
node scripts/service.cjs stop
```

打开 <http://127.0.0.1:5173/>。前台开发运行 `npm start`，自动化检查运行 `npm test`。转盘需要服务运行，直接打开 HTML 文件不能抽奖。

后台服务关闭终端后继续运行，异常退出后自动重试；Windows 重启后需重新启动。详细调研、概率、旧缓存迁移、备份恢复和接口说明见 [本地抽奖服务说明](docs/LOTTERY_SERVICE.md)。

## 目录结构

```
├── index.html                  # 活动主页
├── lucky-wheel.html            # 幸运转盘
├── quiz-proto.html             # AI 圈梗与常识快问快答
├── wheel.js                    # 转盘显示与服务交互
├── server/                     # 本机 HTTP 服务、事务库存、默认奖项
├── scripts/                    # 后台启动、停止、备份恢复
├── tests/                      # 库存、重复请求、并发和恢复检查
├── docs/LOTTERY_SERVICE.md     # 抽奖方案、概率和运行维护
├── data/                       # 运行数据库、日志与备份，Git 忽略
├── UI_DESIGN_GUIDELINES.md     # 视觉规范、现状记录与统一建议
├── ironspirit-activity.design  # 活动设计文件
└── trae活动统一风格.design/     # 统一风格设计资源（样式、图标、组件）
```

## 协作说明

### 快问快答整合与回退

- 排版以本地 `quick-quiz/index.html` 为主，配色与活动主页的紫靛色保持一致。
- 按题目 ID 合并：18 道圈梗题采用本地文本，保留仓库中另外 63 道常识题，共 81 道；每轮随机抽 5 道，选项顺序随机。
- 每题 5 秒，答错或超时结束本轮；五题全对由现场工作人员核验 1 次抽奖机会。
- 整合前的 Git 回退点为 `453c9b8`。整合提交为 `12e22d6`，已推送到远端。
- 回退整合时先运行 `git log --oneline -5`，找到标题为「1. 融合本地快问快答排版并统一紫靛配色与题库」的提交，再执行 `git revert <该提交的哈希>`。此方式新增回退提交并保留历史；后续如有改动或冲突，应先处理本地工作。
- 本地原文件 `quick-quiz/index.html` 保持原样，未被替换。

### 抽奖服务整合与回退

- 服务整合前的 Git 回退点为 `12e22d6`，新实现使用独立中文提交。
- 代码回退使用 `git revert <服务提交哈希>`。库存与记录保存在忽略的 `data/` 中，Git 回退不会回退抽奖进度。
- 恢复数据使用页面生成的 SQLite 备份和 `scripts/Restore-Backup.ps1`；不要删除运行数据库来重置奖池。
- 默认普通奖池 200 签、58 份实物，初始中奖率 29%；一等奖新增手办 1 份与二等奖 TRAE 宝手办 4 份分别计算。Agent 贴纸和定时抽奖礼品单独管理。

- 提交信息使用中文，按序号分点描述变更内容
- `.trae/`、`.trae-html-share-packages/` 为 IDE 产物，已在 `.gitignore` 中忽略
