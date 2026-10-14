fn main() {
    let port = std::env::var("PORT").ok().or_else(|| {
        std::fs::read_to_string("../.env").ok().and_then(|content| {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("PORT=") {
                    return trimmed
                        .strip_prefix("PORT=")
                        .map(|v| v.trim_matches('"').trim_matches('\'').trim().to_string());
                }
            }
            None
        })
    }).unwrap_or_else(|| "3000".to_string());

    println!("cargo:rustc-env=APP_PORT={}", port);
    println!("cargo:rerun-if-changed=../.env");
    tauri_build::build();
}
