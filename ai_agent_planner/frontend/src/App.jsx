import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const messagesEndRef = useRef(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, logs]);

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setLogs([]);

    try {
      const res = await axios.post('http://127.0.0.1:8000/api/agent', {
        prompt: userMsg.content
      });

      setLogs(res.data.logs);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.answer
      }]);

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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎓</span>
          <h1 className="text-xl font-bold text-gray-800">AI 全能学习 Agent</h1>
          <span className="ml-2 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">全栈版</span>
        </div>
      </div>

      {/* 聊天消息区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 select-none">
            <span className="text-6xl mb-4">🤖</span>
            <p className="text-lg font-medium">输入你的学习目标，AI 帮你规划</p>
            <p className="text-sm mt-1">例如：我想用 3 天时间入门 Python 爬虫</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-br-none' 
                : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none'
            }`}>
              {/* 关键修改：用 ReactMarkdown 替换了 pre 标签 */}
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
            className="flex-1 p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none min-h-[52px] max-h-32"
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
  );
}

export default App;