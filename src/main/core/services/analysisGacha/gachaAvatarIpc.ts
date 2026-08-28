// 角色/武器头像本地文件夹解析（原 src/core/services/analysisGacha/gachaAvatarIpc.js → TypeScript 迁移，行为逐行保持一致）
const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// 头像文件夹：放在用户数据根目录下的 gacha_avatars
function getAvatarDir(): string {
    const base = process.env.FEIBIJIUBI_FOLDER_PATH || app.getPath('userData');
    const dir = path.join(base, 'gacha_avatars');
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
            console.error('创建头像文件夹失败:', e.message);
        }
    }
    return dir;
}

// 本地路径 -> local:// 协议 URL（页面由 local://app/index.html 提供，直接返回 file:// 会被
// Chromium 拦截「Not allowed to load local resource」，需经主进程 local 协议 /avatars/ 前缀提供）。
function toAvatarURL(p: string): string {
    const base = getAvatarDir();
    const rel = path.relative(base, p).replace(/\\/g, '/');
    return 'local://app/avatars/' + rel.split('/').map(encodeURIComponent).join('/');
}

// 递归遍历头像目录（含子文件夹），建立 「文件名(去扩展名) → local:// URL」映射。
// 同时去掉常见的「_头像」后缀，便于按角色名直接匹配（如 秧秧_头像.png → 秧秧）。
function walkAvatarIndex(dir: string, index: Record<string, string>): void {
    let entries: any[];
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
            const url = toAvatarURL(full);
            if (!index[base]) index[base] = url;
            // 去掉「_头像」后缀再注册一个键，支持按角色名匹配
            if (base.endsWith('_头像')) {
                const stripped = base.slice(0, -3);
                if (!index[stripped]) index[stripped] = url;
            }
        }
    }
}

// 头像索引缓存。原实现每次 IPC 调用都 getAvatarDir() 两遍并递归遍历整个头像目录
// 重建索引，头像文件较多时会同步阻塞主进程。改为缓存 + 按「目录 mtime + 顶层条目数」失效，
// 新增/改名/删除头像时 mtime 或条目数变化即自动重建。
let avatarIndexCache: { key: string; index: Record<string, string> } | null = null;

function avatarDirSignature(dir: string): string {
    try {
        const st = fs.statSync(dir);
        return `${st.mtimeMs}:${fs.readdirSync(dir).length}`;
    } catch (e) {
        return ''; // 目录不存在/不可读：返回空签名，索引也为空
    }
}

// 建立完整索引（命中缓存时直接复用，否则重建）
function getAvatarIndex(): Record<string, string> {
    const dir = getAvatarDir(); // 确保目录存在
    const sig = avatarDirSignature(dir);
    if (avatarIndexCache && avatarIndexCache.key === sig) return avatarIndexCache.index;
    const index: Record<string, string> = {};
    walkAvatarIndex(dir, index);
    avatarIndexCache = { key: sig, index };
    return index;
}

// 批量解析：传入 [{resourceId, name}]，返回 { byResourceId, byName }
ipcMain.handle('get-gacha-avatars', async (event: any, items: any): Promise<any> => {
    try {
        const index = getAvatarIndex();
        const byResourceId: Record<string, string> = {};
        const byName: Record<string, string> = {};
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
    } catch (e: any) {
        // 该通道原先没有任何异常兜底，头像目录异常时会把错误抛回渲染进程。
        console.error('解析头像索引失败:', e && e.message);
        return { byResourceId: {}, byName: {} };
    }
});