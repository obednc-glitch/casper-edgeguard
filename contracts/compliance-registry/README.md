# ComplianceRegistry — Odra Smart Contract

This is the "cool" upgrade: instead of anchoring each compliance check as a
generic signed transfer, this writes the actual verdict into a real Casper
smart contract's on-chain storage. Anyone (a judge, another agent, CSPR.live)
can query `get_check(asset_hash)` directly from the contract afterward.

## The honest constraint

Compiling Rust → WASM needs a full Rust + `wasm32-unknown-unknown` toolchain.
That's heavy to install and slow to run on a phone in Termux — realistically
a multi-hour risk, not a quick `pkg install`. So this is built differently:

**The WASM compiles on GitHub Actions (free), not on your phone.** You never
install Rust locally. Termux only needs Node (already installed) to deploy
the compiled `.wasm` and call the contract afterward.

## Steps

**Important: use `casper-edgeguard`, not `edgeguard-server`.** `edgeguard-server`
was never set up as its own git repo — your actual GitHub-linked project is
`casper-edgeguard`. Move these files there first:

```bash
cp -r ~/edgeguard-server/contracts ~/casper-edgeguard/
cp -r ~/edgeguard-server/.github ~/casper-edgeguard/
cd ~/casper-edgeguard
git remote -v   # confirm this actually has a GitHub remote configured
git status
```

1. **Push it:**
   ```bash
   git add contracts/ .github/
   git commit -m "Add ComplianceRegistry Odra contract"
   git push
   ```
   If this is blocked by GitHub secret-scanning (the old Groq key issue from
   early in the project), the error output includes a URL like
   `https://github.com/.../security/secret-scanning/unblock-secret/...`.
   Since that key is already dead/rotated and your current key lives only
   in `edgeguard-server/.env` (never committed), opening that link and
   clicking "allow" is safe — it's unblocking a historical, already-revoked
   secret, not exposing a live one. If push fails for a different reason,
   paste the exact error text rather than guessing at a fix.

2. **Watch the build.** Go to your repo → Actions tab → "Build Odra Contract
   WASM" should start automatically (or click "Run workflow" to trigger it
   manually). Takes about 3-6 minutes.

3. **Download the compiled WASM.** When the run finishes, open it and
   download the `compliance-registry-wasm` artifact — it's a small zip
   containing one or more `.wasm` files. Get that zip onto your phone the
   same way as everything else (tap the download link, Termux file receiver,
   "Open Directory").

4. **Unzip and deploy it, once:**
   ```bash
   cd ~/edgeguard-server
   unzip ~/downloads/compliance-registry-wasm.zip -d ./contracts/compiled
   ls ./contracts/compiled   # confirm you see a .wasm file, note its name
   node server/contractDeploy.js ./contracts/compiled/THE_WASM_FILENAME.wasm
   ```
   This prints a deploy hash and a CSPR.live link. Wait ~30-60 seconds for
   it to finalize, then open that link and find the **Contract Hash** in
   the page details.

5. **Save the contract hash:**
   ```bash
   nano .env
   # add: CONTRACT_HASH=hash-xxxxxxxxxxxxxxxxx...
   ```

6. **Restart the server.** From here, `/v1/compliance-check-and-anchor-contract`
   writes every check straight into the contract's on-chain storage. If
   `CONTRACT_HASH` isn't set yet, that same endpoint automatically falls back
   to the native-transfer anchor — nothing breaks while you're mid-setup.

## If a step fails

The contract logic itself (`src/lib.rs`) is written to current Odra docs but
I flagged the two places I'm least certain about directly in the code
comments (the `#[odra::odra_type]` macro usage and the install-time runtime
args in `contractDeploy.js`) — Odra's exact API shifts between versions.
If the CI build fails on a method-name error, that's very likely one of
those two spots; the fix is usually a one-line rename, not a rewrite.
Compare against whatever `cargo odra new` scaffolds in the CI log for the
exact current signature, or check https://odra.dev/docs for the latest.

Paste me the exact CI error text if you hit one — much easier to fix from
the real error than to guess in advance.

## What this adds to your submission story

- A genuine deployed Casper smart contract (Odra), not just native transfers
- On-chain data that's queryable, not just a hash to verify
- Closes the one real gap versus the strongest known competing entry
  (NexusRWA, which deployed real Odra contracts for the same reason)
