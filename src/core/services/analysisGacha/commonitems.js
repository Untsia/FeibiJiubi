const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

// 获取数据路径
const dataPath = process.env.FEIBIJIUBI_FOLDER_PATH;
const commonItemsFile = path.join(dataPath, 'commonItems.json');

// 定义初始数据
const defaultCommonItems = {
    version: 1,
    wuWa: {
        "zh-cn": [
            "安可", "卡卡罗", "凌阳", "鉴心", "维里奈",
            "千古洑流", "浩境粼光", "停驻之烟", "擎渊怒涛", "漪澜浮录"
        ],
        "zh-tw": [
            "安可", "卡卡羅", "凌陽", "鑑心", "維里奈",
            "千古洑流", "浩境粼光", "停駐之煙", "擎淵怒濤", "漪瀾浮錄"
        ]
    }
};

// 统一的「确保常驻数据文件存在且为最新版本」逻辑，initialize/load 两处复用，避免重复
async function ensureCommonItems() {
    if (!fs.existsSync(commonItemsFile)) {
        await fs.promises.writeFile(commonItemsFile, JSON.stringify(defaultCommonItems, null, 2), 'utf8');
        console.log('commonItems.json 文件已创建');
        return defaultCommonItems;
    }
    const data = await fs.promises.readFile(commonItemsFile, 'utf8');
    const parsedData = JSON.parse(data);
    // 没有 version 字段或版本号低于默认值则覆盖更新
    if (!parsedData.version || parsedData.version < defaultCommonItems.version) {
        await fs.promises.writeFile(commonItemsFile, JSON.stringify(defaultCommonItems, null, 2), 'utf8');
        console.log(`commonItems.json 已更新至版本 ${defaultCommonItems.version}`);
        return defaultCommonItems;
    }
    return parsedData;
}

// 启动初始化：确保数据文件就绪
async function initializeCommonItems() {
    try {
        await ensureCommonItems();
    } catch (error) {
        console.error('初始化/更新 commonItems 文件失败:', error);
    }
}

initializeCommonItems();

// 读取常驻数据（读取时由 ensureCommonItems 兜底保证为最新版本）
async function loadOrCreateCommonItems() {
    try {
        return await ensureCommonItems();
    } catch (error) {
        console.error('加载或创建 commonItems 文件失败:', error);
        return defaultCommonItems;
    }
}

ipcMain.handle('get-common-items', async (event, game, lang) => {
  const commonItemsData = await loadOrCreateCommonItems();
  console.log(`传入的常驻记录游戏是 ${game}, 语言版本是 ${lang}`);

  const gameData = commonItemsData[game] || {};
  return gameData[lang] || gameData['zh-cn'] || [];
});
