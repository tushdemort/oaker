const STORAGE_KEY = "oaker.local-chat.conversations.v1";
const SETTINGS_KEY = "oaker.local-chat.settings.v1";

const DEFAULT_SYSTEM_PROMPT = "You are a thoughtful local assistant. Be concise, practical, and clear.";
const BEHAVIOR_PRESETS = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Clear, helpful, and steady.",
    temperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  },
  {
    id: "precise",
    name: "Precise",
    description: "Short answers with fewer guesses.",
    temperature: 0.2,
    systemPrompt: "You are a precise local assistant. Answer directly, state uncertainty, and avoid speculation."
  },
  {
    id: "creative",
    name: "Creative",
    description: "More exploratory and idea-rich.",
    temperature: 1.1,
    systemPrompt: "You are a creative local assistant. Explore useful possibilities, offer vivid options, and stay practical."
  },
  {
    id: "code",
    name: "Code",
    description: "Engineering-focused responses.",
    temperature: 0.4,
    systemPrompt: "You are a senior engineering assistant. Prefer concrete fixes, concise explanations, and careful tradeoffs."
  },
  {
    id: "custom",
    name: "Custom",
    description: "Edit prompt and temperature.",
    temperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  }
];
const GRAPH_COLORS = ["#18bdf2", "#2188ff", "#a837f4", "#e232ad", "#f42618", "#ff7a3d", "#f4d33d", "#6fd34f", "#35c6a8", "#22a6d6"];
const GRAPH_LANE_STEP = 36;
const GRAPH_LANE_BASE = 18;
const RESEARCH_GRAPH_COLORS = ["#c85d5a", "#d19a5a", "#8da172", "#5f948a", "#9a7a96", "#738aa5"];
const DEEP_RESEARCH_MAX_TURNS = 4;
const DEEP_RESEARCH_MIN_TURNS = 2;
const DEEP_RESEARCH_SITES_PER_TURN = 4;

const elements = {
  composer: document.querySelector("#composer"),
  connectionCard: document.querySelector("#connectionCard"),
  connectionDetail: document.querySelector("#connectionDetail"),
  connectionTitle: document.querySelector("#connectionTitle"),
  conversationList: document.querySelector("#conversationList"),
  deepResearchButton: document.querySelector("#deepResearchButton"),
  graphCloseButton: document.querySelector("#graphCloseButton"),
  graphDialog: document.querySelector("#graphDialog"),
  graphList: document.querySelector("#graphList"),
  messages: document.querySelector("#messages"),
  modelButton: document.querySelector("#modelButton"),
  modelLabel: document.querySelector("#modelLabel"),
  modelList: document.querySelector("#modelList"),
  modelPicker: document.querySelector("#modelPicker"),
  customBehaviorControls: document.querySelector("#customBehaviorControls"),
  clearMemoriesButton: document.querySelector("#clearMemoriesButton"),
  memoryList: document.querySelector("#memoryList"),
  memoryToggle: document.querySelector("#memoryToggle"),
  newChatButton: document.querySelector("#newChatButton"),
  presetGrid: document.querySelector("#presetGrid"),
  promptInput: document.querySelector("#promptInput"),
  refreshModelsButton: document.querySelector("#refreshModelsButton"),
  sendButton: document.querySelector("#sendButton"),
  sidebarToggleButton: document.querySelector("#sidebarToggleButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsCloseButton: document.querySelector("#settingsCloseButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  systemPrompt: document.querySelector("#systemPrompt"),
  temperatureRange: document.querySelector("#temperatureRange"),
  temperatureValue: document.querySelector("#temperatureValue"),
  webSearchButton: document.querySelector("#webSearchButton")
};

const state = {
  abortController: null,
  config: { ollamaHost: "http://127.0.0.1:11434" },
  conversations: [],
  currentId: null,
  isStreaming: false,
  models: [],
  settings: {
    behaviorPreset: "balanced",
    memoryEnabled: false,
    memories: [],
    deepResearchEnabled: false,
    model: "",
    sidebarCollapsed: false,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    webSearchEnabled: false
  }
};

let persistTimer = null;
let seedServerFromLocal = false;

boot();

async function boot() {
  await loadState();
  bindEvents();
  ensureConversation();
  if (seedServerFromLocal) {
    saveState({ immediate: true });
  }
  renderAll();
  await loadConfig();
  await refreshModels();
}

function bindEvents() {
  elements.composer.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (state.isStreaming) {
      stopStreaming();
      return;
    }

    await sendMessage();
  });

  elements.promptInput.addEventListener("input", () => autoGrow(elements.promptInput));
  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });

  elements.newChatButton.addEventListener("click", () => {
    const conversation = createConversation();
    state.currentId = conversation.id;
    saveState();
    renderAll();
    elements.promptInput.focus();
  });

  elements.sidebarToggleButton.addEventListener("click", () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    saveState();
    renderSidebarState();
  });

  elements.refreshModelsButton.addEventListener("click", refreshModels);

  elements.presetGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset-id]");
    if (!button) return;
    selectBehaviorPreset(button.dataset.presetId);
  });

  elements.settingsButton.addEventListener("click", () => {
    elements.settingsDialog.showModal();
  });

  elements.settingsCloseButton.addEventListener("click", () => {
    elements.settingsDialog.close();
  });

  elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) {
      elements.settingsDialog.close();
    }
  });

  elements.graphCloseButton.addEventListener("click", () => {
    elements.graphDialog.close();
  });

  elements.graphDialog.addEventListener("click", (event) => {
    if (event.target === elements.graphDialog) {
      elements.graphDialog.close();
    }
  });

  elements.modelButton.addEventListener("click", () => {
    const isOpen = elements.modelPicker.classList.toggle("open");
    elements.modelButton.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (event) => {
    if (!elements.modelPicker.contains(event.target)) {
      closeModelMenu();
    }
  });

  elements.temperatureRange.addEventListener("input", () => {
    state.settings.behaviorPreset = "custom";
    state.settings.temperature = Number(elements.temperatureRange.value);
    elements.temperatureValue.value = state.settings.temperature.toFixed(1);
    saveState();
    renderSettings();
  });

  elements.systemPrompt.addEventListener("input", () => {
    state.settings.behaviorPreset = "custom";
    state.settings.systemPrompt = elements.systemPrompt.value;
    saveState();
    renderSettings();
  });

  elements.memoryToggle.addEventListener("change", () => {
    state.settings.memoryEnabled = elements.memoryToggle.checked;
    saveState();
    renderSettings();
  });

  elements.clearMemoriesButton.addEventListener("click", () => {
    if (state.settings.memories.length === 0) return;
    if (!window.confirm("Clear all saved memories?")) return;
    state.settings.memories = [];
    saveState();
    renderSettings();
  });

  elements.webSearchButton.addEventListener("click", () => {
    state.settings.webSearchEnabled = !state.settings.webSearchEnabled;
    if (!state.settings.webSearchEnabled) {
      state.settings.deepResearchEnabled = false;
    }
    saveState();
    renderWebSearchToggle();
    renderDeepResearchToggle();
  });

  elements.deepResearchButton.addEventListener("click", () => {
    state.settings.deepResearchEnabled = !state.settings.deepResearchEnabled;
    if (state.settings.deepResearchEnabled) {
      state.settings.webSearchEnabled = true;
      setConnection("online", "Deep research ready", "Internet search is enabled");
    }
    saveState();
    renderWebSearchToggle();
    renderDeepResearchToggle();
  });

}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Unable to load server config");
    state.config = await response.json();
    elements.connectionDetail.textContent = state.config.ollamaHost;
  } catch {
    elements.connectionDetail.textContent = state.config.ollamaHost;
  }
}

async function refreshModels() {
  elements.refreshModelsButton.disabled = true;
  setConnection("checking", "Checking Ollama", state.config.ollamaHost);

  try {
    const [healthResponse, tagsResponse] = await Promise.all([
      fetch("/api/health"),
      fetch("/api/tags")
    ]);

    if (!healthResponse.ok) {
      const error = await readError(healthResponse);
      throw new Error(error || "Ollama is unavailable");
    }

    const tags = tagsResponse.ok ? await tagsResponse.json() : { models: [] };
    state.models = Array.isArray(tags.models) ? tags.models : [];

    if (!state.settings.model && state.models.length > 0) {
      state.settings.model = state.models[0].name;
    }

    renderModelPicker();
    setConnection("online", "Ollama connected", `${state.config.ollamaHost} · ${state.models.length} model${state.models.length === 1 ? "" : "s"}`);
    saveState();
  } catch (error) {
    state.models = [];
    renderModelPicker();
    setConnection("offline", "Ollama offline", error instanceof Error ? error.message : "Unable to reach Ollama");
  } finally {
    elements.refreshModelsButton.disabled = false;
  }
}

async function sendMessage() {
  const prompt = elements.promptInput.value.trim();
  if (!prompt || state.isStreaming) return;

  const model = state.settings.model;
  if (!model) {
    setConnection("offline", "No model selected", "Pull a model in Ollama, then refresh.");
    return;
  }

  if (state.settings.deepResearchEnabled) {
    await sendDeepResearchMessage(prompt, model);
    return;
  }

  const conversation = getCurrentConversation() || createConversation();
  state.currentId = conversation.id;
  conversation.model = model;

  learnMemoriesFromPrompt(prompt);
  const previousMessages = [...conversation.messages];
  const userMessage = createMessage("user", prompt);
  const assistantMessage = createMessage("assistant", "");
  conversation.messages.push(userMessage, assistantMessage);
  conversation.title = makeTitle(prompt);
  conversation.updatedAt = Date.now();

  elements.promptInput.value = "";
  autoGrow(elements.promptInput);
  setStreaming(true);
  saveState();
  renderAll();
  scrollToBottom();

  state.abortController = new AbortController();

  try {
    let webContext = null;
    if (state.settings.webSearchEnabled) {
      try {
        webContext = await fetchWebContext(prompt);
        if (webContext?.results?.length) {
          assistantMessage.sources = webContext.results;
          saveState();
        }
      } catch (error) {
        setConnection("offline", "Web search failed", error instanceof Error ? error.message : "DuckDuckGo search failed");
      }
    }

    const requestMessages = buildRequestMessages(previousMessages, prompt, webContext);
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: requestMessages,
        stream: true,
        options: {
          temperature: Number(state.settings.temperature)
        }
      }),
      signal: state.abortController.signal
    });

    if (!response.ok || !response.body) {
      const error = await readError(response);
      throw new Error(error || "The model did not return a response.");
    }

    await readChatStream(response, assistantMessage);
  } catch (error) {
    if (error.name === "AbortError") {
      assistantMessage.content = assistantMessage.content || "Stopped.";
    } else {
      assistantMessage.content = `I could not complete that request.\n\n${error instanceof Error ? error.message : String(error)}`;
      assistantMessage.error = true;
    }
  } finally {
    conversation.updatedAt = Date.now();
    setStreaming(false);
    saveState({ immediate: true });
    renderAll();
    scrollToBottom();
  }
}

async function sendDeepResearchMessage(prompt, model) {
  if (!state.settings.webSearchEnabled) {
    setConnection("offline", "Deep research needs internet", "Turn on web search first.");
    return;
  }

  const conversation = getCurrentConversation() || createConversation();
  state.currentId = conversation.id;
  conversation.model = model;

  learnMemoriesFromPrompt(prompt);
  const userMessage = createMessage("user", prompt);
  const assistantMessage = createMessage("assistant", "");
  assistantMessage.research = createResearchState(prompt);
  conversation.messages.push(userMessage, assistantMessage);
  conversation.title = makeTitle(prompt);
  conversation.updatedAt = Date.now();

  elements.promptInput.value = "";
  autoGrow(elements.promptInput);
  setStreaming(true);
  saveState();
  renderAll();
  scrollToBottom();

  state.abortController = new AbortController();

  try {
    await runDeepResearch(prompt, model, assistantMessage, conversation, state.abortController.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      assistantMessage.research.status = "stopped";
      assistantMessage.research.finishedAt = Date.now();
      assistantMessage.content = "Deep research stopped.";
    } else {
      assistantMessage.research.status = "error";
      assistantMessage.research.finishedAt = Date.now();
      assistantMessage.research.error = error instanceof Error ? error.message : String(error);
      assistantMessage.content = `Deep research failed.\n\n${assistantMessage.research.error}`;
      assistantMessage.error = true;
    }
  } finally {
    conversation.updatedAt = Date.now();
    setStreaming(false);
    saveState({ immediate: true });
    renderAll();
    scrollToBottom();
  }
}

function createResearchState(prompt) {
  return {
    prompt,
    status: "running",
    startedAt: Date.now(),
    finishedAt: 0,
    turns: [],
    reportUrl: "",
    reportTitle: "",
    error: ""
  };
}

async function runDeepResearch(prompt, model, assistantMessage, conversation, signal) {
  const research = assistantMessage.research;
  const notes = [];
  const sourceByUrl = new Map();
  let query = prompt;
  let nextCitationId = 1;

  for (let turnNumber = 1; turnNumber <= DEEP_RESEARCH_MAX_TURNS; turnNumber += 1) {
    throwIfAborted(signal);
    const turn = {
      id: crypto.randomUUID(),
      number: turnNumber,
      query,
      status: "searching",
      sites: [],
      summary: "",
      nextQuery: ""
    };

    research.turns.push(turn);
    research.status = "searching";
    updateResearchProgress(assistantMessage, conversation);
    setConnection("checking", `Research turn ${turnNumber}`, "Searching DuckDuckGo");

    const results = await fetchResearchSearch(query, signal);
    turn.sites = results.slice(0, DEEP_RESEARCH_SITES_PER_TURN).map((result) => {
      const existing = sourceByUrl.get(result.url);
      const citationId = existing?.citationId || nextCitationId++;
      const site = {
        citationId,
        title: result.title,
        url: result.url,
        snippet: result.snippet || "",
        status: "queued",
        text: "",
        error: ""
      };
      sourceByUrl.set(result.url, site);
      return site;
    });

    updateResearchProgress(assistantMessage, conversation);

    for (const site of turn.sites) {
      throwIfAborted(signal);
      site.status = "reading";
      updateResearchProgress(assistantMessage, conversation);

      try {
        const page = await fetchResearchPage(site.url, signal);
        site.title = page.title || site.title;
        site.url = page.finalUrl || page.url || site.url;
        site.text = page.text || site.snippet;
        site.status = site.text ? "read" : "skimmed";
      } catch (error) {
        site.status = "error";
        site.error = error instanceof Error ? error.message : String(error);
      }

      updateResearchProgress(assistantMessage, conversation);
    }

    turn.status = "thinking";
    research.status = "thinking";
    updateResearchProgress(assistantMessage, conversation);
    setConnection("checking", `Research turn ${turnNumber}`, "Synthesizing findings");

    turn.summary = await summarizeResearchTurn(prompt, turn, notes, model, signal);
    notes.push({ turn: turn.number, query: turn.query, summary: turn.summary });
    turn.status = "done";

    if (turnNumber >= DEEP_RESEARCH_MAX_TURNS) {
      break;
    }

    const nextQuery = await chooseNextResearchQuery(prompt, notes, turnNumber, model, signal);
    turn.nextQuery = nextQuery;
    updateResearchProgress(assistantMessage, conversation);

    if (!nextQuery && turnNumber >= DEEP_RESEARCH_MIN_TURNS) {
      break;
    }

    query = nextQuery || `${prompt} deeper evidence examples analysis`;
  }

  research.status = "writing";
  updateResearchProgress(assistantMessage, conversation);
  setConnection("checking", "Writing report", "Generating local website");

  const sources = collectResearchSources(research);
  const reportMarkdown = await writeResearchReport(prompt, notes, sources, model, signal);
  const reportHtml = buildResearchReportHtml(prompt, reportMarkdown, sources);
  const savedReport = await saveResearchReportHtml(reportHtml, signal);

  research.status = "complete";
  research.finishedAt = Date.now();
  research.reportUrl = savedReport.url;
  research.reportTitle = `Deep research report: ${prompt}`;
  assistantMessage.content = `Deep research complete.\n\n[Open the report](${savedReport.url})`;
  setConnection("online", "Deep research complete", savedReport.url);
  updateResearchProgress(assistantMessage, conversation);
}

async function fetchResearchSearch(query, signal) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8`, { signal });
  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || "Research search failed.");
  }

  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

async function fetchResearchPage(url, signal) {
  const response = await fetch(`/api/page?url=${encodeURIComponent(url)}`, { signal });
  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || "Unable to read page.");
  }
  return response.json();
}

async function summarizeResearchTurn(prompt, turn, priorNotes, model, signal) {
  const sourceBlocks = turn.sites
    .map((site) => `[[${site.citationId}]] ${site.title}\nURL: ${site.url}\nSnippet: ${site.snippet || "No snippet"}\nExtract:\n${(site.text || site.error || "").slice(0, 5500)}`)
    .join("\n\n");
  const prior = priorNotes.map((note) => `Turn ${note.turn}: ${note.summary}`).join("\n\n") || "None yet.";

  return askModelOnce(
    model,
    [
      ...getResearchBaseMessages(),
      {
        role: "user",
        content: `Research question: ${prompt}\n\nPrior turn notes:\n${prior}\n\nCurrent turn ${turn.number} search query: ${turn.query}\n\nWebsite material:\n${sourceBlocks}\n\nWrite detailed research notes for this turn. Use citations like [[1]] immediately after claims. Identify contradictions, missing evidence, and promising follow-up angles.`
      }
    ],
    signal
  );
}

async function chooseNextResearchQuery(prompt, notes, turnNumber, model, signal) {
  const decision = await askModelOnce(
    model,
    [
      ...getResearchBaseMessages(),
      {
        role: "user",
        content: `Research question: ${prompt}\n\nCompleted notes:\n${notes.map((note) => `Turn ${note.turn}, query "${note.query}":\n${note.summary}`).join("\n\n")}\n\nDecide whether another research turn is needed. Use another turn only if it would materially improve the report. Return only JSON in this exact shape:\n{"status":"continue","nextQuery":"specific web search query"}\nor\n{"status":"complete","nextQuery":""}\n\nMinimum turns: ${DEEP_RESEARCH_MIN_TURNS}. Current turns completed: ${turnNumber}.`
      }
    ],
    signal
  );

  const parsed = parseJsonObject(decision);
  if (turnNumber < DEEP_RESEARCH_MIN_TURNS && !parsed?.nextQuery) {
    return `${prompt} evidence analysis background`;
  }

  if (parsed?.status === "continue" && parsed.nextQuery) {
    return String(parsed.nextQuery).slice(0, 180);
  }

  return "";
}

async function writeResearchReport(prompt, notes, sources, model, signal) {
  return askModelOnce(
    model,
    [
      ...getResearchBaseMessages(),
      {
        role: "user",
        content: `Research question: ${prompt}\n\nTurn notes:\n${notes.map((note) => `Turn ${note.turn}, query "${note.query}":\n${note.summary}`).join("\n\n")}\n\nSources:\n${sources.map((source) => `[[${source.citationId}]] ${source.title}\n${source.url}\n${source.snippet || ""}`).join("\n\n")}\n\nWrite an extensive, well-structured final report in Markdown. Include an executive summary, key findings, detailed analysis, open questions, and a source-grounded conclusion. Cite every factual claim that comes from web material using [[number]] immediately after the sentence. Do not invent citations.`
      }
    ],
    signal
  );
}

async function askModelOnce(model, messages, signal) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: Math.min(Number(state.settings.temperature) || 0.2, 0.4)
      }
    }),
    signal
  });

  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || "The model did not return a research response.");
  }

  const text = await response.text();
  const payload = parseJsonObject(text) || parseJsonObject(text.trim().split("\n").at(-1) || "");
  return payload?.message?.content || payload?.response || text;
}

function getResearchBaseMessages() {
  const messages = [
    {
      role: "system",
      content: "You are a careful deep research assistant. Use provided web excerpts only for web facts, cite claims with the supplied citation IDs, and explicitly preserve uncertainty."
    }
  ];

  const systemPrompt = state.settings.systemPrompt.trim();
  if (systemPrompt) {
    messages.unshift({ role: "system", content: systemPrompt });
  }

  const memories = state.settings.memoryEnabled ? state.settings.memories : [];
  if (memories.length > 0) {
    messages.push({
      role: "system",
      content: `User memories and preferences saved locally. Treat these as standing user instructions unless the current task conflicts with them.\n\n${memories.map((memory) => `- ${memory.text}`).join("\n")}`
    });
  }

  return messages;
}

function collectResearchSources(research) {
  const byCitation = new Map();
  for (const turn of research.turns || []) {
    for (const site of turn.sites || []) {
      if (!site.url || !site.citationId) continue;
      byCitation.set(site.citationId, {
        citationId: site.citationId,
        title: site.title,
        url: site.url,
        snippet: site.snippet,
        status: site.status
      });
    }
  }
  return [...byCitation.values()].sort((a, b) => a.citationId - b.citationId);
}

function buildResearchReportHtml(prompt, reportMarkdown, sources) {
  const sourceList = sources
    .map((source) => `<li id="source-${source.citationId}"><a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">[${source.citationId}] ${escapeHtml(source.title || source.url)}</a><p>${escapeHtml(source.snippet || "")}</p></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(`Deep research report: ${prompt}`)}</title>
  <style>
    :root { color-scheme: light; --ink: #25221f; --muted: #6f675d; --line: #ddd4c8; --bg: #f7f3eb; --panel: #fffdf8; --accent: #344f43; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
    main { width: min(920px, calc(100% - 36px)); margin: 0 auto; padding: 48px 0 72px; }
    header { margin-bottom: 34px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; max-width: 780px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2.2rem, 6vw, 4.5rem); line-height: 1; letter-spacing: 0; }
    .meta { margin-top: 12px; color: var(--muted); }
    article { padding: 24px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 18px 50px rgba(37, 34, 31, 0.08); }
    h2, h3 { line-height: 1.2; }
    code { padding: 0.1em 0.3em; background: rgba(52, 79, 67, 0.1); border-radius: 5px; }
    pre { overflow: auto; padding: 14px; color: #fffaf3; background: #252a28; border-radius: 8px; }
    .citation-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 220px; margin: 0 2px; padding: 2px 8px 2px 3px; color: var(--muted); background: rgba(52, 79, 67, 0.1); border-radius: 999px; font-size: 0.78rem; font-weight: 750; line-height: 1.6; text-decoration: none; vertical-align: 0.08em; white-space: nowrap; }
    .citation-icon { display: grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; color: #fff; background: var(--accent); border-radius: 999px; font-size: 0.67rem; }
    .sources { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
    .sources li { margin-bottom: 12px; }
    .sources p { margin: 4px 0 0; color: var(--muted); }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(prompt)}</h1>
      <div class="meta">Generated by Oaker Deep Research on ${new Date().toLocaleString()}</div>
    </header>
    <article>${renderMarkdown(reportMarkdown, sources)}</article>
    <section class="sources">
      <h2>Sources</h2>
      <ol>${sourceList}</ol>
    </section>
  </main>
</body>
</html>`;
}

async function saveResearchReportHtml(html, signal) {
  const response = await fetch("/api/research-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html }),
    signal
  });

  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || "Unable to save research report.");
  }

  return response.json();
}

function updateResearchProgress(message, conversation) {
  conversation.updatedAt = Date.now();
  updateResearchMessage(message);
  saveState();
  scrollToBottom();
}

function updateResearchMessage(message) {
  const node = document.querySelector(`[data-message-id="${message.id}"] .message-content`);
  if (!node) return;
  node.innerHTML = renderResearchGraph(message.research);
  node.classList.add("typing-cursor");
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Research stopped");
  error.name = "AbortError";
  throw error;
}

async function readChatStream(response, assistantMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const payload = JSON.parse(trimmed);
      const chunk = applyChatPayload(payload, assistantMessage);
      if (chunk) {
        assistantMessage.content += chunk;
        updateAssistantMessage(assistantMessage);
        scrollToBottom();
      }
    }
  }

  if (buffer.trim()) {
    const payload = JSON.parse(buffer.trim());
    const chunk = applyChatPayload(payload, assistantMessage);
    if (chunk) {
      assistantMessage.content += chunk;
    }
  }
}

function applyChatPayload(payload, assistantMessage) {
  if (payload.error) {
    throw new Error(payload.error);
  }

  if (payload.done) {
    const metrics = createGenerationMetrics(payload);
    if (metrics) {
      assistantMessage.metrics = metrics;
    }
  }

  return payload.message?.content || "";
}

function createGenerationMetrics(payload) {
  const evalCount = Number(payload.eval_count || 0);
  const evalDuration = Number(payload.eval_duration || 0);

  if (!evalCount || !evalDuration) {
    return null;
  }

  const tokensPerSecond = evalCount / (evalDuration / 1_000_000_000);
  if (!Number.isFinite(tokensPerSecond)) {
    return null;
  }

  return {
    evalCount,
    evalDuration,
    tokensPerSecond
  };
}

async function fetchWebContext(query) {
  setConnection("checking", "Searching web", "DuckDuckGo HTML");

  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || "Web search failed.");
  }

  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];

  if (results.length === 0) {
    return null;
  }

  setConnection("online", "Web results added", `${results.length} results from DuckDuckGo`);

  return {
    query: payload.query || query,
    results
  };
}

function buildRequestMessages(previousMessages, prompt, webContext = null) {
  const systemPrompt = state.settings.systemPrompt.trim();
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  const memories = state.settings.memoryEnabled ? state.settings.memories : [];
  if (memories.length > 0) {
    messages.push({
      role: "system",
      content: `User memories and preferences saved locally. Treat these as standing user instructions and follow them unless the current message explicitly overrides them. Do not mention the memories unless helpful.\n\n${memories.map((memory) => `- ${memory.text}`).join("\n")}`
    });
  }

  if (webContext?.results?.length) {
    messages.push({
      role: "system",
      content: `Web search results from DuckDuckGo HTML for "${webContext.query}". Each result has a citation ID. When using web information, place citations immediately after the exact sentence or bullet they support using [[1]], [[2]], etc. Cite throughout the answer. Do not invent citation IDs and do not add a separate sources section.\n\n${webContext.results.map((result, index) => `[[${index + 1}]] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet || "No snippet"}`).join("\n\n")}`
    });
  }

  for (const message of previousMessages) {
    if (message.role === "user" || message.role === "assistant") {
      messages.push({ role: message.role, content: message.content });
    }
  }

  messages.push({ role: "user", content: prompt });
  return messages;
}

function updateAssistantMessage(message) {
  const node = document.querySelector(`[data-message-id="${message.id}"] .message-content`);
  if (!node) return;
  node.innerHTML = renderMarkdown(message.content, message.sources || []);
  node.classList.add("typing-cursor");
}

function stopStreaming() {
  if (state.abortController) {
    state.abortController.abort();
  }
}

function setStreaming(isStreaming) {
  state.isStreaming = isStreaming;
  elements.sendButton.classList.toggle("streaming", isStreaming);
  elements.sendButton.setAttribute("aria-label", isStreaming ? "Stop response" : "Send message");
  elements.modelButton.disabled = isStreaming;
  elements.refreshModelsButton.disabled = isStreaming;
  elements.webSearchButton.disabled = isStreaming;
  elements.deepResearchButton.disabled = isStreaming;

  for (const node of document.querySelectorAll(".typing-cursor")) {
    node.classList.toggle("typing-cursor", isStreaming);
  }
}

function renderAll() {
  renderSettings();
  renderConversations();
  renderMessages();
  renderModelPicker();
  renderWebSearchToggle();
  renderDeepResearchToggle();
  renderSidebarState();
  if (elements.graphDialog.open) {
    renderGraphDialog();
  }
}

function renderSidebarState() {
  document.querySelector(".app-shell")?.classList.toggle("sidebar-collapsed", Boolean(state.settings.sidebarCollapsed));
  elements.sidebarToggleButton.setAttribute("aria-expanded", String(!state.settings.sidebarCollapsed));
  elements.sidebarToggleButton.setAttribute(
    "aria-label",
    state.settings.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
  );
}

function renderSettings() {
  renderPresetButtons();
  elements.systemPrompt.value = state.settings.systemPrompt;
  elements.temperatureRange.value = String(state.settings.temperature);
  elements.temperatureValue.value = Number(state.settings.temperature).toFixed(1);
  elements.customBehaviorControls.hidden = state.settings.behaviorPreset !== "custom";
  elements.memoryToggle.checked = Boolean(state.settings.memoryEnabled);
  renderMemoryList();
}

function renderMemoryList() {
  elements.memoryList.innerHTML = "";
  elements.clearMemoriesButton.disabled = state.settings.memories.length === 0;

  if (state.settings.memories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = state.settings.memoryEnabled ? "No memories learned yet." : "Enable memories to learn from chats.";
    elements.memoryList.append(empty);
    return;
  }

  for (const memory of state.settings.memories) {
    const item = document.createElement("div");
    item.className = "memory-item";
    item.textContent = memory.text;
    elements.memoryList.append(item);
  }
}

function renderWebSearchToggle() {
  elements.webSearchButton.classList.toggle("active", Boolean(state.settings.webSearchEnabled));
  elements.webSearchButton.setAttribute("aria-pressed", String(Boolean(state.settings.webSearchEnabled)));
}

function renderDeepResearchToggle() {
  elements.deepResearchButton.classList.toggle("active", Boolean(state.settings.deepResearchEnabled));
  elements.deepResearchButton.setAttribute("aria-pressed", String(Boolean(state.settings.deepResearchEnabled)));
  elements.deepResearchButton.title = state.settings.deepResearchEnabled
    ? "Deep research on"
    : "Deep research";
}

function learnMemoriesFromPrompt(prompt) {
  if (!state.settings.memoryEnabled) return;

  const candidates = extractMemoryCandidates(prompt);
  if (candidates.length === 0) return;

  const existing = new Set(state.settings.memories.map((memory) => normalizeMemoryText(memory.text)));
  const now = Date.now();

  for (const candidate of candidates) {
    const normalized = normalizeMemoryText(candidate);
    if (!normalized || existing.has(normalized)) continue;

    state.settings.memories.unshift({
      id: crypto.randomUUID(),
      text: candidate,
      createdAt: now
    });
    existing.add(normalized);
  }

  state.settings.memories = state.settings.memories.slice(0, 24);
}

function extractMemoryCandidates(prompt) {
  const candidates = [];
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  const isQuestionPrompt = isQuestionLike(cleaned);
  const sentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const wholePromptPatterns = [
    {
      pattern: /\b(?:add|save|put|store)\s+(?:this\s+)?(?:to|in|as)\s+(?:my\s+)?memor(?:y|ies)\s*:?\s*(?:this\s*:?\s*)?(?:that\s+)?(.{4,220})/i,
      format: normalizeExplicitMemory
    },
    {
      pattern: /\b(?:remember|memorize|keep in mind)\s+(?:this\s*:?\s*)?(?:that\s+)?(.{4,220})/i,
      format: normalizeExplicitMemory
    },
    {
      pattern: /\b(?:make|create|save)\s+(?:a\s+)?memor(?:y|ies)\s+(?:that\s+)?(.{4,220})/i,
      format: normalizeExplicitMemory
    },
    {
      pattern: /\b(?:add|save|put|store)\s+(.{4,220}?)\s+(?:to|in|as)\s+(?:my\s+)?memor(?:y|ies)\b/i,
      format: normalizeExplicitMemory
    },
    {
      pattern: /\bmy name is\s+([^.!?]{2,80})/i,
      format: (value) => `User's name is ${cleanMemoryValue(value)}.`
    },
    {
      pattern: /\bcall me\s+([^.!?]{2,80})/i,
      format: (value) => `User prefers to be called ${cleanMemoryValue(value)}.`
    }
  ];

  const directInstruction = memoryInstructionFromText(cleaned);
  if (directInstruction && !isQuestionPrompt && /\b(?:remember|memory|memorize|preference|prefer)\b/i.test(cleaned)) {
    candidates.push(directInstruction);
  }

  for (const { pattern, format } of wholePromptPatterns) {
    const match = cleaned.match(pattern);
    if (match) candidates.push(ensurePeriod(format(match[1])));
  }

  const sentencePatterns = [
    {
      pattern: /\bi\s+(prefer|like|dislike|use|work at|work for|live in|am from)\s+([^.!?]{3,140})/i,
      format: formatPersonalStatement
    },
    {
      pattern: /\bmy favorite\s+([^.!?]{3,140})/i,
      format: (_verb, value) => `User's favorite ${cleanMemoryValue(value)}.`
    }
  ];

  for (const sentence of sentences) {
    if (isQuestionLike(sentence)) continue;

    for (const { pattern, format } of sentencePatterns) {
      const match = sentence.match(pattern);
      if (match) {
        candidates.push(ensurePeriod(format(match[1], match[2] || match[1])));
      }
    }
  }

  return [...new Set(candidates)]
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length >= 8 && candidate.length <= 180);
}

function memoryInstructionFromText(value) {
  const cleaned = cleanMemoryValue(value);

  if (/\b(?:do\s+not|don't|dont|not|never|avoid)\s+(?:use|using)?\s*emojis?\b|\bno\s+emojis?\b|\bwithout\s+emojis?\b/i.test(cleaned)) {
    return "User prefers responses without emojis.";
  }

  if (/\b(?:use|include)\s+emojis?\b/i.test(cleaned)) {
    return "User is okay with emoji in responses.";
  }

  return "";
}

function normalizeExplicitMemory(value) {
  const raw = cleanMemoryValue(value);
  if (isExplicitMemoryValueQuestion(raw)) return "";

  const cleaned = firstMemorySentence(raw.replace(/\?+$/, ""));
  if (!cleaned) return "";

  const directInstruction = memoryInstructionFromText(cleaned);
  if (directInstruction) return directInstruction;

  let match = cleaned.match(/^my name is\s+(.{2,80})$/i);
  if (match) return `User's name is ${cleanMemoryValue(match[1])}.`;

  match = cleaned.match(/^call me\s+(.{2,80})$/i);
  if (match) return `User prefers to be called ${cleanMemoryValue(match[1])}.`;

  match = cleaned.match(/^i\s+(prefer|like|dislike|use|work at|work for|live in|am from)\s+(.{3,160})$/i);
  if (match) return formatPersonalStatement(match[1], match[2]);

  match = cleaned.match(/^my favorite\s+(.{3,160})$/i);
  if (match) return `User's favorite ${cleanMemoryValue(match[1])}.`;

  match = cleaned.match(/^my\s+(.{2,80}?)\s+(is|are)\s+(.{2,140})$/i);
  if (match) {
    return `User's ${cleanMemoryValue(match[1])} ${match[2].toLowerCase()} ${cleanMemoryValue(match[3])}.`;
  }

  match = cleaned.match(/^(?:i am|i'm)\s+(.{3,140})$/i);
  if (match) return `User is ${cleanMemoryValue(match[1])}.`;

  match = cleaned.match(/^i\s+(?:do\s+not|don't|dont|never)\s+(.{3,140})$/i);
  if (match) return `User does not want to ${cleanMemoryValue(match[1])}.`;

  if (/^(?:always|never|avoid|do\s+not|don't|dont|you should|you should not|respond|answer|use|write)\b/i.test(cleaned)) {
    return `User instruction: ${capitalize(cleaned)}.`;
  }

  return `User asked to remember: ${cleaned}.`;
}

function firstMemorySentence(value) {
  return cleanMemoryValue(value).split(/[.!?]/)[0];
}

function isQuestionLike(value) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return (
    /\?\s*$/.test(cleaned) ||
    startsWithQuestionWord(cleaned)
  );
}

function isExplicitMemoryValueQuestion(value) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return /^(?:if|whether)\b/i.test(cleaned) || startsWithQuestionWord(cleaned);
}

function startsWithQuestionWord(value) {
  if (/^(?:do\s+not|don't|dont)\b/i.test(value)) return false;
  return /^(?:do|does|did|am|are|is|was|were|can|could|should|would|will|what|when|where|who|why|how|have|has|had)\b/i.test(value);
}

function formatPersonalStatement(verb, value) {
  const cleaned = cleanMemoryValue(value);

  switch (verb.toLowerCase()) {
    case "prefer":
      return `User prefers ${cleaned}.`;
    case "like":
      return `User likes ${cleaned}.`;
    case "dislike":
      return `User dislikes ${cleaned}.`;
    case "use":
      return `User uses ${cleaned}.`;
    case "work at":
      return `User works at ${cleaned}.`;
    case "work for":
      return `User works for ${cleaned}.`;
    case "live in":
      return `User lives in ${cleaned}.`;
    case "am from":
      return `User is from ${cleaned}.`;
    default:
      return `User ${verb.toLowerCase()} ${cleaned}.`;
  }
}

function cleanMemoryValue(value) {
  return value
    .replace(/^that\s+/i, "")
    .replace(/^this\s*:?\s*/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, "")
    .replace(/\s+(?:to|in|as)\s+(?:my\s+)?memor(?:y|ies)$/i, "")
    .replace(/\b(?:please|thanks|thank you)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(value) {
  const cleaned = value.trim();
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : cleaned;
}

function ensurePeriod(value) {
  const cleaned = value.trim();
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function normalizeMemoryText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMistakenEmojiQuestionMemory(value) {
  const normalized = normalizeMemoryText(value);
  return normalized === "user likes emoji" || normalized === "user likes emojis";
}

function renderPresetButtons() {
  elements.presetGrid.innerHTML = "";

  for (const preset of BEHAVIOR_PRESETS) {
    const button = document.createElement("button");
    button.className = `preset-button${preset.id === state.settings.behaviorPreset ? " active" : ""}`;
    button.type = "button";
    button.dataset.presetId = preset.id;
    button.role = "radio";
    button.setAttribute("aria-checked", String(preset.id === state.settings.behaviorPreset));
    button.innerHTML = `
      <span class="preset-name"></span>
      <span class="preset-description"></span>
    `;
    button.querySelector(".preset-name").textContent = preset.name;
    button.querySelector(".preset-description").textContent = preset.description;
    elements.presetGrid.append(button);
  }
}

function selectBehaviorPreset(presetId) {
  const preset = BEHAVIOR_PRESETS.find((item) => item.id === presetId) || BEHAVIOR_PRESETS[0];
  state.settings.behaviorPreset = preset.id;

  if (preset.id !== "custom") {
    state.settings.temperature = preset.temperature;
    state.settings.systemPrompt = preset.systemPrompt;
  }

  saveState();
  renderSettings();
}

function renderModelPicker() {
  elements.modelList.innerHTML = "";

  if (state.models.length === 0) {
    elements.modelLabel.textContent = state.settings.model || "No models found";
    const empty = document.createElement("div");
    empty.className = "model-empty";
    empty.textContent = "No local models found";
    elements.modelList.append(empty);
    elements.modelButton.disabled = state.isStreaming;
    return;
  }

  for (const model of state.models) {
    const option = document.createElement("button");
    option.className = `model-option${model.name === state.settings.model ? " active" : ""}`;
    option.type = "button";
    option.role = "option";
    option.setAttribute("aria-selected", String(model.name === state.settings.model));
    option.textContent = model.name;
    option.addEventListener("click", () => selectModel(model.name));
    elements.modelList.append(option);
  }

  if (state.settings.model && !state.models.some((model) => model.name === state.settings.model)) {
    const option = document.createElement("button");
    option.className = "model-option active";
    option.type = "button";
    option.role = "option";
    option.setAttribute("aria-selected", "true");
    option.textContent = state.settings.model;
    option.addEventListener("click", () => selectModel(state.settings.model));
    elements.modelList.prepend(option);
  }

  elements.modelLabel.textContent = state.settings.model || state.models[0]?.name || "No models found";
  elements.modelButton.disabled = state.isStreaming;
}

function selectModel(modelName) {
  state.settings.model = modelName;
  const conversation = getCurrentConversation();
  if (conversation) {
    conversation.model = state.settings.model;
    conversation.updatedAt = Date.now();
  }
  saveState();
  closeModelMenu();
  renderConversations();
  renderModelPicker();
}

function closeModelMenu() {
  elements.modelPicker.classList.remove("open");
  elements.modelButton.setAttribute("aria-expanded", "false");
}

function renderConversations() {
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  elements.conversationList.innerHTML = "";

  for (const conversation of sorted) {
    const row = document.createElement("div");
    row.className = `conversation-item${conversation.id === state.currentId ? " active" : ""}`;
    row.innerHTML = `
      <button class="conversation-main" type="button">
        <span class="conversation-title"></span>
        <span class="conversation-meta"></span>
      </button>
      <button class="conversation-graph" type="button" aria-label="Show conversation graph">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path d="M8.4 6.8 15.6 11.2" />
          <path d="M8.4 17.2 15.6 12.8" />
        </svg>
      </button>
      <button class="conversation-delete" type="button" aria-label="Delete chat">&times;</button>
    `;

    row.querySelector(".conversation-title").textContent = conversation.title || "New chat";
    row.querySelector(".conversation-meta").textContent = getConversationMeta(conversation);
    row.querySelector(".conversation-main").addEventListener("click", () => {
      state.currentId = conversation.id;
      if (conversation.model) {
        state.settings.model = conversation.model;
      }
      saveState();
      renderAll();
    });

    row.querySelector(".conversation-graph").addEventListener("click", () => {
      openGraphDialog(conversation.id);
    });

    row.querySelector(".conversation-delete").addEventListener("click", () => {
      deleteConversation(conversation.id);
    });

    elements.conversationList.append(row);
  }
}

function deleteConversation(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;

  const title = conversation.title || "this chat";
  if (!window.confirm(`Delete "${title}"?`)) return;

  if (state.isStreaming && conversationId === state.currentId) {
    stopStreaming();
  }

  state.conversations = state.conversations.filter((item) => item.id !== conversationId);

  if (conversationId === state.currentId) {
    const nextConversation = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    state.currentId = nextConversation?.id || createConversation().id;
  }

  saveState();
  renderAll();
}

function branchConversationFromMessage(messageId) {
  if (state.isStreaming) return;

  const sourceConversation = getCurrentConversation();
  if (!sourceConversation) return;

  const messageIndex = sourceConversation.messages.findIndex((message) => message.id === messageId);
  const sourceMessage = sourceConversation.messages[messageIndex];
  if (messageIndex < 0 || sourceMessage?.role !== "assistant") return;

  const now = Date.now();
  const branch = {
    id: crypto.randomUUID(),
    title: makeBranchTitle(sourceConversation.title),
    createdAt: now,
    updatedAt: now,
    model: sourceConversation.model || state.settings.model,
    parentId: sourceConversation.id,
    branchFromMessageId: sourceMessage.id,
    branchCreatedAt: now,
    messages: sourceConversation.messages.slice(0, messageIndex + 1).map(cloneMessageForBranch)
  };

  state.conversations.push(branch);
  state.currentId = branch.id;
  if (branch.model) {
    state.settings.model = branch.model;
  }

  saveState({ immediate: true });
  renderAll();
  scrollToBottom();
  elements.promptInput.focus();
  setConnection("online", "Branch created", sourceConversation.title || "New chat");
}

function cloneMessageForBranch(message) {
  const clone = JSON.parse(JSON.stringify(message));
  clone.id = crypto.randomUUID();
  return clone;
}

function makeBranchTitle(title) {
  const baseTitle = (title || "New chat").replace(/\s+/g, " ").trim();
  const suffix = " branch";
  const available = 64 - suffix.length;
  return `${baseTitle.slice(0, available).trim() || "New chat"}${suffix}`;
}

function openGraphDialog(focusId = state.currentId) {
  renderGraphDialog(focusId);
  elements.graphDialog.showModal();
}

function renderGraphDialog(focusId = state.currentId) {
  const rows = buildConversationGraphRows(focusId);
  elements.graphList.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "graph-empty";
    empty.textContent = "No conversations yet.";
    elements.graphList.append(empty);
    return;
  }

  const maxLane = rows.reduce((max, row) => Math.max(max, row.lane), 0);

  for (const row of rows) {
    const item = document.createElement("button");
    item.className = `graph-row${row.conversation.id === state.currentId ? " active" : ""}${row.conversation.id === focusId ? " focused" : ""}`;
    item.type = "button";
    item.style.setProperty("--row-color", row.color);
    item.style.setProperty("--lane-width", `${(maxLane + 1) * GRAPH_LANE_STEP + 40}px`);
    item.innerHTML = `
      <span class="graph-lane"></span>
      <span class="graph-copy">
        <span class="graph-title"></span>
        <span class="graph-meta"></span>
      </span>
    `;

    renderGraphLane(item.querySelector(".graph-lane"), row, maxLane);
    item.querySelector(".graph-title").textContent = row.conversation.title || "New chat";
    item.querySelector(".graph-meta").textContent = getConversationMeta(row.conversation);
    item.addEventListener("click", () => {
      state.currentId = row.conversation.id;
      if (row.conversation.model) {
        state.settings.model = row.conversation.model;
      }
      saveState();
      elements.graphDialog.close();
      renderAll();
    });
    elements.graphList.append(item);
  }
}

function renderGraphLane(lane, row, maxLane) {
  lane.innerHTML = "";

  for (let laneIndex = 0; laneIndex <= maxLane; laneIndex += 1) {
    const rail = document.createElement("span");
    rail.className = `graph-rail${laneIndex === row.lane ? " active" : ""}`;
    rail.style.left = `${GRAPH_LANE_BASE + laneIndex * GRAPH_LANE_STEP}px`;
    rail.style.background = row.laneColors[laneIndex] || "rgba(255, 255, 255, 0.18)";
    lane.append(rail);
  }

  if (row.parentLane >= 0 && row.parentLane !== row.lane) {
    const connector = document.createElement("span");
    connector.className = "graph-connector";
    const fromLane = Math.min(row.parentLane, row.lane);
    const toLane = Math.max(row.parentLane, row.lane);
    connector.style.left = `${GRAPH_LANE_BASE + fromLane * GRAPH_LANE_STEP}px`;
    connector.style.width = `${(toLane - fromLane) * GRAPH_LANE_STEP}px`;
    connector.style.background = row.color;
    lane.append(connector);
  }

  const node = document.createElement("span");
  node.className = "graph-node";
  node.style.left = `${GRAPH_LANE_BASE - 8 + row.lane * GRAPH_LANE_STEP}px`;
  node.style.borderColor = row.color;
  node.style.boxShadow = `0 0 0 2px #1d222b, 0 0 0 4px ${row.color}`;
  node.textContent = getConversationInitial(row.conversation);
  lane.append(node);
}

function buildConversationGraphRows(focusId = state.currentId) {
  const byId = new Map(state.conversations.map((conversation) => [conversation.id, conversation]));
  const focusConversation = byId.get(focusId) || byId.get(state.currentId) || state.conversations[0];
  if (!focusConversation) return [];

  const children = new Map();

  for (const conversation of state.conversations) {
    const parentId = conversation.parentId;
    if (parentId && byId.has(parentId)) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(conversation);
    }
  }

  const sortByCreatedAt = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  for (const branchList of children.values()) {
    branchList.sort(sortByCreatedAt);
  }

  const root = findFamilyRoot(focusConversation, byId);
  const laneById = new Map([[root.id, 0]]);
  let nextLane = 1;
  const family = [];
  const collect = (conversation, seen) => {
    if (seen.has(conversation.id)) return;
    const nextSeen = new Set(seen);
    nextSeen.add(conversation.id);
    family.push(conversation);

    for (const child of children.get(conversation.id) || []) {
      collect(child, nextSeen);
    }
  };

  collect(root, new Set());
  family.sort((a, b) => {
    if (a.id === root.id) return -1;
    if (b.id === root.id) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  return family.map((conversation) => {
    if (!laneById.has(conversation.id)) {
      laneById.set(conversation.id, nextLane);
      nextLane += 1;
    }

    const parent = conversation.parentId ? byId.get(conversation.parentId) : null;
    const lane = laneById.get(conversation.id) ?? 0;
    const parentLane = parent ? laneById.get(parent.id) ?? -1 : -1;

    return {
      conversation,
      lane,
      parentLane,
      color: getGraphColor(lane),
      laneColors: buildLaneColors(nextLane - 1)
    };
  });
}

function findFamilyRoot(conversation, byId) {
  let root = conversation;
  const seen = new Set();

  while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
    seen.add(root.id);
    root = byId.get(root.parentId);
  }

  return root;
}

function buildLaneColors(maxLane) {
  return Array.from({ length: maxLane + 1 }, (_item, lane) => getGraphColor(lane));
}

function getGraphColor(lane) {
  return GRAPH_COLORS[lane % GRAPH_COLORS.length];
}

function getConversationInitial(conversation) {
  const title = (conversation.title || "New chat").trim();
  return (title.match(/[a-z0-9]/i)?.[0] || "O").toUpperCase();
}

function getConversationMeta(conversation) {
  const model = conversation.model || state.settings.model || "Local model";
  const messageCount = Array.isArray(conversation.messages) ? conversation.messages.length : 0;
  const branchLabel = conversation.parentId ? "branch" : "root";
  return `${branchLabel} · ${model} · ${messageCount} message${messageCount === 1 ? "" : "s"}`;
}

function renderMessages() {
  const conversation = getCurrentConversation();
  elements.messages.innerHTML = "";

  if (!conversation || conversation.messages.length === 0) {
    renderEmptyState();
    return;
  }

  const lastAssistantMessage = [...conversation.messages].reverse().find((message) => message.role === "assistant");

  for (const message of conversation.messages) {
    const article = document.createElement("article");
    article.className = `message ${message.role}${message.error ? " error" : ""}`;
    article.dataset.messageId = message.id;

    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = message.role === "user" ? "You" : "Oaker";

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = message.research ? renderResearchGraph(message.research) : renderMarkdown(message.content, message.sources || []);

    if (state.isStreaming && message === conversation.messages.at(-1) && message.role === "assistant") {
      content.classList.add("typing-cursor");
    }

    article.append(role, content);

    if (message.id === lastAssistantMessage?.id && message.metrics) {
      const metrics = document.createElement("div");
      metrics.className = "message-metrics";
      metrics.textContent = formatGenerationMetrics(message.metrics);
      article.append(metrics);
    }

    if (message.role === "assistant" && !message.error) {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      const branchButton = document.createElement("button");
      branchButton.className = "message-action-button";
      branchButton.type = "button";
      branchButton.disabled = state.isStreaming;
      branchButton.setAttribute("aria-label", "Branch from this response");
      branchButton.title = "Branch from this response";
      branchButton.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path d="M8.4 6.8 15.6 11.2" />
          <path d="M8.4 17.2 15.6 12.8" />
        </svg>
      `;
      branchButton.addEventListener("click", () => branchConversationFromMessage(message.id));
      actions.append(branchButton);
      article.append(actions);
    }

    elements.messages.append(article);
  }
}

function formatGenerationMetrics(metrics) {
  return `${metrics.tokensPerSecond.toFixed(1)} tok/s · ${metrics.evalCount} tokens`;
}

function renderEmptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.innerHTML = `
    <div>
      <div class="empty-title">What should we make sense of?</div>
      <p class="empty-subtitle">A quiet workspace for local models, with your prompts and responses staying on this machine.</p>
    </div>
    <div class="prompt-grid"></div>
  `;

  const prompts = [
    "Summarize this note into decisions and open questions:",
    "Help me debug this error:",
    "Turn this rough idea into a plan:",
    "Compare these options with tradeoffs:"
  ];

  const grid = wrapper.querySelector(".prompt-grid");
  for (const prompt of prompts) {
    const button = document.createElement("button");
    button.className = "prompt-chip";
    button.type = "button";
    button.textContent = prompt;
    button.addEventListener("click", () => {
      elements.promptInput.value = prompt;
      autoGrow(elements.promptInput);
      elements.promptInput.focus();
    });
    grid.append(button);
  }

  elements.messages.append(wrapper);
}

function setConnection(status, title, detail) {
  elements.connectionCard.classList.toggle("online", status === "online");
  elements.connectionCard.classList.toggle("offline", status === "offline");
  elements.connectionTitle.textContent = title;
  elements.connectionDetail.textContent = detail;
}

async function loadState() {
  const localState = readLocalState();
  applyLoadedState(localState);

  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Unable to load persisted state");

    const serverState = await response.json();
    if (hasPersistedState(serverState)) {
      applyLoadedState(serverState);
      seedServerFromLocal = false;
    } else if (hasPersistedState(localState)) {
      seedServerFromLocal = true;
    }
  } catch {
    seedServerFromLocal = false;
  }

  normalizeSettings();
  normalizeConversations();
}

function readLocalState() {
  let conversations = [];
  let settings = {};

  try {
    const savedConversations = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    conversations = Array.isArray(savedConversations) ? savedConversations : [];
  } catch {
    conversations = [];
  }

  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    // Keep defaults when local storage has been manually edited.
  }

  return {
    conversations,
    settings,
    currentId: localStorage.getItem(`${STORAGE_KEY}.current`) || conversations[0]?.id || null
  };
}

function applyLoadedState(payload) {
  if (!payload) return;

  if (Array.isArray(payload.conversations)) {
    state.conversations = payload.conversations;
  }

  if (isPlainObject(payload.settings)) {
    state.settings = { ...state.settings, ...payload.settings };
  }

  state.currentId = payload.currentId || state.conversations[0]?.id || null;
}

function hasPersistedState(payload) {
  return Boolean(
    payload &&
      ((Array.isArray(payload.conversations) && payload.conversations.length > 0) ||
        payload.currentId ||
        (isPlainObject(payload.settings) && Object.keys(payload.settings).length > 0))
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettings() {
  const preset = BEHAVIOR_PRESETS.find((item) => item.id === state.settings.behaviorPreset);
  if (!preset) {
    const hasCustomPrompt = state.settings.systemPrompt && state.settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT;
    const hasCustomTemperature = Number(state.settings.temperature) !== 0.7;
    state.settings.behaviorPreset = hasCustomPrompt || hasCustomTemperature ? "custom" : "balanced";
  }

  if (state.settings.behaviorPreset !== "custom") {
    const activePreset = BEHAVIOR_PRESETS.find((item) => item.id === state.settings.behaviorPreset) || BEHAVIOR_PRESETS[0];
    state.settings.temperature = activePreset.temperature;
    state.settings.systemPrompt = activePreset.systemPrompt;
  }

  if (!Array.isArray(state.settings.memories)) {
    const legacyNotes = typeof state.settings.memoryNotes === "string" ? state.settings.memoryNotes : "";
    state.settings.memories = legacyNotes
      .split(/\n+/)
      .map((text) => text.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean)
      .map((text) => ({
        id: crypto.randomUUID(),
        text: ensurePeriod(text),
        createdAt: Date.now()
      }));
  }

  state.settings.memories = state.settings.memories.filter((memory) => !isMistakenEmojiQuestionMemory(memory.text || ""));
  state.settings.memoryEnabled = Boolean(state.settings.memoryEnabled);
  state.settings.deepResearchEnabled = Boolean(state.settings.deepResearchEnabled);
  state.settings.sidebarCollapsed = Boolean(state.settings.sidebarCollapsed);
  state.settings.webSearchEnabled = Boolean(state.settings.webSearchEnabled);
  if (state.settings.deepResearchEnabled) {
    state.settings.webSearchEnabled = true;
  }
  delete state.settings.memoryNotes;
}

function normalizeConversations() {
  state.conversations = state.conversations
    .filter((conversation) => conversation?.id)
    .map((conversation) => ({
      ...conversation,
      title: conversation.title || "New chat",
      createdAt: Number(conversation.createdAt || Date.now()),
      updatedAt: Number(conversation.updatedAt || conversation.createdAt || Date.now()),
      model: conversation.model || "",
      parentId: typeof conversation.parentId === "string" && conversation.parentId ? conversation.parentId : null,
      branchFromMessageId: typeof conversation.branchFromMessageId === "string" && conversation.branchFromMessageId ? conversation.branchFromMessageId : null,
      branchCreatedAt: conversation.branchCreatedAt ? Number(conversation.branchCreatedAt) : null,
      messages: Array.isArray(conversation.messages) ? conversation.messages : []
    }));
}

function saveState(options = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
  localStorage.setItem(`${STORAGE_KEY}.current`, state.currentId || "");
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));

  if (options.immediate) {
    void persistStateNow();
    return;
  }

  schedulePersistState();
}

function schedulePersistState() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void persistStateNow();
  }, 250);
}

async function persistStateNow() {
  window.clearTimeout(persistTimer);
  persistTimer = null;

  try {
    await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: state.settings,
        currentId: state.currentId,
        conversations: state.conversations
      })
    });
  } catch {
    // localStorage remains as a fallback when the local server is unavailable.
  }
}

function ensureConversation() {
  if (state.currentId && state.conversations.some((conversation) => conversation.id === state.currentId)) {
    return;
  }

  if (state.conversations.length > 0) {
    state.currentId = state.conversations[0].id;
    saveState();
    return;
  }

  const conversation = createConversation();
  state.currentId = conversation.id;
  saveState();
}

function createConversation() {
  const now = Date.now();
  const conversation = {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    model: state.settings.model,
    parentId: null,
    branchFromMessageId: null,
    branchCreatedAt: null,
    messages: []
  };
  state.conversations.push(conversation);
  return conversation;
}

function getCurrentConversation() {
  return state.conversations.find((conversation) => conversation.id === state.currentId) || null;
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now()
  };
}

function makeTitle(prompt) {
  return prompt
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "New chat";
}

function renderMarkdown(markdown, sources = []) {
  if (!markdown) return "";

  const parts = [];
  const codeBlockPattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockPattern.exec(markdown)) !== null) {
    parts.push(renderText(markdown.slice(lastIndex, match.index), sources));
    const code = escapeHtml(match[2]);
    parts.push(`<pre><code>${code}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }

  parts.push(renderText(markdown.slice(lastIndex), sources));
  return parts.join("");
}

function renderResearchGraph(research = {}) {
  const turns = Array.isArray(research.turns) ? research.turns : [];
  const sources = collectResearchSources(research);
  const stats = getResearchStats(research, turns, sources);
  const statusText = formatResearchStatus(research.status);
  const latestQuery = [...turns].reverse().find((turn) => turn.query)?.query || research.prompt || "Research";
  const graphHtml = buildResearchMap(research, turns);
  const reportLink = research.reportUrl
    ? `<a class="research-report-link" href="${escapeAttribute(research.reportUrl)}" target="_blank" rel="noreferrer">Open report</a>`
    : "";
  const errorBlock = research.error ? `<div class="research-error">${escapeHtml(research.error)}</div>` : "";

  const sourceHtml = sources.length
    ? sources.map((source) => {
      const host = getSourceHost(source.url);
      return `
        <a class="research-source-row ${escapeAttribute(source.status || "read")}" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">
          <span class="research-source-id">[${source.citationId}]</span>
          <span class="research-source-main">
            <span class="research-source-title">${escapeHtml(source.title || source.url)}</span>
            <span class="research-source-snippet">${escapeHtml(source.snippet || (source.status ? formatResearchStatus(source.status) : "Source indexed"))}</span>
          </span>
          <span class="research-source-host">${escapeHtml(host)}</span>
        </a>
      `;
    }).join("")
    : `<div class="research-source-empty">Awaiting sources</div>`;

  const notesHtml = turns
    .filter((turn) => turn.summary)
    .map((turn, index) => {
      const sourceList = collectResearchSources(research);
      const turnNumber = turn.number || index + 1;
      const title = turn.query || `Turn ${turnNumber}`;
      const stateLabel = formatResearchStatus(turn.status);
      return `
        <details class="research-note">
          <summary>
            <span>Turn ${turnNumber}</span>
            <span>${escapeHtml(stateLabel)}</span>
          </summary>
          <div class="research-note-query">${escapeHtml(title)}</div>
          <div class="research-note-content">${renderMarkdown(turn.summary, sourceList)}</div>
        </details>
      `;
    }).join("");

  const notesBlock = notesHtml ? `<div class="research-notes">${notesHtml}</div>` : "";

  return `
    <div class="research-run ${escapeAttribute(research.status || "running")}">
      <div class="research-map-shell">
        <div class="research-run-header">
          <div>
            <div class="research-kicker">Deep research</div>
            <div class="research-question">${escapeHtml(research.prompt || "Research")}</div>
            <div class="research-current-query">${escapeHtml(latestQuery)}</div>
          </div>
          <div class="research-status">
            <span class="research-status-dot" aria-hidden="true"></span>
            <span>${escapeHtml(statusText)}</span>
          </div>
        </div>
        <div class="research-map" aria-label="Deep research graph">
          ${graphHtml}
        </div>
        <div class="research-console">
          <span>sources ${formatResearchCount(stats.sources)}</span>
          <span>turns ${formatResearchCount(stats.turns)}/${formatResearchCount(stats.maxTurns)}</span>
          <span>read ${formatResearchCount(stats.readSites)}</span>
          <span>elapsed ${escapeHtml(formatResearchElapsed(research))}</span>
        </div>
      </div>
      <div class="research-source-ledger">${sourceHtml}</div>
      ${notesBlock}
      ${errorBlock}
      ${reportLink ? `<div class="research-report">${reportLink}</div>` : ""}
    </div>
  `;
}

function buildResearchMap(research, turns) {
  const hub = { x: 36, y: 58 };
  const lines = [];
  const nodes = [
    `<span class="research-map-node hub" style="--x: ${hub.x}; --y: ${hub.y}; --node-color: ${RESEARCH_GRAPH_COLORS[0]}" title="${escapeAttribute(research.prompt || "Research")}">R</span>`
  ];

  if (turns.length === 0) {
    return `
      <svg class="research-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
      ${nodes.join("")}
      <span class="research-map-hint">initializing</span>
    `;
  }

  turns.forEach((turn, turnIndex) => {
    const color = RESEARCH_GRAPH_COLORS[turnIndex % RESEARCH_GRAPH_COLORS.length];
    const turnPoint = getResearchTurnPoint(turnIndex, turns.length);
    const turnNumber = turn.number || turnIndex + 1;

    lines.push(renderResearchLine(hub, turnPoint, color, "turn"));
    nodes.push(
      `<span class="research-map-node turn ${escapeAttribute(turn.status || "running")}" style="--x: ${turnPoint.x}; --y: ${turnPoint.y}; --node-color: ${color}" title="${escapeAttribute(`Turn ${turnNumber}: ${turn.query || ""}`)}">T${turnNumber}</span>`
    );

    const sites = Array.isArray(turn.sites) ? turn.sites : [];
    sites.forEach((site, siteIndex) => {
      const sitePoint = getResearchSitePoint(turnPoint, siteIndex, sites.length, turnIndex);
      const label = site.citationId ? String(site.citationId) : String(siteIndex + 1);
      const status = site.status || "queued";

      lines.push(renderResearchLine(turnPoint, sitePoint, color, "source"));
      if (site.url) {
        nodes.push(
          `<a class="research-map-node source ${escapeAttribute(status)}" style="--x: ${sitePoint.x}; --y: ${sitePoint.y}; --node-color: ${color}" href="${escapeAttribute(site.url)}" target="_blank" rel="noreferrer" title="${escapeAttribute(site.title || site.url)}">${escapeHtml(label)}</a>`
        );
      } else {
        nodes.push(
          `<span class="research-map-node source ${escapeAttribute(status)}" style="--x: ${sitePoint.x}; --y: ${sitePoint.y}; --node-color: ${color}" title="${escapeAttribute(site.title || "Queued source")}">${escapeHtml(label)}</span>`
        );
      }
    });
  });

  return `
    <svg class="research-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      ${lines.join("")}
    </svg>
    ${nodes.join("")}
  `;
}

function renderResearchLine(from, to, color, type) {
  const midX = (from.x + to.x) / 2;
  return `<path class="research-map-line ${type}" style="--line-color: ${color}" d="M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}" />`;
}

function getResearchTurnPoint(index, total) {
  const fixed = [
    { x: 36, y: 24 },
    { x: 65, y: 36 },
    { x: 52, y: 78 },
    { x: 78, y: 64 }
  ];

  if (index < fixed.length) return fixed[index];

  const angle = -85 + (index * 260) / Math.max(total, 1);
  const radians = (angle * Math.PI) / 180;
  return {
    x: clampResearchPoint(50 + Math.cos(radians) * 32),
    y: clampResearchPoint(54 + Math.sin(radians) * 34)
  };
}

function getResearchSitePoint(turnPoint, siteIndex, siteCount, turnIndex) {
  const offsetSets = [
    [
      { x: 0, y: -15 },
      { x: 15, y: -9 },
      { x: 20, y: 3 },
      { x: 12, y: 13 }
    ],
    [
      { x: 15, y: -12 },
      { x: 23, y: -2 },
      { x: 17, y: 11 },
      { x: 4, y: 16 }
    ],
    [
      { x: -13, y: 12 },
      { x: 1, y: 18 },
      { x: 16, y: 11 },
      { x: 22, y: -2 }
    ],
    [
      { x: 12, y: -14 },
      { x: 22, y: -4 },
      { x: 18, y: 10 },
      { x: 4, y: 16 }
    ]
  ];
  const offsets = offsetSets[turnIndex % offsetSets.length];
  const fallbackAngle = (-60 + (siteIndex * 120) / Math.max(siteCount - 1, 1) + turnIndex * 17) * (Math.PI / 180);
  const fallback = {
    x: Math.cos(fallbackAngle) * 20,
    y: Math.sin(fallbackAngle) * 16
  };
  const offset = offsets[siteIndex] || fallback;

  return {
    x: clampResearchPoint(turnPoint.x + offset.x),
    y: clampResearchPoint(turnPoint.y + offset.y)
  };
}

function getResearchStats(research, turns, sources) {
  const sites = turns.flatMap((turn) => Array.isArray(turn.sites) ? turn.sites : []);
  return {
    sources: sources.length,
    turns: turns.length,
    maxTurns: DEEP_RESEARCH_MAX_TURNS,
    readSites: sites.filter((site) => site.status === "read" || site.status === "skimmed").length,
    status: research.status || "running"
  };
}

function formatResearchElapsed(research) {
  const startedAt = Number(research.startedAt || 0);
  if (!startedAt) return "00:00";

  const finishedAt = Number(research.finishedAt || 0);
  const end = finishedAt || Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatResearchCount(value) {
  return String(Number(value) || 0).padStart(2, "0");
}

function clampResearchPoint(value) {
  return Math.max(7, Math.min(93, Math.round(value * 10) / 10));
}

function formatResearchStatus(status) {
  const labels = {
    running: "Running",
    searching: "Searching",
    thinking: "Thinking",
    writing: "Writing report",
    complete: "Complete",
    stopped: "Stopped",
    error: "Error",
    queued: "Queued",
    reading: "Reading",
    read: "Read",
    skimmed: "Skimmed",
    done: "Done"
  };
  return labels[status] || "Running";
}

function formatResearchSiteStatus(site) {
  if (site.error) return site.error;
  if (site.status === "read") return "Page read";
  if (site.status === "skimmed") return "Snippet used";
  if (site.status === "reading") return "Reading page";
  if (site.status === "error") return "Could not read page";
  return site.snippet || "Queued";
}

function renderText(text, sources = []) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return "";

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length + 1;
        return `<h${level}>${renderInline(heading[2], sources)}</h${level}>`;
      }

      if (/^[-*] /m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter(Boolean)
          .map((line) => `<li>${renderInline(line.replace(/^[-*]\s+/, ""), sources)}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (/^\d+\. /m.test(trimmed)) {
        const items = trimmed
          .split("\n")
          .filter(Boolean)
          .map((line) => `<li>${renderInline(line.replace(/^\d+\.\s+/, ""), sources)}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${renderInline(trimmed, sources).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function renderInline(text, sources = []) {
  return text
    .replace(/\[\[(\d+)\]\]|\[(\d+)\]/g, (_match, doubleId, singleId) => renderCitationChip(Number(doubleId || singleId), sources))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
}

function renderCitationChip(index, sources) {
  const source = sources[index - 1];
  if (!source?.url) {
    return `<span class="citation-chip missing">[${index}]</span>`;
  }

  const host = getSourceHost(source.url);
  const label = host || source.title || `Source ${index}`;
  const initial = label[0]?.toUpperCase() || index;

  return `<a class="citation-chip" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer" title="${escapeAttribute(source.title || source.url)}"><span class="citation-icon">${escapeHtml(initial)}</span>${escapeHtml(label)}</a>`;
}

function getSourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeAttribute(value) {
  return escapeHtml(String(value)).replace(/`/g, "&#096;");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
}

async function readError(response) {
  try {
    const payload = await response.json();
    return payload.error || payload.detail || JSON.stringify(payload);
  } catch {
    return response.statusText;
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  const text = String(value).trim();

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return null;
    }
  }
}
