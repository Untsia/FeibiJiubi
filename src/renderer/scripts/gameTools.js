function gameToolsInit() {
    // 六个视图 render 函数（bar/intuitive/table/detail/qizang/level）与共享工具（shared.js）
    // 已从 gachaWuwa.js 拆分为独立文件。这些视图脚本必须早于 gachaWuwa.js 加载并顺序执行，
    // gachaWuwa.js 的 loadGachaRecords / switchAnalysisView 在运行时才调用视图函数。
    const VIEW_SCRIPTS = [
        'scripts/gameTools/views/shared.js',
        'scripts/gameTools/views/barView.js',
        'scripts/gameTools/views/intuitiveView.js',
        'scripts/gameTools/views/tableView.js',
        'scripts/gameTools/views/detailView.js',
        'scripts/gameTools/views/qizangView.js',
        'scripts/gameTools/views/levelView.js'
    ];
    const MAIN_SCRIPT = 'scripts/gameTools/gachaWuwa.js';

    // 防止重复加载：这些脚本在全局词法环境声明了顶层 let/const（如 gachaWuwa.js 的 tableState、
    // lastIntuitiveData、growNumFull 等），重复 append 重新执行会抛 "Identifier ... has already
    // been declared" 而中断，导致切回分析页时 tab 无法切换。以第一个视图脚本是否已挂载
    // 作为整组是否已加载的判断。
    const existing = document.querySelector('script[src^="' + VIEW_SCRIPTS[0] + '"]');
    if (existing) {
        if (typeof window.gachaWuwaInit === 'function') {
            window.gachaWuwaInit();
        } else {
            console.warn('[GT] 已有视图脚本但 gachaWuwaInit 未挂载 window，启动跳过');
        }
        return;
    }

    const loadOne = (src) => new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src + '?_=' + Date.now();
        s.onload = () => { try { console.info('[GT] onload ' + src); } catch (_) {} resolve(); };
        s.onerror = (ev) => {
            // 单个视图脚本失败不阻塞整组，但必须把真实失败信息打到 console，
            // 供主进程 render console-message 日志落盘，便于定位「视图全部 0 挂不上」。
            try { console.error('[GT] onerror ' + src, ev && String(ev.error || ev.message || 'ScriptError')); } catch (_) {}
            resolve();
        };
        document.body.appendChild(s);
    });

    (async () => {
        try {
            console.warn('[GT] START 视图数=' + VIEW_SCRIPTS.length + ' hasRenderIntuitive=' + (typeof window.renderIntuitiveView === 'function') + ' isPackaged=' + (window.electronAPI ? (typeof window.electronAPI.getAppMeta === 'function' ? JSON.stringify(window.electronAPI.getAppMeta && window.electronAPI.getAppMeta()) : 'electronAPI-ok') : 'NO_ELECTRON_API'));
            for (const src of VIEW_SCRIPTS) await loadOne(src);
            console.warn('[GT] after-views renderBar=' + (typeof window.renderBarView === 'function') + ' renderIntuitive=' + (typeof window.renderIntuitiveView === 'function') + ' renderTable=' + (typeof window.renderTableView === 'function'));
            await loadOne(MAIN_SCRIPT);
            console.warn('[GT] after-main typeof gachaWuwaInit=' + typeof window.gachaWuwaInit + ' switchAnalysisView=' + typeof window.switchAnalysisView);
            if (typeof window.gachaWuwaInit === 'function') {
                try {
                    await window.gachaWuwaInit();
                    console.warn('[GT] init-OK #view-intuitive=' + (document.getElementById('view-intuitive') ? 'yes' : 'no') + ' analysis-view=' + document.querySelectorAll('.analysis-view').length + ' banners=' + document.querySelectorAll('.banner-card,.gacha-banner').length);
                } catch (e) {
                    console.error('[GT] init-threw', (e && e.message) || '', (e && e.stack) || '');
                }
            } else {
                console.error('[GT] init-missing. window.* related keys: ' + Object.getOwnPropertyNames(window).filter(n => /gacha|render|switchAnalysis|intuitive|barView/i.test(n)).slice(0, 30).join(','));
            }
        } catch (outer) {
            console.error('[GT] outer-async-wrapper-threw', (outer && outer.message) || '', (outer && outer.stack) || '');
        }
    })();
}

// 注册初始化函数
window.gameToolsInit = gameToolsInit;
