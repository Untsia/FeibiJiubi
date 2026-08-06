const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// 头像文件夹：放在用户数据根目录下的 gacha_avatars
function getAvatarDir() {
    const base = process.env.FEIBIJIUBI_FOLDER_PATH || app.getPath('userData');
    const dir = path.join(base, 'gacha_avatars');
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
            console.error('创建头像文件夹失败:', e.message);
        }
    }
    return dir;
}

// 本地路径 -> file:// URL（兼容中文/空格）
function toFileURL(p) {
    return encodeURI('file://' + p.replace(/\\/g, '/'));
}

// 递归遍历头像目录（含子文件夹），建立 「文件名(去扩展名) → file:// URL」映射。
// 同时去掉常见的「_头像」后缀，便于按角色名直接匹配（如 秧秧_头像.png → 秧秧）。
function walkAvatarIndex(dir, index) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walkAvatarIndex(full, index);
        } else {
            const lower = ent.name.toLowerCase();
            const dot = lower.lastIndexOf('.');
            if (dot <= 0) continue;
            const ext = lower.slice(dot + 1);
            if (!AVATAR_EXTS.includes(ext)) continue;
            const base = ent.name.slice(0, dot); // 去掉扩展名
            const url = toFileURL(full);
            if (!index[base]) index[base] = url;
            // 去掉「_头像」后缀再注册一个键，支持按角色名匹配
            if (base.endsWith('_头像')) {
                const stripped = base.slice(0, -3);
                if (!index[stripped]) index[stripped] = url;
            }
        }
    }
}

// 建立完整索引（每次调用重建，确保新增/改名即时生效）
function getAvatarIndex() {
    getAvatarDir(); // 确保目录存在
    const index = {};
    walkAvatarIndex(path.join(process.env.FEIBIJIUBI_FOLDER_PATH || require('electron').app.getPath('userData'), 'gacha_avatars'), index);
    return index;
}

// 批量解析：传入 [{resourceId, name}]，返回 { byResourceId, byName }
ipcMain.handle('get-gacha-avatars', async (event, items) => {
    const index = getAvatarIndex();
    const byResourceId = {};
    const byName = {};
    if (Array.isArray(items)) {
        items.forEach(it => {
            const rid = it && it.resourceId;
            const nm = it && it.name;
            const url = (nm && index[String(nm)]) ||
                (rid !== undefined && rid !== null && rid !== '' && index[String(rid)]) ||
                null;
            if (url) {
                if (rid !== undefined && rid !== null && rid !== '') byResourceId[rid] = url;
                if (nm) byName[nm] = url;
            }
        });
    }
    return { byResourceId, byName };
});
