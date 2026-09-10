//! Shared building blocks for the LiqSteward family of Aomi apps.
//!
//! Everything here is host-agnostic: no app in this workspace performs its
//! own chain reads. The agent calls host read tools (`evm-reads`,
//! `evm-sim`), relays the small keccak-stamped results to an app tool, and
//! the app re-verifies and decodes the bytes with the helpers in this crate.
//!
//! - [`transport`]: the byte-identity bridge across the model (keccak
//!   re-hash of relayed results).
//! - [`abi`]: function signatures and strict decoders for the venues the
//!   NAV oracle values (ERC-20, ERC-4626, MetaMorpho, Morpho Blue).
//! - [`morpho`]: pilot constants, market-id derivation, and the structured
//!   `reallocate` encode args that survive model transport.
//! - [`bff`]: the authenticated client for the LiqSteward backend.
//! - [`testing`]: manifest assertions every app crate runs in its tests.

pub mod abi;
pub mod bff;
pub mod morpho;
pub mod testing;
pub mod transport;
