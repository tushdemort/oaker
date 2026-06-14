import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const reportsDir = path.join(publicDir, "research-reports");
const port = Number(process.env.PORT || 3000);
const ollamaHost = normalizeHost(process.env.OLLAMA_HOST || "http://127.0.0.1:11434");
const db = new DatabaseSync(path.join(__dirname, "oaker.sqlite"));

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

initDatabase();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    if (url.pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, { ollamaHost });
      return;
    }

    if (url.pathname === "/api/health" && req.method === "GET") {
      await proxyJson(res, "/api/version");
      return;
    }

    if (url.pathname === "/api/tags" && req.method === "GET") {
      await proxyJson(res, "/api/tags");
      return;
    }

    if (url.pathname === "/api/diagnostics" && req.method === "GET") {
      await sendDiagnostics(res);
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      sendJson(res, 200, loadAppState());
      return;
    }

    if (url.pathname === "/api/state" && req.method === "PUT") {
      await saveAppState(req, res);
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      await proxyChat(req, res);
      return;
    }

    if (url.pathname === "/api/search" && req.method === "GET") {
      await searchDuckDuckGo(url, res);
      return;
    }

    if (url.pathname === "/api/page" && req.method === "GET") {
      await fetchResearchPage(url, res);
      return;
    }

    if (url.pathname === "/api/research-report" && req.method === "POST") {
      await saveResearchReport(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, res, req.method === "HEAD");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    if (!res.headersSent) {
      sendJson(res, 500, { error: message });
    } else {
      res.end();
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Oaker Local Chat running at http://localhost:${port}`);
  console.log(`Proxying Ollama from ${ollamaHost}`);
});

function normalizeHost(value) {
  const host = new URL(value);
  if (host.protocol !== "http:" && host.protocol !== "https:") {
    throw new Error("OLLAMA_HOST must start with http:// or https://");
  }
  return host.origin;
}

function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      messages_json TEXT NOT NULL
    );
  `);

  ensureConversationColumn("parent_id", "TEXT");
  ensureConversationColumn("branch_from_message_id", "TEXT");
  ensureConversationColumn("branch_created_at", "INTEGER");
  ensureConversationColumn("context_summary", "TEXT");
  ensureConversationColumn("context_stats_json", "TEXT");
}

function ensureConversationColumn(name, definition) {
  const columns = db.prepare("PRAGMA table_info(conversations)").all();
  if (columns.some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${definition}`);
}

function loadAppState() {
  const settingsRow = db.prepare("SELECT json FROM app_settings WHERE id = 1").get();
  const settingsPayload = settingsRow ? safeParseJson(settingsRow.json) : {};
  const rows = db
    .prepare("SELECT id, title, model, created_at, updated_at, parent_id, branch_from_message_id, branch_created_at, context_summary, context_stats_json, messages_json FROM conversations ORDER BY updated_at DESC")
    .all();

  return {
    settings: settingsPayload?.settings || null,
    currentId: settingsPayload?.currentId || null,
    conversations: rows.map((row) => ({
      id: row.id,
      title: row.title,
      model: row.model || "",
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      parentId: row.parent_id || null,
      branchFromMessageId: row.branch_from_message_id || null,
      branchCreatedAt: row.branch_created_at ? Number(row.branch_created_at) : null,
      contextSummary: row.context_summary || "",
      contextStats: safeParseJson(row.context_stats_json) || null,
      messages: safeParseJson(row.messages_json) || []
    }))
  };
}

async function saveAppState(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON request body" });
    return;
  }

  const settings = isPlainObject(payload.settings) ? payload.settings : {};
  const currentId = typeof payload.currentId === "string" ? payload.currentId : null;
  const conversations = Array.isArray(payload.conversations) ? payload.conversations : [];
  const now = Date.now();

  const upsertSettings = db.prepare(`
    INSERT INTO app_settings (id, json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `);
  const deleteConversations = db.prepare("DELETE FROM conversations");
  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, title, model, created_at, updated_at, parent_id, branch_from_message_id, branch_created_at, context_summary, context_stats_json, messages_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    db.exec("BEGIN");
    upsertSettings.run(JSON.stringify({ settings, currentId }), now);
    deleteConversations.run();

    for (const conversation of conversations) {
      if (!conversation?.id) continue;
      insertConversation.run(
        String(conversation.id),
        String(conversation.title || "New chat"),
        conversation.model ? String(conversation.model) : "",
        Number(conversation.createdAt || now),
        Number(conversation.updatedAt || now),
        conversation.parentId ? String(conversation.parentId) : null,
        conversation.branchFromMessageId ? String(conversation.branchFromMessageId) : null,
        conversation.branchCreatedAt ? Number(conversation.branchCreatedAt) : null,
        typeof conversation.contextSummary === "string" ? conversation.contextSummary : "",
        JSON.stringify(isPlainObject(conversation.contextStats) ? conversation.contextStats : null),
        JSON.stringify(Array.isArray(conversation.messages) ? conversation.messages : [])
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    sendJson(res, 500, {
      error: "Unable to save app state",
      detail: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  sendJson(res, 200, { ok: true, savedAt: now });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function proxyJson(res, endpoint) {
  try {
    const upstream = await fetch(`${ollamaHost}${endpoint}`);
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach Ollama",
      detail: error instanceof Error ? error.message : String(error),
      ollamaHost
    });
  }
}

async function sendDiagnostics(res) {
  const startedAt = Date.now() - Math.floor(process.uptime() * 1000);
  let ollama = {
    ok: false,
    version: "",
    modelCount: 0,
    error: ""
  };
  let reportCount = 0;

  try {
    const [versionResponse, tagsResponse] = await Promise.all([
      fetch(`${ollamaHost}/api/version`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) })
    ]);
    const versionPayload = versionResponse.ok ? await versionResponse.json() : {};
    const tagsPayload = tagsResponse.ok ? await tagsResponse.json() : {};
    ollama = {
      ok: versionResponse.ok,
      version: versionPayload.version || "",
      modelCount: Array.isArray(tagsPayload.models) ? tagsPayload.models.length : 0,
      error: versionResponse.ok ? "" : `Ollama returned ${versionResponse.status}`
    };
  } catch (error) {
    ollama.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const files = await readdir(reportsDir);
    reportCount = files.filter((file) => file.endsWith(".html")).length;
  } catch {
    reportCount = 0;
  }

  const conversationRows = db
    .prepare("SELECT messages_json FROM conversations")
    .all();
  const messageCount = conversationRows.reduce((total, row) => {
    const messages = safeParseJson(row.messages_json);
    return total + (Array.isArray(messages) ? messages.length : 0);
  }, 0);

  sendJson(res, 200, {
    app: {
      name: "Oaker",
      serverTime: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      node: process.version,
      platform: `${process.platform} ${process.arch}`
    },
    ollama: {
      host: ollamaHost,
      ...ollama
    },
    storage: {
      database: path.join(__dirname, "oaker.sqlite"),
      conversations: conversationRows.length,
      messages: messageCount,
      reports: reportCount
    },
    search: {
      provider: "DuckDuckGo HTML",
      githubDirectReader: true
    },
    security: {
      bind: "127.0.0.1",
      notes: [
        "Keep Ollama and Oaker bound to localhost unless you add authentication.",
        "Web pages and search results are treated as untrusted model context."
      ]
    }
  });
}

async function proxyChat(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
    JSON.parse(body);
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON request body" });
    return;
  }

  const abortController = new AbortController();
  res.on("close", () => abortController.abort());

  let upstream;
  try {
    upstream = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: abortController.signal
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to reach Ollama",
      detail: error instanceof Error ? error.message : String(error),
      ollamaHost
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    sendJson(res, upstream.status || 502, {
      error: "Ollama rejected the chat request",
      detail: safeParseJson(text) || text
    });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

async function searchDuckDuckGo(url, res) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = clamp(Number(url.searchParams.get("limit") || 6), 1, 20);
  if (!query) {
    sendJson(res, 400, { error: "Missing search query" });
    return;
  }

  try {
    sendJson(res, 200, {
      query,
      results: await searchDuckDuckGoPages(query, limit)
    });
  } catch (error) {
    const detail = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "DuckDuckGo timed out or rate limited this request"
      : error instanceof Error ? error.message : String(error);

    sendJson(res, 502, {
      error: "Unable to search DuckDuckGo",
      detail
    });
  }
}

async function searchDuckDuckGoPages(query, limit) {
  const results = [];
  const seen = new Set();
  const offsets = [0, 30, 60];

  for (const offset of offsets) {
    if (results.length >= limit) break;

    const searchUrl = new URL("https://html.duckduckgo.com/html/");
    searchUrl.searchParams.set("q", query);
    if (offset > 0) {
      searchUrl.searchParams.set("s", String(offset));
      searchUrl.searchParams.set("dc", String(offset + 1));
      searchUrl.searchParams.set("api", "d.js");
      searchUrl.searchParams.set("o", "json");
      searchUrl.searchParams.set("v", "l");
    }

    let upstream;

    try {
      upstream = await fetch(searchUrl, {
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 OakerLocalChat/0.1"
        },
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      if (results.length > 0) break;
      throw error;
    }

    if (!upstream.ok && results.length > 0) {
      break;
    }

    if (!upstream.ok) {
      throw new Error("DuckDuckGo search failed");
    }

    const html = await upstream.text();
    for (const result of parseDuckDuckGoResults(html)) {
      const key = normalizeResultUrl(result.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(result);
      if (results.length >= limit) break;
    }

    if (results.length < limit) {
      await delay(650);
    }
  }

  return results.slice(0, limit);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeResultUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function fetchResearchPage(url, res) {
  const target = (url.searchParams.get("url") || "").trim();
  let parsed;

  try {
    parsed = new URL(target);
  } catch {
    sendJson(res, 400, { error: "Invalid page URL" });
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    sendJson(res, 400, { error: "Only http and https URLs are supported" });
    return;
  }

  try {
    const githubPage = await fetchGitHubResearchPage(parsed);
    if (githubPage) {
      sendJson(res, 200, githubPage);
      return;
    }

    const upstream = await fetch(parsed.href, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,text/plain",
        "User-Agent": "Mozilla/5.0 OakerDeepResearch/0.1"
      },
      redirect: "follow"
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: "Unable to fetch page" });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const html = await upstream.text();
    const title = extractTitle(html) || parsed.hostname;
    const text = htmlToResearchText(html).slice(0, 18000);

    sendJson(res, 200, {
      url: parsed.href,
      finalUrl: upstream.url || parsed.href,
      title,
      contentType,
      text
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Unable to fetch page",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchGitHubResearchPage(parsed) {
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo] = parts;
  if (!isSafeGitHubPathPart(owner) || !isSafeGitHubPathPart(repo)) return null;

  if (parts[2] === "blob" && parts[3] && parts.length > 4) {
    const branch = parts[3];
    const filePath = parts.slice(4).join("/");
    const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
    const raw = await fetchTextWithTimeout(rawUrl, "text/plain, text/markdown, application/octet-stream");
    if (!raw) return null;

    return {
      url: parsed.href,
      finalUrl: rawUrl,
      title: `${owner}/${repo}/${filePath}`,
      contentType: raw.contentType,
      text: `GitHub file: ${owner}/${repo}/${filePath}\nURL: ${parsed.href}\n\n${raw.text}`.slice(0, 18000)
    };
  }

  if (parts.length > 2 && parts[2] !== "tree") return null;

  const repoApi = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repoInfo = await fetchJsonWithTimeout(repoApi);
  if (!repoInfo?.full_name) return null;

  const branch = typeof repoInfo.default_branch === "string" ? repoInfo.default_branch : "main";
  const readmeApi = `${repoApi}/readme`;
  const contentsApi = `${repoApi}/contents`;
  const [readme, contents] = await Promise.all([
    fetchTextWithTimeout(readmeApi, "application/vnd.github.raw,text/plain,text/markdown"),
    fetchJsonWithTimeout(contentsApi)
  ]);

  const rootItems = Array.isArray(contents)
    ? contents
      .slice(0, 80)
      .map((item) => `- ${item.type === "dir" ? "Directory" : "File"}: ${item.name}`)
      .join("\n")
    : "";

  const text = [
    `GitHub repository: ${repoInfo.full_name}`,
    repoInfo.description ? `Description: ${repoInfo.description}` : "",
    repoInfo.language ? `Primary language: ${repoInfo.language}` : "",
    Number.isFinite(repoInfo.stargazers_count) ? `Stars: ${repoInfo.stargazers_count}` : "",
    Number.isFinite(repoInfo.forks_count) ? `Forks: ${repoInfo.forks_count}` : "",
    repoInfo.updated_at ? `Last updated: ${repoInfo.updated_at}` : "",
    `Default branch: ${branch}`,
    repoInfo.license?.name ? `License: ${repoInfo.license.name}` : "",
    repoInfo.html_url ? `Repository URL: ${repoInfo.html_url}` : parsed.href,
    rootItems ? `\nRoot contents:\n${rootItems}` : "",
    readme?.text ? `\nREADME:\n${readme.text}` : ""
  ].filter(Boolean).join("\n");

  if (!text.trim()) return null;

  return {
    url: parsed.href,
    finalUrl: repoInfo.html_url || parsed.href,
    title: repoInfo.full_name,
    contentType: "text/plain; charset=utf-8",
    text: text.slice(0, 18000)
  };
}

function isSafeGitHubPathPart(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value || "");
}

async function fetchJsonWithTimeout(url) {
  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Mozilla/5.0 OakerDeepResearch/0.1"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return null;
    return await upstream.json();
  } catch {
    return null;
  }
}

async function fetchTextWithTimeout(url, accept) {
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": "Mozilla/5.0 OakerDeepResearch/0.1"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return null;
    return {
      contentType: upstream.headers.get("content-type") || "text/plain; charset=utf-8",
      text: await upstream.text()
    };
  } catch {
    return null;
  }
}

async function saveResearchReport(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON request body" });
    return;
  }

  const html = typeof payload.html === "string" ? payload.html : "";
  if (!html.trim()) {
    sendJson(res, 400, { error: "Missing report HTML" });
    return;
  }

  const id = `research-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${id}.html`;
  const filePath = path.join(reportsDir, filename);

  try {
    await mkdir(reportsDir, { recursive: true });
    await writeFile(filePath, html, "utf8");
    sendJson(res, 200, { url: `/research-reports/${filename}`, id });
  } catch (error) {
    sendJson(res, 500, {
      error: "Unable to save research report",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function parseDuckDuckGoResults(html) {
  const anchorPattern = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(anchorPattern)];
  const results = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const segment = html.slice(match.index, nextMatch?.index || match.index + 3000);
    const title = cleanHtml(match[2]);
    const href = decodeDuckDuckGoUrl(decodeHtml(match[1]));
    const snippetMatch = segment.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? cleanHtml(snippetMatch[1]) : "";

    if (title && href) {
      results.push({ title, url: href, snippet });
    }
  }

  return results;
}

function decodeDuckDuckGoUrl(href) {
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(absolute, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.href;
  } catch {
    return href;
  }
}

function cleanHtml(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanHtml(match[1]).slice(0, 160) : "";
}

function htmlToResearchText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|section|article|header|footer|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
      const offset = radix === 16 ? 2 : 1;
      const parsed = Number.parseInt(code.slice(offset), radix);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    return named[code.toLowerCase()] || entity;
  });
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000_000) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(pathname, res, headOnly) {
  const decodedPath = decodeURIComponent(pathname);
  let filePath = path.normalize(path.join(publicDir, decodedPath === "/" ? "index.html" : decodedPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(publicDir, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes.get(ext) || "application/octet-stream";
  const content = await readFile(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });

  if (headOnly) {
    res.end();
    return;
  }

  res.end(content);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end();
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
