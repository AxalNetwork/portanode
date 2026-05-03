---
slug: satellite-ground-station
title: Satellite Ground Station
order: 6
tier: T2
summary: Container-scale teleport for LEO and MEO operators — RF shelter, edge compute, and full autonomy for sites well off the grid.
price: "734,000"
price_unit: USD
footprint: "3 modules · 60 m²"
lead_time: "9 wks"
capacity: "8x antenna RF chains"
modules:
  - slug: core
    name: AXAL Core
    qty: 1
  - slug: volt
    name: Volt
    qty: 2
  - slug: shell
    name: Shell (RF-shielded)
    qty: 1
bom:
  - label: Hardware
    value: "$610,000"
  - label: RF survey + integration
    value: "$48,000"
  - label: Sea freight (tier 2)
    value: "$36,000"
  - label: First-year remote support
    value: "$40,000"
  - label: Total turnkey
    value: "$734,000"
---

Satellite Ground Station is the AXAL stack we built with a constellation operator. It can act as a teleport node, a TT&C station, or a regional gateway.

## Why this stack

- RF-shielded Shell with cable trays for 8 antenna chains.
- Volt + grid-tie keeps the modems warm through grid faults — critical for SLA-bound services.
- Core's compute room runs the operator's edge stack and modem orchestrator locally.
