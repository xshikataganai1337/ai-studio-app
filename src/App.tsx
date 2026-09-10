/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, RotateCcw, ChevronDown, Menu, X, Plus, MessageSquare, Check, Copy, ExternalLink, Pencil, Square, PanelRightClose, PanelRightOpen, Folder, FolderOpen, FileCode, FileJson, File, ChevronRight, Inbox, Trash2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { ThoughtAccordion } from './components/ThoughtAccordion';
import { CodeBlock } from './components/CodeBlock';
import { GroundingSources, GroundingSource } from './components/GroundingSources';
import { formatMarkdown, extractSourcesFromText } from './utils/markdownUtils';

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  thought?: string;
  grounding?: {
    webSearchQueries?: string[];
    sources: GroundingSource[];
  };
};

const CopyResponseButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors cursor-pointer"
      title="Salin balasan"
    >
      {copied ? (
        <>
          <Check size={12} className="text-emerald-400" />
          <span className="text-emerald-400 text-[11px]">Tersalin</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span className="text-[11px]">Salin</span>
        </>
      )}
    </button>
  );
};

const AVAILABLE_MODELS = [
  { id: 'hybrid-deep-research-flash-lite', label: 'Hybrid (Deep Research + Flash Lite)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'antigravity-preview-05-2026', label: 'Antigravity 05-26' },
  { id: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Custom' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3.0 Flash Prev' }
];

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
};

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('ai_sessions');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    const saved = localStorage.getItem('ai_current_session');
    return saved || Date.now().toString();
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    const savedSessions = localStorage.getItem('ai_sessions');
    const savedCurrent = localStorage.getItem('ai_current_session');
    if (savedSessions && savedCurrent) {
      const parsed = JSON.parse(savedSessions) as ChatSession[];
      const current = parsed.find(s => s.id === savedCurrent);
      if (current) return current.messages;
    }
    return [];
  });
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.1-pro-preview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'src': true,
    'components': true
  });

  // Workspace Files Data
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<{name: string, content: string} | null>(null);
  const [fileCopied, setFileCopied] = useState(false);
  const [isClearingWorkspace, setIsClearingWorkspace] = useState(false);

  const handleCopyFile = () => {
    if (selectedFile) {
      navigator.clipboard.writeText(selectedFile.content);
      setFileCopied(true);
      setTimeout(() => setFileCopied(false), 2000);
    }
  };

  const fetchWorkspaceFiles = async () => {
    if (!currentSessionId) return;
    try {
      const res = await fetch(`/api/workspace-files?sessionId=${encodeURIComponent(currentSessionId)}`);
      if (res.ok) {
        const data = await res.json();
        setWorkspaceFiles(data);
      }
    } catch (e) {
      console.error('Failed to fetch workspace files:', e);
    }
  };

  const handleFileClick = async (file: any) => {
    if (file.type !== 'file' || !file.path || !currentSessionId) return;
    try {
      const res = await fetch(`/api/workspace-file-content?path=${encodeURIComponent(file.path)}&sessionId=${encodeURIComponent(currentSessionId)}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedFile({ name: file.name, content: data.content });
      }
    } catch (e) {
      console.error('Failed to load file content:', e);
    }
  };

  const handleClearWorkspace = async () => {
    if (!currentSessionId || isClearingWorkspace) return;
    setIsClearingWorkspace(true);
    try {
      const res = await fetch(`/api/workspace/${encodeURIComponent(currentSessionId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setWorkspaceFiles([]);
        setSelectedFile(null);
      }
    } catch (e) {
      console.error('Failed to clear workspace:', e);
    } finally {
      setIsClearingWorkspace(false);
    }
  };

  useEffect(() => {
    if (isRightSidebarOpen && currentSessionId) {
      fetchWorkspaceFiles();
      const interval = setInterval(fetchWorkspaceFiles, 2000);
      return () => clearInterval(interval);
    }
  }, [isRightSidebarOpen, currentSessionId]);

  const toggleFolder = (folderName: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  const getFileIcon = (iconType?: string) => {
    switch (iconType) {
      case 'react':
      case 'ts':
        return <FileCode size={14} className="text-blue-400" />;
      case 'json':
        return <FileJson size={14} className="text-yellow-400" />;
      case 'css':
        return <FileCode size={14} className="text-sky-400" />;
      case 'php':
        return <FileCode size={14} className="text-indigo-400" />;
      case 'html':
        return <FileCode size={14} className="text-orange-400" />;
      default:
        return <File size={14} className="text-zinc-400" />;
    }
  };
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    setSessions(prev => {
      let nextSessions = prev;
      const exists = prev.find(s => s.id === currentSessionId);
      
      if (exists) {
        nextSessions = prev.map(s => s.id === currentSessionId ? { ...s, messages } : s);
      } else if (messages.length > 0) {
        const firstUserMsg = messages.find(m => m.role === 'user')?.text || 'Percakapan Baru';
        const title = firstUserMsg.slice(0, 30) + (firstUserMsg.length > 30 ? '...' : '');
        nextSessions = [{ id: currentSessionId, title, messages, timestamp: Date.now() }, ...prev];
      }
      
      localStorage.setItem('ai_sessions', JSON.stringify(nextSessions));
      return nextSessions;
    });
    localStorage.setItem('ai_current_session', currentSessionId);
  }, [messages, currentSessionId]);

  const handleEditLastMessage = () => {
    if (isLoading) return;
    const lastUserIndex = messages.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) return;
    
    const textToEdit = messages[lastUserIndex].text;
    
    setMessages(messages.slice(0, lastUserIndex));
    setInput(textToEdit);
    
    setTimeout(() => {
       if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
       }
    }, 0);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth', force = false) => {
    if (!force && userScrolledUpRef.current) return;
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior,
      });
    }
  };

  // Handle scroll detection to not fight user when they scroll up
  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    // If user scrolled up more than 100px from bottom, stop auto-scrolling
    userScrolledUpRef.current = distanceFromBottom > 100;
  };

  useEffect(() => {
    if (isLoading) {
      // During streaming response, scroll to bottom if user hasn't scrolled up
      scrollToBottom('auto');
    } else {
      // When message completes or user sends, smooth scroll
      scrollToBottom('smooth');
    }
  }, [messages, isLoading]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = () => {
    if (isLoading) return;
    setMessages([]);
    const newId = Date.now().toString();
    setCurrentSessionId(newId);
    setWorkspaceFiles([]);
    setSelectedFile(null);
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  const handleDeleteSession = async (sessionIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      fetch(`/api/workspace/${encodeURIComponent(sessionIdToDelete)}`, { method: 'DELETE' }).catch(() => {});
    } catch (err) {
      console.error('Failed to delete workspace folder:', err);
    }

    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== sessionIdToDelete);
      localStorage.setItem('ai_sessions', JSON.stringify(updated));
      return updated;
    });

    if (currentSessionId === sessionIdToDelete) {
      const newId = Date.now().toString();
      setCurrentSessionId(newId);
      setMessages([]);
      setWorkspaceFiles([]);
      setSelectedFile(null);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    // Reset user scroll state so it always auto scrolls down smoothly
    userScrolledUpRef.current = false;
    
    abortControllerRef.current = new AbortController();

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    resetTextareaHeight();
    setIsLoading(true);

    // Smoothly scroll to the bottom when user message is sent
    setTimeout(() => {
      scrollToBottom('smooth', true);
    }, 40);

    const tempModelMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: tempModelMessageId, role: 'model', text: '', thought: '' },
    ]);

    const totalModels = AVAILABLE_MODELS.length;
    let currentModelId = selectedModel;
    let modelAttemptCount = 0;
    let cumulativeWarning = '';
    let globalSuccess = false;

    try {
      while (modelAttemptCount < totalModels) {
        let isSuccess = false;
        let attemptForCurrentModel = 0;

        while (attemptForCurrentModel < 2) {
          try {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              signal: abortControllerRef.current?.signal,
              body: JSON.stringify({
                message: userMessage.text,
                history: messages,
                modelId: currentModelId,
                sessionId: currentSessionId,
              }),
            });

            if (!response.ok) {
              throw new Error(`Network response was not ok (${response.status})`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error('No reader available');

            let currentText = cumulativeWarning;
            let currentThought = '';
            let currentGrounding: { webSearchQueries?: string[]; sources: GroundingSource[] } = { sources: [] };
            let buffer = '';
            let rafId: number | null = null;
            let streamHasError = false;

            const flushUpdate = () => {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tempModelMessageId
                    ? {
                        ...msg,
                        text: currentText,
                        thought: currentThought,
                        grounding: currentGrounding.sources.length > 0 ? { ...currentGrounding } : undefined
                      }
                    : msg
                )
              );
            };

            const scheduleUpdate = () => {
              if (rafId !== null) return;
              rafId = requestAnimationFrame(() => {
                rafId = null;
                flushUpdate();
              });
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split('\n\n');
              
              buffer = parts.pop() || '';

              for (const part of parts) {
                const lines = part.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '').trim();
                    if (dataStr === '[DONE]') {
                      break;
                    }
                    if (dataStr) {
                      try {
                        const parsed = JSON.parse(dataStr);
                        if (parsed.error) {
                          streamHasError = true;
                          break; // Do not render the error text directly
                        } else if (parsed.thought) {
                          currentThought += parsed.thought;
                          scheduleUpdate();
                        } else if (parsed.text) {
                          currentText += parsed.text;
                          scheduleUpdate();
                        } else if (parsed.groundingMetadata) {
                          const meta = parsed.groundingMetadata;
                          const chunks = meta.groundingChunks || [];
                          const newSources: GroundingSource[] = [];
                          for (const item of chunks) {
                            const uri = item.web?.uri;
                            const title = item.web?.title;
                            if (uri && !currentGrounding.sources.some(s => s.uri === uri) && !newSources.some(s => s.uri === uri)) {
                              newSources.push({ uri, title: title || '' });
                            }
                          }
                          if (newSources.length > 0 || (meta.webSearchQueries && meta.webSearchQueries.length > 0)) {
                            currentGrounding = {
                              webSearchQueries: meta.webSearchQueries || currentGrounding.webSearchQueries,
                              sources: [...currentGrounding.sources, ...newSources]
                            };
                            scheduleUpdate();
                          }
                        }
                      } catch (e) {
                        // Ignore incomplete JSON chunks parsing
                      }
                    }
                  }
                }
              }
            }

            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            flushUpdate();

            if (streamHasError) {
              throw new Error('Stream encountered a server error mid-generation.');
            }

            isSuccess = true;
            globalSuccess = true;
            break; // Success, break the retry loop
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.log('Generation aborted by user.');
              isSuccess = true;
              globalSuccess = true;
              break;
            }
            console.error(`Error with model ${currentModelId} (Attempt ${attemptForCurrentModel + 1}):`, error);
            attemptForCurrentModel++;
            if (attemptForCurrentModel < 2) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tempModelMessageId
                    ? { ...msg, text: cumulativeWarning + `> [Sistem] Koneksi terputus saat stream. Mencoba ulang model ${currentModelId} (Percobaan ${attemptForCurrentModel + 1}/2)...\n\n`, thought: '', grounding: undefined }
                    : msg
                )
              );
              await new Promise(resolve => setTimeout(resolve, 3000)); // 3s delay before retry
            }
          }
        } // End retry loop

        if (isSuccess) {
          break; // Break the fallback loop, successful response
        } else {
          modelAttemptCount++;
          if (modelAttemptCount < totalModels) {
            const currentIndex = AVAILABLE_MODELS.findIndex(m => m.id === currentModelId);
            const nextIndex = (currentIndex + 1) % totalModels;
            currentModelId = AVAILABLE_MODELS[nextIndex].id;
            setSelectedModel(currentModelId); // Update UI selection state
            cumulativeWarning += `> [Sistem] Terjadi gangguan pada model sebelumnya. Beralih ke model: **${currentModelId}**...\n\n`;
            
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempModelMessageId
                  ? { ...msg, text: cumulativeWarning }
                  : msg
              )
            );
            
            await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UI transition
          }
        }
      } // End fallback loop

      if (!globalSuccess) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempModelMessageId
              ? { ...msg, text: cumulativeWarning + '\n\n[Sistem] Semua model gagal merespons. Terjadi kesalahan pada server atau jaringan.' }
              : msg
          )
        );
      }
    } catch (error) {
      console.error('Fatal error in message loop:', error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempModelMessageId
            ? { ...msg, text: 'Terjadi kesalahan sistem internal.' }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 font-sans relative">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
              onClick={() => setIsSidebarOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 bottom-0 w-64 bg-zinc-900 border-r border-zinc-800 z-40 flex flex-col p-4 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-pink-400" />
                  <span className="text-sm font-semibold text-zinc-200">AI Workspace</span>
                </div>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <button
                onClick={handleNewChat}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 text-sm font-medium transition-colors border border-zinc-700/50 mb-6 w-full"
              >
                <Plus size={16} />
                <span>Percakapan Baru</span>
              </button>

              <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 px-2">Riwayat</div>
                {sessions.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {sessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => {
                          if (isLoading) return;
                          setCurrentSessionId(session.id);
                          setMessages(session.messages);
                          setSelectedFile(null);
                          if (window.innerWidth < 768) setIsSidebarOpen(false);
                        }}
                        className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors w-full text-left ${
                          currentSessionId === session.id
                            ? 'bg-zinc-800/80 text-zinc-200'
                            : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <MessageSquare size={14} className={currentSessionId === session.id ? 'text-zinc-400 shrink-0' : 'text-zinc-600 shrink-0'} />
                          <span className="truncate text-[13px]">{session.title}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700/60 hover:text-red-400 text-zinc-500 transition-all shrink-0 cursor-pointer"
                          title="Hapus percakapan & workspace"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-2 text-xs text-zinc-600">Belum ada percakapan.</div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Header Bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-900 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
          >
            <Menu size={20} />
          </button>
          
          {/* Custom Model Selector Moved to Left */}
          <div className="relative">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 rounded-full px-3.5 py-1.5 text-[13px] text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-pink-400 shrink-0" />
              <span className="font-medium tracking-wide">
                {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.label || selectedModel}
              </span>
              <ChevronDown size={14} className={`text-zinc-500 ml-0.5 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Custom Dropdown Menu */}
            <AnimatePresence>
              {isModelDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsModelDropdownOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-full mt-2 w-56 bg-zinc-900/95 backdrop-blur-md border border-zinc-800/80 rounded-xl shadow-2xl z-50 overflow-hidden py-1.5 max-h-[60vh] overflow-y-auto terminal-scroll"
                  >
                    {AVAILABLE_MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setIsModelDropdownOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-800/80 transition-colors group"
                      >
                        <div className="flex flex-col">
                          <span className={`text-[13.5px] ${selectedModel === model.id ? 'text-zinc-100 font-medium' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                            {model.label}
                          </span>
                          <span className="text-[10px] text-zinc-600 font-mono mt-0.5 opacity-60">
                            {model.id}
                          </span>
                        </div>
                        {selectedModel === model.id && (
                          <Check size={16} className="text-pink-400" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)}
            className={`p-2 rounded-lg transition-all duration-300 flex items-center gap-2 text-[13px] font-medium relative overflow-hidden group ${
              isRightSidebarOpen 
                ? 'text-white shadow-[0_0_15px_rgba(236,72,153,0.3)] border-transparent' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 border border-transparent'
            }`}
          >
            {/* Gradient Background for Active State */}
            {isRightSidebarOpen && (
              <motion.div 
                layoutId="workspace-active-bg"
                className="absolute inset-0 bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-blue-500/20 opacity-100"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            )}
            
            {/* Animated Border */}
            {isRightSidebarOpen && (
              <div className="absolute inset-0 border border-white/10 rounded-lg" />
            )}

            <div className="relative flex items-center gap-2 z-10">
              {isRightSidebarOpen ? (
                <PanelRightClose size={18} className="text-pink-400 drop-shadow-[0_0_8px_rgba(236,72,153,0.8)]" />
              ) : (
                <PanelRightOpen size={18} className="group-hover:text-pink-400/70 transition-colors" />
              )}
              <span className="hidden sm:inline">Workspace</span>
            </div>
            
            {/* Pulse Indicator when Active */}
            {isRightSidebarOpen && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse drop-shadow-[0_0_5px_rgba(236,72,153,1)]" />
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Area (Chat View + Terminal Sidebar) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <main
            ref={chatContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 md:px-6 w-full max-w-2xl mx-auto flex flex-col gap-5"
          >
            {messages.map((msg, index) => {
              const isLastMessage = index === messages.length - 1;
              const isCurrentlyStreaming = isLoading && isLastMessage;
              const lastUserMsgIndex = messages.map(m => m.role).lastIndexOf('user');
              const isLastUserMessage = index === lastUserMsgIndex;

              return (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                key={msg.id}
                className={`flex w-full ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'user' ? (
                  <div className="flex flex-col items-end gap-1.5 max-w-[85%]">
                    <div className="w-full bg-zinc-800/90 text-zinc-100 rounded-2xl rounded-tr-sm px-4 py-2.5 text-[14.5px] border border-zinc-700/40 shadow-sm leading-relaxed whitespace-pre-wrap select-text">
                      {msg.text}
                    </div>
                    {isLastUserMessage && !isLoading && (
                      <button 
                        onClick={handleEditLastMessage}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors mr-1 cursor-pointer"
                        title="Edit pesan"
                      >
                        <Pencil size={11} />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="w-full text-zinc-200 text-[14.5px] leading-relaxed select-text">
                    {/* Animated loading wave bars (only shown while waiting for initial response/thought) */}
                    {isCurrentlyStreaming && !msg.text && !msg.thought && (
                      <div className="flex items-center gap-1.5 h-4 py-1 mb-2 select-none" title="Menghasilkan respons...">
                        <motion.span
                          animate={{ scaleY: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut" }}
                          className="w-1 h-3.5 rounded-full bg-pink-400 origin-center"
                        />
                        <motion.span
                          animate={{ scaleY: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0.15 }}
                          className="w-1 h-3.5 rounded-full bg-pink-400 origin-center"
                        />
                        <motion.span
                          animate={{ scaleY: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0.3 }}
                          className="w-1 h-3.5 rounded-full bg-pink-400 origin-center"
                        />
                        <motion.span
                          animate={{ scaleY: [0.3, 1, 0.3], opacity: [0.4, 1, 0.4] }}
                          transition={{ repeat: Infinity, duration: 0.8, ease: "easeInOut", delay: 0.45 }}
                          className="w-1 h-3.5 rounded-full bg-pink-400 origin-center"
                        />
                      </div>
                    )}

                    {(() => {
                      const { cleanedText, extractedSources } = extractSourcesFromText(msg.text);
                      const combinedSources: GroundingSource[] = [
                        ...(msg.grounding?.sources || []),
                        ...extractedSources
                      ];
                      const uniqueSources = combinedSources.filter(
                        (s, idx, arr) => arr.findIndex((x) => x.uri === s.uri) === idx
                      );

                      return (
                        <div className="flex flex-col gap-2.5">
                          {/* Collapsible Thoughts Accordion */}
                          {msg.thought && (
                            <ThoughtAccordion
                              thought={msg.thought}
                              isStreaming={isCurrentlyStreaming}
                            />
                          )}

                          {/* Main Output / Markdown */}
                          <div className="markdown-body">
                            {msg.text ? (
                              <Markdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  code: CodeBlock,
                                  a: ({ href, children, ...props }) => (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-pink-400 hover:text-pink-300 font-medium underline underline-offset-4 decoration-pink-500/40 hover:decoration-pink-300 transition-colors"
                                      {...props}
                                    >
                                      {children}
                                      <ExternalLink size={11} className="inline opacity-70 shrink-0 ml-0.5" />
                                    </a>
                                  ),
                                  table: ({ children, ...props }) => (
                                    <div className="overflow-x-auto my-3.5 rounded-xl border border-zinc-800/90 bg-zinc-950/80 shadow-md table-scrollbar pb-1.5 transition-all">
                                      <table className="w-full min-w-[520px] text-left border-collapse text-[13.5px]" {...props}>
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                  thead: ({ children, ...props }) => (
                                    <thead className="bg-zinc-900 text-zinc-100 border-b border-zinc-800" {...props}>
                                      {children}
                                    </thead>
                                  ),
                                  th: ({ children, ...props }) => (
                                    <th className="px-4 py-3 font-semibold text-zinc-100 text-[13px] tracking-wide border-r border-zinc-800/40 last:border-r-0 whitespace-nowrap" {...props}>
                                      {children}
                                    </th>
                                  ),
                                  td: ({ children, ...props }) => (
                                    <td className="px-4 py-3 text-zinc-300 border-b border-zinc-800/40 border-r border-zinc-800/40 last:border-r-0 leading-relaxed align-top" {...props}>
                                      {children}
                                    </td>
                                  ),
                                  tr: ({ children, ...props }) => (
                                    <tr className="hover:bg-zinc-900/40 transition-colors odd:bg-transparent even:bg-zinc-900/20 last:border-b-0" {...props}>
                                      {children}
                                    </tr>
                                  )
                                }}
                              >
                                {formatMarkdown(cleanedText)}
                              </Markdown>
                            ) : null}
                          </div>

                          {/* Native Search Grounding Sources (for both Gemini and Antigravity) */}
                          {uniqueSources.length > 0 && (
                            <GroundingSources
                              webSearchQueries={msg.grounding?.webSearchQueries}
                              sources={uniqueSources}
                            />
                          )}

                          {/* Actions bar (Copy response) */}
                          {msg.text && !isLoading && (
                            <div className="flex items-center gap-2 pt-1 text-zinc-500 select-none">
                              <CopyResponseButton text={cleanedText} />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </motion.div>
              );
            })}
            <div ref={messagesEndRef} />
          </main>

          {/* Input Area */}
          <footer className="w-full max-w-2xl mx-auto px-4 pt-1 pb-4 md:pb-5">
            <div className="relative flex items-end gap-2 bg-zinc-900/90 rounded-xl border border-zinc-800/90 p-1.5 shadow-md focus-within:ring-1 focus-within:ring-zinc-700/50 focus-within:border-zinc-700/50 transition-all backdrop-blur-sm">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ketik pesan..."
                className="flex-1 max-h-[160px] min-h-[40px] bg-transparent resize-none outline-none text-zinc-100 placeholder-zinc-500 py-2 px-3 text-sm md:text-[15px] leading-relaxed overflow-y-auto no-scrollbar"
                rows={1}
                disabled={isLoading}
              />
              <button
                onClick={isLoading ? handleStopGeneration : sendMessage}
                disabled={(!input.trim() && !isLoading)}
                className={`p-2 flex items-center justify-center shrink-0 rounded-lg transition-all cursor-pointer mb-1 mr-1 active:scale-95 ${
                  isLoading 
                    ? 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700/50' 
                    : 'bg-zinc-100 text-zinc-950 hover:bg-pink-100 hover:text-pink-950 disabled:opacity-25 disabled:hover:bg-zinc-100 disabled:hover:text-zinc-950 border border-transparent'
                }`}
                style={{ width: '36px', height: '36px' }}
                title={isLoading ? "Berhenti" : "Kirim pesan"}
              >
                {isLoading ? (
                  <Square fill="currentColor" size={14} className="opacity-90" />
                ) : (
                  <Send size={16} className="ml-0.5" />
                )}
              </button>
            </div>
          </footer>
        </div>

        {/* Right Sidebar (Workspace / File Explorer) */}
        <AnimatePresence>
          {isRightSidebarOpen && (
            <>
              {/* Mobile Overlay */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
                onClick={() => setIsRightSidebarOpen(false)}
              />
              <motion.div
                initial={{ x: '100%', width: 0, opacity: 0 }}
                animate={{ x: 0, width: typeof window !== 'undefined' && window.innerWidth >= 768 ? 280 : 320, opacity: 1 }}
                exit={{ x: '100%', width: 0, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed md:relative right-0 top-0 bottom-0 z-50 md:z-40 bg-zinc-950 border-l border-zinc-800/80 flex flex-col shadow-2xl md:shadow-none overflow-hidden shrink-0"
              >
                <div className="p-3.5 px-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/40">
                  <span className="text-[12.5px] font-semibold text-zinc-200 uppercase tracking-wider">File Explorer</span>
                  <div className="flex items-center gap-1.5">
                    {workspaceFiles.length > 0 && (
                      <button
                        onClick={handleClearWorkspace}
                        disabled={isClearingWorkspace}
                        className="p-1.5 px-2 rounded-md text-[11px] font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-800/80 border border-transparent hover:border-zinc-800 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                        title="Bersihkan semua berkas di sesi ini"
                      >
                        <Trash2 size={13} />
                        <span className="hidden sm:inline">Bersihkan</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsRightSidebarOpen(false)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors md:hidden cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto terminal-scroll p-3 bg-zinc-950/30">
                  <div className="text-[11px] font-mono text-zinc-500 mb-3 px-1">PROJECT ROOT</div>
                  
                  {/* File Tree Rendering */}
                  <div className="flex flex-col gap-0.5">
                    {workspaceFiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <div className="w-12 h-12 rounded-full bg-zinc-900/80 flex items-center justify-center mb-3 border border-zinc-800/80">
                          <Inbox size={20} className="text-zinc-500" />
                        </div>
                        <p className="text-[13px] text-zinc-300 font-medium mb-1">Workspace Kosong</p>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          Tidak ada berkas. File atau struktur yang dibangun oleh AI dalam sesi ini akan muncul di sini.
                        </p>
                      </div>
                    ) : (
                      workspaceFiles.map((node, i) => {
                        const renderFileNode = (n: any, depth = 0): React.ReactNode => {
                          const isFolder = n.type === 'folder';
                          const isExpanded = isFolder && expandedFolders[n.name];
                          
                          return (
                            <div key={`${n.name}-${depth}`} className="flex flex-col w-full">
                              <button 
                                onClick={() => isFolder ? toggleFolder(n.name) : handleFileClick(n)}
                                className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-800/60 transition-colors text-left w-full ${isFolder ? 'cursor-pointer' : 'cursor-pointer'}`}
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                              >
                                {isFolder ? (
                                  <>
                                    <ChevronRight size={14} className={`text-zinc-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                    {isExpanded ? <FolderOpen size={14} className="text-pink-400/80" /> : <Folder size={14} className="text-zinc-400" />}
                                    <span className="text-[13px] text-zinc-300 font-medium truncate">{n.name}</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-[14px] shrink-0" /> {/* Spacer */}
                                    {getFileIcon(n.icon)}
                                    <span className="text-[13px] text-zinc-400 truncate group-hover:text-zinc-200 transition-colors">{n.name}</span>
                                  </>
                                )}
                              </button>
                              
                              {isFolder && isExpanded && n.children && (
                                <div className="flex flex-col w-full mt-0.5">
                                  {n.children.map((child: any) => renderFileNode(child, depth + 1))}
                                </div>
                              )}
                            </div>
                          );
                        };
                        
                        return renderFileNode(node);
                      })
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* File Viewer Modal */}
      <AnimatePresence>
        {selectedFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedFile(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-zinc-950 border border-zinc-800/80 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/60 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <FileCode size={16} className="text-zinc-400" />
                  <h3 className="text-sm font-medium text-zinc-200">{selectedFile.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyFile}
                    className="flex items-center gap-1.5 p-1.5 px-3 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-[12px] font-medium"
                  >
                    {fileCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    {fileCopied ? 'Tersalin' : 'Salin'}
                  </button>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 bg-zinc-950 terminal-scroll">
                <pre className="text-[13px] font-mono text-zinc-300 whitespace-pre-wrap break-all">
                  <code>{selectedFile.content}</code>
                </pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


