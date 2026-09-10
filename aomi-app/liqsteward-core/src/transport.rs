//! Byte identity across the model.
//!
//! Host read tools stamp every result with `result_keccak`. The model relays
//! `raw_result` and `result_keccak` into an app tool as prompt text, and
//! re-typing can corrupt long strings. An app must therefore never trust a
//! relayed value until it has re-hashed the bytes and matched the stamp.
//! A mismatch is not an error to work around: the node it was meant to
//! populate stays `unresolved(transport_digest_mismatch)` and the agent
//! re-runs the read.

use alloy_primitives::{hex, keccak256};
use std::fmt;

/// Upper bound on one relayed result, in characters of `0x`-prefixed hex.
/// Adapters plan one function per read so results stay far under the host's
/// 6 000-character persisted-result truncation; anything larger is refused
/// before hashing because a truncated payload can never match its stamp.
pub const MAX_RAW_RESULT_CHARS: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// `raw_result` is longer than [`MAX_RAW_RESULT_CHARS`].
    Oversized { chars: usize },
    /// `raw_result` or `result_keccak` is not valid `0x` hex.
    InvalidHex { field: &'static str, detail: String },
    /// `result_keccak` is not 32 bytes.
    BadDigestLength { bytes: usize },
    /// `keccak256(raw_result) != result_keccak`.
    DigestMismatch { expected: String, actual: String },
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Oversized { chars } => write!(
                f,
                "raw_result is {chars} chars, over the {MAX_RAW_RESULT_CHARS} char transport bound"
            ),
            Self::InvalidHex { field, detail } => write!(f, "{field} is not valid hex: {detail}"),
            Self::BadDigestLength { bytes } => {
                write!(f, "result_keccak must be 32 bytes, got {bytes}")
            }
            Self::DigestMismatch { expected, actual } => write!(
                f,
                "transport digest mismatch: host stamped {expected}, relayed bytes hash to {actual}"
            ),
        }
    }
}

impl std::error::Error for TransportError {}

/// The reason code an unresolved node carries for each transport failure.
impl TransportError {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::Oversized { .. } => "read_oversized",
            Self::InvalidHex { .. } | Self::BadDigestLength { .. } => "transport_invalid_hex",
            Self::DigestMismatch { .. } => "transport_digest_mismatch",
        }
    }
}

/// Lowercase `0x`-prefixed keccak-256 of `bytes`.
pub fn keccak_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(keccak256(bytes)))
}

/// Decode `0x`-prefixed hex. An empty payload (`0x`) is valid and yields no
/// bytes, which is what an `eth_call` to a non-contract returns.
pub fn decode_hex(field: &'static str, value: &str) -> Result<Vec<u8>, TransportError> {
    let stripped = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .ok_or_else(|| TransportError::InvalidHex {
            field,
            detail: "missing 0x prefix".to_owned(),
        })?;
    hex::decode(stripped).map_err(|error| TransportError::InvalidHex {
        field,
        detail: error.to_string(),
    })
}

/// Verify that `raw_result` is the exact payload the host stamped with
/// `result_keccak`, returning the decoded bytes on success.
pub fn verify_result(raw_result: &str, result_keccak: &str) -> Result<Vec<u8>, TransportError> {
    if raw_result.len() > MAX_RAW_RESULT_CHARS {
        return Err(TransportError::Oversized {
            chars: raw_result.len(),
        });
    }
    let expected = decode_hex("result_keccak", result_keccak)?;
    if expected.len() != 32 {
        return Err(TransportError::BadDigestLength {
            bytes: expected.len(),
        });
    }
    let bytes = decode_hex("raw_result", raw_result)?;
    let actual = keccak256(&bytes);
    if actual.as_slice() != expected.as_slice() {
        return Err(TransportError::DigestMismatch {
            expected: format!("0x{}", hex::encode(expected)),
            actual: format!("0x{}", hex::encode(actual)),
        });
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_WORD: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";

    #[test]
    fn accepts_a_faithfully_relayed_result() {
        let bytes = decode_hex("raw_result", ONE_WORD).unwrap();
        let stamp = keccak_hex(&bytes);
        assert_eq!(verify_result(ONE_WORD, &stamp).unwrap(), bytes);
    }

    #[test]
    fn a_single_retyped_nibble_is_a_digest_mismatch() {
        let bytes = decode_hex("raw_result", ONE_WORD).unwrap();
        let stamp = keccak_hex(&bytes);
        let corrupted = ONE_WORD.replace("01", "02");
        let error = verify_result(&corrupted, &stamp).unwrap_err();
        assert!(matches!(error, TransportError::DigestMismatch { .. }));
        assert_eq!(error.reason(), "transport_digest_mismatch");
    }

    #[test]
    fn uppercase_prefix_and_mixed_case_hex_still_hash_the_same_bytes() {
        let bytes = decode_hex("raw_result", ONE_WORD).unwrap();
        let stamp = keccak_hex(&bytes).to_uppercase().replace("0X", "0x");
        let relayed = format!("0X{}", &ONE_WORD[2..].to_uppercase());
        assert_eq!(verify_result(&relayed, &stamp).unwrap(), bytes);
    }

    #[test]
    fn empty_payload_is_valid_and_hashes_to_the_empty_keccak() {
        let stamp = keccak_hex(&[]);
        assert_eq!(
            stamp,
            "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
        assert!(verify_result("0x", &stamp).unwrap().is_empty());
    }

    #[test]
    fn oversized_results_are_refused_before_hashing() {
        let big = format!("0x{}", "00".repeat(MAX_RAW_RESULT_CHARS));
        let error = verify_result(&big, &keccak_hex(&[])).unwrap_err();
        assert!(matches!(error, TransportError::Oversized { .. }));
        assert_eq!(error.reason(), "read_oversized");
    }

    #[test]
    fn malformed_inputs_name_the_field() {
        assert!(matches!(
            verify_result("0x01", "0xzz").unwrap_err(),
            TransportError::InvalidHex {
                field: "result_keccak",
                ..
            }
        ));
        assert!(matches!(
            verify_result("01", &keccak_hex(&[1])).unwrap_err(),
            TransportError::InvalidHex {
                field: "raw_result",
                ..
            }
        ));
        assert!(matches!(
            verify_result("0x01", "0x0102").unwrap_err(),
            TransportError::BadDigestLength { bytes: 2 }
        ));
    }
}
