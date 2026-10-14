use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

static BACKEND_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

fn find_server_binary() -> Option<PathBuf> {
    // 1. Check directory containing current running executable (e.g. /usr/bin/ or target/release/)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Check direct binary name: /usr/bin/bbdb-server or target/release/bbdb-server
            let candidate = exe_dir.join("bbdb-server");
            if candidate.is_file() {
                return Some(candidate);
            }

            // Check target-suffixed binary in exe_dir
            if let Ok(entries) = std::fs::read_dir(exe_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                            if fname.starts_with("bbdb-server") && !fname.ends_with(".d") {
                                return Some(path);
                            }
                        }
                    }
                }
            }

            // Check in exe_dir/binaries/
            let binaries_sub = exe_dir.join("binaries");
            if binaries_sub.is_dir() {
                if let Ok(entries) = std::fs::read_dir(binaries_sub) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                                if fname.starts_with("bbdb-server") {
                                    return Some(path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. AppImage APPDIR environment variable
    if let Ok(appdir) = std::env::var("APPDIR") {
        let in_appdir = PathBuf::from(appdir).join("usr/bin/bbdb-server");
        if in_appdir.is_file() {
            return Some(in_appdir);
        }
    }

    // 3. System installation paths
    for p in &["/usr/bin/bbdb-server", "/usr/local/bin/bbdb-server"] {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    // 4. Source tree workspace locations (useful during development / testing)
    let cwd_candidates = [
        "src-tauri/binaries/bbdb-server-x86_64-unknown-linux-gnu",
        "binaries/bbdb-server-x86_64-unknown-linux-gnu",
        "src-tauri/target/release/bbdb-server",
        "src-tauri/target/debug/bbdb-server",
    ];
    for rel in &cwd_candidates {
        let path = PathBuf::from(rel);
        if path.is_file() {
            return Some(path);
        }
    }

    // Also check if src-tauri/binaries has any bbdb-server*
    for dir in &["src-tauri/binaries", "binaries"] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                        if fname.starts_with("bbdb-server") {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }

    None
}

fn ensure_backend_running() {
    let default_port = env!("APP_PORT");
    let port = std::env::var("PORT").unwrap_or_else(|_| default_port.to_string());
    let addr = format!("127.0.0.1:{}", port);

    // If backend is already running on this port, do nothing
    if let Ok(socket_addr) = addr.parse::<std::net::SocketAddr>() {
        if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(300)).is_ok() {
            eprintln!("[BBDB] Backend already running on {}", addr);
            return;
        }
    }

    // Compute user data directory (~/.bbdb-manager)
    let data_dir = std::env::var("HOME").ok().map(|h| {
        let p = PathBuf::from(h).join(".bbdb-manager");
        let _ = std::fs::create_dir_all(&p);
        p
    });

    let child = if let Some(server_bin) = find_server_binary() {
        eprintln!("[BBDB] Starting bundled backend server: {:?}", server_bin);
        let mut cmd = Command::new(server_bin);
        cmd.env("PORT", &port)
            .env("NODE_ENV", "production");
        if let Some(ref d) = data_dir {
            cmd.env("BBDB_DATA_DIR", d);
        }
        cmd.stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
    } else {
        eprintln!("[BBDB] Bundled binary not found. Falling back to bun/node development server...");
        // Check bun in PATH or home
        let bun_path = if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(&home).join(".bun/bin/bun");
            if p.is_file() {
                p.to_string_lossy().to_string()
            } else {
                "bun".to_string()
            }
        } else {
            "bun".to_string()
        };

        let mut bun_cmd = Command::new(&bun_path);
        bun_cmd.args(["run", "server.ts"])
            .env("PORT", &port);
        if let Some(ref d) = data_dir {
            bun_cmd.env("BBDB_DATA_DIR", d);
        }
        bun_cmd.stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .or_else(|_| {
                let mut node_cmd = Command::new("node");
                node_cmd.args(["server.ts"]).env("PORT", &port);
                if let Some(ref d) = data_dir {
                    node_cmd.env("BBDB_DATA_DIR", d);
                }
                node_cmd.spawn()
            })
    };

    match child {
        Ok(mut c) => {
            // Wait for backend to be ready on the TCP port
            if let Ok(socket_addr) = addr.parse::<std::net::SocketAddr>() {
                let start = std::time::Instant::now();
                let timeout = Duration::from_secs(8);
                let mut ready = false;
                while start.elapsed() < timeout {
                    // Check if child exited prematurely
                    if let Ok(Some(status)) = c.try_wait() {
                        eprintln!("[BBDB] Error: Backend process exited immediately with status: {:?}", status);
                        break;
                    }
                    if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(80)).is_ok() {
                        ready = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                if ready {
                    eprintln!("[BBDB] Backend successfully running on {}", addr);
                } else {
                    eprintln!("[BBDB] Warning: Backend not responsive on {} after {}s", addr, timeout.as_secs());
                }
            }

            if let Ok(mut lock) = BACKEND_PROCESS.lock() {
                *lock = Some(c);
            }
        }
        Err(err) => {
            eprintln!("[BBDB] Failed to spawn backend process: {}", err);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_backend_running();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Clean up child process when Tauri window exits
    if let Ok(mut lock) = BACKEND_PROCESS.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }
}
