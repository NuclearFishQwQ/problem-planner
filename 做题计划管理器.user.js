// ==UserScript==
// @name         做题计划管理器
// @namespace    http://tampermonkey.net/
// @version      3.14.1
// @description  跨站做题计划管理器 v3.14.1：完成归档、置顶排序、统计图表、题目备注、番茄钟计时、题目搜索、随机一题、自定义颜色（颜色即难度）、每日目标、难度统计、洛谷题单导入、题单页批量导入（可跳过洛谷已通过题目）、题目一键加入（洛谷、AT、CF、UVa，SPOJ暂不支持）。标签自动按「来源/时间/区域/算法/特殊题目」分类排序，洛谷标签支持英文；CF 题目自动附带 CF 标签与难度评分；内置备忘录 + 日历（可手动添加日程、洛谷比赛一键加入、紧急置顶、排序、计数角标）；完整中英文界面（可在设置中切换）。v3.14.0：新增洛谷本地题库缓存（一次性下载公开题库到本地，导入/一键加入不再逐题请求，大幅降低请求量，避免触发异常访问判定）；批量请求限速；已通过集合与 CF 信息本地缓存。
// @author       Nuclear_Fish_cyq
// @match        *://*/*
// @license      MIT
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      www.luogu.com.cn
// @connect      luogu.com.cn
// @connect      cdn.luogu.com.cn
// @connect      codeforces.com
// @connect      www.codeforces.com
// @downloadURL https://update.greasyfork.org/scripts/565773/%E5%81%9A%E9%A2%98%E8%AE%A1%E5%88%92%E7%AE%A1%E7%90%86%E5%99%A8.user.js
// @updateURL https://update.greasyfork.org/scripts/565773/%E5%81%9A%E9%A2%98%E8%AE%A1%E5%88%92%E7%AE%A1%E7%90%86%E5%99%A8.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 基础配置 ====================

    // 只在顶层窗口运行，避免 iframe 中重复创建
    if (window.self !== window.top) return;

    // 预定义颜色选项（与洛谷难度一一对应：灰<红<橙<黄<绿<青<蓝<紫<黑）
    // 颜色即难度：统计/热力图按用户选择的颜色判定难度，改颜色 = 改难度
    const COLOR_OPTIONS = [
        '#BFBFBF', '#FE4C61', '#F39C11', '#FFC116', '#52C41A',
        '#13C2C2', '#3498DB', '#9D3DCF', '#0A164F'
    ];

    // 洛谷难度系统（0-8，颜色顺序：灰红橙黄绿青蓝紫黑）
    const DIFFICULTY_META = [
        { label: '暂无评定', color: '#BFBFBF' },
        { label: '入门',     color: '#FE4C61' },
        { label: '普及-',    color: '#F39C11' },
        { label: '普及',     color: '#FFC116' },
        { label: '普及+/提高', color: '#52C41A' },
        { label: '提高',     color: '#13C2C2' },
        { label: '提高+/省选-', color: '#3498DB' },
        { label: '省选/NOI-', color: '#9D3DCF' },
        { label: 'NOI/NOI+/CTS', color: '#0A164F' }
    ];
    const DIFF_MAX = DIFFICULTY_META.length - 1;

    // 洛谷难度英文名（与 DIFFICULTY_META 顺序一致，用于英文界面）
    const DIFFICULTY_META_EN = [
        'Unrated', 'Beginner', 'Popularization-', 'Popularization',
        'Popularization+/Improvement', 'Improvement', 'Improvement+/Provincial-',
        'Provincial/NOI-', 'NOI/NOI+/CTS'
    ];

    // 存储键名（沿用旧版，保证无缝升级）
    const STORAGE_KEY = 'problemPlanner_data';
    const ARCHIVE_KEY = 'problemPlanner_archive';
    const COUNT_KEY = 'problemPlanner_completedCount';
    const TIMER_KEY = 'problemPlanner_timer';
    const SETTINGS_KEY = 'problemPlanner_settings';
    const MEMO_KEY = 'problemPlanner_memos';

    // 默认设置
    const DEFAULT_SETTINGS = {
        focusMinutes: 25,
        breakMinutes: 5,
        autoBreak: true,
        dailyGoal: 0,
        theme: 'auto', // auto | light | dark（跟随系统 / 浅色 / 深色）
        lang: 'zh-CN'  // zh-CN | en | auto（跟随系统语言）
    };

    // ==================== 状态 ====================

    let problems = [];
    let archive = [];
    let completedCount = 0;
    let isPanelVisible = false;
    let settings = { ...DEFAULT_SETTINGS };
    let selectedColor = COLOR_OPTIONS[0];
    let editingUrl = null;
    let timerState = null;
    let timerInterval = null;
    let currentTab = 'active'; // active | done | stats | memo
    let searchQuery = ''; // 进行中列表的搜索关键词
    let currentLang = 'zh-CN'; // 当前界面语言（由 settings.lang 解析）
    let memos = []; // 备忘录列表 {id, text, urgent, createdAt}

    // ==================== 国际化 (i18n) ====================

    const I18N = {
        'zh-CN': {
            'app.name': '做题计划',
            'fab.text': '题',
            'fab.title': '打开做题计划（跨网站同步）',
            'tab.active': '进行中', 'tab.done': '已完成', 'tab.stats': '统计', 'tab.memo': '备忘',
            'form.urlLabel': '题目网址', 'form.nameLabel': '题目名称', 'form.colorLabel': '选择颜色',
            'form.namePlaceholder': '默认使用当前页面标题', 'form.addBtn': '添加题目到计划',
            'search.placeholder': '🔍 搜索题目名 / 备注 / 网址…',
            'search.randomBtn': '🎲 随机一题', 'search.randomTitle': '从未理解题目中随机抽一道',
            'backup.title': '💾 数据备份',
            'backup.export': '导出数据', 'backup.import': '导入数据', 'backup.clear': '清空数据',
            'backup.luogu': '📥 洛谷导入', 'backup.settings': '⚙ 设置',
            'backup.note': '导出包含进行中、已完成归档、备忘 / 日历、计时统计（v3 格式）',
            'backup.filename': '做题计划备份',
            'luogu.urlLabel': '洛谷题单 / 做题计划链接',
            'luogu.uidLabel': '洛谷 UID', 'luogu.uidTitle': '可选：填写你的洛谷用户编号（个人主页 user/ 后面的数字）。填写后「跳过已通过」不依赖登录检测，跨站也能用', 'luogu.uidPlaceholder': '如 670355（可选）',
            'luogu.tagsLabel': '🏷 添加标签', 'luogu.tagsTitle': '导入时自动获取题目标签写入备注',
            'luogu.diffLabel': '难度', 'luogu.diffTitle': '只导入该难度范围内的题目',
            'luogu.skipPassedLabel': '✅ 跳过已通过', 'luogu.skipPassedTitle': '导入时跳过洛谷上已通过的题目',
            'luogu.start': '开始导入题单', 'luogu.homeImport': '从当前洛谷主页任务计划导入',
            'settings.focus': '专注时长', 'settings.minutes': '分钟', 'settings.break': '休息时长',
            'settings.autoBreak': '自动休息', 'settings.autoBreakDesc': '专注结束后自动开始休息',
            'settings.dailyGoal': '每日目标', 'settings.dailyGoalDesc': '题（0 = 不启用）',
            'settings.theme': '主题', 'settings.themeAuto': '跟随系统', 'settings.themeLight': '浅色',
            'settings.themeDark': '深色', 'settings.themeDesc': '面板外观',
            'settings.lang': '语言', 'settings.langAuto': '跟随系统', 'settings.langZh': '中文', 'settings.langEn': 'English',
            'footer.notUnderstood': '未理解', 'footer.understood': '已理解',
            'footer.completed': '已完成', 'footer.totalTime': '累计专注',
            'misc.unnamed': '(未命名)', 'misc.unnamedProblem': '未命名题目',
            'memo.placeholder': '输入备忘内容…', 'memo.addBtn': '添加',
            'cal.today': '今天', 'cal.prev': '上个月', 'cal.next': '下个月', 'cal.ym': '{y} 年 {m} 月',
            'cal.empty': '这天还没有安排', 'cal.addHere': '新条目将添加到 {d}', 'cal.clearDate': '清除日期',
            'memo.dateLabel': '日期', 'memo.timeLabel': '时间', 'memo.linkLabel': '链接',
            'memo.dateBtnTitleAdd': '添加日期（显示在日历上）', 'memo.dateBtnTitleSet': '编辑日期 / 时间 / 链接',
            'memo.linkOpen': '打开链接', 'memo.linkPlaceholder': '比赛 / 题目链接（可选）',
            'toast.dateSaved': '日程已保存', 'toast.memoAddedDay': '已添加到 {d}', 'toast.dateCleared': '已清除日期',
            'contest.addBtn': '📅 加入日历', 'contest.addBtnTitle': '把这场比赛加入做题日历',
            'contest.addedOk': '✓ 已加入日历', 'contest.alreadyAdded': '该比赛已在日历中', 'contest.fetchFail': '读取比赛信息失败',
            'toast.contestAdded': '📅 已加入日历：{name}',
            'memo.empty': '暂无备忘，点击上方输入框添加',
            'memo.allTitle': '全部备忘（{n}）',
            'memo.urgent': '紧急', 'memo.unurgent': '取消紧急',
            'memo.urgentTitle': '设为紧急备忘（置顶显示，角标变红）', 'memo.unurgentTitle': '取消紧急标记',
            'memo.delete': '删除', 'memo.deleteTitle': '删除该备忘',
            'memo.confirmDelete': '确定删除这条备忘吗？', 'memo.urgentBadge': '紧急',
            'item.understand': '理解', 'item.understandTitle': '标记为已理解（移至底部）',
            'item.complete': '完成', 'item.completeTitle': '标记为已完成（移入归档）',
            'item.giveup': '放弃', 'item.giveupTitle': '放弃此题（不计入完成）',
            'item.note': '备注', 'item.noteTitleEdit': '编辑备注（已展示在下方）', 'item.noteTitleAdd': '添加备注',
            'item.noteViewTitle': '点击可编辑备注',
            'item.color': '颜色', 'item.colorTitleSet': '修改自定义颜色（当前已设置）', 'item.colorTitleCustom': '自定义题目颜色（覆盖难度色）',
            'item.resetColor': '恢复默认', 'item.resetColorTitle': '清除自定义颜色',
            'item.timer': '计时', 'item.timerTitle': '番茄钟：开始 {m} 分钟专注',
            'item.stop': '停止', 'item.stopTitle': '停止计时（结算已专注时间）',
            'item.pinned': '已置顶', 'item.pin': '置顶', 'item.pinTitleUnpin': '取消置顶', 'item.pinTitle': '置顶（排在列表前面）',
            'item.moveUp': '上移', 'item.moveDown': '下移', 'item.timeBadgeTitle': '累计专注时长',
            'timer.focusPause': '专注中…点击暂停', 'timer.paused': '已暂停，点击继续', 'timer.break': '休息中…点击跳过',
            'note.placeholder': '记录思路、坑点、题解链接…', 'note.save': '保存', 'note.cancel': '取消',
            'empty.active': '暂无待做题目，请添加题目到计划中', 'empty.noMatch': '没有匹配「{q}」的题目',
            'archive.summary': '共 {n} 条完成记录', 'archive.time': '归档专注 {d}',
            'archive.empty': '暂无完成记录，做完题目会自动归档到这里',
            'archive.completedAt': '✅ 完成于 {d}', 'archive.focus': '⏱ 专注 {d}', 'archive.addedAt': '📅 添加于 {d}',
            'archive.restore': '恢复', 'archive.restoreTitle': '恢复到进行中列表',
            'archive.delete': '删除', 'archive.deleteTitle': '永久删除该条完成记录',
            'stats.total': '总完成', 'stats.today': '今日完成', 'stats.streak': '连续打卡(天)', 'stats.totalTime': '累计专注',
            'stats.goalTitle': '🎯 今日目标', 'stats.goalProgress': '{t} / {g} 题', 'stats.goalDone': ' · 达成 🎉',
            'stats.trendTitle': '14 天完成趋势', 'stats.trendSub': '每天完成的题目数',
            'stats.diffTitle': '难度分布', 'stats.diffSub': '已完成题目 · 洛谷难度', 'stats.diffNone': '暂无评定',
            'stats.heatmapTitle': '月度打卡热力图', 'stats.heatmapSub': '最近 15 周 · 颜色=最难题难度，色深=完成数',
            'stats.legendDifficulty': '难度', 'stats.legendCount': '完成数',
            'stats.trendTooltip': '{m}月{d}日：完成 {n} 题', 'stats.heatTooltip': '{m}月{d}日：完成 {n} 题 · 最难 {l}',
            'confirm.complete': '确定要标记题目 "{name}" 为已完成吗？',
            'confirm.giveup': '确定要放弃题目 "{name}" 吗？',
            'confirm.restore': '将 "{name}" 恢复到进行中列表？',
            'confirm.deleteRecord': '永久删除记录 "{name}"？（不影响已完成计数）',
            'confirm.clear': '确定要清空所有数据（含已完成归档、备忘与日历）吗？此操作不可撤销。',
            'confirm.import': '准备合并导入 {a} 个进行中题目\n已完成归档：{b} 条\n备忘录：{d} 条\n完成计数：{c}\n\n合并模式：按网址去重，已存在的题目不会被覆盖。\n确定继续吗？',
            'alert.importFail': '导入失败：{e}\n\n请确保选择的是有效的备份文件。',
            'toast.imported': '合并完成：新增进行中 {a} · 归档 {b}',
            'toast.importedMemos': ' · 备忘 {n}',
            'toast.importedSkip': ' · 跳过重复 {n}',
            'toast.moveRestricted': '置顶与未置顶不能互相移动',
            'toast.noteSaved': '备注已保存', 'toast.recordDeleted': '记录已删除',
            'toast.alreadyActive': '该题目已在进行中，仅移除归档记录', 'toast.restored': '已恢复到进行中',
            'toast.noUnsolved': '暂无未理解的题目 🎉', 'toast.randomPick': '🎲 随机一题：{name}',
            'toast.focusDoneBreak': '专注完成！休息一下吧 ☕', 'toast.focusDone': '专注完成！🏆',
            'toast.breakDone': '休息结束，继续加油 💪', 'toast.focusStart': '开始专注 {m} 分钟 ⏱',
            'toast.settingsSaved': '设置已保存', 'toast.exported': '数据已导出（含归档）', 'toast.cleared': '数据已清空',
            'toast.nothingToClear': '当前没有可清空的数据',
            'toast.addSuccess': '添加成功！', 'toast.added': '已加入计划', 'toast.addedDiff': '已加入计划 · 难度 {d}',
            'toast.addedTags': ' · 标签 {n} 个',
            'toast.alreadyInPlan': '此题目已在计划中！', 'toast.alreadyDone': '此题目已在已完成记录中！',
            'toast.tagsOn': '已开启：加入时自动获取标签写入备注', 'toast.tagsOff': '已关闭：加入时不获取标签',
            'toast.skipPassedOn': '已开启：导入时跳过已通过题目', 'toast.skipPassedOff': '已关闭：导入时不跳过已通过题目',
            'toast.goalDone': '🎯 今日目标 {g} 题已达成！太棒了', 'toast.archived': '已归档 🎉 · 今日 {t}/{g}', 'toast.archivedPlain': '已归档 🎉',
            'alert.invalidUrl': '请输入有效的网址！', 'alert.alreadyDoneAdd': '此题目已在已完成记录中，不能重复添加！',
            'alert.readFail': '读取文件失败，请重试', 'alert.fetchFail': '获取题目信息失败：{e}\n\n题目未加入。',
            'alert.joinFail': '加入失败：{e}', 'alert.enterLuoguUrl': '请先粘贴洛谷题单链接',
            'alert.invalidData': '数据格式不正确：缺少题目列表',
            'err.luoguStatus': '洛谷返回状态码 {s}',
            'err.network': '网络请求失败',
            'err.timeout': '请求超时',
            'err.luoguMissing': '洛谷未收录该题或解析失败（{pid}）',
            'err.onlyTraining': '仅支持洛谷题单链接（luogu.com.cn/training/xxx）',
            'err.noPids': '未从题单中解析到题目（请检查链接是否有效）',
            'err.cfFail': '获取 CF 题目信息失败',
            'err.passedFetch': '获取已通过题目列表失败：{e}，本次导入不跳过已通过题目',
            'err.passedFormat': '洛谷未返回有效数据（可能未登录或接口已变更）',
            'import.parsing': '正在解析题单…', 'import.found': '解析到 {n} 道题，开始获取题目信息…',
            'import.fetchDb': '⏳ 正在准备洛谷本地题库（首次使用需下载一次，之后导入零请求）…',
            'import.fetchPassed': '正在获取已通过题目列表…',
            'import.noModule': '未在主页找到任务计划模块，请确认已登录洛谷并打开主页。',
            'import.homeFound': '主页任务计划解析到 {n} 道题，开始获取难度…',
            'import.fetching': '正在获取 {i}/{n}：{pid} …', 'import.done': '导入完成：新增 {a} · 跳过 {s}',
            'import.doneDiff': ' · 难度不符 {d}', 'import.doneFail': ' · 失败 {n}', 'import.failList': '失败题目：{list}',
            'import.donePassed': ' · 已通过跳过 {n}',
            'import.passedSkipDisabled': '未检测到洛谷登录状态，本次导入不跳过已通过题目（请在洛谷页面使用）',
            'toast.trainingDone': '题单导入完成：新增 {a} · 跳过 {s}', 'toast.trainingFail': '题单导入失败：{e}',
            'oj.fetching': '⏳ 获取中…', 'oj.addBtn': '＋ 加入做题计划', 'oj.addBtnTitle': '获取洛谷 RMJ 难度并加入做题计划',
            'oj.joined': '✓ 已加入', 'oj.tagToggle': '🏷 标签', 'oj.tagToggleOn': '🏷 标签 ✓',
            'oj.tagToggleTitle': '点击切换：是否自动获取题目标签写入备注（当前：{s}）', 'oj.on': '开', 'oj.off': '关',
            'oj.diff': '🎚 难度', 'oj.diffTitle': '选择加入题目的难度范围', 'oj.diffMin': '最低', 'oj.diffMax': '最高',
            'oj.skipPassed': '⏭ 已通过', 'oj.skipPassedOn': '⏭ 已通过 ✓', 'oj.skipPassedTitle': '点击切换：导入时跳过洛谷上已通过的题目（当前：{s}）',
            'training.importAll': '📥 导入整个题单', 'training.importAllTitle': '将当前洛谷题单的所有题目批量加入做题计划',
            'training.parsing': '⏳ 解析题单…', 'training.fetching': '⏳ 获取题目信息…', 'training.imported': '✓ 已导入 {n} 题',
            'home.importBtn': '从当前洛谷主页任务计划导入', 'home.needHome': '需在洛谷主页使用'
        },
        'en': {
            'app.name': 'Problem Planner',
            'fab.text': 'P',
            'fab.title': 'Open Problem Planner (synced across sites)',
            'tab.active': 'In Progress', 'tab.done': 'Completed', 'tab.stats': 'Stats', 'tab.memo': 'Memo',
            'form.urlLabel': 'Problem URL', 'form.nameLabel': 'Problem Name', 'form.colorLabel': 'Choose Color',
            'form.namePlaceholder': 'Default: current page title', 'form.addBtn': 'Add to Plan',
            'search.placeholder': '🔍 Search name / notes / URL…',
            'search.randomBtn': '🎲 Random', 'search.randomTitle': 'Pick a random unsolved problem',
            'backup.title': '💾 Data Backup',
            'backup.export': 'Export', 'backup.import': 'Import', 'backup.clear': 'Clear All',
            'backup.luogu': '📥 Import from Luogu', 'backup.settings': '⚙ Settings',
            'backup.note': 'Export includes in-progress, archived, memos / calendar, and timer stats (v3 format)',
            'backup.filename': 'problem-planner-backup',
            'luogu.urlLabel': 'Luogu Training List URL',
            'luogu.tagsLabel': '🏷 Add Tags', 'luogu.tagsTitle': 'Auto-fetch problem tags into notes',
            'luogu.diffLabel': 'Difficulty', 'luogu.diffTitle': 'Only import problems in this difficulty range',
            'luogu.skipPassedLabel': '✅ Skip solved', 'luogu.skipPassedTitle': 'Skip problems already solved on Luogu',
            'luogu.start': 'Start Import', 'luogu.homeImport': 'Import from Luogu homepage task plan',
            'settings.focus': 'Focus length', 'settings.minutes': 'min', 'settings.break': 'Break length',
            'settings.autoBreak': 'Auto break', 'settings.autoBreakDesc': 'Auto start break after focus',
            'settings.dailyGoal': 'Daily goal', 'settings.dailyGoalDesc': 'problems (0 = off)',
            'settings.theme': 'Theme', 'settings.themeAuto': 'Follow system', 'settings.themeLight': 'Light',
            'settings.themeDark': 'Dark', 'settings.themeDesc': 'Panel appearance',
            'settings.lang': 'Language', 'settings.langAuto': 'Follow system', 'settings.langZh': '中文', 'settings.langEn': 'English',
            'footer.notUnderstood': 'Not Understood', 'footer.understood': 'Understood',
            'footer.completed': 'Completed', 'footer.totalTime': 'Total Focus',
            'misc.unnamed': '(Untitled)', 'misc.unnamedProblem': 'Untitled problem',
            'memo.placeholder': 'Type a memo…', 'memo.addBtn': 'Add',
            'memo.empty': 'No memos yet',
            'memo.urgent': 'Urgent', 'memo.unurgent': 'Unmark urgent',
            'memo.urgentTitle': 'Mark as urgent (pin to top, badge turns red)', 'memo.unurgentTitle': 'Remove urgent mark',
            'memo.delete': 'Delete', 'memo.deleteTitle': 'Delete this memo',
            'memo.confirmDelete': 'Delete this memo?', 'memo.urgentBadge': 'URGENT',
            'item.understand': 'Got it', 'item.understandTitle': 'Mark as understood (move to bottom)',
            'item.complete': 'Done', 'item.completeTitle': 'Mark as completed (move to archive)',
            'item.giveup': 'Give up', 'item.giveupTitle': 'Give up (not counted)',
            'item.note': 'Note', 'item.noteTitleEdit': 'Edit note', 'item.noteTitleAdd': 'Add note',
            'item.noteViewTitle': 'Click to edit note',
            'item.color': 'Color', 'item.colorTitleSet': 'Change custom color', 'item.colorTitleCustom': 'Custom color (overrides difficulty)',
            'item.resetColor': 'Reset', 'item.resetColorTitle': 'Clear custom color',
            'item.timer': 'Timer', 'item.timerTitle': 'Pomodoro: start {m} min focus',
            'item.stop': 'Stop', 'item.stopTitle': 'Stop timer (settle focus time)',
            'item.pinned': 'Pinned', 'item.pin': 'Pin', 'item.pinTitleUnpin': 'Unpin', 'item.pinTitle': 'Pin to top',
            'item.moveUp': 'Move up', 'item.moveDown': 'Move down', 'item.timeBadgeTitle': 'Total focus time',
            'timer.focusPause': 'Focusing… click to pause', 'timer.paused': 'Paused, click to resume', 'timer.break': 'On break… click to skip',
            'note.placeholder': 'Note your thoughts, pitfalls, solution links…', 'note.save': 'Save', 'note.cancel': 'Cancel',
            'empty.active': 'No problems yet. Add one to your plan.', 'empty.noMatch': 'No problems match "{q}"',
            'archive.summary': '{n} completed records', 'archive.time': 'Archived focus {d}',
            'archive.empty': 'No completed records yet',
            'archive.completedAt': '✅ Completed {d}', 'archive.focus': '⏱ Focus {d}', 'archive.addedAt': '📅 Added {d}',
            'archive.restore': 'Restore', 'archive.restoreTitle': 'Restore to in-progress',
            'archive.delete': 'Delete', 'archive.deleteTitle': 'Permanently delete this record',
            'stats.total': 'Total Completed', 'stats.today': 'Today', 'stats.streak': 'Streak (days)', 'stats.totalTime': 'Total Focus',
            'stats.goalTitle': '🎯 Daily Goal', 'stats.goalProgress': '{t} / {g} problems', 'stats.goalDone': ' · reached 🎉',
            'stats.trendTitle': '14-Day Trend', 'stats.trendSub': 'problems completed per day',
            'stats.diffTitle': 'Difficulty Distribution', 'stats.diffSub': 'Completed · Luogu difficulty', 'stats.diffNone': 'Unrated',
            'stats.heatmapTitle': 'Monthly Heatmap', 'stats.heatmapSub': 'Last 15 weeks · color=difficulty, shade=count',
            'stats.legendDifficulty': 'Difficulty', 'stats.legendCount': 'Count',
            'stats.trendTooltip': '{m}/{d}: {n} problems', 'stats.heatTooltip': '{m}/{d}: {n} problems · hardest {l}',
            'confirm.complete': 'Mark "{name}" as completed?',
            'confirm.giveup': 'Give up on "{name}"?',
            'confirm.restore': 'Restore "{name}" to in-progress?',
            'confirm.deleteRecord': 'Permanently delete record "{name}"? (completion count unchanged)',
            'confirm.clear': 'Clear all data (including archive, memos and calendar)? This cannot be undone.',
            'confirm.import': 'About to merge-import {a} in-progress problems\nArchived: {b}\nMemos: {d}\nCompletion count: {c}\n\nMerge mode: dedupe by URL; existing problems will not be overwritten.\nContinue?',
            'alert.importFail': 'Import failed: {e}\n\nMake sure you selected a valid backup file.',
            'toast.imported': 'Import merged: active +{a} · archive +{b}',
            'toast.importedMemos': ' · memos {n}',
            'toast.importedSkip': ' · skipped duplicates {n}',
            'toast.moveRestricted': 'Cannot move between pinned and unpinned',
            'toast.noteSaved': 'Note saved', 'toast.recordDeleted': 'Record deleted',
            'toast.alreadyActive': 'Already in progress; removed archive record only', 'toast.restored': 'Restored to in-progress',
            'toast.noUnsolved': 'No unsolved problems 🎉', 'toast.randomPick': '🎲 Random: {name}',
            'toast.focusDoneBreak': 'Focus done! Take a break ☕', 'toast.focusDone': 'Focus done! 🏆',
            'toast.breakDone': 'Break over, keep going 💪', 'toast.focusStart': 'Focus {m} min ⏱',
            'toast.settingsSaved': 'Settings saved', 'toast.exported': 'Data exported (with archive)', 'toast.cleared': 'Data cleared',
            'toast.nothingToClear': 'Nothing to clear',
            'toast.addSuccess': 'Added!', 'toast.added': 'Added to plan', 'toast.addedDiff': 'Added · difficulty {d}',
            'toast.addedTags': ' · {n} tags',
            'toast.alreadyInPlan': 'Already in your plan!', 'toast.alreadyDone': 'Already in completed records!',
            'toast.tagsOn': 'On: auto-fetch tags into notes', 'toast.tagsOff': 'Off: tags not fetched',
            'toast.skipPassedOn': 'On: skip solved problems', 'toast.skipPassedOff': 'Off: solved problems not skipped',
            'toast.goalDone': '🎯 Daily goal {g} reached! Great job', 'toast.archived': 'Archived 🎉 · today {t}/{g}', 'toast.archivedPlain': 'Archived 🎉',
            'alert.invalidUrl': 'Please enter a valid URL!', 'alert.alreadyDoneAdd': 'Already in completed records!',
            'alert.readFail': 'Failed to read file, please retry', 'alert.fetchFail': 'Failed to fetch problem info: {e}\n\nNot added.',
            'alert.joinFail': 'Add failed: {e}', 'alert.enterLuoguUrl': 'Please paste a Luogu training list URL first',
            'alert.invalidData': 'Invalid data: missing problem list',
            'err.luoguStatus': 'Luogu returned status code {s}',
            'err.network': 'Network request failed',
            'err.timeout': 'Request timed out',
            'err.luoguMissing': 'Problem not on Luogu or parse failed ({pid})',
            'err.onlyTraining': 'Only Luogu training list links are supported (luogu.com.cn/training/xxx)',
            'err.noPids': 'No problems parsed from the training list (check the link)',
            'err.cfFail': 'Failed to fetch CF problem info',
            'err.passedFetch': 'Failed to fetch solved list: {e}; skipping disabled for this import',
            'err.passedFormat': 'Luogu did not return valid data (not logged in or API changed)',
            'import.parsing': 'Parsing training list…', 'import.found': 'Found {n} problems, fetching info…',
            'import.fetchDb': '⏳ Preparing local Luogu DB (one-time download; later imports use zero requests)…',
            'import.noModule': 'Task plan module not found. Ensure you are logged in on the Luogu homepage.',
            'import.homeFound': 'Found {n} problems in homepage plan, fetching difficulty…',
            'import.fetching': 'Fetching {i}/{n}: {pid} …', 'import.done': 'Import done: added {a} · skipped {s}',
            'import.doneDiff': ' · difficulty mismatch {d}', 'import.doneFail': ' · failed {n}', 'import.failList': 'Failed: {list}',
            'import.donePassed': ' · skipped solved {n}',
            'import.passedSkipDisabled': 'Not logged in on Luogu; solved problems will not be skipped (use this on a Luogu page)',
            'toast.trainingDone': 'Import done: added {a} · skipped {s}', 'toast.trainingFail': 'Import failed: {e}',
            'oj.fetching': '⏳ Fetching…', 'oj.addBtn': '＋ Add to plan', 'oj.addBtnTitle': 'Fetch Luogu RMJ difficulty and add to plan',
            'oj.joined': '✓ Added', 'oj.tagToggle': '🏷 Tags', 'oj.tagToggleOn': '🏷 Tags ✓',
            'oj.tagToggleTitle': 'Toggle: auto-fetch tags into notes (current: {s})', 'oj.on': 'on', 'oj.off': 'off',
            'oj.diff': '🎚 Difficulty', 'oj.diffTitle': 'Choose difficulty range', 'oj.diffMin': 'Min', 'oj.diffMax': 'Max',
            'oj.skipPassed': '⏭ Solved', 'oj.skipPassedOn': '⏭ Solved ✓', 'oj.skipPassedTitle': 'Toggle: skip problems already solved on Luogu (current: {s})',
            'training.importAll': '📥 Import whole list', 'training.importAllTitle': 'Add all problems in this training list',
            'training.parsing': '⏳ Parsing…', 'training.fetching': '⏳ Fetching info…', 'training.imported': '✓ Imported {n}',
            'home.importBtn': 'Import from homepage task plan', 'home.needHome': 'Only on Luogu homepage'
        }
    };

    // 根据 settings.lang 解析当前语言（auto → 浏览器语言：zh 开头走中文，否则英文）
    function resolveLang() {
        const l = settings.lang || 'zh-CN';
        if (l === 'en') return 'en';
        if (l === 'auto') {
            const nav = (navigator.language || navigator.userLanguage || 'zh-CN').toLowerCase();
            return nav.indexOf('zh') === 0 ? 'zh-CN' : 'en';
        }
        return 'zh-CN';
    }

    // 取文案，支持 {name} 占位符替换
    function t(key, params) {
        const dict = I18N[currentLang] || I18N['zh-CN'];
        let s = (dict && dict[key] !== undefined) ? dict[key]
            : (I18N['zh-CN'][key] !== undefined ? I18N['zh-CN'][key] : key);
        if (params) {
            Object.keys(params).forEach(k => { s = s.split('{' + k + '}').join(String(params[k])); });
        }
        return s;
    }

    // 静态模板文案：遍历 data-i18n / data-i18n-placeholder / data-i18n-title 元素
    function applyStaticI18n() {
        panel.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
        panel.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
        panel.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.getAttribute('data-i18n-title')); });
        fab.textContent = t('fab.text');
        fab.title = t('fab.title');
    }

    // 应用语言：切换后刷新静态文案 + 当前视图动态文案 + 悬浮按钮
    function applyLang() {
        currentLang = resolveLang();
        applyStaticI18n();
        if (isPanelVisible) {
            if (currentTab === 'active') renderProblems();
            else if (currentTab === 'done') renderArchiveList();
            else if (currentTab === 'stats') renderStats();
            else if (currentTab === 'memo') { renderCalendar(); renderMemos(); }
            syncSettingsUI();
            refreshHomeImportBtn();
        }
        // 强制重建 OJ / 题单页 / 比赛页悬浮按钮以刷新文案
        if (ojBtn) { ojBtn.remove(); ojBtn = null; ojInjectedKey = ''; }
        if (trainingBtn) { trainingBtn.remove(); trainingBtn = null; trainingBtnKey = ''; }
        if (contestBtn) { contestBtn.remove(); contestBtn = null; contestInjectedKey = ''; }
        ensureOJButton();
        ensureTrainingButton();
        ensureContestButton();
    }

    // ==================== 工具 ====================

    function normalizeDifficulty(d) {
        return Number.isInteger(d) && d >= 0 && d <= DIFF_MAX ? d : null;
    }
    function difficultyLabel(d) {
        if (!DIFFICULTY_META[d]) return '';
        return currentLang === 'en' ? DIFFICULTY_META_EN[d] : DIFFICULTY_META[d].label;
    }
    function difficultyColor(d) { return DIFFICULTY_META[d] ? DIFFICULTY_META[d].color : '#BFBFBF'; }

    // 颜色十六进制 → 难度等级（0-8），未知颜色返回 null
    function colorToDifficultyIndex(hex) {
        const c = String(hex || '').toUpperCase();
        const idx = DIFFICULTY_META.findIndex(m => m.color.toUpperCase() === c);
        if (idx >= 0) return idx;
        // 兼容旧版 #0E1D69（深蓝，原自定义色）→ 视为最高难度档附近
        if (c === '#0E1D69') return 7;
        return null;
    }
    // 题目实际生效难度：以用户颜色为准（自定义色 > 洛谷难度色 > 默认颜色）
    // 颜色即难度：统计/热力图统一按此函数判定，非洛谷题也参与统计
    function effectiveDifficulty(p) {
        const c = p.customColor
            ? p.customColor
            : ((p.difficulty !== null && p.difficulty !== undefined)
                ? difficultyColor(p.difficulty)
                : p.color);
        return colorToDifficultyIndex(c);
    }

    // 十六进制颜色混合：ratio=0 返回 base，ratio=1 返回 target（0~1）
    function mixHexColor(baseHex, targetHex, ratio) {
        const b = parseInt(baseHex.replace('#', ''), 16);
        const t = parseInt(targetHex.replace('#', ''), 16);
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        const tr = (t >> 16) & 255, tg = (t >> 8) & 255, tb = t & 255;
        const r = Math.round(br + (tr - br) * ratio);
        const g = Math.round(bg + (tg - bg) * ratio);
        const bl = Math.round(bb + (tb - bb) * ratio);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
    }
    // 将颜色向白/黑方向调整：amount>0 变浅，amount<0 变深（0~1）
    function shadeHexColor(hex, amount) {
        return amount >= 0
            ? mixHexColor(hex, '#FFFFFF', amount)
            : mixHexColor(hex, '#000000', -amount);
    }

    function dateKey(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }
    function formatDate(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return dateKey(d);
    }
    function formatDateTime(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return dateKey(d) + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
    }

    // ==================== 存储 ====================

    function normalizeProblem(p) {
        return {
            url: p.url || '',
            name: p.name || t('misc.unnamed'),
            color: p.color || COLOR_OPTIONS[0],
            customColor: typeof p.customColor === 'string' ? p.customColor : '',
            addedDate: p.addedDate || new Date().toISOString(),
            understood: !!p.understood,
            notes: typeof p.notes === 'string' ? p.notes : '',
            timeSpent: Number.isFinite(p.timeSpent) ? p.timeSpent : 0,
            completedDate: p.completedDate || null,
            pinned: !!p.pinned,
            difficulty: normalizeDifficulty(p.difficulty)
        };
    }

    function normalizeArchiveItem(a) {
        return {
            url: a.url || '',
            name: a.name || t('misc.unnamed'),
            color: a.color || COLOR_OPTIONS[0],
            customColor: typeof a.customColor === 'string' ? a.customColor : '',
            addedDate: a.addedDate || a.completedDate || new Date().toISOString(),
            understood: true,
            notes: typeof a.notes === 'string' ? a.notes : '',
            timeSpent: Number.isFinite(a.timeSpent) ? a.timeSpent : 0,
            completedDate: a.completedDate || new Date().toISOString(),
            difficulty: normalizeDifficulty(a.difficulty)
        };
    }

    function loadData() {
        try {
            const savedData = GM_getValue(STORAGE_KEY);
            problems = savedData ? JSON.parse(savedData).map(normalizeProblem) : [];
            completedCount = GM_getValue(COUNT_KEY, 0) || 0;
        } catch (e) {
            console.error('[做题计划] 加载数据失败:', e);
            problems = [];
            completedCount = 0;
        }
    }

    function saveData() {
        try {
            GM_setValue(STORAGE_KEY, JSON.stringify(problems));
            GM_setValue(COUNT_KEY, completedCount);
        } catch (e) {
            console.error('[做题计划] 保存数据失败:', e);
        }
    }

    function loadArchive() {
        try {
            const saved = GM_getValue(ARCHIVE_KEY);
            archive = saved ? JSON.parse(saved).map(normalizeArchiveItem) : [];
        } catch (e) {
            console.error('[做题计划] 加载归档失败:', e);
            archive = [];
        }
    }

    function saveArchive() {
        try {
            GM_setValue(ARCHIVE_KEY, JSON.stringify(archive));
        } catch (e) { /* ignore */ }
    }

    function normalizeMemo(m) {
        return {
            id: (typeof m.id === 'string' && m.id) ? m.id : ('m' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7)),
            text: typeof m.text === 'string' ? m.text : '',
            urgent: !!m.urgent,
            createdAt: m.createdAt || new Date().toISOString(),
            // 日历字段（可选）：date=YYYY-MM-DD 时该条目显示在日历上
            date: (typeof m.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.date)) ? m.date : '',
            time: (typeof m.time === 'string' && /^\d{2}:\d{2}$/.test(m.time)) ? m.time : '',
            link: typeof m.link === 'string' ? m.link : ''
        };
    }

    function loadMemos() {
        try {
            const saved = GM_getValue(MEMO_KEY);
            memos = saved ? JSON.parse(saved).map(normalizeMemo).filter(m => m.text) : [];
        } catch (e) {
            console.error('[做题计划] 加载备忘录失败:', e);
            memos = [];
        }
    }

    function saveMemos() {
        try {
            GM_setValue(MEMO_KEY, JSON.stringify(memos));
        } catch (e) { /* ignore */ }
    }

    function loadSettings() {
        try {
            const saved = GM_getValue(SETTINGS_KEY);
            settings = { ...DEFAULT_SETTINGS, ...(saved ? JSON.parse(saved) : {}) };
        } catch (e) {
            settings = { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings() {
        try {
            GM_setValue(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) { /* ignore */ }
    }

    // ==================== 跨标签页同步 ====================

    GM_addValueChangeListener(STORAGE_KEY, function (key, oldValue, newValue, remote) {
        if (!remote) return;
        try {
            problems = newValue ? JSON.parse(newValue).map(normalizeProblem) : [];
            if (isPanelVisible && currentTab === 'active') renderProblems();
            updateCounters();
        } catch (e) {
            console.error('[做题计划] 同步解析失败:', e);
        }
    });

    GM_addValueChangeListener(ARCHIVE_KEY, function (key, oldValue, newValue, remote) {
        if (!remote) return;
        try {
            archive = newValue ? JSON.parse(newValue).map(normalizeArchiveItem) : [];
            if (isPanelVisible && currentTab === 'done') renderArchiveList();
            if (isPanelVisible && currentTab === 'stats') renderStats();
            updateCounters();
        } catch (e) { /* ignore */ }
    });

    GM_addValueChangeListener(COUNT_KEY, function (key, oldValue, newValue, remote) {
        if (remote) {
            completedCount = newValue || 0;
            if (isPanelVisible) updateCounters();
        }
    });

    GM_addValueChangeListener(TIMER_KEY, function (key, oldValue, newValue, remote) {
        if (!remote) return;
        try {
            timerState = newValue ? JSON.parse(newValue) : null;
            if (timerState && !('accrued' in timerState)) timerState.accrued = false;
            adoptTimerState();
        } catch (e) { /* ignore */ }
    });

    GM_addValueChangeListener(MEMO_KEY, function (key, oldValue, newValue, remote) {
        if (!remote) return;
        try {
            memos = newValue ? JSON.parse(newValue).map(normalizeMemo).filter(m => m.text) : [];
            updateMemoCount();
            if (isPanelVisible && currentTab === 'memo') renderMemos();
        } catch (e) { /* ignore */ }
    });

    // ==================== 通知 ====================

    function showToast(message, color = '#3498DB') {
        let toast = document.querySelector('.pp-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'pp-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.background = color;
        toast.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ==================== 计时引擎 ====================

    function saveTimerState() {
        try {
            GM_setValue(TIMER_KEY, JSON.stringify(timerState));
        } catch (e) { /* ignore */ }
    }

    // 从存储恢复计时状态（刷新页面/重新打开页面时调用，保证计时不重置）
    function loadTimerState() {
        try {
            const saved = GM_getValue(TIMER_KEY);
            timerState = saved ? JSON.parse(saved) : null;
            if (timerState && !('accrued' in timerState)) timerState.accrued = false;
        } catch (e) {
            console.error('[做题计划] 加载计时状态失败:', e);
            timerState = null;
        }
    }

    // 存储中的计时是否已被某标签页结算（跨标签页防重依据）
    function isTimerAccruedInStorage() {
        try {
            const raw = GM_getValue(TIMER_KEY);
            if (!raw) return false;
            const st = JSON.parse(raw);
            return !!(st && st.accrued);
        } catch (e) {
            return false;
        }
    }

    function accrueFocusTime(url, seconds) {
        const p = problems.find(x => x.url === url);
        if (p && seconds > 0) {
            p.timeSpent = (p.timeSpent || 0) + Math.round(seconds);
            saveData();
        }
    }

    function ensureTicking() {
        if (timerInterval) return;
        timerInterval = setInterval(timerTick, 500);
    }

    function stopTicking() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function timerTick() {
        if (!timerState || !timerState.running) return;
        const now = Date.now();
        const remainingMs = timerState.endsAt - now;

        if (remainingMs > 0) {
            updateTimerButton();
            return;
        }

        if (timerState.phase === 'focus') {
            // 跨标签页防重：内存标志 + 存储检查双保险，专注时长只累加一次
            if (!timerState.accrued && !isTimerAccruedInStorage()) {
                timerState.accrued = true;
                const elapsed = timerState.duration - Math.max(0, Math.ceil(remainingMs / 1000));
                accrueFocusTime(timerState.url, elapsed > 0 ? elapsed : timerState.duration);
                markJustFinished(timerState.url);
                saveTimerState(); // 立即广播，防止其他标签页重复结算
            }

            if (settings.autoBreak) {
                timerState.phase = 'break';
                timerState.duration = settings.breakMinutes * 60;
                timerState.endsAt = now + timerState.duration * 1000;
                timerState.running = true;
                saveTimerState();
                showToast(t('toast.focusDoneBreak'), '#52C41A');
            } else {
                clearTimer();
                showToast(t('toast.focusDone'), '#52C41A');
            }
        } else {
            clearTimer();
            showToast(t('toast.breakDone'), '#FFC116');
        }
        if (isPanelVisible && currentTab === 'active') renderProblems();
    }

    function markJustFinished(url) {
        const p = problems.find(x => x.url === url);
        if (p) p._justFinished = true;
    }

    function startTimer(url) {
        if (timerState && timerState.phase === 'focus' && timerState.url !== url && !timerState.accrued && !isTimerAccruedInStorage()) {
            timerState.accrued = true;
            const remainingSec = Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1000));
            accrueFocusTime(timerState.url, timerState.duration - remainingSec);
        }
        timerState = {
            url,
            phase: 'focus',
            duration: settings.focusMinutes * 60,
            endsAt: Date.now() + settings.focusMinutes * 60 * 1000,
            running: true,
            accrued: false
        };
        saveTimerState();
        ensureTicking();
        if (isPanelVisible && currentTab === 'active') renderProblems();
        showToast(t('toast.focusStart', { m: settings.focusMinutes }), '#3498DB');
    }

    function pauseTimer() {
        if (!timerState || !timerState.running) return;
        timerState.running = false;
        timerState.remainingMs = timerState.endsAt - Date.now();
        timerState.endsAt = null;
        saveTimerState();
        updateTimerButton();
    }

    function resumeTimer() {
        if (!timerState || timerState.running) return;
        const remainingMs = timerState.remainingMs || timerState.duration * 1000;
        timerState.running = true;
        timerState.endsAt = Date.now() + remainingMs;
        timerState.remainingMs = undefined;
        saveTimerState();
        ensureTicking();
        updateTimerButton();
    }

    function stopTimer() {
        if (!timerState) return;
        if (timerState.phase === 'focus' && !timerState.accrued && !isTimerAccruedInStorage()) {
            timerState.accrued = true;
            const remainingSec = Math.max(0, Math.ceil(((timerState.endsAt || Date.now() + timerState.remainingMs) - Date.now()) / 1000));
            accrueFocusTime(timerState.url, timerState.duration - remainingSec);
        }
        clearTimer();
        if (isPanelVisible && currentTab === 'active') renderProblems();
    }

    function clearTimer() {
        timerState = null;
        saveTimerState();
        stopTicking();
    }

    function adoptTimerState() {
        if (!timerState) {
            if (isPanelVisible && currentTab === 'active') renderProblems();
            return;
        }
        if (timerState.running && timerState.endsAt) {
            const remainingMs = timerState.endsAt - Date.now();
            if (remainingMs <= 0) {
                if (timerState.phase === 'focus') {
                    // 跨标签页防重：内存标志 + 存储检查双保险
                    if (!timerState.accrued && !isTimerAccruedInStorage()) {
                        timerState.accrued = true;
                        accrueFocusTime(timerState.url, timerState.duration);
                        markJustFinished(timerState.url);
                    }
                    if (settings.autoBreak && timerState.phase === 'focus') {
                        timerState.phase = 'break';
                        timerState.duration = settings.breakMinutes * 60;
                        timerState.endsAt = Date.now() + timerState.duration * 1000;
                        timerState.running = true;
                    } else {
                        timerState = null;
                    }
                } else {
                    timerState = null;
                }
                saveTimerState();
            }
        }
        if (timerState && timerState.running) ensureTicking();
        if (isPanelVisible && currentTab === 'active') renderProblems();
    }

    function formatTime(sec) {
        sec = Math.max(0, Math.floor(sec));
        return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    }

    function formatDuration(sec) {
        sec = Math.max(0, Math.floor(sec));
        if (sec < 60) return sec + 's';
        if (sec < 3600) return Math.floor(sec / 60) + 'm';
        return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    }

    // ==================== 样式 ====================

    const style = document.createElement('style');
    style.textContent = `
        .pp-container {
            position: fixed; bottom: 24px; left: 24px; z-index: 999999;
            font-family: 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
        }
        .pp-fab {
            width: 62px; height: 62px; border-radius: 50%;
            background: linear-gradient(135deg, #4f7cff 0%, #00c6fb 100%);
            color: #fff; border: none; cursor: pointer;
            font-weight: 800; font-size: 22px; letter-spacing: 1px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 8px 20px rgba(0, 106, 255, .35), inset 0 1px 0 rgba(255,255,255,.25);
            transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s;
        }
        .pp-fab:hover { transform: scale(1.08); box-shadow: 0 12px 28px rgba(0,106,255,.45), inset 0 1px 0 rgba(255,255,255,.25); }
        .pp-fab:active { transform: scale(.96); }
        .pp-panel {
            position: absolute; bottom: 76px; left: 0; width: 420px;
            background: #fff; border-radius: 20px;
            border: 1px solid rgba(23,43,99,.06);
            box-shadow: 0 24px 60px rgba(23,43,99,.18), 0 8px 20px rgba(23,43,99,.10);
            display: none; flex-direction: column;
            max-height: 82vh; overflow: hidden;
            transform-origin: bottom left;
        }
        .pp-panel.open { display: flex; animation: pp-pop .22s cubic-bezier(.34,1.56,.64,1); }
        @keyframes pp-pop { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
        .pp-header {
            position: relative; padding: 16px 24px; text-align: center;
            background: linear-gradient(135deg, #4f7cff 0%, #00c6fb 100%);
            color: #fff; font-weight: 800; font-size: 18px; letter-spacing: 1px;
            overflow: hidden; flex-shrink: 0;
        }
        .pp-header::before, .pp-header::after {
            content: ''; position: absolute; border-radius: 50%; pointer-events: none;
        }
        .pp-header::before { width: 150px; height: 150px; left: -45px; top: -80px; background: rgba(255,255,255,.15); }
        .pp-header::after { width: 110px; height: 110px; right: -35px; bottom: -60px; background: rgba(255,255,255,.11); }
        .pp-sync-badge {
            position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
            background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.35);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: .5px;
        }
        .pp-tabs {
            display: flex; background: #f8faff; border-bottom: 1px solid #eef1f8;
            padding: 0 8px; flex-shrink: 0;
        }
        .pp-tab {
            flex: 1; border: none; background: transparent; padding: 9px 0 8px;
            font-size: 13px; font-weight: 600; color: #7c86a5; cursor: pointer;
            font-family: inherit; border-bottom: 2.5px solid transparent;
            transition: color .2s, border-color .2s;
        }
        .pp-tab:hover { color: #4f7cff; }
        .pp-tab.active { color: #4f7cff; border-bottom-color: #4f7cff; }
        /* 备忘录 */
        .pp-tab-badge {
            display: inline-block; min-width: 15px; height: 15px; line-height: 15px;
            border-radius: 999px; background: #d5dbea; color: #5a6485;
            font-size: 10px; font-weight: 800; text-align: center; padding: 0 4px; margin-left: 3px;
            vertical-align: middle;
        }
        .pp-tab-badge.urgent { background: #FE4C61; color: #fff; animation: pp-badge-pulse 1.6s ease infinite; }
        @keyframes pp-badge-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        .pp-memo-form { display: flex; gap: 8px; padding: 12px 22px 10px; border-bottom: 1px solid #eef1f8; align-items: center; }
        .pp-memo-form .pp-input { flex: 1; }
        .pp-memo-form .pp-btn { flex-shrink: 0; height: 34px; }
        .pp-memo-item {
            display: flex; flex-direction: column; align-items: stretch;
            padding: 12px 14px; margin-bottom: 9px;
            background: #fff; border: 1px solid #eef1f8; border-radius: 14px;
            box-shadow: 0 2px 6px rgba(23,43,99,.05);
            transition: box-shadow .2s, border-color .2s;
            animation: pp-item-in .25s ease both;
        }
        .pp-memo-item:hover { box-shadow: 0 6px 16px rgba(23,43,99,.10); border-color: #e0e7f8; }
        .pp-memo-item.urgent { border-left: 4px solid #FE4C61; background: linear-gradient(90deg, #fff0f2, #fff); box-shadow: 0 2px 8px rgba(254,76,97,.15); }
        .pp-memo-main { width: 100%; min-width: 0; }
        .pp-memo-text { font-size: 14px; word-break: break-word; white-space: pre-wrap; line-height: 1.6; color: #2a3248; }
        .pp-memo-item.urgent .pp-memo-text { font-weight: 700; }
        .pp-memo-urgent-badge { display: inline-block; font-size: 10px; font-weight: 800; color: #fff; background: #FE4C61; border-radius: 999px; padding: 1px 7px; margin-bottom: 4px; letter-spacing: .5px; }
        .pp-memo-actions {
            display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
            width: 100%; padding-top: 8px; margin-top: 8px;
            border-top: 1px dashed #e9edf8;
        }
        .pp-memo-time { font-size: 11px; color: #8a93b0; margin-top: 3px; }
        /* ============ 日历 ============ */
        .pp-cal { padding: 12px 16px 6px; border-bottom: 1px solid #eef1f8; }
        .pp-cal-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
        .pp-cal-nav {
            width: 26px; height: 26px; padding: 0; line-height: 1; border-radius: 8px;
            border: 1.5px solid #e3e8f7; background: #fff; color: #4f7cff;
            font-size: 15px; font-weight: 800; cursor: pointer; font-family: inherit;
            transition: background .15s, border-color .15s;
        }
        .pp-cal-nav:hover { border-color: #4f7cff; background: #f2f7ff; }
        .pp-cal-title { flex: 1; text-align: center; font-size: 13.5px; font-weight: 800; color: #4a5578; }
        .pp-cal-today-btn {
            border: 1.5px solid #d5dbea; background: #fff; color: #5a6485; border-radius: 999px;
            padding: 3px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit;
            transition: border-color .15s, color .15s;
        }
        .pp-cal-today-btn:hover { border-color: #4f7cff; color: #4f7cff; }
        .pp-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 3px; }
        .pp-cal-weekday { text-align: center; font-size: 10.5px; font-weight: 700; color: #9aa3bf; }
        .pp-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
        .pp-cal-cell {
            position: relative; aspect-ratio: 1; border-radius: 8px; border: 1.5px solid transparent;
            background: #f8faff; display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 600; color: #4a5578; cursor: pointer;
            transition: background .15s, border-color .15s, color .15s;
        }
        .pp-cal-cell:hover { background: #eef3ff; border-color: #c9d4f2; }
        .pp-cal-cell.other { opacity: .35; }
        .pp-cal-cell.today { border-color: #4f7cff; color: #4f7cff; font-weight: 800; }
        .pp-cal-cell.selected { background: linear-gradient(135deg, #4f7cff, #00c6fb); color: #fff; border-color: transparent; }
        .pp-cal-cell.has-entry::after {
            content: ''; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);
            width: 4px; height: 4px; border-radius: 50%; background: #f39c11;
        }
        .pp-cal-cell.selected.has-entry::after { background: #fff; }
        .pp-cal-day-head {
            display: flex; align-items: center; justify-content: space-between;
            font-size: 12px; font-weight: 700; color: #4a5578; margin: 10px 0 4px;
        }
        .pp-cal-day-head .pp-cal-day-count { font-weight: 600; color: #9aa3bf; font-size: 11px; }
        .pp-cal-day-list { padding: 0 0 6px; }
        .pp-cal-day-empty { font-size: 12px; color: #9aa3bf; text-align: center; padding: 10px 0; font-style: italic; }
        .pp-memo-datehint { padding: 0 22px 6px; font-size: 11.5px; color: #4f7cff; font-weight: 600; }
        .pp-memo-datehint .pp-hint-clear { cursor: pointer; color: #9aa3bf; margin-left: 6px; font-weight: 700; }
        .pp-memo-datehint .pp-hint-clear:hover { color: #e5484d; }
        .pp-memo-section-title {
            padding: 4px 22px 2px; font-size: 11.5px; font-weight: 700; color: #8a93b0; letter-spacing: .3px;
        }
        /* 条目上的日期徽章 / 链接 */
        .pp-memo-date {
            display: inline-block; font-size: 10.5px; font-weight: 700; color: #2f6fd0;
            background: #eef3ff; border-radius: 999px; padding: 1px 7px; margin-right: 6px;
        }
        .pp-memo-date.today { color: #fff; background: linear-gradient(135deg, #4f7cff, #00c6fb); }
        .pp-memo-link { font-size: 11.5px; color: #4f7cff; text-decoration: none; margin-top: 4px; display: inline-block; }
        .pp-memo-link:hover { text-decoration: underline; }
        /* 日期 / 时间 / 链接编辑器 */
        .pp-memo-dateedit { width: 100%; padding: 8px 0 2px; }
        .pp-memo-dateedit-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 12px; }
        .pp-memo-dateedit-row label { min-width: 34px; color: #5a6485; font-weight: 600; }
        .pp-memo-dateedit-row input {
            flex: 1; padding: 5px 8px; border: 1.5px solid #e3e8f7; border-radius: 8px;
            font-size: 12px; font-family: inherit; background: #fafbff; box-sizing: border-box;
        }
        .pp-memo-dateedit-row input:focus { outline: none; border-color: #4f7cff; background: #fff; }
        .pp-memo-dateedit-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .pp-body { flex: 1; overflow-y: auto; }
        .pp-body::-webkit-scrollbar { width: 6px; }
        .pp-body::-webkit-scrollbar-thumb { background: #d5dbee; border-radius: 999px; }
        .pp-body::-webkit-scrollbar-thumb:hover { background: #b9c3e2; }
        .pp-view { display: none; }
        .pp-view.active { display: block; }
        .pp-form { padding: 16px 22px 14px; border-bottom: 1px solid #eef1f8; }
        .pp-search-row {
            display: flex; gap: 8px; padding: 10px 22px;
            border-bottom: 1px solid #eef1f8; align-items: center;
        }
        .pp-search-row .pp-input { flex: 1; }
        .pp-random-btn { flex-shrink: 0; height: 30px; }
        .pp-random-hit {
            animation: pp-hit-flash 2.6s ease;
            box-shadow: 0 0 0 4px rgba(79,124,255,.55);
            border-radius: 14px;
        }
        @keyframes pp-hit-flash {
            0% { box-shadow: 0 0 0 4px rgba(79,124,255,.55); transform: scale(1.02); }
            60% { box-shadow: 0 0 0 10px rgba(79,124,255,.15); transform: scale(1); }
            100% { box-shadow: 0 0 0 4px rgba(79,124,255,.55); }
        }
        .pp-form-group { margin-bottom: 12px; }
        .pp-form-group label { display: block; margin-bottom: 5px; font-weight: 600; color: #4a5578; font-size: 12.5px; letter-spacing: .3px; }
        .pp-input {
            width: 100%; padding: 9px 12px; border: 1.5px solid #e3e8f7; border-radius: 12px;
            font-size: 14px; box-sizing: border-box; font-family: inherit; background: #fafbff;
            transition: border-color .2s, box-shadow .2s, background .2s;
        }
        .pp-input:hover { border-color: #c9d4f2; }
        .pp-input:focus { outline: none; border-color: #4f7cff; background: #fff; box-shadow: 0 0 0 3.5px rgba(79,124,255,.14); }
        .pp-color-selection { display: grid; grid-template-columns: repeat(9, 1fr); gap: 7px; margin-top: 9px; }
        .pp-color-option {
            aspect-ratio: 1; border-radius: 9px; cursor: pointer; border: 2px solid transparent;
            box-shadow: inset 0 1px 2px rgba(0,0,0,.12);
            transition: transform .2s, box-shadow .2s, border-color .2s;
        }
        .pp-color-option:hover { transform: translateY(-2px) scale(1.06); }
        .pp-color-option.selected {
            border-color: #fff; transform: scale(1.12);
            box-shadow: 0 0 0 2px #4f7cff, 0 2px 6px rgba(23,43,99,.25);
        }
        .pp-add-btn {
            width: 100%; padding: 11px; border: none; border-radius: 12px; cursor: pointer;
            background: linear-gradient(135deg, #52c41a 0%, #34a8f0 100%);
            color: #fff; font-weight: 800; font-size: 15px; letter-spacing: 2px; font-family: inherit;
            box-shadow: 0 6px 16px rgba(52,168,240,.28);
            transition: transform .2s, box-shadow .2s, filter .2s;
        }
        .pp-add-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 22px rgba(52,168,240,.35); filter: brightness(1.03); }
        .pp-add-btn:active { transform: translateY(0); }
        .pp-list { padding: 14px 16px; }
        .pp-item {
            display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;
            padding: 11px 12px 11px 14px; margin-bottom: 9px;
            background: #fff; border: 1px solid #eef1f8; border-radius: 14px;
            box-shadow: 0 2px 6px rgba(23,43,99,.05);
            transition: transform .2s, box-shadow .2s, border-color .2s;
            animation: pp-item-in .25s ease both;
        }
        @keyframes pp-item-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .pp-item:hover { transform: translateX(4px); box-shadow: 0 6px 14px rgba(23,43,99,.10); border-color: #e0e7f8; }
        .pp-item.understood { opacity: .68; background: #fafbfe; border-left: 4px solid #FFC116; }
        .pp-item.timing { border-left: 4px solid #52c41a; background: linear-gradient(90deg, #f2fbf4, #fff); box-shadow: 0 2px 8px rgba(82,196,26,.14); }
        .pp-item-main { display: flex; align-items: center; flex: 1; min-width: 0; }
        .pp-link {
            text-decoration: none; font-weight: 700; font-size: 14px; word-break: break-all;
            margin-right: 8px; overflow: hidden;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        .pp-link:hover { text-decoration: underline; }
        .pp-understood-badge { font-size: 12px; color: #FFC116; margin-left: 4px; font-weight: 800; }
        .pp-time-badge { font-size: 11px; color: #5a6485; background: #eef2fb; border-radius: 999px; padding: 2px 8px; margin-left: 6px; white-space: nowrap; font-weight: 600; }
        .pp-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
        /* 主操作按钮（理解/完成/放弃）：统一胶囊形 + 柔和渐变 */
        .pp-btn {
            border: none; border-radius: 999px; color: #fff; cursor: pointer;
            font-weight: 700; font-size: 12px; height: 30px; padding: 0 14px; font-family: inherit;
            white-space: nowrap; line-height: 1;
            box-shadow: 0 2px 6px rgba(23,43,99,.12);
            transition: transform .15s, filter .15s, box-shadow .15s;
        }
        .pp-btn:hover { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 4px 10px rgba(23,43,99,.16); }
        .pp-btn:active { transform: translateY(0); }
        .pp-btn-sm { min-width: 34px; padding: 0 12px; }
        .pp-giveup { background: #aeb6c8; } .pp-giveup:hover { background: #9aa4ba; }
        .pp-understand { background: linear-gradient(135deg, #ff9a3c, #fc6a1e); }
        .pp-complete { background: linear-gradient(135deg, #52c41a, #2fa557); }
        /* 第二行工具条：备注 / 颜色 / 计时 / 置顶 / 上移 / 下移（统一线框胶囊） */
        .pp-toolbar {
            width: 100%; display: flex; align-items: center; gap: 6px;
            padding-top: 8px; margin-top: 4px;
            border-top: 1px dashed #e6ebf8;
        }
        .pp-tool-btn {
            border: 1.5px solid transparent; border-radius: 999px; padding: 5px 12px;
            font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
            white-space: nowrap; line-height: 1.2; height: 28px;
            display: inline-flex; align-items: center; justify-content: center; gap: 4px;
            transition: background .2s, border-color .2s, color .2s, transform .15s;
        }
        .pp-tool-btn:hover { transform: translateY(-1px); }
        .pp-tool-btn:active { transform: translateY(0); }
        .pp-tool-note { color: #8e3fd4; border-color: #d9bcf2; background: #faf5fe; }
        .pp-tool-note:hover { background: #f0e3fb; border-color: #c39de9; }
        .pp-tool-note.has-note { color: #fff; border-color: #7b3fd4; background: linear-gradient(135deg, #a05ce4, #7b3fd4); }
        .pp-tool-color { color: #2f9e8f; border-color: #b5e0d8; background: #f0fbf9; }
        .pp-tool-color:hover { background: #dff5f0; border-color: #8ccfc4; }
        .pp-tool-color.has-color { color: #fff; border-color: #2f9e8f; background: linear-gradient(135deg, #3fb8a6, #2f9e8f); }
        .pp-color-picker { width: 100%; padding: 8px 0 2px; }
        .pp-color-picker-row { display: grid; grid-template-columns: repeat(9, 1fr); gap: 6px; }
        .pp-color-picker-row .pp-color-option { aspect-ratio: 1; border-radius: 8px; }
        .pp-color-picker .pp-btn { margin-top: 7px; }
        .pp-tool-timer { color: #2f6fd0; border-color: #b9d1f5; background: #f2f7ff; }
        .pp-tool-timer:hover { background: #e3efff; border-color: #8fb6ec; }
        .pp-tool-timer.running { color: #fff; border-color: #1e9e63; background: linear-gradient(135deg, #2bb673, #1e9e63); }
        .pp-tool-timer.break-phase { color: #fff; border-color: #e67e22; background: linear-gradient(135deg, #f39c11, #e67e22); }
        .pp-tool-pin { color: #d97e00; border-color: #f4c77a; background: #fff8ec; }
        .pp-tool-pin:hover { background: #ffefd6; border-color: #eda43f; }
        .pp-tool-pin.pinned { color: #fff; border-color: #e67e22; background: linear-gradient(135deg, #f7b733, #e67e22); }
        .pp-tool-move { color: #5a6485; border-color: #d5dbea; background: #f6f8fd; min-width: 36px; padding: 5px 8px; }
        .pp-tool-move:hover { color: #4f7cff; border-color: #9db4ef; background: #eef3ff; }
        .pp-tool-date { color: #2f6fd0; border-color: #b9d1f5; background: #f2f7ff; }
        .pp-tool-date:hover { background: #e3efff; border-color: #8fb6ec; }
        .pp-tool-date.has-date { color: #fff; border-color: #2f6fd0; background: linear-gradient(135deg, #4f7cff, #2f6fd0); }
        .pp-timer-stop {
            border: 1.5px solid #ffc9cc; background: #fff5f5; color: #e5484d;
            border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 700;
            cursor: pointer; font-family: inherit; white-space: nowrap; line-height: 1.2; height: 28px;
            display: inline-flex; align-items: center; justify-content: center; gap: 4px;
            transition: background .2s, border-color .2s, color .2s, transform .15s;
        }
        .pp-timer-stop:hover { border-color: #ff8f95; background: #ffeaea; transform: translateY(-1px); }
        .pp-note-editor { width: 100%; padding: 8px 0 2px; }
        .pp-note-editor textarea {
            width: 100%; min-height: 58px; box-sizing: border-box; border: 1.5px solid #e3e8f7;
            border-radius: 10px; padding: 9px 11px; font-size: 13px; font-family: inherit;
            resize: vertical; background: #fafbff; transition: border-color .2s, box-shadow .2s;
        }
        .pp-note-editor textarea:focus { outline: none; border-color: #a05ce4; box-shadow: 0 0 0 3px rgba(160,92,228,.15); background: #fff; }
        .pp-note-editor .pp-note-actions { display: flex; gap: 6px; margin-top: 7px; }
        .pp-note-view {
            width: 100%; font-size: 12px; color: #6d5ca8; background: #f7f4fd;
            border: 1px solid #ece5fb; border-radius: 8px; padding: 7px 10px;
            margin-top: 2px; word-break: break-word; white-space: pre-wrap; line-height: 1.5;
            cursor: pointer; box-sizing: border-box;
        }
        .pp-note-view:hover { border-color: #d8cdf5; background: #f3eefc; }
        .pp-empty { text-align: center; color: #9aa3bf; padding: 42px 20px; }
        .pp-empty .pp-empty-icon { font-size: 40px; display: block; margin-bottom: 10px; }
        .pp-empty .pp-empty-text { font-size: 13px; font-style: italic; }
        /* 已完成视图 */
        .pp-done-summary {
            padding: 12px 18px; font-size: 12.5px; color: #5a6485;
            background: #f8faff; border-bottom: 1px solid #eef1f8;
            display: flex; gap: 14px; flex-wrap: wrap;
        }
        .pp-done-summary b { color: #4f7cff; }
        .pp-done-item {
            display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap;
            padding: 11px 12px 11px 14px; margin-bottom: 9px;
            background: #fff; border: 1px solid #eef1f8; border-radius: 14px;
            box-shadow: 0 2px 6px rgba(23,43,99,.05);
            transition: transform .2s, box-shadow .2s;
            animation: pp-item-in .25s ease both;
        }
        .pp-done-item:hover { transform: translateX(4px); box-shadow: 0 6px 14px rgba(23,43,99,.10); }
        .pp-done-main { flex: 1; min-width: 0; }
        .pp-done-title { font-weight: 700; font-size: 13.5px; word-break: break-all; }
        .pp-done-meta { margin-top: 4px; font-size: 11.5px; color: #8a93b0; display: flex; gap: 10px; flex-wrap: wrap; }
        .pp-done-note {
            margin-top: 6px; font-size: 12px; color: #6d5ca8; background: #f7f4fd;
            border: 1px solid #ece5fb; border-radius: 8px; padding: 6px 9px;
            word-break: break-word; white-space: pre-wrap;
        }
        .pp-done-actions { display: flex; gap: 5px; flex-shrink: 0; }
        .pp-restore { background: linear-gradient(135deg, #4f7cff, #00c6fb); }
        .pp-del-record { background: #ff5f6d; }
        /* 统计视图 */
        .pp-stats-charts { padding: 14px 16px 18px; }
        .pp-ov-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
        .pp-ov-card {
            background: #f8faff; border: 1px solid #eef1f8; border-radius: 12px;
            padding: 10px 6px; text-align: center;
        }
        .pp-ov-value { display: block; font-size: 20px; font-weight: 800; color: #4f7cff; line-height: 1.2; }
        .pp-ov-value.green { color: #52c41a; }
        .pp-ov-value.orange { color: #f39c11; }
        .pp-ov-label { display: block; font-size: 11px; color: #8a93b0; margin-top: 2px; font-weight: 600; }
        .pp-goal-card {
            background: linear-gradient(135deg, #f2f8ff, #f6fbf4);
            border: 1px solid #e0ebfa; border-radius: 14px;
            padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 2px 6px rgba(23,43,99,.04);
        }
        .pp-goal-card.done { background: linear-gradient(135deg, #f0fbf4, #e9f9ee); border-color: #cdeeda; }
        .pp-goal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .pp-goal-title { font-size: 12.5px; font-weight: 700; color: #4a5578; }
        .pp-goal-num { font-size: 12px; font-weight: 700; color: #4f7cff; }
        .pp-goal-card.done .pp-goal-num { color: #52c41a; }
        .pp-goal-track { height: 10px; background: #eef1f8; border-radius: 999px; overflow: hidden; }
        .pp-goal-fill {
            height: 100%; border-radius: 999px; min-width: 2px;
            background: linear-gradient(90deg, #4f7cff, #00c6fb);
            transition: width .4s ease;
        }
        .pp-goal-card.done .pp-goal-fill { background: linear-gradient(90deg, #52c41a, #3db364); }
        .pp-chart-card {
            background: #fff; border: 1px solid #eef1f8; border-radius: 14px;
            padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 2px 6px rgba(23,43,99,.04);
        }
        .pp-chart-title { font-size: 12.5px; font-weight: 700; color: #4a5578; margin-bottom: 10px; }
        .pp-chart-title .pp-chart-sub { font-weight: 400; color: #9aa3bf; font-size: 11px; margin-left: 6px; }
        .pp-chart-svg { width: 100%; }
        .pp-legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; font-size: 10.5px; color: #9aa3bf; margin-top: 6px; }
        .pp-legend .cell { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
        .pp-legend-block { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin-top: 6px; font-size: 10.5px; color: #9aa3bf; }
        .pp-legend-block .cell { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
        /* 难度分布 */
        .pp-diff-bars { margin-top: 2px; }
        .pp-diff-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
        .pp-diff-label { width: 86px; flex-shrink: 0; font-weight: 600; text-align: right; }
        .pp-diff-track { flex: 1; height: 12px; background: #f0f3fa; border-radius: 999px; overflow: hidden; }
        .pp-diff-fill { height: 100%; border-radius: 999px; min-width: 2px; transition: width .4s; }
        .pp-diff-count { width: 26px; flex-shrink: 0; color: #5a6485; font-weight: 700; text-align: left; }
        /* OJ 一键加入按钮 */
        .pp-oj-group {
            position: fixed; right: 24px; bottom: 100px; z-index: 999998;
            display: flex; align-items: flex-start; gap: 8px; flex-direction: column;
        }
        .pp-oj-btn {
            background: linear-gradient(135deg, #52c41a, #34a8f0); color: #fff;
            border: none; border-radius: 999px; padding: 10px 16px;
            font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
            box-shadow: 0 6px 16px rgba(52,168,240,.35);
            transition: transform .2s, box-shadow .2s;
        }
        .pp-oj-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(52,168,240,.45); }
        .pp-oj-btn:disabled { opacity: .7; cursor: wait; }
        .pp-oj-btn.ok { background: linear-gradient(135deg, #2bb673, #1e9e63); }
        /* 标签开关 / 难度范围按钮 */
        .pp-oj-tag-toggle {
            background: #fff; color: #5a6485; border: 1.5px solid #d5dbea;
            border-radius: 999px; padding: 6px 13px; cursor: pointer;
            font-size: 12px; font-weight: 700; font-family: inherit;
            box-shadow: 0 2px 6px rgba(23,43,99,.12);
            transition: all .2s;
        }
        .pp-oj-tag-toggle:hover { border-color: #4f7cff; color: #4f7cff; }
        .pp-oj-tag-toggle.on {
            color: #fff; border-color: #52c41a;
            background: linear-gradient(135deg, #52c41a, #2fa557);
            box-shadow: 0 4px 10px rgba(82,196,26,.3);
        }
        /* 难度范围内联面板 */
        .pp-oj-diff-panel {
            background: #fff; border: 1px solid #e9edf9; border-radius: 12px;
            padding: 9px 11px; box-shadow: 0 8px 20px rgba(23,43,99,.16);
            font-size: 12px; color: #5a6485; display: flex; flex-direction: column; gap: 6px;
        }
        .pp-oj-diff-row { display: flex; align-items: center; gap: 6px; font-weight: 600; }
        .pp-oj-diff-row select {
            border: 1.5px solid #e3e8f7; border-radius: 8px; padding: 4px 6px;
            font-size: 12px; background: #fafbff; color: #4a5578; font-family: inherit; cursor: pointer;
        }
        .pp-oj-diff-row select:focus { outline: none; border-color: #4f7cff; }
        /* 洛谷导入面板：标签/难度选项 */
        .pp-luogu-opts {
            display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center;
            margin: 2px 0 10px; font-size: 12.5px; color: #4a5578; font-weight: 600;
        }
        .pp-luogu-opt { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
        .pp-luogu-opt input[type=checkbox] { width: 15px; height: 15px; accent-color: #4f7cff; cursor: pointer; }
        .pp-luogu-opt select {
            border: 1.5px solid #e3e8f7; border-radius: 8px; padding: 4px 6px;
            font-size: 12px; background: #fafbff; color: #4a5578; font-family: inherit; cursor: pointer;
        }
        .pp-luogu-opt select:focus { outline: none; border-color: #4f7cff; }
        /* 洛谷导入 */
        .pp-luogu { background: linear-gradient(135deg, #f7b733, #fc4a1a); }
        .pp-luogu-panel { display: none; margin-top: 10px; padding: 12px; background: #fff; border: 1px solid #e9edf9; border-radius: 12px; }
        .pp-luogu-panel.show { display: block; }
        .pp-luogu-status { margin-top: 8px; font-size: 12px; color: #5a6485; line-height: 1.6; word-break: break-all; }
        /* 备份区 */
        .pp-backup { padding: 12px 22px 14px; border-top: 1px solid #eef1f8; background: #f8faff; flex-shrink: 0; }
        .pp-backup-title { font-weight: 700; margin-bottom: 9px; color: #4a5578; font-size: 12.5px; letter-spacing: .3px; }
        .pp-backup-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        .pp-btn-backup {
            border: none; border-radius: 10px; color: #fff; padding: 7px 13px;
            cursor: pointer; font-weight: 700; font-size: 12px; font-family: inherit;
            box-shadow: 0 2px 5px rgba(23,43,99,.16);
            transition: transform .15s, filter .15s;
        }
        .pp-btn-backup:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .pp-btn-backup:disabled { opacity: .5; cursor: not-allowed; transform: none; filter: none; box-shadow: none; }
        .pp-export { background: linear-gradient(135deg, #4f7cff, #00c6fb); }
        .pp-import { background: linear-gradient(135deg, #a05ce4, #7b3fd4); }
        .pp-clear { background: linear-gradient(135deg, #ff5f6d, #ff4b5c); }
        .pp-settings-toggle {
            background: #fff; border: 1.5px solid #dfe5f5; color: #5a6485; border-radius: 10px;
            padding: 7px 13px; cursor: pointer; font-size: 12px; font-family: inherit; font-weight: 600;
            transition: all .2s;
        }
        .pp-settings-toggle:hover { border-color: #4f7cff; color: #4f7cff; }
        .pp-settings { margin-top: 10px; padding: 12px; background: #fff; border: 1px solid #e9edf9; border-radius: 12px; display: none; box-shadow: inset 0 1px 3px rgba(23,43,99,.03); }
        .pp-settings.show { display: block; }
        .pp-settings-row { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; font-size: 13px; }
        .pp-settings-row:last-child { margin-bottom: 0; }
        .pp-settings-row label { min-width: 76px; color: #5a6485; font-weight: 600; }
        .pp-settings-row input[type=number] { width: 64px; padding: 5px 8px; border: 1.5px solid #e3e8f7; border-radius: 8px; font-size: 13px; }
        .pp-settings-row input[type=number]:focus { outline: none; border-color: #4f7cff; }
        .pp-settings-row select { width: 104px; padding: 5px 8px; border: 1.5px solid #e3e8f7; border-radius: 8px; font-size: 13px; background: #fafbff; color: #4a5578; font-family: inherit; cursor: pointer; }
        .pp-settings-row select:focus { outline: none; border-color: #4f7cff; }
        .pp-settings-row input[type=checkbox] { width: 17px; height: 17px; accent-color: #4f7cff; }
        .pp-settings-row .unit { color: #9aa3bf; font-size: 12px; }
        /* 底部统计 */
        .pp-footer {
            padding: 12px 16px; background: #fff; border-top: 1px solid #eef1f8;
            display: flex; justify-content: space-between; align-items: center; gap: 8px;
            flex-shrink: 0; flex-wrap: wrap;
        }
        .pp-stats { display: flex; gap: 6px; }
        .pp-stat-card {
            background: #f8faff; border: 1px solid #eef1f8; border-radius: 10px;
            padding: 6px 8px; text-align: center; min-width: 60px;
        }
        .pp-stat-label { display: block; color: #8a93b0; font-size: 10.5px; font-weight: 600; letter-spacing: .4px; }
        .pp-stat-value { display: block; color: #4f7cff; font-size: 17px; font-weight: 800; line-height: 1.25; }
        .pp-stat-value.completed { color: #52c41a; }
        .pp-stat-value.time { color: #f39c11; }
        .pp-toast {
            position: fixed; top: 14px; right: 14px; color: #fff; padding: 11px 16px;
            border-radius: 12px; font-size: 13.5px; z-index: 1000000;
            box-shadow: 0 10px 26px rgba(23,43,99,.24);
            opacity: 0; transform: translateY(-16px) scale(.96);
            transition: opacity .3s, transform .3s;
            font-family: 'Segoe UI', 'PingFang SC', sans-serif;
            pointer-events: none; font-weight: 600;
        }
        .pp-toast.show { opacity: 1; transform: translateY(0) scale(1); }

        /* ============ 深色模式（data-theme="dark" 时覆盖） ============ */
        .pp-container[data-theme="dark"] .pp-panel {
            background: #1d2129; border-color: rgba(255,255,255,.08);
            box-shadow: 0 24px 60px rgba(0,0,0,.5), 0 8px 20px rgba(0,0,0,.35);
        }
        .pp-container[data-theme="dark"] .pp-tabs { background: #161a21; border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-tab { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-tab:hover { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-tab.active { color: #6f9bff; border-bottom-color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-tab-badge { background: #333b4b; color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-tab-badge.urgent { background: #FE4C61; color: #fff; }
        .pp-container[data-theme="dark"] .pp-memo-form { border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-memo-item { background: #161a21; border-color: #2a2f3a; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
        .pp-container[data-theme="dark"] .pp-memo-item:hover { border-color: #3a4252; }
        .pp-container[data-theme="dark"] .pp-memo-item.urgent { background: linear-gradient(90deg, #2a1a1e, #161a21); }
        .pp-container[data-theme="dark"] .pp-memo-text { color: #e6e8ee; }
        .pp-container[data-theme="dark"] .pp-memo-actions { border-top-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-memo-time { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-cal { border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-cal-nav { background: #1a1f28; border-color: #333b4b; color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-cal-nav:hover { background: #182540; border-color: #3a4a6b; }
        .pp-container[data-theme="dark"] .pp-cal-title { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-cal-today-btn { background: #1a1f28; border-color: #333b4b; color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-cal-today-btn:hover { border-color: #6f9bff; color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-cal-weekday { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-cal-cell { background: #1a1f28; color: #c3c9d8; }
        .pp-container[data-theme="dark"] .pp-cal-cell:hover { background: #202836; border-color: #3a4252; }
        .pp-container[data-theme="dark"] .pp-cal-cell.today { border-color: #6f9bff; color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-cal-cell.selected { background: linear-gradient(135deg, #4f7cff, #00c6fb); color: #fff; }
        .pp-container[data-theme="dark"] .pp-cal-day-head { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-cal-day-head .pp-cal-day-count { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-cal-day-empty { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-memo-datehint { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-memo-datehint .pp-hint-clear { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-memo-section-title { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-memo-date { color: #8fb6ec; background: #1d2839; }
        .pp-container[data-theme="dark"] .pp-memo-date.today { color: #fff; background: linear-gradient(135deg, #4f7cff, #00c6fb); }
        .pp-container[data-theme="dark"] .pp-memo-link { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-memo-dateedit-row label { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-memo-dateedit-row input { background: #161a21; border-color: #2a2f3a; color: #e6e8ee; }
        .pp-container[data-theme="dark"] .pp-memo-dateedit-row input:focus { border-color: #6f9bff; background: #1a1f28; }
        .pp-container[data-theme="dark"] .pp-body::-webkit-scrollbar-thumb { background: #343b4b; }
        .pp-container[data-theme="dark"] .pp-body::-webkit-scrollbar-thumb:hover { background: #454f63; }
        .pp-container[data-theme="dark"] .pp-form { border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-search-row { border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-form-group label { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-input { background: #161a21; border-color: #2a2f3a; color: #e6e8ee; }
        .pp-container[data-theme="dark"] .pp-input:hover { border-color: #3a4252; }
        .pp-container[data-theme="dark"] .pp-input:focus { border-color: #6f9bff; background: #1a1f28; box-shadow: 0 0 0 3.5px rgba(111,155,255,.18); }
        .pp-container[data-theme="dark"] .pp-item { background: #161a21; border-color: #2a2f3a; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
        .pp-container[data-theme="dark"] .pp-item:hover { border-color: #3a4252; box-shadow: 0 6px 14px rgba(0,0,0,.35); }
        .pp-container[data-theme="dark"] .pp-item.understood { background: #13171e; border-left-color: #FFC116; }
        .pp-container[data-theme="dark"] .pp-item.timing { background: linear-gradient(90deg, #15241b, #161a21); box-shadow: 0 2px 8px rgba(82,196,26,.18); }
        .pp-container[data-theme="dark"] .pp-time-badge { color: #a3adc7; background: #262c38; }
        .pp-container[data-theme="dark"] .pp-toolbar { border-top-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-tool-note { color: #c29bf5; border-color: #4b3a68; background: #221b30; }
        .pp-container[data-theme="dark"] .pp-tool-note:hover { background: #2b2140; border-color: #6a4f92; }
        .pp-container[data-theme="dark"] .pp-tool-note.has-note { color: #fff; border-color: #7b3fd4; background: linear-gradient(135deg, #a05ce4, #7b3fd4); }
        .pp-container[data-theme="dark"] .pp-tool-color { color: #5ecfc0; border-color: #2a524a; background: #122522; }
        .pp-container[data-theme="dark"] .pp-tool-color:hover { background: #16302c; border-color: #3a7a6d; }
        .pp-container[data-theme="dark"] .pp-tool-color.has-color { color: #fff; border-color: #2f9e8f; background: linear-gradient(135deg, #3fb8a6, #2f9e8f); }
        .pp-container[data-theme="dark"] .pp-tool-timer { color: #7fa8f2; border-color: #2b3f5c; background: #131c2c; }
        .pp-container[data-theme="dark"] .pp-tool-timer:hover { background: #182540; border-color: #3f5f8c; }
        .pp-container[data-theme="dark"] .pp-tool-timer.running { color: #fff; border-color: #1e9e63; background: linear-gradient(135deg, #2bb673, #1e9e63); }
        .pp-container[data-theme="dark"] .pp-tool-timer.break-phase { color: #fff; border-color: #e67e22; background: linear-gradient(135deg, #f39c11, #e67e22); }
        .pp-container[data-theme="dark"] .pp-tool-pin { color: #f0b04d; border-color: #52402a; background: #241c10; }
        .pp-container[data-theme="dark"] .pp-tool-pin:hover { background: #312a18; border-color: #8a6a30; }
        .pp-container[data-theme="dark"] .pp-tool-pin.pinned { color: #fff; border-color: #e67e22; background: linear-gradient(135deg, #f7b733, #e67e22); }
        .pp-container[data-theme="dark"] .pp-tool-move { color: #a3adc7; border-color: #333b4b; background: #1a1f28; }
        .pp-container[data-theme="dark"] .pp-tool-move:hover { color: #6f9bff; border-color: #3a4a6b; background: #182540; }
        .pp-container[data-theme="dark"] .pp-tool-date { color: #7fa8f2; border-color: #2b3f5c; background: #131c2c; }
        .pp-container[data-theme="dark"] .pp-tool-date:hover { background: #182540; border-color: #3f5f8c; }
        .pp-container[data-theme="dark"] .pp-tool-date.has-date { color: #fff; border-color: #4f7cff; background: linear-gradient(135deg, #4f7cff, #2f6fd0); }
        .pp-container[data-theme="dark"] .pp-timer-stop { border-color: #6b3a40; background: #2a1a1e; color: #ff8a8f; }
        .pp-container[data-theme="dark"] .pp-timer-stop:hover { border-color: #a05058; background: #352024; }
        .pp-container[data-theme="dark"] .pp-note-editor textarea { background: #161a21; border-color: #2a2f3a; color: #e6e8ee; }
        .pp-container[data-theme="dark"] .pp-note-editor textarea:focus { border-color: #a05ce4; background: #1a1f28; box-shadow: 0 0 0 3px rgba(160,92,228,.2); }
        .pp-container[data-theme="dark"] .pp-note-view { color: #c29bf5; background: #221b30; border-color: #3a2f50; }
        .pp-container[data-theme="dark"] .pp-note-view:hover { border-color: #5a4680; background: #2b2140; }
        .pp-container[data-theme="dark"] .pp-empty { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-done-summary { color: #a3adc7; background: #161a21; border-bottom-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-done-summary b { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-done-item { background: #161a21; border-color: #2a2f3a; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
        .pp-container[data-theme="dark"] .pp-done-item:hover { border-color: #3a4252; }
        .pp-container[data-theme="dark"] .pp-done-meta { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-done-note { color: #c29bf5; background: #221b30; border-color: #3a2f50; }
        .pp-container[data-theme="dark"] .pp-ov-card { background: #161a21; border-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-ov-label { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-goal-card { background: linear-gradient(135deg, #182231, #1c241a); border-color: #2c3a52; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
        .pp-container[data-theme="dark"] .pp-goal-card.done { background: linear-gradient(135deg, #15251d, #17251d); border-color: #2c4a38; }
        .pp-container[data-theme="dark"] .pp-goal-title { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-goal-num { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-goal-card.done .pp-goal-num { color: #52c41a; }
        .pp-container[data-theme="dark"] .pp-goal-track { background: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-chart-card { background: #161a21; border-color: #2a2f3a; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
        .pp-container[data-theme="dark"] .pp-chart-title { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-chart-title .pp-chart-sub { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-legend { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-legend-block { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-diff-track { background: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-diff-count { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-luogu-panel { background: #161a21; border-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-luogu-status { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-backup { border-top-color: #2a2f3a; background: #161a21; }
        .pp-container[data-theme="dark"] .pp-backup-title { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-backup-note { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-settings-toggle { background: #1a1f28; border-color: #333b4b; color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-settings-toggle:hover { border-color: #6f9bff; color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-settings { background: #161a21; border-color: #2a2f3a; box-shadow: inset 0 1px 3px rgba(0,0,0,.3); }
        .pp-container[data-theme="dark"] .pp-settings-row label { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-settings-row input[type=number], .pp-container[data-theme="dark"] .pp-settings-row select { background: #161a21; border-color: #2a2f3a; color: #e6e8ee; }
        .pp-container[data-theme="dark"] .pp-settings-row select { background: #1a1f28; }
        .pp-container[data-theme="dark"] .pp-settings-row input[type=number]:focus, .pp-container[data-theme="dark"] .pp-settings-row select:focus { border-color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-settings-row .unit { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-footer { background: #161a21; border-top-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-stat-card { background: #161a21; border-color: #2a2f3a; }
        .pp-container[data-theme="dark"] .pp-stat-label { color: #7c86a5; }
        .pp-container[data-theme="dark"] .pp-stat-value { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-stat-value.completed { color: #52c41a; }
        .pp-container[data-theme="dark"] .pp-stat-value.time { color: #f39c11; }
        .pp-container[data-theme="dark"] .pp-oj-btn { box-shadow: 0 6px 16px rgba(0,0,0,.4); }
        .pp-container[data-theme="dark"] .pp-oj-tag-toggle {
            background: #1a1f28; color: #a3adc7; border-color: #333b4b;
            box-shadow: 0 2px 6px rgba(0,0,0,.3);
        }
        .pp-container[data-theme="dark"] .pp-oj-tag-toggle:hover { border-color: #6f9bff; color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-oj-tag-toggle.on {
            color: #fff; border-color: #52c41a;
            background: linear-gradient(135deg, #52c41a, #2fa557);
        }
        .pp-container[data-theme="dark"] .pp-oj-diff-panel {
            background: #161a21; border-color: #2a2f3a; color: #a3adc7;
            box-shadow: 0 8px 20px rgba(0,0,0,.45);
        }
        .pp-container[data-theme="dark"] .pp-oj-diff-row select {
            background: #1a1f28; border-color: #2a2f3a; color: #e6e8ee;
        }
        .pp-container[data-theme="dark"] .pp-oj-diff-row select:focus { border-color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-luogu-opts { color: #a3adc7; }
        .pp-container[data-theme="dark"] .pp-luogu-opt select {
            background: #1a1f28; border-color: #2a2f3a; color: #e6e8ee;
        }
        .pp-container[data-theme="dark"] .pp-luogu-opt select:focus { border-color: #6f9bff; }
        /* 深色模式下难度色/图例色稍作提亮，保证可读性 */
        .pp-container[data-theme="dark"] .pp-ov-value { color: #6f9bff; }
        .pp-container[data-theme="dark"] .pp-ov-value.green { color: #52c41a; }
        .pp-container[data-theme="dark"] .pp-ov-value.orange { color: #f39c11; }
    `;
    document.head.appendChild(style);

    // ==================== DOM 构建 ====================

    const container = document.createElement('div');
    container.className = 'pp-container';

    const fab = document.createElement('button');
    fab.className = 'pp-fab';
    fab.textContent = '题';
    fab.title = '打开做题计划（跨网站同步）';

    const panel = document.createElement('div');
    panel.className = 'pp-panel';
    panel.innerHTML = `
        <div class="pp-header" data-i18n="app.name">做题计划</div>
        <div class="pp-tabs">
            <button class="pp-tab active" data-tab="active" data-i18n="tab.active">进行中</button>
            <button class="pp-tab" data-tab="done" data-i18n="tab.done">已完成</button>
            <button class="pp-tab" data-tab="stats" data-i18n="tab.stats">统计</button>
            <button class="pp-tab" data-tab="memo"><span data-i18n="tab.memo">备忘</span><span class="pp-tab-badge" id="pp-memo-count">0</span></button>
        </div>
        <div class="pp-body">
            <div class="pp-view active" data-view="active">
                <div class="pp-form">
                    <div class="pp-form-group">
                        <label for="pp-url" data-i18n="form.urlLabel">题目网址</label>
                        <input type="text" id="pp-url" class="pp-input" placeholder="https://example.com/problem/123">
                    </div>
                    <div class="pp-form-group">
                        <label for="pp-name" data-i18n="form.nameLabel">题目名称</label>
                        <input type="text" id="pp-name" class="pp-input" data-i18n-placeholder="form.namePlaceholder" placeholder="默认使用当前页面标题">
                    </div>
                    <div class="pp-form-group">
                        <label data-i18n="form.colorLabel">选择颜色</label>
                        <div class="pp-color-selection" id="pp-colors"></div>
                    </div>
                    <button class="pp-add-btn" id="pp-add" data-i18n="form.addBtn">添加题目到计划</button>
                </div>
                <div class="pp-search-row">
                    <input type="text" id="pp-search" class="pp-input" data-i18n-placeholder="search.placeholder" placeholder="🔍 搜索题目名 / 备注 / 网址…">
                    <button class="pp-btn pp-understand pp-random-btn" id="pp-random" data-i18n="search.randomBtn" data-i18n-title="search.randomTitle" title="从未理解题目中随机抽一道">🎲 随机一题</button>
                </div>
                <div class="pp-list" id="pp-list"></div>
            </div>
            <div class="pp-view" data-view="done">
                <div class="pp-done-summary" id="pp-done-summary"></div>
                <div class="pp-list" id="pp-done-list"></div>
            </div>
            <div class="pp-view" data-view="stats">
                <div class="pp-stats-charts" id="pp-stats-charts"></div>
            </div>
            <div class="pp-view" data-view="memo">
                <div class="pp-cal">
                    <div class="pp-cal-head">
                        <button class="pp-cal-nav" id="pp-cal-prev" data-i18n-title="cal.prev" title="上个月">‹</button>
                        <span class="pp-cal-title" id="pp-cal-title"></span>
                        <button class="pp-cal-nav" id="pp-cal-next" data-i18n-title="cal.next" title="下个月">›</button>
                        <button class="pp-cal-today-btn" id="pp-cal-today" data-i18n="cal.today">今天</button>
                    </div>
                    <div class="pp-cal-weekdays" id="pp-cal-weekdays"></div>
                    <div class="pp-cal-grid" id="pp-cal-grid"></div>
                    <div class="pp-cal-day-head" id="pp-cal-day-head"></div>
                    <div class="pp-list pp-cal-day-list" id="pp-cal-day-list"></div>
                </div>
                <div class="pp-memo-form">
                    <input type="text" id="pp-memo-input" class="pp-input" data-i18n-placeholder="memo.placeholder" placeholder="输入备忘内容…">
                    <button class="pp-btn pp-complete" id="pp-memo-add" data-i18n="memo.addBtn">添加</button>
                </div>
                <div class="pp-memo-datehint" id="pp-memo-datehint" style="display:none;"></div>
                <div class="pp-memo-section-title" id="pp-memo-all-title"></div>
                <div class="pp-list" id="pp-memo-list"></div>
            </div>
        </div>
        <div class="pp-backup">
            <div class="pp-backup-title" data-i18n="backup.title">💾 数据备份</div>
            <div class="pp-backup-buttons">
                <button class="pp-btn-backup pp-export" id="pp-export" data-i18n="backup.export">导出数据</button>
                <button class="pp-btn-backup pp-import" id="pp-import" data-i18n="backup.import">导入数据</button>
                <button class="pp-btn-backup pp-clear" id="pp-clear" data-i18n="backup.clear">清空数据</button>
                <button class="pp-btn-backup pp-luogu" id="pp-import-luogu" data-i18n="backup.luogu">📥 洛谷导入</button>
                <button class="pp-settings-toggle" id="pp-settings-toggle" data-i18n="backup.settings">⚙ 设置</button>
            </div>
            <div class="pp-luogu-panel" id="pp-luogu-panel">
                <div class="pp-form-group" style="margin-bottom:8px;">
                    <label for="pp-luogu-url" style="font-size:12px;" data-i18n="luogu.urlLabel">洛谷题单 / 做题计划链接</label>
                    <input type="text" id="pp-luogu-url" class="pp-input" placeholder="https://www.luogu.com.cn/training/xxx">
                </div>
                <div class="pp-luogu-opts">
                    <label class="pp-luogu-opt" data-i18n-title="luogu.tagsTitle" title="导入时自动获取题目标签写入备注">
                        <input type="checkbox" id="pp-import-tags"> <span data-i18n="luogu.tagsLabel">🏷 添加标签</span>
                    </label>
                    <label class="pp-luogu-opt" data-i18n-title="luogu.skipPassedTitle" title="导入时跳过洛谷上已通过的题目">
                        <input type="checkbox" id="pp-import-skip-passed"> <span data-i18n="luogu.skipPassedLabel">✅ 跳过已通过</span>
                    </label>
                    <label class="pp-luogu-opt" data-i18n-title="luogu.diffTitle" title="只导入该难度范围内的题目">
                        <span data-i18n="luogu.diffLabel">难度</span>
                        <select id="pp-import-diff-min"></select>
                        <span>~</span>
                        <select id="pp-import-diff-max"></select>
                    </label>
                </div>
                <button class="pp-btn-backup pp-export" id="pp-luogu-start" style="width:100%;margin-top:0;" data-i18n="luogu.start">开始导入题单</button>
                <button class="pp-btn-backup pp-import" id="pp-home-import" style="width:100%;margin-top:6px;" data-i18n="luogu.homeImport">从当前洛谷主页任务计划导入</button>
                <div class="pp-luogu-status" id="pp-luogu-status"></div>
            </div>
            <div class="pp-settings" id="pp-settings">
                <div class="pp-settings-row">
                    <label data-i18n="settings.focus">专注时长</label>
                    <input type="number" id="pp-focus-min" min="1" max="120">
                    <span class="unit" data-i18n="settings.minutes">分钟</span>
                </div>
                <div class="pp-settings-row">
                    <label data-i18n="settings.break">休息时长</label>
                    <input type="number" id="pp-break-min" min="1" max="60">
                    <span class="unit" data-i18n="settings.minutes">分钟</span>
                </div>
                <div class="pp-settings-row">
                    <label data-i18n="settings.autoBreak">自动休息</label>
                    <input type="checkbox" id="pp-auto-break">
                    <span class="unit" data-i18n="settings.autoBreakDesc">专注结束后自动开始休息</span>
                </div>
                <div class="pp-settings-row">
                    <label data-i18n="settings.dailyGoal">每日目标</label>
                    <input type="number" id="pp-daily-goal" min="0" max="100">
                    <span class="unit" data-i18n="settings.dailyGoalDesc">题（0 = 不启用）</span>
                </div>
                <div class="pp-settings-row">
                    <label data-i18n="settings.theme">主题</label>
                    <select id="pp-theme" data-i18n-title="settings.themeDesc" title="界面外观模式">
                        <option value="auto" data-i18n="settings.themeAuto">跟随系统</option>
                        <option value="light" data-i18n="settings.themeLight">浅色</option>
                        <option value="dark" data-i18n="settings.themeDark">深色</option>
                    </select>
                    <span class="unit" data-i18n="settings.themeDesc">面板外观</span>
                </div>
                <div class="pp-settings-row">
                    <label data-i18n="settings.lang">语言</label>
                    <select id="pp-lang">
                        <option value="auto" data-i18n="settings.langAuto">跟随系统</option>
                        <option value="zh-CN" data-i18n="settings.langZh">中文</option>
                        <option value="en" data-i18n="settings.langEn">English</option>
                    </select>
                </div>
            </div>
            <div class="pp-backup-note" data-i18n="backup.note" style="font-size:12px;color:#9aa3bf;margin-top:9px;font-style:italic;">
                导出包含进行中、已完成归档、备注、计时统计（v3 格式）
            </div>
        </div>
        <div class="pp-footer">
            <div class="pp-stats">
                <div class="pp-stat-card"><span class="pp-stat-label" data-i18n="footer.notUnderstood">未理解</span><span class="pp-stat-value" id="pp-not-understood">0</span></div>
                <div class="pp-stat-card"><span class="pp-stat-label" data-i18n="footer.understood">已理解</span><span class="pp-stat-value" id="pp-understood">0</span></div>
                <div class="pp-stat-card"><span class="pp-stat-label" data-i18n="footer.completed">已完成</span><span class="pp-stat-value completed" id="pp-completed">0</span></div>
            </div>
            <div class="pp-stats">
                <div class="pp-stat-card"><span class="pp-stat-label" data-i18n="footer.totalTime">累计专注</span><span class="pp-stat-value time" id="pp-total-time">0m</span></div>
            </div>
        </div>
        <input type="file" id="pp-file" accept=".json,application/json" style="display:none;">
    `;

    container.appendChild(fab);
    container.appendChild(panel);
    document.body.appendChild(container);

    // ==================== 颜色选择器 ====================

    const colorSelection = panel.querySelector('#pp-colors');
    COLOR_OPTIONS.forEach(color => {
        const div = document.createElement('div');
        div.className = 'pp-color-option';
        div.style.backgroundColor = color;
        div.title = color + ' · ' + difficultyLabel(COLOR_OPTIONS.indexOf(color));
        if (color === selectedColor) div.classList.add('selected');
        div.addEventListener('click', () => {
            colorSelection.querySelectorAll('.pp-color-option').forEach(o => o.classList.remove('selected'));
            div.classList.add('selected');
            selectedColor = color;
        });
        colorSelection.appendChild(div);
    });

    // ==================== 渲染：进行中 ====================

    function updateCounters() {
        const notUnderstood = problems.filter(p => !p.understood).length;
        const understood = problems.filter(p => p.understood).length;
        const totalSeconds = problems.reduce((s, p) => s + (p.timeSpent || 0), 0)
            + archive.reduce((s, a) => s + (a.timeSpent || 0), 0);
        panel.querySelector('#pp-not-understood').textContent = notUnderstood;
        panel.querySelector('#pp-understood').textContent = understood;
        panel.querySelector('#pp-completed').textContent = completedCount;
        panel.querySelector('#pp-total-time').textContent = formatDuration(totalSeconds);
        syncClearButton();
    }

    // 清空数据按钮状态：无任何数据时禁用（避免点了没反应）
    function syncClearButton() {
        const btn = panel.querySelector('#pp-clear');
        if (!btn) return;
        const hasData = problems.length + archive.length + memos.length > 0;
        btn.disabled = !hasData;
        btn.title = hasData ? '' : t('toast.nothingToClear');
    }

    function sortedProblems() {
        return [...problems.filter(p => p.pinned), ...problems.filter(p => !p.pinned)];
    }

    // 根据搜索关键词过滤（匹配 题目名 / 备注 / 网址，不区分大小写）
    function filteredProblems() {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return sortedProblems();
        return sortedProblems().filter(p =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.notes || '').toLowerCase().includes(q) ||
            (p.url || '').toLowerCase().includes(q)
        );
    }

    // 随机一题：从未理解题目中随机抽一道，并滚动到该题高亮
    function pickRandomProblem() {
        const candidates = problems.filter(p => !p.understood);
        if (!candidates.length) {
            showToast(t('toast.noUnsolved'), '#F39C11');
            return;
        }
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        // 清空搜索，确保能看到随机结果
        searchQuery = '';
        panel.querySelector('#pp-search').value = '';
        renderProblems();
        const target = panel.querySelector('#pp-list .pp-item[data-url="' + CSS.escape(pick.url) + '"]');
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('pp-random-hit');
            setTimeout(() => target.classList.remove('pp-random-hit'), 2600);
        }
        showToast(t('toast.randomPick', { name: pick.name }), '#3498DB');
    }

    function renderProblems() {
        const list = panel.querySelector('#pp-list');
        updateCounters();

        if (problems.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">📭</span><span class="pp-empty-text">' + t('empty.active') + '</span></div>';
            return;
        }

        const filtered = filteredProblems();
        if (filtered.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">🔍</span><span class="pp-empty-text">' + t('empty.noMatch', { q: searchQuery }) + '</span></div>';
            return;
        }

        list.innerHTML = '';
        filtered.forEach(p => list.appendChild(createProblemItem(p)));
        editingUrl = null;
    }

    function createProblemItem(problem) {
        const item = document.createElement('div');
        item.className = 'pp-item';
        item.dataset.url = problem.url;
        if (problem.understood) item.classList.add('understood');
        if (timerState && timerState.url === problem.url && timerState.phase === 'focus') item.classList.add('timing');
        if (problem._justFinished) { item.classList.add('just-finished'); delete problem._justFinished; }

        const main = document.createElement('div');
        main.className = 'pp-item-main';

        const link = document.createElement('a');
        link.className = 'pp-link';
        link.href = problem.url;
        link.textContent = problem.name;
        // 颜色优先级：自定义颜色 > 洛谷难度色 > 默认颜色
        link.style.color = problem.customColor
            ? problem.customColor
            : ((problem.difficulty !== null && problem.difficulty !== undefined)
                ? difficultyColor(problem.difficulty)
                : problem.color);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (problem.understood) {
            const badge = document.createElement('span');
            badge.className = 'pp-understood-badge';
            badge.textContent = ' ✓';
            link.appendChild(badge);
        }
        main.appendChild(link);

        if (problem.timeSpent > 0) {
            const timeBadge = document.createElement('span');
            timeBadge.className = 'pp-time-badge';
            timeBadge.textContent = '⏱ ' + formatDuration(problem.timeSpent);
            timeBadge.title = t('item.timeBadgeTitle');
            main.appendChild(timeBadge);
        }

        item.appendChild(main);

        // ---- 操作区（第一行：理解 / 完成 / 放弃）----
        const actions = document.createElement('div');
        actions.className = 'pp-actions';

        if (!problem.understood) {
            const understandBtn = document.createElement('button');
            understandBtn.className = 'pp-btn pp-understand pp-btn-sm';
            understandBtn.textContent = t('item.understand');
            understandBtn.title = t('item.understandTitle');
            understandBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const idx = problems.findIndex(p => p.url === problem.url);
                if (idx !== -1) {
                    problems[idx].understood = true;
                    saveData();
                    renderProblems();
                }
            });
            actions.appendChild(understandBtn);
        }

        const completeBtn = document.createElement('button');
        completeBtn.className = 'pp-btn pp-complete pp-btn-sm';
        completeBtn.textContent = t('item.complete');
        completeBtn.title = t('item.completeTitle');
        completeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm(t('confirm.complete', { name: problem.name }))) {
                const idx = problems.findIndex(p => p.url === problem.url);
                if (idx !== -1) {
                    if (timerState && timerState.url === problem.url) stopTimer();
                    const done = normalizeArchiveItem({
                        ...problems[idx],
                        completedDate: new Date().toISOString()
                    });
                    archive.unshift(done);
                    saveArchive();
                    problems.splice(idx, 1);
                    completedCount++;
                    saveData();
                    renderProblems();
                    // 达成今日目标时提示
                    const goal = settings.dailyGoal || 0;
                    if (goal > 0) {
                        const todayDone = countOnDate(new Date());
                        if (todayDone >= goal) {
                            showToast(t('toast.goalDone', { g: goal }), '#F39C11');
                        } else {
                            showToast(t('toast.archived', { t: todayDone, g: goal }), '#52C41A');
                        }
                    } else {
                        showToast(t('toast.archivedPlain'), '#52C41A');
                    }
                }
            }
        });
        actions.appendChild(completeBtn);

        const giveupBtn = document.createElement('button');
        giveupBtn.className = 'pp-btn pp-giveup pp-btn-sm';
        giveupBtn.textContent = t('item.giveup');
        giveupBtn.title = t('item.giveupTitle');
        giveupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm(t('confirm.giveup', { name: problem.name }))) {
                const idx = problems.findIndex(p => p.url === problem.url);
                if (idx !== -1) {
                    if (timerState && timerState.url === problem.url) stopTimer();
                    problems.splice(idx, 1);
                    saveData();
                    renderProblems();
                }
            }
        });
        actions.appendChild(giveupBtn);

        item.appendChild(actions);

        // ---- 工具条（第二行：备注 / 计时 / 置顶 / 上移 / 下移）----
        const toolbar = document.createElement('div');
        toolbar.className = 'pp-toolbar';

        const noteBtn = document.createElement('button');
        noteBtn.className = 'pp-tool-btn pp-tool-note';
        noteBtn.textContent = t('item.note');
        noteBtn.title = problem.notes ? t('item.noteTitleEdit') : t('item.noteTitleAdd');
        if (problem.notes) noteBtn.classList.add('has-note');
        noteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleNoteEditor(item, problem);
        });
        toolbar.appendChild(noteBtn);

        // 改色按钮：展开颜色选择器，自定义题目颜色
        const colorBtn = document.createElement('button');
        colorBtn.className = 'pp-tool-btn pp-tool-color';
        colorBtn.textContent = t('item.color');
        colorBtn.title = problem.customColor ? t('item.colorTitleSet') : t('item.colorTitleCustom');
        if (problem.customColor) colorBtn.classList.add('has-color');
        colorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleColorPicker(item, problem);
        });
        toolbar.appendChild(colorBtn);

        const timerBtn = document.createElement('button');
        timerBtn.className = 'pp-tool-btn pp-tool-timer pp-timer-btn';
        timerBtn.textContent = t('item.timer');
        timerBtn.title = t('item.timerTitle', { m: settings.focusMinutes });
        timerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (timerState && timerState.url === problem.url && timerState.phase === 'break') {
                stopTimer();
                return;
            }
            if (timerState && timerState.url === problem.url && timerState.running) {
                pauseTimer();
                return;
            }
            if (timerState && timerState.url === problem.url && !timerState.running) {
                resumeTimer();
                return;
            }
            startTimer(problem.url);
        });
        toolbar.appendChild(timerBtn);

        const stopBtn = document.createElement('button');
        stopBtn.className = 'pp-timer-stop';
        stopBtn.textContent = t('item.stop');
        stopBtn.title = t('item.stopTitle');
        stopBtn.style.display = 'none';
        stopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            stopTimer();
        });
        toolbar.appendChild(stopBtn);

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pp-tool-btn pp-tool-pin';
        pinBtn.textContent = problem.pinned ? t('item.pinned') : t('item.pin');
        pinBtn.title = problem.pinned ? t('item.pinTitleUnpin') : t('item.pinTitle');
        if (problem.pinned) pinBtn.classList.add('pinned');
        pinBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = problems.findIndex(p => p.url === problem.url);
            if (idx !== -1) {
                problems[idx].pinned = !problems[idx].pinned;
                saveData();
                renderProblems();
            }
        });
        toolbar.appendChild(pinBtn);

        const upBtn = document.createElement('button');
        upBtn.className = 'pp-tool-btn pp-tool-move';
        upBtn.textContent = '▲';
        upBtn.title = t('item.moveUp');
        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            moveProblem(problem.url, -1);
        });
        toolbar.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'pp-tool-btn pp-tool-move';
        downBtn.textContent = '▼';
        downBtn.title = t('item.moveDown');
        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            moveProblem(problem.url, 1);
        });
        toolbar.appendChild(downBtn);

        item.appendChild(toolbar);

        // 有备注时在题目下方展示
        if (problem.notes) {
            const noteView = document.createElement('div');
            noteView.className = 'pp-note-view';
            noteView.textContent = problem.notes;
            noteView.title = t('item.noteViewTitle');
            noteView.addEventListener('click', (e) => {
                e.preventDefault();
                toggleNoteEditor(item, problem);
            });
            item.appendChild(noteView);
        }

        return item;
    }

    // ▲▼ 移动（同置顶组内交换）
    function moveProblem(url, dir) {
        const sorted = sortedProblems();
        const idx = sorted.findIndex(p => p.url === url);
        if (idx === -1) return;
        const target = idx + dir;
        if (target < 0 || target >= sorted.length) return;
        if (sorted[idx].pinned !== sorted[target].pinned) {
            showToast(t('toast.moveRestricted'), '#FE4C61');
            return;
        }
        [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];
        problems = [...sorted.filter(p => p.pinned), ...sorted.filter(p => !p.pinned)];
        saveData();
        renderProblems();
    }

    // 更新计时按钮显示
    function updateTimerButton() {
        const list = panel.querySelector('#pp-list');
        if (!list) return;
        list.querySelectorAll('.pp-item').forEach(item => {
            const url = item.dataset.url;
            const timerBtn = item.querySelector('.pp-timer-btn');
            const stopBtn = item.querySelector('.pp-timer-stop');
            if (!timerBtn) return;

            const active = timerState && timerState.url === url;

            if (active) {
                stopBtn.style.display = '';
                const remainingSec = timerState.running
                    ? Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1000))
                    : Math.max(0, Math.ceil((timerState.remainingMs || 0) / 1000));
                const icon = timerState.phase === 'break' ? '☕ ' : (timerState.running ? '⏱ ' : '⏸ ');
                timerBtn.textContent = icon + formatTime(remainingSec);
                timerBtn.classList.add('running');
                timerBtn.classList.toggle('break-phase', timerState.phase === 'break');
                timerBtn.title = timerState.phase === 'focus'
                    ? (timerState.running ? t('timer.focusPause') : t('timer.paused'))
                    : t('timer.break');
            } else {
                stopBtn.style.display = 'none';
                timerBtn.textContent = t('item.timer');
                timerBtn.classList.remove('running', 'break-phase');
                timerBtn.title = t('item.timerTitle', { m: settings.focusMinutes });
            }
        });
    }

    // ==================== 备注编辑 ====================

    // 题目颜色选择器（展开后显示在工具条下方）
    function toggleColorPicker(item, problem) {
        const existing = item.querySelector('.pp-color-picker');
        if (existing) { existing.remove(); return; }
        item.querySelectorAll('.pp-color-picker').forEach(el => el.remove());

        const picker = document.createElement('div');
        picker.className = 'pp-color-picker';
        const row = document.createElement('div');
        row.className = 'pp-color-picker-row';

        COLOR_OPTIONS.forEach(color => {
            const dot = document.createElement('div');
            dot.className = 'pp-color-option' + (problem.customColor === color ? ' selected' : '');
            dot.style.backgroundColor = color;
            dot.title = color + ' · ' + difficultyLabel(COLOR_OPTIONS.indexOf(color));
            dot.addEventListener('click', () => {
                const idx = problems.findIndex(p => p.url === problem.url);
                if (idx !== -1) {
                    problems[idx].customColor = color;
                    saveData();
                    renderProblems();
                }
            });
            row.appendChild(dot);
        });

        // 恢复默认（清除自定义颜色，回到难度色/默认色）
        const reset = document.createElement('button');
        reset.className = 'pp-btn pp-giveup pp-btn-sm';
        reset.textContent = t('item.resetColor');
        reset.title = t('item.resetColorTitle');
        reset.addEventListener('click', () => {
            const idx = problems.findIndex(p => p.url === problem.url);
            if (idx !== -1) {
                problems[idx].customColor = '';
                saveData();
                renderProblems();
            }
        });

        picker.appendChild(row);
        picker.appendChild(reset);
        item.appendChild(picker);
    }

    function toggleNoteEditor(item, problem) {
        const existing = item.querySelector('.pp-note-editor');
        if (existing) {
            existing.remove();
            return;
        }
        item.querySelectorAll('.pp-note-editor').forEach(el => el.remove());

        const editor = document.createElement('div');
        editor.className = 'pp-note-editor';
        editor.innerHTML = `
            <textarea placeholder="${t('note.placeholder')}"></textarea>
            <div class="pp-note-actions">
                <button class="pp-btn pp-complete" type="button">${t('note.save')}</button>
                <button class="pp-btn pp-giveup" type="button">${t('note.cancel')}</button>
            </div>
        `;
        editor.querySelector('textarea').value = problem.notes || '';
        editor.querySelector('.pp-complete').addEventListener('click', () => {
            const idx = problems.findIndex(p => p.url === problem.url);
            if (idx !== -1) {
                problems[idx].notes = editor.querySelector('textarea').value.trim();
                saveData();
                showToast(t('toast.noteSaved'), '#9D3DCF');
            }
            renderProblems();
        });
        editor.querySelector('.pp-giveup').addEventListener('click', () => renderProblems());
        item.appendChild(editor);
        editor.querySelector('textarea').focus();
    }

    // ==================== 渲染：已完成归档 ====================

    function renderArchiveList() {
        const list = panel.querySelector('#pp-done-list');
        const summary = panel.querySelector('#pp-done-summary');
        updateCounters();

        const totalTime = archive.reduce((s, a) => s + (a.timeSpent || 0), 0);
        summary.innerHTML = `
            <span>${t('archive.summary', { n: '<b>' + archive.length + '</b>' })}</span>
            <span>${t('archive.time', { d: '<b>' + formatDuration(totalTime) + '</b>' })}</span>
        `;

        if (archive.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">🗂</span><span class="pp-empty-text">' + t('archive.empty') + '</span></div>';
            return;
        }

        list.innerHTML = '';
        archive.forEach(a => list.appendChild(createArchiveItem(a)));
    }

    function createArchiveItem(a) {
        const item = document.createElement('div');
        item.className = 'pp-done-item';

        const main = document.createElement('div');
        main.className = 'pp-done-main';

        const title = document.createElement('div');
        title.className = 'pp-done-title';
        const link = document.createElement('a');
        link.href = a.url;
        link.textContent = a.name;
        // 颜色优先级：自定义颜色 > 洛谷难度色 > 默认颜色（与进行中列表一致）
        link.style.color = a.customColor
            ? a.customColor
            : ((a.difficulty !== null && a.difficulty !== undefined)
                ? difficultyColor(a.difficulty)
                : a.color);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        title.appendChild(link);
        main.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'pp-done-meta';
        meta.innerHTML =
            '<span>' + t('archive.completedAt', { d: formatDateTime(a.completedDate) }) + '</span>' +
            (a.timeSpent > 0 ? '<span>' + t('archive.focus', { d: formatDuration(a.timeSpent) }) + '</span>' : '') +
            '<span>' + t('archive.addedAt', { d: formatDate(a.addedDate) }) + '</span>';
        main.appendChild(meta);

        if (a.notes) {
            const note = document.createElement('div');
            note.className = 'pp-done-note';
            note.textContent = a.notes;
            main.appendChild(note);
        }

        item.appendChild(main);

        const actions = document.createElement('div');
        actions.className = 'pp-done-actions';

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'pp-btn pp-restore pp-btn-sm';
        restoreBtn.textContent = t('archive.restore');
        restoreBtn.title = t('archive.restoreTitle');
        restoreBtn.addEventListener('click', () => {
            if (confirm(t('confirm.restore', { name: a.name }))) {
                restoreArchiveItem(a);
            }
        });
        actions.appendChild(restoreBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'pp-btn pp-del-record pp-btn-sm';
        delBtn.textContent = t('archive.delete');
        delBtn.title = t('archive.deleteTitle');
        delBtn.addEventListener('click', () => {
            if (confirm(t('confirm.deleteRecord', { name: a.name }))) {
                const idx = archive.findIndex(x => x.url === a.url && x.completedDate === a.completedDate);
                if (idx !== -1) {
                    archive.splice(idx, 1);
                    saveArchive();
                    renderArchiveList();
                    showToast(t('toast.recordDeleted'), '#FE4C61');
                }
            }
        });
        actions.appendChild(delBtn);

        item.appendChild(actions);
        return item;
    }

    function restoreArchiveItem(a) {
        const existed = problems.some(p => p.url === a.url);
        if (existed) {
            const idx = archive.findIndex(x => x.url === a.url && x.completedDate === a.completedDate);
            if (idx !== -1) {
                archive.splice(idx, 1);
                saveArchive();
                renderArchiveList();
            }
            showToast(t('toast.alreadyActive'), '#F39C11');
            return;
        }
        const idx = archive.findIndex(x => x.url === a.url && x.completedDate === a.completedDate);
        if (idx !== -1) {
            archive.splice(idx, 1);
            problems.push(normalizeProblem({
                ...a,
                understood: false,
                completedDate: null,
                pinned: false
            }));
            completedCount = Math.max(0, completedCount - 1);
            saveArchive();
            saveData();
            renderArchiveList();
            renderProblems();
            showToast(t('toast.restored'), '#52C41A');
        }
    }

    // ==================== 渲染：统计 ====================

    function countOnDate(target) {
        const key = dateKey(target);
        return archive.filter(a => dateKey(new Date(a.completedDate)) === key).length;
    }

    function calcStreak() {
        const done = new Set(archive.map(a => dateKey(new Date(a.completedDate))));
        const today = new Date();
        let cur = new Date(today);
        if (!done.has(dateKey(cur))) cur.setDate(cur.getDate() - 1);
        let streak = 0;
        while (done.has(dateKey(cur))) {
            streak++;
            cur.setDate(cur.getDate() - 1);
        }
        return streak;
    }

    // 某天完成题目的最高难度（-1 表示当天无有效难度记录）——按用户颜色判定
    function maxDifficultyOnDate(target) {
        const key = dateKey(target);
        let max = -1;
        archive.forEach(a => {
            if (dateKey(new Date(a.completedDate)) === key) {
                const d = effectiveDifficulty(a);
                if (d !== null && d > max) max = d;
            }
        });
        return max;
    }

    function renderStats() {
        const box = panel.querySelector('#pp-stats-charts');
        updateCounters();

        const todayCount = countOnDate(new Date());
        const totalTime = problems.reduce((s, p) => s + (p.timeSpent || 0), 0)
            + archive.reduce((s, a) => s + (a.timeSpent || 0), 0);

        // 总览卡片
        let html = `
            <div class="pp-ov-grid">
                <div class="pp-ov-card"><span class="pp-ov-value">${completedCount}</span><span class="pp-ov-label">${t('stats.total')}</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value green">${todayCount}</span><span class="pp-ov-label">${t('stats.today')}</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value orange">${calcStreak()}</span><span class="pp-ov-label">${t('stats.streak')}</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value">${formatDuration(totalTime)}</span><span class="pp-ov-label">${t('stats.totalTime')}</span></div>
            </div>
        `;

        // 每日目标进度条（设置 dailyGoal > 0 时显示）
        if ((settings.dailyGoal || 0) > 0) {
            const goal = settings.dailyGoal;
            const ratio = Math.min(1, todayCount / goal);
            const pct = Math.round(ratio * 100);
            const done = todayCount >= goal;
            html += `
                <div class="pp-goal-card ${done ? 'done' : ''}">
                    <div class="pp-goal-head">
                        <span class="pp-goal-title">${t('stats.goalTitle')}</span>
                        <span class="pp-goal-num">${t('stats.goalProgress', { t: todayCount, g: goal })}${done ? t('stats.goalDone') : ''}</span>
                    </div>
                    <div class="pp-goal-track"><div class="pp-goal-fill" style="width:${pct}%"></div></div>
                </div>
            `;
        }

        // 14 天趋势
        const days = [];
        const today = new Date();
        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            days.push({ date: d, count: countOnDate(d) });
        }
        const maxCount = Math.max(1, ...days.map(x => x.count));
        const barW = 100 / days.length;
        const emptyBarColor = container.getAttribute('data-theme') === 'dark' ? '#2a2f3a' : '#e8ecf7';
        html += `
            <div class="pp-chart-card">
                <div class="pp-chart-title">${t('stats.trendTitle')}<span class="pp-chart-sub">${t('stats.trendSub')}</span></div>
                <svg class="pp-chart-svg" viewBox="0 0 100 56" preserveAspectRatio="none" style="height:120px">
                    ${days.map((x, i) => {
                        const h = Math.max(2, (x.count / maxCount) * 46);
                        const y = 52 - h;
                        return `<rect x="${i * barW + barW * 0.15}" y="${y}" width="${barW * 0.7}" height="${h}" rx="1.5" fill="${x.count > 0 ? '#4f7cff' : emptyBarColor}">
                            <title>${t('stats.trendTooltip', { m: x.date.getMonth() + 1, d: x.date.getDate(), n: x.count })}</title>
                        </rect>`;
                    }).join('')}
                </svg>
            </div>
        `;

        // 难度分布统计（按用户颜色对应的难度 0-8，非洛谷题也参与统计）
        const diffCounts = new Array(DIFFICULTY_META.length).fill(0);
        let diffNone = 0;
        archive.forEach(a => {
            const d = effectiveDifficulty(a);
            if (d !== null) diffCounts[d]++;
            else diffNone++;
        });
        const maxDiffCount = Math.max(1, ...diffCounts, diffNone);
        html += `
            <div class="pp-chart-card">
                <div class="pp-chart-title">${t('stats.diffTitle')}<span class="pp-chart-sub">${t('stats.diffSub')}</span></div>
                <div class="pp-diff-bars">
                    ${DIFFICULTY_META.map((m, i) => `
                        <div class="pp-diff-row">
                            <span class="pp-diff-label" style="color:${m.color}">${difficultyLabel(i)}</span>
                            <div class="pp-diff-track"><div class="pp-diff-fill" style="width:${(diffCounts[i] / maxDiffCount) * 100}%;background:${m.color}"></div></div>
                            <span class="pp-diff-count">${diffCounts[i]}</span>
                        </div>`).join('')}
                    ${diffNone > 0 ? `
                        <div class="pp-diff-row">
                            <span class="pp-diff-label" style="color:${container.getAttribute('data-theme') === 'dark' ? '#7c86a5' : '#9aa3bf'}">${t('stats.diffNone')}</span>
                            <div class="pp-diff-track"><div class="pp-diff-fill" style="width:${(diffNone / maxDiffCount) * 100}%;background:${container.getAttribute('data-theme') === 'dark' ? '#3a4252' : '#d5dbea'}"></div></div>
                            <span class="pp-diff-count">${diffNone}</span>
                        </div>` : ''}
                </div>
            </div>
        `;

        // 月度热力图（最近 15 周）
        // 颜色 = 当天完成的最难题的洛谷难度色（灰<红<橙<黄<绿<青<蓝<紫<黑）
        // 色深 = 按完成数分档：0 / 1~2 / 3~4 / 5~6 / 7~8 / 9+（越深代表完成越多）
        const weeks = 15;
        const cell = 12, gap = 2;
        const gridH = 7;
        const endDate = new Date(today);
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - (weeks - 1) * 7 - 6);
        const depthLevel = (n) => n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
        const emptyHeatColor = container.getAttribute('data-theme') === 'dark' ? '#262c38' : '#ebedf0';
        const heatCellColor = (n, maxDiff) => {
            if (n <= 0) return emptyHeatColor;
            // 基础色：当天最难题的难度色；无难度记录时用主题蓝
            const base = maxDiff >= 0 ? difficultyColor(maxDiff) : '#4f7cff';
            // 七档色深：1~2 最浅 … 9+ 最深
            const shade = [0.55, 0.32, 0, -0.35, -0.6][depthLevel(n) - 1];
            return shadeHexColor(base, shade);
        };
        let cells = '';
        for (let w = 0; w < weeks; w++) {
            for (let d = 0; d < 7; d++) {
                const date = new Date(startDate);
                date.setDate(startDate.getDate() + w * 7 + d);
                if (date > endDate) continue;
                const cnt = countOnDate(date);
                const maxDiff = maxDifficultyOnDate(date);
                cells += `<rect x="${w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${heatCellColor(cnt, maxDiff)}">
                    <title>${maxDiff >= 0
                        ? t('stats.heatTooltip', { m: date.getMonth() + 1, d: date.getDate(), n: cnt, l: difficultyLabel(maxDiff) })
                        : t('stats.trendTooltip', { m: date.getMonth() + 1, d: date.getDate(), n: cnt })}</title>
                </rect>`;
            }
        }
        const chartW = weeks * (cell + gap) - gap;
        const chartH = gridH * (cell + gap) - gap;
        // 图例：难度色阶 + 色深档位
        const diffLegend = DIFFICULTY_META.map((m, i) =>
            `<span class="cell" style="background:${m.color}" title="${difficultyLabel(i)}"></span>`
        ).join('');
        const shadeShades = [0.55, 0.32, 0, -0.35, -0.6];
        const shadeLabels = ['1~2', '3~4', '5~6', '7~8', '9+'];
        const shadeLegend = shadeShades.map((s, i) =>
            `<span class="cell" style="background:${shadeHexColor('#13C2C2', s)}"></span><span>${shadeLabels[i]}</span>`
        ).join('');
        html += `
            <div class="pp-chart-card">
                <div class="pp-chart-title">${t('stats.heatmapTitle')}<span class="pp-chart-sub">${t('stats.heatmapSub')}</span></div>
                <svg class="pp-chart-svg" viewBox="0 0 ${chartW} ${chartH}" style="height:${chartH + 4}px;width:auto;display:block;margin:0 auto">
                    ${cells}
                </svg>
                <div class="pp-legend-block">
                    <span>${t('stats.legendDifficulty')}</span>${diffLegend}
                </div>
                <div class="pp-legend-block">
                    <span>${t('stats.legendCount')}</span>
                    <span class="cell" style="background:${emptyHeatColor}"></span><span>0</span>
                    ${shadeLegend}
                </div>
            </div>
        `;

        box.innerHTML = html;
    }

    // ==================== 备忘录 ====================

    // ==================== 日历 ====================

    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth(); // 0-11
    let calSelectedDate = ''; // 选中日期 YYYY-MM-DD；'' = 未选中（下方默认展示今天）

    // 某天的备忘条目（按时间排序）
    function memosOnDate(key) {
        return memos.filter(m => m.date === key)
            .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }

    // 渲染日历（月视图网格 + 选中日期条目列表 + 输入区日期提示）
    function renderCalendar() {
        const grid = panel.querySelector('#pp-cal-grid');
        const weekdaysEl = panel.querySelector('#pp-cal-weekdays');
        const titleEl = panel.querySelector('#pp-cal-title');
        const dayHead = panel.querySelector('#pp-cal-day-head');
        const dayList = panel.querySelector('#pp-cal-day-list');
        if (!grid || !weekdaysEl || !titleEl || !dayHead || !dayList) return;

        titleEl.textContent = t('cal.ym', { y: calYear, m: calMonth + 1 });

        // 星期表头（周日开头）
        const wd = currentLang === 'en'
            ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
            : ['日', '一', '二', '三', '四', '五', '六'];
        weekdaysEl.innerHTML = wd.map(w => '<span class="pp-cal-weekday">' + w + '</span>').join('');

        // 月视图单元格：上月补位 + 本月 + 下月补齐（至少 5 行）
        const startOffset = new Date(calYear, calMonth, 1).getDay();
        const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
        const prevMonthDays = new Date(calYear, calMonth, 0).getDate();
        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) {
            cells.push({ date: new Date(calYear, calMonth - 1, prevMonthDays - i), other: true });
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push({ date: new Date(calYear, calMonth, d), other: false });
        }
        let nextDay = 1;
        while (cells.length < 35 || cells.length % 7 !== 0) {
            cells.push({ date: new Date(calYear, calMonth + 1, nextDay++), other: true });
        }

        const todayKey = dateKey(new Date());
        grid.innerHTML = '';
        cells.forEach(c => {
            const key = dateKey(c.date);
            const cellEl = document.createElement('div');
            cellEl.className = 'pp-cal-cell' + (c.other ? ' other' : '');
            if (key === todayKey) cellEl.classList.add('today');
            if (key === calSelectedDate) cellEl.classList.add('selected');
            if (memosOnDate(key).length) cellEl.classList.add('has-entry');
            cellEl.textContent = c.date.getDate();
            cellEl.title = key;
            cellEl.addEventListener('click', () => {
                // 再点一次已选中的日期 = 取消选中（新条目不带日期）
                calSelectedDate = (calSelectedDate === key) ? '' : key;
                if (c.other) {
                    calYear = c.date.getFullYear();
                    calMonth = c.date.getMonth();
                }
                renderCalendar();
            });
            grid.appendChild(cellEl);
        });

        // 选中日期的条目列表（未选中时展示今天）
        const viewKey = calSelectedDate || todayKey;
        const dayMemos = memosOnDate(viewKey);
        dayHead.innerHTML = '<span>📅 ' + viewKey + (calSelectedDate ? '' : ' · ' + t('cal.today')) + '</span>'
            + '<span class="pp-cal-day-count">' + dayMemos.length + '</span>';
        dayList.innerHTML = '';
        if (!dayMemos.length) {
            dayList.innerHTML = '<div class="pp-cal-day-empty">' + t('cal.empty') + '</div>';
        } else {
            dayMemos.forEach(m => dayList.appendChild(createMemoItem(m)));
        }

        // 输入区日期提示（选中日期时新条目自动带上该日期）
        const hint = panel.querySelector('#pp-memo-datehint');
        if (hint) {
            if (calSelectedDate) {
                hint.style.display = '';
                hint.innerHTML = '';
                hint.appendChild(document.createTextNode(t('cal.addHere', { d: calSelectedDate })));
                const clear = document.createElement('span');
                clear.className = 'pp-hint-clear';
                clear.textContent = '✕ ' + t('cal.clearDate');
                clear.addEventListener('click', () => { calSelectedDate = ''; renderCalendar(); });
                hint.appendChild(clear);
            } else {
                hint.style.display = 'none';
            }
        }
    }

    function calShiftMonth(delta) {
        const d = new Date(calYear, calMonth + delta, 1);
        calYear = d.getFullYear();
        calMonth = d.getMonth();
        renderCalendar();
    }

    function calGoToday() {
        const now = new Date();
        calYear = now.getFullYear();
        calMonth = now.getMonth();
        calSelectedDate = dateKey(now);
        renderCalendar();
    }

    // 紧急优先排序（紧急置顶）
    function sortedMemos() {
        return [...memos.filter(m => m.urgent), ...memos.filter(m => !m.urgent)];
    }

    // 更新顶栏备忘角标（数量 + 有紧急时变红）
    function updateMemoCount() {
        const badge = panel.querySelector('#pp-memo-count');
        if (!badge) return;
        const urgentCount = memos.filter(m => m.urgent).length;
        badge.textContent = memos.length;
        badge.classList.toggle('urgent', urgentCount > 0);
        badge.title = urgentCount > 0 ? t('memo.urgentTitle') : '';
        syncClearButton();
    }

    function renderMemos() {
        const list = panel.querySelector('#pp-memo-list');
        updateMemoCount();
        const titleEl = panel.querySelector('#pp-memo-all-title');
        if (titleEl) titleEl.textContent = memos.length ? t('memo.allTitle', { n: memos.length }) : '';
        if (memos.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">📝</span><span class="pp-empty-text">' + t('memo.empty') + '</span></div>';
            return;
        }
        list.innerHTML = '';
        sortedMemos().forEach(m => list.appendChild(createMemoItem(m)));
    }

    function createMemoItem(memo) {
        const item = document.createElement('div');
        item.className = 'pp-memo-item' + (memo.urgent ? ' urgent' : '');
        item.dataset.id = memo.id;

        const main = document.createElement('div');
        main.className = 'pp-memo-main';
        if (memo.urgent) {
            const badge = document.createElement('span');
            badge.className = 'pp-memo-urgent-badge';
            badge.textContent = t('memo.urgentBadge');
            main.appendChild(badge);
        }
        const text = document.createElement('div');
        text.className = 'pp-memo-text';
        // 日历条目：日期（+时间）徽章显示在文本前
        if (memo.date) {
            const dateBadge = document.createElement('span');
            dateBadge.className = 'pp-memo-date' + (memo.date === dateKey(new Date()) ? ' today' : '');
            dateBadge.textContent = '📅 ' + memo.date + (memo.time ? ' ' + memo.time : '');
            text.appendChild(dateBadge);
        }
        text.appendChild(document.createTextNode(memo.text));
        main.appendChild(text);
        // 关联链接（比赛 / 题目）
        if (memo.link) {
            const linkEl = document.createElement('a');
            linkEl.className = 'pp-memo-link';
            linkEl.href = memo.link;
            linkEl.target = '_blank';
            linkEl.rel = 'noopener noreferrer';
            linkEl.textContent = '🔗 ' + t('memo.linkOpen');
            linkEl.title = memo.link;
            main.appendChild(linkEl);
        }
        const time = document.createElement('div');
        time.className = 'pp-memo-time';
        time.textContent = formatDateTime(memo.createdAt);
        main.appendChild(time);
        item.appendChild(main);

        const actions = document.createElement('div');
        actions.className = 'pp-memo-actions';

        // 日期 / 时间 / 链接编辑（写入日历）
        const dateBtn = document.createElement('button');
        dateBtn.className = 'pp-tool-btn pp-tool-date' + (memo.date ? ' has-date' : '');
        dateBtn.textContent = '📅';
        dateBtn.title = memo.date ? t('memo.dateBtnTitleSet') : t('memo.dateBtnTitleAdd');
        dateBtn.addEventListener('click', (e) => { e.preventDefault(); toggleMemoDateEditor(item, memo); });
        actions.appendChild(dateBtn);

        const urgentBtn = document.createElement('button');
        urgentBtn.className = 'pp-tool-btn pp-tool-pin' + (memo.urgent ? ' pinned' : '');
        urgentBtn.textContent = memo.urgent ? t('memo.unurgent') : t('memo.urgent');
        urgentBtn.title = memo.urgent ? t('memo.unurgentTitle') : t('memo.urgentTitle');
        urgentBtn.addEventListener('click', (e) => { e.preventDefault(); toggleMemoUrgent(memo.id); });
        actions.appendChild(urgentBtn);

        const upBtn = document.createElement('button');
        upBtn.className = 'pp-tool-btn pp-tool-move';
        upBtn.textContent = '▲';
        upBtn.title = t('item.moveUp');
        upBtn.addEventListener('click', (e) => { e.preventDefault(); moveMemo(memo.id, -1); });
        actions.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'pp-tool-btn pp-tool-move';
        downBtn.textContent = '▼';
        downBtn.title = t('item.moveDown');
        downBtn.addEventListener('click', (e) => { e.preventDefault(); moveMemo(memo.id, 1); });
        actions.appendChild(downBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'pp-btn pp-giveup pp-btn-sm';
        delBtn.textContent = t('memo.delete');
        delBtn.title = t('memo.deleteTitle');
        delBtn.addEventListener('click', (e) => { e.preventDefault(); deleteMemo(memo.id); });
        actions.appendChild(delBtn);

        item.appendChild(actions);
        return item;
    }

    // 日期 / 时间 / 链接编辑器（展开在条目下方，复用备注编辑器的交互模式）
    function toggleMemoDateEditor(item, memo) {
        const existing = item.querySelector('.pp-memo-dateedit');
        if (existing) { existing.remove(); return; }
        item.querySelectorAll('.pp-memo-dateedit').forEach(el => el.remove());

        const editor = document.createElement('div');
        editor.className = 'pp-memo-dateedit';
        const mkRow = (labelText, inputEl) => {
            const row = document.createElement('div');
            row.className = 'pp-memo-dateedit-row';
            const lab = document.createElement('label');
            lab.textContent = labelText;
            row.appendChild(lab);
            row.appendChild(inputEl);
            return row;
        };
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = memo.date || '';
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.value = memo.time || '';
        const linkInput = document.createElement('input');
        linkInput.type = 'text';
        linkInput.placeholder = t('memo.linkPlaceholder');
        linkInput.value = memo.link || '';
        editor.appendChild(mkRow(t('memo.dateLabel'), dateInput));
        editor.appendChild(mkRow(t('memo.timeLabel'), timeInput));
        editor.appendChild(mkRow(t('memo.linkLabel'), linkInput));

        const actionRow = document.createElement('div');
        actionRow.className = 'pp-memo-dateedit-actions';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'pp-btn pp-complete pp-btn-sm';
        saveBtn.type = 'button';
        saveBtn.textContent = t('note.save');
        saveBtn.addEventListener('click', () => {
            const idx = memos.findIndex(x => x.id === memo.id);
            if (idx !== -1) {
                memos[idx].date = dateInput.value || '';
                memos[idx].time = timeInput.value || '';
                memos[idx].link = linkInput.value.trim();
                memos[idx] = normalizeMemo(memos[idx]);
                saveMemos();
                showToast(t('toast.dateSaved'), '#3498DB');
            }
            renderCalendar();
            renderMemos();
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'pp-btn pp-giveup pp-btn-sm';
        cancelBtn.type = 'button';
        cancelBtn.textContent = t('note.cancel');
        cancelBtn.addEventListener('click', () => { renderCalendar(); renderMemos(); });
        actionRow.appendChild(saveBtn);
        actionRow.appendChild(cancelBtn);
        if (memo.date) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'pp-btn pp-giveup pp-btn-sm';
            clearBtn.type = 'button';
            clearBtn.textContent = t('memo.clearDate');
            clearBtn.addEventListener('click', () => {
                const idx = memos.findIndex(x => x.id === memo.id);
                if (idx !== -1) {
                    memos[idx] = normalizeMemo({ ...memos[idx], date: '', time: '' });
                    saveMemos();
                    showToast(t('toast.dateCleared'), '#F39C11');
                }
                renderCalendar();
                renderMemos();
            });
            actionRow.appendChild(clearBtn);
        }
        editor.appendChild(actionRow);

        item.appendChild(editor);
        dateInput.focus();
    }

    function toggleMemoUrgent(id) {
        const m = memos.find(x => x.id === id);
        if (!m) return;
        m.urgent = !m.urgent;
        saveMemos();
        renderMemos();
        renderCalendar();
    }

    function deleteMemo(id) {
        if (!confirm(t('memo.confirmDelete'))) return;
        memos = memos.filter(x => x.id !== id);
        saveMemos();
        renderMemos();
        renderCalendar();
    }

    // 移动备忘（同紧急组内交换，与题目置顶逻辑一致）
    function moveMemo(id, dir) {
        const sorted = sortedMemos();
        const idx = sorted.findIndex(m => m.id === id);
        if (idx === -1) return;
        const target = idx + dir;
        if (target < 0 || target >= sorted.length) return;
        if (sorted[idx].urgent !== sorted[target].urgent) {
            showToast(t('toast.moveRestricted'), '#FE4C61');
            return;
        }
        [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];
        memos = [...sorted.filter(m => m.urgent), ...sorted.filter(m => !m.urgent)];
        saveMemos();
        renderMemos();
        renderCalendar();
    }

    function addMemo() {
        const input = panel.querySelector('#pp-memo-input');
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        // 日历中选中日期时，新条目自动带上该日期（显示在日历上）
        memos.push(normalizeMemo({
            text, urgent: false, createdAt: new Date().toISOString(),
            date: calSelectedDate || ''
        }));
        saveMemos();
        input.value = '';
        renderMemos();
        renderCalendar();
        if (calSelectedDate) showToast(t('toast.memoAddedDay', { d: calSelectedDate }), '#52C41A');
        input.focus();
    }

    // ==================== 标签页切换 ====================

    function switchTab(tab) {
        currentTab = tab;
        panel.querySelectorAll('.pp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        panel.querySelectorAll('.pp-view').forEach(v => v.classList.toggle('active', v.dataset.view === tab));
        if (tab === 'active') renderProblems();
        else if (tab === 'done') renderArchiveList();
        else if (tab === 'stats') renderStats();
        else if (tab === 'memo') { renderCalendar(); renderMemos(); }
    }

    panel.querySelectorAll('.pp-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // ==================== 导入 / 导出 / 清空 ====================

    function exportData() {
        const data = {
            problems,
            archive,
            completedCount,
            exportDate: new Date().toISOString(),
            version: '3.0',
            totalProblems: problems.length
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const d = new Date();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        a.href = url;
        a.download = t('backup.filename') + '_' + dateStr + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('toast.exported'), '#52C41A');
    }

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.problems || !Array.isArray(data.problems)) throw new Error(t('alert.invalidData'));
                const importedArchive = Array.isArray(data.archive) ? data.archive : [];
                const importedMemos = Array.isArray(data.memos) ? data.memos : [];
                const ok = confirm(t('confirm.import', {
                    a: data.problems.length,
                    b: importedArchive.length,
                    d: importedMemos.length,
                    c: data.completedCount || 0
                }));
                if (!ok) { event.target.value = ''; return; }

                // 合并进行中：按 URL 去重，保留现有数据
                // 同时排除已存在于归档中的 URL，避免同一题出现在两处
                const existingUrls = new Set(problems.map(p => p.url));
                archive.forEach(a => existingUrls.add(a.url));
                let addedActive = 0, skippedActive = 0;
                data.problems.forEach(p => {
                    const np = normalizeProblem(p);
                    if (existingUrls.has(np.url)) { skippedActive++; return; }
                    existingUrls.add(np.url);
                    problems.push(np);
                    addedActive++;
                });

                // 合并归档：按 url + completedDate 去重
                const existingArch = new Set(archive.map(a => a.url + '|' + a.completedDate));
                let addedArch = 0, skippedArch = 0;
                importedArchive.forEach(a => {
                    const na = normalizeArchiveItem(a);
                    const key = na.url + '|' + na.completedDate;
                    if (existingArch.has(key)) { skippedArch++; return; }
                    existingArch.add(key);
                    archive.push(na);
                    addedArch++;
                });

                // 合并备忘（含日历条目）：按 id 去重
                const existingMemoIds = new Set(memos.map(m => m.id));
                let addedMemo = 0;
                importedMemos.forEach(m => {
                    const nm = normalizeMemo(m);
                    if (!nm.text || existingMemoIds.has(nm.id)) return;
                    existingMemoIds.add(nm.id);
                    memos.push(nm);
                    addedMemo++;
                });

                // 完成计数取两者较大值（合并不倒退统计）
                completedCount = Math.max(completedCount, data.completedCount || 0);

                clearTimer();
                saveData();
                saveArchive();
                saveMemos();
                renderProblems();
                renderArchiveList();
                renderCalendar();
                renderMemos();
                showToast(
                    t('toast.imported', { a: addedActive, b: addedArch }) +
                    (addedMemo ? t('toast.importedMemos', { n: addedMemo }) : '') +
                    (skippedActive + skippedArch ? t('toast.importedSkip', { n: skippedActive + skippedArch }) : ''),
                    '#52C41A'
                );
            } catch (error) {
                alert(t('alert.importFail', { e: error.message }));
                console.error('[做题计划] 导入错误:', error);
            }
            event.target.value = '';
        };
        reader.onerror = function () {
            alert(t('alert.readFail'));
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    function clearAllData() {
        const total = problems.length + archive.length + memos.length;
        // 无数据时给出明确提示（避免误以为按钮失效）
        if (total === 0) {
            showToast(t('toast.nothingToClear'), '#F39C11');
            return;
        }
        if (confirm(t('confirm.clear'))) {
            clearTimer();
            problems = [];
            archive = [];
            memos = [];
            completedCount = 0;
            saveData();
            saveArchive();
            saveMemos();
            renderProblems();
            renderArchiveList();
            renderCalendar();
            renderMemos();
            showToast(t('toast.cleared'), '#FE4C61');
        }
    }

    // ==================== 设置面板 ====================

    // 主题应用：auto=跟随系统，light=浅色，dark=深色
    // 通过 container 的 data-theme 属性驱动 CSS 覆盖层
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function applyTheme() {
        const t = settings.theme || 'auto';
        const dark = t === 'dark' || (t === 'auto' && darkQuery && darkQuery.matches);
        container.setAttribute('data-theme', dark ? 'dark' : 'light');
        // 统计图表 SVG 中的占位色随主题变化，重新渲染
        if (isPanelVisible && currentTab === 'stats') renderStats();
    }
    // 系统主题切换时，auto 模式自动跟随
    if (darkQuery && darkQuery.addEventListener) {
        darkQuery.addEventListener('change', () => {
            if ((settings.theme || 'auto') === 'auto') applyTheme();
        });
    }

    function syncSettingsUI() {
        panel.querySelector('#pp-focus-min').value = settings.focusMinutes;
        panel.querySelector('#pp-break-min').value = settings.breakMinutes;
        panel.querySelector('#pp-auto-break').checked = !!settings.autoBreak;
        panel.querySelector('#pp-daily-goal').value = settings.dailyGoal || 0;
        panel.querySelector('#pp-theme').value = settings.theme || 'auto';
        panel.querySelector('#pp-lang').value = settings.lang || 'zh-CN';
    }

    function bindSettings() {
        const focusInput = panel.querySelector('#pp-focus-min');
        const breakInput = panel.querySelector('#pp-break-min');
        const autoBreak = panel.querySelector('#pp-auto-break');
        const dailyGoalInput = panel.querySelector('#pp-daily-goal');
        const themeSelect = panel.querySelector('#pp-theme');
        const langSelect = panel.querySelector('#pp-lang');

        function apply() {
            settings.focusMinutes = Math.min(120, Math.max(1, parseInt(focusInput.value, 10) || 25));
            settings.breakMinutes = Math.min(60, Math.max(1, parseInt(breakInput.value, 10) || 5));
            settings.autoBreak = autoBreak.checked;
            settings.dailyGoal = Math.min(100, Math.max(0, parseInt(dailyGoalInput.value, 10) || 0));
            settings.theme = themeSelect.value || 'auto';
            settings.lang = langSelect.value || 'zh-CN';
            saveSettings();
            applyTheme();
            applyLang();
            showToast(t('toast.settingsSaved'), '#3498DB');
        }
        focusInput.addEventListener('change', apply);
        breakInput.addEventListener('change', apply);
        autoBreak.addEventListener('change', apply);
        dailyGoalInput.addEventListener('change', apply);
        themeSelect.addEventListener('change', apply);
        langSelect.addEventListener('change', apply);

        panel.querySelector('#pp-settings-toggle').addEventListener('click', () => {
            const box = panel.querySelector('#pp-settings');
            box.classList.toggle('show');
            syncSettingsUI();
        });
    }

    // ==================== 洛谷 API 模块 ====================

    // 站点识别与洛谷 RMJ 题号构造
    function detectOJ() {
        const h = location.hostname.toLowerCase();
        const p = location.pathname;
        let m;
        if (h === 'www.luogu.com.cn' || h === 'luogu.com.cn') {
            // 排除题库列表/题解/新建/上传等非题目页（/problem/list、/problem/solution、/problem/P1001/solution 等）
            if (/\/problem\/(?:solution|list|new|upload|discussion)(?:\/|$)/i.test(p)) return null;
            if (/\/problem\/[^/]+\/(?:solution|discussion)(?:\/|$)/i.test(p)) return null;
            m = p.match(/^\/problem\/([A-Za-z0-9_]+)/);
            if (m) {
                return { site: 'luogu', luoguPid: m[1], pageUrl: location.href.split('#')[0].split('?')[0] };
            }
            return null;
        }
        if (h === 'codeforces.com' || h.endsWith('.codeforces.com')) {
            m = p.match(/^\/(?:contest\/(\d+)\/problem|problemset\/problem\/(\d+))\/([A-Za-z0-9]+)/);
            if (m) {
                const c = m[1] || m[2];
                return { site: 'codeforces', contest: c, index: m[3], luoguPid: 'CF' + c + m[3], pageUrl: location.href.split('#')[0].split('?')[0] };
            }
            return null;
        }
        if (h === 'atcoder.jp') {
            // 题解页（/contests/xxx/tasks/xxx/editorial）不注入按钮
            if (/\/tasks\/[^/?]+\/editorial(?:\/|$)/i.test(p)) return null;
            m = p.match(/^\/contests\/([^/]+)\/tasks\/([^/?]+)/);
            if (m) return { site: 'atcoder', contest: m[1], task: m[2], luoguPid: 'AT_' + m[2], pageUrl: location.href.split('#')[0].split('?')[0] };
            return null;
        }
        if (h === 'onlinejudge.org' || h === 'uva.onlinejudge.org' || h === 'icpcarchive.ecs.baylor.edu') {
            m = location.search.match(/problem=(\d+)/);
            if (m) return { site: 'uva', num: m[1], luoguPid: 'UVA' + m[1], pageUrl: location.href.split('#')[0] };
            return null;
        }
        return null;
    }

    // 从当前页面 DOM 提取题名
    function ojPageTitle(det) {
        if (!det) return '';
        if (det.site === 'codeforces') {
            const el = document.querySelector('.problem-statement .title');
            if (el) return el.textContent.trim().replace(/^[A-Za-z0-9]+\d*\.\s*/, '');
        }
        if (det.site === 'atcoder') {
            const el = document.querySelector('span.h2') || document.querySelector('#main-container .h2');
            if (el) return el.textContent.trim().replace(/^[A-Za-z0-9]+\d*\s*-\s*/, '');
        }
        if (det.site === 'luogu') {
            return cleanLuoguTitle(document.title, det.luoguPid);
        }
        return '';
    }

    function cleanLuoguTitle(raw, pid) {
        let t = String(raw || '').trim()
            .replace(/\s*-\s*洛谷.*$/i, '')
            .replace(/\s*\|?\s*洛谷.*$/i, '')
            .replace(/\s*-\s*Luogu.*$/i, '');
        if (pid) {
            const re = new RegExp('^' + pid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i');
            t = t.replace(re, '');
        }
        return t.trim();
    }

    function decodeHTML(str) {
        const ta = document.createElement('textarea');
        ta.innerHTML = String(str || '');
        return ta.value;
    }

    // 从洛谷响应解析难度（0-8）
    function parseLuoguDifficulty(html) {
        const m = String(html).match(/problem\/list\?difficulty=(\d+)/);
        if (m) {
            const d = parseInt(m[1], 10);
            if (d >= 0 && d <= DIFF_MAX) return d;
        }
        const m2 = String(html).match(/"difficulty"\s*:\s*(-?\d+)/);
        if (m2) {
            const d = parseInt(m2[1], 10);
            if (d >= 0 && d <= DIFF_MAX) return d;
        }
        return null;
    }

    // ==================== 洛谷标签映射 ====================
    // 洛谷官方接口 /_lfe/tags 返回完整标签表：{"tags":[{id,name,type,parent}],"types":[...]}
    // 题目页响应中 tags 为 ID 数组（如 "tags":[1,3]），需映射为名称
    const TAG_MAP_KEY = 'problemPlanner_tagMap';
    const TAG_MAP_TTL = 7 * 24 * 3600 * 1000; // 映射表缓存 7 天

    // 标签分类展示顺序：来源 → 时间 → 区域 → 算法 → 特殊题目 → 其他
    // 对应洛谷 type：3=Origin(来源) 4=Time(时间) 1=Region(区域) 2=Algorithm(算法) 5=SpecialProblem(特殊) 6=Others(其他)
    const TAG_TYPE_ORDER = { 3: 0, 4: 1, 1: 2, 2: 3, 5: 4, 6: 5 };
    function tagTypeSortKey(type) {
        return (type in TAG_TYPE_ORDER) ? TAG_TYPE_ORDER[type] : 99;
    }

    // 洛谷标签 中文名 → 英文名（用于英文界面；未收录标签保持中文原名）
    const LUOGU_TAG_EN = {
        // —— 算法 ——
        '语言入门': 'Language Basics', '模拟': 'Simulation', '字符串': 'Strings',
        '动态规划 DP': 'Dynamic Programming', '搜索': 'Search', '数学': 'Math',
        '图论': 'Graph Theory', '贪心': 'Greedy', '计算几何': 'Computational Geometry',
        '暴力数据结构': 'Brute-force Data Structures', '高精度': 'Big Integers',
        '树形数据结构': 'Tree Data Structures', '递推': 'Recurrence', '博弈论': 'Game Theory',
        '莫队': "Mo's Algorithm", '线段树': 'Segment Tree', '倍增': 'Binary Lifting',
        '线性数据结构': 'Linear Data Structures', '二分': 'Binary Search',
        '并查集': 'DSU (Union-Find)', '点分治': 'Centroid Decomposition',
        '平衡树': 'Balanced Tree', '堆': 'Heap', '树状数组': 'Fenwick Tree',
        '递归': 'Recursion', '树上启发式合并': 'DSU on Tree', '单调队列': 'Monotonic Queue',
        '矩阵树定理': 'Matrix Tree Theorem', '颜色段均摊（珂朵莉树 ODT）': 'ODT (Chtholly Tree)',
        '原根': 'Primitive Root', '三分': 'Ternary Search',
        'Kruskal 重构树': 'Kruskal Reconstruction Tree', '多项式': 'Polynomials',
        '矩阵运算': 'Matrix Operations', '数论': 'Number Theory', '离散化': 'Discretization',
        '网络流': 'Network Flow', '后缀自动机 SAM': 'Suffix Automaton (SAM)',
        '枚举': 'Enumeration', '分治': 'Divide and Conquer', '排序': 'Sorting',
        '信息论': 'Information Theory', '剪枝': 'Pruning', '记忆化搜索': 'Memoized Search',
        '启发式搜索': 'Heuristic Search', '迭代加深搜索': 'Iterative Deepening Search',
        '模拟退火': 'Simulated Annealing', '随机调整': 'Random Adjustment', '遗传算法': 'Genetic Algorithm',
        '背包 DP': 'Knapsack DP', '数位 DP': 'Digit DP', '区间 DP': 'Interval DP',
        '动态规划优化': 'DP Optimization', '优先队列': 'Priority Queue',
        '矩阵加速': 'Matrix Exponentiation', '斜率优化': 'Convex Hull Trick',
        '状态合并': 'State Merging', '树形 DP': 'Tree DP',
        '凸完全单调性（wqs 二分）': 'WQS Binary Search', '四边形不等式': 'Quadrangle Inequality',
        '图论建模': 'Graph Modeling', '图遍历': 'Graph Traversal', '拓扑排序': 'Topological Sort',
        '最短路': 'Shortest Path', '生成树': 'Spanning Tree', '平面图': 'Planar Graph',
        '最小环': 'Minimum Cycle', '负权环': 'Negative Cycle', '连通块': 'Connected Components',
        '平面图欧拉公式': "Euler's Formula", '强连通分量': 'SCC',
        '双连通分量': 'Biconnected Components', '欧拉回路': 'Eulerian Circuit',
        '差分约束': 'Difference Constraints', '仙人掌': 'Cactus', '二分图': 'Bipartite Graph',
        '一般图的最大匹配': 'General Graph Matching', '上下界网络流': 'Bounded Network Flow',
        '最小割': 'Minimum Cut', '分数规划': 'Fractional Programming', '费用流': 'Min-Cost Flow',
        '树的遍历': 'Tree Traversal', '树的直径': 'Tree Diameter', '霍夫曼树': 'Huffman Tree',
        '可并堆': 'Mergeable Heap', '树链剖分': 'Heavy-Light Decomposition',
        '动态树 LCT': 'Link-Cut Tree', '树论': 'Tree Theory', '树套树': 'Tree in Tree',
        '可持久化线段树': 'Persistent Segment Tree', '可持久化': 'Persistent',
        '素数判断': 'Primality Test', '扩展欧几里德算法': 'Extended Euclidean Algorithm',
        '不定方程': 'Diophantine Equation', '进制': 'Base Conversion', '群论': 'Group Theory',
        '置换': 'Permutation', '虚树': 'Virtual Tree', '莫比乌斯反演': 'Möbius Inversion',
        '组合数学': 'Combinatorics', '排列组合': 'Permutations & Combinations',
        '前缀和': 'Prefix Sum', '二项式定理': 'Binomial Theorem', '康托展开': 'Cantor Expansion',
        '鸽笼原理': 'Pigeonhole Principle', '容斥原理': 'Inclusion-Exclusion',
        'Catalan 数': 'Catalan Number', 'Stirling 数': 'Stirling Number',
        'A*  算法': 'A* Algorithm', '生成函数': 'Generating Functions',
        '线性规划': 'Linear Programming', '概率论': 'Probability Theory', '期望': 'Expectation',
        '线性代数': 'Linear Algebra', '矩阵乘法': 'Matrix Multiplication',
        '线性递推': 'Linear Recurrence', '高斯消元': 'Gaussian Elimination',
        '逆元': 'Modular Inverse', '线性基': 'Linear Basis', '微积分': 'Calculus',
        '导数': 'Derivative', '积分': 'Integral', '定积分': 'Definite Integral',
        '三维计算几何': '3D Computational Geometry', '级数': 'Series', '向量': 'Vector',
        '栈': 'Stack', '队列': 'Queue', '分块': 'Sqrt Decomposition', 'ST 表': 'Sparse Table',
        '凸包': 'Convex Hull', '叉积': 'Cross Product', '线段相交': 'Segment Intersection',
        '半平面交': 'Half-plane Intersection', '扫描线': 'Sweep Line', '旋转卡壳': 'Rotating Calipers',
        'AC 自动机': 'Aho-Corasick Automaton', '后缀数组 SA': 'Suffix Array (SA)',
        '后缀树': 'Suffix Tree', '有限状态自动机': 'Finite State Automaton',
        '其它技巧': 'Other Techniques', '随机化': 'Randomization', '博弈树': 'Game Tree',
        '位运算': 'Bit Manipulation', '整体二分': 'Parallel Binary Search', '构造': 'Constructive',
        '基环树': 'Functional Graph', '轮廓线 DP': 'Plug DP', '差分': 'Difference Array',
        '双指针 two-pointer': 'Two Pointers', '圆方树': 'Block-Cut Tree',
        '顺序结构': 'Sequential Structure', '分支结构': 'Branching Structure', '循环结构': 'Loops',
        '数组': 'Array', '字符串（入门）': 'Strings (Beginner)', '结构体': 'Struct',
        '函数与递归': 'Functions & Recursion', '链表': 'Linked List', '笛卡尔树': 'Cartesian Tree',
        '拟阵': 'Matroid', 'Nim 积': 'Nim Product', '根号分治': 'Sqrt Decomposition',
        '拉格朗日反演': 'Lagrange Inversion', '模拟费用流': 'Simulated Cost Flow',
        '分散层叠': 'Fractional Cascading', '均摊分析': 'Amortized Analysis',
        '分类讨论': 'Case Analysis', '李超线段树': 'Li Chao Segment Tree',
        '线段树合并': 'Segment Tree Merging', '动态树分治': 'Dynamic Tree Divide & Conquer',
        '单调栈': 'Monotonic Stack', '杨表': 'Young Tableau', '类欧几里得算法': 'Euclidean-like Algorithm',
        '梯度下降法': 'Gradient Descent', '调和级数': 'Harmonic Series',
        '拉格朗日乘数法': 'Lagrange Multipliers', '近似算法': 'Approximation Algorithms',
        '欧拉降幂': 'Euler Power Reduction', '集合幂级数，子集卷积': 'Subset Convolution',
        '拉格朗日插值法': 'Lagrange Interpolation', '动态 DP': 'Dynamic DP', '线性 DP': 'Linear DP',
        'SG 函数': 'Sprague-Grundy Function', '线段树分治': 'Segment Tree Divide & Conquer',
        '离线处理': 'Offline Processing', '整除分块': 'Integer Division Decomposition',
        '极角排序': 'Polar Angle Sorting', '弦图': 'Chordal Graph', '二次剩余': 'Quadratic Residue',
        '行列式': 'Determinant', '杜教筛': "Du's Sieve", '欧拉函数': 'Euler Totient Function',
        '决策单调性': 'Decision Monotonicity', '状压 DP': 'Bitmask DP', '特征值': 'Eigenvalue',
        '组合优化': 'Combinatorial Optimization', '整数规划': 'Integer Programming',
        '原始对偶': 'Primal-Dual', '最大流最小割定理': 'Max-Flow Min-Cut Theorem',
        '全局平衡二叉树': 'Global Balanced Binary Tree', '哈希表': 'Hash Table',
        'Z 函数': 'Z-function', '线性筛法': 'Linear Sieve', 'Floyd 算法': 'Floyd Algorithm',
        '启发式合并': 'Small-to-Large Merging', '单位根反演': 'Root of Unity Filter',
        '平面几何': 'Plane Geometry', '树的重心': 'Tree Centroid', '保序回归': 'Isotonic Regression',
        '后缀平衡树': 'Suffix Balanced Tree', '整体转移': 'Global Transition',
        '反悔贪心': 'Greedy with Repentance', '广义串并联图': 'Series-Parallel Graph',
        '二区间合并（猫树分治）': 'Cat Tree Divide & Conquer',
        '亚线性快速求和算法': 'Sublinear Summation',
        // —— 特殊题目 ——
        '交互题': 'Interactive', '提交答案': 'Output Only', 'O2优化': 'O2 Optimization', '通信题': 'Communication',
        // —— 区域 ——
        '重庆': 'Chongqing', '四川': 'Sichuan', '河南': 'Henan', '浙江': 'Zhejiang', '上海': 'Shanghai',
        '福建': 'Fujian', '江苏': 'Jiangsu', '安徽': 'Anhui', '湖南': 'Hunan', '北京': 'Beijing',
        '河北': 'Hebei', '广东': 'Guangdong', '山东': 'Shandong', '吉林': 'Jilin', '山西': 'Shanxi',
        '江西': 'Jiangxi', '贵州': 'Guizhou', '广西': 'Guangxi', '陕西': 'Shaanxi', '辽宁': 'Liaoning',
        '云南': 'Yunnan', '天津': 'Tianjin', '湖北': 'Hubei', '黑龙江': 'Heilongjiang', '海南': 'Hainan',
        '甘肃': 'Gansu', '青海': 'Qinghai', '台湾': 'Taiwan', '内蒙古': 'Inner Mongolia', '西藏': 'Tibet',
        '宁夏': 'Ningxia', '新疆': 'Xinjiang', '香港': 'Hong Kong', '澳门': 'Macau',
        '济南': 'Jinan', '南京': 'Nanjing', '青岛': 'Qingdao', '杭州': 'Hangzhou', '昆明': 'Kunming',
        '西安': "Xi'an", '哈尔滨': 'Harbin', '成都': 'Chengdu', '首尔': 'Seoul', '横浜': 'Yokohama',
        '雅加达': 'Jakarta', '国内省市': 'Domestic Provinces', '国内赛站': 'Domestic Sites',
        '国际赛区': 'International Sites',
        // —— 来源 ——
        '各省省选': 'Provincial Selection', '集训队互测': 'Team Mutual Tests',
        '福建省历届夏令营': 'Fujian Summer Camp', '洛谷原创': 'Luogu Original',
        'NOIP 普及组': 'NOIP Popularization Group', 'NOIP 提高组': 'NOIP Improvement Group',
        'NOI 导刊': 'NOI Guide', '洛谷月赛': 'Luogu Monthly Contest', '洛谷比赛': 'Luogu Contest',
        '语言月赛': 'Language Monthly', '蓝桥杯国赛': 'Blue Bridge Cup National',
        '蓝桥杯省赛': 'Blue Bridge Cup Provincial', '蓝桥杯青少年组': 'Blue Bridge Cup Youth',
        '省赛/邀请赛': 'Provincial/Invitational', '传智杯': 'Chuanzhi Cup',
        '经典套题': 'Classic Problem Sets', '国际知名赛事': 'International Contests',
        '大学竞赛': 'University Contests', '其他竞赛': 'Other Contests', '高校校赛': 'University Contests',
        '信息与未来': 'Information & Future', '科创活动': 'Innovation Activities',
        '小学活动': 'Primary Activities', '初中活动': 'Junior High Activities',
        '科大国创杯': 'USTC Innovation Cup', '梦熊比赛': 'Mengxiong Contest',
        '模板题': 'Template Problems', '入门赛': 'Beginner Contest',
        '网络流与线性规划 24 题': 'Network Flow 24 Problems',
        'CSP-S 提高级': 'CSP-S Senior', 'CSP-J 入门级': 'CSP-J Junior', 'CSP-X 小学组': 'CSP-X Primary',
        'CTT（清华集训/北大集训）': 'CTT (THU/PKU Camp)', 'POI（波兰）': 'POI (Poland)',
        'CCO（加拿大）': 'CCO (Canada)', 'CCC（加拿大）': 'CCC (Canada)', 'CEOI（中欧）': 'CEOI (Central Europe)',
        'eJOI（欧洲）': 'eJOI (Europe)', 'COCI（克罗地亚）': 'COCI (Croatia)', 'BalticOI（波罗的海）': 'BalticOI (Baltic)',
        'JOI（日本）': 'JOI (Japan)', 'PA（波兰）': 'PA (Poland)', 'ROI（俄罗斯）': 'ROI (Russia)',
        'EGOI（欧洲/女生）': 'EGOI (Europe/Girls)', 'NOI 系列赛事': 'NOI Series',
        'NOISG（新加坡）': 'NOISG (Singapore)', 'NordicOI（北欧）': 'NordicOI (Nordic)',
        'BalkanOI（巴尔干半岛）': 'BalkanOI (Balkans)', 'KOI（韩国）': 'KOI (Korea)',
        'RMI（罗马尼亚）': 'RMI (Romania)', 'COI（克罗地亚）': 'COI (Croatia)', 'ROIR（俄罗斯）': 'ROIR (Russia)',
        'INOI（伊朗）': 'INOI (Iran)', 'UOI（乌克兰）': 'UOI (Ukraine)', 'JOISC/JOIST（日本）': 'JOISC/JOIST (Japan)',
        'COTS（克罗地亚）': 'COTS (Croatia)', 'PO（瑞典）': 'PO (Sweden)', 'MCC/MCO（马来西亚）': 'MCC/MCO (Malaysia)',
        'KTSC（韩国）': 'KTSC (Korea)', 'IATI（保加利亚/东欧）': 'IATI (Bulgaria/Eastern Europe)',
        // —— 其他/分类 ——
        '算法': 'Algorithms', '数据结构': 'Data Structures', '来源': 'Source', '时间': 'Time',
        '高级数据结构': 'Advanced Data Structures', '地区': 'Region', '特殊题目': 'Special Problems',
        '快速排序': 'Quicksort', '堆排序': 'Heapsort', '希尔排序': 'Shell Sort',
        '查找算法': 'Search Algorithms', '顺序查找': 'Linear Search', '环形 dp': 'Circular DP',
        '多维状态': 'Multi-dimensional State', '邻接矩阵': 'Adjacency Matrix', '邻接表': 'Adjacency List',
        '生成树的另类算法': 'Alternative Spanning Tree Algorithms', '次小生成树': 'Second MST',
        '特殊生成树': 'Special Spanning Trees', '匈牙利算法': 'Hungarian Algorithm',
        '带权二分图匹配': 'Weighted Bipartite Matching', '稳定婚姻系统': 'Stable Marriage',
        '闭合图': 'Closure Graph', '最小点权覆盖集': 'Min-weight Vertex Cover',
        '最大点权独立集': 'Max-weight Independent Set', '最大密度子图': 'Maximum Density Subgraph',
        '最短路增广费用流': 'Shortest Path Cost Flow', '最小费用可行流': 'Min-cost Feasible Flow',
        '树上距离': 'Tree Distance', '节点到根的距离': 'Distance to Root', '节点间的距离': 'Distance between Nodes',
        '斜堆': 'Skew Heap', '二项堆': 'Binomial Heap', '静态排序树': 'Static Sorting Tree',
        '替罪羊树': 'Scapegoat Tree', '二维线段树': '2D Segment Tree', '矩形树': 'Rectangle Tree',
        '动态树': 'Dynamic Tree', '袋与球问题': 'Balls & Bins', '简单概率': 'Basic Probability',
        '异或方程组': 'XOR Equations', '基本数组': 'Basic Arrays', '最近点对': 'Closest Pair',
        '简单密码学': 'Basic Cryptography', '随机算法': 'Randomized Algorithms',
        '概率生成函数': 'Probability Generating Functions', '半正定规划': 'Semidefinite Programming'
    };

    let tagMapCache = null;   // 内存缓存 {id: {name, type}}
    let tagMapPromise = null; // 进行中的请求（防并发重复请求）

    // 获取标签 ID → {name, type} 映射（内存缓存 + GM 存储 7 天）
    async function fetchTagMap() {
        if (tagMapCache) return tagMapCache;
        // 先尝试从 GM 存储读取缓存（ver=2 为新格式：值为 {name,type}）
        try {
            const saved = GM_getValue(TAG_MAP_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                if (data && data.ver === 2 && data.ts && (Date.now() - data.ts) < TAG_MAP_TTL && data.map) {
                    tagMapCache = data.map;
                    return tagMapCache;
                }
            }
        } catch (e) { /* ignore */ }
        if (tagMapPromise) return tagMapPromise;
        tagMapPromise = (async () => {
            const map = {};
            try {
                const html = await luoguGet('https://www.luogu.com.cn/_lfe/tags');
                const data = JSON.parse(html);
                (data.tags || []).forEach(t => {
                    if (t && typeof t.id === 'number' && t.name) {
                        map[t.id] = {
                            name: t.name,
                            en: LUOGU_TAG_EN[t.name] || t.name,
                            type: typeof t.type === 'number' ? t.type : 6
                        };
                    }
                });
                try { GM_setValue(TAG_MAP_KEY, JSON.stringify({ ts: Date.now(), ver: 2, map })); } catch (e) { /* ignore */ }
            } catch (e) {
                console.warn('[做题计划] 获取洛谷标签映射失败，本次不附加标签:', e);
                // 失败时不缓存，下次再试；返回空映射，不影响加入流程
            }
            tagMapCache = map;
            return map;
        })();
        try { return await tagMapPromise; } finally { tagMapPromise = null; }
    }

    // 从洛谷响应解析标签（ID 数组 → 名称，去重，按分类排序，最多 6 个）
    async function parseLuoguTags(html) {
        const src = String(html);
        // 提取 "tags":[1,3] 中的 ID 数组
        const ids = [];
        const jm = src.match(/"tags"\s*:\s*\[([\s\S]*?)\]/);
        if (jm) {
            jm[1].replace(/-?\d+/g, n => { ids.push(parseInt(n, 10)); return n; });
        }
        const tags = []; // {name, type}
        const seen = new Set();
        if (ids.length) {
            const map = await fetchTagMap();
            ids.forEach(id => {
                const info = map[id];
                const name = info && info.name ? info.name : null;
                if (name && !seen.has(name)) {
                    seen.add(name);
                    tags.push({ name, en: info.en, type: info.type });
                }
            });
        }
        // 兜底：链接文本解析（兼容老版页面结构）——无类型信息，归入「其他」最后展示
        if (!tags.length) {
            const re = /<a[^>]*href="[^"]*\/problem\/list\?(?:tag|keyword)=[^"]*"[^>]*>([^<]{1,20})<\/a>/gi;
            let m;
            while ((m = re.exec(src)) !== null) {
                const t = decodeHTML(m[1]).trim();
                if (t && t !== '标签' && t !== '查看题解' && !seen.has(t)) { seen.add(t); tags.push({ name: t, en: t, type: 6 }); }
            }
        }
        // 按分类顺序排序：来源 → 时间 → 区域 → 算法 → 特殊题目 → 其他
        tags.sort((a, b) => tagTypeSortKey(a.type) - tagTypeSortKey(b.type));
        return tags.map(x => (currentLang === 'en' ? x.en : x.name)).slice(0, 6);
    }

    // 标签数组 → 备注格式：[tag1];[tag2];[tag3]
    function formatTags(tags) {
        return (tags || []).map(t => '[' + t + ']').join(';');
    }

    // 合并标签到备注：无备注直接写标签，有备注追加在新行
    function mergeTagsToNotes(existingNotes, tags) {
        const tagStr = formatTags(tags);
        if (!tagStr) return existingNotes || '';
        return existingNotes ? existingNotes + '\n' + tagStr : tagStr;
    }

    // 从洛谷响应解析题名（<title>）
    function parseLuoguTitle(html, pid) {
        const m = String(html).match(/<title>([\s\S]*?)<\/title>/i);
        if (!m) return '';
        return cleanLuoguTitle(decodeHTML(m[1]), pid);
    }

    // GM_xmlhttpRequest GET 封装（headers 可选：洛谷新版接口需 x-lentille-request: content-only 才返回 JSON）
    function luoguGet(url, headers) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: headers || {},
                timeout: 12000,
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error(t('err.luoguStatus', { s: res.status }))); return; }
                    resolve(res.responseText);
                },
                onerror: () => reject(new Error(t('err.network'))),
                ontimeout: () => reject(new Error(t('err.timeout')))
            });
        });
    }

    // CF API GET 封装（codeforces.com/api/*）
    function cfGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 12000,
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error(t('err.cfFail') + ' (' + res.status + ')')); return; }
                    resolve(res.responseText);
                },
                onerror: () => reject(new Error(t('err.network'))),
                ontimeout: () => reject(new Error(t('err.timeout')))
            });
        });
    }

    // 获取 CF 题目信息（原生标签 + 难度评分 rating）
    // 会话级内存缓存：同一题目重复加入/批量导入时不再重复请求
    const cfInfoCache = new Map(); // 'contest/index' -> { tags, rating }
    async function fetchCFInfo(contest, index) {
        const cacheKey = contest + '/' + index;
        const cached = cfInfoCache.get(cacheKey);
        if (cached) return cached;
        const url = 'https://codeforces.com/api/contest.standings?contestId=' + encodeURIComponent(contest) + '&from=1&count=1';
        const json = await cfGet(url);
        const data = JSON.parse(json);
        if (data.status !== 'OK' || !data.result || !Array.isArray(data.result.problems)) {
            throw new Error(t('err.cfFail'));
        }
        const p = data.result.problems.find(x => String(x.index) === String(index));
        const result = p
            ? {
                tags: Array.isArray(p.tags) ? p.tags.slice() : [],
                rating: (typeof p.rating === 'number' && p.rating > 0) ? p.rating : null
            }
            : { tags: [], rating: null };
        cfInfoCache.set(cacheKey, result);
        return result;
    }

    // ==================== 洛谷本地题库缓存 ====================
    // 思路（参考洛谷插件 8tmw68af）：一次性下载洛谷公开题库 latest.ndjson.gz，
    // 解压提取 {pid, title, difficulty, tags} 存 GM 存储（跨站可用）。
    // 之后 fetchLuoguInfo 优先查本地库，命中则零请求；3 天过期后台静默更新。
    // 效果：批量导入 100 题从「100 次页面请求」降为「0 次」，彻底规避异常访问判定。

    const LUOGU_DB_KEY = 'problemPlanner_luoguDb';
    const LUOGU_DB_TTL = 3 * 24 * 3600 * 1000; // 本地题库 3 天过期（后台更新）
    const LUOGU_DB_URL = 'https://cdn.luogu.com.cn/problemset-open/latest.ndjson.gz';
    const LUOGU_REQ_MIN_GAP = 400; // 洛谷网络兜底请求最小间隔（毫秒）

    let luoguDb = null;            // 内存 Map：pid -> { title, difficulty, tags }
    let luoguDbRecords = null;     // 紧凑数组（持久化源）：[pid, title, difficulty, tags]
    let luoguDbTs = 0;             // 本地库下载时间戳
    let luoguDbPromise = null;     // 加载/下载中的 Promise（防并发重复下载）
    let luoguDbUpdateStarted = false; // 后台更新是否已调度
    let luoguDbSaveTimer = null;   // 增量合并后的延迟保存定时器
    let lastLuoguReqTime = 0;      // 上次洛谷页面请求时间（限速用）

    // HTML 实体解码（纯字符串实现，避免 2 万条数据逐个走 DOM）
    function decodeHtmlEntities(str) {
        return String(str)
            .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
            .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
    }

    // gzip 解压：优先原生 DecompressionStream，不可用时动态加载 pako
    function ensureGunzip() {
        if (typeof DecompressionStream !== 'undefined') return Promise.resolve();
        return new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
            s.onload = () => resolve();
            s.onerror = () => resolve(); // 失败也继续，gunzipText 内会抛错
            document.head.appendChild(s);
        });
    }

    async function gunzipText(raw) {
        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
            return await new Response(stream).text();
        }
        await ensureGunzip();
        const pako = window.pako || (typeof unsafeWindow !== 'undefined' ? unsafeWindow.pako : null);
        if (!pako) throw new Error('gunzip unavailable');
        return pako.ungzip(new Uint8Array(raw), { to: 'string' });
    }

    // 下载公开题库（一次请求）并解析为紧凑数组
    async function fetchLuoguDbRaw() {
        const raw = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: LUOGU_DB_URL,
                responseType: 'arraybuffer',
                timeout: 60000,
                onload: (res) => (res.status === 200) ? resolve(res.response) : reject(new Error('HTTP ' + res.status)),
                onerror: () => reject(new Error('network')),
                ontimeout: () => reject(new Error('timeout'))
            });
        });
        const text = await gunzipText(raw);
        const records = [];
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            try {
                const o = JSON.parse(line);
                if (o && o.pid && typeof o.title === 'string') {
                    records.push([
                        o.pid,
                        decodeHtmlEntities(o.title),
                        (typeof o.difficulty === 'number' && o.difficulty >= 0 && o.difficulty <= DIFF_MAX) ? o.difficulty : null,
                        Array.isArray(o.tags) ? o.tags : []
                    ]);
                }
            } catch (e) { /* 单行解析失败跳过 */ }
        }
        if (!records.length) throw new Error('empty db');
        return records;
    }

    function buildDbMap(records) {
        const map = new Map();
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            map.set(r[0], { title: r[1], difficulty: r[2], tags: r[3] });
        }
        return map;
    }

    function saveLuoguDb(records, ts) {
        try {
            GM_setValue(LUOGU_DB_KEY, JSON.stringify({ ver: 1, ts: ts || Date.now(), records }));
        } catch (e) {
            console.warn('[做题计划] 本地题库写入失败（可能是存储空间不足），下次会重新下载:', e);
        }
    }

    function loadLuoguDbFromStorage() {
        try {
            const raw = GM_getValue(LUOGU_DB_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data && data.ver === 1 && Array.isArray(data.records) && data.records.length) {
                return { map: buildDbMap(data.records), records: data.records, ts: data.ts || 0 };
            }
        } catch (e) {
            console.warn('[做题计划] 本地题库读取失败:', e);
        }
        return null;
    }

    // 网络兜底请求成功后，增量沉淀进本地库（延迟 3s 合并保存，避免频繁序列化）
    function mergeIntoLuoguDb(pid, info) {
        if (!luoguDb || !luoguDbRecords || !pid) return;
        const title = info && info.title ? decodeHtmlEntities(info.title) : '';
        const difficulty = (typeof info.difficulty === 'number' && info.difficulty >= 0 && info.difficulty <= DIFF_MAX) ? info.difficulty : null;
        luoguDb.set(pid, { title, difficulty, tags: (luoguDb.get(pid) || {}).tags || [] });
        let found = false;
        for (let i = 0; i < luoguDbRecords.length; i++) {
            if (luoguDbRecords[i][0] === pid) {
                luoguDbRecords[i] = [pid, title, difficulty, (luoguDbRecords[i][3] || [])];
                found = true;
                break;
            }
        }
        if (!found) luoguDbRecords.push([pid, title, difficulty, []]);
        if (luoguDbSaveTimer) clearTimeout(luoguDbSaveTimer);
        luoguDbSaveTimer = setTimeout(() => { saveLuoguDb(luoguDbRecords, luoguDbTs); }, 3000);
    }

    // 后台静默更新本地库（不阻塞当前操作）
    function scheduleLuoguDbUpdate() {
        if (luoguDbUpdateStarted) return;
        luoguDbUpdateStarted = true;
        setTimeout(async () => {
            try {
                const records = await fetchLuoguDbRaw();
                luoguDbRecords = records;
                luoguDb = buildDbMap(records);
                luoguDbTs = Date.now();
                saveLuoguDb(records, luoguDbTs);
                console.log('[做题计划] 洛谷本地题库已更新:', records.length, '条');
            } catch (e) {
                console.warn('[做题计划] 本地题库后台更新失败，继续使用旧数据:', e);
            } finally {
                luoguDbUpdateStarted = false;
            }
        }, 2000);
    }

    // 确保本地题库可用：返回 Map（失败时返回 null，调用方走网络兜底）
    async function ensureLuoguDb() {
        if (luoguDb && luoguDbRecords) {
            if (Date.now() - luoguDbTs >= LUOGU_DB_TTL) scheduleLuoguDbUpdate();
            return luoguDb;
        }
        if (luoguDbPromise) return luoguDbPromise;
        luoguDbPromise = (async () => {
            try {
                const saved = loadLuoguDbFromStorage();
                if (saved && saved.map.size) {
                    luoguDb = saved.map;
                    luoguDbRecords = saved.records;
                    luoguDbTs = saved.ts;
                    if (Date.now() - luoguDbTs >= LUOGU_DB_TTL) scheduleLuoguDbUpdate();
                    return luoguDb;
                }
                const records = await fetchLuoguDbRaw();
                luoguDbRecords = records;
                luoguDb = buildDbMap(records);
                luoguDbTs = Date.now();
                saveLuoguDb(records, luoguDbTs);
                console.log('[做题计划] 洛谷本地题库已下载:', records.length, '条');
                return luoguDb;
            } catch (e) {
                console.warn('[做题计划] 洛谷本地题库不可用，回退逐题网络请求:', e);
                return null;
            } finally {
                luoguDbPromise = null;
            }
        })();
        return luoguDbPromise;
    }

    // 洛谷页面请求限速（网络兜底路径）：保证相邻请求间隔 ≥ LUOGU_REQ_MIN_GAP + 随机抖动
    async function luoguThrottle() {
        const wait = lastLuoguReqTime + LUOGU_REQ_MIN_GAP + Math.random() * 300 - Date.now();
        lastLuoguReqTime = Date.now() + Math.max(0, wait);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    // 获取洛谷题目信息（题名 + 难度 + 标签）：优先本地题库，命中零请求
    async function fetchLuoguInfo(luoguPid) {
        try {
            const db = await ensureLuoguDb();
            const hit = db && db.get(luoguPid);
            if (hit) {
                return {
                    title: hit.title || '',
                    difficulty: hit.difficulty,
                    tags: (hit.tags || []).map(name => (currentLang === 'en' ? (LUOGU_TAG_EN[name] || name) : name)).slice(0, 6)
                };
            }
        } catch (e) { /* 本地库不可用，走网络兜底 */ }
        // 网络兜底（本地库未收录的题，如 RMJ 题）：限速后请求，避免连续请求触发风控
        await luoguThrottle();
        const html = await luoguGet('https://www.luogu.com.cn/problem/' + encodeURIComponent(luoguPid) + '?_contentOnly=1');
        const difficulty = parseLuoguDifficulty(html);
        const title = parseLuoguTitle(html, luoguPid);
        if (difficulty === null && !title) {
            throw new Error(t('err.luoguMissing', { pid: luoguPid }));
        }
        const tags = await parseLuoguTags(html);
        // 增量沉淀标题与难度（tags 为语言转换后的值，不写入本地库）
        mergeIntoLuoguDb(luoguPid, { title, difficulty });
        return { title, difficulty, tags };
    }

    // ==================== 已通过题目检测 ====================

    // 从 lentille-context JSON 中提取 currentUser.uid（洛谷新版页面注入方式：
    // <script id="lentille-context" type="application/json">{"instance":...,"currentUser":{...}}</script>）
    function uidFromLentilleJson(jsonText) {
        try {
            const json = JSON.parse(jsonText);
            const cu = (json && json.currentUser) || (json && json.data && json.data.currentUser);
            if (cu && cu.uid) return String(cu.uid);
        } catch (e) { /* ignore */ }
        return null;
    }

    // DOM 兜底：从导航栏头像/用户链接提取当前用户 uid。
    // 洛谷新版登录 cookie 为 httpOnly（document.cookie 读不到）、SSR 数据不含 currentUser，
    // 但登录态导航栏必有用户头像（usericon/{uid}.png）与 /user/{uid} 链接。
    function uidFromDom() {
        try {
            // 未登录标志：导航栏存在登录/注册入口 → 直接判定未登录
            const loginBtn = document.querySelector('a[href*="auth/login"], [href="/auth/login"]');
            if (loginBtn) return null;
            const avatarUids = [];
            const linkUids = [];
            document.querySelectorAll('img[src*="usericon"]').forEach(img => {
                const m = String(img.getAttribute('src') || '').match(/usericon\/(\d+)\./);
                if (m && m[1] !== '1') avatarUids.push(m[1]); // 排除未登录占位头像 uid=1
            });
            document.querySelectorAll('a[href^="/user/"]').forEach(a => {
                const m = (a.getAttribute('href') || '').match(/^\/user\/(\d+)/);
                if (m && m[1] !== '1') linkUids.push(m[1]);
            });
            // 头像 uid 与链接 uid 一致 → 高置信
            if (avatarUids.length && linkUids.includes(avatarUids[0])) return avatarUids[0];
            // 链接中出现 ≥2 次的 uid（导航栏多处用户链接）
            if (linkUids.length) {
                const counts = {};
                linkUids.forEach(u => { counts[u] = (counts[u] || 0) + 1; });
                let best = null, bestC = 0;
                Object.keys(counts).forEach(u => { if (counts[u] > bestC) { best = u; bestC = counts[u]; } });
                if (bestC >= 2) return best;
            }
            // 仅头像场景（题单页等）
            if (avatarUids.length) return avatarUids[0];
        } catch (e) { /* ignore */ }
        return null;
    }

    // 当前登录洛谷用户 uid：
    // 1) 页面 lentille-context JSON（新版 SSR 数据，登录态时含 currentUser）
    // 2) DOM 头像/用户链接（导航栏，跨注入方式失效时兜底）
    // 3) 页面注入 _feInjection / _feInstance（旧版兜底）
    // 4) cookie _uid（旧版兜底）
    function getLuoguUid() {
        try {
            const el = document.getElementById('lentille-context');
            if (el) {
                const uid = uidFromLentilleJson(el.textContent);
                if (uid) return uid;
            }
        } catch (e) { /* ignore */ }
        try {
            const uid = uidFromDom();
            if (uid) return uid;
        } catch (e) { /* ignore */ }
        try {
            const fe = window._feInjection || (typeof unsafeWindow !== 'undefined' && unsafeWindow._feInjection);
            if (fe && fe.currentUser && fe.currentUser.uid) return String(fe.currentUser.uid);
        } catch (e) { /* ignore */ }
        try {
            const inst = window._feInstance || (typeof unsafeWindow !== 'undefined' && unsafeWindow._feInstance);
            if (inst && inst.currentUser && inst.currentUser.uid) return String(inst.currentUser.uid);
        } catch (e) { /* ignore */ }
        const m = document.cookie.match(/(?:^|;\s*)_uid=(\d+)/);
        if (m) return m[1];
        return null;
    }

    // uid 缓存（跨站场景下避免每次导入都请求洛谷页面）
    let cachedUid = null;
    let cachedUidTime = 0;
    const UID_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

    // 通过 GM_xmlhttpRequest 请求洛谷页面 HTML（自动携带洛谷登录 cookie），
    // 从服务端渲染的 currentUser 数据中解析 uid。跨站/页面注入失败时兜底。
    async function fetchUidFromLuoguPage() {
        if (cachedUid && Date.now() - cachedUidTime < UID_CACHE_TTL) return cachedUid;
        const candidates = [];
        const host = location.hostname.toLowerCase();
        if (host === 'www.luogu.com.cn' || host === 'luogu.com.cn') {
            // 当前就在洛谷页面：请求当前页面自身，服务端渲染必含登录态数据
            candidates.push(location.origin + location.pathname);
        }
        candidates.push('https://www.luogu.com.cn/');
        candidates.push('https://luogu.com.cn/');
        for (const url of candidates) {
            try {
                const raw = await luoguGet(url);
                const src = String(raw);
                // 主路径：解析 lentille-context JSON（洛谷新版 SSR 注入）
                const lc = src.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
                if (lc) {
                    const uid = uidFromLentilleJson(lc[1]);
                    if (uid) {
                        cachedUid = uid;
                        cachedUidTime = Date.now();
                        return cachedUid;
                    }
                }
                // 兜底：兼容 JSON（带引号）与 JS 字面量（不带引号）两种注入形式
                const cu = src.search(/currentUser["']?\s*:\s*\{/);
                if (cu !== -1) {
                    const seg = src.substring(cu, cu + 3000);
                    const um = seg.match(/["']?uid["']?\s*:\s*(\d+)/);
                    if (um) {
                        cachedUid = um[1];
                        cachedUidTime = Date.now();
                        return cachedUid;
                    }
                }
            } catch (e) { /* 尝试下一个候选 */ }
        }
        return null;
    }

    // 最近一次 uid 检测诊断（供失败提示展示，不泄露敏感值）
    let lastUidDiag = '';

    // 已通过集合缓存：同一 uid 30 分钟内复用，避免每次导入都请求用户页。
    // 洛谷通过列表本身刷新也有延迟，30 分钟窗口不影响实际使用。
    let passedCache = { uid: null, set: null, time: 0 };
    const PASSED_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

    // 获取已通过 pid 集合（一次请求拿到全部；返回 null 表示确实无法确定登录状态）
    async function fetchPassedPids() {
        const parts = [];
        const host = location.hostname.toLowerCase();
        parts.push('页面=' + (host.indexOf('luogu.com.cn') !== -1 ? host : host));
        let uid = getLuoguUid();
        parts.push('注入=' + (uid ? 'ok' : '无'));
        if (!uid) {
            uid = await fetchUidFromLuoguPage();
            parts.push('HTML解析=' + (uid ? 'ok' : '无'));
        }
        parts.push('cookie=' + (document.cookie.match(/(?:^|;\s*)_uid=/) ? '有' : '无'));
        lastUidDiag = parts.join(' ');
        if (!uid) return null;
        // 命中缓存直接返回（uid 匹配且未过期）
        if (passedCache.uid === uid && passedCache.set && (Date.now() - passedCache.time) < PASSED_CACHE_TTL) {
            return passedCache.set;
        }
        // 新版接口需 x-lentille-request 头才返回 JSON（响应结构为 {data:{passed:[...]}}）
        const raw = await luoguGet(
            'https://www.luogu.com.cn/user/' + encodeURIComponent(uid) + '/practice?_contentOnly=1',
            { 'x-lentille-request': 'content-only', 'referer': 'https://www.luogu.com.cn/' }
        );
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            throw new Error(t('err.passedFormat'));
        }
        // 兼容新版 LentilleDataResponse（data）与旧版 DataResponse（currentData）
        const d = (data && (data.data || data.currentData)) || {};
        const passed = Array.isArray(d.passed) ? d.passed : [];
        const set = new Set(passed.map(x => x && x.pid).filter(Boolean));
        passedCache = { uid, set, time: Date.now() };
        return set;
    }

    // 一键加入（从当前 OJ 页面）
    // ojAddTags 为全局标签开关：true 时自动获取标签写入备注
    async function addFromOJPage(btn) {
        const det = detectOJ();
        if (!det) return;
        try {
            if (btn) { btn.disabled = true; btn.textContent = t('oj.fetching'); }
            const luoguPid = det.luoguPid;
            const pageUrl = det.pageUrl || location.href;
            if (problems.some(p => p.url === pageUrl)) {
                showToast(t('toast.alreadyInPlan'), '#F39C11');
                return;
            }
            if (archive.some(a => a.url === pageUrl)) {
                showToast(t('toast.alreadyDone'), '#F39C11');
                return;
            }
            let name = ojPageTitle(det) || '';
            let difficulty = null;
            let tags = [];
            if (luoguPid) {
                try {
                    const info = await fetchLuoguInfo(luoguPid);
                    if (!name) name = info.title;
                    difficulty = info.difficulty;
                    tags = info.tags || [];
                } catch (err) {
                    alert(t('alert.fetchFail', { e: err.message }));
                    return;
                }
            }
            // CF 题目：改用 CF 原生标签 + 难度评分（*rating），覆盖洛谷 RMJ 标签
            if (det.site === 'codeforces' && ojAddTags && det.contest && det.index) {
                try {
                    const cf = await fetchCFInfo(det.contest, det.index);
                    const cfTags = [];
                    if (cf.rating) cfTags.push('*' + cf.rating);
                    cfTags.push.apply(cfTags, cf.tags);
                    if (cfTags.length) tags = cfTags;
                } catch (e) {
                    console.warn('[做题计划] 获取 CF 标签失败，沿用已有标签:', e);
                }
            }
            // 显示名采用「题号 + 题目名」格式（如 P1001 A+B Problem / CF2081G1 题目名）
            const displayName = ((luoguPid ? luoguPid + ' ' : '') + (name || '')).trim();
            // 颜色即难度：洛谷题用难度色，非洛谷题用用户选择的颜色
            const color = difficulty !== null && difficulty !== undefined
                ? difficultyColor(difficulty)
                : selectedColor;
            // 标签开关开启时，按 [tag1];[tag2];[tag3] 格式写入备注
            const notes = ojAddTags ? mergeTagsToNotes('', tags) : '';
            problems.push(normalizeProblem({
                url: pageUrl,
                name: displayName || luoguPid || t('misc.unnamedProblem'),
                color,
                notes,
                addedDate: new Date().toISOString(),
                difficulty
            }));
            saveData();
            if (btn) { btn.textContent = t('oj.joined'); btn.classList.add('ok'); }
            let msg = (difficulty !== null && difficulty !== undefined)
                ? t('toast.addedDiff', { d: difficultyLabel(difficulty) })
                : t('toast.added');
            if (notes) msg += t('toast.addedTags', { n: tags.length });
            showToast(msg, '#52C41A');
        } catch (err) {
            alert(t('alert.joinFail', { e: err.message }));
        } finally {
            if (btn) {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('ok');
                    btn.textContent = t('oj.addBtn');
                }, 1500);
            }
        }
    }

    // OJ 悬浮按钮注入（轮询检测，兼容洛谷 PJAX 页面切换）
    let ojBtn = null;
    let ojInjectedKey = '';
    let ojAddTags = false; // 「一键加入」标签开关状态
    function ensureOJButton() {
        const det = detectOJ();
        const key = det ? (det.site + '|' + (det.luoguPid || '') + '|' + (det.pageUrl || '')) : '';
        if (key === ojInjectedKey) return;
        ojInjectedKey = key;
        if (ojBtn) { ojBtn.remove(); ojBtn = null; }
        if (!det) return;
        // 容器：主按钮 + 标签开关
        ojBtn = document.createElement('div');
        ojBtn.className = 'pp-oj-group';
        const main = document.createElement('button');
        main.className = 'pp-oj-btn';
        main.textContent = t('oj.addBtn');
        main.title = t('oj.addBtnTitle');
        main.addEventListener('click', () => addFromOJPage(main));
        const tagToggle = document.createElement('button');
        tagToggle.className = 'pp-oj-tag-toggle';
        tagToggle.textContent = t('oj.tagToggle');
        tagToggle.title = t('oj.tagToggleTitle', { s: t('oj.off') });
        const syncTagUI = () => {
            tagToggle.classList.toggle('on', ojAddTags);
            tagToggle.textContent = ojAddTags ? t('oj.tagToggleOn') : t('oj.tagToggle');
            tagToggle.title = t('oj.tagToggleTitle', { s: ojAddTags ? t('oj.on') : t('oj.off') });
        };
        syncTagUI();
        tagToggle.addEventListener('click', (e) => {
            e.preventDefault();
            ojAddTags = !ojAddTags;
            syncTagUI();
            showToast(ojAddTags ? t('toast.tagsOn') : t('toast.tagsOff'), ojAddTags ? '#52C41A' : '#9aa3bf');
        });
        ojBtn.appendChild(main);
        ojBtn.appendChild(tagToggle);
        document.body.appendChild(ojBtn);
    }
    function startOjWatch() {
        ensureOJButton();
        setInterval(ensureOJButton, 1500);
    }

    // ==================== 洛谷比赛 → 日历 ====================

    // 识别洛谷比赛详情页（/contest/{id}，排除列表等非比赛页）
    function detectContest() {
        const h = location.hostname.toLowerCase();
        if (h !== 'www.luogu.com.cn' && h !== 'luogu.com.cn') return null;
        const m = location.pathname.match(/^\/contest\/(\d+)(?:\/|$)/);
        if (!m) return null;
        return { id: m[1], pageUrl: 'https://' + h + '/contest/' + m[1] };
    }

    // 从页面 lentille-context 读取比赛数据（名称 + 开始/结束时间戳）
    function contestDataFromPage() {
        try {
            const el = document.getElementById('lentille-context');
            if (!el) return null;
            const json = JSON.parse(el.textContent);
            const c = json && json.data && json.data.contest;
            if (!c || !c.name) return null;
            return { id: c.id, name: c.name, startTime: c.startTime, endTime: c.endTime };
        } catch (e) { return null; }
    }

    // 一键把当前比赛加入日历（按比赛链接去重）
    async function addContestToCalendar(btn) {
        const det = detectContest();
        if (!det) return;
        const c = contestDataFromPage();
        if (!c) { showToast(t('contest.fetchFail'), '#F39C11'); return; }
        const url = det.pageUrl;
        if (memos.some(m => m.link === url)) { showToast(t('contest.alreadyAdded'), '#F39C11'); return; }
        const d = new Date((c.startTime || 0) * 1000);
        const date = dateKey(d);
        const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        memos.push(normalizeMemo({
            text: c.name, link: url, date, time,
            createdAt: new Date().toISOString()
        }));
        saveMemos();
        updateMemoCount();
        if (btn) {
            btn.textContent = t('contest.addedOk');
            btn.classList.add('ok');
            setTimeout(() => { btn.classList.remove('ok'); btn.textContent = t('contest.addBtn'); }, 1500);
        }
        showToast(t('toast.contestAdded', { name: c.name }), '#52C41A');
    }

    // 比赛页悬浮按钮注入（轮询检测，兼容洛谷 PJAX 页面切换）
    let contestBtn = null;
    let contestInjectedKey = '';

    function ensureContestButton() {
        const det = detectContest();
        const key = det ? ('contest|' + det.id) : '';
        if (key === contestInjectedKey) return;
        contestInjectedKey = key;
        if (contestBtn) { contestBtn.remove(); contestBtn = null; }
        if (!det) return;
        contestBtn = document.createElement('div');
        contestBtn.className = 'pp-oj-group';
        const main = document.createElement('button');
        main.className = 'pp-oj-btn';
        main.textContent = t('contest.addBtn');
        main.title = t('contest.addBtnTitle');
        main.addEventListener('click', () => addContestToCalendar(main));
        contestBtn.appendChild(main);
        document.body.appendChild(contestBtn);
    }

    function startContestWatch() {
        ensureContestButton();
        setInterval(ensureContestButton, 1500);
    }

    // ==================== 洛谷题单页批量导入按钮 ====================

    let trainingBtn = null;
    let trainingBtnKey = '';

    // 批量导入共享选项（题单页按钮 / 洛谷导入面板共用）
    let importWithTags = false;  // 是否自动获取标签写入备注
    let importDiffMin = 0;       // 难度范围下限（0-8）
    let importDiffMax = DIFF_MAX; // 难度范围上限（0-8）
    let importSkipPassed = false; // 是否跳过洛谷上已通过的题目

    // 难度范围 UI 同步（select 元素 value 使用 DIFFICULTY_META 索引）
    function diffSelectOptions(selected) {
        return DIFFICULTY_META.map((m, i) =>
            '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + difficultyLabel(i) + '</option>'
        ).join('');
    }

    // 检测当前是否为洛谷题单页（/training/<id>），注入「导入整个题单」按钮 + 标签开关 + 难度范围
    function ensureTrainingButton() {
        const m = location.pathname.match(/^\/training\/(\d+)/);
        const key = m ? ('training|' + m[1]) : '';
        if (key === trainingBtnKey) return;
        trainingBtnKey = key;
        if (trainingBtn) { trainingBtn.remove(); trainingBtn = null; }
        if (!m) return;
        // 容器：主按钮 + 标签开关 + 难度范围
        trainingBtn = document.createElement('div');
        trainingBtn.className = 'pp-oj-group';

        const main = document.createElement('button');
        main.className = 'pp-oj-btn';
        main.textContent = t('training.importAll');
        main.title = t('training.importAllTitle');
        main.addEventListener('click', () => importCurrentTraining(main));

        const tagToggle = document.createElement('button');
        tagToggle.className = 'pp-oj-tag-toggle';
        tagToggle.title = t('oj.tagToggleTitle', { s: t('oj.off') });
        const syncTagUI = () => {
            tagToggle.classList.toggle('on', importWithTags);
            tagToggle.textContent = importWithTags ? t('oj.tagToggleOn') : t('oj.tagToggle');
            tagToggle.title = t('oj.tagToggleTitle', { s: importWithTags ? t('oj.on') : t('oj.off') });
        };
        syncTagUI();
        tagToggle.addEventListener('click', (e) => {
            e.preventDefault();
            importWithTags = !importWithTags;
            syncTagUI();
            syncPanelImportUI();
            showToast(importWithTags ? t('toast.tagsOn') : t('toast.tagsOff'), importWithTags ? '#52C41A' : '#9aa3bf');
        });

        // 难度范围按钮：点击展开/收起内联选择器
        const diffBtn = document.createElement('button');
        diffBtn.className = 'pp-oj-tag-toggle';
        diffBtn.textContent = t('oj.diff');
        diffBtn.title = t('oj.diffTitle');
        const diffPanel = document.createElement('div');
        diffPanel.className = 'pp-oj-diff-panel';
        diffPanel.style.display = 'none';
        diffPanel.innerHTML =
            '<div class="pp-oj-diff-row"><span>' + t('oj.diffMin') + '</span>' +
            '<select class="pp-oj-diff-min">' + diffSelectOptions(importDiffMin) + '</select></div>' +
            '<div class="pp-oj-diff-row"><span>' + t('oj.diffMax') + '</span>' +
            '<select class="pp-oj-diff-max">' + diffSelectOptions(importDiffMax) + '</select></div>';
        const syncDiffUI = () => {
            const smin = diffPanel.querySelector('.pp-oj-diff-min');
            const smax = diffPanel.querySelector('.pp-oj-diff-max');
            if (smin) smin.value = importDiffMin;
            if (smax) smax.value = importDiffMax;
            diffBtn.textContent = importDiffMin === 0 && importDiffMax === DIFF_MAX
                ? t('oj.diff')
                : t('oj.diff') + ' ' + difficultyLabel(importDiffMin) + '~' + difficultyLabel(importDiffMax);
        };
        diffBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const show = diffPanel.style.display === 'none';
            diffPanel.style.display = show ? 'block' : 'none';
            syncDiffUI();
        });
        diffPanel.addEventListener('change', (e) => {
            const min = parseInt(diffPanel.querySelector('.pp-oj-diff-min').value, 10);
            const max = parseInt(diffPanel.querySelector('.pp-oj-diff-max').value, 10);
            importDiffMin = Math.min(min, max);
            importDiffMax = Math.max(min, max);
            diffPanel.querySelector('.pp-oj-diff-min').value = importDiffMin;
            diffPanel.querySelector('.pp-oj-diff-max').value = importDiffMax;
            syncDiffUI();
            syncPanelImportUI();
        });

        // 跳过已通过开关：导入时跳过洛谷上已通过的题目
        const skipToggle = document.createElement('button');
        skipToggle.className = 'pp-oj-tag-toggle pp-oj-skip-toggle';
        skipToggle.title = t('oj.skipPassedTitle', { s: t('oj.off') });
        const syncSkipUI = () => {
            skipToggle.classList.toggle('on', importSkipPassed);
            skipToggle.textContent = importSkipPassed ? t('oj.skipPassedOn') : t('oj.skipPassed');
            skipToggle.title = t('oj.skipPassedTitle', { s: importSkipPassed ? t('oj.on') : t('oj.off') });
        };
        syncSkipUI();
        skipToggle.addEventListener('click', (e) => {
            e.preventDefault();
            importSkipPassed = !importSkipPassed;
            syncSkipUI();
            syncPanelImportUI();
            showToast(importSkipPassed ? t('toast.skipPassedOn') : t('toast.skipPassedOff'), importSkipPassed ? '#52C41A' : '#9aa3bf');
        });

        trainingBtn.appendChild(main);
        trainingBtn.appendChild(tagToggle);
        trainingBtn.appendChild(diffBtn);
        trainingBtn.appendChild(skipToggle);
        trainingBtn.appendChild(diffPanel);
        document.body.appendChild(trainingBtn);
    }

    // 洛谷导入面板的 UI 与共享选项同步（面板打开时调用）
    function syncPanelImportUI() {
        const box = panel.querySelector('#pp-luogu-panel');
        if (!box) return;
        const ck = box.querySelector('#pp-import-tags');
        const ck2 = box.querySelector('#pp-import-skip-passed');
        const smin = box.querySelector('#pp-import-diff-min');
        const smax = box.querySelector('#pp-import-diff-max');
        if (ck) ck.checked = importWithTags;
        if (ck2) ck2.checked = importSkipPassed;
        if (smin) smin.value = importDiffMin;
        if (smax) smax.value = importDiffMax;
    }

    // 从当前题单页解析并批量导入（复用 runBatchImport，进度显示在按钮上）
    async function importCurrentTraining(btn) {
        const m = location.pathname.match(/^\/training\/(\d+)/);
        if (!m) return;
        btn.disabled = true;
        btn.textContent = t('training.parsing');
        try {
            const pids = await importLuoguUrl('https://www.luogu.com.cn/training/' + m[1]);
            btn.textContent = t('training.fetching');
            const items = pids.map(pid => ({ pid, title: '' }));
            const result = await runBatchImport(items, null, (text) => {
                btn.textContent = '⏳ ' + text;
            }, { withTags: importWithTags, diffMin: importDiffMin, diffMax: importDiffMax, skipPassed: importSkipPassed });
            btn.textContent = t('training.imported', { n: result.added });
            showToast(t('toast.trainingDone', { a: result.added, s: result.skipped })
                + (result.skippedByPassed ? t('import.donePassed', { n: result.skippedByPassed }) : '')
                + (result.failures.length ? t('import.doneFail', { n: result.failures.length }) : ''), '#52C41A');
        } catch (err) {
            showToast(t('toast.trainingFail', { e: err.message }), '#FE4C61');
            btn.textContent = t('training.importAll');
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                if (btn.textContent.indexOf('✓') === -1) btn.textContent = t('training.importAll');
            }, 2000);
        }
    }

    function startTrainingWatch() {
        ensureTrainingButton();
        setInterval(ensureTrainingButton, 1500);
    }

    // ==================== 洛谷导入 ====================

    function extractPidsFromHtml(html) {
        const pids = [];
        const re = /\/problem\/([A-Za-z0-9_]+)/g;
        let m;
        while ((m = re.exec(String(html))) !== null) {
            const pid = m[1];
            if (!pids.includes(pid)) pids.push(pid);
        }
        return pids;
    }

    async function importLuoguUrl(url) {
        const m = String(url).match(/luogu\.com\.cn\/training\/(\d+)/);
        if (!m) throw new Error(t('err.onlyTraining'));
        const html = await luoguGet('https://www.luogu.com.cn/training/' + m[1] + '?_contentOnly=1');
        const pids = extractPidsFromHtml(html);
        if (pids.length === 0) throw new Error(t('err.noPids'));
        return pids;
    }

    // 主页任务计划模块提取（启发式参考 Super Luogu Task Plan #578062）
    // 返回 { items, debug }：items 为题目列表，debug 为诊断信息
    function extractHomePlanProblems() {
        const debug = [];
        const all = [...document.querySelectorAll('div, section, aside, article')];
        const candidates = all.filter(el => {
            if (!el || el.id === 'pp-panel' || el.closest('.pp-container')) return false;
            const text = String(el.innerText || el.textContent || '').replace(/\s+/g, '');
            if (!text.includes('任务计划')) return false;
            const rect = el.getBoundingClientRect();
            // 洛谷主页原生任务计划卡片：宽 120~520、高 40~500
            if (rect.width < 120 || rect.width > 520) return false;
            if (rect.height < 40 || rect.height > 500) return false;
            // 原生模块通常带「编辑」/「随机」按钮，或本身文本很短
            return text.includes('编辑') || text.includes('随机') || text.length < 260;
        });
        if (!candidates.length) {
            debug.push('未找到符合尺寸/关键词条件的「任务计划」模块（候选 0 个）');
            return { items: [], debug };
        }
        // 面积最小者最可能是内层模块
        candidates.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return ar.width * ar.height - br.width * br.height;
        });
        const target = candidates[0];
        const tr = target.getBoundingClientRect();
        debug.push('命中模块：' + (target.tagName || '') + ' 面积 ' + Math.round(tr.width) + 'x' + Math.round(tr.height)
            + '，文本 ' + (target.innerText || '').replace(/\s+/g, '').slice(0, 40) + '…');
        const out = [];
        target.querySelectorAll('a[href*="/problem/"]').forEach(a => {
            const m = (a.getAttribute('href') || '').match(/\/problem\/([A-Za-z0-9_]+)/);
            if (!m) return;
            const pid = m[1];
            const text = (a.textContent || '').trim();
            const title = text.replace(new RegExp('^' + pid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
            if (!out.some(x => x.pid === pid)) out.push({ pid, title });
        });
        if (!out.length) debug.push('命中模块内未发现 /problem/ 链接');
        return { items: out, debug };
    }

    // 批量导入（顺序请求，带进度与报错）
    // onStatus: 可选回调，每次请求前调用（progressText 为 '正在获取 i/N：Pxxxx …'）
    // opts: { withTags?: boolean, diffMin?: number, diffMax?: number, skipPassed?: boolean }
    async function runBatchImport(items, statusEl, onStatus, opts) {
        const existedActive = new Set(problems.map(p => p.url));
        const existedArchive = new Set(archive.map(a => a.url));
        const seen = new Set();
        let added = 0, skipped = 0, skippedByDiff = 0, skippedByPassed = 0;
        const failures = [];

        // 选项：withTags 是否获取标签写入备注；diffMin/diffMax 难度范围（0-8，全选时不过滤）；skipPassed 跳过洛谷已通过题目
        opts = opts || {};
        const withTags = !!opts.withTags;
        const skipPassed = !!opts.skipPassed;
        const diffMin = Number.isInteger(opts.diffMin) ? Math.max(0, Math.min(DIFF_MAX, opts.diffMin)) : 0;
        const diffMax = Number.isInteger(opts.diffMax) ? Math.max(0, Math.min(DIFF_MAX, opts.diffMax)) : DIFF_MAX;
        const allDiff = diffMin === 0 && diffMax === DIFF_MAX;

        // 跳过已通过：开启时获取当前洛谷用户的已通过 pid 集合（一次请求）
        // 未登录（返回 null）或获取失败时不中断导入，仅提示本次不跳过
        let passedSet = null;
        if (skipPassed) {
            try {
                if (onStatus) onStatus(t('import.fetchPassed'));
                else if (statusEl) statusEl.textContent = t('import.fetchPassed');
                const set = await fetchPassedPids();
                if (set === null) {
                    // 未检测到登录状态：提示（附诊断）后继续导入，本次不跳过
                    showToast(t('import.passedSkipDisabled') + ' [' + lastUidDiag + ']', '#F39C11');
                    console.debug('[做题计划][跳过已通过诊断]', {
                        host: location.hostname,
                        lentilleContext: !!document.getElementById('lentille-context'),
                        feInjection: !!(window._feInjection || (typeof unsafeWindow !== 'undefined' && unsafeWindow._feInjection)),
                        feInstance: !!(window._feInstance || (typeof unsafeWindow !== 'undefined' && unsafeWindow._feInstance)),
                        cookieUid: /(?:^|;\s*)_uid=/.test(document.cookie),
                        diag: lastUidDiag
                    });
                }
                passedSet = set;
            } catch (err) {
                showToast(t('err.passedFetch', { e: err.message }), '#F39C11');
                passedSet = null;
            }
        }

        // 预热洛谷本地题库：首次使用时一次性下载公开题库，
        // 之后逐题信息全部本地命中，不再逐题请求洛谷页面（规避异常访问判定）
        if (onStatus) onStatus(t('import.fetchDb'));
        else if (statusEl) statusEl.textContent = t('import.fetchDb');
        try {
            await ensureLuoguDb();
        } catch (e) {
            console.warn('[做题计划] 本地题库预热失败，将走网络兜底:', e);
        }

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pid = it.pid;
            const pUrl = 'https://www.luogu.com.cn/problem/' + pid;
            if (seen.has(pid)) continue;
            seen.add(pid);
            if (existedActive.has(pUrl) || existedArchive.has(pUrl)) { skipped++; continue; }
            if (passedSet && passedSet.has(pid)) { skippedByPassed++; continue; }
            const prog = t('import.fetching', { i: i + 1, n: items.length, pid: pid });
            if (onStatus) onStatus(prog);
            else if (statusEl) statusEl.textContent = prog;
            try {
                let name = it.title || '';
                let difficulty = null;
                let tags = [];
                const info = await fetchLuoguInfo(pid);
                if (!name) name = info.title;
                difficulty = info.difficulty;
                tags = info.tags || [];
                // 难度范围过滤：无难度题在全选范围时保留，指定范围时跳过
                if (!allDiff) {
                    if (difficulty === null || difficulty === undefined) { skippedByDiff++; skipped++; continue; }
                    if (difficulty < diffMin || difficulty > diffMax) { skippedByDiff++; skipped++; continue; }
                }
                // 与一键加入一致：显示名采用「题号 + 题目名」格式（如 P1001 A+B Problem）
                const displayName = ((pid ? pid + ' ' : '') + (name || '')).trim();
                // 颜色即难度：洛谷题用难度色
                const color = difficulty !== null && difficulty !== undefined
                    ? difficultyColor(difficulty)
                    : selectedColor;
                // 标签开关开启时，按 [tag1];[tag2];[tag3] 格式写入备注
                const notes = withTags ? mergeTagsToNotes('', tags) : '';
                problems.push(normalizeProblem({
                    url: pUrl,
                    name: displayName || pid,
                    color,
                    notes,
                    addedDate: new Date().toISOString(),
                    difficulty
                }));
                added++;
            } catch (err) {
                failures.push({ pid, reason: err.message });
            }
        }
        saveData();
        if (statusEl) {
            const diffNote = skippedByDiff > 0 ? t('import.doneDiff', { d: '<b>' + skippedByDiff + '</b>' }) : '';
            const passedNote = skippedByPassed > 0 ? t('import.donePassed', { n: '<b>' + skippedByPassed + '</b>' }) : '';
            if (failures.length) {
                statusEl.innerHTML = t('import.done', { a: '<b>' + added + '</b>', s: '<b>' + skipped + '</b>' }) + diffNote + passedNote
                    + t('import.doneFail', { n: '<b style="color:#e5484d">' + failures.length + '</b>' }) + '<br>'
                    + '<span style="color:#e5484d">' + t('import.failList', { list: failures.map(f => f.pid).join('、') }) + '</span>';
            } else {
                statusEl.innerHTML = t('import.done', { a: '<b>' + added + '</b>', s: '<b>' + skipped + '</b>' }) + diffNote + passedNote;
            }
        }
        renderProblems();
        return { added, skipped, skippedByDiff, skippedByPassed, failures };
    }

    // 洛谷导入 UI 绑定
    function bindLuoguImport() {
        // 初始化难度范围下拉选项（与共享选项同步）
        const diffMinSel = panel.querySelector('#pp-import-diff-min');
        const diffMaxSel = panel.querySelector('#pp-import-diff-max');
        if (diffMinSel) {
            diffMinSel.innerHTML = diffSelectOptions(importDiffMin);
            diffMinSel.addEventListener('change', () => {
                importDiffMin = parseInt(diffMinSel.value, 10);
                if (importDiffMin > importDiffMax) { importDiffMax = importDiffMin; diffMaxSel.value = importDiffMax; }
                syncPanelImportUI();
                if (trainingBtn) {
                    const db = trainingBtn.querySelector('.pp-oj-diff-min');
                    if (db) db.value = importDiffMin;
                    const db2 = trainingBtn.querySelector('.pp-oj-diff-max');
                    if (db2) db2.value = importDiffMax;
                }
            });
        }
        if (diffMaxSel) {
            diffMaxSel.innerHTML = diffSelectOptions(importDiffMax);
            diffMaxSel.addEventListener('change', () => {
                importDiffMax = parseInt(diffMaxSel.value, 10);
                if (importDiffMax < importDiffMin) { importDiffMin = importDiffMax; diffMinSel.value = importDiffMin; }
                syncPanelImportUI();
                if (trainingBtn) {
                    const db = trainingBtn.querySelector('.pp-oj-diff-min');
                    if (db) db.value = importDiffMin;
                    const db2 = trainingBtn.querySelector('.pp-oj-diff-max');
                    if (db2) db2.value = importDiffMax;
                }
            });
        }
        const tagsCk = panel.querySelector('#pp-import-tags');
        if (tagsCk) {
            tagsCk.addEventListener('change', () => {
                importWithTags = tagsCk.checked;
                if (trainingBtn) {
                    const tgl = trainingBtn.querySelector('.pp-oj-tag-toggle');
                    if (tgl) {
                        tgl.classList.toggle('on', importWithTags);
                        tgl.textContent = importWithTags ? t('oj.tagToggleOn') : t('oj.tagToggle');
                    }
                }
            });
        }
        const skipCk = panel.querySelector('#pp-import-skip-passed');
        if (skipCk) {
            skipCk.addEventListener('change', () => {
                importSkipPassed = skipCk.checked;
                if (trainingBtn) {
                    const tgl = trainingBtn.querySelector('.pp-oj-skip-toggle');
                    if (tgl) {
                        tgl.classList.toggle('on', importSkipPassed);
                        tgl.textContent = importSkipPassed ? t('oj.skipPassedOn') : t('oj.skipPassed');
                    }
                }
            });
        }
        panel.querySelector('#pp-import-luogu').addEventListener('click', () => {
            const box = panel.querySelector('#pp-luogu-panel');
            box.classList.toggle('show');
            syncPanelImportUI();
            refreshHomeImportBtn();
        });
        panel.querySelector('#pp-luogu-start').addEventListener('click', async () => {
            const input = panel.querySelector('#pp-luogu-url');
            const status = panel.querySelector('#pp-luogu-status');
            const url = input.value.trim();
            if (!url) { alert(t('alert.enterLuoguUrl')); return; }
            syncPanelImportUI(); // 同步共享选项到 UI
            status.textContent = t('import.parsing');
            try {
                const pids = await importLuoguUrl(url);
                status.textContent = t('import.found', { n: pids.length });
                await runBatchImport(pids.map(pid => ({ pid, title: '' })), status, null,
                    { withTags: importWithTags, diffMin: importDiffMin, diffMax: importDiffMax, skipPassed: importSkipPassed });
            } catch (err) {
                status.innerHTML = '<span style="color:#e5484d">' + t('toast.trainingFail', { e: err.message }) + '</span>';
            }
        });
        panel.querySelector('#pp-home-import').addEventListener('click', async () => {
            const status = panel.querySelector('#pp-luogu-status');
            const { items, debug } = extractHomePlanProblems();
            if (!items.length) {
                status.innerHTML = '<span style="color:#e5484d">' + t('import.noModule') + '</span><br>' +
                    '<span style="color:#8a93b0;font-size:11px">' + (debug.join('<br>') || '') + '</span>';
                return;
            }
            status.textContent = t('import.homeFound', { n: items.length });
            await runBatchImport(items, status, null,
                { withTags: importWithTags, diffMin: importDiffMin, diffMax: importDiffMax, skipPassed: importSkipPassed });
        });
    }

    function refreshHomeImportBtn() {
        const btn = panel.querySelector('#pp-home-import');
        const onHome = /^https?:\/\/(www\.)?luogu\.com\.cn\/?$/.test(location.href);
        btn.disabled = !onHome;
        btn.textContent = onHome ? t('home.importBtn') : t('home.needHome');
    }

    // ==================== 事件绑定 ====================

    // 添加题目（同时检查进行中与已完成归档中的重复）
    panel.querySelector('#pp-add').addEventListener('click', () => {
        const urlInput = panel.querySelector('#pp-url');
        const nameInput = panel.querySelector('#pp-name');
        let url = urlInput.value.trim();
        let name = nameInput.value.trim();

        if (!url) { url = window.location.href; urlInput.value = url; }
        if (!name) { name = (document.title || '').trim() || t('misc.unnamedProblem'); }

        try { new URL(url); } catch (e) { alert(t('alert.invalidUrl')); urlInput.focus(); return; }
        if (problems.some(p => p.url === url)) { alert(t('toast.alreadyInPlan')); return; }
        if (archive.some(a => a.url === url)) { alert(t('alert.alreadyDoneAdd')); return; }

        problems.push(normalizeProblem({
            url, name, color: selectedColor, addedDate: new Date().toISOString()
        }));
        saveData();
        renderProblems();
        nameInput.value = '';
        urlInput.value = window.location.href;
        nameInput.focus();

        const addBtn = panel.querySelector('#pp-add');
        const orig = addBtn.textContent;
        addBtn.textContent = t('toast.addSuccess');
        setTimeout(() => { addBtn.textContent = orig; }, 1000);
    });

    panel.querySelector('#pp-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') panel.querySelector('#pp-add').click();
    });

    // 搜索框：实时过滤进行中列表
    panel.querySelector('#pp-search').addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderProblems();
    });
    // 随机一题
    panel.querySelector('#pp-random').addEventListener('click', pickRandomProblem);

    // 备忘录：添加按钮 + 回车添加
    panel.querySelector('#pp-memo-add').addEventListener('click', addMemo);
    // 日历导航：上/下月切换 + 回到今天
    panel.querySelector('#pp-cal-prev').addEventListener('click', () => calShiftMonth(-1));
    panel.querySelector('#pp-cal-next').addEventListener('click', () => calShiftMonth(1));
    panel.querySelector('#pp-cal-today').addEventListener('click', calGoToday);
    panel.querySelector('#pp-memo-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addMemo();
    });

    panel.querySelector('#pp-export').addEventListener('click', exportData);
    panel.querySelector('#pp-import').addEventListener('click', () => panel.querySelector('#pp-file').click());
    panel.querySelector('#pp-clear').addEventListener('click', clearAllData);
    panel.querySelector('#pp-file').addEventListener('change', handleFileSelect);

    bindSettings();
    bindLuoguImport();

    // 面板开关
    fab.addEventListener('click', (e) => {
        e.stopPropagation();
        isPanelVisible = !isPanelVisible;
        panel.classList.toggle('open', isPanelVisible);
        if (isPanelVisible) {
            loadData();
            loadArchive();
            loadSettings();
            loadMemos();
            currentLang = resolveLang();
            applyStaticI18n();
            updateMemoCount();
            loadTimerState();
            syncSettingsUI();
            adoptTimerState();
            switchTab(currentTab);
            refreshHomeImportBtn();
            const urlInput = panel.querySelector('#pp-url');
            if (!urlInput.value.trim()) urlInput.value = window.location.href;
            setTimeout(() => {
                if (currentTab === 'active') panel.querySelector('#pp-name').focus();
            }, 100);
        }
    });

    document.addEventListener('click', (e) => {
        if (isPanelVisible && !panel.contains(e.target) && !fab.contains(e.target)) {
            isPanelVisible = false;
            panel.classList.remove('open');
        }
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    // 页面可见时刷新（含计时状态：后台被节流时计时结束后切回可正确结算）
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isPanelVisible) {
            loadData();
            loadArchive();
            loadSettings();
            loadMemos();
            currentLang = resolveLang();
            applyStaticI18n();
            updateMemoCount();
            loadTimerState();
            adoptTimerState();
            switchTab(currentTab);
        }
    });

    // ==================== 初始化 ====================

    loadSettings();
    currentLang = resolveLang();
    applyStaticI18n();
    loadData();
    loadArchive();
    loadMemos();
    updateMemoCount();
    applyTheme(); // 初始化时应用主题（auto/light/dark）
    loadTimerState();
    adoptTimerState();
    startOjWatch();
    startTrainingWatch();
    startContestWatch();
})();
