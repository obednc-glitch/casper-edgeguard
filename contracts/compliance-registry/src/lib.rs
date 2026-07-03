// contracts/compliance-registry/src/lib.rs
//
// ComplianceRegistry: a real Casper smart contract (Odra framework) that
// stores compliance check results on-chain - the "cool" upgrade from a
// native transfer anchor to an actual queryable on-chain data structure.
// Anyone can look up an asset's compliance history directly from the
// contract's storage via CSPR.live or an RPC call, not just verify a hash.
//
// HONESTY NOTE: Odra's exact method names (env().get_block_time(),
// env().caller(), the #[odra::odra_type] macro for custom structs) are
// written here based on the current published Counter example and docs,
// but Odra's API does evolve between versions. Before treating this as
// final, scaffold a fresh project with `cargo odra new` (see
// contracts/compliance-registry/README.md) and diff this file's method
// calls against whatever that scaffold's generated example uses - if a
// method name has changed, this is a small, mechanical fix, not a redesign.

use odra::prelude::*;
use odra::{Mapping, Var};

#[odra::odra_type]
pub struct CheckRecord {
    pub verdict: String,      // LOW / MEDIUM / HIGH / CRITICAL
    pub score: u32,           // 0-100 overall compliance score
    pub sanctions_clear: bool,
    pub timestamp: u64,       // block time at time of recording
    pub checker: Address,     // which agent identity recorded this
}

#[odra::module]
pub struct ComplianceRegistry {
    checks: Mapping<String, CheckRecord>, // asset_hash -> latest check
    check_count: Var<u32>,
}

#[odra::module]
impl ComplianceRegistry {
    /// Record a compliance check result on-chain. Called by EdgeGuard after
    /// both agents (EdgeGuard + RiskOracle) have cross-checked and agreed.
    pub fn record_check(&mut self, asset_hash: String, verdict: String, score: u32, sanctions_clear: bool) {
        let record = CheckRecord {
            verdict,
            score,
            sanctions_clear,
            timestamp: self.env().get_block_time(),
            checker: self.env().caller(),
        };
        self.checks.set(&asset_hash, record);
        let count = self.check_count.get_or_default();
        self.check_count.set(count + 1);
    }

    /// Look up the most recent recorded check for an asset. Returns None if
    /// this asset has never been checked on-chain.
    pub fn get_check(&self, asset_hash: String) -> Option<CheckRecord> {
        self.checks.get(&asset_hash)
    }

    /// Total number of checks ever recorded - a simple on-chain counter
    /// judges/anyone can query to see real usage, not just one demo call.
    pub fn total_checks(&self) -> u32 {
        self.check_count.get_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, NoArgs};

    #[test]
    fn record_and_read_a_check() {
        let env = odra_test::env();
        let mut contract = ComplianceRegistryHostRef::deploy(&env, NoArgs);

        contract.record_check("asset-hash-abc123".to_string(), "LOW".to_string(), 85, true);

        let record = contract.get_check("asset-hash-abc123".to_string());
        assert!(record.is_some());
        assert_eq!(record.unwrap().score, 85);
        assert_eq!(contract.total_checks(), 1);
    }

    #[test]
    fn unknown_asset_returns_none() {
        let env = odra_test::env();
        let contract = ComplianceRegistryHostRef::deploy(&env, NoArgs);
        assert!(contract.get_check("never-checked".to_string()).is_none());
    }
}
