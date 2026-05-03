# Snowlake Jekyll Theme

## Project Overview
This is a Jekyll static website using the Snowlake theme (v2). It's a multi-purpose Jekyll theme with blog, portfolio, shop, and service page support.

## Architecture
- **Framework**: Jekyll 4.3.x (Ruby static site generator)
- **Language**: Ruby
- **Package Manager**: Bundler (gems stored in `vendor/bundle`)

## Key Plugins
- `jekyll-feed` - RSS/Atom feed generation
- `jekyll-paginate-v2` - Advanced pagination
- `jekyll-archives` - Tag and category archives

## Directory Structure
- `_posts/` - Blog posts
- `_portfolio/` - Portfolio items
- `_shop_items/` - Shop/product items
- `_authors/` - Author profiles
- `_layouts/` - Page layout templates
- `_includes/` - Reusable template partials
- `_data/` - Site data files (YAML)
- `assets/` - CSS, JS, images
- `_site/` - Built output (generated, not committed)
- `vendor/bundle/` - Installed Ruby gems

## Collections
- `authors` - Blog post authors
- `shop_items` - Shop products (permalink: `/shop/:name`)
- `portfolio` - Portfolio pieces (permalink: `/portfolio/:name`)

## Development
- **Run**: `bundle exec jekyll serve --host 0.0.0.0 --port 5000 --livereload`
- **Build**: `bundle exec jekyll build`
- **Port**: 5000

## Deployment
- **Type**: Static site
- **Build command**: `bundle exec jekyll build`
- **Public directory**: `_site`
