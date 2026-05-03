#!/bin/bash
set -e

bundle install
npm install --no-audit --no-fund
npx tailwindcss -i ./assets/css/tailwind.src.css -o ./assets/css/tailwind.css --minify
