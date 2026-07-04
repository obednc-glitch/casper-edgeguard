# Casper EdgeGuard

**Multi-agent, on-device RWA compliance system, anchored on Casper.**

Two AI agents run on a phone, cross-check each other, and anchor the
result on Casper Testnet - producing a proof anyone can independently
verify, instead of a private PDF you have to take on trust.

**[Watch the demo video](#)** - *(add your video link here before
submitting)*

---

## What it does

1. **EdgeGuard** (agent 1) checks an asset's compliance: live OFAC
   sanctions screening, jurisdiction risk, AML/KYC match.
2. **RiskOracle** (agent 2) independently re-verifies the valuation using
   live market data, with its own separate Casper identity.
3. The two agents' results are cross-checked, signed, and anchored on
   Casper Testnet - a real transaction, verifiable on
   [CSPR.live](https://testnet.cspr.live).
4. The verdict is translated into plain language first, with the full
   technical scorecard available underneath for anyone who wants it.

---

## What's real vs. illustrative

Honesty about what's actually working matters more to us than looking
finished. Here's the real state:

| Feature | Status |
|---|---|
| Multi-agent workflow (EdgeGuard + RiskOracle) | **Real** - two distinct, independently funded Casper identities |
| Casper Testnet transaction (on-chain anchor) | **Real** - signed, submitted, verifiable on CSPR.live |
| Sanctions screening (online) | **Real** - live fetch from Treasury's OFAC Sanctions List Service |
| Sanctions screening (offline) | **Real** - bundled snapshot of the same OFAC data, screened entirely on-device, zero network calls |
| AI risk scoring | Real LLM call (Groq/Llama 3) - useful signal, not regulatory-grade, and labeled as such |
| Live market price feed | **Real** - CoinGecko API |
| MCP tool exposure | **Real** - `check_compliance`, `sanctions_screen`, `get_agent_card` callable by any MCP client |
| x402 payment flow | Real client/server code; full settlement needs a facilitator URL not yet obtained |
| Smart contract (on-chain compliance registry) | **Real**, privacy-preserving design - see below |
| Asset valuations | **Mixed** - 432 Park Ave NYC is a verified real sale (public record, closed 2023); the other 5 presets are clearly labeled "ILLUSTRATIVE" in the UI itself |

---

## A deliberate design decision: what we chose *not* to put on-chain

Early in this project the on-chain anchor stored the full compliance
verdict - score, sanctions result, everything - directly on Casper,
publicly readable by anyone.

We changed that.

A public, permanent ledger is the wrong place for compliance data tied to
real people and real assets. It conflicts with basic data-deletion rights
(GDPR's "right to be forgotten," for one) - there's a specific irony in a
*compliance* tool creating its own compliance liability. It also leaks
business intelligence: anyone reading the chain could see exactly which
assets and how much volume a platform is processing.

**So the deployed contract stores only a hash-commitment of the report** -
not the verdict itself. The full compliance detail (score, sanctions
result, jurisdiction flags) stays in the access-controlled backend and PDF
report, exactly like real production data should. Anyone who already holds
a copy of the actual report - the asset owner, a regulator, an auditor
you've shared it with - can hash it themselves and compare it against the
on-chain commitment to verify it's authentic and unaltered. The chain
proves *a check happened and hasn't been tampered with*, without ever
exposing what the check found to an arbitrary public reader.

The contract also restricts write access to the agent's own signing key -
without that, anyone could write fake "compliance records" referencing
someone else's asset.

See `contracts/compliance-registry-raw/src/main.rs` for the implementation
and full rationale in the code comments.

---

## Architecture

```
casper-edgeguard/          Expo/React Native app (runs via Termux on Android)
  App.js                   Main UI + multi-agent workflow
  sanctionsLocal.js         On-device OFAC fuzzy matcher (zero network calls)
  assets/sdn-snapshot.json  Bundled OFAC SDN snapshot for offline screening

edgeguard-server/          Node backend (also runs in Termux, separate process)
  server/index.js          Express API - all endpoints, CORS-enabled
  server/anchor.js          Real signed Casper Testnet transfer + RPC fallback
  server/contractAnchor.js  Hash-commitment writes to the deployed contract
  server/ofacCheck.js       Live OFAC SDN fetch + cache + fuzzy match
  server/riskScore.js       Groq LLM proxy (API key never ships to the app)
  server/mcp.js             MCP server - exposes compliance check as a tool
  server/x402.js            Casper x402 client + Express middleware
  server/pdfReport.js       PDF compliance report generator
  contracts/
    compliance-registry-raw/   Casper smart contract (no Odra) - see above
    compliance-registry/       Earlier Odra-based attempt (kept for reference;
                                hit an upstream cargo-odra/wasm build
                                compatibility issue during CI - see its
                                own README.md for the investigation)
```

---

## Running it

Both the app and the backend run in Termux on an Android phone - no
desktop required. Full setup instructions, including the two-agent-key
requirement and troubleshooting for issues we actually hit while building
this, are in `edgeguard-server/README-INTEGRATION.md`.

Quick start:
```bash
# Backend
cd edgeguard-server
npm install
npm run keygen                              # EdgeGuard's identity
EDGEGUARD_KEYS_DIR=./keys-riskoracle npm run keygen   # RiskOracle's identity - must differ from EdgeGuard's
# fund both at https://testnet.cspr.live/tools/faucet
npm start

# App (separate terminal/pane)
cd ../casper-edgeguard
npm start
# press w for web view
```

---

## Buildathon links

- Repo: https://github.com/obednc-glitch/casper-edgeguard
- Demo video: *(add link before submitting)*
- DoraHacks submission: *(add link before submitting)*
