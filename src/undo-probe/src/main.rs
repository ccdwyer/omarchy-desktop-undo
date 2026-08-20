//! undo-probe — process forensics for Desktop Undo.
//!
//! Commands:
//!   undo-probe pid <pid>
//!       Walk /proc/<pid>/task/*/children to the deepest shell child and
//!       print {cmdline, cwd, argv, shellPid} as JSON. Never reads environ.
//!   undo-probe cookie <uuid> [pid...]
//!       Look for DESKTOP_UNDO_COOKIE=<uuid> in the environ of the given
//!       pids (and their descendants). If no pids are given, scans /proc.
//!       Environ is read for matching only; it is never persisted.
//!   undo-probe init-state [dir]
//!       Create the journal directory mode 0700 and journal.json mode 0600.
//!   undo-probe secure <path>
//!       chmod 0600 a file, 0700 its parent directory.

mod probe;

use probe::{cookie_match, deepest_shell, json_escape, ProbeError};
use std::env;
use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process;

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print_usage();
        process::exit(0);
    }
    if args[0] == "--version" {
        println!("undo-probe 1.0.0");
        process::exit(0);
    }

    // Test/compat hook: UNDP_PROC_ROOT overrides /proc.
    if let Ok(root) = env::var("UNDP_PROC_ROOT") {
        if !root.is_empty() {
            probe::set_proc_root(PathBuf::from(root));
        }
    }

    let cmd = args.remove(0);
    let result = match cmd.as_str() {
        "pid" => cmd_pid(&args),
        "cookie" => cmd_cookie(&args),
        "init-state" => cmd_init_state(&args),
        "secure" => cmd_secure(&args),
        other => Err(ProbeError::Usage(format!("unknown command: {other}"))),
    };

    match result {
        Ok(body) => {
            let mut stdout = io::stdout().lock();
            let _ = writeln!(stdout, "{body}");
        }
        Err(ProbeError::Usage(msg)) => {
            eprintln!("undo-probe: {msg}");
            print_usage();
            process::exit(2);
        }
        Err(ProbeError::NotFound(msg)) => {
            let _ = writeln!(io::stdout(), "{{\"ok\":false,\"error\":{}}}", json_escape(&msg));
            process::exit(1);
        }
        Err(ProbeError::Io(err)) => {
            eprintln!("undo-probe: {err}");
            process::exit(1);
        }
    }
}

fn print_usage() {
    eprintln!(
        "usage:\n  undo-probe pid <pid>\n  undo-probe cookie <uuid> [pid...]\n  undo-probe init-state [dir]\n  undo-probe secure <path>"
    );
}

fn cmd_pid(args: &[String]) -> Result<String, ProbeError> {
    let pid: i32 = args
        .first()
        .ok_or_else(|| ProbeError::Usage("pid requires a process id".into()))?
        .parse()
        .map_err(|_| ProbeError::Usage("pid must be an integer".into()))?;
    let info = deepest_shell(pid)?;
    Ok(info.to_json())
}

fn cmd_cookie(args: &[String]) -> Result<String, ProbeError> {
    let uuid = args
        .first()
        .ok_or_else(|| ProbeError::Usage("cookie requires a uuid".into()))?
        .clone();
    if uuid.is_empty() || uuid.len() > 128 {
        return Err(ProbeError::Usage("cookie uuid is empty or too long".into()));
    }
    let mut pids = Vec::new();
    for a in args.iter().skip(1) {
        match a.parse::<i32>() {
            Ok(p) if p > 0 => pids.push(p),
            _ => {}
        }
    }
    match cookie_match(&uuid, &pids)? {
        Some(info) => Ok(info.to_json()),
        None => Ok("{\"ok\":false,\"found\":false}".into()),
    }
}

fn default_state_dir() -> PathBuf {
    if let Ok(xdg) = env::var("XDG_STATE_HOME") {
        if !xdg.is_empty() {
            return PathBuf::from(xdg).join("desktop-undo");
        }
    }
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".local/state/desktop-undo")
}

fn cmd_init_state(args: &[String]) -> Result<String, ProbeError> {
    let dir = if let Some(p) = args.first() {
        PathBuf::from(p)
    } else {
        default_state_dir()
    };
    fs::create_dir_all(&dir).map_err(ProbeError::Io)?;
    set_mode(&dir, 0o700)?;
    let journal = dir.join("journal.json");
    if !journal.exists() {
        fs::write(&journal, "{\"version\":1,\"cursor\":0,\"entries\":[]}\n").map_err(ProbeError::Io)?;
    }
    set_mode(&journal, 0o600)?;
    Ok(format!(
        "{{\"ok\":true,\"dir\":{}}}",
        json_escape(&dir.to_string_lossy())
    ))
}

fn cmd_secure(args: &[String]) -> Result<String, ProbeError> {
    let path = args
        .first()
        .ok_or_else(|| ProbeError::Usage("secure requires a path".into()))?;
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if parent.exists() {
            set_mode(parent, 0o700)?;
        }
    }
    if p.exists() {
        set_mode(p, 0o600)?;
    }
    Ok("{\"ok\":true}".into())
}

fn set_mode(path: &Path, mode: u32) -> Result<(), ProbeError> {
    let mut perms = fs::metadata(path).map_err(ProbeError::Io)?.permissions();
    perms.set_mode(mode);
    fs::set_permissions(path, perms).map_err(ProbeError::Io)?;
    Ok(())
}
