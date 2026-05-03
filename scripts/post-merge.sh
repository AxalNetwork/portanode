#!/bin/bash
set -e

bundle install
npm install --no-audit --no-fund
npx tailwindcss -i ./assets/css/tailwind.src.css -o ./assets/css/tailwind.css --minify

# Build the configurator + customer-portal Svelte bundles so the static site
# always ships fresh /assets/configurator/* and /assets/account/* artifacts.
( cd configurator && npm install --no-audit --no-fund && npm run build )
( cd account && npm install --no-audit --no-fund && npm run build )
