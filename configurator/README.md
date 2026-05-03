# AXAL Configurator

Svelte + Vite app embedded into the Jekyll page at `/configure/`.

## Build

```bash
cd configurator
npm install
npm run build
```

Outputs `assets/configurator/bundle.js`, `assets/configurator/bundle.css`,
and a lazy-loaded three.js chunk. The Jekyll page at `pages/configure.html`
references these directly.

A copy of `_data/catalog.json` (and `stacks.json`) is also written to
`assets/configurator/` so the app can fetch it client-side without going
through the Jekyll Liquid pipeline.

## Architecture

- `src/main.js` — mount entry, finds `#axal-configurator` and boots the app
- `src/App.svelte` — three-column shell (modules / canvas / specs)
- `src/stores/config.js` — Svelte stores for selected modules, options, region
- `src/lib/constraints.js` — pure constraint engine: requires/excludes,
  region availability, power balance, footprint vs site size
- `src/lib/persistence.js` — short-id generator, localStorage save, stub POST
  to `/api/configs`, share URL building
- `src/lib/catalog.js` — catalog fetcher and currency/number formatters
- `src/components/Canvas3D.svelte` — three.js stack preview, lazy-imported,
  with isometric SVG fallback for low-end devices / no-WebGL
- `src/components/ModulePicker.svelte` — left rail
- `src/components/OptionModal.svelte` — per-module options modal
- `src/components/SpecLedger.svelte` — right rail with totals, region picker,
  save/share/download buttons
- `src/components/StackList.svelte` — list of selected modules + qty controls

## Deep-link support

- `/configure/?c=cfg_xxx` — resume saved configuration
- `/configure/?stack=research-lab` — preload a reference stack
- `/configure/?module=core` — start with a specific module
