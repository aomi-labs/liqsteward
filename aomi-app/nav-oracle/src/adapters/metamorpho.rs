use super::{Adapter, AdapterError, Decoded, NodeCtx, VerifiedRead, find, hint, prior, read};
use crate::model::{BaseAsset, ExpectedRead, PostedView};
use liqsteward_core::abi::{
    ERC20_DECIMALS, ERC20_SYMBOL, ERC4626_ASSET, ERC4626_TOTAL_ASSETS, METAMORPHO_LAST_TOTAL_ASSETS,
    METAMORPHO_MORPHO, METAMORPHO_WITHDRAW_QUEUE, METAMORPHO_WITHDRAW_QUEUE_LENGTH, decode_address,
    decode_bytes32, decode_string, decode_u256, decode_u8,
};

/// `account` node whose contract is a MetaMorpho vault: the vault holds
/// Morpho Blue supply positions across its withdraw queue plus any idle
/// base-asset balance. Two stages: the first learns the queue length and the
/// posted views, the second enumerates the queue.
pub struct MetaMorphoVault;

impl Adapter for MetaMorphoVault {
    fn id(&self) -> &'static str {
        "metamorpho_vault"
    }
    fn version(&self) -> &'static str {
        "1.0.0"
    }
    fn protocol(&self) -> &'static str {
        "metamorpho"
    }

    fn plan(&self, node: &NodeCtx<'_>, stage: u32) -> Result<Vec<ExpectedRead>, AdapterError> {
        if node.kind != "account" {
            return Err(AdapterError::NotApplicable(format!("metamorpho_vault expands account nodes, not {}", node.kind)));
        }
        match stage {
            0 => Ok(vec![
                read(node.contract, ERC4626_TOTAL_ASSETS, vec![]),
                read(node.contract, METAMORPHO_LAST_TOTAL_ASSETS, vec![]),
                read(node.contract, ERC4626_ASSET, vec![]),
                read(node.contract, METAMORPHO_MORPHO, vec![]),
                read(node.contract, METAMORPHO_WITHDRAW_QUEUE_LENGTH, vec![]),
            ]),
            1 => {
                let length = decode_u256(METAMORPHO_WITHDRAW_QUEUE_LENGTH, &prior(node.prior, METAMORPHO_WITHDRAW_QUEUE_LENGTH, &[])?)?;
                let asset = decode_address(ERC4626_ASSET, &prior(node.prior, ERC4626_ASSET, &[])?)?;
                let asset = format!("{asset:#x}");
                let length = length.to::<u64>();
                let mut reads = (0..length)
                    .map(|index| read(node.contract, METAMORPHO_WITHDRAW_QUEUE, vec![index.to_string()]))
                    .collect::<Vec<_>>();
                reads.push(read(&asset, ERC20_DECIMALS, vec![]));
                reads.push(read(&asset, ERC20_SYMBOL, vec![]));
                Ok(reads)
            }
            _ => Ok(vec![]),
        }
    }

    fn decode(&self, node: &NodeCtx<'_>, stage: u32, reads: &[VerifiedRead]) -> Result<Decoded, AdapterError> {
        match stage {
            0 => {
                let total = find(reads, ERC4626_TOTAL_ASSETS, &[])?;
                let total_assets = decode_u256(ERC4626_TOTAL_ASSETS, &total.bytes)?;
                let last = find(reads, METAMORPHO_LAST_TOTAL_ASSETS, &[])?;
                let last_total_assets = decode_u256(METAMORPHO_LAST_TOTAL_ASSETS, &last.bytes)?;
                decode_address(ERC4626_ASSET, &find(reads, ERC4626_ASSET, &[])?.bytes)?;
                decode_address(METAMORPHO_MORPHO, &find(reads, METAMORPHO_MORPHO, &[])?.bytes)?;
                decode_u256(METAMORPHO_WITHDRAW_QUEUE_LENGTH, &find(reads, METAMORPHO_WITHDRAW_QUEUE_LENGTH, &[])?.bytes)?;
                let index_of = |target: &VerifiedRead| reads.iter().position(|read| std::ptr::eq(read, target)).unwrap_or(0);
                Ok(Decoded {
                    posted_views: vec![
                        PostedView { view_id: "metamorpho.total_assets".to_owned(), value_raw: total_assets.to_string(), evidence_index: index_of(total) },
                        PostedView { view_id: "metamorpho.last_total_assets".to_owned(), value_raw: last_total_assets.to_string(), evidence_index: index_of(last) },
                    ],
                    interface: Some("erc4626"),
                    stage_complete: false,
                    ..Decoded::default()
                })
            }
            1 => {
                let length = decode_u256(METAMORPHO_WITHDRAW_QUEUE_LENGTH, &prior(node.prior, METAMORPHO_WITHDRAW_QUEUE_LENGTH, &[])?)?.to::<u64>();
                let asset = decode_address(ERC4626_ASSET, &prior(node.prior, ERC4626_ASSET, &[])?)?;
                let morpho = decode_address(METAMORPHO_MORPHO, &prior(node.prior, METAMORPHO_MORPHO, &[])?)?;
                let asset = format!("{asset:#x}");
                let morpho = format!("{morpho:#x}");
                let mut child_hints = Vec::with_capacity(length as usize + 1);
                for index in 0..length {
                    let entry = find(reads, METAMORPHO_WITHDRAW_QUEUE, &[index.to_string()])?;
                    let market_id = decode_bytes32(METAMORPHO_WITHDRAW_QUEUE, &entry.bytes)?;
                    child_hints.push(hint("lending_supply", &morpho, node.contract, "morpho_blue_market", Some(format!("{market_id:#x}"))));
                }
                child_hints.push(hint("token_balance", &asset, node.contract, "erc20_balance", None));
                let decimals = decode_u8(ERC20_DECIMALS, &find(reads, ERC20_DECIMALS, &[])?.bytes)?;
                let symbol = decode_string(ERC20_SYMBOL, &find(reads, ERC20_SYMBOL, &[])?.bytes)?;
                Ok(Decoded {
                    child_hints,
                    base_asset: Some(BaseAsset { address: asset, symbol, decimals }),
                    interface: Some("erc4626"),
                    stage_complete: true,
                    ..Decoded::default()
                })
            }
            _ => Err(AdapterError::NotApplicable(format!("metamorpho_vault has no stage {stage}"))),
        }
    }
}
