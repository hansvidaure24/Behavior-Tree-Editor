# Security

## Reporting a vulnerability

If you find a security issue, please email **hansvidaure24@gmail.com** instead of opening a public issue. I'll acknowledge within 48 hours.

## Security model

- **No server required.** The editor runs entirely in the browser with no backend.
- **Local storage only.** Trees are saved to IndexedDB or written directly to disk via the File System Access API.
- **AI generation is local.** If enabled, Ollama runs on `localhost` — prompts never leave the machine.
- **No external network calls** beyond what the browser needs to load the page.
