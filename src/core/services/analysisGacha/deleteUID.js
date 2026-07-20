
const { db2 } = require('../../app/database'); // 引入数据库
const { ipcMain } = require('electron');

ipcMain.handle('delete-gacha-records', async (event, uid) => {
    try {
        const table = 'gacha_logs'; // 当前仅支持抽卡记录表，前端传入的 table 参数已无意义
        const query = `DELETE FROM ${table} WHERE player_id = ?`;
        await new Promise((resolve, reject) => {
            db2.run(query, [uid], function (err) {
                if (err) reject(err);
                else resolve();
            });
        });
        return { success: true, message: `UID: ${uid} 的记录已成功从表 ${table} 中删除` };
    } catch (error) {
        return { success: false, message: `删除失败: ${error.message}` };
    }
});
