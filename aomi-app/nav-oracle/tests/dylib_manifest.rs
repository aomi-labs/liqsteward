//! Load the built cdylib the way the host does and validate its skills with
//! the same SDK call the host loader makes.
use aomi_sdk::DynFnHandle;
use std::path::PathBuf;

#[test]
fn built_cdylib_manifest_validates_like_the_host() {
    let path = std::env::var("NAV_ORACLE_DYLIB").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/debug/libnav_oracle.dylib")
    });
    if !path.exists() {
        eprintln!("skipping: {} not built", path.display());
        return;
    }
    // SAFETY: the path is our own freshly built plugin.
    let handle = unsafe { DynFnHandle::load(&path) }.expect("dlopen");
    let manifest = handle.call_manifest().expect("manifest over FFI");
    assert_eq!(manifest.sdk_version, aomi_sdk::AOMI_SDK_VERSION);
    aomi_sdk::validate_app_skills(&manifest.name, &manifest.skills)
        .unwrap_or_else(|errors| panic!("host-side skill validation failed: {errors:?}"));
    assert_eq!(manifest.tools.len(), 8);
}

#[test]
fn print_skill_digests() {
    use aomi_sdk::DynAomiApp;
    for skill in nav_oracle::NavOracle.manifest().skills {
        eprintln!("{} {} sections={} guard={}", skill.id, skill.content_digest, skill.sections.len(), skill.guard.is_some());
    }
}
