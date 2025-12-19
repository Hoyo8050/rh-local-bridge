/**
 * layout.js
 * 负责页面布局交互：侧边栏折叠、页面切换、日志框操作、系统控制
 * 修复版：Step 59 - 适配右侧悬浮折叠手柄
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. 左侧边栏折叠 ---
    const sidebarLeft = document.getElementById('sidebar-left');
    const toggleLeftBtn = document.getElementById('toggle-left');
    
    toggleLeftBtn.addEventListener('click', () => {
        sidebarLeft.classList.toggle('collapsed');
    });

    // --- 2. 页面导航切换 ---
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active')); 
            pages.forEach(p => p.classList.add('hidden'));    

            item.classList.add('active');
            const targetId = item.dataset.target;
            const targetPage = document.getElementById(targetId);
            if (targetPage) {
                targetPage.classList.remove('hidden');
                targetPage.classList.add('active');
            }
        });
    });

    // --- 3. 右侧边栏折叠 (新版手柄) ---
    const sidebarRight = document.getElementById('sidebar-right');
    const toggleHandle = document.getElementById('sidebar-toggle-handle');
    
    if(toggleHandle) {
        toggleHandle.addEventListener('click', () => {
            sidebarRight.classList.toggle('collapsed');
        });
    }

    // --- 4. 底部日志框交互 ---
    const btnShowLog = document.getElementById('btn-show-log');
    const modalLog = document.getElementById('modal-log');
    const btnLogClose = document.getElementById('btn-log-close');
    const btnLogPin = document.getElementById('btn-log-pin');
    
    let isLogPinned = false;

    btnShowLog.addEventListener('click', () => modalLog.classList.remove('hidden'));

    btnLogClose.addEventListener('click', () => {
        modalLog.classList.add('hidden');
        isLogPinned = false;
        btnLogPin.textContent = '📌 固定';
        btnLogPin.classList.remove('active');
    });

    btnLogPin.addEventListener('click', () => {
        isLogPinned = !isLogPinned;
        if (isLogPinned) {
            btnLogPin.textContent = '📌 已固定';
            btnLogPin.style.color = 'var(--primary-color)';
        } else {
            btnLogPin.textContent = '📌 固定';
            btnLogPin.style.color = '';
        }
    });

    modalLog.addEventListener('click', (e) => {
        if (e.target === modalLog && !isLogPinned) {
            modalLog.classList.add('hidden');
        }
    });

    // --- 5. 系统控制 (退出 & 重启) ---
    
    const checkServerAlive = async () => {
        try {
            await fetch('/', { method: 'HEAD', cache: 'no-cache' });
            return true;
        } catch (e) {
            return false;
        }
    };

    const waitForRestart = async () => {
        let attempts = 0;
        const maxAttempts = 30; 
        
        const interval = setInterval(async () => {
            attempts++;
            const alive = await checkServerAlive();
            if (alive) {
                clearInterval(interval);
                location.reload(); 
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                alert("重启超时，请手动刷新页面或检查终端。");
                location.reload();
            }
        }, 1000); 
    };

    const sendSystemCommand = async (action) => {
        try {
            await fetch('/api/system/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action })
            });

            if (action === 'restart') {
                document.getElementById('modal-restart').classList.remove('hidden');
                setTimeout(waitForRestart, 2000);
            } else {
                setTimeout(() => {
                    window.close();
                    document.body.innerHTML = `
                        <div style="display:flex;height:100vh;align-items:center;justify-content:center;background:#f0f2f5;flex-direction:column;gap:20px;">
                            <h1 style="color:#333;">系统已停止</h1>
                            <p style="color:#666;">您可以关闭此标签页了。</p>
                        </div>
                    `;
                }, 500);
            }
        } catch (e) {
            alert("连接服务器失败");
        }
    };

    document.getElementById('btn-exit').addEventListener('click', () => {
        if(confirm('确定要停止运行并退出应用吗？')) {
            sendSystemCommand('exit');
        }
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
        if(confirm('确定要重启系统吗？')) {
            sendSystemCommand('restart');
        }
    });
});