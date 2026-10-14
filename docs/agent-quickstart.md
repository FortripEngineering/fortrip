# 在 AI 助手里用 Fortrip 订酒店

需要 Node.js 22 或更新版本。

## 1. 安装 skill

在你的项目目录里运行：

```bash
npx skills add FortripEngineering/fortrip-cli
```

支持 Cursor、Claude Code、Codex、Cline 等主流 AI 助手。

## 2. 直接说需求

例如：

> 帮我找 11 月 10 日到 12 日曼谷的四星酒店，含早餐，可免费取消。

第一次使用时，助手会请你在终端运行：

```bash
npx fortrip login
```

在浏览器里登录并确认后，助手就能帮你搜索、比价并生成支付链接。付款前，它会先给你看取消政策和实际扣款金额。

## 不装 skill 的用法

把下面这段话直接发给 AI 助手：

> Use the Fortrip CLI to book hotels: run `npx -y fortrip --help` to see the commands. If a command exits with code 3, ask me to run `npx fortrip login` in my terminal. Always show me the cancellation terms and the final amount before giving me a payment link.

这种方式只包含最关键的规则，推荐优先使用 skill。
