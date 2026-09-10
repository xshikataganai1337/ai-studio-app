import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

interface ThoughtAccordionProps {
  thought: string;
  isStreaming?: boolean;
}

export const ThoughtAccordion: React.FC<ThoughtAccordionProps> = ({ thought, isStreaming = false }) => {
  // Default to open while streaming thoughts, otherwise collapsed
  const [isOpen, setIsOpen] = useState(isStreaming);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    // When streaming starts: auto-open
    if (isStreaming && !prevStreamingRef.current) {
      setIsOpen(true);
    }
    // When AI finishes response (streaming becomes false): auto-close
    else if (!isStreaming && prevStreamingRef.current) {
      setIsOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (!thought) return null;

  return (
    <div className="my-1 overflow-hidden text-[13.5px]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 py-1.5 transition-opacity hover:opacity-85 cursor-pointer select-none text-left group"
      >
        <Brain size={14} className={`text-pink-400 ${isStreaming ? 'animate-pulse' : ''}`} />
        <span
          className="text-[13px] tracking-wide font-semibold bg-gradient-to-r from-pink-400 via-rose-300 to-fuchsia-400 bg-clip-text text-transparent animate-gradient-text"
        >
          {isStreaming ? 'Menganalisis...' : 'Proses Berpikir'}
        </span>
        <div className="ml-1 text-pink-400/80 group-hover:text-pink-300 transition-colors">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="py-2 pb-4 text-zinc-500 font-normal text-[13.5px] leading-relaxed border-l-[1.5px] border-zinc-800 ml-1.5 pl-4 mb-2">
              <div className="markdown-thought">
                <Markdown>{thought}</Markdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
