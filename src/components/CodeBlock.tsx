import React, { useState, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  [key: string]: any;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ children, className, ...props }) => {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g. "language-python", "language-php")
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1].toLowerCase() : '';

  // Get raw string code
  const codeString = String(children || '').replace(/\n$/, '');

  // If this is an inline code (not a multi-line block and without explicit language), render inline pill
  const isInline = !match && !codeString.includes('\n');

  if (isInline) {
    return (
      <code className="bg-zinc-800/80 text-pink-300 font-medium px-1.5 py-0.5 rounded text-[13px] font-mono border border-zinc-700/40" {...props}>
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // Syntax highlight with Prism
  const highlightedCode = useMemo(() => {
    if (!language || !Prism.languages[language]) {
      // If language not found or default, fallback to plain text escape or javascript
      if (Prism.languages.javascript && (language === 'js' || language === 'jsx')) {
        return Prism.highlight(codeString, Prism.languages.javascript, 'javascript');
      }
      return null;
    }
    try {
      return Prism.highlight(codeString, Prism.languages[language], language);
    } catch {
      return null;
    }
  }, [codeString, language]);

  return (
    <div className="my-3.5 rounded-xl overflow-hidden border border-zinc-800/90 bg-[#121316] shadow-xl text-left">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-[#18191e] border-b border-zinc-800/80 select-none">
        <div className="flex items-center gap-2">
          {/* Subtle colored dots */}
          <div className="flex items-center gap-1.5 opacity-70">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <span className="text-[11.5px] font-mono font-semibold text-zinc-400 uppercase tracking-wider ml-1">
            {language || 'code'}
          </span>
        </div>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer active:scale-95"
          title="Salin kode"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-400" />
              <span className="text-emerald-400 text-[11px] font-sans">Tersalin</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span className="text-[11px] font-sans">Salin</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content with syntax highlighting */}
      <div className="p-3.5 md:p-4 overflow-x-auto text-[13px] md:text-[13.5px] leading-relaxed font-mono text-zinc-200 terminal-scroll">
        {highlightedCode ? (
          <pre className="!bg-transparent !p-0 !m-0 !border-none font-mono">
            <code
              className={`!bg-transparent !p-0 font-mono language-${language}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
        ) : (
          <pre className="!bg-transparent !p-0 !m-0 !border-none font-mono">
            <code className="!bg-transparent !p-0 font-mono" {...props}>
              {children}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};
