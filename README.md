# Oaker Local Chat

A small local-first chat UI for models served by Ollama. It uses a dependency-free Node server to serve the interface and proxy streaming chat requests to Ollama.

## Run

1. Start Ollama and make sure you have at least one model:

   ```bash
   ollama pull llama3.2
   ollama serve
   ```

2. Start the web app:

   ```bash
   node server.js
   ```

3. Open [http://localhost:3000](http://localhost:3000).

If `npm` is available, `npm run dev` does the same thing.

## Configuration

The app points at local Ollama by default:

```bash
OLLAMA_HOST=http://127.0.0.1:11434 node server.js
```

Use a different UI port with:

```bash
PORT=4173 node server.js
```

Conversations, settings, branches, memories, and generation metrics are stored in a local SQLite database at `oaker.sqlite`.
