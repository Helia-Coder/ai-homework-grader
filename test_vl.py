import os
import base64
import requests
import io
from dotenv import load_dotenv
from PIL import Image

# 1. 读取 Key
load_dotenv()
api_key = os.getenv("DASHSCOPE_API_KEY")
print(f"当前使用的 Key 是:{api_key[:10]}..." if api_key else "❌ 没读取到 Key")

if not api_key:
    print("❌ 没找到 Key,请检查 .env 文件")
    exit()

# 2. 读取并压缩图片
img_path = "4.jpg"
img = Image.open(img_path)
# 将图片长宽缩放到 800 以内，极大减小 Base64 体积
img.thumbnail((800, 800))
buffer = io.BytesIO()
img.convert("RGB").save(buffer, format="JPEG")
img_b64 = base64.b64encode(buffer.getvalue()).decode()

# 3. 构造请求
url = "https://ws-450xn3noh85vtypq.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

prompt = """
你是一个专业的数理化作业批改助手。
请识别这张图片中的内容，并严格按照以下 JSON 格式输出，不要输出任何其他废话，不要用 markdown 的代码块包裹：
{
  "题目": "提取图片中的完整题干内容，如果有数学公式请用 LaTeX 格式",
  "学生作答": "提取学生手写的内容，如果有数学公式请用 LaTeX 格式",
  "识别置信度": "高/中/低"
}
"""

data = {
    "model": "qwen3.7-plus",
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                {"type": "text", "text": prompt}
            ]
        }
    ]
}

print(f"\n⏳ 正在直接发送 POST 请求识别 {img_path}，请稍等...\n")

try:
    response = requests.post(url, headers=headers, json=data, timeout=120)

    if response.status_code == 200:
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        print("🎉 识别成功！结果如下：")
        print("-" * 40)
        print(content)
        print("-" * 40)
    else:
        print(f"❌ 请求失败，状态码: {response.status_code}")
        print(response.text)

except Exception as e:
    print(f"❌ 运行报错: {str(e)}")