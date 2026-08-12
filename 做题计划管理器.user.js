// ==UserScript==
// @name         做题计划管理器
// @namespace    http://tampermonkey.net/
// @version      3.7.2
// @description  跨站做题计划管理器 v3.7.1：完成归档、置顶排序、统计图表、题目备注、番茄钟计时、题目搜索、随机一题、自定义颜色（颜色即难度）、每日目标、难度统计、洛谷题单导入、题单页批量导入、题目一键加入（洛谷、AT、CF、UVa，SPOJ暂不支持）。
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

    // 存储键名（沿用旧版，保证无缝升级）
    const STORAGE_KEY = 'problemPlanner_data';
    const ARCHIVE_KEY = 'problemPlanner_archive';
    const COUNT_KEY = 'problemPlanner_completedCount';
    const TIMER_KEY = 'problemPlanner_timer';
    const SETTINGS_KEY = 'problemPlanner_settings';

    // 默认设置
    const DEFAULT_SETTINGS = {
        focusMinutes: 25,
        breakMinutes: 5,
        autoBreak: true,
        dailyGoal: 0
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
    let currentTab = 'active'; // active | done | stats
    let searchQuery = ''; // 进行中列表的搜索关键词

    // ==================== 工具 ====================

    function normalizeDifficulty(d) {
        return Number.isInteger(d) && d >= 0 && d <= DIFF_MAX ? d : null;
    }
    function difficultyLabel(d) { return DIFFICULTY_META[d] ? DIFFICULTY_META[d].label : ''; }
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
            name: p.name || '(未命名)',
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
            name: a.name || '(未命名)',
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
                showToast('专注完成！休息一下吧 ☕', '#52C41A');
            } else {
                clearTimer();
                showToast('专注完成！🏆', '#52C41A');
            }
        } else {
            clearTimer();
            showToast('休息结束，继续加油 💪', '#FFC116');
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
        showToast('开始专注 ' + settings.focusMinutes + ' 分钟 ⏱', '#3498DB');
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
        .pp-oj-btn {
            position: fixed; right: 24px; bottom: 100px; z-index: 999998;
            background: linear-gradient(135deg, #52c41a, #34a8f0); color: #fff;
            border: none; border-radius: 999px; padding: 10px 16px;
            font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
            box-shadow: 0 6px 16px rgba(52,168,240,.35);
            transition: transform .2s, box-shadow .2s;
        }
        .pp-oj-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(52,168,240,.45); }
        .pp-oj-btn:disabled { opacity: .7; cursor: wait; }
        .pp-oj-btn.ok { background: linear-gradient(135deg, #2bb673, #1e9e63); }
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
        <div class="pp-header">
            做题计划
        </div>
        <div class="pp-tabs">
            <button class="pp-tab active" data-tab="active">进行中</button>
            <button class="pp-tab" data-tab="done">已完成</button>
            <button class="pp-tab" data-tab="stats">统计</button>
        </div>
        <div class="pp-body">
            <div class="pp-view active" data-view="active">
                <div class="pp-form">
                    <div class="pp-form-group">
                        <label for="pp-url">题目网址</label>
                        <input type="text" id="pp-url" class="pp-input" placeholder="https://example.com/problem/123">
                    </div>
                    <div class="pp-form-group">
                        <label for="pp-name">题目名称</label>
                        <input type="text" id="pp-name" class="pp-input" placeholder="默认使用当前页面标题">
                    </div>
                    <div class="pp-form-group">
                        <label>选择颜色</label>
                        <div class="pp-color-selection" id="pp-colors"></div>
                    </div>
                    <button class="pp-add-btn" id="pp-add">添加题目到计划</button>
                </div>
                <div class="pp-search-row">
                    <input type="text" id="pp-search" class="pp-input" placeholder="🔍 搜索题目名 / 备注 / 网址…">
                    <button class="pp-btn pp-understand pp-random-btn" id="pp-random" title="从未理解题目中随机抽一道">🎲 随机一题</button>
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
        </div>
        <div class="pp-backup">
            <div class="pp-backup-title">💾 数据备份</div>
            <div class="pp-backup-buttons">
                <button class="pp-btn-backup pp-export" id="pp-export">导出数据</button>
                <button class="pp-btn-backup pp-import" id="pp-import">导入数据</button>
                <button class="pp-btn-backup pp-clear" id="pp-clear">清空数据</button>
                <button class="pp-btn-backup pp-luogu" id="pp-import-luogu">📥 洛谷导入</button>
                <button class="pp-settings-toggle" id="pp-settings-toggle">⚙ 设置</button>
            </div>
            <div class="pp-luogu-panel" id="pp-luogu-panel">
                <div class="pp-form-group" style="margin-bottom:8px;">
                    <label for="pp-luogu-url" style="font-size:12px;">洛谷题单 / 做题计划链接</label>
                    <input type="text" id="pp-luogu-url" class="pp-input" placeholder="https://www.luogu.com.cn/training/xxx">
                </div>
                <button class="pp-btn-backup pp-export" id="pp-luogu-start" style="width:100%;margin-top:0;">开始导入题单</button>
                <button class="pp-btn-backup pp-import" id="pp-home-import" style="width:100%;margin-top:6px;">从当前洛谷主页任务计划导入</button>
                <div class="pp-luogu-status" id="pp-luogu-status"></div>
            </div>
            <div class="pp-settings" id="pp-settings">
                <div class="pp-settings-row">
                    <label>专注时长</label>
                    <input type="number" id="pp-focus-min" min="1" max="120">
                    <span class="unit">分钟</span>
                </div>
                <div class="pp-settings-row">
                    <label>休息时长</label>
                    <input type="number" id="pp-break-min" min="1" max="60">
                    <span class="unit">分钟</span>
                </div>
                <div class="pp-settings-row">
                    <label>自动休息</label>
                    <input type="checkbox" id="pp-auto-break">
                    <span class="unit">专注结束后自动开始休息</span>
                </div>
                <div class="pp-settings-row">
                    <label>每日目标</label>
                    <input type="number" id="pp-daily-goal" min="0" max="100">
                    <span class="unit">题（0 = 不启用）</span>
                </div>
            </div>
            <div class="pp-backup-note" style="font-size:12px;color:#9aa3bf;margin-top:9px;font-style:italic;">
                导出包含进行中、已完成归档、备注、计时统计（v3 格式）
            </div>
        </div>
        <div class="pp-footer">
            <div class="pp-stats">
                <div class="pp-stat-card"><span class="pp-stat-label">未理解</span><span class="pp-stat-value" id="pp-not-understood">0</span></div>
                <div class="pp-stat-card"><span class="pp-stat-label">已理解</span><span class="pp-stat-value" id="pp-understood">0</span></div>
                <div class="pp-stat-card"><span class="pp-stat-label">已完成</span><span class="pp-stat-value completed" id="pp-completed">0</span></div>
            </div>
            <div class="pp-stats">
                <div class="pp-stat-card"><span class="pp-stat-label">累计专注</span><span class="pp-stat-value time" id="pp-total-time">0m</span></div>
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
            showToast('暂无未理解的题目 🎉', '#F39C11');
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
        showToast('🎲 随机一题：' + pick.name, '#3498DB');
    }

    function renderProblems() {
        const list = panel.querySelector('#pp-list');
        updateCounters();

        if (problems.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">📭</span><span class="pp-empty-text">暂无待做题目，请添加题目到计划中</span></div>';
            return;
        }

        const filtered = filteredProblems();
        if (filtered.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">🔍</span><span class="pp-empty-text">没有匹配「' + searchQuery + '」的题目</span></div>';
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
            timeBadge.title = '累计专注时长';
            main.appendChild(timeBadge);
        }

        item.appendChild(main);

        // ---- 操作区（第一行：理解 / 完成 / 放弃）----
        const actions = document.createElement('div');
        actions.className = 'pp-actions';

        if (!problem.understood) {
            const understandBtn = document.createElement('button');
            understandBtn.className = 'pp-btn pp-understand pp-btn-sm';
            understandBtn.textContent = '理解';
            understandBtn.title = '标记为已理解（移至底部）';
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
        completeBtn.textContent = '完成';
        completeBtn.title = '标记为已完成（移入归档）';
        completeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm(`确定要标记题目 "${problem.name}" 为已完成吗？`)) {
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
                            showToast('🎯 今日目标 ' + goal + ' 题已达成！太棒了', '#F39C11');
                        } else {
                            showToast('已归档 🎉 · 今日 ' + todayDone + '/' + goal, '#52C41A');
                        }
                    } else {
                        showToast('已归档 🎉', '#52C41A');
                    }
                }
            }
        });
        actions.appendChild(completeBtn);

        const giveupBtn = document.createElement('button');
        giveupBtn.className = 'pp-btn pp-giveup pp-btn-sm';
        giveupBtn.textContent = '放弃';
        giveupBtn.title = '放弃此题（不计入完成）';
        giveupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm(`确定要放弃题目 "${problem.name}" 吗？`)) {
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
        noteBtn.textContent = '备注';
        noteBtn.title = problem.notes ? '编辑备注（已展示在下方）' : '添加备注';
        if (problem.notes) noteBtn.classList.add('has-note');
        noteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleNoteEditor(item, problem);
        });
        toolbar.appendChild(noteBtn);

        // 改色按钮：展开颜色选择器，自定义题目颜色
        const colorBtn = document.createElement('button');
        colorBtn.className = 'pp-tool-btn pp-tool-color';
        colorBtn.textContent = '颜色';
        colorBtn.title = problem.customColor ? '修改自定义颜色（当前已设置）' : '自定义题目颜色（覆盖难度色）';
        if (problem.customColor) colorBtn.classList.add('has-color');
        colorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleColorPicker(item, problem);
        });
        toolbar.appendChild(colorBtn);

        const timerBtn = document.createElement('button');
        timerBtn.className = 'pp-tool-btn pp-tool-timer pp-timer-btn';
        timerBtn.textContent = '计时';
        timerBtn.title = '番茄钟：开始 ' + settings.focusMinutes + ' 分钟专注';
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
        stopBtn.textContent = '停止';
        stopBtn.title = '停止计时（结算已专注时间）';
        stopBtn.style.display = 'none';
        stopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            stopTimer();
        });
        toolbar.appendChild(stopBtn);

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pp-tool-btn pp-tool-pin';
        pinBtn.textContent = problem.pinned ? '已置顶' : '置顶';
        pinBtn.title = problem.pinned ? '取消置顶' : '置顶（排在列表前面）';
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
        upBtn.title = '上移';
        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            moveProblem(problem.url, -1);
        });
        toolbar.appendChild(upBtn);

        const downBtn = document.createElement('button');
        downBtn.className = 'pp-tool-btn pp-tool-move';
        downBtn.textContent = '▼';
        downBtn.title = '下移';
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
            noteView.title = '点击可编辑备注';
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
            showToast('置顶与未置顶不能互相移动', '#FE4C61');
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
                    ? (timerState.running ? '专注中…点击暂停' : '已暂停，点击继续')
                    : '休息中…点击跳过';
            } else {
                stopBtn.style.display = 'none';
                timerBtn.textContent = '计时';
                timerBtn.classList.remove('running', 'break-phase');
                timerBtn.title = '番茄钟：开始 ' + settings.focusMinutes + ' 分钟专注';
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
        reset.textContent = '恢复默认';
        reset.title = '清除自定义颜色';
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
            <textarea placeholder="记录思路、坑点、题解链接…"></textarea>
            <div class="pp-note-actions">
                <button class="pp-btn pp-complete" type="button">保存</button>
                <button class="pp-btn pp-giveup" type="button">取消</button>
            </div>
        `;
        editor.querySelector('textarea').value = problem.notes || '';
        editor.querySelector('.pp-complete').addEventListener('click', () => {
            const idx = problems.findIndex(p => p.url === problem.url);
            if (idx !== -1) {
                problems[idx].notes = editor.querySelector('textarea').value.trim();
                saveData();
                showToast('备注已保存', '#9D3DCF');
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
            <span>共 <b>${archive.length}</b> 条完成记录</span>
            <span>归档专注 <b>${formatDuration(totalTime)}</b></span>
        `;

        if (archive.length === 0) {
            list.innerHTML = '<div class="pp-empty"><span class="pp-empty-icon">🗂</span><span class="pp-empty-text">暂无完成记录，做完题目会自动归档到这里</span></div>';
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
            '<span>✅ 完成于 ' + formatDateTime(a.completedDate) + '</span>' +
            (a.timeSpent > 0 ? '<span>⏱ 专注 ' + formatDuration(a.timeSpent) + '</span>' : '') +
            '<span>📅 添加于 ' + formatDate(a.addedDate) + '</span>';
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
        restoreBtn.textContent = '恢复';
        restoreBtn.title = '恢复到进行中列表';
        restoreBtn.addEventListener('click', () => {
            if (confirm(`将 "${a.name}" 恢复到进行中列表？`)) {
                restoreArchiveItem(a);
            }
        });
        actions.appendChild(restoreBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'pp-btn pp-del-record pp-btn-sm';
        delBtn.textContent = '删除';
        delBtn.title = '永久删除该条完成记录';
        delBtn.addEventListener('click', () => {
            if (confirm(`永久删除记录 "${a.name}"？（不影响已完成计数）`)) {
                const idx = archive.findIndex(x => x.url === a.url && x.completedDate === a.completedDate);
                if (idx !== -1) {
                    archive.splice(idx, 1);
                    saveArchive();
                    renderArchiveList();
                    showToast('记录已删除', '#FE4C61');
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
            showToast('该题目已在进行中，仅移除归档记录', '#F39C11');
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
            showToast('已恢复到进行中', '#52C41A');
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
                <div class="pp-ov-card"><span class="pp-ov-value">${completedCount}</span><span class="pp-ov-label">总完成</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value green">${todayCount}</span><span class="pp-ov-label">今日完成</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value orange">${calcStreak()}</span><span class="pp-ov-label">连续打卡(天)</span></div>
                <div class="pp-ov-card"><span class="pp-ov-value">${formatDuration(totalTime)}</span><span class="pp-ov-label">累计专注</span></div>
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
                        <span class="pp-goal-title">🎯 今日目标</span>
                        <span class="pp-goal-num">${todayCount} / ${goal} 题${done ? ' · 达成 🎉' : ''}</span>
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
        html += `
            <div class="pp-chart-card">
                <div class="pp-chart-title">14 天完成趋势<span class="pp-chart-sub">每天完成的题目数</span></div>
                <svg class="pp-chart-svg" viewBox="0 0 100 56" preserveAspectRatio="none" style="height:120px">
                    ${days.map((x, i) => {
                        const h = Math.max(2, (x.count / maxCount) * 46);
                        const y = 52 - h;
                        return `<rect x="${i * barW + barW * 0.15}" y="${y}" width="${barW * 0.7}" height="${h}" rx="1.5" fill="${x.count > 0 ? '#4f7cff' : '#e8ecf7'}">
                            <title>${x.date.getMonth() + 1}月${x.date.getDate()}日：完成 ${x.count} 题</title>
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
                <div class="pp-chart-title">难度分布<span class="pp-chart-sub">已完成题目 · 洛谷难度</span></div>
                <div class="pp-diff-bars">
                    ${DIFFICULTY_META.map((m, i) => `
                        <div class="pp-diff-row">
                            <span class="pp-diff-label" style="color:${m.color}">${m.label}</span>
                            <div class="pp-diff-track"><div class="pp-diff-fill" style="width:${(diffCounts[i] / maxDiffCount) * 100}%;background:${m.color}"></div></div>
                            <span class="pp-diff-count">${diffCounts[i]}</span>
                        </div>`).join('')}
                    ${diffNone > 0 ? `
                        <div class="pp-diff-row">
                            <span class="pp-diff-label" style="color:#9aa3bf">暂无评定</span>
                            <div class="pp-diff-track"><div class="pp-diff-fill" style="width:${(diffNone / maxDiffCount) * 100}%;background:#d5dbea"></div></div>
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
        const heatCellColor = (n, maxDiff) => {
            if (n <= 0) return '#ebedf0';
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
                    <title>${date.getMonth() + 1}月${date.getDate()}日：完成 ${cnt} 题${maxDiff >= 0 ? ' · 最难 ' + difficultyLabel(maxDiff) : ''}</title>
                </rect>`;
            }
        }
        const chartW = weeks * (cell + gap) - gap;
        const chartH = gridH * (cell + gap) - gap;
        // 图例：难度色阶 + 色深档位
        const diffLegend = DIFFICULTY_META.map((m, i) =>
            `<span class="cell" style="background:${m.color}" title="${m.label}"></span>`
        ).join('');
        const shadeShades = [0.55, 0.32, 0, -0.35, -0.6];
        const shadeLabels = ['1~2', '3~4', '5~6', '7~8', '9+'];
        const shadeLegend = shadeShades.map((s, i) =>
            `<span class="cell" style="background:${shadeHexColor('#13C2C2', s)}"></span><span>${shadeLabels[i]}</span>`
        ).join('');
        html += `
            <div class="pp-chart-card">
                <div class="pp-chart-title">月度打卡热力图<span class="pp-chart-sub">最近 15 周 · 颜色=最难题难度，色深=完成数</span></div>
                <svg class="pp-chart-svg" viewBox="0 0 ${chartW} ${chartH}" style="height:${chartH + 4}px;width:auto;display:block;margin:0 auto">
                    ${cells}
                </svg>
                <div class="pp-legend-block">
                    <span>难度</span>${diffLegend}
                </div>
                <div class="pp-legend-block">
                    <span>完成数</span>
                    <span class="cell" style="background:#ebedf0"></span><span>0</span>
                    ${shadeLegend}
                </div>
            </div>
        `;

        box.innerHTML = html;
    }

    // ==================== 标签页切换 ====================

    function switchTab(tab) {
        currentTab = tab;
        panel.querySelectorAll('.pp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        panel.querySelectorAll('.pp-view').forEach(v => v.classList.toggle('active', v.dataset.view === tab));
        if (tab === 'active') renderProblems();
        else if (tab === 'done') renderArchiveList();
        else if (tab === 'stats') renderStats();
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
        a.download = `做题计划备份_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('数据已导出（含归档）', '#52C41A');
    }

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.problems || !Array.isArray(data.problems)) throw new Error('数据格式不正确：缺少题目列表');
                const importedArchive = Array.isArray(data.archive) ? data.archive : [];
                const ok = confirm(
                    `准备合并导入 ${data.problems.length} 个进行中题目\n` +
                    `已完成归档：${importedArchive.length} 条\n` +
                    `完成计数：${data.completedCount || 0}\n\n` +
                    `合并模式：按网址去重，已存在的题目不会被覆盖。\n确定继续吗？`
                );
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

                // 完成计数取两者较大值（合并不倒退统计）
                completedCount = Math.max(completedCount, data.completedCount || 0);

                clearTimer();
                saveData();
                saveArchive();
                renderProblems();
                renderArchiveList();
                showToast(
                    `合并完成：新增进行中 ${addedActive} · 归档 ${addedArch}` +
                    (skippedActive + skippedArch ? ` · 跳过重复 ${skippedActive + skippedArch}` : ''),
                    '#52C41A'
                );
            } catch (error) {
                alert(`导入失败：${error.message}\n\n请确保选择的是有效的备份文件。`);
                console.error('[做题计划] 导入错误:', error);
            }
            event.target.value = '';
        };
        reader.onerror = function () {
            alert('读取文件失败，请重试');
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    function clearAllData() {
        if (problems.length + archive.length > 0 && confirm('确定要清空所有数据（含已完成归档）吗？此操作不可撤销。')) {
            clearTimer();
            problems = [];
            archive = [];
            completedCount = 0;
            saveData();
            saveArchive();
            renderProblems();
            renderArchiveList();
            showToast('数据已清空', '#FE4C61');
        }
    }

    // ==================== 设置面板 ====================

    function syncSettingsUI() {
        panel.querySelector('#pp-focus-min').value = settings.focusMinutes;
        panel.querySelector('#pp-break-min').value = settings.breakMinutes;
        panel.querySelector('#pp-auto-break').checked = !!settings.autoBreak;
        panel.querySelector('#pp-daily-goal').value = settings.dailyGoal || 0;
    }

    function bindSettings() {
        const focusInput = panel.querySelector('#pp-focus-min');
        const breakInput = panel.querySelector('#pp-break-min');
        const autoBreak = panel.querySelector('#pp-auto-break');
        const dailyGoalInput = panel.querySelector('#pp-daily-goal');

        function apply() {
            settings.focusMinutes = Math.min(120, Math.max(1, parseInt(focusInput.value, 10) || 25));
            settings.breakMinutes = Math.min(60, Math.max(1, parseInt(breakInput.value, 10) || 5));
            settings.autoBreak = autoBreak.checked;
            settings.dailyGoal = Math.min(100, Math.max(0, parseInt(dailyGoalInput.value, 10) || 0));
            saveSettings();
            showToast('设置已保存', '#3498DB');
        }
        focusInput.addEventListener('change', apply);
        breakInput.addEventListener('change', apply);
        autoBreak.addEventListener('change', apply);
        dailyGoalInput.addEventListener('change', apply);

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

    // 从洛谷响应解析题名（<title>）
    function parseLuoguTitle(html, pid) {
        const m = String(html).match(/<title>([\s\S]*?)<\/title>/i);
        if (!m) return '';
        return cleanLuoguTitle(decodeHTML(m[1]), pid);
    }

    // GM_xmlhttpRequest GET 封装
    function luoguGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: 12000,
                onload: (res) => {
                    if (res.status !== 200) { reject(new Error('洛谷返回状态码 ' + res.status)); return; }
                    resolve(res.responseText);
                },
                onerror: () => reject(new Error('网络请求失败')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });
    }

    // 获取洛谷题目信息（题名 + 难度）
    async function fetchLuoguInfo(luoguPid) {
        const html = await luoguGet('https://www.luogu.com.cn/problem/' + encodeURIComponent(luoguPid) + '?_contentOnly=1');
        const difficulty = parseLuoguDifficulty(html);
        const title = parseLuoguTitle(html, luoguPid);
        if (difficulty === null && !title) {
            throw new Error('洛谷未收录该题或解析失败（' + luoguPid + '）');
        }
        return { title, difficulty };
    }

    // 一键加入（从当前 OJ 页面）
    async function addFromOJPage(btn) {
        const det = detectOJ();
        if (!det) return;
        try {
            if (btn) { btn.disabled = true; btn.textContent = '⏳ 获取中…'; }
            const luoguPid = det.luoguPid;
            const pageUrl = det.pageUrl || location.href;
            if (problems.some(p => p.url === pageUrl)) {
                showToast('此题目已在计划中！', '#F39C11');
                return;
            }
            if (archive.some(a => a.url === pageUrl)) {
                showToast('此题目已在已完成记录中！', '#F39C11');
                return;
            }
            let name = ojPageTitle(det) || '';
            let difficulty = null;
            if (luoguPid) {
                try {
                    const info = await fetchLuoguInfo(luoguPid);
                    if (!name) name = info.title;
                    difficulty = info.difficulty;
                } catch (err) {
                    alert('获取题目信息失败：' + err.message + '\n\n题目未加入。');
                    return;
                }
            }
            // 显示名采用「题号 + 题目名」格式（如 P1001 A+B Problem / CF2081G1 题目名）
            const displayName = ((luoguPid ? luoguPid + ' ' : '') + (name || '')).trim();
            // 颜色即难度：洛谷题用难度色，非洛谷题用用户选择的颜色
            const color = difficulty !== null && difficulty !== undefined
                ? difficultyColor(difficulty)
                : selectedColor;
            problems.push(normalizeProblem({
                url: pageUrl,
                name: displayName || luoguPid || '未命名题目',
                color,
                addedDate: new Date().toISOString(),
                difficulty
            }));
            saveData();
            if (btn) { btn.textContent = '✓ 已加入'; btn.classList.add('ok'); }
            showToast('已加入计划' + (difficulty !== null ? ' · 难度 ' + difficultyLabel(difficulty) : ''), '#52C41A');
        } catch (err) {
            alert('加入失败：' + err.message);
        } finally {
            if (btn) {
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('ok');
                    btn.textContent = '＋ 加入做题计划';
                }, 1500);
            }
        }
    }

    // OJ 悬浮按钮注入（轮询检测，兼容洛谷 PJAX 页面切换）
    let ojBtn = null;
    let ojInjectedKey = '';
    function ensureOJButton() {
        const det = detectOJ();
        const key = det ? (det.site + '|' + (det.luoguPid || '') + '|' + (det.pageUrl || '')) : '';
        if (key === ojInjectedKey) return;
        ojInjectedKey = key;
        if (ojBtn) { ojBtn.remove(); ojBtn = null; }
        if (!det) return;
        ojBtn = document.createElement('button');
        ojBtn.className = 'pp-oj-btn';
        ojBtn.textContent = '＋ 加入做题计划';
        ojBtn.title = '获取洛谷 RMJ 难度并加入做题计划';
        ojBtn.addEventListener('click', () => addFromOJPage(ojBtn));
        document.body.appendChild(ojBtn);
    }
    function startOjWatch() {
        ensureOJButton();
        setInterval(ensureOJButton, 1500);
    }

    // ==================== 洛谷题单页批量导入按钮 ====================

    let trainingBtn = null;
    let trainingBtnKey = '';

    // 检测当前是否为洛谷题单页（/training/<id>），注入「导入整个题单」按钮
    function ensureTrainingButton() {
        const m = location.pathname.match(/^\/training\/(\d+)/);
        const key = m ? ('training|' + m[1]) : '';
        if (key === trainingBtnKey) return;
        trainingBtnKey = key;
        if (trainingBtn) { trainingBtn.remove(); trainingBtn = null; }
        if (!m) return;
        trainingBtn = document.createElement('button');
        trainingBtn.className = 'pp-oj-btn';
        trainingBtn.textContent = '📥 导入整个题单';
        trainingBtn.title = '将当前洛谷题单的所有题目批量加入做题计划';
        trainingBtn.addEventListener('click', () => importCurrentTraining(trainingBtn));
        document.body.appendChild(trainingBtn);
    }

    // 从当前题单页解析并批量导入（复用 runBatchImport，进度显示在按钮上）
    async function importCurrentTraining(btn) {
        const m = location.pathname.match(/^\/training\/(\d+)/);
        if (!m) return;
        btn.disabled = true;
        btn.textContent = '⏳ 解析题单…';
        try {
            const pids = await importLuoguUrl('https://www.luogu.com.cn/training/' + m[1]);
            btn.textContent = '⏳ 获取题目信息…';
            const items = pids.map(pid => ({ pid, title: '' }));
            const result = await runBatchImport(items, null, (text) => {
                btn.textContent = text.replace('正在获取 ', '⏳ ').replace(' …', '');
            });
            btn.textContent = '✓ 已导入 ' + result.added + ' 题';
            showToast('题单导入完成：新增 ' + result.added + ' · 跳过 ' + result.skipped
                + (result.failures.length ? ' · 失败 ' + result.failures.length : ''), '#52C41A');
        } catch (err) {
            showToast('题单导入失败：' + err.message, '#FE4C61');
            btn.textContent = '📥 导入整个题单';
        } finally {
            setTimeout(() => {
                btn.disabled = false;
                if (btn.textContent.indexOf('✓') === -1) btn.textContent = '📥 导入整个题单';
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
        if (!m) throw new Error('仅支持洛谷题单链接（luogu.com.cn/training/xxx）');
        const html = await luoguGet('https://www.luogu.com.cn/training/' + m[1] + '?_contentOnly=1');
        const pids = extractPidsFromHtml(html);
        if (pids.length === 0) throw new Error('未从题单中解析到题目（请检查链接是否有效）');
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
    async function runBatchImport(items, statusEl, onStatus) {
        const existedActive = new Set(problems.map(p => p.url));
        const existedArchive = new Set(archive.map(a => a.url));
        const seen = new Set();
        let added = 0, skipped = 0;
        const failures = [];

        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pid = it.pid;
            const pUrl = 'https://www.luogu.com.cn/problem/' + pid;
            if (seen.has(pid)) continue;
            seen.add(pid);
            if (existedActive.has(pUrl) || existedArchive.has(pUrl)) { skipped++; continue; }
            if (onStatus) onStatus('正在获取 ' + (i + 1) + '/' + items.length + '：' + pid + ' …');
            else if (statusEl) statusEl.textContent = '正在获取 ' + (i + 1) + '/' + items.length + '：' + pid + ' …';
            try {
                let name = it.title || '';
                let difficulty = null;
                const info = await fetchLuoguInfo(pid);
                if (!name) name = info.title;
                difficulty = info.difficulty;
                // 与一键加入一致：显示名采用「题号 + 题目名」格式（如 P1001 A+B Problem）
                const displayName = ((pid ? pid + ' ' : '') + (name || '')).trim();
                // 颜色即难度：洛谷题用难度色
                const color = difficulty !== null && difficulty !== undefined
                    ? difficultyColor(difficulty)
                    : selectedColor;
                problems.push(normalizeProblem({
                    url: pUrl,
                    name: displayName || pid,
                    color,
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
            if (failures.length) {
                statusEl.innerHTML = '导入完成：新增 <b>' + added + '</b> · 跳过 <b>' + skipped + '</b> · 失败 <b style="color:#e5484d">' + failures.length + '</b><br>' +
                    '<span style="color:#e5484d">失败题目：' + failures.map(f => f.pid).join('、') + '</span>';
            } else {
                statusEl.innerHTML = '导入完成：新增 <b>' + added + '</b> · 跳过 <b>' + skipped + '</b>';
            }
        }
        renderProblems();
        return { added, skipped, failures };
    }

    // 洛谷导入 UI 绑定
    function bindLuoguImport() {
        panel.querySelector('#pp-import-luogu').addEventListener('click', () => {
            const box = panel.querySelector('#pp-luogu-panel');
            box.classList.toggle('show');
            refreshHomeImportBtn();
        });
        panel.querySelector('#pp-luogu-start').addEventListener('click', async () => {
            const input = panel.querySelector('#pp-luogu-url');
            const status = panel.querySelector('#pp-luogu-status');
            const url = input.value.trim();
            if (!url) { alert('请先粘贴洛谷题单链接'); return; }
            status.textContent = '正在解析题单…';
            try {
                const pids = await importLuoguUrl(url);
                status.textContent = '解析到 ' + pids.length + ' 道题，开始获取题目信息…';
                await runBatchImport(pids.map(pid => ({ pid, title: '' })), status);
            } catch (err) {
                status.innerHTML = '<span style="color:#e5484d">导入失败：' + err.message + '</span>';
            }
        });
        panel.querySelector('#pp-home-import').addEventListener('click', async () => {
            const status = panel.querySelector('#pp-luogu-status');
            const { items, debug } = extractHomePlanProblems();
            if (!items.length) {
                status.innerHTML = '<span style="color:#e5484d">未在主页找到任务计划模块，请确认已登录洛谷并打开主页。</span><br>' +
                    '<span style="color:#8a93b0;font-size:11px">' + (debug.join('<br>') || '') + '</span>';
                return;
            }
            status.textContent = '主页任务计划解析到 ' + items.length + ' 道题，开始获取难度…';
            await runBatchImport(items, status);
        });
    }

    function refreshHomeImportBtn() {
        const btn = panel.querySelector('#pp-home-import');
        const onHome = /^https?:\/\/(www\.)?luogu\.com\.cn\/?$/.test(location.href);
        btn.disabled = !onHome;
        btn.textContent = onHome ? '从当前洛谷主页任务计划导入' : '需在洛谷主页使用';
    }

    // ==================== 事件绑定 ====================

    // 添加题目（同时检查进行中与已完成归档中的重复）
    panel.querySelector('#pp-add').addEventListener('click', () => {
        const urlInput = panel.querySelector('#pp-url');
        const nameInput = panel.querySelector('#pp-name');
        let url = urlInput.value.trim();
        let name = nameInput.value.trim();

        if (!url) { url = window.location.href; urlInput.value = url; }
        if (!name) { name = (document.title || '').trim() || '未命名题目'; }

        try { new URL(url); } catch (e) { alert('请输入有效的网址！'); urlInput.focus(); return; }
        if (problems.some(p => p.url === url)) { alert('此题目已在计划中！'); return; }
        if (archive.some(a => a.url === url)) { alert('此题目已在已完成记录中，不能重复添加！'); return; }

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
        addBtn.textContent = '添加成功！';
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
            loadTimerState();
            adoptTimerState();
            switchTab(currentTab);
        }
    });

    // ==================== 初始化 ====================

    loadData();
    loadArchive();
    loadSettings();
    loadTimerState();
    adoptTimerState();
    startOjWatch();
    startTrainingWatch();
})();
