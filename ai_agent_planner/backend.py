import json
import uuid
import sqlite3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from tavily import TavilyClient

'''
json：用于解析工具调用参数（字符串转字典）。
uuid：生成唯一的会话 ID。
FastAPI：高性能 Web 框架，用于构建 API。
CORSMiddleware：处理跨域资源共享，允许前端（React）从不同域名/端口请求后端。
BaseModel：Pydantic 提供的数据验证类，用于定义请求体的结构。
OpenAI：OpenAI 官方 Python 库，此处用它调用 DeepSeek 的 API（兼容 OpenAI 格式）。
TavilyClient：Tavily 搜索 API 的客户端，用于联网搜索学习资源。
'''

#后端启动命令：uvicorn backend:app --reload
#前端启动命令：npm run dev
#启动时需要注意文件路径

# 创建 FastAPI 应用实例
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
client = OpenAI(api_key="sk-4c4a96e64b814d39aabe0ceeb24b863a", base_url="https://api.deepseek.com/v1")

# Tavily 搜索 API Key（去 https://app.tavily.com 注册，免费 1000 次/月）
tavily_client = TavilyClient(api_key="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")

# ========== 0. 数据库持久化 & 系统提示词 ==========
import os
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions.db")

def _db_init():
    """初始化 SQLite 数据库，创建消息表"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_session_created
            ON messages(session_id, created_at)
        """)
        conn.commit()

_db_init()  # 启动时自动建表

def db_save_msg(session_id: str, msg: dict):
    """保存一条消息到数据库"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, msg["role"], msg.get("content", ""))
        )
        conn.commit()

def db_load_session(session_id: str) -> list[dict]:
    """从数据库加载一个会话的全部历史消息"""
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,)
        ).fetchall()
    return [{"role": row[0], "content": row[1]} for row in rows]

def db_delete_session(session_id: str):
    """删除一个会话的全部消息"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        conn.commit()

def db_session_exists(session_id: str) -> bool:
    """检查会话是否存在"""
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT 1 FROM messages WHERE session_id = ? LIMIT 1", (session_id,)
        ).fetchone()
    return row is not None

def db_list_sessions() -> list[dict]:
    """列出所有会话：id、标题（首条用户消息）、最后更新时间"""
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("""
            SELECT session_id,
                   (SELECT content FROM messages m2 WHERE m2.session_id = m1.session_id AND role = 'user' ORDER BY id LIMIT 1) AS title,
                   COUNT(*) AS msg_count,
                   MAX(created_at) AS last_updated
            FROM messages m1
            WHERE role != 'system'
            GROUP BY session_id
            ORDER BY MAX(id) DESC
        """).fetchall()
    return [
        {
            "session_id": row[0],
            "title": (row[1][:30] + "...") if row[1] and len(row[1]) > 30 else (row[1] or "新对话"),
            "msg_count": row[2],
            "last_updated": row[3]
        }
        for row in rows
    ]

SYSTEM_PROMPT = {
    "role": "system",
    "content": (
        "你是一个专业的学习规划助手，名叫「AI 全能学习 Agent」。"
        "你能够根据用户的学习目标制定分天学习计划，也能搜索推荐学习资源。"
        "请合理调用工具，并给出清晰、结构化、有鼓励性的中文建议。"
        "如果用户追问之前的计划，请结合对话历史中的上下文来回答。"
    )
}

# 上下文窗口：保留最近 N 轮对话（1 轮 = user + assistant 各一条）
MAX_HISTORY_ROUNDS = 10

# 多轮迭代：Agent 单次请求中最多调用工具的次数上限
MAX_AGENT_ITERATIONS = 8

def manage_context_window(history: list[dict]) -> list[dict]:
    """滑动窗口：始终保留 system prompt，裁剪非系统消息到最近 N 轮"""
    system_msgs = [m for m in history if m["role"] == "system"]
    chat_msgs = [m for m in history if m["role"] != "system"]
    # 保留最近 2*MAX_HISTORY_ROUNDS 条聊天消息
    trimmed = chat_msgs[-(2 * MAX_HISTORY_ROUNDS):]
    return system_msgs + trimmed


# 定义前端传入的数据结构
class UserQuery(BaseModel):
    prompt: str
    session_id: str = ""   # 空字符串 → 自动创建新会话


# ========== 1. 定义工具函数 ==========
# 学习规划工具
def tool_plan_study(goal: str, days: int = 5):
    return f"已为您制定 {days} 天的《{goal}》学习规划：\nDay 1: 基础概念\nDay 2: 环境搭建与核心语法\nDay 3: 实战小项目\nDay 4: 进阶技巧与排错\nDay 5: 完整项目构建与复盘。"

# 通过 Tavily 真实搜索学习资源
def tool_search_resources(keyword: str):
    try:
        response = tavily_client.search(
            query=f"{keyword} 学习教程 入门",
            search_depth="basic",
            max_results=5,
        )
        results = response.get("results", [])
        if not results:
            return f"未找到关于「{keyword}」的学习资源，请尝试更换关键词。"

        lines = []
        for r in results:
            title = r.get("title", "无标题")
            url = r.get("url", "")
            content = r.get("content", "")[:200]  # 截取前 200 字符
            lines.append(
                f"📖 **{title}**\n"
                f"   {content}\n"
                f"   🔗 {url}"
            )
        return "\n\n".join(lines)
    except Exception as e:
        return f"搜索失败: {str(e)}"


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
            "description": "联网搜索特定学习主题的真实资源、教程和文章链接，返回标题、摘要和 URL。",
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
    # --- 会话管理 ---
    sid = query.session_id or str(uuid.uuid4())
    if not db_session_exists(sid):
        db_save_msg(sid, SYSTEM_PROMPT)

    history = db_load_session(sid)
    history.append({"role": "user", "content": query.prompt})
    db_save_msg(sid, {"role": "user", "content": query.prompt})  # 持久化用户消息到 DB

    # --- 上下文窗口裁剪 ---
    messages = manage_context_window(history)

    # --- 多轮迭代 Agent 循环 ---
    agent_logs = []
    final_answer = ""

    for iteration in range(1, MAX_AGENT_ITERATIONS + 1):
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            tools=tools,
            tool_choice="auto"
        )
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls

        # 没有工具调用 → LLM 认为信息够了，这就是最终答案
        if not tool_calls:
            final_answer = response_message.content
            break

        # 有工具调用 → 执行并追加结果，继续下一轮
        messages.append(response_message)
        for tool_call in tool_calls:
            func_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            agent_logs.append(f"🔁 第{iteration}轮 → 🛠️ 调用 {func_name}, 参数: {args}")

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

    else:
        # for 循环正常结束（从未 break）→ 达到最大迭代次数
        final_answer = "⚠️ Agent 已达到最大思考轮次上限，请尝试缩小问题范围后重新提问。"
        agent_logs.append(f"⛔ 已达最大迭代次数 {MAX_AGENT_ITERATIONS}，强制终止")

    # --- 持久化本轮对话到 SQLite ---
    db_save_msg(sid, {"role": "assistant", "content": final_answer})

    return {
        "session_id": sid,
        "logs": agent_logs,
        "answer": final_answer
    }


# ========== 4. 清除会话接口 ==========
@app.post("/api/clear")
async def clear_session(data: dict):
    sid = data.get("session_id", "")
    if sid:
        db_delete_session(sid)
    return {"status": "ok"}


# ========== 5. 会话列表 & 历史接口 ==========
@app.get("/api/sessions")
async def list_sessions():
    """返回所有历史会话列表"""
    return {"sessions": db_list_sessions()}


@app.get("/api/session/{sid}")
async def get_session(sid: str):
    """返回指定会话的完整消息历史"""
    history = db_load_session(sid)
    return {
        "session_id": sid,
        "messages": [m for m in history if m["role"] != "system"]  # 不返回 system prompt
    }
