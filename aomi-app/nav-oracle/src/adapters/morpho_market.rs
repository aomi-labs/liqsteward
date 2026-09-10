use super::{Adapter, AdapterError, Decoded, NodeCtx, VerifiedRead, find, hint, prior, read};
use crate::model::{ExpectedRead, PostedView, Quantity};
use alloy_primitives::U256;
use liqsteward_core::abi::{
    ERC20_DECIMALS, ERC20_SYMBOL, MORPHO_ID_TO_MARKET_PARAMS, MORPHO_MARKET, MORPHO_POSITION,
    borrow_shares_to_assets_up, decode_market, decode_market_params, decode_position, decode_string,
    decode_u8, supply_shares_to_assets_down,
};

/// `lending_supply` / `lending_debt` on the Morpho Blue singleton for one
/// market id. Stage 0 reads the position, the market totals, and the params;
/// stage 1 reads the loan token's decimals and symbol so the quantity is
/// fully described.
pub struct MorphoBlueMarket;

fn market_id(node: &NodeCtx<'_>) -> Result<String, AdapterError> {
    node.market_id
        .map(str::to_lowercase)
        .ok_or_else(|| AdapterError::NotApplicable("morpho_blue_market needs a market_id".to_owned()))
}

impl Adapter for MorphoBlueMarket {
    fn id(&self) -> &'static str {
        "morpho_blue_market"
    }
    fn version(&self) -> &'static str {
        "1.0.0"
    }
    fn protocol(&self) -> &'static str {
        "morpho"
    }

    fn plan(&self, node: &NodeCtx<'_>, stage: u32) -> Result<Vec<ExpectedRead>, AdapterError> {
        if node.kind != "lending_supply" && node.kind != "lending_debt" {
            return Err(AdapterError::NotApplicable(format!("morpho_blue_market does not value {}", node.kind)));
        }
        let id = market_id(node)?;
        match stage {
            0 => Ok(vec![
                read(node.contract, MORPHO_POSITION, vec![id.clone(), node.account.to_lowercase()]),
                read(node.contract, MORPHO_MARKET, vec![id.clone()]),
                read(node.contract, MORPHO_ID_TO_MARKET_PARAMS, vec![id]),
            ]),
            1 => {
                let params = decode_market_params(&prior(node.prior, MORPHO_ID_TO_MARKET_PARAMS, &[id])?)?;
                let loan = format!("{:#x}", params.loanToken);
                Ok(vec![read(&loan, ERC20_DECIMALS, vec![]), read(&loan, ERC20_SYMBOL, vec![])])
            }
            _ => Ok(vec![]),
        }
    }

    fn decode(&self, node: &NodeCtx<'_>, stage: u32, reads: &[VerifiedRead]) -> Result<Decoded, AdapterError> {
        let id = market_id(node)?;
        match stage {
            0 => {
                decode_position(&find(reads, MORPHO_POSITION, &[id.clone(), node.account.to_lowercase()])?.bytes)?;
                decode_market(&find(reads, MORPHO_MARKET, &[id.clone()])?.bytes)?;
                let params = decode_market_params(&find(reads, MORPHO_ID_TO_MARKET_PARAMS, &[id])?.bytes)?;
                if format!("{:#x}", params.id()) != node.market_id.unwrap_or_default().to_lowercase() {
                    return Err(AdapterError::Decode("idToMarketParams does not hash to the requested market id".to_owned()));
                }
                Ok(Decoded { stage_complete: false, ..Decoded::default() })
            }
            1 => {
                let position = decode_position(&prior(node.prior, MORPHO_POSITION, &[id.clone(), node.account.to_lowercase()])?)?;
                let market = decode_market(&prior(node.prior, MORPHO_MARKET, &[id.clone()])?)?;
                let params = decode_market_params(&prior(node.prior, MORPHO_ID_TO_MARKET_PARAMS, &[id.clone()])?)?;
                let decimals = decode_u8(ERC20_DECIMALS, &find(reads, ERC20_DECIMALS, &[])?.bytes)?;
                let symbol = decode_string(ERC20_SYMBOL, &find(reads, ERC20_SYMBOL, &[])?.bytes)?;
                let loan = format!("{:#x}", params.loanToken);
                let (raw, view) = if node.kind == "lending_supply" {
                    let assets = supply_shares_to_assets_down(position.supplyShares, market.totalSupplyAssets, market.totalSupplyShares);
                    (assets, Some("morpho_market.shares_to_assets"))
                } else {
                    let assets = borrow_shares_to_assets_up(
                        U256::from(position.borrowShares),
                        U256::from(market.totalBorrowAssets),
                        U256::from(market.totalBorrowShares),
                    );
                    (assets, None)
                };
                let mut child_hints = Vec::new();
                if node.kind == "lending_supply" && position.borrowShares > 0 {
                    child_hints.push(hint("lending_debt", node.contract, node.account, "morpho_blue_market", Some(id)));
                }
                // The posted view's evidence lives in the prior stage; index 0 there is `position`.
                let posted_views = view
                    .map(|view_id| vec![PostedView { view_id: view_id.to_owned(), value_raw: raw.to_string(), evidence_index: 0 }])
                    .unwrap_or_default();
                Ok(Decoded {
                    quantity: Some(Quantity { raw: raw.to_string(), decimals, symbol, asset: loan }),
                    posted_views,
                    child_hints,
                    interface: Some("morpho_blue"),
                    stage_complete: true,
                    ..Decoded::default()
                })
            }
            _ => Err(AdapterError::NotApplicable(format!("morpho_blue_market has no stage {stage}"))),
        }
    }
}
