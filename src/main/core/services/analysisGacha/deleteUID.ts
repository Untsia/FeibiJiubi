const { db2 } = require('../../app/database'); // 引入数据库
const { ipcMain } = require('electron');
// 删除 gacha_logs 后失效 get-gacha-records 内存缓存，避免后续查询返回已删账号的旧数据
const { invalidate } = require('./gachaRecordsCache');

ipcMain.handle('delete-gacha-records', async (event: any, uid: any): Promise<any> => {
    try {
        // gacha_logs.player_id 列存的是 TEXT 字符串；若转 Number 绑定成 INTEGER，
        // SQLite 类型比较永不相等，DELETE 匹配 0 行却仍返回「删除成功」，导致数据删不掉。
        // 必须用 String 绑定（与 analysisIpc get-gacha-records 的处理保持一致）。
        const pid = uid != null && uid !== '' ? String(uid) : null;
        if (pid === null) {
            return { success: false, message: `删除失败: 无效的玩家 UID（${uid}）` };
        }
        const query = `DELETE FROM gacha_logs WHERE player_id = ?`;
        db2.prepare(query).run(pid);
        invalidate(); // 记录被删除，缓存失效
        return { success: true, message: `UID: ${uid} 的记录已成功从表 gacha_logs 中删除` };
    } catch (error) {
        return { success: false, message: `删除失败: ${(error as Error).message}` };
    }
});