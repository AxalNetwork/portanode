# AXAL — Modular Infrastructure eCommerce

## Project Overview
AXAL is a Jekyll + Tailwind static site for a modular infrastructure eCommerce
platform. Customers browse modules, compose them into stacks, configure, and
purchase. This repo currently contains the brand foundation and theme shell.

## Architecture
- **Framework**: Jekyll 4.3.x (Ruby static site generator)
- **CSS**: Tailwind CSS 3 (compiled via npm/`tailwindcss` CLI)
- **Hosting target**: Static (GitHub Pages / Cloudflare Pages compatible)

## Brand
- Purple palette: `#6B21A8`, `#A855F7`, `#C084FC`
- Off-black ink `#0B0B0F`, paper white `#FAFAF7`, technical gray `#6B7280`
- Typography: Geist / Inter (sans), JetBrains Mono (mono), self-host via
  `assets/fonts/` (see `assets/fonts/README.md`)

## Plugins
- `jekyll-feed`, `jekyll-seo-tag`, `jekyll-sitemap`, `jekyll-redirect-from`,
  `jekyll-include-cache`

## Configurator
Interactive Svelte + Vite app at `/configure/`. Source in `configurator/`,
build outputs `assets/configurator/bundle.{js,css}` plus a lazy three.js
chunk and copies of `catalog.json` / `stacks.json`. Build with:
```bash
cd configurator && npm install && npm run build
```
Three-column shell, click-a-module option modal, pure constraint engine
(requires/excludes/region/power/footprint), short-id save+share via
localStorage stub, deep-link entries `?c=`, `?stack=`, `?module=`.

## Catalog data
Canonical product data lives in `_data/`:
- `catalog.json` — 8 modules with `basePrice`, `dimensions`, `weight`, `power`,
  `leadTimeWeeks`, `regions[]`, `interconnects[]`, and grouped `options[]`
  (each with `priceDelta`, `requires[]`, `excludes[]`)
- `stacks.json` — 7 launch stacks pointing at module ids + default options
- `promotions.json` — placeholder array for regional / launch promos
- `catalog.schema.json` — JSON Schema validating `catalog.json`

Validate locally: `npm run validate:catalog` (also runs as `prebuild:css`
hook). Module/stack pages and listing cards read prices and option summaries
from these files via `_includes/catalog-price.html`,
`_includes/stack-price.html`, and `_includes/module-options.html`. No prices
are hard-coded in module/stack markdown frontmatter.

## Collections
- `_modules/` → `/modules/:slug/` — 8 modules (Core, Volt, Flow, Grow, Shell, Cycle, Care, Learn)
- `_stacks/` → `/stacks/:slug/` — 7 reference stacks
- `_use_cases/` → `/use-cases/:slug/` — 9 industry pages
- `_specs/` (data only, not output)
- `_legal/` → `/legal/:slug/` — 5 legal docs (terms-of-sale, privacy, refund, export, cookies)
- `_posts/` — 6 launch blog posts

## Static pages (in `pages/`)
`/modules/`, `/stacks/`, `/use-cases/`, `/specs/` (gated download form),
`/sustainability/`, `/shipping/` (SVG world tier map), `/financing/`,
`/about/`, `/blog/`

## Layouts
`default.html` → `page.html` / `module.html` / `stack.html` / `post.html` /
`legal.html`

## Includes
`head.html`, `header.html`, `footer.html`, `cta.html`, `module-card.html`,
`stack-card.html`, `spec-table.html`, `price-display.html`, `cookie-banner.html`,
`analytics.html`, `logo.html`

## Assets
- `assets/css/tailwind.src.css` — Tailwind source (with `@layer components`)
- `assets/css/tailwind.css` — compiled, **committed** for static hosting
- `assets/logos/` — SVG logo variants (lockup, wordmark, monogram, knockout, favicon)
- `assets/fonts/` — drop self-hosted woff2 files here
- `scripts/optimize-images.sh` — `cwebp` / `avifenc` / `svgo` helper

## Development
```bash
bundle install                 # one-time
npm install                    # one-time
npm run watch:css              # rebuild Tailwind on change
bundle exec jekyll serve --host 0.0.0.0 --port 5000 --livereload
```

After changing template classes, rebuild the CSS:
```bash
npm run build:css
```

## Deployment
- **Type**: Static site
- **Build**: `npm run build:css && bundle exec jekyll build`
- **Public dir**: `_site`
- Port: 5000 (dev)
