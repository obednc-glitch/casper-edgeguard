// contracts/compliance-registry-raw/src/main.rs
//
// ComplianceRegistry - PRIVACY-PRESERVING DESIGN.
//
// Earlier versions of this contract stored the actual verdict, score, and
// sanctions-clear flag on-chain, publicly readable by anyone. On reflection
// (see the writeup in README.md), that's a bad idea for a real compliance
// product: a public, permanent ledger is fundamentally incompatible with
// data-deletion rights (GDPR "right to be forgotten" etc.), and it's a
// specific irony for a *compliance* tool to create its own compliance
// liability. It also leaked business intelligence (which assets/volumes a
// platform is processing) to anyone reading the chain.
//
// This version stores ONLY a hash-commitment of the full compliance report
// (already computed off-chain as `dataHash` in server/complianceEngine.js),
// plus who recorded it and when. The full verdict, score, and sanctions
// detail stay off-chain, in the PDF report and app UI, access-controlled
// like any normal business data. Anyone who already holds a copy of the
// full report (the asset owner, a regulator, an auditor you've shared it
// with) can hash it themselves and compare against what's on-chain to
// verify it's authentic and hasn't been altered - without the chain itself
// revealing anything to an arbitrary public reader.
//
// Access control: record_check can only be called by the account that
// installed this contract (checked via runtime::get_caller() against a
// stored owner AccountHash). Without this, anyone could write fake
// "compliance records" referencing your asset hashes - a real flaw in the
// earlier fully-public-write version.
//
// HONESTY NOTE: same as before - I don't have a Rust/wasm toolchain to test
// this myself. Access-control pattern (storing/checking an owner
// AccountHash via runtime::get_caller()) follows Casper's standard
// documented pattern for permissioned entry points. If the CI build
// surfaces an error, paste it and we fix it from real data.

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
use casper_types::contracts::EntryPoint;
use casper_types::{
    ApiError, CLType, CLValue, EntryPointAccess, EntryPointType, EntryPoints, Parameter,
};

const DICT_TIMESTAMPS: &str = "timestamps";
const DICT_CHECKERS: &str = "checkers";
const KEY_TOTAL_CHECKS: &str = "total_checks_dict";
const KEY_OWNER: &str = "owner";

const ARG_REPORT_HASH: &str = "report_hash";

const ENTRY_POINT_RECORD_CHECK: &str = "record_check";
const ENTRY_POINT_GET_TIMESTAMP: &str = "get_timestamp";
const ENTRY_POINT_GET_CHECKER: &str = "get_checker";
const ENTRY_POINT_TOTAL_CHECKS: &str = "total_checks";

const CONTRACT_PACKAGE_NAME: &str = "compliance_registry_package";
const CONTRACT_ACCESS_UREF: &str = "compliance_registry_access";
const CONTRACT_KEY: &str = "compliance_registry_contract";

// Custom revert code for "caller isn't the authorized checker" - shows up
// as ApiError::User(1) if this ever gets hit, distinguishing it from other
// failure modes.
const ERROR_NOT_AUTHORIZED: u16 = 1;

fn get_or_create_dict(name: &str) -> casper_types::URef {
    match runtime::get_key(name) {
        Some(key) => *key.as_uref().unwrap_or_revert(),
        None => storage::new_dictionary(name).unwrap_or_revert(),
    }
}

fn assert_caller_is_owner() {
    let owner_key = runtime::get_key(KEY_OWNER).unwrap_or_revert();
    let owner_uref = *owner_key.as_uref().unwrap_or_revert();
    let owner: String = storage::read(owner_uref)
        .unwrap_or_revert()
        .unwrap_or_revert();
    let caller = runtime::get_caller().to_string();
    if caller != owner {
        runtime::revert(ApiError::User(ERROR_NOT_AUTHORIZED));
    }
}

// --- entry point implementations ---

#[no_mangle]
pub extern "C" fn record_check() {
    assert_caller_is_owner();

    let report_hash: String = runtime::get_named_arg(ARG_REPORT_HASH);
    let timestamp: u64 = runtime::get_blocktime().into();
    let checker = runtime::get_caller().to_string();

    let timestamps = get_or_create_dict(DICT_TIMESTAMPS);
    let checkers = get_or_create_dict(DICT_CHECKERS);

    storage::dictionary_put(timestamps, &report_hash, timestamp);
    storage::dictionary_put(checkers, &report_hash, checker);

    let total_dict = get_or_create_dict(KEY_TOTAL_CHECKS);
    let current: u32 = storage::dictionary_get::<u32>(total_dict, "count")
        .unwrap_or_revert()
        .unwrap_or(0);
    storage::dictionary_put(total_dict, "count", current + 1);
}

#[no_mangle]
pub extern "C" fn get_timestamp() {
    let report_hash: String = runtime::get_named_arg(ARG_REPORT_HASH);
    let dict = get_or_create_dict(DICT_TIMESTAMPS);
    let value: u64 = storage::dictionary_get::<u64>(dict, &report_hash)
        .unwrap_or_revert()
        .unwrap_or(0);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn get_checker() {
    let report_hash: String = runtime::get_named_arg(ARG_REPORT_HASH);
    let dict = get_or_create_dict(DICT_CHECKERS);
    let value: String = storage::dictionary_get::<String>(dict, &report_hash)
        .unwrap_or_revert()
        .unwrap_or_else(|| "NOT_FOUND".to_string());
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

#[no_mangle]
pub extern "C" fn total_checks() {
    let total_dict = get_or_create_dict(KEY_TOTAL_CHECKS);
    let value: u32 = storage::dictionary_get::<u32>(total_dict, "count")
        .unwrap_or_revert()
        .unwrap_or(0);
    runtime::ret(CLValue::from_t(value).unwrap_or_revert());
}

// --- installer: runs once, on deploy ---

#[no_mangle]
pub extern "C" fn call() {
    let mut entry_points = EntryPoints::new();

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_RECORD_CHECK,
        vec![Parameter::new(ARG_REPORT_HASH, CLType::String)],
        CLType::Unit,
        EntryPointAccess::Public, // access is enforced INSIDE record_check via assert_caller_is_owner(), not at the entry-point level - Casper's own group-based access control is an alternative but this keeps the design simple and auditable in one place
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_TIMESTAMP,
        vec![Parameter::new(ARG_REPORT_HASH, CLType::String)],
        CLType::U64,
        EntryPointAccess::Public,
        EntryPointType::Contract,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_CHECKER,
        vec![Parameter::new(ARG_REPORT_HASH, CLType::String)],
        CLType::String,
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

    // Record the deploying account as the sole authorized checker.
    let owner = runtime::get_caller().to_string();
    let owner_uref = storage::new_uref(owner);
    runtime::put_key(KEY_OWNER, owner_uref.into());

    runtime::put_key(CONTRACT_KEY, contract_hash.into());
}
