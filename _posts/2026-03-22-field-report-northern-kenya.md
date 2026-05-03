---
title: "Field report: Off-Grid Clinic, northern Kenya"
subtitle: Six months of operation, 14,000 patients, and a few things we got wrong.
date: 2026-03-22
category: Field Reports
author: M. Otieno
---

In September 2025 we deployed an Off-Grid Clinic stack with a Kenyan health-ministry partner in Marsabit County. Six months in, here's what the data say and what surprised us.

## The numbers

- **14,217 patient visits** across primary care and maternal health.
- **99.4% uptime** on the stack overall; the longest single outage was 47 minutes (Volt firmware bug, since patched).
- **Zero cold-chain breaks** through eleven full days of grid loss in February.

## What we got wrong

- **Dust ingress on the HEPA pre-filter** was 3× our model. We're shipping a coarser pre-stage on Care v1.2.
- **Local language pack on the telemedicine cart** didn't include Borana. Now does, with twelve more East African languages added to the default profile.
- **Coupling torque drift** on the Flow-to-Care fluid line in extreme thermal cycles. Resolved with a serviceable double-seal kit; retrofit is free for any clinic deployed before March.

## What's next

We're deploying two more clinics in the same county in Q3. The data from this one is informing the spec for a 14-clinic regional contract we're bidding on with the same partner.
