import os
import sys
import subprocess
import time
import webbrowser
import platform

# 定义退出码常量 (与 web_server.py 约定)
EXIT_CODE_STOP = 0
EXIT_CODE_RESTART = 11  # 自定义重启信号

def is_venv():
    """检查当前是否在虚拟环境中运行"""
    return (hasattr(sys, 'real_prefix') or
            (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix))

def create_and_setup_venv():
    """创建并配置虚拟环境"""
    print("🔨 未检测到虚拟环境，正在为您创建...")
    subprocess.check_call([sys.executable, '-m', 'venv', 'venv'])
    
    if platform.system() == "Windows":
        pip_exe = os.path.join('venv', 'Scripts', 'pip')
        python_exe = os.path.join('venv', 'Scripts', 'python')
    else:
        pip_exe = os.path.join('venv', 'bin', 'pip')
        python_exe = os.path.join('venv', 'bin', 'python')
        
    print("📦 正在安装依赖包 (可能需要几分钟)...")
    subprocess.check_call([pip_exe, 'install', '-r', 'requirements.txt'])
    print("✅ 环境配置完成！")
    return python_exe

def main():
    print("="*50)
    print("   RunningHub AI应用调用中心 - 启动程序")
    print("="*50)

    # 1. 环境检测
    if is_venv():
        python_exe = sys.executable
    else:
        if os.path.exists('venv'):
            if platform.system() == "Windows":
                python_exe = os.path.join('venv', 'Scripts', 'python')
            else:
                python_exe = os.path.join('venv', 'bin', 'python')
        else:
            python_exe = create_and_setup_venv()

    # 2. 守护循环 (核心修改)
    first_run = True
    while True:
        print(f"🚀 正在启动服务器 (端口 8050)...")
        
        # 启动子进程
        server_process = subprocess.Popen([python_exe, 'web_server.py'])

        # 仅首次启动时自动打开浏览器
        if first_run:
            time.sleep(2) 
            url = "http://localhost:8050"
            print(f"🌍 正在打开浏览器: {url}")
            webbrowser.open(url)
            first_run = False

        try:
            # 等待子进程结束，并获取退出码
            return_code = server_process.wait()
            
            if return_code == EXIT_CODE_RESTART:
                print("\n" + "="*30)
                print("🔄 收到重启指令，系统将在 3秒 后重启...")
                print("="*30 + "\n")
                time.sleep(3)
                continue # 重新进入循环，再次启动
            else:
                print("\n" + "="*30)
                print("🛑 收到退出指令，程序已安全停止。")
                print("="*30 + "\n")
                break # 跳出循环，结束程序

        except KeyboardInterrupt:
            print("\n🛑 强制停止...")
            server_process.terminate()
            break

if __name__ == "__main__":
    main()