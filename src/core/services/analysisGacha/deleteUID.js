const { db2 } = require('../../app/database'); // 引入数据库
const { ipcMain } = require('electron');
// 删除 gacha_logs 后失效 get-gacha-records 内存缓存，避免后续查询返回已删账号的旧数据
const { invalidate } = require('./gachaRecordsCache');

ipcMain.handle('delete-gacha-records', async (event, uid) => {
    try {
        // player_id 列是 INTEGER，前端传入的 uid 来自 dataset 是字符串，转 Number 确保绑定匹配
        const pid = uid != null && uid !== '' ? Number(uid) : null;
        if (pid === null || Number.isNaN(pid)) {
            return { success: false, message: `删除失败: 无效的玩家 UID（${uid}）` };
        }
        const query = `DELETE FROM gacha_logs WHERE player_id = ?`;
        db2.prepare(query).run(pid);
        invalidate(); // 记录被删除，缓存失效
        return { success: true, message: `UID: ${uid} 的记录已成功从表 gacha_logs 中删除` };
    } catch (error) {
        return { success: false, message: `删除失败: ${error.message}` };
    }
});
