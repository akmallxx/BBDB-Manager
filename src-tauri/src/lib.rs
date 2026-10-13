use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

static BACKEND_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

fn ensure_backend_running() {
    let addr = "127.0.0.1:3000";
    if let Ok(socket_addr) = addr.parse() {
        if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(300)).is_ok() {
            return;
        }
    }

    // Try starting server via bun or node if not already running
    let child = Command::new("bun")
        .args(["run", "server.ts"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            Command::new("node")
                .args(["server.ts"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        });

    if let Ok(c) = child {
        if let Ok(mut lock) = BACKEND_PROCESS.lock() {
            *lock = Some(c);
        }
        std::thread::sleep(Duration::from_millis(600));
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
