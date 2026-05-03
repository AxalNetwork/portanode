# Self-hosted fonts

These variable woff2 files are committed to the repo and served from
`/assets/fonts/`. They're declared in `assets/css/tailwind.src.css` with
`font-display: swap` and preloaded in `_includes/head.html`.

| File | Family | License |
| --- | --- | --- |
| `Geist-Variable.woff2` | Geist | SIL OFL 1.1 (Vercel) |
| `GeistMono-Variable.woff2` | Geist Mono | SIL OFL 1.1 (Vercel) |
| `Inter-Variable.woff2` | Inter | SIL OFL 1.1 (Rasmus Andersson) |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono | SIL OFL 1.1 (JetBrains) |

To refresh from upstream, re-pull from jsDelivr:

```bash
curl -sSL -o Geist-Variable.woff2          https://cdn.jsdelivr.net/npm/geist@latest/dist/fonts/geist-sans/Geist-Variable.woff2
curl -sSL -o GeistMono-Variable.woff2      https://cdn.jsdelivr.net/npm/geist@latest/dist/fonts/geist-mono/GeistMono-Variable.woff2
curl -sSL -o Inter-Variable.woff2          https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@latest/files/inter-latin-wght-normal.woff2
curl -sSL -o JetBrainsMono-Variable.woff2  https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@latest/files/jetbrains-mono-latin-wght-normal.woff2
```
