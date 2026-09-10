use super::{Adapter, AdapterError, Decoded, NodeCtx, VerifiedRead, find, read};
use crate::model::{ExpectedRead, Quantity};
use liqsteward_core::abi::{ERC20_BALANCE_OF, ERC20_DECIMALS, ERC20_SYMBOL, decode_string, decode_u256, decode_u8};

/// `token_balance`: an ERC-20 balance held by `account` on `contract`.
pub struct Erc20Balance;

impl Adapter for Erc20Balance {
    fn id(&self) -> &'static str {
        "erc20_balance"
    }
    fn version(&self) -> &'static str {
        "1.0.0"
    }
    fn protocol(&self) -> &'static str {
        "erc20"
    }

    fn plan(&self, node: &NodeCtx<'_>, stage: u32) -> Result<Vec<ExpectedRead>, AdapterError> {
        if node.kind != "token_balance" {
            return Err(AdapterError::NotApplicable(format!("erc20_balance does not value {}", node.kind)));
        }
        Ok(match stage {
            0 => vec![
                read(node.contract, ERC20_BALANCE_OF, vec![node.account.to_lowercase()]),
                read(node.contract, ERC20_DECIMALS, vec![]),
                read(node.contract, ERC20_SYMBOL, vec![]),
            ],
            _ => vec![],
        })
    }

    fn decode(&self, node: &NodeCtx<'_>, stage: u32, reads: &[VerifiedRead]) -> Result<Decoded, AdapterError> {
        if stage != 0 {
            return Err(AdapterError::NotApplicable(format!("erc20_balance has no stage {stage}")));
        }
        let balance = decode_u256(ERC20_BALANCE_OF, &find(reads, ERC20_BALANCE_OF, &[node.account.to_lowercase()])?.bytes)?;
        let decimals = decode_u8(ERC20_DECIMALS, &find(reads, ERC20_DECIMALS, &[])?.bytes)?;
        let symbol = decode_string(ERC20_SYMBOL, &find(reads, ERC20_SYMBOL, &[])?.bytes)?;
        Ok(Decoded {
            quantity: Some(Quantity {
                raw: balance.to_string(),
                decimals,
                symbol,
                asset: node.contract.to_lowercase(),
            }),
            interface: Some("erc20"),
            stage_complete: true,
            ..Decoded::default()
        })
    }
}
