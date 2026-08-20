function animationMessage(success, message) {
    // 创建浮窗
    const notification = document.createElement('div');
    notification.classList.add('notification');  // 默认样式
    notification.innerText = message;

    if (success) {
        notification.classList.add('success');  // 成功消息
    } else {
        notification.classList.add('fail');  // 失败消息
    }
    if (message.length > 50) {
        notification.classList.add('overflow');
    }

    // 添加浮窗到 body（先移除上一次的浮窗，避免叠加常驻）
    const prev = document.querySelector('.notification');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    document.body.appendChild(notification);

    // 鼠标悬浮时显示提示，并显示复制提示
    notification.addEventListener('mouseenter', (event) => {
        showCopyTooltip(event, '点击以复制');
    });

    // 点击复制内容
    notification.addEventListener('click', (event) => {
        const textToCopy = message;
        navigator.clipboard.writeText(textToCopy).then(() => {
            // 复制成功后，显示鼠标旁边的提示
            showCopyTooltip(event, '已复制！');
        }).catch((err) => {
            console.error('复制失败:', err);
            showCopyTooltip(event, '复制失败！！');
        });
    });

    // 即时显示浮窗，无延迟
    notification.style.top = '42px';
    notification.style.opacity = '1';

    // 自动隐藏：避免提示框一直常驻显示，3.6 秒后滑出并移除（同时防止多次同步堆叠）
    window.__syncNotiTimer && clearTimeout(window.__syncNotiTimer);
    window.__syncNotiTimer = setTimeout(() => {
        notification.style.top = '-120px';
        notification.style.opacity = '0';
        setTimeout(() => { notification.parentNode && notification.parentNode.removeChild(notification); }, 500);
    }, 3600);
}

function showCopyTooltip(event, copyMessage) {
    const tooltip = document.createElement('div');
    tooltip.classList.add('copy-tooltip');
    tooltip.innerText = copyMessage;

    // 获取鼠标的坐标
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    tooltip.style.left = `${mouseX + 10}px`;
    tooltip.style.top = `${mouseY + 10}px`;

    document.body.appendChild(tooltip);
    tooltip.classList.add('show'); // 即时显示，无延迟

    // 即时移除，无 1 秒等待
    setTimeout(() => {
        document.body.removeChild(tooltip);
    }, 100);
}


const socket = new WebSocket('ws://localhost:22334');  // 连接到 WebSocket 服务器

// 监听服务器发送的消息
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    animationMessage(data.success, data.message);
};
