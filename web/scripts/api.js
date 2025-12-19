/**
 * api.js
 * 负责与后端 Python 服务器 (port 8050) 通讯，并记录日志
 */

const API_BASE = ''; // 相对路径，因为前端由后端托管

// 日志工具函数
const Logger = {
    logRequest: (url, method, data) => {
        const box = document.getElementById('log-request');
        if (!box) return;
        const timestamp = new Date().toLocaleTimeString();
        const content = `[${timestamp}] ${method} ${url}\n${data ? JSON.stringify(data, null, 2) : ''}\n------------------\n`;
        box.textContent = content + box.textContent; // 新日志在最上
    },
    logResponse: (data) => {
        const box = document.getElementById('log-response');
        if (!box) return;
        const timestamp = new Date().toLocaleTimeString();
        // 如果数据太长（比如 huge base64），截断显示
        let displayData = JSON.stringify(data, null, 2);
        if (displayData.length > 2000) displayData = displayData.substring(0, 2000) + '... (截断)';
        
        const content = `[${timestamp}] Response:\n${displayData}\n------------------\n`;
        box.textContent = content + box.textContent;
    }
};

// 核心请求函数
async function sendRequest(endpoint, method = 'POST', payload = null) {
    const url = `${API_BASE}${endpoint}`;
    
    // 记录请求日志
    Logger.logRequest(url, method, payload);

    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        if (payload && method !== 'GET') {
            options.body = JSON.stringify(payload);
        }

        const res = await fetch(url, options);
        // 如果是 404 或 500，fetch 不会报错，需要手动检查
        if (!res.ok) {
            throw new Error(`HTTP Error: ${res.status}`);
        }
        
        const data = await res.json();
        
        // 记录响应日志
        Logger.logResponse(data);
        return data;

    } catch (error) {
        console.error('API Error:', error);
        Logger.logResponse({ error: error.message });
        return { code: -1, msg: error.message };
    }
}

// --- API 接口定义 ---

const API = {
    // 1. 获取账户信息
    getAccountStatus: (apiKey) => {
        return sendRequest('/uc/openapi/accountStatus', 'POST', { apikey: apiKey });
    },

    // 2. 获取 AI 应用信息 (GET)
    getWebappInfo: (apiKey, webappId) => {
        return sendRequest(`/api/webapp/apiCallDemo?apiKey=${apiKey}&webappId=${webappId}`, 'GET');
    },

    // 3. 发起任务
    runTask: (payload) => {
        return sendRequest('/task/openapi/ai-app/run', 'POST', payload);
    },

    // 4. 查询任务状态
    getTaskStatus: (apiKey, taskId) => {
        return sendRequest('/task/openapi/status', 'POST', { apiKey, taskId });
    },

    // 5. 取消任务
    cancelTask: (apiKey, taskId) => {
        return sendRequest('/task/openapi/cancel', 'POST', { apiKey, taskId });
    },

    // 6. 获取任务结果
    getTaskOutputs: (apiKey, taskId) => {
        return sendRequest('/task/openapi/outputs', 'POST', { apiKey, taskId });
    },

    // 7. 保存远程文件到本地
    saveResultFile: (fileUrl, fileType) => {
        return sendRequest('/api/save_result', 'POST', { fileUrl, fileType });
    },

    // 8. 获取本地作品库列表
    getGalleryFiles: (type) => {
        return sendRequest(`/api/gallery/files?type=${type}`, 'GET');
    },

    // 9. 上传资源文件 (特殊处理，使用 FormData)
    uploadResource: async (file, apiKey, nodeId, fileType) => {
        const url = '/task/openapi/upload';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('apiKey', apiKey);
        formData.append('nodeId', nodeId);
        formData.append('fileType', fileType);

        Logger.logRequest(url, 'POST (Multipart)', { fileName: file.name, type: fileType });

        try {
            const res = await fetch(url, {
                method: 'POST',
                body: formData // fetch 会自动设置 Content-Type 为 multipart/form-data
            });
            const data = await res.json();
            Logger.logResponse(data);
            return data;
        } catch (error) {
            Logger.logResponse({ error: error.message });
            return { code: -1, msg: error.message };
        }
    },

    // 10. 更新文件内容 (新增功能)
    updateFileContent: (filePath, content) => {
        return sendRequest('/api/file/update', 'POST', { filePath, content });
    },


    // 11. 获取系统路径配置 [Step 82]
    getSystemPaths: () => {
        return sendRequest('/api/system/paths', 'GET');
    },

    // 12. 保存系统路径配置 [Step 82]
    saveSystemPaths: (paths) => {
        return sendRequest('/api/system/paths', 'POST', paths);
    }
    
};

// 绑定日志框工具按钮
const btnCopyReq = document.getElementById('btn-log-req-copy');
if(btnCopyReq) btnCopyReq.onclick = () => {
    navigator.clipboard.writeText(document.getElementById('log-request').textContent);
};
const btnCopyRes = document.getElementById('btn-log-res-copy');
if(btnCopyRes) btnCopyRes.onclick = () => {
    navigator.clipboard.writeText(document.getElementById('log-response').textContent);
};
const btnWrapReq = document.getElementById('btn-log-req-wrap');
if(btnWrapReq) btnWrapReq.onclick = () => {
    document.getElementById('log-request').classList.toggle('nowrap');
};
const btnWrapRes = document.getElementById('btn-log-res-wrap');
if(btnWrapRes) btnWrapRes.onclick = () => {
    document.getElementById('log-response').classList.toggle('nowrap');
};

