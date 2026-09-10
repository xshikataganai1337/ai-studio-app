import React, { useRef, useEffect } from 'react';
import { Trash2, X } from 'lucide-react';

export interface TerminalEvent {
  id: string;
  command: string;
  timestamp: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  status: 'running' | 'completed' | 'error';
}

interface TerminalSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  events: TerminalEvent[];
  onClear: () => void;
  isRunning: boolean;
}

export const TerminalSidebar: React.FC<TerminalSidebarProps> = ({
  isOpen,
  onClose,
  events,
  onClear,
  isRunning
}) => {
  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Auto-scroll when new output streams in
  useEffect(() => {
    if (!userScrolledRef.current && consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, isRunning]);

  const handleScroll = () => {
    if (!terminalBodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalBodyRef.current;
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 30;
  };

  if (!isOpen) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] lg:w-[440px] xl:w-[480px] bg-[#09090b] border-l border-zinc-900 flex flex-col shadow-2xl transition-all"
      aria-label="Terminal Monitor"
    >
      {/* Sleek Minimalist Terminal Header */}
      <header className="flex items-center justify-between px-3.5 py-2 bg-[#0c0d0f] border-b border-zinc-900 select-none shrink-0">
        <div className="flex items-center gap-2">
          {/* Colored & Animated Terminal Window Dots */}
          <div className="flex items-center gap-1.5 group">
            <button
              type="button"
              onClick={onClose}
              title="Tutup terminal"
              aria-label="Tutup terminal"
              className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] shadow-[0_0_6px_rgba(255,95,86,0.5)] transition-all duration-200 hover:scale-125 active:scale-90 focus:outline-none"
            />
            <span
              className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] shadow-[0_0_6px_rgba(255,189,46,0.5)] transition-all duration-200 hover:scale-125"
            />
            <span
              className={`w-2.5 h-2.5 rounded-full bg-[#27c93f] shadow-[0_0_6px_rgba(39,201,63,0.5)] transition-all duration-200 hover:scale-125 ${
                isRunning ? 'animate-pulse' : ''
              }`}
            />
          </div>
          <span className="font-mono text-[11px] text-zinc-400 font-medium tracking-wider uppercase ml-1.5">
            terminal
          </span>
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-1" />
          )}
        </div>

        {/* Minimal Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            disabled={events.length === 0 || isRunning}
            title="Bersihkan log"
            className="p-1.5 rounded-md text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 active:scale-95 disabled:opacity-20 disabled:pointer-events-none transition-all"
          >
            <Trash2 size={13} className="text-rose-400" />
          </button>
          <button
            onClick={onClose}
            title="Tutup"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Terminal Monospace Canvas (Read-Only AI Monitor) */}
      <div
        ref={terminalBodyRef}
        onScroll={handleScroll}
        className="flex-1 p-3.5 pb-6 overflow-y-auto font-mono text-[12px] leading-relaxed text-zinc-300 space-y-3.5 terminal-scroll select-text"
      >
        {events.length === 0 ? (
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-emerald-400 font-semibold select-none">❯</span>
            <span className="text-zinc-500 select-none">ai_workspace</span>
            <span className="inline-block w-1.5 h-3.5 bg-emerald-400 animate-pulse ml-0.5" />
          </div>
        ) : (
          events.map((ev) => (
            <div key={ev.id} className="space-y-1">
              {/* Command Prompt Line (Input) */}
              <div className="flex items-start gap-2 font-mono text-[12px] pt-1">
                <span className="text-emerald-400 font-bold select-none shrink-0 leading-5">❯</span>
                <span className="break-all font-mono font-medium text-zinc-100 leading-5">{ev.command}</span>
                {ev.status === 'running' && (
                  <span className="inline-block w-1.5 h-3.5 bg-emerald-400 animate-pulse shrink-0 ml-1 mt-0.5" />
                )}
              </div>

              {/* Standard Output (Output) */}
              {ev.stdout && (
                <pre className="text-zinc-300 whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed pl-4 py-0.5 select-text">
                  {ev.stdout}
                </pre>
              )}

              {/* Standard Error (Error Output) */}
              {ev.stderr && (
                <pre className="text-rose-400 whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed pl-4 py-0.5 select-text">
                  {ev.stderr}
                </pre>
              )}
            </div>
          ))
        )}

        <div ref={consoleBottomRef} />
      </div>
    </aside>
  );
};
