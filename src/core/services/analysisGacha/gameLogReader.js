/**
 * 鸣潮「游戏内获取」——从本地游戏日志中提取唤取记录 URL
 *
 * 逻辑参考自开源项目 wuwa-gacha-tracker 的「从游戏导入」实现：
 *  1. 定位游戏安装目录（优先已保存路径 / 注册表 / 常见盘符扫描）
 *  2. 以共享只读方式读取日志文件，避免游戏运行时占用导致 EBUSY
 *  3. 部分日志经过单字节 XOR 混淆（0xa5 / 0xef），需尝试解密
 *  4. 用正则取出最后一次出现的唤取记录 URL
 *
 * 注意：本模块只负责「拿到 URL」，后续的请求与统计仍走项目原有算法。
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/** 可能包含唤取 URL 的日志文件相对路径 */
const LOG_RELATIVE_PATHS = [
    'Client/Saved/Logs/Client.log',
    'Client/Saved/Logs/debug.log',
    'Client/Binaries/Win64/ThirdParty/KrPcSdk_Global/KRSDKRes/KRSDKWebView/debug.log',
    'Client/Saved/Logs/Client.log.bak',
];

/** 常见的游戏安装目录（相对盘符） */
const COMMON_INSTALL_DIRS = [
    'Wuthering Waves/Wuthering Waves Game',
    'Wuthering Waves Game',
    'Program Files/Wuthering Waves/Wuthering Waves Game',
    'Program Files (x86)/Wuthering Waves/Wuthering Waves Game',
    'WutheringWaves/Wuthering Waves Game',
    'Games/Wuthering Waves/Wuthering Waves Game',
    'game/Wuthering Waves/Wuthering Waves Game',
    'Wuthering Waves',
];

const DRIVES = ['C', 'D', 'E', 'F', 'G', 'H'];

/** 唤取记录 URL 匹配正则（与参考项目 wuwa-gacha-tracker 严格一致） */
const GACHA_URL_REGEX = /https:\/\/aki-gm-resources(-oversea)?\.aki-game\.(net|com)\/aki\/gacha\/index\.html#\/record[^"\s]*/g;

/**
 * 以共享模式读取文件，避免游戏正在写入时报 EBUSY / EACCES。
 * 使用 openSync + readSync 而非 readFileSync，读取失败时返回 null。
 * 读取整个文件（参考项目即如此），文件通常不大或尾部才含 URL。
 */
function readSharedFile(filePath) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const stat = fs.fstatSync(fd);
        if (!stat.size) return null;
        const buffer = Buffer.alloc(stat.size);
        fs.readSync(fd, buffer, 0, stat.size, 0);
        return buffer;
    } catch (err) {
        return null;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) { /* ignore */ }
        }
    }
}

/**
 * 单字节条件 XOR 解密（参考项目原逻辑）：
 * 每个字节根据其低 4 位的奇偶，分别用 0xa5 或 0xef 异或还原。
 * 解密后直接以 utf-8 解析为文本。
 */
function decodeXor(buffer) {
    const out = Buffer.from(buffer); // 复制，避免修改原 buffer
    for (let i = 0; i < out.length; i++) {
        const b = out[i];
        if ((b & 0x0f) % 2 === 1) {
            out[i] = b ^ 0xa5;
        } else {
            out[i] = b ^ 0xef;
        }
    }
    return out.toString('utf-8');
}

/**
 * 从一段文本中取出最后一次出现的唤取 URL。
 */
function extractGachaUrl(text) {
    if (!text) return null;
    GACHA_URL_REGEX.lastIndex = 0;
    const matches = text.match(GACHA_URL_REGEX);
    if (!matches || matches.length === 0) return null;
    // 取最后一个，即最近一次打开的唤取记录页
    return matches[matches.length - 1];
}

/**
 * 参考项目解析顺序：
 *  1) 先对原文做 XOR 解密后取 URL；
 *  2) 取不到再用「未解密原文」直接 utf-8 解析取 URL（部分日志未混淆）。
 */
function extractFromBuffer(buffer) {
    if (!buffer) return null;

    // 1) XOR 解密后尝试
    try {
        const decoded = decodeXor(buffer);
        const url = extractGachaUrl(decoded);
        if (url) return url;
    } catch (e) { /* ignore */ }

    // 2) 原文（utf-8）直接尝试
    try {
        const raw = buffer.toString('utf-8');
        const url = extractGachaUrl(raw);
        if (url) return url;
    } catch (e) { /* ignore */ }

    return null;
}

/**
 * 判断某个目录是否是有效的游戏根目录。
 */
function isGameDir(dir) {
    if (!dir) return false;
    try {
        if (!fs.existsSync(dir)) return false;
        return LOG_RELATIVE_PATHS.some((rel) => fs.existsSync(path.join(dir, rel)))
            || fs.existsSync(path.join(dir, 'Client'))
            || fs.existsSync(path.join(dir, 'Wuthering Waves.exe'));
    } catch (e) {
        return false;
    }
}

/**
 * 从注册表读取游戏安装路径（国服客户端会写 InstallPath）。
 */
function queryRegistryPath() {
    return new Promise((resolve) => {
        const cmd = 'reg query "HKEY_CURRENT_USER\\Software\\Kuro Game\\Wuthering Waves" /s';
        exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
            if (match && match[1]) {
                return resolve(match[1].trim());
            }
            resolve(null);
        });
    });
}

/**
 * 定位游戏目录：已保存路径 → 注册表 → 常见盘符扫描。
 * @param {string} [savedPath] 用户在设置中手动选择的游戏路径
 */
async function locateGameDir(savedPath) {
    // 1. 用户手动指定
    if (savedPath) {
        const normalized = savedPath.replace(/[\\/]+$/, '');
        if (isGameDir(normalized)) return normalized;
        // 用户可能选到了 exe 或上级目录
        const parent = path.dirname(normalized);
        if (isGameDir(parent)) return parent;
        const child = path.join(normalized, 'Wuthering Waves Game');
        if (isGameDir(child)) return child;
    }

    // 2. 注册表
    try {
        const regPath = await queryRegistryPath();
        if (regPath) {
            if (isGameDir(regPath)) return regPath;
            const child = path.join(regPath, 'Wuthering Waves Game');
            if (isGameDir(child)) return child;
        }
    } catch (e) { /* ignore */ }

    // 3. 常见盘符扫描
    for (const drive of DRIVES) {
        for (const dir of COMMON_INSTALL_DIRS) {
            const full = path.join(`${drive}:\\`, dir.replace(/\//g, path.sep));
            if (isGameDir(full)) return full;
        }
    }

    return null;
}

/**
 * 从游戏日志中获取唤取记录 URL。
 * @param {string} [savedPath] 设置中保存的游戏路径（可选）
 * @returns {Promise<{success:boolean, url?:string, gameDir?:string, error?:string}>}
 */
async function getGachaUrlFromGameLogs(savedPath) {
    const gameDir = await locateGameDir(savedPath);
    if (!gameDir) {
        return {
            success: false,
            error: '未找到鸣潮安装目录，请在设置中手动指定游戏路径后重试',
        };
    }

    for (const rel of LOG_RELATIVE_PATHS) {
        const logPath = path.join(gameDir, rel.replace(/\//g, path.sep));
        if (!fs.existsSync(logPath)) continue;
        const buffer = readSharedFile(logPath);
        const url = extractFromBuffer(buffer);
        if (url) {
            return { success: true, url, gameDir };
        }
    }

    return {
        success: false,
        gameDir,
        error: '未在游戏日志中找到唤取记录链接，请先在游戏内打开一次「唤取记录」页面后重试',
    };
}

module.exports = {
    getGachaUrlFromGameLogs,
    locateGameDir,
    extractGachaUrl,
    decodeXor,
    readSharedFile,
};
