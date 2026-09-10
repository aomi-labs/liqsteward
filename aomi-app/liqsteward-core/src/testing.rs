//! Manifest assertions every app crate runs in its own tests.
//!
//! Model providers reject a tool whose parameter schema has an untyped
//! property or an open object, and one rejected tool fails the whole app
//! load. These checks run over the serialized manifest so the failure is a
//! unit test, not a deploy.

use aomi_sdk::{AOMI_SDK_VERSION, DynManifest};
use serde_json::Value;

/// Every `type: object` schema in `value` must carry object-valued
/// `properties`.
pub fn assert_strict_object_schemas(value: &Value, path: &str) {
    match value {
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("object") {
                assert!(
                    object.get("properties").is_some_and(Value::is_object),
                    "object schema at {path} must contain object-valued properties: {value}"
                );
            }
            for (key, child) in object {
                assert_strict_object_schemas(child, &format!("{path}/{key}"));
            }
        }
        Value::Array(array) => {
            for (index, child) in array.iter().enumerate() {
                assert_strict_object_schemas(child, &format!("{path}/{index}"));
            }
        }
        _ => {}
    }
}

/// Every declared tool-parameter property has a type (or `$ref` / `anyOf` /
/// `oneOf`), and any explicit `additionalProperties` is `false`.
pub fn assert_tool_parameter_properties_typed(manifest: &Value) {
    let tools = manifest["tools"].as_array().expect("manifest tools");
    for tool in tools {
        let name = tool["name"].as_str().unwrap_or("?");
        let Some(properties) = tool
            .get("parameters")
            .and_then(|parameters| parameters.get("properties"))
            .and_then(Value::as_object)
        else {
            continue;
        };
        for (property, schema) in properties {
            assert!(
                schema.get("type").is_some()
                    || schema.get("$ref").is_some()
                    || schema.get("anyOf").is_some()
                    || schema.get("oneOf").is_some(),
                "tool `{name}` property `{property}` has no type: {schema}"
            );
            if let Some(additional) = schema.get("additionalProperties") {
                assert_eq!(
                    additional,
                    &Value::Bool(false),
                    "tool `{name}` property `{property}` declares an open object"
                );
            }
        }
    }
}

/// The three checks every app runs: SDK pin, strict schemas, typed
/// properties, plus skill validation when the app declares any.
pub fn assert_manifest_is_loadable(manifest: &DynManifest) {
    assert_eq!(
        manifest.sdk_version, AOMI_SDK_VERSION,
        "manifest must be built against the workspace-pinned SDK"
    );
    let json = serde_json::to_value(manifest).expect("manifest serializes");
    assert_strict_object_schemas(&json, "manifest");
    assert_tool_parameter_properties_typed(&json);
    aomi_sdk::validate_app_skills(&manifest.name, &manifest.skills)
        .unwrap_or_else(|errors| panic!("app skills invalid: {errors:?}"));
    for skill in &manifest.skills {
        skill
            .validate(&manifest.name)
            .unwrap_or_else(|errors| panic!("skill `{}` invalid: {errors:?}", skill.id));
    }
}
