const WebSocket = require('ws');

// 监听端口 22334
const wss = new WebSocket.Server({ port: 22334 });

// 存储 WebSocket 连接的客户端
let connectedClient = null;
wss.on('connection', (ws) => {
    console.log('通知系统已启用');
    connectedClient = ws;
    // 在连接时，前端可以接收到初始化的消息
    // ws.send(JSON.stringify({ success: true, message: '已连接到服务器' }));
    // 监听关闭事件
    ws.on('close', () => {
        console.log('通知系统已断开');
        connectedClient = null; // 清空连接
    });
});

// 将消息推送到前端
global.Notify = (success, message) => {
    const updatedData = { success, message };
    if (connectedClient) {
        connectedClient.send(JSON.stringify(updatedData));
    }
};
