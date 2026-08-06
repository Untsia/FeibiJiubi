
const { db2 } = require('../../app/database'); // 引入数据库
const { ipcMain } = require('electron');

ipcMain.handle('delete-gacha-records', async (event, uid) => {
    try {
        // player_id 列是 INTEGER，前端传入的 uid 来自 dataset 是字符串，转 Number 确保绑定匹配
        const pid = uid != null && uid !== '' ? Number(uid) : null;
        if (pid === null || Number.isNaN(pid)) {
            return { success: false, message: `删除失败: 无效的玩家 UID（${uid}）` };
        }
        const query = `DELETE FROM gacha_logs WHERE player_id = ?`;
        await new Promise((resolve, reject) => {
            db2.run(query, [pid], function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
        return { success: true, message: `UID: ${uid} 的记录已成功从表 gacha_logs 中删除` };
    } catch (error) {
        return { success: false, message: `删除失败: ${error.message}` };
    }
});
