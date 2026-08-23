'use client';

import { useState, useRef, useEffect } from 'react';
import { postChatMessage } from '../lib/api-client.js';

export default function ChatPanel({ prUrl, token, review, onClose }) {
  const [messages, setMessages] = useState(() => {
    const total = (review?.reviews || []).length;
    const files = review?.meta?.stats?.filesChanged || 0;
    return [{
      id: 'sys-welcome',
      role: 'assistant',
      content: `Review complete — **${total}** finding(s) across **${files}** file(s). Type \`help\` for commands or \`list\` to see fixable items.`,
    }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading, elapsed]);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  const handleSend = async (text) => {
    const userMsg = text || input;
    if (!userMsg.trim() || loading) return;
    setInput('');

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const userEntry = { id: `u-${Date.now()}`, role: 'user', content: userMsg.trim() };
    setMessages((prev) => [...prev, userEntry]);
    setLoading(true);

    try {
      const content = await postChatMessage(prUrl, token, review, userMsg.trim(), history);
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: content || 'No response.' }]);
    } catch (err) {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: `❌ ${err.message || 'Failed to send message'}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-overlay">
      <div className="chat-panel">
        <div className="chat-header">
          <span className="chat-header-title">PrismLens Chat</span>
          <button className="chat-close" onClick={onClose} aria-label="Close chat">&times;</button>
        </div>
        <div className="chat-messages" ref={listRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
              <div className="chat-msg-avatar">{msg.role === 'user' ? 'U' : 'P'}</div>
              <div className="chat-msg-body">
                <div className="chat-msg-text">{renderContent(msg.content)}</div>
                {msg.actions?.length > 0 && (
                  <div className="chat-msg-actions">
                    {msg.actions.map((act, i) => (
                      act.action === 'open' ? (
                        <a key={i} className="chat-action-btn" href={act.url} target="_blank" rel="noreferrer">
                          {act.label}
                        </a>
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="chat-msg chat-msg-assistant">
              <div className="chat-msg-avatar">P</div>
              <div className="chat-msg-body">
                <div className="chat-typing"><span /><span /><span /></div>
                <div className="chat-elapsed">
                  {elapsed < 5 ? 'thinking…' : `still working… ${formatElapsed(elapsed)}`}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="chat-input-area">
          <input
            className="chat-input"
            placeholder="Type a command..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button className="chat-send-btn" onClick={() => handleSend()} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function renderContent(text) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('  - ')) {
      return <div key={i} className="chat-line-item">{line}</div>;
    }
    if (line.startsWith('- `')) {
      return <div key={i} className="chat-line-cmd">{line}</div>;
    }
    if (line === '') {
      return <div key={i} className="chat-line-spacer" />;
    }
    return <div key={i}>{renderInline(line)}</div>;
  });
}

function renderInline(text) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="chat-inline-code">{part.slice(1, -1)}</code>;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bp, j) => {
      if (bp.startsWith('**') && bp.endsWith('**')) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      return bp;
    });
  });
}
