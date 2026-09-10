import express from 'express';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { GoogleAuth } from 'google-auth-library';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Set up Google Auth Library to dynamically fetch Sandbox credentials
const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/generative-language'
  ]
});

// Preserve raw Gemini content parts (including thought signatures/tool context)
// across consecutive chat turns while this runtime is alive. The frontend history
// remains the source of truth: if its length no longer matches the expected next
// turn (for example after switching model/chat), the cached reasoning context is
// discarded and rebuilt from visible history.
type ReasoningContextState = {
  contents: any[];
  expectedNextHistoryLength: number;
  updatedAt: number;
};

const reasoningContextBySession = new Map<string, ReasoningContextState>();
const MAX_REASONING_CONTEXTS = 64;

const getReasoningContextKey = (sessionId: string, model: string) => `${sessionId}::${model}`;

const saveReasoningContext = (
  key: string,
  contents: any[],
  expectedNextHistoryLength: number
) => {
  reasoningContextBySession.set(key, {
    contents,
    expectedNextHistoryLength,
    updatedAt: Date.now()
  });

  if (reasoningContextBySession.size > MAX_REASONING_CONTEXTS) {
    const oldest = [...reasoningContextBySession.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) reasoningContextBySession.delete(oldest[0]);
  }
};

const clearReasoningContextsForSession = (sessionId: string) => {
  const prefix = `${sessionId}::`;
  for (const key of reasoningContextBySession.keys()) {
    if (key.startsWith(prefix)) reasoningContextBySession.delete(key);
  }
};

// Clear out the AI Studio injected API key so the SDK doesn't send both API Key and Bearer Token
delete process.env.GEMINI_API_KEY;

// Workspace isolation helper
const getWorkspaceDir = (sessionId: string) => {
  if (!sessionId) throw new Error("Session ID is required for workspace");
  // Simple sanitize to prevent directory traversal in sessionId
  const cleanId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.resolve(process.cwd(), 'workspaces', cleanId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// Tool Declarations for Gemini
const terminalToolDeclaration: FunctionDeclaration = {
  name: 'execute_terminal',
  description: 'Menjalankan perintah bash Linux nyata di dalam direktori kerja terisolasi ~/ai_workspace. Gunakan alat ini untuk memeriksa berkas, membuat file proyek, menjalankan script, build, menginstal dependensi lokal, atau memeriksa output CLI.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: 'Perintah bash yang akan dieksekusi di ~/ai_workspace.'
      }
    },
    required: ['command']
  }
};

const fetchUrlToolDeclaration: FunctionDeclaration = {
  name: 'fetch_url',
  description: 'Mengunjungi URL web secara langsung dan mengambil teks konten dari halaman web target untuk dianalisis, dirangkum, atau diekstrak informasinya.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: {
        type: Type.STRING,
        description: 'Alamat URL lengkap (harus diawali http:// atau https://) yang akan dikunjungi secara langsung.'
      }
    },
    required: ['url']
  }
};

// Real-time terminal execution in isolated workspace
function runTerminalCommand(
  command: string,
  res: express.Response | undefined,
  sessionId: string
): Promise<{ command: string; exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const id = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const workspaceDir = getWorkspaceDir(sessionId);

    if (res && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        terminal: {
          id,
          type: 'start',
          command,
          timestamp: Date.now()
        }
      })}\n\n`);
    }

    // Safety checks: protect root and parent application files from destruction
    const trimmed = command.trim();
    const isDangerous =
      trimmed.includes('rm -rf /') ||
      trimmed.includes('rm -rf /*') ||
      trimmed.includes('rm -rf ~') ||
      trimmed.includes('rm -rf ..') ||
      trimmed.includes(':(){ :|:& };:');

    if (isDangerous) {
      const errorMsg = 'Akses ditolak: Operasi dibatasi khusus di dalam lingkungan terisolasi workspace sesi.';
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'stderr',
            text: errorMsg + '\n'
          }
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'end',
            exitCode: 1
          }
        })}\n\n`);
      }
      return resolve({ command, exitCode: 1, stdout: '', stderr: errorMsg });
    }

    let stdout = '';
    let stderr = '';

    const child = spawn('bash', ['-c', command], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        PWD: workspaceDir,
        HOME: workspaceDir,
      }
    });

    const timeoutTimer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (e) {}
    }, 60000); // 60 seconds max execution time

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'stdout',
            text
          }
        })}\n\n`);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'stderr',
            text
          }
        })}\n\n`);
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      const exitCode = code ?? 0;
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'end',
            exitCode
          }
        })}\n\n`);
      }
      resolve({
        command,
        exitCode,
        stdout: stdout.slice(-20000),
        stderr: stderr.slice(-20000)
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      const errMsg = err.message || 'Gagal mengeksekusi perintah terminal';
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'stderr',
            text: errMsg + '\n'
          }
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          terminal: {
            id,
            type: 'end',
            exitCode: 1
          }
        })}\n\n`);
      }
      resolve({
        command,
        exitCode: 1,
        stdout,
        stderr: errMsg
      });
    });
  });
}

// Direct URL fetcher tool
async function runFetchUrl(
  urlStr: string,
  res?: express.Response
): Promise<{ url: string; status: number; content: string }> {
  const id = `fetch_${Date.now()}`;
  if (res && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({
      tool_activity: {
        id,
        type: 'fetch_url',
        url: urlStr,
        status: 'fetching'
      }
    })}\n\n`);
  }

  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Protokol URL tidak didukung. Harus http:// atau https://');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7'
      }
    });
    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    let cleanContent = rawText;
    if (contentType.includes('html')) {
      cleanContent = rawText
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    if (res && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        tool_activity: {
          id,
          type: 'fetch_url',
          url: urlStr,
          status: 'completed',
          statusCode: response.status
        }
      })}\n\n`);
    }

    return {
      url: urlStr,
      status: response.status,
      content: cleanContent.slice(0, 15000)
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Gagal mengunjungi URL';
    if (res && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({
        tool_activity: {
          id,
          type: 'fetch_url',
          url: urlStr,
          status: 'error',
          error: errorMsg
        }
      })}\n\n`);
    }
    return {
      url: urlStr,
      status: 500,
      content: `Error saat mengunjungi URL: ${errorMsg}`
    };
  }
}

// Manual Terminal Execution Endpoint
app.post('/api/terminal/exec', async (req, res) => {
  try {
    const { command, sessionId } = req.body;
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'Perintah command diperlukan' });
      return;
    }
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID diperlukan' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await runTerminalCommand(command, res, sessionId);

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Terminal Exec Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

// Endpoint to fetch real-time workspace files
app.get('/api/workspace-files', async (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    const workspaceDir = getWorkspaceDir(sessionId);

    async function readDirTree(dir: string, relativePath = ''): Promise<any[]> {
      const items = await fsPromises.readdir(dir, { withFileTypes: true });
      const tree: any[] = [];
      
      for (const item of items) {
        if (item.name.startsWith('.')) continue; // skip hidden files
        
        const itemPath = path.join(dir, item.name);
        const itemRelPath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          const children = await readDirTree(itemPath, itemRelPath);
          tree.push({
            name: item.name,
            path: itemRelPath,
            type: 'folder',
            children
          });
        } else {
          const ext = path.extname(item.name).substring(1);
          let icon = 'file';
          if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) icon = 'ts';
          else if (['css', 'scss'].includes(ext)) icon = 'css';
          else if (['json'].includes(ext)) icon = 'json';
          else if (['html'].includes(ext)) icon = 'html';
          else if (['php'].includes(ext)) icon = 'php';
          
          tree.push({
            name: item.name,
            path: itemRelPath,
            type: 'file',
            icon
          });
        }
      }
      
      return tree.sort((a, b) => {
        if (a.type === 'folder' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
    }

    const tree = await readDirTree(workspaceDir);
    res.json(tree);
  } catch (error: any) {
    console.error('Failed to read workspace files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to fetch file content
app.get('/api/workspace-file-content', async (req, res) => {
  try {
    const filePath = req.query.path as string;
    const sessionId = req.query.sessionId as string;
    if (!filePath || !sessionId) {
      return res.status(400).json({ error: 'Path and Session ID are required' });
    }
    
    const workspaceDir = getWorkspaceDir(sessionId);
    // Security check to prevent directory traversal
    const absolutePath = path.join(workspaceDir, filePath);
    if (!absolutePath.startsWith(workspaceDir)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const content = await fsPromises.readFile(absolutePath, 'utf-8');
    res.json({ content });
  } catch (error: any) {
    console.error('Failed to read file content:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to clear/delete workspace
app.delete('/api/workspace/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    const workspaceDir = getWorkspaceDir(sessionId);
    if (fs.existsSync(workspaceDir)) {
      await fsPromises.rm(workspaceDir, { recursive: true, force: true });
      // Recreate empty
      fs.mkdirSync(workspaceDir, { recursive: true });
    }
    clearReasoningContextsForSession(sessionId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete workspace:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retry utility specifically for streams and 503 errors
const executeStreamWithRetry = async (fn: () => Promise<any>, maxRetries = 4, baseDelayMs = 1500) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const stream = await fn();
      const iterator = stream[Symbol.asyncIterator]();
      const firstResult = await iterator.next();
      
      async function* wrappedStream() {
        if (!firstResult.done) {
          yield firstResult.value;
        }
        yield* iterator;
      }
      return wrappedStream();
    } catch (error: any) {
      const is503 = error?.status === 503 || error?.response?.status === 503 || error?.message?.includes('503') || error?.message?.includes('UNAVAILABLE');
      
      if (is503) {
        attempt++;
        if (attempt >= maxRetries) {
          console.error(`Failed after ${maxRetries} attempts due to 503 Service Unavailable.`);
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`Received 503 error. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
};

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history, modelId, sessionId } = req.body;
    const safeHistory = Array.isArray(history) ? history : [];
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // We trust the modelId passed from the frontend for fallback logic.
    const selectedModel = modelId || 'gemini-3.1-pro-preview';

    // Fetch dynamic OAuth token from the sandbox runtime.
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    if (!token.token) {
      throw new Error('Failed to retrieve OAuth token from runtime.');
    }

    // Initialize SDK completely without API Key.
    const ai = new GoogleGenAI({
      httpOptions: {
        headers: {
          Authorization: `Bearer ${token.token}`
        }
      }
    });
    
    const isAgent = selectedModel.startsWith('antigravity');

    // Gemini 3+ uses thinkingLevel rather than a fixed token budget.
    // "high" gives the model room to reason deeply and use tools on hard tasks,
    // while the system instruction below keeps trivial chat proportional.
    const highThinkingConfig = {
      thinkingLevel: 'high',
      includeThoughts: true
    } as any;

    type TurnPolicy = {
      requireSearch: boolean;
      requireWorkspace: boolean;
      reason: string;
    };

    const normalizedMessage = String(message || '').trim();

    // Mandatory grounding by default for substantive requests. Only clearly
    // non-research tasks are exempt, or when the user explicitly opts out.
    const isClearlySimpleChat = /^(halo|hai|hi|hello|hey|test|tes|cek|oke|ok|okay|ya|iya|yup|sip|makasih|terima kasih|thanks|thank you|apa kabar|selamat (pagi|siang|sore|malam))[.!?\s]*$/i.test(normalizedMessage);
    const isSimpleArithmetic = /^[\d\s+\-*/%^().,=]+$/.test(normalizedMessage) && /\d/.test(normalizedMessage);
    const isPureTransformation = /\b(terjemahkan|translate|parafrase|paraphrase|rewrite|tulis ulang|ringkas teks|summarize this|perbaiki kalimat|rapikan tulisan)\b/i.test(normalizedMessage);
    const isPureCreative = /\b(buatkan|bikin|tulis|ciptakan|create|write)\b.{0,80}\b(puisi|pantun|cerita pendek|short story|slogan|caption|tagline|nama karakter|dialog fiksi)\b/i.test(normalizedMessage);
    const explicitSearchOptOut = /\b(tanpa|jangan|tidak usah|ga usah|gak usah|do not|don't)\b.{0,40}\b(search|pencarian|internet|web|google|browse|browsing)\b/i.test(normalizedMessage);

    // Workspace enforcement is reserved for explicit implementation/edit actions,
    // not explanatory questions such as "bagaimana cara membuat ...".
    const implementationAction = /(?:^|\b)(buatkan|bikinkan|implementasikan|bangunkan|perbaiki|fix|debug|refactor|edit|ubah|update|tambahkan|hapus|delete|rename|install|pasang|setup|konfigurasikan|configure|deploy|lanjutkan|selesaikan)(?:\b|$)|^(buat|bikin|create|build|implement|add)\b/i.test(normalizedMessage);
    const implementationArtifact = /\b(kode|code|source|file|berkas|folder|direktori|project|projek|aplikasi|app|website|web|server|client|api|endpoint|script|skrip|program|php|typescript|javascript|node(?:\.js)?|react|next(?:\.js)?|python|html|css|database|schema|component|komponen|workspace|package|dependency|fitur|feature|config|konfigurasi)\b/i.test(normalizedMessage);
    const requireWorkspace = implementationAction && implementationArtifact;

    const requireSearch = !explicitSearchOptOut &&
      !isClearlySimpleChat &&
      !isSimpleArithmetic &&
      !isPureTransformation &&
      !isPureCreative;

    const turnPolicy: TurnPolicy = {
      requireSearch,
      requireWorkspace,
      reason: requireWorkspace
        ? 'tugas implementasi/engineering'
        : requireSearch
          ? 'permintaan substantif yang harus diverifikasi dengan sumber eksternal'
          : 'permintaan sederhana/non-riset'
    };

    const snapshotWorkspaceState = () => {
      const root = getWorkspaceDir(sessionId);
      const state = new Map<string, string>();
      const skippedDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.cache']);
      let seen = 0;
      const MAX_FILES = 800;

      const walk = (dir: string) => {
        if (seen >= MAX_FILES) return;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (seen >= MAX_FILES) break;
          if (entry.isDirectory() && skippedDirs.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(full);
              const rel = path.relative(root, full).replace(/\\/g, '/');
              state.set(rel, `${stat.size}:${Math.floor(stat.mtimeMs)}`);
              seen++;
            } catch {}
          }
        }
      };

      walk(root);
      return state;
    };

    const diffWorkspaceStates = (before: Map<string, string>, after: Map<string, string>) => {
      const changed = new Set<string>();
      for (const [file, fingerprint] of after.entries()) {
        if (before.get(file) !== fingerprint) changed.add(file);
      }
      for (const file of before.keys()) {
        if (!after.has(file)) changed.add(file);
      }
      return [...changed];
    };

    const looksLikeVerificationCommand = (command: string) => {
      const cmd = command.trim().toLowerCase();
      if (!cmd) return false;

      const strongChecks = [
        /\bphp\s+-l\b/,
        /\bnode\s+--check\b/,
        /\b(?:npx\s+)?tsc\b/,
        /\bnpm\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b/,
        /\bpnpm\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b/,
        /\byarn\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b/,
        /\bpytest\b/,
        /\bpython(?:3)?\s+-m\s+(?:pytest|unittest|compileall|py_compile)\b/,
        /\bgo\s+test\b/,
        /\bcargo\s+(?:test|check|build)\b/,
        /\bcomposer\s+(?:validate|test)\b/,
        /\bruby\s+-c\b/,
        /\bbash\s+-n\b/,
        /\bshellcheck\b/
      ];
      if (strongChecks.some((re) => re.test(cmd))) return true;

      const mutating = /(?:^|\s)(?:rm|mv|cp|mkdir|touch|install)\s|\bsed\s+-i\b|\btee\b|(?:^|[^>])>{1,2}(?!>)/.test(cmd);
      if (mutating) return false;

      return /(?:^|[;&|]\s*)(?:ls\b|find\b|stat\b|test\s+-[efd]\b|tree\b|wc\b|git\s+(?:diff|status)\b|head\b|tail\b|grep\b)/.test(cmd);
    };

    const agentInstruction =
      "Anda adalah asisten AI agentic evidence-first yang bekerja secara natural, akurat, dan proaktif di workspace yang telah disediakan.\n\n" +
      "ATURAN KERJA:\n" +
      "1. Sapaan, tes, obrolan ringan, aritmetika sederhana, transformasi teks murni, dan penulisan kreatif murni boleh dijawab langsung tanpa pencarian.\n" +
      "2. Untuk SEMUA permintaan substantif lain—terutama pertanyaan faktual, teknis, coding, debugging, arsitektur, API/library/framework, rekomendasi, perencanaan, informasi terkini, niche, atau problem solving—Google Search Grounding WAJIB dilakukan sebelum solusi atau kesimpulan final. Pengetahuan internal hanya boleh dipakai sebagai hipotesis awal, bukan sebagai bukti final.\n" +
      "3. Jika Search Grounding wajib, lakukan pencarian SEBELUM melakukan implementasi yang mengubah workspace. Cari sumber primer/resmi bila tersedia, gunakan lebih dari satu query ketika satu pencarian belum cukup, lalu sintesis temuan dengan reasoning Anda sendiri.\n" +
      "4. Pertimbangkan alternatif yang benar-benar layak. Bandingkan kompatibilitas, kelebihan, kekurangan, batasan, dan risiko sebelum memilih pendekatan.\n" +
      "5. Untuk tugas implementasi, jawaban berupa contoh kode di chat SAJA tidak dianggap selesai. Anda WAJIB menggunakan execute_terminal untuk memeriksa workspace, membuat/mengedit file nyata, lalu memverifikasi hasilnya.\n" +
      "6. Setelah membuat atau mengubah file, WAJIB lakukan verifikasi nyata melalui execute_terminal: minimal periksa file yang berubah dan, jika tersedia, jalankan syntax check/build/test/lint/typecheck yang relevan. Jangan mengklaim berhasil tanpa exit/result tool yang mendukung klaim tersebut.\n" +
      "7. Gunakan fetch_url ketika halaman/dokumentasi tertentu perlu dibaca langsung setelah ditemukan atau diberikan pengguna.\n" +
      "8. Jangan mengarang hasil search, terminal, file, test, atau URL. Bedakan fakta terverifikasi, inferensi, dan hal yang masih belum pasti.\n" +
      "9. Jika implementasi/test gagal, perlakukan error sebagai bukti baru: analisis penyebab, lakukan Search Grounding tambahan jika error membutuhkan referensi eksternal, perbaiki, lalu uji ulang.\n" +
      "10. Jangan memberikan jawaban final prematur. Untuk turn yang memiliki kewajiban Search atau Workspace, tuntaskan kewajiban tersebut lebih dahulu.\n" +
      "11. Patuhi batasan dan kebijakan platform yang berlaku tanpa menambahkan klasifikasi atau pembatasan buatan yang tidak diperlukan.\n\n" +
      "TOOL YANG TERSEDIA:\n" +
      "- googleSearch: mencari informasi terkini dan sumber pendukung.\n" +
      "- execute_terminal: menjalankan perintah bash Linux di workspace terisolasi.\n" +
      "- fetch_url: membuka URL dan membaca isi halaman.\n\n" +
      "Gunakan Bahasa Indonesia yang lugas dan natural kecuali pengguna meminta bahasa lain.";

    const agentTools = [
      { googleSearch: {} },
      { functionDeclarations: [terminalToolDeclaration, fetchUrlToolDeclaration] }
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    /**
     * Runs Gemini as an iterative engineer/researcher loop.
     * Built-in Google Search is executed server-side by Gemini. Custom tools are
     * executed here and their results are fed back together with the model parts,
     * preserving thought signatures/context during the loop.
     */
    const runGeminiToolLoop = async (
      model: string,
      initialContents: any[],
      maxToolTurns = 15,
      policy: TurnPolicy = turnPolicy
    ) => {
      const contents: any[] = [...initialContents];
      let turn = 0;
      let searchObserved = false;
      let terminalUsed = false;
      let finalTextEmitted = false;
      let verificationSnapshot: Map<string, string> | null = null;
      const baselineWorkspace = policy.requireWorkspace ? snapshotWorkspaceState() : null;

      const policyInstruction =
        `${agentInstruction}\n\n` +
        `[KEWAJIBAN TURN INI]\n` +
        `- Google Search Grounding: ${policy.requireSearch ? 'WAJIB sebelum solusi final' : 'tidak wajib untuk turn ini'}\n` +
        `- Eksekusi workspace: ${policy.requireWorkspace ? 'WAJIB; file nyata harus dibuat/diubah dan diverifikasi' : 'tidak wajib kecuali memang membantu'}\n` +
        `- Alasan klasifikasi: ${policy.reason}\n` +
        `Jika sebuah kewajiban bertanda WAJIB belum terpenuhi, jangan berikan jawaban final.`;

      const pushGateMessage = (text: string) => {
        contents.push({
          role: 'user',
          parts: [{ text: `[WORKFLOW GATE - INTERNAL]\n${text}` }]
        });
      };

      while (turn < maxToolTurns) {
        turn++;

        const stream = await executeStreamWithRetry(async () => {
          return await ai.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: policyInstruction,
              tools: agentTools,
              toolConfig: { includeServerSideToolInvocations: true },
              thinkingConfig: highThinkingConfig
            }
          });
        });

        const functionCalls: any[] = [];
        const candidateContentParts: any[] = [];
        let pendingText = '';

        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          const groundingMeta = candidate?.groundingMetadata || (chunk as any).groundingMetadata;

          if (groundingMeta) {
            searchObserved = true;
            res.write(`data: ${JSON.stringify({ groundingMetadata: groundingMeta })}\n\n`);
          }

          const parts = candidate?.content?.parts || [];
          for (const part of parts) {
            candidateContentParts.push(part);

            // SDK versions can expose built-in search invocation details in raw
            // structural fields as well as groundingMetadata.
            try {
              const structuralPart = { ...part } as any;
              delete structuralPart.text;
              const serialized = JSON.stringify(structuralPart);
              if (/google[_-]?search|groundingmetadata|websearchqueries/i.test(serialized)) {
                searchObserved = true;
              }
            } catch {}

            if (part.thought && part.text) {
              res.write(`data: ${JSON.stringify({ thought: part.text })}\n\n`);
            } else if (part.text) {
              // Buffer normal answer text until mandatory gates are satisfied.
              pendingText += part.text;
            }

            if (part.functionCall) {
              functionCalls.push(part.functionCall);
            }
          }
        }

        if (candidateContentParts.length > 0) {
          contents.push({
            role: 'model',
            parts: candidateContentParts
          });
        }

        if (functionCalls.length > 0) {
          const toolResponseParts: any[] = [];

          for (const fc of functionCalls) {
            if (fc.name === 'execute_terminal') {
              const command = fc.args?.command || '';

              // Search must actually happen before workspace execution on turns
              // where grounding is mandatory.
              if (policy.requireSearch && !searchObserved) {
                const gateResult = {
                  command,
                  exitCode: 1,
                  stdout: '',
                  stderr: 'WORKFLOW_GATE: Google Search Grounding wajib dilakukan sebelum execute_terminal pada tugas ini. Lakukan pencarian terlebih dahulu, sintesis hasilnya, lalu ulangi eksekusi workspace.'
                };
                res.write(`data: ${JSON.stringify({ thought: '🔎 Search Grounding belum dilakukan. Eksekusi workspace ditahan sampai pencarian selesai.\n' })}\n\n`);
                toolResponseParts.push({
                  functionResponse: {
                    name: fc.name,
                    response: gateResult
                  }
                });
                continue;
              }

              terminalUsed = true;
              const execResult = await runTerminalCommand(command, res, sessionId);
              toolResponseParts.push({
                functionResponse: {
                  name: fc.name,
                  response: execResult
                }
              });

              if (looksLikeVerificationCommand(command) && execResult.exitCode === 0) {
                verificationSnapshot = snapshotWorkspaceState();
              }
            } else if (fc.name === 'fetch_url') {
              const url = fc.args?.url || '';
              const fetchResult = await runFetchUrl(url, res);
              toolResponseParts.push({
                functionResponse: {
                  name: fc.name,
                  response: fetchResult
                }
              });
            }
          }

          if (toolResponseParts.length > 0) {
            contents.push({
              role: 'user',
              parts: toolResponseParts
            });
            continue;
          }
        }

        // No client-side tool call was requested. Enforce mandatory stages before
        // accepting the buffered answer as final.
        if (policy.requireSearch && !searchObserved) {
          res.write(`data: ${JSON.stringify({ thought: '🔎 Jawaban ditahan: tugas ini wajib menggunakan Google Search Grounding terlebih dahulu.\n' })}\n\n`);
          pushGateMessage(
            'Anda belum melakukan Google Search Grounding pada turn ini. Jangan menjawab dari ingatan. Gunakan googleSearch sekarang, prioritaskan sumber resmi/primer, sintesis temuan, lalu lanjutkan pekerjaan.'
          );
          continue;
        }

        if (policy.requireWorkspace && baselineWorkspace) {
          const currentWorkspace = snapshotWorkspaceState();
          const changedFiles = diffWorkspaceStates(baselineWorkspace, currentWorkspace);

          if (!terminalUsed || changedFiles.length === 0) {
            res.write(`data: ${JSON.stringify({ thought: '🛠️ Jawaban ditahan: belum ada perubahan file nyata di workspace.\n' })}\n\n`);
            pushGateMessage(
              'Ini adalah tugas implementasi. Jawaban kode di chat saja tidak cukup. Gunakan execute_terminal untuk memeriksa workspace dan benar-benar membuat atau mengubah file yang diminta. Setelah itu lakukan verifikasi.'
            );
            continue;
          }

          const workspaceChangedAfterVerification = verificationSnapshot
            ? diffWorkspaceStates(verificationSnapshot, currentWorkspace).length > 0
            : true;

          if (!verificationSnapshot || workspaceChangedAfterVerification) {
            res.write(`data: ${JSON.stringify({ thought: '🧪 Jawaban ditahan: perubahan workspace belum diverifikasi setelah perubahan terakhir.\n' })}\n\n`);
            pushGateMessage(
              `Workspace sudah berubah (${changedFiles.slice(0, 20).join(', ')}${changedFiles.length > 20 ? ', ...' : ''}), tetapi verifikasi setelah perubahan terakhir belum terbukti. Gunakan execute_terminal untuk memeriksa file yang dibuat/diubah dan jalankan syntax check/build/test/lint/typecheck yang relevan. Jika tidak ada tool test khusus, minimal lakukan inspeksi read-only terhadap file hasil. Jika verifikasi gagal, perbaiki lalu uji ulang.`
            );
            continue;
          }
        }

        if (pendingText) {
          res.write(`data: ${JSON.stringify({ text: pendingText })}\n\n`);
          finalTextEmitted = true;
        }
        break;
      }

      if (turn >= maxToolTurns) {
        res.write(`data: ${JSON.stringify({ thought: `\n⚠️ Batas ${maxToolTurns} iterasi agent tercapai.\n` })}\n\n`);
      }

      if (!finalTextEmitted && turn >= maxToolTurns) {
        res.write(`data: ${JSON.stringify({ text: 'Agent mencapai batas iterasi sebelum seluruh kewajiban Search/Workspace/Verifikasi selesai. Tidak ada klaim keberhasilan yang dibuat.' })}\n\n`);
      }

      return contents;
    };

    if (selectedModel === 'hybrid-deep-research-flash-lite') {
      const historyText = safeHistory
        .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
        .join('\n\n');
      
      // --- Step 1: Deep Research ---
      res.write(`data: ${JSON.stringify({ thought: '🧠 Deep Research: mencari bukti, sumber, dan alternatif solusi...\n' })}\n\n`);
      
      const researchInput =
        `[TUGAS DEEP RESEARCH UNTUK HANDOFF KE AGENT EKSEKUTOR]\n` +
        `Teliti permintaan pengguna secara mendalam sebelum implementasi/jawaban akhir. Gunakan informasi terkini dan sumber primer/resmi bila tersedia. Jangan berhenti pada satu dugaan jika ada alternatif material yang perlu dibandingkan.\n\n` +
        `Pada hasil akhir riset, buat HANDOFF yang jelas dan padat dengan struktur berikut:\n` +
        `1. Tujuan pengguna dan constraint penting.\n` +
        `2. Fakta terverifikasi + sumber/URL yang relevan.\n` +
        `3. Hal yang masih tidak pasti atau perlu diverifikasi oleh eksekutor.\n` +
        `4. Alternatif solusi yang benar-benar layak beserta trade-off.\n` +
        `5. Rekomendasi sementara dan alasan berbasis bukti.\n` +
        `6. Rencana implementasi/verifikasi yang dapat dilakukan eksekutor di workspace.\n` +
        `Handoff adalah bukti untuk eksekutor, bukan perintah mutlak: eksekutor boleh mengoreksi rekomendasi jika workspace atau verifikasi lanjutan menunjukkan hal berbeda.\n\n` +
        `[RIWAYAT PERCAKAPAN]\n${historyText || '(tidak ada)'}\n\n` +
        `[PERMINTAAN BARU]\n${message}`;
      
      const researchStream = await executeStreamWithRetry(async () => {
        try {
          return await (ai.interactions.create as any)({
            agent: 'gemini-deep-research-max-preview-04-2026',
            input: researchInput,
            environment: 'remote',
            stream: true
          });
        } catch (err: any) {
          if (err?.message?.includes('404')) {
            // Fallback if the Deep Research agent name is temporarily unavailable.
            return await (ai.interactions.create as any)({
              agent: 'antigravity-preview-05-2026',
              input: researchInput,
              environment: 'remote',
              stream: true
            });
          }
          throw err;
        }
      });

      let researchResult = '';
      let researchThoughtSummary = '';

      for await (const event of researchStream) {
        if (event.event_type === 'step.delta') {
          if (event.delta?.type === 'thought_summary' && event.delta?.content?.text) {
            const summaryText = event.delta.content.text;
            researchThoughtSummary += `${summaryText}\n`;
            res.write(`data: ${JSON.stringify({ thought: summaryText })}\n\n`);
          } else if (event.delta?.type === 'text' && event.delta?.text) {
            researchResult += event.delta.text;
            res.write(`data: ${JSON.stringify({ thought: event.delta.text })}\n\n`);
          }
        }

        const gm = (event as any).groundingMetadata || (event as any).delta?.groundingMetadata;
        if (gm) {
          res.write(`data: ${JSON.stringify({ groundingMetadata: gm })}\n\n`);
        }
      }

      // Prefer the explicit research report. If the agent emitted little/no final
      // text, retain the visible thought-summary as a fallback handoff instead of
      // sending an empty research packet to Flash Lite.
      const cleanResearch = researchResult.trim();
      const researchHandoff = cleanResearch.length >= 200
        ? cleanResearch
        : [cleanResearch, researchThoughtSummary.trim()].filter(Boolean).join('\n\n');
      
      res.write(`data: ${JSON.stringify({ thought: '\n\n⚡ Deep Research selesai. Flash Lite sekarang membaca handoff, memverifikasi, lalu bekerja dengan tool...\n' })}\n\n`);
      
      // --- Step 2: Flash Lite as reasoning engineer/executor ---
      const flashHistory = safeHistory.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));
      
      const flashInput =
        `Anda adalah eksekutor/engineer akhir dari mode hybrid. Baca handoff Deep Research di bawah sebagai bukti awal, BUKAN sebagai kesimpulan yang wajib diikuti.\n` +
        `WAJIB lakukan Google Search Grounding independen minimal satu ronde untuk memverifikasi poin penting dari handoff sebelum menetapkan solusi final. Jangan hanya mempercayai atau merangkum hasil Deep Research. Prioritaskan sumber resmi/primer dan lakukan query tambahan jika hasil pertama belum cukup.\n` +
        `Setelah verifikasi search, hubungkan hasil riset dengan permintaan pengguna dan kondisi workspace nyata. Untuk tugas implementasi, inspect workspace, kerjakan dengan execute_terminal, lalu verifikasi file dan jalankan syntax check/build/test/lint/typecheck yang relevan. Jawaban kode di chat saja tidak dianggap implementasi.\n` +
        `Jika search independen atau kondisi workspace menunjukkan rekomendasi riset tidak cocok, koreksi pendekatan dan jelaskan hasil akhirnya berdasarkan bukti terbaru.\n\n` +
        `[PERMINTAAN PENGGUNA]\n${message}\n\n` +
        `[HANDOFF DEEP RESEARCH]\n${researchHandoff || '(Deep Research tidak menghasilkan handoff teks; lakukan verifikasi mandiri dengan tool.)'}`;
      
      const hybridContextKey = getReasoningContextKey(
        sessionId,
        'hybrid-deep-research-flash-lite::gemini-3.5-flash-lite'
      );
      const storedHybridContext = reasoningContextBySession.get(hybridContextKey);

      const flashContents = storedHybridContext &&
        storedHybridContext.expectedNextHistoryLength === safeHistory.length
        ? [
            ...storedHybridContext.contents,
            { role: 'user', parts: [{ text: flashInput }] }
          ]
        : [
            ...flashHistory,
            { role: 'user', parts: [{ text: flashInput }] }
          ];

      const updatedHybridContents = await runGeminiToolLoop(
        'gemini-3.5-flash-lite',
        flashContents,
        15,
        {
          requireSearch: true,
          requireWorkspace: turnPolicy.requireWorkspace,
          reason: turnPolicy.requireWorkspace
            ? 'mode hybrid + tugas implementasi: Search independen dan eksekusi workspace sama-sama wajib'
            : 'mode hybrid: Flash Lite wajib memverifikasi handoff Deep Research dengan Search Grounding independen'
        }
      );

      saveReasoningContext(
        hybridContextKey,
        updatedHybridContents,
        safeHistory.length + 2
      );

    } else if (isAgent) {
      // Interactions/Antigravity agents manage their own remote agent loop.
      // We still give them the same evidence-first operating policy.
      const stream = await executeStreamWithRetry(async () => {
        const historyText = safeHistory
          .map((msg: any) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}`)
          .join('\n\n');
        const baseInput = safeHistory.length > 0
          ? `[Conversation History]\n${historyText}\n\n[New Message]\nUser: ${message}`
          : message;
        const interactionTurnPolicy =
          `[KEWAJIBAN TURN INI]\n` +
          `- Google Search Grounding: ${turnPolicy.requireSearch ? 'WAJIB sebelum solusi final' : 'tidak wajib'}\n` +
          `- Pekerjaan filesystem/workspace: ${turnPolicy.requireWorkspace ? 'WAJIB benar-benar dilakukan dan diverifikasi' : 'tidak wajib'}\n` +
          `Jika wajib, jangan berhenti pada jawaban konseptual atau contoh kode saja.`;
        const input = `[System Instruction]\n${agentInstruction}\n\n${interactionTurnPolicy}\n\n${baseInput}`;
        
        return await (ai.interactions.create as any)({
          agent: selectedModel,
          input,
          environment: 'remote',
          stream: true
        });
      });

      for await (const event of stream) {
        if (event.event_type === 'step.delta') {
          if (event.delta?.type === 'thought_summary' && event.delta?.content?.text) {
            res.write(`data: ${JSON.stringify({ thought: event.delta.content.text })}\n\n`);
          } else if (event.delta?.type === 'text' && event.delta?.text) {
            res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
          }
        }

        const gm = (event as any).groundingMetadata || (event as any).delta?.groundingMetadata;
        if (gm) {
          res.write(`data: ${JSON.stringify({ groundingMetadata: gm })}\n\n`);
        }
      }

    } else {
      // Standard Gemini 3+ mode: evidence-first reasoning + Search Grounding +
      // iterative custom tools. Keep all raw parts inside each request so thought
      // signatures/tool context survive from one tool turn to the next.
      const formattedHistory = safeHistory.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      const contextKey = getReasoningContextKey(sessionId, selectedModel);
      const storedContext = reasoningContextBySession.get(contextKey);

      const contents = storedContext &&
        storedContext.expectedNextHistoryLength === safeHistory.length
        ? [
            ...storedContext.contents,
            { role: 'user', parts: [{ text: message }] }
          ]
        : [
            ...formattedHistory,
            { role: 'user', parts: [{ text: message }] }
          ];

      const updatedContents = await runGeminiToolLoop(
        selectedModel,
        contents,
        15,
        turnPolicy
      );

      saveReasoningContext(
        contextKey,
        updatedContents,
        safeHistory.length + 2
      );
    }
    
    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (error: any) {
    console.error('Chat API Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal Server Error', stack: error.stack });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message, stack: error.stack })}\n\n`);
      res.end();
    }
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Express 5.x compatibility
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
