import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

# 初始化后端
app = FastAPI()

# 允许跨域（让 React 能请求到 Python）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DeepSeek API Key
client = OpenAI(api_key="你的deepseekAPI", base_url="https://api.deepseek.com/v1")


# 定义前端传入的数据结构
class UserQuery(BaseModel):
    prompt: str


# ========== 1. 定义工具函数 ==========
def tool_plan_study(goal: str, days: int = 5):
    return f"已为您制定 {days} 天的《{goal}》学习规划：\nDay 1: 基础概念\nDay 2: 环境搭建与核心语法\nDay 3: 实战小项目\nDay 4: 进阶技巧与排错\nDay 5: 完整项目构建与复盘。"


def tool_search_resources(keyword: str):
    return "\n".join([
        f"【实战教程】{keyword} 从零到精通 - 哔哩哔哩",
        f"【官方文档】{keyword} 最新 API 手册",
        f"【博客精选】{keyword} 必踩的 10 个坑"
    ])


# ========== 2. 定义工具描述 (让大模型知道能干啥) ==========
tools = [
    {
        "type": "function",
        "function": {
            "name": "tool_plan_study",
            "description": "根据用户的学习目标，生成详细的分天学习规划。",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "学习目标"},
                    "days": {"type": "integer", "description": "规划的天数"}
                },
                "required": ["goal"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "tool_search_resources",
            "description": "搜索特定学习主题的相关资源链接或推荐。",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"}
                },
                "required": ["keyword"]
            }
        }
    }
]


# ========== 3. 核心 API 接口 ==========
@app.post("/api/agent")
async def run_agent(query: UserQuery):
    messages = [{"role": "user", "content": query.prompt}]
    response = client.chat.completions.create(
        model="deepseek-chat",
        messages=messages,
        tools=tools,
        tool_choice="auto"
    )
    response_message = response.choices[0].message
    tool_calls = response_message.tool_calls
    agent_logs = []

    if tool_calls:
        messages.append(response_message)
        for tool_call in tool_calls:
            func_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            agent_logs.append(f"🛠️ 调用 {func_name}, 参数: {args}")

            if func_name == "tool_plan_study":
                result = tool_plan_study(**args)
            elif func_name == "tool_search_resources":
                result = tool_search_resources(**args)
            else:
                result = "未知工具"

            messages.append({
                "tool_call_id": tool_call.id,
                "role": "tool",
                "name": func_name,
                "content": result
            })

        second_response = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages
        )
        return {"logs": agent_logs, "answer": second_response.choices[0].message.content}
    else:
        return {"logs": [], "answer": response_message.content}