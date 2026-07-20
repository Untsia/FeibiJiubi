function gameToolsInit() {
    // 防止重复加载 gachaWuwa.js：该脚本已在全局词法环境声明了顶层 let/const，
    // 重复 append 并重新执行会抛 "Identifier ... has already been declared" 而中断，
    // 导致切回分析页时 setupAnalysisTabs 的 analysisTabsBound 守卫无法重置、tab 无法切换。
    const existing = document.querySelector('script[src^="scripts/gameTools/gachaWuwa.js"]');
    if (existing) {
        if (typeof window.gachaWuwaInit === "function") {
            window.gachaWuwaInit();
        }
        return;
    }
    const script = document.createElement("script");
    script.src = "scripts/gameTools/gachaWuwa.js?_=" + Date.now();
    script.onload = () => {
        if (typeof window.gachaWuwaInit === "function") {
            window.gachaWuwaInit();
        }
    };
    document.body.appendChild(script);
}

// 注册初始化函数
window.gameToolsInit = gameToolsInit;
