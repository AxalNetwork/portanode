---
title: "Engineering deep-dive: turning a Shell into a BSL-2 lab"
subtitle: HEPA selection, negative pressure, and the validation paperwork nobody warns you about.
date: 2025-12-08
category: Engineering
author: S. Lindqvist
---

The Shell module ships in five layouts. The lab layout is the one we get the most engineering questions about, so this post walks through how we built it and what we learned validating it.

## The constraints

- **BSL-2 ready** (not BSL-3 — we'll get there in 2027).
- **Containerised** — fits in 20 ft and ships at standard ISO weight.
- **Field-validatable** — a customer's QA team needs to be able to verify the lab on site without the original commissioning crew.

## What's in the lab Shell

- Two-stage HEPA HVAC with H14 final, polished by UV-C in the return.
- **Negative-pressure mode** selectable in axalOS, validated to −15 Pa relative to ambient.
- Stainless casework, eyewash, emergency shower rough-in, and a fume-hood option pre-piped.
- A complete document pack: P&IDs, controls drawings, validation protocols, and a sample IQ/OQ/PQ template.

## The paperwork is half the work

The trap with field labs is that the paperwork is what regulators actually inspect. We've put more engineering hours into the validation document templates than into the HEPA stack. If you're procuring a lab, ask whoever you're buying from to show you that document pack — if they hesitate, walk.
