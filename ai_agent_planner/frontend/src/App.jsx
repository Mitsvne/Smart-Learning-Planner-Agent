import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE = 'http://127.0.0.1:8000';
const SESSION_STORAGE_KEY = 'ai_agent_session_id';
const MESSAGES_STORAGE_KEY = 'ai_agent_messages';

function App() {
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(MESSAGES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [sessionId, setSessionId] = useState(() =>
    localStorage.getItem(SESSION_STORAGE_KEY) || crypto.randomUUID()
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const latestSessionRef = useRef(sessionId);  // 追踪最新请求的会话，防止竞态

  // ====== 持久化 ======
  useEffect(() => {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // ====== 会话列表 ======
  const refreshSessions = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/sessions`);
      setSessions(res.data.sessions);
    } catch { /* 后端未启动时静默失败 */ }
  }, []);

  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  // ====== 切换会话 ======
  const switchSession = useCallback(async (sid) => {
    if (sid === sessionId) return;
    setSessionId(sid);
    setMessages([]);   // 立即清空，避免显示旧会话的消息造成状态不一致
    setLogs([]);
    latestSessionRef.current = sid;
    try {
      const res = await axios.get(`${API_BASE}/api/session/${sid}`);
      if (latestSessionRef.current === sid) {
        setMessages(res.data.messages);
      }
    } catch {
      if (latestSessionRef.current === sid) {
        setMessages([]);
      }
    }
  }, [sessionId]);

  // ====== 新对话（不再删除旧会话） ======
  const handleNewSession = useCallback(() => {
    const newId = crypto.randomUUID();
    setSessionId(newId);
    setMessages([]);
    setLogs([]);
    refreshSessions();
  }, [refreshSessions]);

  // ====== 删除会话 ======
  const handleDeleteSession = useCallback(async (sid, e) => {
    e.stopPropagation();
    await axios.post(`${API_BASE}/api/clear`, { session_id: sid }).catch(() => {});
    if (sid === sessionId) {
      const newId = crypto.randomUUID();
      setSessionId(newId);
      setMessages([]);
      setLogs([]);
    }
    refreshSessions();
  }, [sessionId, refreshSessions]);

  // ====== 自动滚动 ======
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(() => { scrollToBottom(); }, [messages, logs]);

  // ====== 发送消息 ======
  const handleSubmit = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setLogs([]);

    try {
      const res = await axios.post(`${API_BASE}/api/agent`, {
        prompt: userMsg.content,
        session_id: sessionId
      });

      setLogs(res.data.logs);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.answer
      }]);

      // 刷新列表以更新标题和时间
      refreshSessions();
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ 连接 AI 服务失败，请确认 Python 后端是否还在运行！'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ====== 格式化时间 ======
  const formatTime = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr + 'Z');
    const now = new Date();
    const diffMs = now - d;
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return '刚刚';
    if (diffH < 24) return `${diffH} 小时前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD} 天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ====== 侧边栏遮罩（移动端） ====== */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ====== 侧边栏 ====== */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30
        w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0
        transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:-translate-x-full'}
      `}>
        {/* 新对话按钮 */}
        <div className="p-3 border-b border-gray-200">
          <button
            onClick={() => { handleNewSession(); setSidebarOpen(false); }}
            className="w-full py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            🆕 新对话
          </button>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-center text-gray-400 text-xs mt-8">暂无历史对话</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.session_id}
              onClick={() => { switchSession(s.session_id); setSidebarOpen(false); }}
              className={`
                group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors
                ${s.session_id === sessionId ? 'bg-blue-50 border border-blue-100' : 'hover:bg-gray-50 border border-transparent'}
              `}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate text-gray-700">{s.title}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {formatTime(s.last_updated)}
                  <span className="ml-2">{s.msg_count} 条</span>
                </p>
              </div>
              <button
                onClick={(e) => handleDeleteSession(s.session_id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all shrink-0"
                title="删除会话"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {/* 底部信息 */}
        <div className="px-3 py-2 border-t border-gray-200 text-[11px] text-gray-400 text-center">
          {sessions.length} 个会话
        </div>
      </aside>

      {/* ====== 主聊天区域 ====== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部导航栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b shadow-sm">
          <div className="flex items-center gap-2">
            {/* 移动端汉堡菜单 */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {/* 桌面端侧边栏切换 */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
              title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {sidebarOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                }
              </svg>
            </button>
            <span className="text-xl">🎓</span>
            <h1 className="text-lg font-bold text-gray-800">AI 全能学习 Agent</h1>
            <span className="ml-1 px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full hidden sm:inline">全栈版</span>
          </div>
        </div>

        {/* 聊天消息区域 */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-4xl mx-auto w-full">
          {Array.isArray(messages) && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
              <span className="text-6xl mb-4">🤖</span>
              <p className="text-lg font-medium">输入你的学习目标，AI 帮你规划</p>
              <p className="text-sm mt-1">例如：我想用 3 天时间入门 Python 爬虫</p>
            </div>
          )}

          {Array.isArray(messages) && messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none'
              }`}>
                {msg.role === 'user' ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed break-words">
                    {msg.content}
                  </pre>
                ) : (
                  <div className="prose prose-sm max-w-none text-gray-800 [&_li]:list-disc [&_li]:ml-4 [&_strong]:font-bold [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 思考过程展示 */}
          {logs.length > 0 && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-600">
                <details>
                  <summary className="cursor-pointer font-medium text-gray-700 mb-1">🧠 查看 Agent 内部思考过程</summary>
                  <div className="mt-2 space-y-1 pl-2 border-l-2 border-gray-300">
                    {logs.map((log, i) => (
                      <p key={i} className="whitespace-pre-wrap font-mono">{log}</p>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm rounded-bl-none flex items-center gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse delay-75">●</span>
                <span className="animate-pulse delay-150">●</span>
                <span className="ml-1 text-gray-500 text-sm">AI 正在思考...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 底部输入区域 */}
        <div className="border-t bg-white p-4">
          <div className="max-w-4xl mx-auto flex gap-2">
            <textarea
              className="flex-1 p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[52px] max-h-32 text-sm"
              placeholder="输入你想学习的内容..."
              rows="1"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="px-6 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center font-medium min-w-[80px]"
            >
              {loading ? '...' : '发送'}
            </button>
          </div>
          <div className="text-center mt-2 text-[10px] text-gray-400">
            AI 生成内容仅供参考，建议结合自身情况调整学习计划。
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
