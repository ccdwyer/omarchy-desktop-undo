use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static PROC_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

const SHELLS: &[&str] = &[
    "bash", "zsh", "fish", "sh", "dash", "mksh", "ksh", "csh", "tcsh", "nu", "elvish", "ion",
    "xonsh", "pwsh", "ash",
];

const COOKIE_KEY: &str = "DESKTOP_UNDO_COOKIE=";

#[derive(Debug)]
pub enum ProbeError {
    Usage(String),
    NotFound(String),
    Io(io::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcInfo {
    pub ok: bool,
    pub pid: i32,
    pub shell_pid: i32,
    pub cwd: String,
    pub argv: Vec<String>,
    pub cmdline: String,
    pub window_argv: Vec<String>,
    pub window_cmdline: String,
    pub found: bool,
}

impl ProcInfo {
    pub fn to_json(&self) -> String {
        let argv = self
            .argv
            .iter()
            .map(|a| json_escape(a))
            .collect::<Vec<_>>()
            .join(",");
        let window_argv = self
            .window_argv
            .iter()
            .map(|a| json_escape(a))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"ok\":{},\"found\":{},\"pid\":{},\"shellPid\":{},\"cwd\":{},\"cmdline\":{},\"argv\":[{}],\"windowArgv\":[{}],\"windowCmdline\":{}}}",
            if self.ok { "true" } else { "false" },
            if self.found { "true" } else { "false" },
            self.pid,
            self.shell_pid,
            json_escape(&self.cwd),
            json_escape(&self.cmdline),
            argv,
            window_argv,
            json_escape(&self.window_cmdline)
        )
    }
}

pub fn set_proc_root(path: PathBuf) {
    if let Ok(mut guard) = PROC_ROOT.lock() {
        *guard = Some(path);
    }
}

pub fn proc_root() -> PathBuf {
    if let Ok(guard) = PROC_ROOT.lock() {
        if let Some(ref p) = *guard {
            return p.clone();
        }
    }
    PathBuf::from("/proc")
}

pub fn json_escape(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn read_cmdline(root: &Path, pid: i32) -> Vec<String> {
    let path = root.join(pid.to_string()).join("cmdline");
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    bytes
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect()
}

fn comm_of(argv: &[String]) -> String {
    if argv.is_empty() {
        return String::new();
    }
    let first = &argv[0];
    let name = first.rsplit('/').next().unwrap_or(first);
    name.trim_start_matches('-').to_string()
}

fn is_shell(comm: &str) -> bool {
    let n = comm.to_ascii_lowercase();
    SHELLS.iter().any(|s| n == *s)
}

fn read_cwd(root: &Path, pid: i32) -> String {
    let path = root.join(pid.to_string()).join("cwd");
    match fs::read_link(&path) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => String::new(),
    }
}

/// Read `/proc/<pid>/task/*/children` (space-separated pids).
pub fn children_of(root: &Path, pid: i32) -> Vec<i32> {
    let task_dir = root.join(pid.to_string()).join("task");
    let entries = match fs::read_dir(&task_dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut kids = Vec::new();
    let mut seen = HashSet::new();
    for ent in entries.flatten() {
        let children_path = ent.path().join("children");
        let text = match fs::read_to_string(children_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for tok in text.split_whitespace() {
            if let Ok(child) = tok.parse::<i32>() {
                if child > 0 && seen.insert(child) {
                    kids.push(child);
                }
            }
        }
    }
    kids
}

#[derive(Clone)]
struct Node {
    pid: i32,
    depth: usize,
    argv: Vec<String>,
}

/// Walk the process tree. Prefer the deepest descendant whose comm is a
/// known shell; otherwise the deepest descendant. That is what makes
/// "reopens in ~/projects/demo" true for terminals.
pub fn deepest_shell(pid: i32) -> Result<ProcInfo, ProbeError> {
    let root = proc_root();
    let base = root.join(pid.to_string());
    if !base.exists() {
        return Err(ProbeError::NotFound(format!("pid {pid} not found")));
    }
    let mut queue: VecDeque<Node> = VecDeque::new();
    let mut seen = HashSet::new();
    queue.push_back(Node {
        pid,
        depth: 0,
        argv: read_cmdline(&root, pid),
    });
    seen.insert(pid);

    let mut all = Vec::new();
    while let Some(node) = queue.pop_front() {
        all.push(node.clone());
        for child in children_of(&root, node.pid) {
            if seen.insert(child) {
                queue.push_back(Node {
                    pid: child,
                    depth: node.depth + 1,
                    argv: read_cmdline(&root, child),
                });
            }
        }
    }

    let mut best_shell: Option<&Node> = None;
    let mut best_any: Option<&Node> = None;
    for n in &all {
        if best_any.map(|b| n.depth > b.depth).unwrap_or(true) {
            best_any = Some(n);
        }
        if is_shell(&comm_of(&n.argv))
            && best_shell.map(|b| n.depth >= b.depth).unwrap_or(true)
        {
            best_shell = Some(n);
        }
    }
    let chosen = best_shell.or(best_any).ok_or_else(|| {
        ProbeError::NotFound(format!("empty tree for pid {pid}"))
    })?;

    let cwd = read_cwd(&root, chosen.pid);
    let cmdline = chosen.argv.join(" ");
    let window_argv = read_cmdline(&root, pid);
    let window_cmdline = window_argv.join(" ");
    Ok(ProcInfo {
        ok: true,
        pid,
        shell_pid: chosen.pid,
        cwd,
        argv: chosen.argv.clone(),
        cmdline,
        window_argv,
        window_cmdline,
        found: true,
    })
}

fn read_environ(root: &Path, pid: i32) -> Option<Vec<u8>> {
    let path = root.join(pid.to_string()).join("environ");
    let file = fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    // Bound the read so a huge environ cannot blow memory.
    file.take(1 << 20).read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn environ_has_cookie(buf: &[u8], cookie: &str) -> bool {
    let needle = format!("{COOKIE_KEY}{cookie}");
    buf.split(|b| *b == 0)
        .any(|entry| entry == needle.as_bytes())
}

fn descendants(root: &Path, seeds: &[i32]) -> Vec<i32> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut q: VecDeque<i32> = VecDeque::new();
    for s in seeds {
        if *s > 0 && seen.insert(*s) {
            q.push_back(*s);
        }
    }
    while let Some(pid) = q.pop_front() {
        out.push(pid);
        for child in children_of(root, pid) {
            if seen.insert(child) {
                q.push_back(child);
            }
        }
    }
    out
}

fn all_pids(root: &Path) -> Vec<i32> {
    let mut pids = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return pids,
    };
    for ent in entries.flatten() {
        let name = ent.file_name();
        let s = name.to_string_lossy();
        if let Ok(pid) = s.parse::<i32>() {
            if pid > 0 {
                pids.push(pid);
            }
        }
    }
    pids
}

pub fn cookie_match(cookie: &str, seeds: &[i32]) -> Result<Option<ProcInfo>, ProbeError> {
    let root = proc_root();
    let candidates = if seeds.is_empty() {
        all_pids(&root)
    } else {
        descendants(&root, seeds)
    };
    for pid in candidates {
        if let Some(buf) = read_environ(&root, pid) {
            if environ_has_cookie(&buf, cookie) {
                let argv = read_cmdline(&root, pid);
                let cwd = read_cwd(&root, pid);
                let cmdline = argv.join(" ");
                return Ok(Some(ProcInfo {
                    ok: true,
                    pid,
                    shell_pid: pid,
                    cwd,
                    argv: argv.clone(),
                    cmdline: cmdline.clone(),
                    window_argv: argv,
                    window_cmdline: cmdline,
                    found: true,
                }));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::sync::Mutex;

    static FIXTURE_LOCK: Mutex<()> = Mutex::new(());

    fn write_proc(root: &Path, pid: i32, cmdline: &[&str], cwd: &str, children: &[i32]) {
        let dir = root.join(pid.to_string());
        fs::create_dir_all(dir.join("task").join(pid.to_string())).unwrap();
        let mut cmd = Vec::new();
        for (i, a) in cmdline.iter().enumerate() {
            if i > 0 {
                cmd.push(0);
            }
            cmd.extend_from_slice(a.as_bytes());
        }
        cmd.push(0);
        fs::write(dir.join("cmdline"), cmd).unwrap();
        let _ = fs::remove_file(dir.join("cwd"));
        symlink(cwd, dir.join("cwd")).unwrap();
        let kids = children
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        fs::write(
            dir.join("task").join(pid.to_string()).join("children"),
            format!("{kids}\n"),
        )
        .unwrap();
    }

    fn write_environ(root: &Path, pid: i32, pairs: &[(&str, &str)]) {
        let mut buf = Vec::new();
        for (k, v) in pairs {
            buf.extend_from_slice(k.as_bytes());
            buf.push(b'=');
            buf.extend_from_slice(v.as_bytes());
            buf.push(0);
        }
        fs::write(root.join(pid.to_string()).join("environ"), buf).unwrap();
    }

    #[test]
    fn deepest_shell_prefers_child_shell_cwd() {
        let _g = FIXTURE_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!("undo-probe-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write_proc(&tmp, 100, &["/usr/bin/kitty"], "/usr/share/kitty", &[101]);
        write_proc(&tmp, 101, &["bash"], "/home/chris/projects/demo", &[102]);
        write_proc(&tmp, 102, &["htop"], "/home/chris/projects/demo", &[]);
        set_proc_root(tmp.clone());
        let info = deepest_shell(100).unwrap();
        assert_eq!(info.shell_pid, 101);
        assert_eq!(info.cwd, "/home/chris/projects/demo");
        assert_eq!(info.argv, vec!["bash".to_string()]);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn deepest_shell_falls_back_to_leaf_when_no_shell() {
        let _g = FIXTURE_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!("undo-probe-leaf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write_proc(&tmp, 200, &["firefox"], "/home/chris", &[201]);
        write_proc(&tmp, 201, &["firefox", "-contentproc"], "/home/chris", &[]);
        set_proc_root(tmp.clone());
        let info = deepest_shell(200).unwrap();
        assert_eq!(info.shell_pid, 201);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn cookie_matches_descendant_environ() {
        let _g = FIXTURE_LOCK.lock().unwrap();
        let tmp = std::env::temp_dir().join(format!("undo-probe-cookie-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        write_proc(&tmp, 300, &["kitty"], "/tmp", &[301]);
        write_proc(&tmp, 301, &["bash"], "/tmp/work", &[]);
        write_environ(
            &tmp,
            300,
            &[("PATH", "/usr/bin"), ("DESKTOP_UNDO_COOKIE", "abc-123")],
        );
        write_environ(&tmp, 301, &[("PATH", "/usr/bin")]);
        set_proc_root(tmp.clone());
        let hit = cookie_match("abc-123", &[300]).unwrap().unwrap();
        assert_eq!(hit.pid, 300);
        assert!(cookie_match("nope", &[300]).unwrap().is_none());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn json_escape_quotes_and_newlines() {
        assert_eq!(json_escape("a\"b"), "\"a\\\"b\"");
        assert_eq!(json_escape("a\\b"), "\"a\\\\b\"");
        assert_eq!(json_escape("a\nb"), "\"a\\nb\"");
    }
}
