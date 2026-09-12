# 📚 Problem Planner

[English](./README-en.md) | [简体中文](./README.md)

A **cross-site problem planner** for OI / ACM / algorithm learners. Injected on all sites — whether you're practicing on Luogu, Codeforces, AtCoder, or UVa, you can add problems to your own plan anytime, with focus timers, check-ins, and statistics all in one place.

- 🦾 Script managers: **Tampermonkey**, etc.
- 🚀 Install online: [GreasyFork](https://greasyfork.org/scripts/565773) or [ScriptCat](https://scriptcat.org/zh-CN/script-show-page/7422)
- 📄 License: MIT
- Thanks to Deepseek for support in the script's development and this README; rest assured Deepseek's contribution far exceeds that of [Nuclear\_Fish\_cyq](https://www.luogu.com.cn/user/670355).
- Thanks to Tatsuki Fujimoto for spiritual support.
- Projects this script references: [luogu-api-doc](https://github.com/0f-0b/luogu-api-docs), [extend-luogu](https://github.com/extend-luogu/extend-luogu).

---

## ✨ Core Features

### 🎯 Plan Management

- Add problems quickly and accurately
- Mark as understood / complete / give up; completed problems are auto-archived
- Pin grouping and reordering within a group
- Problem notes
- Search by problem name and notes, plus a random problem picker
- Cross-platform support

### ⏱ Pomodoro Timer

- Focus / break timing with auto-break
- Focus time is automatically accumulated to the corresponding problem

### 📝 Memos

- Supports reordering and pinning

### 📊 Statistics

- Overview cards, 14-day trend, problem heatmap, difficulty distribution
- Daily goal setting + progress bar

### 📥 Deep Luogu & CF Integration

- One-click import of your existing Luogu problem plan and Luogu training lists
- Batch import on Luogu training list pages (supports "problem ID + title" format)
- Auto-fetch difficulty for Luogu and RMJ problems
- Auto-fetch tags for Luogu and CF problems

### 🌐 Multi-OJ Support

- One-click add for Luogu / Codeforces / AtCoder / UVa (SPOJ not yet supported)
- Quick manual problem adding

### 💾 Data Safety

- Export backup / merge import (dedup by URL) / one-click clear
- Data is stored locally only (GM storage)

---

## 🚀 Quick Start

1. Install a script manager: Tampermonkey or ScriptCat
2. Visit the [GreasyFork page](https://greasyfork.org/scripts/565773) and click Install
3. Click the floating button at the bottom-left of any page to start managing your problem plan!

## 🔧 Development / Contributing

```bash
# The .user.js in the repo root is the full source and can be installed directly
# Syntax check
node --check 做题计划管理器.user.js
```

- After pushing code, GitHub Actions will automatically run the syntax check
- Issues for bug reports / feature suggestions are welcome
- Version updates follow the live GreasyFork version

## ⚠️ Disclaimer

- Please use the training list import feature responsibly. The author is **not** responsible for the consequences of abusing the script. Do **not** frequently use Luogu API-related features. **Responsible** use of this plugin generally won't affect your OJ accounts.

## 📜 Changelog

### v3.12.x

- v3.12.0: Now you can skip accepted problems when importing a Luogu training list.

### v3.11.x

- v3.11.0: Major update. Added dark mode, English i18n, and the memo feature. One-click adding can auto-fetch tags as notes, and one-click training list import can filter by difficulty range.

### v3.7.x

- v3.7.2: Minor update (black difficulty color adjusted to #0A164F, random button size tweaked)
- v3.7.0: Major update. Added problem & note search, random problem, difficulty distribution, improved heatmap, difficulty editing, merge import

### v3.1.x

- v3.1.4: Fixed several bugs
- v3.1.2: Added training list UI; bug fixes and optimizations
- v3.1.1: Support importing Luogu problem plans and training lists; one-click add for Luogu / AT / CF / UVa

### v2.x

- v2.7.1: Problem sorting, completion archive, problem heatmap
- v2.2.x: Pomodoro timer, problem notes, UI overhaul

---

Made with ❤️ by [Nuclear\_Fish\_cyq](https://www.luogu.com.cn/user/670355)

This script's development cost about 14 yuan in tokens. Feel free to [donate](https://cdn.luogu.com.cn/upload/image_hosting/xzraqh5b.png) hehe.
