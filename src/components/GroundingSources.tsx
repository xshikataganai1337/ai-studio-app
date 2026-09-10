import React, { useState, useRef, useEffect } from 'react';
import { Globe, ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface GroundingSource {
  uri: string;
  title: string;
  domain?: string;
}

export interface GroundingMetadataProps {
  webSearchQueries?: string[];
  sources: GroundingSource[];
}

export const GroundingSources: React.FC<GroundingMetadataProps> = ({ sources }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!sources || sources.length === 0) return null;

  // Deduplicate sources by URI and domain
  const uniqueSources: GroundingSource[] = [];
  const seenUris = new Set<string>();

  for (const item of sources) {
    if (!item.uri || seenUris.has(item.uri)) continue;
    seenUris.add(item.uri);

    let domain = item.domain;
    let title = (item.title || 'Sumber Web')
      .replace(/^\[?\d+(?:\.\d+)?\]?[\s.-]*/, '')
      .replace(/^\[\d+\]\s*/, '')
      .trim();

    if (!domain) {
      if (item.title && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?$/.test(item.title.trim())) {
        domain = item.title.trim();
        const namePart = domain.split('.')[0];
        title = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      } else {
        try {
          const parsed = new URL(item.uri);
          if (parsed.hostname.includes('google.com') && item.title) {
            domain = item.title.split(' ')[0].toLowerCase();
          } else {
            domain = parsed.hostname.replace(/^www\./, '');
          }
        } catch {
          domain = '';
        }
      }
    }

    uniqueSources.push({
      uri: item.uri,
      title: title || domain || 'Sumber',
      domain: domain || ''
    });
  }

  if (uniqueSources.length === 0) return null;

  // Take up to 3-4 top favicons for the stacked cluster
  const previewSources = uniqueSources.slice(0, 3);

  return (
    <div ref={containerRef} className="relative inline-block mt-2 select-none">
      {/* Cluster Pill matching the screenshot */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800/90 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-150 cursor-pointer shadow-sm group"
        title="Lihat semua sumber rujukan"
      >
        {/* Overlapping Favicon Avatar Stack */}
        <div className="flex items-center -space-x-1.5">
          {previewSources.map((source, idx) => {
            const faviconUrl = source.domain
              ? `https://www.google.com/s2/favicons?domain=${source.domain}&sz=64`
              : null;

            return (
              <div
                key={`stack-${source.uri}-${idx}`}
                className="w-5 h-5 rounded-full ring-2 ring-zinc-950 bg-zinc-900 flex items-center justify-center overflow-hidden shrink-0 shadow-sm"
                style={{ zIndex: 10 - idx }}
              >
                {faviconUrl ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="w-3.5 h-3.5 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                      const parent = (e.target as HTMLElement).parentElement;
                      if (parent) {
                        parent.innerHTML = '<span class="text-[10px] text-zinc-400">🌐</span>';
                      }
                    }}
                  />
                ) : (
                  <Globe size={11} className="text-zinc-400" />
                )}
              </div>
            );
          })}
        </div>

        {/* Text 'Sumber' */}
        <span className="text-[13px] font-medium text-zinc-300 group-hover:text-zinc-100 tracking-wide transition-colors">
          Sumber
        </span>
      </button>

      {/* Popover List of Sources when clicked */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute left-0 bottom-full mb-2 w-72 sm:w-80 max-h-72 overflow-y-auto rounded-xl bg-zinc-900/95 backdrop-blur-md border border-zinc-800 shadow-2xl p-2 z-50 table-scrollbar"
          >
            <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-zinc-800/60">
              <span className="text-[12px] font-semibold text-zinc-300">
                Daftar Sumber ({uniqueSources.length})
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              {uniqueSources.map((source, index) => {
                const faviconUrl = source.domain
                  ? `https://www.google.com/s2/favicons?domain=${source.domain}&sz=64`
                  : null;

                return (
                  <a
                    key={`popover-${source.uri}-${index}`}
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800/80 transition-colors group cursor-pointer"
                  >
                    <div className="w-5 h-5 rounded-full ring-1 ring-zinc-700 bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden">
                      {faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt=""
                          className="w-3.5 h-3.5 object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Globe size={11} className="text-zinc-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] text-zinc-200 group-hover:text-pink-300 font-medium truncate transition-colors">
                        {source.title}
                      </p>
                      {source.domain && (
                        <p className="text-[11px] text-zinc-500 truncate font-mono">
                          {source.domain}
                        </p>
                      )}
                    </div>
                    <ExternalLink size={12} className="text-zinc-600 group-hover:text-pink-400 shrink-0 transition-colors" />
                  </a>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
