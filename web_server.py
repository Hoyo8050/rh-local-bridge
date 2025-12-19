import os
import json
import logging
import requests
import threading
import time
from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS

# 配置日志格式
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='web', static_url_path='')
CORS(app)

# --- 配置部分 ---
PORT = 8050
HOST = '0.0.0.0'
RH_HOST = 'https://www.runninghub.cn'
EXIT_CODE_STOP = 0
EXIT_CODE_RESTART = 11

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')

# 默认路径配置
DEFAULT_PATHS = {
    "images": "outputs/images",
    "videos": "outputs/videos",
    "audios": "outputs/audios",
    "texts": "outputs/texts",
    "others": "outputs/others"
}

# --- 核心：配置管理 ---
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"读取配置失败: {e}")
    return {"paths": DEFAULT_PATHS.copy()}

def save_config(config_data):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logger.error(f"保存配置失败: {e}")

# 初始化配置
GLOBAL_CONFIG = load_config()

# 确保默认目录存在 (仅针对默认路径)
for key, path in DEFAULT_PATHS.items():
    abs_path = os.path.join(BASE_DIR, path)
    if not os.path.exists(abs_path):
        os.makedirs(abs_path)

# 辅助函数：解析真实路径 (支持绝对路径和相对路径)
def get_real_path(path_key):
    # 1. 获取配置中的路径字符串
    configured_path = GLOBAL_CONFIG.get("paths", {}).get(path_key, DEFAULT_PATHS.get(path_key))
    
    # 2. 判断是否为绝对路径
    if os.path.isabs(configured_path):
        real_path = configured_path
    else:
        real_path = os.path.join(BASE_DIR, configured_path)
    
    # 3. 容错：如果目录不存在，尝试创建
    if not os.path.exists(real_path):
        try:
            os.makedirs(real_path)
        except:
            pass # 如果是系统盘根目录等无权限位置，可能失败，暂忽略
            
    return real_path

# --- 路由：前端页面 ---
@app.route('/')
def index():
    return send_from_directory('web', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('web', path)

# --- 系统控制接口 ---
def shutdown_server(exit_code):
    time.sleep(1) 
    logger.info(f"👋 系统操作: Code {exit_code}")
    os._exit(exit_code)

@app.route('/api/system/control', methods=['POST'])
def system_control():
    action = request.json.get('action')
    if action == 'restart':
        threading.Thread(target=shutdown_server, args=(EXIT_CODE_RESTART,)).start()
        return jsonify({"code": 0, "msg": "系统正在重启..."})
    elif action == 'exit':
        threading.Thread(target=shutdown_server, args=(EXIT_CODE_STOP,)).start()
        return jsonify({"code": 0, "msg": "系统正在退出..."})
    return jsonify({"code": -1, "msg": "未知指令"})

# --- 路径配置接口 ---
@app.route('/api/system/paths', methods=['GET', 'POST'])
def handle_paths_config():
    if request.method == 'GET':
        return jsonify({"code": 0, "data": GLOBAL_CONFIG.get("paths", DEFAULT_PATHS)})
    else:
        new_paths = request.json
        if not new_paths: return jsonify({"code": -1, "msg": "参数为空"})
        
        # 更新配置
        GLOBAL_CONFIG["paths"] = new_paths
        save_config(GLOBAL_CONFIG)
        return jsonify({"code": 0, "msg": "路径配置已保存"})

# --- 路由：作品库 (动态路径版) ---
@app.route('/api/gallery/files', methods=['GET'])
def get_gallery_files():
    file_type = request.args.get('type', 'images')
    # 动态获取真实路径
    target_dir = get_real_path(file_type)
    
    if not os.path.exists(target_dir): 
        return jsonify({"code": 0, "data": [], "msg": "Directory not found"})
        
    files = []
    try:
        for f in os.listdir(target_dir):
            if f.startswith('.'): continue
            file_path = os.path.join(target_dir, f)
            if os.path.isfile(file_path):
                stat = os.stat(file_path)
                # 注意：这里返回的 path 是用于前端 img src 的 URL 路径
                files.append({
                    "name": f, 
                    "path": f"/outputs_proxy/{file_type}/{f}", # 指向代理路由
                    "size": stat.st_size, 
                    "mtime": stat.st_mtime,
                    "type": f.split('.')[-1].upper() if '.' in f else 'UNKNOWN'
                })
        files.sort(key=lambda x: x['mtime'], reverse=True)
    except Exception as e:
        logger.error(f"遍历目录失败: {e}")
        return jsonify({"code": -1, "msg": str(e)})
        
    return jsonify({"code": 0, "data": files, "count": len(files)})

# --- 核心优化：文件访问代理 (支持任意路径 + 禁止缓存) ---
@app.route('/outputs_proxy/<file_type>/<path:filename>')
def serve_output_proxy(file_type, filename):
    target_dir = get_real_path(file_type)
    response = make_response(send_from_directory(target_dir, filename))
    # [核心修改] 强制禁止缓存，确保前端读取到最新保存的内容
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

# --- API 代理 ---
# --- API 代理 (增强版：修复大整数精度丢失问题) ---
def proxy_request(method, endpoint, payload=None):
    url = f"{RH_HOST}{endpoint}"
    headers = {'Host': 'www.runninghub.cn', 'Content-Type': 'application/json'}
    logger.info(f"👉 RunningHub: {url}")
    try:
        if method == 'GET': 
            response = requests.get(url, headers=headers)
        else: 
            # [重要] 如果是取消任务，确保 payload 里的 taskId 是字符串（虽然前端应该已经是字符串了，双保险）
            if payload and 'taskId' in payload:
                payload['taskId'] = str(payload['taskId'])
            response = requests.post(url, headers=headers, data=json.dumps(payload))
        
        # 获取原始 JSON 数据
        resp_data = response.json()

        # [核心修复] 遍历数据，将所有 taskId 字段强制转换为字符串
        # 避免前端 JS 解析 19 位大整数时出现精度丢失 (变成 ...00)
        if isinstance(resp_data, dict):
            # 1. 检查根目录下的 data
            if 'data' in resp_data and isinstance(resp_data['data'], dict):
                data_obj = resp_data['data']
                if 'taskId' in data_obj:
                    data_obj['taskId'] = str(data_obj['taskId'])
            
            # 2. 针对某些接口直接返回 taskId 的情况 (如果有)
            if 'taskId' in resp_data:
                resp_data['taskId'] = str(resp_data['taskId'])

        return jsonify(resp_data)

    except Exception as e: 
        return jsonify({"code": -1, "msg": str(e)})

@app.route('/uc/openapi/accountStatus', methods=['POST'])
def account_status(): return proxy_request('POST', '/uc/openapi/accountStatus', request.json)

@app.route('/api/webapp/apiCallDemo', methods=['GET'])
def webapp_info():
    api_key = request.args.get('apiKey')
    webapp_id = request.args.get('webappId')
    url = f"{RH_HOST}/api/webapp/apiCallDemo?apiKey={api_key}&webappId={webapp_id}"
    try: return jsonify(requests.get(url).json())
    except Exception as e: return jsonify({"code": -1, "msg": str(e)})

@app.route('/task/openapi/ai-app/run', methods=['POST'])
def run_task(): return proxy_request('POST', '/task/openapi/ai-app/run', request.json)

@app.route('/task/openapi/status', methods=['POST'])
def task_status(): return proxy_request('POST', '/task/openapi/status', request.json)

@app.route('/task/openapi/cancel', methods=['POST'])
def cancel_task(): return proxy_request('POST', '/task/openapi/cancel', request.json)

@app.route('/task/openapi/outputs', methods=['POST'])
def task_outputs(): return proxy_request('POST', '/task/openapi/outputs', request.json)

@app.route('/task/openapi/upload', methods=['POST'])
def upload_resource():
    try:
        # 上传依然暂存到默认的 inputs 目录，暂不改动
        INPUTS_DIR = os.path.join(BASE_DIR, 'inputs')
        if 'file' not in request.files: return jsonify({"code": -1, "msg": "No file"})
        file = request.files['file']
        ft = request.form.get('fileType')
        save_folder = 'others'
        if ft == 'IMAGE': save_folder = 'images'
        elif ft == 'VIDEO': save_folder = 'videos'
        elif ft == 'AUDIO': save_folder = 'audios'
        
        target_path = os.path.join(INPUTS_DIR, save_folder)
        if not os.path.exists(target_path): os.makedirs(target_path)
        
        save_path = os.path.join(target_path, file.filename)
        file.save(save_path)
        
        url = f"{RH_HOST}/task/openapi/upload"
        multipart_data = {
            'apiKey': request.form.get('apiKey'), 'fileType': ft,
            'nodeId': request.form.get('nodeId'), 'fileName': file.filename
        }
        with open(save_path, 'rb') as f:
            files = {'file': (file.filename, f, file.content_type)}
            return jsonify(requests.post(url, files=files, data=multipart_data).json())
    except Exception as e: return jsonify({"code": -1, "msg": str(e)})

@app.route('/api/save_result', methods=['POST'])
def save_result():
    try:
        data = request.json
        file_url = data.get('fileUrl')
        filename = file_url.split('/')[-1]
        ext = filename.split('.')[-1].lower()
        
        # 自动映射到对应的分类目录
        cat_key = 'others'
        if ext in ['png', 'jpg', 'jpeg', 'webp', 'gif']: cat_key = 'images'
        elif ext in ['mp4', 'avi', 'mov', 'webm']: cat_key = 'videos'
        elif ext in ['mp3', 'wav', 'flac']: cat_key = 'audios'
        elif ext in ['txt', 'json', 'md', 'xml']: cat_key = 'texts'
        
        # 使用配置的路径
        target_dir = get_real_path(cat_key)
        save_path = os.path.join(target_dir, filename)
        
        local_proxy_path = f"/outputs_proxy/{cat_key}/{filename}"

        # [核心修改] 如果本地文件已存在且不为空，直接返回本地路径，防止覆盖用户编辑过的内容
        if os.path.exists(save_path) and os.path.getsize(save_path) > 0:
            logger.info(f"文件已存在且非空，跳过下载: {filename}")
            return jsonify({"code": 0, "msg": "exist", "localPath": local_proxy_path})

        r = requests.get(file_url, stream=True)
        if r.status_code == 200:
            with open(save_path, 'wb') as f:
                for chunk in r.iter_content(1024): f.write(chunk)
            return jsonify({"code": 0, "msg": "success", "localPath": local_proxy_path})
            
        return jsonify({"code": -1, "msg": "Download failed"})
    except Exception as e: return jsonify({"code": -1, "msg": str(e)})

# --- [新增/完善] 文件内容更新接口 ---
@app.route('/api/file/update', methods=['POST'])
def update_file_content():
    try:
        data = request.json
        # filePath 格式如: /outputs_proxy/texts/abc.txt
        file_path_url = data.get('filePath')
        content = data.get('content')
        
        if not file_path_url or content is None:
            return jsonify({"code": -1, "msg": "参数缺失"})

        # 解析真实路径
        parts = file_path_url.strip('/').split('/')
        # 预期 parts: ['outputs_proxy', 'texts', 'filename.txt']
        if len(parts) < 3 or parts[0] != 'outputs_proxy':
             return jsonify({"code": -1, "msg": "非法路径"})
        
        cat_key = parts[1]
        filename = parts[2]
        
        target_dir = get_real_path(cat_key)
        real_save_path = os.path.join(target_dir, filename)
        
        # 安全检查：确保文件在目标目录内
        if not os.path.abspath(real_save_path).startswith(os.path.abspath(target_dir)):
            return jsonify({"code": -1, "msg": "非法路径访问"})

        # 写入文件
        with open(real_save_path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        logger.info(f"文件内容已更新: {filename}")
        return jsonify({"code": 0, "msg": "保存成功"})
    except Exception as e:
        logger.error(f"更新文件失败: {e}")
        return jsonify({"code": -1, "msg": str(e)})

if __name__ == '__main__':
    app.run(host=HOST, port=PORT, debug=True)