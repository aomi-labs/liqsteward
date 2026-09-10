//! Pilot constants and the `reallocate` transport shape.
//!
//! Addresses are lowercase so they compare byte-for-byte with host output;
//! checksum casing is a display concern and never a comparison key.

use crate::abi::MarketParams;
use alloy_primitives::{Address, B256, U256, hex};
use alloy_sol_types::{SolCall, sol};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const CHAIN_ID: u64 = 1;

/// Morpho Blue singleton on Ethereum mainnet.
pub const MORPHO_BLUE: &str = "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb";
/// Morpho's Adaptive Curve IRM on Ethereum mainnet.
pub const ADAPTIVE_CURVE_IRM: &str = "0x870ac11d48b15db9a138cf899d20f13f79ba00bc";

/// Gauntlet USDC Core MetaMorpho vault (the pilot vault).
pub const PILOT_VAULT: &str = "0x8eb67a509616cd6a7c1b3c8c21d48ff57df3d458";
pub const PILOT_CURATOR_SAFE: &str = "0x9e33faae38ff641094fa68c65c2ce600b3410585";
pub const PILOT_OWNER_SAFE: &str = "0xc684c6587712e5e7bdf9fd64415f23bd2b05faec";
pub const PILOT_GUARDIAN_SAFE: &str = "0x7084bf4db6c21e1834dd6482f6056a39a33584cd";

pub const USDC: &str = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
pub const USDC_DECIMALS: u8 = 6;

pub const IDLE_MARKET_ID: &str =
    "0x54efdee08e272e929034a8f26f7ca34b1ebe364b275391169b28c6d7db24dbc8";
pub const USD0PP_MARKET_ID: &str =
    "0xb48bb53f0f2690c71e8813f2dc7ed6fca9ac4b0ace3faa37b4a8e5ece38fa1a2";
pub const PT_USD0PP_MARKET_ID: &str =
    "0x8411eeb07c8e32de0b3784b6b967346a45593bfd8baeb291cc209dc195c7b3ad";

/// `type(uint256).max`: MetaMorpho's "sweep the remainder into this market"
/// sentinel for the last allocation.
pub const MAX_UINT256: &str =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";

pub const REALLOCATE_SELECTOR: &str = "0x7299aa31";
/// Canonical signature behind [`REALLOCATE_SELECTOR`]: `MarketAllocation[]`
/// is `((address,address,address,address,uint256),uint256)[]`, nested.
pub const REALLOCATE_SIGNATURE: &str =
    "reallocate(((address,address,address,address,uint256),uint256)[])";

sol! {
    struct SolMarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    struct MarketAllocation {
        SolMarketParams marketParams;
        uint256 assets;
    }

    function reallocate(MarketAllocation[] calldata allocations) external;
}

/// One entry of a `reallocate` plan as the caller expresses it: explicit
/// market params plus the target assets. No planning logic lives here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Allocation {
    pub loan_token: String,
    pub collateral_token: String,
    pub oracle: String,
    pub irm: String,
    pub lltv: String,
    pub assets: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllocationError(pub String);

impl std::fmt::Display for AllocationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AllocationError {}

fn parse_address(field: &str, value: &str) -> Result<Address, AllocationError> {
    value
        .parse::<Address>()
        .map_err(|error| AllocationError(format!("{field} is not an address: {error}")))
}

fn parse_u256(field: &str, value: &str) -> Result<U256, AllocationError> {
    value
        .parse::<U256>()
        .map_err(|error| AllocationError(format!("{field} is not a uint256: {error}")))
}

impl Allocation {
    pub fn market_params(&self) -> Result<MarketParams, AllocationError> {
        Ok(MarketParams {
            loanToken: parse_address("loan_token", &self.loan_token)?,
            collateralToken: parse_address("collateral_token", &self.collateral_token)?,
            oracle: parse_address("oracle", &self.oracle)?,
            irm: parse_address("irm", &self.irm)?,
            lltv: parse_u256("lltv", &self.lltv)?,
        })
    }

    pub fn market_id(&self) -> Result<B256, AllocationError> {
        Ok(self.market_params()?.id())
    }

    fn sol(&self) -> Result<MarketAllocation, AllocationError> {
        let params = self.market_params()?;
        Ok(MarketAllocation {
            marketParams: SolMarketParams {
                loanToken: params.loanToken,
                collateralToken: params.collateralToken,
                oracle: params.oracle,
                irm: params.irm,
                lltv: params.lltv,
            },
            assets: parse_u256("assets", &self.assets)?,
        })
    }
}

/// The exact `reallocate` calldata for `allocations`, `0x`-prefixed. Used to
/// assert byte identity against what the host actually staged.
pub fn encode_reallocate(allocations: &[Allocation]) -> Result<String, AllocationError> {
    let allocations = allocations
        .iter()
        .map(Allocation::sol)
        .collect::<Result<Vec<_>, _>>()?;
    let call = reallocateCall { allocations };
    Ok(format!("0x{}", hex::encode(call.abi_encode())))
}

/// The `data` argument for `evm_stage_tx` in structured-encode form. Raw
/// calldata does not survive model transport (a re-typed ~900-char hex
/// string arrives corrupted); the host's ABI encoder produces identical
/// bytes from these short arguments, and byte identity is asserted after
/// the fact with [`encode_reallocate`].
pub fn reallocate_stage_data(allocations: &[Allocation]) -> Result<Value, AllocationError> {
    let args = allocations
        .iter()
        .map(|allocation| {
            allocation.market_params()?;
            parse_u256("assets", &allocation.assets)?;
            Ok(json!([
                [
                    allocation.loan_token,
                    allocation.collateral_token,
                    allocation.oracle,
                    allocation.irm,
                    allocation.lltv,
                ],
                allocation.assets,
            ]))
        })
        .collect::<Result<Vec<_>, AllocationError>>()?;
    Ok(json!({ "encode": { "signature": REALLOCATE_SIGNATURE, "args": [args] } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::selector;

    fn idle(assets: &str) -> Allocation {
        Allocation {
            loan_token: USDC.to_owned(),
            collateral_token: Address::ZERO.to_string(),
            oracle: Address::ZERO.to_string(),
            irm: Address::ZERO.to_string(),
            lltv: "0".to_owned(),
            assets: assets.to_owned(),
        }
    }

    #[test]
    fn reallocate_signature_matches_pinned_selector() {
        assert_eq!(
            format!("0x{}", hex::encode(selector(REALLOCATE_SIGNATURE))),
            REALLOCATE_SELECTOR
        );
    }

    #[test]
    fn idle_allocation_hashes_to_the_idle_market() {
        assert_eq!(
            idle("0").market_id().unwrap(),
            IDLE_MARKET_ID.parse::<B256>().unwrap()
        );
    }

    #[test]
    fn calldata_starts_with_the_selector_and_stage_data_is_structured() {
        let plan = [idle(MAX_UINT256)];
        let calldata = encode_reallocate(&plan).unwrap();
        assert!(calldata.starts_with(REALLOCATE_SELECTOR));
        let data = reallocate_stage_data(&plan).unwrap();
        assert_eq!(data["encode"]["signature"], REALLOCATE_SIGNATURE);
        assert_eq!(data["encode"]["args"][0][0][1], MAX_UINT256);
        assert!(data.get("raw").is_none());
    }

    #[test]
    fn malformed_allocations_are_rejected_before_staging() {
        let mut bad = idle("1");
        bad.assets = "not-a-number".to_owned();
        assert!(reallocate_stage_data(&[bad.clone()]).is_err());
        assert!(encode_reallocate(&[bad]).is_err());
    }
}
