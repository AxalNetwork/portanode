---
title: "Why the interconnect is the most important part of AXAL"
subtitle: A note on why we spent two years on couplings before we shipped a single Volt.
date: 2026-04-15
category: Engineering
author: H. Ahmadi
---

People ask why AXAL took two years to ship its first module. The honest answer is that we spent most of that time on the interconnect — the strip of stainless and copper down the long edge of every module that carries power, data, water, and biogas.

## The shape of the problem

If your modules don't share a common interconnect, you don't have a system. You have a catalog of expensive single-purpose appliances. The problem is that "share a common interconnect" is fractally hard once you allow real-world tolerances, real shipping abuse, and real climates.

## The choices that mattered

- **800 V DC bus** instead of three-phase AC. Avoids 50/60 Hz mismatch globally, halves copper mass, and lets Volt's grid-forming inverter do its job.
- **Single fluid manifold** with quick-connect couplings rated for 10,000 cycles. We bought the exact connector the offshore-oil industry uses and qualified it for our pressures.
- **CAN-FD over twisted pair** for module control plane, plus 10 GbE on a parallel optical bus for data.

The result is that any AXAL module mates with any other in roughly four minutes per coupling, in any weather, with one technician. That's the system.
