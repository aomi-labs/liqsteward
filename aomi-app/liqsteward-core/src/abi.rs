//! Function signatures and strict decoders for the venues the NAV oracle
//! values. Every decoder takes the verified bytes from
//! [`crate::transport::verify_result`] and refuses anything that is not the
//! exact ABI shape: no truncation, no trailing bytes, no lenient parsing.
//! A decode failure marks the node `unresolved(probe_failed)`.

use alloy_primitives::{Address, B256, U256, keccak256};
use alloy_sol_types::{SolValue, sol};
use std::fmt;

// ── Signatures the adapters route through `encode_and_call` / `sim_call` ──

pub const ERC20_BALANCE_OF: &str = "balanceOf(address)";
pub const ERC20_DECIMALS: &str = "decimals()";
pub const ERC20_SYMBOL: &str = "symbol()";
pub const ERC20_TOTAL_SUPPLY: &str = "totalSupply()";

pub const ERC4626_ASSET: &str = "asset()";
pub const ERC4626_TOTAL_ASSETS: &str = "totalAssets()";
pub const ERC4626_CONVERT_TO_ASSETS: &str = "convertToAssets(uint256)";

pub const METAMORPHO_MORPHO: &str = "MORPHO()";
pub const METAMORPHO_WITHDRAW_QUEUE_LENGTH: &str = "withdrawQueueLength()";
pub const METAMORPHO_WITHDRAW_QUEUE: &str = "withdrawQueue(uint256)";
pub const METAMORPHO_LAST_TOTAL_ASSETS: &str = "lastTotalAssets()";
pub const METAMORPHO_FEE: &str = "fee()";
pub const METAMORPHO_FEE_RECIPIENT: &str = "feeRecipient()";

pub const MORPHO_POSITION: &str = "position(bytes32,address)";
pub const MORPHO_MARKET: &str = "market(bytes32)";
pub const MORPHO_ID_TO_MARKET_PARAMS: &str = "idToMarketParams(bytes32)";

pub const IRM_BORROW_RATE_VIEW: &str =
    "borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))";

/// First four bytes of `keccak256(signature)`.
pub fn selector(signature: &str) -> [u8; 4] {
    let hash = keccak256(signature.as_bytes());
    [hash[0], hash[1], hash[2], hash[3]]
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeError {
    pub signature: &'static str,
    pub detail: String,
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "cannot decode `{}` result: {}", self.signature, self.detail)
    }
}

impl std::error::Error for DecodeError {}

fn strict<T>(signature: &'static str, bytes: &[u8]) -> Result<T, DecodeError>
where
    T: SolValue + From<<T::SolType as alloy_sol_types::SolType>::RustType>,
{
    T::abi_decode(bytes, true).map_err(|error| DecodeError {
        signature,
        detail: error.to_string(),
    })
}

// ── Scalar decoders ──

pub fn decode_u256(signature: &'static str, bytes: &[u8]) -> Result<U256, DecodeError> {
    strict::<U256>(signature, bytes)
}

pub fn decode_u8(signature: &'static str, bytes: &[u8]) -> Result<u8, DecodeError> {
    <alloy_sol_types::sol_data::Uint<8> as alloy_sol_types::SolType>::abi_decode(bytes, true)
        .map_err(|error| DecodeError {
            signature,
            detail: error.to_string(),
        })
}

pub fn decode_address(signature: &'static str, bytes: &[u8]) -> Result<Address, DecodeError> {
    strict::<Address>(signature, bytes)
}

pub fn decode_bytes32(signature: &'static str, bytes: &[u8]) -> Result<B256, DecodeError> {
    strict::<B256>(signature, bytes)
}

pub fn decode_string(signature: &'static str, bytes: &[u8]) -> Result<String, DecodeError> {
    strict::<String>(signature, bytes)
}

// ── Morpho Blue ──

sol! {
    /// Morpho Blue `MarketParams`. Field order is the ABI order and the
    /// hashing order for the market id.
    #[derive(Debug, PartialEq, Eq)]
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    /// `position(bytes32,address)` return tuple.
    #[derive(Debug, PartialEq, Eq)]
    struct MorphoPosition {
        uint256 supplyShares;
        uint128 borrowShares;
        uint128 collateral;
    }

    /// `market(bytes32)` return tuple.
    #[derive(Debug, PartialEq, Eq)]
    struct MorphoMarket {
        uint128 totalSupplyAssets;
        uint128 totalSupplyShares;
        uint128 totalBorrowAssets;
        uint128 totalBorrowShares;
        uint128 lastUpdate;
        uint128 fee;
    }
}

impl MarketParams {
    /// `Id.unwrap(MarketParamsLib.id(params))`: keccak of the ABI-encoded
    /// struct.
    pub fn id(&self) -> B256 {
        keccak256(self.abi_encode())
    }
}

pub fn decode_market_params(bytes: &[u8]) -> Result<MarketParams, DecodeError> {
    MarketParams::abi_decode(bytes, true).map_err(|error| DecodeError {
        signature: MORPHO_ID_TO_MARKET_PARAMS,
        detail: error.to_string(),
    })
}

pub fn decode_position(bytes: &[u8]) -> Result<MorphoPosition, DecodeError> {
    MorphoPosition::abi_decode(bytes, true).map_err(|error| DecodeError {
        signature: MORPHO_POSITION,
        detail: error.to_string(),
    })
}

pub fn decode_market(bytes: &[u8]) -> Result<MorphoMarket, DecodeError> {
    MorphoMarket::abi_decode(bytes, true).map_err(|error| DecodeError {
        signature: MORPHO_MARKET,
        detail: error.to_string(),
    })
}

// ── Morpho Blue share math (SharesMathLib / MathLib, exact integer forms) ──

const VIRTUAL_SHARES: u128 = 1_000_000;
const VIRTUAL_ASSETS: u128 = 1;
/// Seconds-scaled fixed point used by `wTaylorCompounded`: 1e18.
const WAD: u128 = 1_000_000_000_000_000_000;

fn u(value: u128) -> U256 {
    U256::from(value)
}

fn mul_div_down(x: U256, y: U256, d: U256) -> U256 {
    x * y / d
}

fn mul_div_up(x: U256, y: U256, d: U256) -> U256 {
    (x * y + (d - U256::from(1))) / d
}

/// `SharesMathLib.toAssetsDown`: the assets a supply-share balance redeems
/// for at the market's current totals, without interest accrual.
pub fn supply_shares_to_assets_down(
    shares: U256,
    total_supply_assets: u128,
    total_supply_shares: u128,
) -> U256 {
    mul_div_down(
        shares,
        u(total_supply_assets) + u(VIRTUAL_ASSETS),
        u(total_supply_shares) + u(VIRTUAL_SHARES),
    )
}

/// `SharesMathLib.toSharesDown`.
pub fn assets_to_supply_shares_down(
    assets: U256,
    total_supply_assets: u128,
    total_supply_shares: u128,
) -> U256 {
    mul_div_down(
        assets,
        u(total_supply_shares) + u(VIRTUAL_SHARES),
        u(total_supply_assets) + u(VIRTUAL_ASSETS),
    )
}

/// `MathLib.wTaylorCompounded(x, n)`: `e^(x·n) − 1` to third order, in WAD.
pub fn w_taylor_compounded(rate_per_second_wad: U256, elapsed_seconds: U256) -> U256 {
    let wad = u(WAD);
    let first = rate_per_second_wad * elapsed_seconds;
    let second = mul_div_down(first, first, wad * U256::from(2));
    let third = mul_div_down(second, first, wad * U256::from(3));
    first + second + third
}

/// The market after `Morpho._accrueInterest` would run at `now`, given the
/// IRM's `borrowRateView` at the same block. This is Morpho's own
/// `expectedMarketBalances`; the NAV oracle uses it as a posted view so a
/// supply position can be valued with interest that has accrued but not yet
/// been written to storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccruedMarket {
    pub total_supply_assets: U256,
    pub total_supply_shares: U256,
    pub total_borrow_assets: U256,
    pub total_borrow_shares: U256,
    pub interest: U256,
    pub fee_shares: U256,
}

pub fn accrue_interest(
    market: &MorphoMarket,
    borrow_rate_per_second_wad: U256,
    now_seconds: u128,
) -> AccruedMarket {
    let elapsed = now_seconds.saturating_sub(market.lastUpdate);
    let total_supply_assets = u(market.totalSupplyAssets);
    let total_supply_shares = u(market.totalSupplyShares);
    let total_borrow_assets = u(market.totalBorrowAssets);
    let total_borrow_shares = u(market.totalBorrowShares);
    if elapsed == 0 || market.totalBorrowAssets == 0 {
        return AccruedMarket {
            total_supply_assets,
            total_supply_shares,
            total_borrow_assets,
            total_borrow_shares,
            interest: U256::ZERO,
            fee_shares: U256::ZERO,
        };
    }
    let wad = u(WAD);
    let growth = w_taylor_compounded(borrow_rate_per_second_wad, U256::from(elapsed));
    let interest = mul_div_down(total_borrow_assets, growth, wad);
    let supply_after = total_supply_assets + interest;
    let fee_amount = mul_div_down(interest, u(market.fee), wad);
    let fee_shares = if fee_amount.is_zero() {
        U256::ZERO
    } else {
        mul_div_down(
            fee_amount,
            total_supply_shares + u(VIRTUAL_SHARES),
            supply_after - fee_amount + u(VIRTUAL_ASSETS),
        )
    };
    AccruedMarket {
        total_supply_assets: supply_after,
        total_supply_shares: total_supply_shares + fee_shares,
        total_borrow_assets: total_borrow_assets + interest,
        total_borrow_shares,
        interest,
        fee_shares,
    }
}

/// Round-up variant Morpho uses for borrow-side conversions; exposed so a
/// liability adapter can mirror `toAssetsUp` exactly.
pub fn borrow_shares_to_assets_up(
    shares: U256,
    total_borrow_assets: U256,
    total_borrow_shares: U256,
) -> U256 {
    mul_div_up(
        shares,
        total_borrow_assets + u(VIRTUAL_ASSETS),
        total_borrow_shares + u(VIRTUAL_SHARES),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{address, b256, hex};

    #[test]
    fn selectors_match_the_known_four_bytes() {
        assert_eq!(hex::encode(selector(ERC20_BALANCE_OF)), "70a08231");
        assert_eq!(hex::encode(selector(ERC4626_TOTAL_ASSETS)), "01e1d114");
        assert_eq!(hex::encode(selector(MORPHO_POSITION)), "93c52062");
        assert_eq!(hex::encode(selector(MORPHO_MARKET)), "5c60e39a");
    }

    #[test]
    fn scalar_decoders_are_strict_about_length() {
        let word = hex::decode(format!("{:0>64}", "2a")).unwrap();
        assert_eq!(decode_u256(ERC4626_TOTAL_ASSETS, &word).unwrap(), U256::from(42));
        assert!(decode_u256(ERC4626_TOTAL_ASSETS, &word[..31]).is_err());
        let mut padded = word.clone();
        padded.push(0);
        assert!(decode_u256(ERC4626_TOTAL_ASSETS, &padded).is_err());
    }

    #[test]
    fn dynamic_string_decodes_symbol() {
        let encoded = "USDC".to_owned().abi_encode();
        assert_eq!(decode_string(ERC20_SYMBOL, &encoded).unwrap(), "USDC");
    }

    #[test]
    fn idle_market_params_hash_to_the_pinned_idle_market_id() {
        let params = MarketParams {
            loanToken: address!("A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
            collateralToken: Address::ZERO,
            oracle: Address::ZERO,
            irm: Address::ZERO,
            lltv: U256::ZERO,
        };
        assert_eq!(
            params.id(),
            b256!("54efdee08e272e929034a8f26f7ca34b1ebe364b275391169b28c6d7db24dbc8")
        );
        let round_trip = decode_market_params(&params.abi_encode()).unwrap();
        assert_eq!(round_trip, params);
    }

    #[test]
    fn position_and_market_tuples_round_trip() {
        let position = MorphoPosition {
            supplyShares: U256::from(123_456_789u64),
            borrowShares: 0,
            collateral: 0,
        };
        assert_eq!(decode_position(&position.abi_encode()).unwrap(), position);

        let market = MorphoMarket {
            totalSupplyAssets: 1_000_000_000,
            totalSupplyShares: 999_000_000_000_000,
            totalBorrowAssets: 500_000_000,
            totalBorrowShares: 499_000_000_000_000,
            lastUpdate: 1_700_000_000,
            fee: 0,
        };
        assert_eq!(decode_market(&market.abi_encode()).unwrap(), market);
    }

    #[test]
    fn share_math_matches_morpho_virtual_offsets() {
        // Fresh market: 1 asset == 1e6 shares exactly (virtual shares).
        let shares = assets_to_supply_shares_down(U256::from(1_000_000u64), 0, 0);
        assert_eq!(shares, U256::from(1_000_000_000_000u64));
        let assets = supply_shares_to_assets_down(shares, 0, 0);
        assert_eq!(assets, U256::from(1_000_000u64));
    }

    #[test]
    fn interest_accrual_is_identity_when_nothing_elapsed_or_nothing_borrowed() {
        let market = MorphoMarket {
            totalSupplyAssets: 10,
            totalSupplyShares: 10_000_000,
            totalBorrowAssets: 0,
            totalBorrowShares: 0,
            lastUpdate: 100,
            fee: 0,
        };
        let accrued = accrue_interest(&market, U256::from(1_000_000_000u64), 200);
        assert_eq!(accrued.interest, U256::ZERO);
        assert_eq!(accrued.total_supply_assets, U256::from(10));
    }

    #[test]
    fn interest_accrual_grows_supply_and_borrow_and_mints_fee_shares() {
        let market = MorphoMarket {
            totalSupplyAssets: 1_000_000_000_000,
            totalSupplyShares: 1_000_000_000_000_000_000,
            totalBorrowAssets: 500_000_000_000,
            totalBorrowShares: 500_000_000_000_000_000,
            lastUpdate: 0,
            fee: 100_000_000_000_000_000, // 10 %
        };
        // ~5 % APR expressed per second in WAD.
        let rate = U256::from(1_585_489_599u64);
        let accrued = accrue_interest(&market, rate, 365 * 86_400);
        assert!(accrued.interest > U256::ZERO);
        assert_eq!(
            accrued.total_borrow_assets,
            U256::from(market.totalBorrowAssets) + accrued.interest
        );
        assert_eq!(
            accrued.total_supply_assets,
            U256::from(market.totalSupplyAssets) + accrued.interest
        );
        assert!(accrued.fee_shares > U256::ZERO);
        // Fee shares are worth (approximately, rounding down) 10 % of interest.
        let fee_value = supply_shares_to_assets_down(
            accrued.fee_shares,
            accrued.total_supply_assets.to::<u128>(),
            accrued.total_supply_shares.to::<u128>(),
        );
        let expected = accrued.interest / U256::from(10);
        assert!(fee_value <= expected && expected - fee_value <= U256::from(1));
    }
}
