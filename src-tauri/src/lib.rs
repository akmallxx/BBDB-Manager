use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static BACKEND_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

fn get_data_dir() -> PathBuf {
    // 1. Windows USERPROFILE or Linux/macOS HOME (matches server.ts os.homedir()/.bbdb-manager)
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let p = PathBuf::from(home).join(".bbdb-manager");
        let _ = std::fs::create_dir_all(&p);
        return p;
    }

    // 2. Windows AppData fallback
    if let Ok(appdata) = std::env::var("APPDATA") {
        let p = PathBuf::from(appdata).join("bbdb-manager");
        let _ = std::fs::create_dir_all(&p);
        return p;
    }

    // 3. Fallback to local .bbdb-manager folder
    let p = PathBuf::from(".bbdb-manager");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn apply_silent_spawn_options(cmd: &mut Command, data_dir: &PathBuf) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Redirect stdout and stderr quietly to backend.log so errors can be inspected without popping up a console
    let log_path = data_dir.join("backend.log");
    if let Ok(log_file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        if let Ok(err_file) = log_file.try_clone() {
            cmd.stdin(Stdio::null())
                .stdout(Stdio::from(log_file))
                .stderr(Stdio::from(err_file));
            return;
        }
    }

    // Fallback: completely suppress if log file cannot be opened
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

fn find_server_binary() -> Option<PathBuf> {
    let exe_extensions: &[&str] = if cfg!(windows) {
        &[".exe", ""]
    } else {
        &[""]
    };

    let is_valid_binary_name = |fname: &str| -> bool {
        if !fname.starts_with("bbdb-server") {
            return false;
        }
        if cfg!(windows) {
            fname.ends_with(".exe")
        } else {
            !fname.ends_with(".d") && !fname.ends_with(".pdb") && !fname.contains('.')
        }
    };

    // 1. Check directory containing current running executable (e.g. C:\Program Files\BBDB Manager or /usr/bin/)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Check direct binary name: bbdb-server, bbdb-server.exe
            for ext in exe_extensions {
                let candidate = exe_dir.join(format!("bbdb-server{}", ext));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }

            // Check target-suffixed binary in exe_dir (e.g. bbdb-server-x86_64-pc-windows-msvc.exe)
            if let Ok(entries) = std::fs::read_dir(exe_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                            if is_valid_binary_name(fname) {
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
                                if is_valid_binary_name(fname) {
                                    return Some(path);
                                }
                            }
                        }
                    }
                }
            }

            // Check in exe_dir/resources/ (Tauri installer resource bundling)
            let resources_sub = exe_dir.join("resources");
            if resources_sub.is_dir() {
                if let Ok(entries) = std::fs::read_dir(resources_sub) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                                if is_valid_binary_name(fname) {
                                    return Some(path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. AppImage APPDIR environment variable (Linux)
    if let Ok(appdir) = std::env::var("APPDIR") {
        let in_appdir = PathBuf::from(appdir).join("usr/bin/bbdb-server");
        if in_appdir.is_file() {
            return Some(in_appdir);
        }
    }

    // 3. System installation paths (Linux / Unix)
    for p in &["/usr/bin/bbdb-server", "/usr/local/bin/bbdb-server"] {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }

    // 4. Source tree workspace locations (useful during development / testing)
    let cwd_candidates = [
        "src-tauri/binaries/bbdb-server-x86_64-pc-windows-msvc.exe",
        "binaries/bbdb-server-x86_64-pc-windows-msvc.exe",
        "src-tauri/binaries/bbdb-server-x86_64-unknown-linux-gnu",
        "binaries/bbdb-server-x86_64-unknown-linux-gnu",
        "src-tauri/binaries/bbdb-server-aarch64-apple-darwin",
        "binaries/bbdb-server-aarch64-apple-darwin",
        "src-tauri/target/release/bbdb-server.exe",
        "src-tauri/target/release/bbdb-server",
        "src-tauri/target/debug/bbdb-server.exe",
        "src-tauri/target/debug/bbdb-server",
    ];
    for rel in &cwd_candidates {
        let path = PathBuf::from(rel);
        if path.is_file() {
            return Some(path);
        }
    }

    // Also check if src-tauri/binaries or binaries has any bbdb-server*
    for dir in &["src-tauri/binaries", "binaries"] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                        if fname.starts_with("bbdb-server") && !fname.ends_with(".d") && !fname.ends_with(".pdb") {
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

    let data_dir = get_data_dir();

    let child = if let Some(server_bin) = find_server_binary() {
        eprintln!("[BBDB] Starting bundled backend server: {:?}", server_bin);
        let mut cmd = Command::new(server_bin);
        cmd.env("PORT", &port)
            .env("HOST", "127.0.0.1")
            .env("NODE_ENV", "production")
            .env("BBDB_DATA_DIR", &data_dir);
        apply_silent_spawn_options(&mut cmd, &data_dir);
        cmd.spawn()
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
            .env("PORT", &port)
            .env("HOST", "127.0.0.1")
            .env("BBDB_DATA_DIR", &data_dir);
        apply_silent_spawn_options(&mut bun_cmd, &data_dir);
        bun_cmd.spawn()
            .or_else(|_| {
                let mut node_cmd = Command::new("node");
                node_cmd.args(["server.ts"])
                    .env("PORT", &port)
                    .env("HOST", "127.0.0.1")
                    .env("BBDB_DATA_DIR", &data_dir);
                apply_silent_spawn_options(&mut node_cmd, &data_dir);
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
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut lock) = BACKEND_PROCESS.lock() {
                    if let Some(mut child) = lock.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Clean up child process when Tauri window exits
    if let Ok(mut lock) = BACKEND_PROCESS.lock() {
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
