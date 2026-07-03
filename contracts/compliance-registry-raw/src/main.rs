// contracts/compliance-registry-raw/src/main.rs
//
// ComplianceRegistry, written directly against Casper's own casper-contract
// SDK - no Odra, no cargo-odra scaffolding. This exists because the Odra
// version (contracts/compliance-registry/) hit a reproducible upstream
// build bug (E0152 duplicate panic_impl) across multiple nightly toolchains
// - see contracts/compliance-registry/README.md for that investigation.
//
// This file follows Casper's own official "Writing a Basic Smart Contract
// in Rust" pattern (docs.casper.network/developers/writing-onchain-code).
// Storage design: four separate dictionaries (verdicts / scores /
// sanctions_clear / timestamps), all keyed by asset_hash, plus a simple
// counter. This avoids needing a custom serializable struct type - every
// value stored is a plain CLType Casper already knows how to handle
// (String, u32, bool, u64), which minimizes the surface area for another
// version-drift bug like the one that blocked the Odra path.
//
// HONESTY NOTE: I have not been able to run this build myself (no Rust/wasm
// toolchain access in my environment) - this follows the official
// documented pattern closely, and casper-contract v5.1.1 already proved it
// compiles cleanly in your exact CI runner (visible in the earlier failed
// Odra build's own log, before it reached Odra's wasm-env crate). But this
// is still a first real build attempt for this specific file - if it fails,
// paste the exact CI error and we fix it from real data, same as before.
//
// UPDATE after first real build attempt: casper-contract's default
// "no-std-helpers" feature ships its own panic handler using
// `#[no_mangle] pub fn panic(...)` (in its internal no_std_handlers.rs) -
// current Rust rejects that pattern on lang items ("cannot be used on
// internal language items"). This is a real incompatibility in that crate
// feature against current-ish nightly Rust, not something in our code.
// Fixed by disabling default-features on casper-contract (Cargo.toml) and
// providing our own panic handler + global allocator below, using the
// modern #[panic_handler] attribute instead of the deprecated pattern.

#![no_std]
#![no_main]

extern crate alloc;

use alloc::string::{String, ToString};
use alloc::vec;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

use casper_contract::contract_api::{runtime, storage};
use casper_contract::unwrap_or_revert::UnwrapOrRevert;
use casper_types::{
    CLType, CLTyped, CLValue, EntryPoint, EntryPointAccess, EntryPointType, EntryPoints,
    Parameter, RuntimeArgs,
};

const DICT_VERDICTS: &str = "verdicts";
const DICT_SCORES: &str = "scores";
const DICT_SANCTIONS_CLEAR: &str = "sanctions_clear_flags";
const DICT_TIMESTAMPS: &str = "timestamps";
const KEY_TOTAL_CHECKS: &str = "total_checks";

const ARG_ASSET_HASH: &str = "asset_hash";
const ARG_VERDICT: &str = "verdict";
const ARG_SCORE: &str = "score";
const ARG_SANCTIONS_CLEAR: &str = "sanctions_clear";

const ENTRY_POINT_RECORD_CHECK: &str = "record_check";
const ENTRY_POINT_GET_VERDICT: &str = "get_verdict";
const ENTRY_POINT_GET_SCORE: &str = "get_score";
const ENTRY_POINT_GET_SANCTIONS_CLEAR: &str = "get_sanctions_clear";
const ENTRY_POINT_GET_TIMESTAMP: &str = "get_timestamp";
const ENTRY_POINT_TOTAL_CHECKS: &str = "total_checks";

const CONTRACT_PACKAGE_NAME: &str = "compliance_registry_package";
const CONTRACT_ACCESS_UREF: &str = "compliance_registry_access";
const CONTRACT_KEY: &str = "compliance_registry_contract";

fn get_or_create_dict(name: &str) -> casper_types::URef {
    match runtime::get_key(name) {
        Some(key) => *key.as_uref().unwrap_or_revert(),
        None => {
            let dict = storage::new_dictionary(name).unwrap_or_revert();
            dict
        }
    }
}

// --- entry point implementations ---

#[no_mangle]
pub extern "C" fn record_check() {
    let asset_hash: String = runtime::get_named_arg(ARG_ASSET_HASH);
    let verdict: String = runtime::get_named_arg(ARG_VERDICT);
    let score: u32 = runtime::get_named_arg(ARG_SCORE);
    let sanctions_clear: bool = runtime::get_named_arg(ARG_SANCTIONS_CLEAR);
    let timestamp: u64 = runtime::get_blocktime().into();

    let verdicts = get_or_create_dict(DICT_VERDICTS);
    let scores = get_or_create_dict(DICT_SCORES);
    let sanctions = get_or_create_dict(DICT_SANCTIONS_CLEAR);
    let timestamps = get_or_create_dict(DICT_TIMESTAMPS);

    storage::dictionary_put(verdicts, &asset_hash, verdict);
    storage::dictionary_put(scores, &asset_hash, score);
    storage::dictionary_put(sanctions, &asset_hash, sanctions_clear);
    storage::dictionary_put(timestamps, &asset_hash, timestamp);

    let total_uref = get_or_create_dict(KEY_TOTAL_CHECKS); // reused as a single-slot counter store
    let current: u32 = storage::dictionary_get::<u32>(total_uref, "count")
        .unwrap_or_revert()
        .unwrap_or(0);
    storage::dictionary_put(total_uref, "count", current + 1);
}

#[no_mangle]
pub extern "C" fn get_verdict() {
    let asset_hash: String = runtime::get_named_arg(ARG_ASSET_HASH);
    let dict = get_or_create_dict(DICT_VERDICTS);
    let value: String = storage::dictionary_get::<String>(dict, &asset_hash)
        .unwrap_or_revert()
        .unwrap_or_else(|| "NOT_FOUND".to_string());
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_score() {
    let asset_hash: String = runtime::get_named_arg(ARG_ASSET_HASH);
    let dict = get_or_create_dict(DICT_SCORES);
    let value: u32 = storage::dictionary_get::<u32>(dict, &asset_hash)
        .unwrap_or_revert()
        .unwrap_or(0);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_sanctions_clear() {
    let asset_hash: String = runtime::get_named_arg(ARG_ASSET_HASH);
    let dict = get_or_create_dict(DICT_SANCTIONS_CLEAR);
    let value: bool = storage::dictionary_get::<bool>(dict, &asset_hash)
        .unwrap_or_revert()
        .unwrap_or(false);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_timestamp() {
    let asset_hash: String = runtime::get_named_arg(ARG_ASSET_HASH);
    let dict = get_or_create_dict(DICT_TIMESTAMPS);
    let value: u64 = storage::dictionary_get::<u64>(dict, &asset_hash)
        .unwrap_or_revert()
        .unwrap_or(0);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn total_checks() {
    let total_uref = get_or_create_dict(KEY_TOTAL_CHECKS);
    let value: u32 = storage::dictionary_get::<u32>(total_uref, "count")
        .unwrap_or_revert()
        .unwrap_or(0);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

// --- installer: runs once, on deploy, to set up entry points + storage ---

#[no_mangle]
pub extern "C" fn call() {
    let mut entry_points = EntryPoints::new();

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_RECORD_CHECK,
        vec![
            Parameter::new(ARG_ASSET_HASH, CLType::String),
            Parameter::new(ARG_VERDICT, CLType::String),
            Parameter::new(ARG_SCORE, CLType::U32),
            Parameter::new(ARG_SANCTIONS_CLEAR, CLType::Bool),
        ],
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_VERDICT,
        vec![Parameter::new(ARG_ASSET_HASH, CLType::String)],
        CLType::String,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_SCORE,
        vec![Parameter::new(ARG_ASSET_HASH, CLType::String)],
        CLType::U32,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_SANCTIONS_CLEAR,
        vec![Parameter::new(ARG_ASSET_HASH, CLType::String)],
        CLType::Bool,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_TIMESTAMP,
        vec![Parameter::new(ARG_ASSET_HASH, CLType::String)],
        CLType::U64,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_TOTAL_CHECKS,
        vec![],
        CLType::U32,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    let (contract_hash, _contract_version) = storage::new_contract(
        entry_points,
        None,
        Some(CONTRACT_PACKAGE_NAME.to_string()),
        Some(CONTRACT_ACCESS_UREF.to_string()),
        None,
    );

    runtime::put_key(CONTRACT_KEY, contract_hash.into());
}
