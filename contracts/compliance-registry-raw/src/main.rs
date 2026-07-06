// contracts/compliance-registry-raw/src/main.rs
//
// ComplianceRegistry - PRIVACY-PRESERVING DESIGN.
//
// Stores only a hash-commitment of each compliance report on-chain (plus
// who recorded it and when) - never the actual verdict, score, or
// sanctions result. A public, permanent ledger is the wrong place for
// compliance data tied to real people and real assets (conflicts with
// data-deletion rights like GDPR, and leaks which assets a platform is
// processing to anyone reading the chain). The full report stays in the
// access-controlled backend/PDF. Anyone holding a copy of the real report
// can verify it's authentic by re-hashing it and comparing to the
// on-chain commitment - same trust guarantee, zero data exposed publicly.
//
// Access control: record_check can only be called by the account that
// installed this contract (checked via runtime::get_caller()).
//
// API NOTE (found via a real build attempt, 2026-07-04): casper-types 5.0.1
// has moved to Casper's newer "addressable entity" model. Casper's own
// docs.casper.network tutorial (as of writing) still shows the OLDER
// pattern (contracts::EntryPoint, EntryPointType::Contract, 5-arg
// EntryPoint::new) - that pattern does NOT compile against the actually
// published casper-types 5.0.1. This file follows the CURRENT, real,
// working pattern instead, taken directly from
// github.com/casper-ecosystem/counter/blob/master/contract-v1/src/main.rs:
//   - EntryPoint is imported as `addressable_entity::EntityEntryPoint`
//   - EntryPointType::Called replaces EntryPointType::Contract
//   - EntryPoint::new() takes a 6th argument, EntryPointPayment::Caller
//
// HONESTY NOTE: still unable to run this build myself. This round's fix is
// grounded in an actual working reference file (not a guess), so confidence
// is higher than earlier rounds - but if the CI still errors, paste the
// exact text and we fix it from there, same as every round so far.

#![no_std]
#![no_main]

extern crate alloc;

use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

use casper_contract::contract_api::{runtime, storage};
use casper_contract::unwrap_or_revert::UnwrapOrRevert;
use casper_types::{
    ApiError, CLType, CLValue, EntityEntryPoint as EntryPoint, EntryPointAccess,
    EntryPointPayment, EntryPointType, EntryPoints, Parameter,
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
        Vec::from([Parameter::new(ARG_REPORT_HASH, CLType::String)]),
        CLType::Unit,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_TIMESTAMP,
        Vec::from([Parameter::new(ARG_REPORT_HASH, CLType::String)]),
        CLType::U64,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_GET_CHECKER,
        Vec::from([Parameter::new(ARG_REPORT_HASH, CLType::String)]),
        CLType::String,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    entry_points.add_entry_point(EntryPoint::new(
        ENTRY_POINT_TOTAL_CHECKS,
        Vec::new(),
        CLType::U32,
        EntryPointAccess::Public,
        EntryPointType::Called,
        EntryPointPayment::Caller,
    ));

    let (contract_hash, _contract_version) = storage::new_contract(
        entry_points,
        None,
        Some(CONTRACT_PACKAGE_NAME.to_string()),
        Some(CONTRACT_ACCESS_UREF.to_string()),
        None,
    );

    let owner = runtime::get_caller().to_string();
    let owner_uref = storage::new_uref(owner);
    runtime::put_key(KEY_OWNER, owner_uref.into());

    runtime::put_key(CONTRACT_KEY, contract_hash.into());
}
