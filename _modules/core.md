---
slug: core
title: AXAL Core
order: 1
tagline: Command, comms, and orchestration for the whole stack.
summary: Every AXAL deployment starts with Core — the brains that orchestrate power, manage data flows, and connect your stack to the outside world over satellite, LTE, or fibre.
specs:
  - label: Compute
    value: "AMD EPYC 16-core + 64 GB ECC"
  - label: Storage
    value: "8 TB NVMe RAID-1"
  - label: Uplink
    value: "Starlink + 5G + 1 GbE WAN"
  - label: Orchestrator
    value: "axalOS 2.x (Linux LTS)"
  - label: Controllers
    value: "BMS, SCADA, building-mgmt"
  - label: Operating range
    value: "−40 °C to +55 °C"
  - label: Ingress
    value: "IP66"
  - label: Certifications
    value: "CE, UL, FCC Part 15"
inside:
  - label: 01
    value: Hardened edge server with redundant PSUs and a 2 kWh UPS that gives the stack a graceful shutdown window.
  - label: 02
    value: Triple-uplink router (Starlink + carrier 5G + RJ-45) with automatic failover and per-link traffic shaping.
  - label: 03
    value: SCADA / BMS controller wired to every module's CAN-bus port — no extra cabling at the site.
  - label: 04
    value: Operator console with hardened touchscreen, plus mobile and web dashboards for remote teams.
compat:
  - volt
  - flow
  - grow
  - shell
  - cycle
  - care
  - learn
use_cases:
  - industry: Research
    title: Antarctic field station
    body: Core handles satellite uplink, runs experiment data pipelines, and keeps the stack alive through 6-month winters.
  - industry: Defense
    title: Forward operating base
    body: Encrypted mesh, MIL-STD shock isolation, and a SCIF-ready compute room in 10 ft of container space.
  - industry: Agriculture
    title: Co-op data hub
    body: Aggregates yield data from 40 Grow modules across a region, ships analytics to growers' phones over 4G.
---

The AXAL Core is the only module every stack requires. Without it, your other modules are excellent industrial appliances. With it, they're a coordinated system that runs itself.

## Designed for hands-off operations

Core's axalOS image is signed, minimal, and self-healing. Updates flow over the air through a staged rollout, and any module can be rolled back independently if a release misbehaves on your site.
