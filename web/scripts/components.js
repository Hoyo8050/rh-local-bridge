/**
 * components.js
 * 核心业务逻辑：API配置、动态表单生成、作品库、任务管理（持久化版）
 * 修复版：补全了数据读取逻辑 (localStorage)，防止刷新后任务丢失
 */

const State = {
    apiKey: '', 
    pollInterval: 5000,
    pollingTimer: null,
    runningTasksList: [], 
    galleryType: 'images',
    taskCount: 1 // [新增] 默认为 1并发
};

// --- 全局参数缓存系统 (自动保存，手动恢复) ---
const ParamCache = {}; // 结构: { appId: { nodeId: value } }
const FileCache = {};  // 结构: { appId: { nodeId: {file, type, name} } }

// [新增] 注入"输入上次参数"按钮
function injectRestoreButton(panelId, onRestore) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const header = panel.querySelector('.panel-left .panel-header');
    
    // 避免重复添加
    if (!header || header.querySelector('.btn-restore-params')) return;

    const btn = document.createElement('button');
    btn.className = 'btn btn-xs btn-outline btn-restore-params';
    btn.innerHTML = '📝 输入上次参数';
    btn.title = '点击恢复最后一次输入或调整过的参数（包括文件）';
    btn.style.marginLeft = 'auto'; // 靠右对齐
    
    btn.onclick = (e) => {
        e.stopPropagation();
        // 添加点击动画反馈
        btn.innerHTML = '✅ 已恢复';
        setTimeout(() => btn.innerHTML = '📝 输入上次参数', 1000);
        
        if (onRestore) onRestore();
    };

    header.appendChild(btn);
}

const TASK_STORAGE_KEY = 'rh_running_tasks_list';
const PRESET_STORAGE_KEY = 'rh_api_presets';

// 预设数据
const DEFAULT_PRESETS = {
    'image': [ { name: '文生图', id: '1972171722227118082' }, { name: '抠图', id: '1972141434415607809' }, { name: '去水印', id: '1971901205893083137' }, { name: '图像编辑', id: '1971883472233164802' }, { name: '移除物体', id: '1972175940140855297' }, { name: '扩图', id: '1971887893172187137' }, { name: '高清修复', id: '1971882348050640898' } ],
    'video': [ { name: '文生视频', id: '1984184222476894209' }, { name: '图生视频', id: '1984180029229826049' }, { name: '首尾帧', id: '1984190601447030785' }, { name: '图像转场', id: '1984250791320043522' } ],
    'text': [ { name: '图像反推', id: '1984225115963539457' }, { name: '文本润色', id: '1984237406851317761' }, { name: '文本翻译', id: '1984230192287793154' } ],
    'audio': [ { name: '音乐生成', id: '1984256264186249217' }, { name: '声音克隆', id: '1984213488316858370' } ]
};

// 全局变量
let GlobalPresets = JSON.parse(localStorage.getItem('rh_presets_config') || 'null');
if (!GlobalPresets) {
    GlobalPresets = JSON.parse(JSON.stringify(DEFAULT_PRESETS)); // 深拷贝默认值
    localStorage.setItem('rh_presets_config', JSON.stringify(GlobalPresets));
}
let savedTasks = JSON.parse(localStorage.getItem('rh_saved_tasks') || '[]'); 
let isManagementMode = false; 
let editingTaskIndex = -1;    
let editingNodeInfoList = []; 
let activeNodeInfoList = [];
let activeWebappId = '';
let activeTaskName = ''; 
let fileInputs = {}; 
let currentPresetName = '';
let currentPreviewTaskIndex = -1; // 当前预览的任务索引

// [新增] 参数草稿箱 (内存存储，重启即焚)
const ParamDrafts = {
    new: {},    // 存储新建任务的参数: { taskIndex: { nodes: [], files: {} } }
    preset: {}  // 存储预设任务的参数: { appId: { nodes: [], files: {} } }
};
// [新增] 追踪上一次激活的任务 ID，用于离开时保存
let lastActivePresetId = null;
let lastActiveNewTaskIndex = -1;

// --- 工具函数：时间格式化 ---

function formatDateTime(timestamp) {
    if (!timestamp) return '--';
    const d = new Date(timestamp);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// --- 核心初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("✅ Components.js loaded (Full Restore)");

    // --- 数据清洗 ---
    if (!localStorage.getItem('rh_v2_init')) {
        localStorage.removeItem('rh_running_tasks'); 
        localStorage.setItem('rh_v2_init', 'true');
    }

    // --- [重要修复] 恢复任务列表读取逻辑 ---
    try {
        const savedList = localStorage.getItem(TASK_STORAGE_KEY);
        if (savedList) {
            State.runningTasksList = JSON.parse(savedList);
            console.log(`📂 已恢复 ${State.runningTasksList.length} 个历史任务`);
        }
    } catch (e) {
        console.error("读取任务列表失败", e);
        State.runningTasksList = [];
    }

    // --- 安全初始化各个模块 ---
    const safeInit = (fn, name) => { 
        try { fn(); } catch(e) { console.error(`${name} 初始化失败:`, e); } 
    };

    safeInit(initApiKeySection, 'API区');
    safeInit(initConcurrencySettings, '并发设置'); // [新功能]
    safeInit(initAccountPolling, '轮询');
    safeInit(initNewTaskSection, '新建任务区');
    safeInit(initPresetTaskSection, '预设任务区');
    safeInit(initPresetKeyManager, '配置管理');    // [新功能]
    safeInit(initGallerySection, '作品库');
    safeInit(initTaskNavigation, '任务导航');
    
    // 渲染 UI
    renderSidebarTaskItems();
    restartPendingTasksPolling();

    // 初始化 API Key 显示
    const keyInput = document.getElementById('input-api-key');
    if (keyInput) {
        keyInput.value = '';
        State.apiKey = '';
        updateKeyDisplay(false);
    }

    // [新增] 页面加载完成后，立即检查一次是否有候补任务需要启动
    // (防止刷新页面后，有空位但候补任务卡住)
    setTimeout(processPendingQueue, 1000);
});

// --- [新功能] 并发设置初始化 ---
// [修改] 并发设置初始化：增加持久化记忆 + 切换时触发队列
function initConcurrencySettings() {
    const group = document.getElementById('concurrency-group');
    if (!group) return;

    const btns = group.querySelectorAll('.btn-concurrency');
    
    // 1. 读取本地缓存的并发数，如果没有则默认为 1
    const savedCount = localStorage.getItem('rh_concurrency_count');
    if (savedCount) {
        State.taskCount = parseInt(savedCount);
    } else {
        State.taskCount = 1;
    }

    // 2. 根据 State.taskCount 更新 UI 高亮状态
    btns.forEach(btn => {
        const val = parseInt(btn.dataset.val);
        if (val === State.taskCount) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        
        // 绑定点击事件
        btn.onclick = () => {
            // UI 更新
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // 状态更新并保存
            State.taskCount = parseInt(btn.dataset.val);
            localStorage.setItem('rh_concurrency_count', State.taskCount);
            console.log(`并发数已设置为: ${State.taskCount}`);
            
            // [核心新增] 并发数变大后，立即检查是否有候补任务可以运行
            processPendingQueue();
        };
    });
}

// --- [新功能] 配置管理器 (含并发数支持) ---
function initPresetKeyManager() {
    const btnSavePreset = document.getElementById('btn-save-preset');
    const modalSave = document.getElementById('modal-save-preset');
    const inputPresetName = document.getElementById('input-preset-name');
    const btnSaveConfirm = document.getElementById('btn-save-preset-confirm');
    const btnSaveCancel = document.getElementById('btn-save-preset-cancel');
    
    const btnApplyPreset = document.getElementById('btn-apply-preset');
    const modalApply = document.getElementById('modal-apply-preset');
    const presetListArea = document.getElementById('preset-list-area');
    const btnApplyConfirm = document.getElementById('btn-apply-preset-confirm');
    const btnApplyCancel = document.getElementById('btn-apply-preset-cancel');
    
    let selectedPresetData = null; 

    // --- 保存配置 ---
    if(btnSavePreset) btnSavePreset.addEventListener('click', () => {
        const currentKey = document.getElementById('input-api-key').value;
        if (!currentKey || currentKey.length !== 32) {
            alert("请先在输入框填入有效的 32 位 API 密钥");
            return;
        }
        inputPresetName.value = '';
        modalSave.classList.remove('hidden');
        inputPresetName.focus();
    });

    if(btnSaveConfirm) btnSaveConfirm.addEventListener('click', () => {
        const name = inputPresetName.value.trim();
        const key = document.getElementById('input-api-key').value;
        
        // 获取当前选中的并发数
        const activeConcurrencyBtn = document.querySelector('#concurrency-group .btn-concurrency.active');
        const currentTaskCount = activeConcurrencyBtn ? parseInt(activeConcurrencyBtn.dataset.val) : 1;

        if (!name) return alert("请输入配置名称");
        
        const presets = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]');
        
        presets.push({ 
            name: name, 
            key: key, 
            taskCount: currentTaskCount, 
            date: Date.now() 
        });
        
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
        
        // 关闭弹窗并显示轻提示
        modalSave.classList.add('hidden');
        showGlobalToast(`✅ "${name}" 保存成功`);
    });

    if(btnSaveCancel) btnSaveCancel.addEventListener('click', () => modalSave.classList.add('hidden'));

    // --- 应用配置 ---
    if(btnApplyPreset) btnApplyPreset.addEventListener('click', () => {
        renderPresetList();
        selectedPresetData = null;
        modalApply.classList.remove('hidden');
    });

    function renderPresetList() {
        const presets = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]');
        if(!presetListArea) return;
        presetListArea.innerHTML = '';
        
        if (presets.length === 0) {
            presetListArea.innerHTML = '<div class="empty-tip">暂无保存的配置</div>';
            return;
        }

        presets.forEach((p, index) => {
            const maskedKey = p.key.substring(0, 4) + '●'.repeat(24) + p.key.substring(28);
            const count = p.taskCount || 1;

            const card = document.createElement('div');
            card.className = 'preset-card';
            
            // HTML 结构：将名称和并发数分开
            card.innerHTML = `
                <div class="preset-card-header">
                    <div class="preset-name-group">
                        <span class="preset-card-name">${p.name}</span>
                        <span class="preset-concurrency-badge">${count}并发</span>
                    </div>
                    <span class="btn-delete-preset" title="删除">🗑️</span>
                </div>
                <div class="preset-card-key">${maskedKey}</div>
            `;
            
            card.onclick = (e) => {
                if (e.target.classList.contains('btn-delete-preset')) return;
                presetListArea.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedPresetData = p;
            };

            card.querySelector('.btn-delete-preset').onclick = () => {
                if(confirm(`确定删除配置 "${p.name}" 吗？`)) {
                    presets.splice(index, 1);
                    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
                    renderPresetList();
                    selectedPresetData = null;
                }
            };
            presetListArea.appendChild(card);
        });
    }

    if(btnApplyConfirm) btnApplyConfirm.addEventListener('click', () => {
        if (!selectedPresetData) return showGlobalToast("请先选择一个配置");
        
        // 1. 应用 API Key
        const inputKey = document.getElementById('input-api-key');
        inputKey.value = selectedPresetData.key;
        inputKey.dispatchEvent(new Event('input'));

        // 2. 应用并发数
        const targetCount = selectedPresetData.taskCount || 1;
        const btns = document.querySelectorAll('#concurrency-group .btn-concurrency');
        let found = false;
        btns.forEach(btn => {
            if (parseInt(btn.dataset.val) === parseInt(targetCount)) {
                btn.click(); 
                found = true;
            }
        });
        if (!found && btns.length > 0) btns[0].click();

        modalApply.classList.add('hidden');
        showGlobalToast(`⚡ 已应用: ${selectedPresetData.name}`);
    });

    if(btnApplyCancel) btnApplyCancel.addEventListener('click', () => modalApply.classList.add('hidden'));
}

// --- 全局轻提示工具函数 ---
function showGlobalToast(message, duration = 1500) {
    let toast = document.getElementById('global-toast-container');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast-container';
        toast.className = 'global-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// --- 任务切换导航逻辑 ---
function initTaskNavigation() {
    const btnNewerNew = document.getElementById('btn-task-newer-new');
    const btnOlderNew = document.getElementById('btn-task-older-new');
    const btnNewerPreset = document.getElementById('btn-task-newer-preset');
    const btnOlderPreset = document.getElementById('btn-task-older-preset');

    if(btnNewerNew) btnNewerNew.onclick = () => switchTask(-1);
    if(btnNewerPreset) btnNewerPreset.onclick = () => switchTask(-1);
    if(btnOlderNew) btnOlderNew.onclick = () => switchTask(1);
    if(btnOlderPreset) btnOlderPreset.onclick = () => switchTask(1);

    updateTaskNavButtons();
}

function switchTask(offset) {
    if (currentPreviewTaskIndex === -1 && State.runningTasksList.length > 0) {
        currentPreviewTaskIndex = 0;
    } else {
        currentPreviewTaskIndex += offset;
    }
    if (currentPreviewTaskIndex < 0) currentPreviewTaskIndex = 0;
    if (currentPreviewTaskIndex >= State.runningTasksList.length) currentPreviewTaskIndex = State.runningTasksList.length - 1;

    const targetTask = State.runningTasksList[currentPreviewTaskIndex];
    if (targetTask) {
        updateTaskNavButtons();
        handleTaskCardClick(targetTask);
    }
}

function updateTaskNavButtons() {
    const btnsNewer = document.querySelectorAll('#btn-task-newer-new, #btn-task-newer-preset');
    const btnsOlder = document.querySelectorAll('#btn-task-older-new, #btn-task-older-preset');

    if (State.runningTasksList.length === 0) {
        btnsNewer.forEach(b => b.disabled = true);
        btnsOlder.forEach(b => b.disabled = true);
        return;
    }
    const isNewest = (currentPreviewTaskIndex <= 0);
    btnsNewer.forEach(b => b.disabled = isNewest);
    const isOldest = (currentPreviewTaskIndex >= State.runningTasksList.length - 1);
    btnsOlder.forEach(b => b.disabled = isOldest);
}

function checkApiKey() {
    if (!State.apiKey || State.apiKey.length !== 32) {
        alert("请先输入有效的API Key");
        return false;
    }
    return true;
}

// --- API Key 输入区 ---
function initApiKeySection() {
    const inputKey = document.getElementById('input-api-key');
    const btnToggle = document.getElementById('btn-toggle-key');
    const btnLock = document.getElementById('btn-lock-key');
    const iconCheck = document.getElementById('icon-check');
    const iconError = document.getElementById('icon-error');
    if(!inputKey) return;

    inputKey.addEventListener('input', (e) => {
        const val = e.target.value;
        iconCheck.classList.add('hidden');
        iconError.classList.add('hidden');
        if (State.apiKey) State.apiKey = ''; 
        if (!val) return;
        const isFormatValid = /^[a-z0-9]+$/.test(val);
        if (!isFormatValid) {
            iconError.classList.remove('hidden');
        } else if (val.length > 32) {
            iconError.classList.remove('hidden');
        } else if (val.length === 32) {
            State.apiKey = val;
            localStorage.setItem('rh_api_key', val); 
            iconCheck.classList.remove('hidden');
            if(document.getElementById('switch-polling')?.checked) fetchAccountInfo();
        }
    });

    if(btnToggle) btnToggle.addEventListener('click', () => updateKeyDisplay(inputKey.type === 'password'));
    if(btnLock) btnLock.addEventListener('click', () => {
        inputKey.disabled = !inputKey.disabled;
        if (inputKey.disabled) {
            btnLock.textContent = '🔒'; btnLock.title = "已锁定"; inputKey.style.backgroundColor = '#f5f5f5'; 
        } else {
            btnLock.textContent = '🔓'; btnLock.title = "未锁定"; inputKey.style.backgroundColor = '#fff'; inputKey.focus();
        }
    });
}

function updateKeyDisplay(show) {
    const input = document.getElementById('input-api-key');
    const btn = document.getElementById('btn-toggle-key');
    if(input) input.type = show ? 'text' : 'password';
    if(btn) btn.textContent = show ? '👁️' : '🙈';
}

// --- 预设任务区 ---
function initPresetTaskSection() {
    const tabBtns = document.querySelectorAll('.category-tabs .tab-btn');
    const taskBar = document.getElementById('preset-task-bar');
    const runBtn = document.getElementById('btn-run-preset');
    
    // 管理相关 DOM
    const btnManage = document.getElementById('btn-manage-presets-toggle');
    const modalEdit = document.getElementById('modal-edit-preset-id');
    const inputEditName = document.getElementById('input-edit-preset-name');
    const inputEditId = document.getElementById('input-edit-preset-id');
    const btnEditSave = document.getElementById('btn-edit-preset-save');
    const btnEditCancel = document.getElementById('btn-edit-preset-cancel');
    const btnEditDelete = document.getElementById('btn-edit-preset-delete');

    // 滚动相关 DOM
    const btnScrollLeft = document.getElementById('btn-preset-scroll-left');
    const btnScrollRight = document.getElementById('btn-preset-scroll-right');

    let currentCategory = 'image';
    let currentPresetList = [];
    let currentPresetAppId = '';
    let isPresetManagementMode = false; 
    let editingItemRef = null; 
    let isCreatingNew = false;

    // [修改] 注入"输入上次参数"按钮
    injectRestoreButton('page-preset', () => {
        if (!currentPresetAppId) return alert("请先选择一个功能");
        const appIdStr = String(currentPresetAppId);
        
        const hasParams = ParamCache[appIdStr] && Object.keys(ParamCache[appIdStr]).length > 0;
        const hasFiles = FileCache[appIdStr] && Object.keys(FileCache[appIdStr]).length > 0;
        
        if (!hasParams && !hasFiles) {
            return showGlobalToast && showGlobalToast('⚠️ 暂无该功能的记录');
        }

        // 强制带缓存重绘
        renderMainConfigForm('preset-config-area', currentPresetList, currentPresetAppId, true);
        showGlobalToast && showGlobalToast('📝 参数已恢复');
    });

    // --- 1. 基础 Tab 切换 ---
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.cat;
            renderButtons(currentCategory);
        });
    });

    // --- 2. 渲染任务按钮 ---
    function renderButtons(cat) {
        if(!taskBar) return;
        taskBar.innerHTML = '';
        const items = GlobalPresets[cat] || [];
        
        items.forEach((item, index) => {
            const b = document.createElement('button');
            b.className = 'btn'; 
            if (isPresetManagementMode) {
                b.classList.add('editing-mode');
                b.title = "点击修改";
            }
            b.textContent = item.name;
            b.onclick = () => {
                if (isPresetManagementMode) {
                    openPresetModal(index, item, false);
                } else {
                    if(!checkApiKey()) return; 
                    const allBtns = taskBar.querySelectorAll('button');
                    allBtns.forEach(bt => bt.classList.remove('active'));
                    b.classList.add('active');
                    currentPresetName = item.name; 
                    loadPreset(item.id);
                }
            }
            taskBar.appendChild(b);
        });

        if (isPresetManagementMode) {
            const btnAdd = document.createElement('button');
            btnAdd.className = 'btn btn-add-preset'; 
            btnAdd.innerHTML = '＋'; 
            btnAdd.title = "新增预设任务";
            btnAdd.onclick = () => openPresetModal(null, null, true);
            taskBar.appendChild(btnAdd);
        }

        setTimeout(checkScrollButtons, 50);
    }

    // --- 3. 滚动交互逻辑 ---
    function checkScrollButtons() {
        if (!taskBar) return;
        const tol = 2; // 容差
        const maxScrollLeft = taskBar.scrollWidth - taskBar.clientWidth;
        
        // 左按钮
        if (taskBar.scrollLeft > tol) btnScrollLeft.classList.remove('hidden');
        else btnScrollLeft.classList.add('hidden');

        // 右按钮
        if (maxScrollLeft > 0 && taskBar.scrollLeft < maxScrollLeft - tol) {
            btnScrollRight.classList.remove('hidden');
        } else {
            btnScrollRight.classList.add('hidden');
        }
    }

    if (taskBar) {
        taskBar.addEventListener('scroll', checkScrollButtons);
        window.addEventListener('resize', checkScrollButtons);
    }

    if (btnScrollLeft) {
        btnScrollLeft.onclick = () => {
            taskBar.scrollBy({ left: -200, behavior: 'smooth' });
        };
    }
    if (btnScrollRight) {
        btnScrollRight.onclick = () => {
            taskBar.scrollBy({ left: 200, behavior: 'smooth' });
        };
    }

    // --- 4. 业务逻辑 ---
    async function loadPreset(appId) {
        const configArea = document.getElementById('preset-config-area');
        if(configArea) configArea.innerHTML = '<div class="empty-tip">加载中...</div>';
        const res = await API.getWebappInfo(State.apiKey, appId);
        if(res.code === 0) {
            currentPresetAppId = appId;
            currentPresetList = res.data.nodeInfoList;
            // 默认不恢复缓存
            renderMainConfigForm('preset-config-area', currentPresetList, currentPresetAppId, false);
        } else { 
            alert("加载失败: " + res.msg); 
            if(configArea) configArea.innerHTML = '<div class="empty-tip">加载失败</div>';
        }
    }

    function openPresetModal(index, item, isCreate) {
        isCreatingNew = isCreate;
        const titleEl = modalEdit.querySelector('h3');
        
        if (isCreate) {
            titleEl.textContent = '✨ 新建预设任务';
            inputEditName.value = '';
            inputEditId.value = '';
            editingItemRef = null;
            btnEditDelete.classList.add('hidden'); 
        } else {
            titleEl.textContent = '🛠️ 修改预设任务';
            editingItemRef = { cat: currentCategory, index: index };
            inputEditName.value = item.name;
            inputEditId.value = item.id;
            btnEditDelete.classList.remove('hidden'); 
        }
        modalEdit.classList.remove('hidden');
    }

    if(btnManage) btnManage.addEventListener('click', () => {
        isPresetManagementMode = !isPresetManagementMode;
        
        if (isPresetManagementMode) {
            btnManage.textContent = "✅ 退出管理";
            btnManage.classList.add('active');
            btnManage.classList.remove('btn-outline');
            btnManage.classList.add('btn-warning');
        } else {
            btnManage.textContent = "⚙️ 管理预设";
            btnManage.classList.remove('active');
            btnManage.classList.add('btn-outline');
            btnManage.classList.remove('btn-warning');
        }
        renderButtons(currentCategory);
    });

    if(btnEditSave) btnEditSave.addEventListener('click', () => {
        const newName = inputEditName.value.trim();
        const newId = inputEditId.value.trim();
        
        if (!newName) return alert("请填写任务名称");
        if (!/^\d{19}$/.test(newId)) return alert("格式错误：WebAPP ID 必须是 19 位纯数字！");

        if (isCreatingNew) {
            if (!GlobalPresets[currentCategory]) GlobalPresets[currentCategory] = [];
            GlobalPresets[currentCategory].push({ name: newName, id: newId });
        } else {
            if (editingItemRef) {
                const targetItem = GlobalPresets[editingItemRef.cat][editingItemRef.index];
                targetItem.name = newName;
                targetItem.id = newId;
            }
        }
        saveAndRefresh();
        modalEdit.classList.add('hidden');
    });

    if(btnEditDelete) btnEditDelete.addEventListener('click', () => {
        if (!editingItemRef) return;
        if (confirm(`确定要删除任务 "${inputEditName.value}" 吗？此操作无法撤销。`)) {
            GlobalPresets[editingItemRef.cat].splice(editingItemRef.index, 1);
            saveAndRefresh();
            modalEdit.classList.add('hidden');
        }
    });

    function saveAndRefresh() {
        localStorage.setItem('rh_presets_config', JSON.stringify(GlobalPresets));
        renderButtons(currentCategory);
    }

    if(btnEditCancel) btnEditCancel.addEventListener('click', () => modalEdit.classList.add('hidden'));

    renderButtons('image');
    
    if(runBtn) runBtn.addEventListener('click', () => {
        if(isPresetManagementMode) return alert("请先退出管理模式");
        if(!checkApiKey()) return;
        if(!currentPresetName) currentPresetName = "预设任务";
        handleRunTask('preset-result-canvas', currentPresetList, currentPresetAppId, currentPresetName, 'preset');
    });
}

// --- 轮询模块 ---
function initAccountPolling() {
    const btnQuery = document.getElementById('btn-query-account');
    const switchPoll = document.getElementById('switch-polling');
    const btnSetTime = document.getElementById('btn-set-poll-time');
    const txtStatus = document.getElementById('poll-status-text');
    const modal = document.getElementById('modal-poll-setting');
    const inputInterval = document.getElementById('input-poll-interval');

    if(btnQuery) btnQuery.addEventListener('click', () => {
        if(!checkApiKey()) return;
        fetchAccountInfo();
    });

    if(switchPoll) switchPoll.addEventListener('change', (e) => {
        if(e.target.checked) {
            if(!checkApiKey()) { e.target.checked = false; return; }
            startPolling();
        } else { stopPolling(); }
    });

    if(btnSetTime) btnSetTime.addEventListener('click', () => {
        if(inputInterval) inputInterval.value = State.pollInterval / 1000;
        if(modal) modal.classList.remove('hidden');
    });

    document.getElementById('btn-poll-dec')?.addEventListener('click', () => {
        let v = parseInt(inputInterval.value) || 5;
        if (v > 3) inputInterval.value = v - 1;
    });
    document.getElementById('btn-poll-inc')?.addEventListener('click', () => {
        let v = parseInt(inputInterval.value) || 5;
        if (v < 60) inputInterval.value = v + 1;
    });
    document.getElementById('btn-poll-confirm')?.addEventListener('click', () => {
        let v = parseInt(inputInterval.value);
        if (v >= 3 && v <= 60) {
            State.pollInterval = v * 1000;
            modal.classList.add('hidden');
            if(switchPoll.checked) { stopPolling(); startPolling(); }
            else { txtStatus.textContent = `轮询已关闭 (${v}s/次)`; }
        } else { alert("请输入 3 ~ 60"); }
    });
    document.getElementById('btn-poll-cancel')?.addEventListener('click', () => modal.classList.add('hidden'));

    function startPolling() {
        txtStatus.textContent = `轮询中: ${State.pollInterval/1000}s`;
        txtStatus.classList.add('active');
        fetchAccountInfo();
        if(State.pollingTimer) clearInterval(State.pollingTimer);
        State.pollingTimer = setInterval(fetchAccountInfo, State.pollInterval);
    }

    function stopPolling() {
        const currentSec = State.pollInterval / 1000;
        txtStatus.textContent = `轮询已关闭 (${currentSec}s)`;
        txtStatus.classList.remove('active');
        if(State.pollingTimer) clearInterval(State.pollingTimer);
    }
}

async function fetchAccountInfo() {
    if(!State.apiKey) return;
    const res = await API.getAccountStatus(State.apiKey);
    if(res.code === 0 && res.data) {
        document.getElementById('info-task-count').textContent = res.data.currentTaskCounts;
        document.getElementById('info-coins').textContent = res.data.remainCoins;
        document.getElementById('info-money').textContent = res.data.remainMoney;
        document.getElementById('info-currency').textContent = res.data.currency;
        document.getElementById('info-type').textContent = res.data.apiType;
        const statusEl = document.getElementById('info-task-status');
        if(parseInt(res.data.currentTaskCounts) > 0) {
            statusEl.textContent = '正在运行...';
            statusEl.style.color = 'var(--success-color)';
        } else {
            statusEl.textContent = '空闲中...';
            statusEl.style.color = 'var(--primary-color)';
        }
    }
}

function initNewTaskSection() {
    const btnCreate = document.getElementById('btn-create-task-modal');
    const btnManage = document.getElementById('btn-manage-tasks');
    const modal = document.getElementById('modal-create-task');
    const btnRun = document.getElementById('btn-run-new-task');

    renderTaskBar();
    
    // [修改] 注入"输入上次参数"按钮
    injectRestoreButton('page-new-task', () => {
        if (!activeWebappId) return alert("请先选择一个任务");
        const appIdStr = String(activeWebappId);
        
        // 检查是否有缓存
        const hasParams = ParamCache[appIdStr] && Object.keys(ParamCache[appIdStr]).length > 0;
        const hasFiles = FileCache[appIdStr] && Object.keys(FileCache[appIdStr]).length > 0;
        
        if (!hasParams && !hasFiles) {
            return showGlobalToast && showGlobalToast('⚠️ 暂无该任务的记录');
        }

        // 强制带缓存重绘
        renderMainConfigForm('new-task-config-area', activeNodeInfoList, activeWebappId, true);
        showGlobalToast && showGlobalToast('📝 参数已恢复');
    });

    if(btnManage) btnManage.addEventListener('click', () => {
        isManagementMode = !isManagementMode;
        if(isManagementMode) {
            btnManage.textContent = "退出管理";
            btnManage.classList.remove('btn-outline');
        } else {
            btnManage.textContent = "🛠️ 任务管理";
            btnManage.classList.add('btn-outline');
        }
        renderTaskBar(); 
    });

    if(btnCreate) btnCreate.addEventListener('click', () => openModalForCreate());
    document.getElementById('modal-btn-cancel')?.addEventListener('click', () => modal.classList.add('hidden'));

    const btnDelete = document.getElementById('modal-btn-delete');
    if(btnDelete) btnDelete.addEventListener('click', () => {
        if (editingTaskIndex === -1) return;
        const taskName = savedTasks[editingTaskIndex].name;
        if(confirm(`确定要永久删除任务 "${taskName}" 吗？`)) {
            savedTasks.splice(editingTaskIndex, 1);
            localStorage.setItem('rh_saved_tasks', JSON.stringify(savedTasks));
            renderTaskBar(); 
            modal.classList.add('hidden'); 
        }
    });

    const btnAuto = document.getElementById('modal-btn-auto');
    if(btnAuto) btnAuto.addEventListener('click', async () => {
        if(!checkApiKey()) return; 
        const appId = document.getElementById('modal-webapp-id').value.trim();
        if(!appId) return alert("请输入 AppID");
        
        const oldText = btnAuto.textContent;
        btnAuto.textContent = "获取中...";
        const res = await API.getWebappInfo(State.apiKey, appId);
        btnAuto.textContent = oldText;

        if(res.code === 0 && res.data && res.data.nodeInfoList) {
            editingNodeInfoList = res.data.nodeInfoList;
            document.getElementById('modal-task-name').value = res.data.webappName || '未命名任务';
            renderModalParamsTable();
        } else {
            alert("获取失败: " + res.msg); 
        }
    });

    document.getElementById('modal-btn-save')?.addEventListener('click', () => {
        const taskName = document.getElementById('modal-task-name').value || '未命名任务';
        const appId = document.getElementById('modal-webapp-id').value;
        if(editingNodeInfoList.length === 0) return alert("参数列表为空");
        const taskData = {
            name: taskName, appId: appId,
            nodeInfoList: JSON.parse(JSON.stringify(editingNodeInfoList))
        };
        if (editingTaskIndex === -1) savedTasks.push(taskData);
        else savedTasks[editingTaskIndex] = taskData;
        localStorage.setItem('rh_saved_tasks', JSON.stringify(savedTasks));
        renderTaskBar();
        if (editingTaskIndex === -1) loadTaskToMainUI(taskData);
        modal.classList.add('hidden');
    });

    if(btnRun) btnRun.addEventListener('click', () => {
        if(!checkApiKey()) return;
        const currentTaskName = activeTaskName || "新建任务";
        handleRunTask('new-task-result-canvas', activeNodeInfoList, activeWebappId, currentTaskName, 'new');
    });
}

function loadTaskToMainUI(task) {
    activeNodeInfoList = JSON.parse(JSON.stringify(task.nodeInfoList));
    activeWebappId = task.appId;
    activeTaskName = task.name; 
    // 默认不恢复缓存，仅渲染默认值
    renderMainConfigForm('new-task-config-area', activeNodeInfoList, activeWebappId, false);
}

// 辅助函数：确保传递 activeWebappId
function loadTaskToMainUI(task) {
    activeNodeInfoList = JSON.parse(JSON.stringify(task.nodeInfoList));
    activeWebappId = task.appId;
    activeTaskName = task.name; 
    renderMainConfigForm('new-task-config-area', activeNodeInfoList, activeWebappId);
}


function openModalForCreate() {
    editingTaskIndex = -1;
    editingNodeInfoList = [];
    const list = document.getElementById('modal-params-list');
    if(list) list.innerHTML = '';
    document.getElementById('modal-task-name').value = '';
    document.getElementById('modal-webapp-id').value = '';
    
    const btnDelete = document.getElementById('modal-btn-delete');
    if(btnDelete) btnDelete.style.display = 'none';
    document.getElementById('modal-create-task').classList.remove('hidden');
}

function openModalForEdit(index) {
    editingTaskIndex = index;
    const task = savedTasks[index];
    const btnDelete = document.getElementById('modal-btn-delete');
    if(btnDelete) btnDelete.style.display = 'inline-block';
    document.getElementById('modal-task-name').value = task.name;
    document.getElementById('modal-webapp-id').value = task.appId;
    editingNodeInfoList = JSON.parse(JSON.stringify(task.nodeInfoList));
    renderModalParamsTable();
    document.getElementById('modal-create-task').classList.remove('hidden');
}

function renderTaskBar() {
    const bar = document.getElementById('new-task-bar');
    if(!bar) return;
    bar.innerHTML = '';
    if (savedTasks.length === 0) {
        bar.innerHTML = '<span class="placeholder-text">暂无任务，请点击左上角创建</span>';
        return;
    }
    savedTasks.forEach((task, index) => {
        const btn = document.createElement('button');
        btn.className = isManagementMode ? 'btn btn-warning' : 'btn btn-outline btn-primary';
        btn.innerHTML = isManagementMode ? `✏️ ${task.name}` : task.name;
        btn.onclick = () => {
            const allBtns = bar.querySelectorAll('button');
            allBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (isManagementMode) {
                openModalForEdit(index);
            } else {
                loadTaskToMainUI(task);
            }
        };
        bar.appendChild(btn);
    });
}

function loadTaskToMainUI(task) {
    activeNodeInfoList = JSON.parse(JSON.stringify(task.nodeInfoList));
    activeWebappId = task.appId;
    activeTaskName = task.name; 
    renderMainConfigForm('new-task-config-area', activeNodeInfoList);
}

function renderModalParamsTable() {
    const container = document.getElementById('modal-params-list');
    if(!container) return;
    container.innerHTML = '';
    editingNodeInfoList.forEach((node, index) => {
        const row = document.createElement('div');
        row.className = 'param-row';
        row.innerHTML += `<div><input class="form-input" readonly value="${node.fieldType}" style="width:100%;background:#eee"></div>`;
        
        const descInput = document.createElement('input');
        descInput.className = 'form-input';
        descInput.value = node.description || '';
        descInput.onchange = (e) => node.description = e.target.value;
        const divDesc = document.createElement('div'); divDesc.appendChild(descInput); row.appendChild(divDesc);

        const idInput = document.createElement('input');
        idInput.className = 'form-input';
        idInput.value = node.nodeId || '';
        idInput.onchange = (e) => node.nodeId = e.target.value;
        const divId = document.createElement('div'); divId.appendChild(idInput); row.appendChild(divId);

        const nameInput = document.createElement('input');
        nameInput.className = 'form-input';
        nameInput.value = node.fieldName || '';
        nameInput.onchange = (e) => node.fieldName = e.target.value;
        const divName = document.createElement('div'); divName.appendChild(nameInput); row.appendChild(divName);

        const valInput = document.createElement('input');
        valInput.className = 'form-input';
        valInput.value = node.fieldValue || '';
        valInput.placeholder = '默认值';
        valInput.onchange = (e) => node.fieldValue = e.target.value;
        const divVal = document.createElement('div'); divVal.appendChild(valInput); row.appendChild(divVal);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon';
        delBtn.innerHTML = '🗑️';
        delBtn.style.color = 'var(--danger-color)';
        delBtn.onclick = () => {
            editingNodeInfoList.splice(index, 1);
            renderModalParamsTable();
        };
        const divAct = document.createElement('div'); divAct.appendChild(delBtn); row.appendChild(divAct);
        container.appendChild(row);
    });
}

// [新增] 保存当前草稿
function saveCurrentDraft(type) {
    const isNew = type === 'new';
    const switchId = isNew ? 'switch-record-new' : 'switch-record-preset';
    const switchEl = document.getElementById(switchId);
    
    // 如果开关关闭，或者没有正在编辑的任务，则不保存
    if (!switchEl || !switchEl.checked) return;

    const key = isNew ? lastActiveNewTaskIndex : lastActivePresetId;
    // activeNodeInfoList 为新建任务的数据源，currentPresetList 为预设任务的数据源
    const currentList = isNew ? activeNodeInfoList : (window.currentPresetList || []); // 注意: 需要确保 currentPresetList 是全局可访问的，原代码中定义在 initPresetTaskSection 内部，建议改为全局变量或通过传参

    if (!key || key === -1 || !currentList || currentList.length === 0) return;

    // 深拷贝节点数据
    const nodesCopy = JSON.parse(JSON.stringify(currentList));
    
    // 保存文件引用 (浅拷贝 fileInputs)
    // 注意：我们需要筛选出属于当前任务的 fileInputs，但目前 fileInputs 是全局混用的。
    // 只要 nodeId 唯一，直接保存当前的 fileInputs 副本即可。
    const filesCopy = { ...fileInputs }; 

    ParamDrafts[type][key] = {
        nodes: nodesCopy,
        files: filesCopy
    };
    
    console.log(`💾 [${type}] 参数已记录: ${key}`);
}

// [新增] 尝试恢复草稿
function restoreDraft(type, key, targetList) {
    const switchId = type === 'new' ? 'switch-record-new' : 'switch-record-preset';
    const switchEl = document.getElementById(switchId);
    
    if (!switchEl || !switchEl.checked) return null; // 开关关闭，不恢复

    const draft = ParamDrafts[type][key];
    if (draft) {
        console.log(`♻️ [${type}] 参数已恢复: ${key}`);
        // 1. 恢复文本/数字参数
        // 遍历当前列表，如果草稿里有对应的 nodeId，则恢复其 value
        targetList.forEach(node => {
            const savedNode = draft.nodes.find(n => n.nodeId === node.nodeId);
            if (savedNode) {
                node.fieldValue = savedNode.fieldValue;
            }
        });
        
        // 2. 返回需要恢复的文件对象
        return draft.files;
    }
    return null;
}

// [核心修复] 渲染表单并挂载缓存系统
// [核心修改] 渲染表单 (支持自动记录 + 手动恢复)
function renderMainConfigForm(containerId, nodeInfoList, appId, forceRestore = false) {
    const container = document.getElementById(containerId);
    if(!container) return;
    container.innerHTML = '';
    
    // 每次渲染重置当前文件引用
    fileInputs = {}; 
    
    if(!nodeInfoList || nodeInfoList.length === 0) {
        container.innerHTML = '<div class="empty-tip">请选择一个任务</div>';
        return;
    }

    const appIdStr = String(appId);

    // --- 1. 恢复逻辑 (仅在点击按钮且 forceRestore=true 时执行) ---
    if (forceRestore && appIdStr) {
        // A. 恢复普通参数
        if (ParamCache[appIdStr]) {
            nodeInfoList.forEach(node => {
                const nId = String(node.nodeId);
                if (ParamCache[appIdStr][nId] !== undefined) {
                    node.fieldValue = ParamCache[appIdStr][nId];
                }
            });
        }
        // B. 恢复文件参数
        if (FileCache[appIdStr]) {
            for (const [nId, fData] of Object.entries(FileCache[appIdStr])) {
                fileInputs[nId] = fData; // 恢复到全局 fileInputs
            }
        }
    }

    // --- 2. 渲染表单 ---
    nodeInfoList.forEach(node => {
        const wrapper = document.createElement('div');
        wrapper.className = 'card form-item';
        wrapper.style.padding = '15px';
        wrapper.style.marginBottom = '15px';

        const label = document.createElement('label');
        label.className = 'form-label-block';
        label.innerHTML = `<strong>${node.description || node.fieldName}</strong> <span style="font-size:12px;color:#999;margin-left:5px">(${node.fieldType})</span>`;
        wrapper.appendChild(label);

        // 统一更新器：输入即自动保存到 Cache
        const handleUpdate = (val) => {
            node.fieldValue = val;
            if (appIdStr) {
                if (!ParamCache[appIdStr]) ParamCache[appIdStr] = {};
                ParamCache[appIdStr][String(node.nodeId)] = val;
            }
        };

        let inputEl;

        switch(node.fieldType) {
            case 'STRING':
                inputEl = document.createElement('textarea');
                inputEl.className = 'form-input';
                inputEl.style.height = '80px';
                inputEl.style.resize = 'vertical';
                inputEl.value = node.fieldValue || '';
                inputEl.addEventListener('input', (e) => handleUpdate(e.target.value));
                break;

            case 'INT':
            case 'FLOAT':
                inputEl = document.createElement('div');
                inputEl.style.display = 'flex';
                const numInput = document.createElement('input');
                numInput.type = 'number';
                numInput.className = 'form-input';
                numInput.value = node.fieldValue;
                numInput.step = node.fieldType === 'FLOAT' ? '0.01' : '1';
                numInput.style.flex = '1';
                numInput.style.textAlign = 'center';
                const btnDec = document.createElement('button'); btnDec.textContent = '-'; btnDec.className = 'btn btn-outline';
                const btnInc = document.createElement('button'); btnInc.textContent = '+'; btnInc.className = 'btn btn-outline';
                
                const updateNum = (val) => { numInput.value = val; handleUpdate(val); };
                btnDec.onclick = () => { numInput.stepDown(); updateNum(numInput.value); };
                btnInc.onclick = () => { numInput.stepUp(); updateNum(numInput.value); };
                numInput.addEventListener('input', (e) => handleUpdate(e.target.value));
                
                inputEl.appendChild(btnDec); inputEl.appendChild(numInput); inputEl.appendChild(btnInc);
                break;

            case 'BOOLEAN':
                inputEl = document.createElement('label');
                inputEl.className = 'switch';
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.checked = node.fieldValue === 'true' || node.fieldValue === true;
                const slider = document.createElement('span');
                slider.className = 'slider round';
                check.onchange = (e) => handleUpdate(e.target.checked ? 'true' : 'false');
                inputEl.appendChild(check); inputEl.appendChild(slider);
                break;

            case 'SWITCH':
            case 'LIST':
                inputEl = document.createElement('select');
                inputEl.className = 'form-input';
                try {
                    let opts = JSON.parse(node.fieldData);
                    if(Array.isArray(opts) && opts.length > 0 && Array.isArray(opts[0])) opts = opts[0];
                    if(Array.isArray(opts)) {
                        opts.forEach(opt => {
                            const option = document.createElement('option');
                            if(typeof opt === 'object') {
                                option.value = (opt.index !== undefined && opt.index !== null) ? opt.index : opt.name;
                                option.textContent = opt.description || opt.name;
                            } else {
                                option.value = opt; option.textContent = opt;
                            }
                            if(option.value == node.fieldValue) option.selected = true;
                            inputEl.appendChild(option);
                        });
                        // 默认值处理
                        if(!node.fieldValue && inputEl.options.length > 0) handleUpdate(inputEl.options[0].value);
                    }
                } catch(e) { console.error(e); }
                inputEl.onchange = (e) => handleUpdate(e.target.value);
                break;

            case 'IMAGE':
            case 'VIDEO':
            case 'AUDIO':
                inputEl = document.createElement('div');
                inputEl.className = 'upload-widget';
                
                const hiddenFile = document.createElement('input');
                hiddenFile.type = 'file';
                hiddenFile.style.display = 'none';
                if(node.fieldType === 'IMAGE') hiddenFile.accept = 'image/*';
                if(node.fieldType === 'VIDEO') hiddenFile.accept = 'video/*';
                if(node.fieldType === 'AUDIO') hiddenFile.accept = 'audio/*';

                const updatePreview = (file, name) => { 
                    if(!file) { 
                        inputEl.className = 'upload-widget'; 
                        inputEl.innerHTML = ` 
                            <div class="upload-placeholder"> 
                                <div class="upload-icon">📂</div> 
                                <div class="upload-text">点击或拖拽上传 ${node.fieldType}</div> 
                            </div>`; 
                    } else { 
                        inputEl.className = 'upload-widget has-file'; 
                        
                        let url = '';
                        try { url = URL.createObjectURL(file); } catch(e) { console.warn('URL gen failed', e); }
                        
                        let mediaHtml = ''; 
                        if(node.fieldType === 'IMAGE') mediaHtml = `<img src="${url}" class="preview-media">`; 
                        else if(node.fieldType === 'VIDEO') mediaHtml = `<video src="${url}" class="preview-media" controls></video>`; 
                        else mediaHtml = `<div class="preview-audio-icon">🎵</div><audio src="${url}" controls style="width:100%"></audio>`; 

                        inputEl.innerHTML = ` 
                            <button class="btn-clear-file" title="清除">✕</button> 
                            <div class="preview-content"> 
                                ${mediaHtml} 
                                <div class="preview-filename">${name}</div> 
                                <div class="preview-actions">✅ 已准备就绪</div> 
                            </div>`; 
                        
                        const clearBtn = inputEl.querySelector('.btn-clear-file'); 
                        if (clearBtn) { 
                            clearBtn.onclick = (e) => { 
                                e.stopPropagation(); 
                                delete fileInputs[node.nodeId];
                                handleUpdate(''); 
                                hiddenFile.value = ''; 
                                // 清除缓存
                                if (appIdStr && FileCache[appIdStr]) {
                                    delete FileCache[appIdStr][String(node.nodeId)];
                                }
                                updatePreview(null); 
                            }; 
                        } 
                    } 
                }; 

                const handleFileSelection = (file) => { 
                    if (!file) return; 
                    let isValid = false; 
                    const ft = node.fieldType; const mt = file.type; 
                    if (ft === 'IMAGE' && mt.startsWith('image/')) isValid = true; 
                    else if (ft === 'VIDEO' && mt.startsWith('video/')) isValid = true; 
                    else if (ft === 'AUDIO' && mt.startsWith('audio/')) isValid = true; 

                    if (!isValid) return alert(`❌ 文件类型不匹配！`);

                    const fileData = { file: file, type: node.fieldType, name: file.name };
                    fileInputs[node.nodeId] = fileData;
                    handleUpdate(file.name);
                    
                    // 自动存入文件缓存
                    if (appIdStr) {
                        if (!FileCache[appIdStr]) FileCache[appIdStr] = {};
                        FileCache[appIdStr][String(node.nodeId)] = fileData;
                    }
                    updatePreview(file, file.name); 
                }; 

                inputEl.onclick = () => hiddenFile.click(); 
                hiddenFile.onchange = (e) => handleFileSelection(e.target.files[0]); 
                
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => { 
                    inputEl.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false); 
                });
                inputEl.addEventListener('dragover', () => inputEl.classList.add('drag-over'), false); 
                ['dragleave', 'drop'].forEach(evt => { inputEl.addEventListener(evt, () => inputEl.classList.remove('drag-over'), false); }); 
                inputEl.addEventListener('drop', (e) => { if (e.dataTransfer.files.length > 0) handleFileSelection(e.dataTransfer.files[0]); }, false); 

                // 初始化时：如果 fileInputs 里有文件（不管是缓存恢复的还是原本的），显示出来
                const nIdStr = String(node.nodeId);
                if (fileInputs[nIdStr]) {
                    updatePreview(fileInputs[nIdStr].file, fileInputs[nIdStr].file.name);
                } else {
                    updatePreview(null); 
                }
                
                wrapper.appendChild(hiddenFile); 
                break;
        }

        if(inputEl) wrapper.appendChild(inputEl);
        container.appendChild(wrapper);
    });
}

// [修改] 任务发起逻辑：支持候补队列
async function handleRunTask(canvasId, nodeList, appId, baseTaskName, sourceType) {
    if(!checkApiKey()) return;
    if(!appId || !nodeList) return alert("配置未就绪");
    const canvas = document.getElementById(canvasId);

    // 1. 检查文件 (保持不变)
    for (const node of nodeList) {
        if (['IMAGE', 'VIDEO', 'AUDIO'].includes(node.fieldType)) {
            if (!fileInputs[node.nodeId]) {
                alert("请上传文件再发起运行");
                return; 
            }
        }
    }

    canvas.innerHTML = '<div class="canvas-placeholder">⏳ 准备资源上传...</div>';

    // 2. 上传文件 (保持不变，预处理必须先拿到文件 URL)
    for (const node of nodeList) {
        const fileData = fileInputs[node.nodeId];
        if (fileData) {
            canvas.innerHTML = `<div class="canvas-placeholder">📤 上传中: ${fileData.file.name}...</div>`;
            const uploadRes = await API.uploadResource(fileData.file, State.apiKey, node.nodeId, fileData.type);
            if(uploadRes.code === 0 && uploadRes.data) {
                node.fieldValue = uploadRes.data.fileName;
            } else {
                canvas.innerHTML = `<div class="canvas-placeholder" style="color:red">❌ 上传失败: ${fileData.file.name}</div>`;
                return;
            }
        }
    }

    // 3. 准备 Payload
    const payload = {
        webappId: appId, apiKey: State.apiKey,
        nodeInfoList: nodeList.map(n => ({ nodeId: n.nodeId, fieldName: n.fieldName, fieldValue: n.fieldValue })),
        instanceType: "default"
    };

    // 4. 判断并发状态
    const activeCount = State.runningTasksList.filter(t => 
        t.status === 'RUNNING' || t.status === 'QUEUED'
    ).length;
    const maxConcurrency = State.taskCount || 1;

    // 生成基础名称前缀
    let prefix = '';
    if (sourceType === 'new') prefix = '[新]';
    else if (sourceType === 'preset') prefix = '[预]';

    const isPending = activeCount >= maxConcurrency;
    
    // [核心修改] 候补状态下，名称暂时不加 ID 后缀，保持纯净
    // 如果是直接运行，稍后会在 executeRealTask 里追加后缀
    const tempName = `${prefix} ${baseTaskName}`;
    
    const newTaskObj = {
        taskId: 'temp_' + Date.now(), // 临时 ID (内部使用，UI层会隐藏)
        name: tempName,
        status: isPending ? 'PENDING_START' : 'QUEUED', 
        startTime: Date.now(),
        outputs: null,
        canvasId: canvasId,
        endTime: null,
        payload: payload 
    };

    // 加入列表头部
    State.runningTasksList.unshift(newTaskObj);
    updateTaskStorage();
    renderSidebarTaskItems();

    if (isPending) {
        // A. 进入候补模式
        canvas.innerHTML = `<div class="canvas-placeholder" style="color:#0284c7">⏸️ 并发已满，任务已加入候补队列<br>等待空位中...</div>`;
    } else {
        // B. 有空位，直接运行
        executeRealTask(newTaskObj, 0);
    }
}

// [新增] 检查并执行候补队列中的任务
async function processPendingQueue() {
    // 1. 检查当前并发占用
    const activeCount = State.runningTasksList.filter(t => 
        t.status === 'RUNNING' || t.status === 'QUEUED'
    ).length;
    
    // 确保读取最新的并发设置
    const maxConcurrency = State.taskCount || 1;
    
    // 如果没有空位，直接退出
    if (activeCount >= maxConcurrency) return;

    // 2. 查找候补任务 (PENDING_START)
    const pendingTasks = State.runningTasksList
        .map((t, index) => ({ t, index })) 
        .filter(item => item.t.status === 'PENDING_START');

    if (pendingTasks.length === 0) return;

    // 3. 取出最早加入的任务 (在 unshift 逻辑下，数组最末尾的是最早加入的)
    const itemToRun = pendingTasks[pendingTasks.length - 1]; 
    
    console.log(`⚡ 队列调度: 启动候补任务 ${itemToRun.t.name}`);

    // 4. 正式发起运行
    await executeRealTask(itemToRun.t, itemToRun.index);
}
// [修改] executeRealTask: 候补转正逻辑
async function executeRealTask(taskObj, arrayIndex) {
    const canvas = document.getElementById(taskObj.canvasId);
    
    // 先标记为排队中，占住位置
    taskObj.status = 'QUEUED'; 
    updateTaskStorage();
    renderSidebarTaskItems();

    if(canvas) canvas.innerHTML = '<div class="canvas-placeholder">🚀 正在启动预处理任务...</div>';

    try {
        const res = await API.runTask(taskObj.payload); 

        if(res.code === 0 && res.data) {
            // 1. 更新真实 ID
            taskObj.taskId = res.data.taskId; 
            // 2. 更新开始时间 (重置计时)
            taskObj.startTime = Date.now();
            
            // 3. [核心修改] 转正后，追加 ID 后缀到名称
            const taskIdStr = String(res.data.taskId);
            const last4 = taskIdStr.length >= 4 ? taskIdStr.slice(-4) : taskIdStr;
            
            // 避免重复追加 (防止极端情况)
            if (!taskObj.name.includes(last4)) {
                taskObj.name = `${taskObj.name} ${last4}`;
            }
            
            // 4. 清理暂存数据
            delete taskObj.payload;
            
            updateTaskStorage();
            renderSidebarTaskItems();
            
            // 启动轮询
            startTaskPolling(taskObj);
            
            if(canvas) canvas.innerHTML = `<div class="canvas-placeholder">✅ 任务已启动<br>ID: ${last4}</div>`;
            handleTaskCardClick(taskObj);

        } else {
            taskObj.status = 'FAILED';
            if(canvas) canvas.innerHTML = `<div class="canvas-placeholder" style="color:red">❌ 启动失败: ${res.msg}</div>`;
            updateTaskStorage();
            renderSidebarTaskItems();
            processPendingQueue();
        }
    } catch (e) {
        taskObj.status = 'FAILED';
        updateTaskStorage();
        renderSidebarTaskItems();
        processPendingQueue();
    }
}

function updateTaskStorage() {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(State.runningTasksList));
}

function restartPendingTasksPolling() {
    State.runningTasksList.forEach(task => {
        if(task.status === 'RUNNING' || task.status === 'QUEUED') {
            startTaskPolling(task);
        }
    });
}

// [修改] 列表渲染逻辑
// [修改] 列表渲染逻辑：纯净版候补卡片 + 无字分割线
// [修改] 列表渲染逻辑：增加动态排队位次显示
function renderSidebarTaskItems() {
    const listContainer = document.getElementById('task-list');
    updateMonitorIcon(); 

    if(!listContainer) return;
    listContainer.innerHTML = '';
    
    if (State.runningTasksList.length === 0) {
        listContainer.innerHTML = '<div class="empty-task-list">暂无任务</div>';
        return;
    }
    
    // 1. 获取全局计数数据
    // 当前正在运行或排队（已占位）的任务数
    const activeCount = State.runningTasksList.filter(t => 
        t.status === 'RUNNING' || t.status === 'QUEUED'
    ).length;
    
    // 当前并发上限
    const maxConcurrency = State.taskCount || 1;

    State.runningTasksList.forEach((task, index) => {
        // --- 1. 分割线逻辑 (保持纯净版) ---
        if (task.status !== 'PENDING_START' && index > 0) {
             // 简单的判断：只要当前不是候补，且不是第一项，就检查上一项是不是候补
             // 实际上，只要列表上面的任务不是 PENDING，或者我们简单地：
             // 只要遇到非 PENDING 的任务，且它上面有任务，我们在 CSS 层面或其他逻辑控制分割线
             // 这里沿用之前的逻辑：
             // 如果当前是正式任务，且上一项是候补任务（数组顺序 index-1），则画线？
             // 不，之前的逻辑是：只要遇到第一个非 PENDING，且 index>0，就画线。
             // 为了简化，我们只在"正式任务区"和"候补区"交界处画线
             // 因为候补是在 unshift (顶部)，所以交界处是：当前是 PENDING，下一个是 RUNNING？不对。
             // 列表顺序：[候补C, 候补B, 候补A, 运行1, 运行2...]
             // 所以当 index 指向 "运行1" 时，如果 index > 0，说明上面有候补，画线。
             if (State.runningTasksList[index-1]?.status === 'PENDING_START') {
                 const sep = document.createElement('div');
                 sep.className = 'queue-separator'; 
                 listContainer.appendChild(sep);
             }
        }

        const card = document.createElement('div');
        card.className = `task-card ${task.status.toLowerCase()}`;
        card.id = `task-card-${task.taskId}`;
        
        // --- 状态文案 ---
        let statusText = '排队中';
        if(task.status === 'RUNNING') statusText = '运行中';
        if(task.status === 'SUCCESS') statusText = '成功';
        if(task.status === 'FAILED') statusText = '失败';
        if(task.status === 'PENDING_START') statusText = '⏳ 候补中';

        // --- 时间显示逻辑 ---
        let startTimeStr = '';
        let timeDisplay = '';

        if (task.status === 'PENDING_START') {
            startTimeStr = '等待中...';     
            timeDisplay = '';            
        } else {
            startTimeStr = formatDateTime(task.startTime);
            if(task.status === 'SUCCESS' || task.status === 'FAILED') {
                 if (task.endTime) timeDisplay = formatDuration(task.endTime - task.startTime);
                 else timeDisplay = '结束'; 
            } else {
                 timeDisplay = formatDuration(Date.now() - task.startTime);
            }
        }

        // --- [核心修改] 中间部分构建 (排队数 n 计算) ---
        let midContent = '';
        
        if (task.status === 'PENDING_START') {
             // 1. 计算排在我前面的候补任务数 (因为列表是新->旧，index越大越早加入，越早执行)
             // 所以"排在我前面" = "在数组中 index 比我大" 的 PENDING_START 任务
             const olderPendingCount = State.runningTasksList.slice(index + 1).filter(t => t.status === 'PENDING_START').length;
             
             // 2. 计算 n
             // 公式逻辑：(当前占坑的人) + (排在我前面的人) - (总坑位) + 1
             // 比如：1并发，1运行。我是排第1的候补(older=0)。
             // n = 1 + 0 - 1 + 1 = 1. (前面还有1个任务要跑完：即当前运行那个)
             // 比如：1并发，1运行。我是排第2的候补(older=1)。
             // n = 1 + 1 - 1 + 1 = 2. (前面还有2个：当前运行 + 候补1)
             let queueNum = activeCount + olderPendingCount - maxConcurrency + 1;
             
             // 容错：如果 n < 1 (比如并发数突然调大，有空位了但还没轮询到)，显示 1 或 "即将运行"
             if (queueNum < 1) queueNum = 1;

             midContent = `
                <div class="queue-info">
                    前面剩余任务：<span class="queue-highlight">${queueNum}</span>
                </div>
                <span class="status-badge" style="margin-left: auto;" id="status-badge-${task.taskId}">${statusText}</span>
             `;
        } else {
             // 正式状态：显示 ID
             midContent = `
                <span class="t-full-id" title="taskId: ${task.taskId}">ID: ${task.taskId}</span>
                <span class="status-badge" id="status-badge-${task.taskId}">${statusText}</span>
             `;
        }

        card.innerHTML = `
            <div class="card-top">
                <span class="t-name" title="${task.name}">${task.name}</span>
                <button class="btn btn-xs ${task.status === 'SUCCESS' || task.status === 'FAILED' ? 'btn-outline' : 'btn-danger'} btn-card-action">
                    ${(task.status === 'SUCCESS' || task.status === 'FAILED') ? '删除' : '取消'}
                </button>
            </div>
            <div class="card-mid">
                ${midContent}
            </div>
            <div class="card-btm">
                <span class="start-time" style="${task.status === 'PENDING_START' ? 'color:#9ca3af;font-style:italic' : ''}">${startTimeStr}</span>
                <span class="t-time" id="timer-${task.taskId}">${timeDisplay}</span>
            </div>
        `;
        
        card.onclick = (e) => {
            if(e.target.tagName === 'BUTTON') return;
            currentPreviewTaskIndex = index;
            updateTaskNavButtons();
            if(task.status !== 'PENDING_START') handleTaskCardClick(task);
        };

        // ... (前面的代码保持不变) ...

        const btnAction = card.querySelector(`button.btn-card-action`); 
        
        btnAction.onclick = async (e) => {
            e.stopPropagation();
            const actionType = btnAction.textContent.trim();

            // === 逻辑 A: 取消任务 ===
            if(actionType === '取消') {
                
                // [优化 1] 如果是临时 ID (temp_xxx) 或者 候补任务
                // 说明任务还没在服务器生成，或者我们不知道它的真实 ID
                // 直接本地删除，不发请求，防止报 404
                if (task.status === 'PENDING_START' || String(task.taskId).startsWith('temp_')) {
                     State.runningTasksList = State.runningTasksList.filter(t => t.taskId !== task.taskId);
                     updateTaskStorage();
                     renderSidebarTaskItems(); // 刷新列表，自动重新计算排队数字
                } 
                
                // [优化 2] 正式任务：发送 API 请求
                else {
                    btnAction.disabled = true;
                    btnAction.textContent = '...';

                    try {
                        const res = await API.cancelTask(State.apiKey, task.taskId);
                        
                        // [关键修复] 增加对 code 404 的兼容
                        // 0 = 成功
                        // 807 = 任务不存在 (RunningHub 标准错误)
                        // 404 = 资源未找到 (可能是 ID 格式问题或路径问题导致的通用错误)
                        // 以上情况都视为“取消成功”
                        if (res.code === 0 || res.code === 807 || res.code === 404) {
                            
                            // 1. 删除本地记录
                            State.runningTasksList = State.runningTasksList.filter(t => t.taskId !== task.taskId);
                            updateTaskStorage();
                            
                            // 2. 刷新界面
                            renderSidebarTaskItems();
                            
                            // 3. 释放并发空位，触发候补
                            processPendingQueue();
                            
                        } else {
                            // 其他未知错误才弹窗 (比如 500 服务器崩了)
                            alert(`取消失败: ${res.msg} (Code: ${res.code})`);
                            btnAction.disabled = false;
                            btnAction.textContent = '取消';
                        }
                    } catch (err) {
                        console.error("取消请求异常", err);
                        // 网络层面的失败（断网等）还是提示一下比较好
                        alert("网络异常，请求发送失败");
                        btnAction.disabled = false;
                        btnAction.textContent = '取消';
                    }
                }
            } 
            
            // === 逻辑 B: 删除记录 ===
            else {
                if(confirm(`确定删除任务记录 "${task.name}" 吗?`)) {
                    State.runningTasksList = State.runningTasksList.filter(t => t.taskId !== task.taskId);
                    updateTaskStorage();
                    renderSidebarTaskItems();
                }
            }
        };

        listContainer.appendChild(card);
    });
}

function updateMonitorIcon() {
    const mainIcon = document.getElementById('task-monitor-icon');
    const mainCount = document.getElementById('monitor-count');
    
    const collapsedIcon = document.getElementById('task-monitor-icon-collapsed');
    const collapsedCount = document.getElementById('monitor-count-collapsed');
    
    const activeCount = State.runningTasksList.filter(t => 
        t.status === 'RUNNING' || t.status === 'QUEUED'
    ).length;

    if (mainIcon && mainCount) {
        mainCount.textContent = activeCount;
        if (activeCount > 0) mainIcon.classList.add('active');
        else mainIcon.classList.remove('active');
    }

    if (collapsedIcon && collapsedCount) {
        collapsedCount.textContent = activeCount;
        if (activeCount > 0) collapsedIcon.classList.add('active');
        else collapsedIcon.classList.remove('active');
    }
}

// [修改] 轮询逻辑：修复任务完成无法触发候补的问题
function startTaskPolling(task) {
    const pollFunc = async () => {
        // 1. 在列表中找到当前任务对象
        const currentTask = State.runningTasksList.find(t => t.taskId === task.taskId);
        if(!currentTask) return; 

        // 如果已经在内存中标记为结束，就不再请求了
        if(currentTask.status === 'SUCCESS' || currentTask.status === 'FAILED') return; 

        // 2. 请求 API 获取最新状态
        const res = await API.getTaskStatus(State.apiKey, task.taskId);
        if(res.code === 0) {
            const newStatus = res.data;
            
            // 3. 状态发生变化
            if(newStatus !== currentTask.status) {
                currentTask.status = newStatus;
                
                // 如果任务结束 (成功或失败)
                if (newStatus === 'SUCCESS' || newStatus === 'FAILED') {
                    if (!currentTask.endTime) currentTask.endTime = Date.now();
                    
                    // 🔴 [核心修复] 必须在这里触发队列检查！
                    // 告诉系统有一个任务结束了，去看看有没有候补任务要跑
                    console.log(`任务 ${task.taskId} 结束 (${newStatus})，触发候补队列检查...`);
                    setTimeout(processPendingQueue, 500); 
                }
                
                updateTaskStorage(); 
                renderSidebarTaskItems(); 
                
                // 如果成功，获取输出结果
                if(newStatus === 'SUCCESS') fetchAndCacheOutputs(currentTask);
            }

            // 更新计时器显示
            const timerEl = document.getElementById(`timer-${task.taskId}`);
            if(timerEl && (newStatus === 'RUNNING' || newStatus === 'QUEUED')) {
                const diffMs = Date.now() - task.startTime;
                timerEl.textContent = formatDuration(diffMs);
            }
        }
        
        // 4. 继续轮询 (只有未完成时才继续)
        if(currentTask.status === 'RUNNING' || currentTask.status === 'QUEUED') {
            setTimeout(pollFunc, 3000);
        }
    };
    pollFunc();
}

async function fetchAndCacheOutputs(task) {
    const res = await API.getTaskOutputs(State.apiKey, task.taskId);
    if(res.code === 0 && res.data) {
        task.outputs = res.data;
        updateTaskStorage();
    }
}

async function handleTaskCardClick(task) {
    let targetCanvas = document.getElementById(task.canvasId);
    const activePage = document.querySelector('.page-section.active');
    if(activePage) {
        const visibleCanvas = activePage.querySelector('.result-canvas');
        if(visibleCanvas) targetCanvas = visibleCanvas;
    }
    if(!targetCanvas) {
        document.querySelector('[data-target="page-new-task"]').click();
        setTimeout(() => handleTaskCardClick(task), 100); 
        return;
    }
    targetCanvas.innerHTML = '<div class="canvas-placeholder">🔄 加载结果中...</div>';
    const displayNameNew = document.getElementById('display-name-new');
    const displayNamePreset = document.getElementById('display-name-preset');
    const nameText = `task: ${task.name}`;
    if(displayNameNew) displayNameNew.textContent = nameText;
    if(displayNamePreset) displayNamePreset.textContent = nameText;
    document.querySelectorAll('.task-card').forEach(c => c.classList.remove('active-card'));
    const activeCard = document.getElementById(`task-card-${task.taskId}`);
    if(activeCard) activeCard.classList.add('active-card');
    if(!task.outputs) await fetchAndCacheOutputs(task);
    if(!task.outputs || task.outputs.length === 0) {
        targetCanvas.innerHTML = '<div class="canvas-placeholder">⚠️ 未找到输出文件</div>';
        return;
    }
    if(task.outputs.length === 1) {
        await renderSingleFile(targetCanvas, task.outputs[0]);
    } else {
        renderMultiFileList(targetCanvas, task.outputs);
    }
}

function renderMultiFileList(container, outputs) {
    container.innerHTML = '';
    const listWrapper = document.createElement('div');
    listWrapper.className = 'file-selection-list';
    const header = document.createElement('div');
    header.className = 'file-selection-header';
    header.textContent = `生成了 ${outputs.length} 个文件`;
    listWrapper.appendChild(header);
    outputs.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-select-item';
        const fileName = file.fileUrl.split('/').pop();
        item.innerHTML = `<span class="file-select-name">${fileName}</span><span class="file-select-icon">👁️</span>`;
        item.onclick = () => renderSingleFile(container, file, true, outputs);
        listWrapper.appendChild(item);
    });
    container.appendChild(listWrapper);
}

async function renderSingleFile(container, file, showBackBtn = false, allOutputs = []) {
    container.innerHTML = '<div class="canvas-placeholder">💾 正在下载文件...</div>';
    const saveRes = await API.saveResultFile(file.fileUrl, file.fileType);
    if(saveRes.code === 0) {
        renderPreview(container, saveRes.localPath, file.fileType);
        if(showBackBtn) {
            const backBtn = document.createElement('button');
            backBtn.className = 'btn-back';
            backBtn.innerHTML = '⬅ 返回文件列表';
            backBtn.onclick = () => renderMultiFileList(container, allOutputs);
            container.appendChild(backBtn); 
        }
        if (allOutputs && allOutputs.length > 1) {
            const currentIndex = allOutputs.findIndex(f => f.fileUrl === file.fileUrl);
            const btnPrev = document.createElement('button');
            btnPrev.className = 'nav-btn nav-prev';
            btnPrev.innerHTML = '❮'; 
            btnPrev.title = "上一张";
            btnPrev.onclick = (e) => {
                e.stopPropagation();
                let nextIndex = currentIndex - 1;
                if (nextIndex < 0) nextIndex = allOutputs.length - 1; 
                renderSingleFile(container, allOutputs[nextIndex], true, allOutputs);
            };
            container.appendChild(btnPrev);
            const btnNext = document.createElement('button');
            btnNext.className = 'nav-btn nav-next';
            btnNext.innerHTML = '❯';
            btnNext.title = "下一张";
            btnNext.onclick = (e) => {
                e.stopPropagation();
                let nextIndex = currentIndex + 1;
                if (nextIndex >= allOutputs.length) nextIndex = 0; 
                renderSingleFile(container, allOutputs[nextIndex], true, allOutputs);
            };
            container.appendChild(btnNext);
        }
    } else {
        container.innerHTML = `<div class="canvas-placeholder" style="color:red">保存失败: ${saveRes.msg}</div>`;
        if(showBackBtn) {
            const backBtn = document.createElement('button');
            backBtn.className = 'btn-back';
            backBtn.textContent = '⬅ 返回';
            backBtn.onclick = () => renderMultiFileList(container, allOutputs);
            container.appendChild(backBtn);
        }
    }
}

function renderPreview(container, src, type) {
    container.innerHTML = '';
    type = type ? type.toLowerCase() : '';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(type)) {
        createImageViewer(container, src);
    } else if (['txt', 'json', 'md', 'xml'].includes(type)) {
        renderTextViewer(container, src);
    } else if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma'].includes(type)) {
        renderAudioViewer(container, src);
    } else if (['mp4', 'webm', 'mov'].includes(type)) {
        renderVideoViewer(container, src);
    } else {
        renderDownloadLink(container, src, type);
    }
}

function createImageViewer(container, src) {
    const state = { scale: 1, rotate: 0, flipX: 1, flipY: 1, translateX: 0, translateY: 0, isDragging: false, startX: 0, startY: 0 };
    const wrapper = document.createElement('div'); wrapper.className = 'img-viewer-wrapper';
    const toolbar = document.createElement('div'); toolbar.className = 'img-toolbar';
    const zoomGroup = document.createElement('div'); zoomGroup.className = 'zoom-control-group';
    const btnSave = createToolBtn('💾', '另存为', () => { const link = document.createElement('a'); link.href = src; link.download = src.split('/').pop() || 'image.png'; document.body.appendChild(link); link.click(); document.body.removeChild(link); });
    const btnCopy = createToolBtn('📋', '复制图像到剪贴板', async () => { const originalIcon = '📋'; try { btnCopy.innerHTML = '⏳'; btnCopy.disabled = true; const response = await fetch(src); const blob = await response.blob(); const item = new ClipboardItem({ [blob.type]: blob }); await navigator.clipboard.write([item]); btnCopy.innerHTML = originalIcon; showToast(btnCopy, '已复制到剪切板📋'); } catch (err) { console.error('复制失败:', err); btnCopy.innerHTML = originalIcon; showToast(btnCopy, '复制失败 ❌'); } finally { btnCopy.disabled = false; } });
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = '20'; slider.max = '300'; slider.value = '100'; slider.className = 'zoom-slider'; slider.setAttribute('aria-label', '缩放比例');
    const zoomLabel = document.createElement('span'); zoomLabel.style.fontSize = '12px'; zoomLabel.style.minWidth = '40px'; zoomLabel.textContent = '100%';
    zoomGroup.append(btnSave, btnCopy, slider, zoomLabel);
    const transGroup = document.createElement('div'); transGroup.className = 'toolbar-btn-group';
    const btnRotateL = createToolBtn('↺', '逆时针90度', () => updateState('rotate', -90));
    const btnRotateR = createToolBtn('↻', '顺时针90度', () => updateState('rotate', 90));
    const btnFlipH = createToolBtn('↔', '左右反转', () => updateState('flipX'));
    const btnFlipV = createToolBtn('↕', '上下反转', () => updateState('flipY'));
    const btnFullscreen = createToolBtn('⛶', '全屏', () => toggleFullscreen(wrapper));
    transGroup.append(btnRotateL, btnRotateR, btnFlipH, btnFlipV, btnFullscreen);
    toolbar.append(zoomGroup, transGroup);
    const viewport = document.createElement('div'); viewport.className = 'img-viewport';
    const layer = document.createElement('div'); layer.className = 'img-transform-layer';
    const img = document.createElement('img'); img.src = src; img.className = 'img-content'; img.alt = '预览图像'; img.ondragstart = (e) => e.preventDefault();
    layer.appendChild(img); viewport.appendChild(layer); wrapper.appendChild(toolbar); wrapper.appendChild(viewport); container.appendChild(wrapper);

    const applyTransform = () => { layer.style.transform = `translate(${state.translateX}px, ${state.translateY}px) rotate(${state.rotate}deg) scale(${state.scale}) scaleX(${state.flipX}) scaleY(${state.flipY})`; const percent = Math.round(state.scale * 100); slider.value = percent; zoomLabel.textContent = `${percent}%`; };
    const updateState = (key, val) => { if (key === 'rotate') state.rotate += val; else if (key === 'flipX') state.flipX *= -1; else if (key === 'flipY') state.flipY *= -1; applyTransform(); };
    const resetState = () => { state.scale = 1; state.rotate = 0; state.flipX = 1; state.flipY = 1; state.translateX = 0; state.translateY = 0; applyTransform(); };
    function showToast(targetBtn, text) { const rect = targetBtn.getBoundingClientRect(); const toast = document.createElement('div'); toast.textContent = text; Object.assign(toast.style, { position: 'fixed', left: `${rect.left + rect.width / 2}px`, top: `${rect.bottom + 8}px`, transform: 'translateX(-50%)', backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#fff', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: '500', zIndex: '9999', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.2s ease, transform 0.2s ease' }); document.body.appendChild(toast); requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; }); setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(-5px)'; setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 200); }, 1000); }

    slider.addEventListener('input', (e) => { state.scale = parseInt(e.target.value) / 100; applyTransform(); });
    viewport.addEventListener('wheel', (e) => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.1 : 0.1; let newScale = state.scale + delta; if (newScale < 0.2) newScale = 0.2; if (newScale > 3.0) newScale = 3.0; if (newScale !== state.scale) { const rect = viewport.getBoundingClientRect(); const centerX = rect.width / 2; const centerY = rect.height / 2; const mouseOffsetX = e.clientX - rect.left - centerX; const mouseOffsetY = e.clientY - rect.top - centerY; state.translateX -= mouseOffsetX * (newScale - state.scale); state.translateY -= mouseOffsetY * (newScale - state.scale); } state.scale = newScale; applyTransform(); }, { passive: false });
    viewport.addEventListener('mousedown', (e) => { if (e.button !== 0) return; state.isDragging = true; state.startX = e.clientX - state.translateX; state.startY = e.clientY - state.translateY; viewport.classList.add('is-dragging'); });
    window.addEventListener('mousemove', (e) => { if (!state.isDragging) return; e.preventDefault(); state.translateX = e.clientX - state.startX; state.translateY = e.clientY - state.startY; applyTransform(); });
    window.addEventListener('mouseup', () => { if (state.isDragging) { state.isDragging = false; viewport.classList.remove('is-dragging'); } });
    viewport.addEventListener('dblclick', resetState);
}

function createToolBtn(icon, label, onClick) { const btn = document.createElement('button'); btn.className = 'tool-btn'; btn.innerHTML = icon; btn.title = label; btn.setAttribute('aria-label', label); btn.onclick = (e) => { e.stopPropagation(); onClick(e); }; return btn; }
function toggleFullscreen(elem) { if (!document.fullscreenElement) { elem.requestFullscreen().catch(err => { alert(`Error: ${err.message}`); }); elem.classList.add('fullscreen-mode'); } else { document.exitFullscreen(); elem.classList.remove('fullscreen-mode'); } }
document.addEventListener('fullscreenchange', () => { const wrappers = document.querySelectorAll('.img-viewer-wrapper'); if (!document.fullscreenElement) { wrappers.forEach(w => w.classList.remove('fullscreen-mode')); } });

function renderTextViewer(container, src) {
    // 1. 布局结构
    const wrapper = document.createElement('div');
    wrapper.className = 'text-viewer-wrapper';
    
    // 工具栏容器
    const toolbar = document.createElement('div');
    toolbar.className = 'text-toolbar';
    
    // 内容区域
    const textArea = document.createElement('textarea');
    textArea.className = 'text-content-area';
    textArea.readOnly = true; // 默认只读
    textArea.spellcheck = false;

    // --- 状态管理 ---
    // [修改点1] 默认 fontWeight 改为 'normal' (不加粗)
    const styleState = {
        fontWeight: 'normal', 
        fontStyle: 'normal',
        fontSize: '24px',
        lineHeight: 'calc(1em + 4px)', 
        letterSpacing: '2px'
    };
    
    let isEditing = false;
    
    // 撤销/重做 历史栈
    const historyStack = [];
    let historyIndex = -1;
    const MAX_HISTORY = 10;
    let debounceTimer = null;

    // --- 工具栏构建函数 ---
    const createBtn = (iconOrText, title, onClick, isSvg = false) => {
        const btn = document.createElement('button');
        btn.className = 'toolbar-btn';
        btn.title = title;
        if (isSvg) btn.innerHTML = iconOrText;
        else btn.textContent = iconOrText;
        btn.onclick = onClick;
        return btn;
    };

    const createSelect = (options, defaultValue, onChange, suffix = '') => {
        const sel = document.createElement('select');
        sel.className = 'toolbar-select';
        options.forEach(opt => {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            if (opt.value === defaultValue) el.selected = true;
            sel.appendChild(el);
        });
        sel.onchange = (e) => onChange(e.target.value);
        return sel;
    };

    // --- 样式应用逻辑 ---
    const applyStyles = () => {
        textArea.style.fontWeight = styleState.fontWeight;
        textArea.style.fontStyle = styleState.fontStyle;
        textArea.style.fontSize = styleState.fontSize;
        textArea.style.lineHeight = styleState.lineHeight;
        textArea.style.letterSpacing = styleState.letterSpacing;
    };

    // --- 历史记录管理 ---
    const pushHistory = (val) => {
        if (historyIndex < historyStack.length - 1) {
            historyStack.splice(historyIndex + 1);
        }
        historyStack.push(val);
        if (historyStack.length > MAX_HISTORY) {
            historyStack.shift();
        } else {
            historyIndex++;
        }
        updateUndoRedoUI();
    };

    const undo = () => {
        if (historyIndex > 0) {
            historyIndex--;
            const val = historyStack[historyIndex];
            textArea.value = val;
            updateUndoRedoUI();
        }
    };

    const redo = () => {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            const val = historyStack[historyIndex];
            textArea.value = val;
            updateUndoRedoUI();
        }
    };

    const updateUndoRedoUI = () => {
        btnUndo.style.display = isEditing ? 'flex' : 'none';
        btnRedo.style.display = isEditing ? 'flex' : 'none';
        
        btnUndo.disabled = historyIndex <= 0;
        btnRedo.disabled = historyIndex >= historyStack.length - 1;
    };

    // --- 工具栏控件组装 ---

    // Group 1: 样式切换
    const groupStyle = document.createElement('div');
    groupStyle.className = 'toolbar-group';
    
    const btnBold = createBtn('B', '加粗/取消', () => {
        styleState.fontWeight = styleState.fontWeight === 'bold' ? 'normal' : 'bold';
        btnBold.classList.toggle('active');
        applyStyles();
    });
    // [修改点2] 默认不再添加 active 类
    
    // [修改点3] 斜体图标改为斜杠符号 '/'
    const btnItalic = createBtn('/', '斜体/正体', () => {
        styleState.fontStyle = styleState.fontStyle === 'italic' ? 'normal' : 'italic';
        btnItalic.classList.toggle('active');
        applyStyles();
    });

    groupStyle.append(btnBold, btnItalic);

    // Group 2: 下拉参数
    const groupParams = document.createElement('div');
    groupParams.className = 'toolbar-group';

    const selSize = createSelect(
        [16, 20, 24, 28, 32, 36].map(v => ({value: `${v}px`, label: `${v}px`})),
        '24px',
        (val) => { styleState.fontSize = val; applyStyles(); }
    );

    const selLine = createSelect(
        [
            {value: 'calc(1em + 2px)', label: '行距: 窄'},
            {value: 'calc(1em + 4px)', label: '行距: 正常'},
            {value: 'calc(1em + 6px)', label: '行距: 宽'},
            {value: 'calc(1em + 8px)', label: '行距: 极宽'}
        ],
        'calc(1em + 4px)',
        (val) => { styleState.lineHeight = val; applyStyles(); }
    );

    const selSpacing = createSelect(
        [
            {value: '0px', label: '字距: 窄'},
            {value: '2px', label: '字距: 正常'},
            {value: '4px', label: '字距: 宽'},
            {value: '6px', label: '字距: 极宽'}
        ],
        '2px',
        (val) => { styleState.letterSpacing = val; applyStyles(); }
    );

    groupParams.append(selSize, selLine, selSpacing);

    // Group 3: 操作 (复制/编辑)
    const groupAction = document.createElement('div');
    groupAction.className = 'toolbar-group';

    const btnCopy = createBtn('📋', '复制全部', async () => {
        try {
            await navigator.clipboard.writeText(textArea.value);
            const originalText = btnCopy.textContent;
            btnCopy.textContent = '✅';
            setTimeout(() => btnCopy.textContent = originalText, 1500);
        } catch(e) { console.error(e); }
    });

    // [修改点4] 初始按钮文字去除 " 编辑"，仅保留图标
    const btnEditSave = createBtn('✏️', '切换编辑模式', async () => {
        if (!isEditing) {
            // 进入编辑模式
            isEditing = true;
            textArea.readOnly = false;
            textArea.classList.add('is-editing');
            
            // [修改点5] 切换为保存图标，不带文字
            btnEditSave.textContent = '💾';
            btnEditSave.title = "保存修改";
            
            btnEditSave.classList.add('btn-primary'); 
            
            if (historyStack.length === 0) {
                pushHistory(textArea.value);
            }
            updateUndoRedoUI();
        } else {
            // 保存操作
            const content = textArea.value;
            const originalText = btnEditSave.textContent;
            
            // [修改点6] 加载状态简化为沙漏
            btnEditSave.textContent = '⏳';
            btnEditSave.disabled = true;

            try {
                const res = await API.updateFileContent(src, content); 
                if (res.code === 0) {
                    isEditing = false;
                    textArea.readOnly = true;
                    textArea.classList.remove('is-editing');
                    // [修改点7] 恢复编辑图标
                    btnEditSave.textContent = '✏️';
                    btnEditSave.title = "切换编辑模式";
                    btnEditSave.classList.remove('btn-primary');
                    showGlobalToast && showGlobalToast('✅ 文件已保存');
                } else {
                    alert("保存失败: " + res.msg);
                    btnEditSave.textContent = '💾'; 
                }
            } catch(e) {
                alert("请求错误");
                btnEditSave.textContent = '💾';
            } finally {
                btnEditSave.disabled = false;
                updateUndoRedoUI();
            }
        }
    });

    groupAction.append(btnCopy, btnEditSave);

    // Group 4: 撤销/重做
    const groupHistory = document.createElement('div');
    groupHistory.className = 'toolbar-group';
    groupHistory.style.marginLeft = 'auto'; 
    groupHistory.style.borderRight = 'none';

    const iconUndo = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>`;
    const iconRedo = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l6 3.7"></path></svg>`;

    const btnUndo = createBtn(iconUndo, '撤销', undo, true);
    const btnRedo = createBtn(iconRedo, '重做', redo, true);
    
    btnUndo.style.display = 'none';
    btnRedo.style.display = 'none';

    groupHistory.append(btnUndo, btnRedo);

    // 组装
    toolbar.append(groupStyle, groupParams, groupAction, groupHistory);

    // --- 文本框事件 ---
    textArea.addEventListener('input', () => {
        if (!isEditing) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            pushHistory(textArea.value);
        }, 500);
    });

    // --- 加载文件 ---
    const timestamp = Date.now();
    const hasQuery = src.indexOf('?') > -1;
    const noCacheSrc = src + (hasQuery ? '&' : '?') + 't=' + timestamp;

    textArea.value = "正在加载...";
    
    fetch(noCacheSrc)
        .then(r => r.text())
        .then(text => {
            textArea.value = text;
            applyStyles(); 
        })
        .catch(e => {
            textArea.value = `加载失败: ${e.message}`;
        });

    wrapper.appendChild(toolbar);
    wrapper.appendChild(textArea);
    container.appendChild(wrapper);
}function renderAudioViewer(container, src) { const wrapper = document.createElement('div'); wrapper.className = 'result-viewer-container'; const icon = document.createElement('div'); icon.style.fontSize = '60px'; icon.textContent = '🎵'; let fileName = "Audio File"; try { fileName = src.split('/').pop().split('?')[0]; } catch(e){} const nameDiv = document.createElement('div'); nameDiv.style.marginTop = '10px'; nameDiv.style.marginBottom = '10px'; nameDiv.style.color = '#666'; nameDiv.style.fontSize = '14px'; nameDiv.textContent = fileName; const audio = document.createElement('audio'); audio.src = src; audio.controls = true; audio.style.width = '80%'; audio.style.maxWidth = '500px'; wrapper.appendChild(icon); wrapper.appendChild(nameDiv); wrapper.appendChild(audio); container.appendChild(wrapper); }
function renderVideoViewer(container, src) { const wrapper = document.createElement('div'); wrapper.className = 'result-viewer-container'; const video = document.createElement('video'); video.src = src; video.controls = true; video.style.maxWidth = '95%'; video.style.maxHeight = '95%'; wrapper.appendChild(video); container.appendChild(wrapper); }
function renderDownloadLink(container, src, type) { const el = document.createElement('a'); el.href = src; el.target = '_blank'; el.className = 'btn btn-primary'; el.innerHTML = `📄 下载文件 (${type})`; container.appendChild(el); }

function initGallerySection() {
    const navBtns = document.querySelectorAll('.g-nav-btn');
    const fileList = document.getElementById('gallery-file-list');
    const countLabel = document.getElementById('gallery-count');
    const previewArea = document.getElementById('gallery-preview-area');
    const btnSettings = document.getElementById('btn-gallery-settings');
    const modalPath = document.getElementById('modal-path-settings');
    const btnPathSave = document.getElementById('btn-path-save');
    const btnPathCancel = document.getElementById('btn-path-cancel');
    const pathInputs = { images: document.getElementById('path-input-images'), videos: document.getElementById('path-input-videos'), audios: document.getElementById('path-input-audios'), texts: document.getElementById('path-input-texts'), others: document.getElementById('path-input-others') };

    navBtns.forEach(btn => { btn.addEventListener('click', () => { navBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); State.galleryType = btn.dataset.type; loadGalleryFiles(); }); });

    async function loadGalleryFiles() {
        if(!fileList) return;
        fileList.innerHTML = '<div style="padding:20px;text-align:center;color:#ccc">加载中...</div>';
        const res = await API.getGalleryFiles(State.galleryType);
        fileList.innerHTML = '';
        if(res.code === 0) {
            if(countLabel) countLabel.textContent = res.count;
            if(res.data.length === 0) { fileList.innerHTML = '<div style="padding:20px;text-align:center;color:#ccc">暂无文件<br><span style="font-size:12px">请检查路径设置</span></div>'; return; }
            res.data.forEach(file => { const item = document.createElement('div'); item.className = 'file-item'; const sizeStr = file.size > 1024*1024 ? (file.size/(1024*1024)).toFixed(2) + ' MB' : (file.size/1024).toFixed(0) + ' KB'; item.innerHTML = `<div class="file-info-main"><span class="file-name" title="${file.name}">${file.name}</span><span class="file-meta">${new Date(file.mtime * 1000).toLocaleString()}</span></div><span class="file-size">${sizeStr}</span>`; item.onclick = () => { document.querySelectorAll('.file-item').forEach(i => i.classList.remove('active')); item.classList.add('active'); renderPreview(previewArea, file.path, file.type); }; fileList.appendChild(item); });
        } else { fileList.innerHTML = `<div style="padding:20px;text-align:center;color:red">加载失败: ${res.msg}</div>`; }
    }
    loadGalleryFiles();

    if(btnSettings) {
        btnSettings.onclick = async () => {
            if (typeof API.getSystemPaths !== 'function') { alert("请刷新页面更新 api.js"); return; }
            try {
                const res = await API.getSystemPaths();
                if(res.code === 0 && res.data) { for (const [key, val] of Object.entries(res.data)) { if(pathInputs[key]) pathInputs[key].value = val; } modalPath.classList.remove('hidden'); } 
                else { alert("无法获取路径配置: " + res.msg); }
            } catch (e) { alert("连接失败: " + e.message); }
        };
    }

    if(btnPathSave) {
        btnPathSave.onclick = async () => {
            const newPaths = {}; let hasEmpty = false;
            for (const [key, input] of Object.entries(pathInputs)) { if(!input) continue; const val = input.value.trim(); if(!val) hasEmpty = true; newPaths[key] = val; }
            if(hasEmpty) { if(!confirm("⚠️ 警告：部分路径为空，是否继续？")) return; }
            const res = await API.saveSystemPaths(newPaths);
            if(res.code === 0) { alert("✅ 路径配置已更新"); modalPath.classList.add('hidden'); loadGalleryFiles(); } else { alert("❌ 保存失败: " + res.msg); }
        };
    }
    if(btnPathCancel) btnPathCancel.onclick = () => modalPath.classList.add('hidden');

    setTimeout(() => {
        const resizer = document.getElementById('gallery-resizer');
        const sidebar = document.getElementById('gallery-sidebar');
        const container = document.querySelector('.gallery-content');
        if (!resizer || !sidebar || !container) return;
        let isResizing = false;
        resizer.onmousedown = (e) => { e.preventDefault(); isResizing = true; resizer.classList.add('resizing'); document.body.classList.add('resizing-cursor'); };
        document.onmousemove = (e) => { if (!isResizing) return; e.preventDefault(); const containerRect = container.getBoundingClientRect(); let newWidth = e.clientX - containerRect.left; const minW = 320; const maxW = (containerRect.width > 0 ? containerRect.width : 2000) * 0.5; if (newWidth < minW) newWidth = minW; if (newWidth > maxW) newWidth = maxW; sidebar.style.width = `${newWidth}px`; };
        document.onmouseup = () => { if (isResizing) { isResizing = false; resizer.classList.remove('resizing'); document.body.classList.remove('resizing-cursor'); } };
    }, 500); 
}