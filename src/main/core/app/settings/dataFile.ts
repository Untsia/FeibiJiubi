// 数据目录配置：FEIBIJIUBI_FOLDER_PATH 设置、自定义路径读写、启动清理与 IPC
// 原 src/core/app/settings/dataFile.js → TypeScript 迁移，行为逐行保持一致。
const fs = require('fs');
const { app, ipcMain, dialog } = require('electron');
const path = require('path');

// 获取用户数据文件夹路径
const userDataPath: string = app.getPath('userData');
const customPathFile: string = path.join(userDataPath, 'customDataPath.json');

// 默认路径
const defaultDataPath: string = path.join(userDataPath, 'FeibiJiubi');

// 确保默认路径存在
if (!fs.existsSync(defaultDataPath)) {
    fs.mkdirSync(defaultDataPath, { recursive: true });
}

// 获取当前数据路径函数
function getDataPath(): string {
    if (fs.existsSync(customPathFile)) {
        try {
            const { currentPath } = JSON.parse(fs.readFileSync(customPathFile, 'utf-8'));
            if (fs.existsSync(currentPath)) {
                return currentPath;
            }
        } catch (error) {
            console.error('读取自定义路径失败，使用默认路径:', (error as Error).message);
        }
    }
    return defaultDataPath;
}

// 初始化数据路径
process.env.FEIBIJIUBI_FOLDER_PATH = getDataPath();

// 确保头像目录存在：<数据目录>/gacha_avatars 是用户手动放置角色/武器头像图片的
// 约定位置（gachaAvatarIpc 只在该目录有文件时才会生成头像 URL，否则回退星级文字）。
const avatarDir: string = path.join(process.env.FEIBIJIUBI_FOLDER_PATH, 'gacha_avatars');
if (!fs.existsSync(avatarDir)) {
    try { fs.mkdirSync(avatarDir, { recursive: true }); } catch (e) {
        console.error('创建头像目录失败:', (e as Error).message);
    }
}

// 保存配置文件函数
function savePathConfig({ currentPath, toDeletePath }: { currentPath: string; toDeletePath: string | null }): void {
    const config = { currentPath, toDeletePath };
    fs.writeFileSync(customPathFile, JSON.stringify(config), 'utf-8');
}

// 复制文件夹函数（递归复制并覆盖已有文件；fs.cp 语义与 fs-extra.copy 等价）
async function copyFeibiJiubiFolder(source: string, destination: string): Promise<void> {
    try {
        await fs.promises.cp(source, destination, { recursive: true, force: true });
        console.log(`成功将文件夹从 ${source} 复制到 ${destination}`);
    } catch (error) {
        console.error(`文件夹复制失败: ${(error as Error).message}`);
        // 如果复制失败，删除目标文件夹
        try {
            await fs.promises.rm(destination, { recursive: true, force: true });
            console.log(`复制失败后清理目标文件夹: ${destination}`);
        } catch (cleanupError) {
            console.error(`清理目标文件夹失败: ${(cleanupError as Error).message}`);
        }
        throw new Error(`文件夹复制失败\n${(error as Error).message}`);
    }
}

// 删除文件夹函数
/** 删除数据文件夹；返回是否删除成功（失败不抛，交由调用方决定是否重试）。 */
async function deleteFeibiJiubiFolder(folderPath: string): Promise<boolean> {
    try {
        await fs.promises.rm(folderPath, { recursive: true, force: true });
        console.log(`成功删除文件夹: ${folderPath}`);
        return true;
    } catch (error) {
        console.error(`删除文件夹失败: ${(error as Error).message}`);
        return false;
    }
}

// 启动时检查并删除上一次路径
async function deletePreviousPathOnStartup(): Promise<void> {
    if (fs.existsSync(customPathFile)) {
        try {
            const { toDeletePath, currentPath } = JSON.parse(fs.readFileSync(customPathFile, 'utf-8'));
            if (toDeletePath && toDeletePath !== currentPath && fs.existsSync(toDeletePath)) {
                console.log(`正在删除上一次路径: ${toDeletePath}`);
                // 原先未 await：删除还没完成就清掉了 toDeletePath 配置，
                // 一旦删除失败，这个待删目录就再也不会被重试清理，残留到用户磁盘上。
                // 改为等待结果，仅在成功时清除配置；失败则保留，下次启动继续尝试。
                const ok = await deleteFeibiJiubiFolder(toDeletePath);
                if (ok) {
                    savePathConfig({ currentPath, toDeletePath: null });
                } else {
                    console.warn(`上一次路径删除未完成，保留待删记录下次重试: ${toDeletePath}`);
                }
            }
        } catch (error) {
            console.error('删除上一次路径失败:', (error as Error).message);
        }
    }
}

// 在应用启动时调用
// 函数内部已完整 try-catch（不会 reject），顶层调用加 catch 仅为兜底，避免静默失败。
deletePreviousPathOnStartup().catch((e: unknown) => {
    console.error('启动时清理旧路径异常:', (e as Error)?.message);
});

// IPC 事件处理
// 选择自定义路径
ipcMain.handle('browse-dataFile', async (): Promise<any> => {
    let currentPath: string = process.env.FEIBIJIUBI_FOLDER_PATH as string; // 获取当前路径
    // 检查路径是否存在，不存在则设置为默认路径
    if (!fs.existsSync(currentPath)) {
        currentPath = app.getPath('userData');
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: currentPath
    });
    if (canceled || filePaths.length === 0) {
        return { success: false, message: '路径选择取消' };
    }

    const selectedBasePath: string = filePaths[0];
    const newFeibiJiubiPath: string = path.join(selectedBasePath, 'FeibiJiubi');

    if (currentPath !== newFeibiJiubiPath) {
        // 检查目标路径是否已存在 菲比啾比 文件夹
        if (fs.existsSync(newFeibiJiubiPath)) {
            const choice = dialog.showMessageBoxSync({
                type: 'question',
                title: '检测到已有数据',
                message: `目标路径已存在 菲比啾比 文件夹，是否直接使用此数据文件夹？\n选择“否”将覆盖目标路径数据。`,
                buttons: ['是', '否'],
                defaultId: 0,
            });

            if (choice === 0) {
                // 用户选择直接使用
                savePathConfig({ currentPath: newFeibiJiubiPath, toDeletePath: null });
                app.relaunch();
                app.exit();
                return { success: true, path: newFeibiJiubiPath, message: '路径已切换，正在重启应用...' };
            }
        }

        // 用户选择覆盖或目标路径不存在
        try {
            // 确保目标路径存在
            fs.mkdirSync(newFeibiJiubiPath, { recursive: true });

            // 复制文件夹到新路径
            await copyFeibiJiubiFolder(currentPath, newFeibiJiubiPath);

            // 保存路径配置
            savePathConfig({ currentPath: newFeibiJiubiPath, toDeletePath: currentPath });

            // 重新启动应用
            app.relaunch();
            app.exit();

            return { success: true, path: newFeibiJiubiPath, message: '路径已更新，正在重启应用...' };
        } catch (error) {
            console.error(`路径切换失败: ${(error as Error).message}`);
            return { success: false, message: `路径切换失败: ${(error as Error).message}` };
        }
    }

    return { success: true, path: newFeibiJiubiPath };
});

// 恢复默认路径
ipcMain.handle('reset-dataFile', async (): Promise<any> => {
    const currentPath: string = process.env.FEIBIJIUBI_FOLDER_PATH as string;
    if (currentPath !== defaultDataPath) {
        try {
            // 确保默认路径存在
            fs.mkdirSync(defaultDataPath, { recursive: true });

            // 复制文件夹到默认路径
            await copyFeibiJiubiFolder(currentPath, defaultDataPath);

            // 保存路径配置
            savePathConfig({ currentPath: defaultDataPath, toDeletePath: currentPath });

            // 重新启动应用
            app.relaunch();
            app.exit();

            return { success: true, path: defaultDataPath, message: '已恢复默认路径，正在重启应用...' };
        } catch (error) {
            console.error('恢复默认路径失败:', (error as Error).message);
            return { success: false, message: `恢复默认路径失败: ${(error as Error).message}` };
        }
    }

    return { success: true, path: defaultDataPath };
});

// 获取当前路径
ipcMain.handle('get-dataFile-path', async (): Promise<any> => {
    return { path: getDataPath() };
});

// 选择鸣潮游戏根目录（用于无需启动器读取本地账号状态）
ipcMain.handle('browse-game-path', async (event: any, currentPath: string): Promise<any> => {
    // 默认打开当前输入框里显示的路径；为空或不存在时默认打开 C 盘根目录
    let defaultPath: string = process.platform === 'win32' ? 'C:\\' : app.getPath('home');
    if (currentPath && fs.existsSync(currentPath)) {
        defaultPath = currentPath;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择鸣潮游戏目录（含 Wuthering Waves.exe 的文件夹）',
        properties: ['openDirectory'],
        defaultPath,
    });
    if (canceled || filePaths.length === 0) {
        return { success: false, message: '已取消' };
    }
    return { success: true, path: filePaths[0] };
});