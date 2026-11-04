import requests

url = "https://ws-450xn3noh85vtypq.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
print(f"正在尝试连接：{url} ...")

try:
    # 只发个 GET 请求测网络通不通，不传 Key
    response = requests.get(url, timeout=10)
    print(f"✅ 网络通了！状态码: {response.status_code}")
    print("说明你的网络没拦截这个域名，大概率是之前的 API Key 或 Python 环境问题。")
except Exception as e:
    print(f"❌ 彻底连不上！错误信息:\n{e}")
    print("说明你的网络或者代理软件拦截了这个专属域名。")