function openModal(modal) {
    modal.style.display = 'flex'; // 显示模态窗口
    modal.classList.add('fade-in');
    modal.classList.remove('fade-out');
}

function closeModal(modal) {
    modal.classList.remove('fade-in');
    modal.classList.add('fade-out');
    setTimeout(() => {
        modal.style.display = 'none'; // 延迟隐藏，等待动画完成
    }, 300); // 时间与动画持续时间一致
}
