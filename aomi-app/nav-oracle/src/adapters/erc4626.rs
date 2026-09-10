use super::{Adapter, AdapterError, Decoded, NodeCtx, VerifiedRead, find, prior, read};
use crate::model::{ExpectedRead, PostedView, Quantity};
use liqsteward_core::abi::{
    ERC20_BALANCE_OF, ERC20_DECIMALS, ERC20_SYMBOL, ERC4626_ASSET, ERC4626_CONVERT_TO_ASSETS,
    decode_address, decode_string, decode_u256, decode_u8,
};

/// `vault_share`: shares of any ERC-4626 vault held by `account`, valued in
/// the vault's underlying asset through the vault's own `convertToAssets`.
pub struct Erc4626Generic;

impl Adapter for Erc4626Generic {
    fn id(&self) -> &'static str {
        "erc4626_generic"
    }
    fn version(&self) -> &'static str {
        "1.0.0"
    }
    fn protocol(&self) -> &'static str {
        "erc4626"
    }

    fn plan(&self, node: &NodeCtx<'_>, stage: u32) -> Result<Vec<ExpectedRead>, AdapterError> {
        if node.kind != "vault_share" {
            return Err(AdapterError::NotApplicable(format!("erc4626_generic does not value {}", node.kind)));
        }
        match stage {
            0 => Ok(vec![
                read(node.contract, ERC4626_ASSET, vec![]),
                read(node.contract, ERC20_BALANCE_OF, vec![node.account.to_lowercase()]),
            ]),
            1 => {
                let asset = decode_address(ERC4626_ASSET, &prior(node.prior, ERC4626_ASSET, &[])?)?;
                let balance = decode_u256(ERC20_BALANCE_OF, &prior(node.prior, ERC20_BALANCE_OF, &[node.account.to_lowercase()])?)?;
                let asset = format!("{asset:#x}");
                Ok(vec![
                    read(node.contract, ERC4626_CONVERT_TO_ASSETS, vec![balance.to_string()]),
                    read(&asset, ERC20_DECIMALS, vec![]),
                    read(&asset, ERC20_SYMBOL, vec![]),
                ])
            }
            _ => Ok(vec![]),
        }
    }

    fn decode(&self, node: &NodeCtx<'_>, stage: u32, reads: &[VerifiedRead]) -> Result<Decoded, AdapterError> {
        match stage {
            0 => {
                decode_address(ERC4626_ASSET, &find(reads, ERC4626_ASSET, &[])?.bytes)?;
                decode_u256(ERC20_BALANCE_OF, &find(reads, ERC20_BALANCE_OF, &[node.account.to_lowercase()])?.bytes)?;
                Ok(Decoded { interface: Some("erc4626"), stage_complete: false, ..Decoded::default() })
            }
            1 => {
                let asset = decode_address(ERC4626_ASSET, &prior(node.prior, ERC4626_ASSET, &[])?)?;
                let balance = decode_u256(ERC20_BALANCE_OF, &prior(node.prior, ERC20_BALANCE_OF, &[node.account.to_lowercase()])?)?;
                let convert = find(reads, ERC4626_CONVERT_TO_ASSETS, &[balance.to_string()])?;
                let assets = decode_u256(ERC4626_CONVERT_TO_ASSETS, &convert.bytes)?;
                let decimals = decode_u8(ERC20_DECIMALS, &find(reads, ERC20_DECIMALS, &[])?.bytes)?;
                let symbol = decode_string(ERC20_SYMBOL, &find(reads, ERC20_SYMBOL, &[])?.bytes)?;
                let convert_index = reads.iter().position(|read| std::ptr::eq(read, convert)).unwrap_or(0);
                Ok(Decoded {
                    quantity: Some(Quantity {
                        raw: assets.to_string(),
                        decimals,
                        symbol,
                        asset: format!("{asset:#x}"),
                    }),
                    posted_views: vec![PostedView {
                        view_id: "erc4626.convert_to_assets".to_owned(),
                        value_raw: assets.to_string(),
                        evidence_index: convert_index,
                    }],
                    interface: Some("erc4626"),
                    stage_complete: true,
                    ..Decoded::default()
                })
            }
            _ => Err(AdapterError::NotApplicable(format!("erc4626_generic has no stage {stage}"))),
        }
    }
}
