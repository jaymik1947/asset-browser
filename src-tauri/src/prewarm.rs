use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_FILES: usize = 200_000;
const DEFAULT_WORKERS: usize = 4;

const OK_EXTS: &[&str] = &[
    "psd", "psb", "jpg", "jpeg", "jfif", "png", "webp", "bmp", "gif", "ico", "tif", "tiff", "avif",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".git",
    ".svn",
];

pub struct Ctl {
    running: AtomicBool,
    paused: AtomicBool,
    cancel: AtomicBool,
    total: AtomicUsize,
    done: AtomicUsize,
    skipped: AtomicUsize,
    failed: AtomicUsize,
    path: Mutex<String>,
    roots: Mutex<Vec<String>>,
    workers: AtomicUsize,
}

static CTL: OnceLock<Arc<Ctl>> = OnceLock::new();

fn ctl() -> &'static Arc<Ctl> {
    CTL.get_or_init(|| {
        Arc::new(Ctl {
            running: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            total: AtomicUsize::new(0),
            done: AtomicUsize::new(0),
            skipped: AtomicUsize::new(0),
            failed: AtomicUsize::new(0),
            path: Mutex::new(String::new()),
            roots: Mutex::new(Vec::new()),
            workers: AtomicUsize::new(DEFAULT_WORKERS),
        })
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub paused: bool,
    pub total: usize,
    pub done: usize,
    pub skipped: usize,
    pub failed: usize,
    pub path: String,
    pub roots: Vec<String>,
    pub workers: usize,
}

pub fn status() -> Status {
    let c = ctl();
    Status {
        running: c.running.load(Ordering::Relaxed),
        paused: c.paused.load(Ordering::Relaxed),
        total: c.total.load(Ordering::Relaxed),
        done: c.done.load(Ordering::Relaxed),
        skipped: c.skipped.load(Ordering::Relaxed),
        failed: c.failed.load(Ordering::Relaxed),
        path: c.path.lock().map(|s| s.clone()).unwrap_or_default(),
        roots: c.roots.lock().map(|v| v.clone()).unwrap_or_default(),
        workers: c.workers.load(Ordering::Relaxed),
    }
}

fn collect(root: &str, out: &mut Vec<String>, seen: &mut HashSet<String>, limit: usize) {
    let mut stack: Vec<PathBuf> = vec![PathBuf::from(root)];

    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for item in rd.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                continue;
            }
            let p = item.path();
            let md = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if md.is_dir() {
                stack.push(p);
                continue;
            }
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !OK_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let full = p.to_string_lossy().to_string();
            if seen.insert(full.to_lowercase()) {
                out.push(full);
                if out.len() >= limit {
                    return;
                }
            }
        }
    }
}

/// 收集多个根目录的文件，跨目录去重（收藏夹之间可能有父子重叠）
fn collect_many(roots: &[String], limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for r in roots {
        collect(r, &mut out, &mut seen, limit);
        if out.len() >= limit {
            break;
        }
    }
    out
}


#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutoStatus {
    pub enabled: bool,
    pub interval_min: usize,
    pub paths: Vec<String>,
    pub last_run: i64,
    pub next_run: i64,
}

pub struct AutoCtl {
    enabled: AtomicBool,
    interval_min: AtomicUsize,
    last_run: AtomicI64,
    next_run: AtomicI64,
    paths: Mutex<Vec<String>>,
}

static AUTO: OnceLock<Arc<AutoCtl>> = OnceLock::new();

fn auto() -> &'static Arc<AutoCtl> {
    AUTO.get_or_init(|| {
        let c = Arc::new(AutoCtl {
            enabled: AtomicBool::new(false),
            interval_min: AtomicUsize::new(5),
            last_run: AtomicI64::new(0),
            next_run: AtomicI64::new(0),
            paths: Mutex::new(Vec::new()),
        });
        let worker = c.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(15));
            let c = &worker;
            if !c.enabled.load(Ordering::Relaxed) {
                continue;
            }
            let now = now_ms();
            if now < c.next_run.load(Ordering::Relaxed) {
                continue;
            }
            let interval = (c.interval_min.load(Ordering::Relaxed).max(1) as i64) * 60_000;
            c.next_run.store(now + interval, Ordering::Relaxed);
            let paths = c.paths.lock().map(|p| p.clone()).unwrap_or_default();
            if paths.is_empty() {
                continue;
            }
            // 已有任务在跑就跳过这一轮
            if ctl().running.load(Ordering::Relaxed) {
                continue;
            }
            c.last_run.store(now, Ordering::Relaxed);
            // 复用预缓存流程：已缓存的会自动跳过，改动过的因 mtime 变化会被重建
            let _ = start(paths, DEFAULT_WORKERS, 0);
        });
        c
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn auto_status() -> AutoStatus {
    let a = auto();
    AutoStatus {
        enabled: a.enabled.load(Ordering::Relaxed),
        interval_min: a.interval_min.load(Ordering::Relaxed),
        paths: a.paths.lock().map(|p| p.clone()).unwrap_or_default(),
        last_run: a.last_run.load(Ordering::Relaxed),
        next_run: a.next_run.load(Ordering::Relaxed),
    }
}

pub fn auto_set(enabled: bool, interval_min: usize, paths: Vec<String>) -> AutoStatus {
    let a = auto();
    a.enabled.store(enabled, Ordering::Relaxed);
    a.interval_min
        .store(interval_min.clamp(1, 240), Ordering::Relaxed);
    if let Ok(mut p) = a.paths.lock() {
        *p = paths;
    }
    let now = now_ms();
    a.next_run
        .store(now + (interval_min.max(1) as i64) * 60_000, Ordering::Relaxed);
    auto_status()
}

pub fn start(paths: Vec<String>, workers: usize, limit: usize) -> Status {
    let c = ctl();
    if c.running.load(Ordering::Relaxed) {
        return status();
    }
    if paths.is_empty() {
        return status();
    }

    let workers = workers.clamp(1, 16);
    let cap = if limit == 0 { MAX_FILES } else { limit.min(MAX_FILES) };

    c.cancel.store(false, Ordering::Relaxed);
    c.paused.store(false, Ordering::Relaxed);
    c.done.store(0, Ordering::Relaxed);
    c.skipped.store(0, Ordering::Relaxed);
    c.failed.store(0, Ordering::Relaxed);
    c.total.store(0, Ordering::Relaxed);
    c.workers.store(workers, Ordering::Relaxed);
    if let Ok(mut p) = c.path.lock() {
        *p = paths[0].clone();
    }
    if let Ok(mut r) = c.roots.lock() {
        *r = paths.clone();
    }
    c.running.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        let files = collect_many(&paths, cap);
        c.total.store(files.len(), Ordering::Relaxed);

        let files = Arc::new(files);
        let cursor = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();

        for _ in 0..workers {
            let files = files.clone();
            let cursor = cursor.clone();
            handles.push(std::thread::spawn(move || loop {
                let c = ctl();
                if c.cancel.load(Ordering::Relaxed) {
                    break;
                }
                while c.paused.load(Ordering::Relaxed) && !c.cancel.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(120));
                }
                if c.cancel.load(Ordering::Relaxed) {
                    break;
                }
                let i = cursor.fetch_add(1, Ordering::Relaxed);
                if i >= files.len() {
                    break;
                }
                let f = &files[i];
                match crate::commands::ensure_cached(f) {
                    Ok(true) => {
                        c.skipped.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(false) => {
                        c.done.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(_) => {
                        c.failed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }));
        }

        for h in handles {
            let _ = h.join();
        }

        let c = ctl();
        c.running.store(false, Ordering::Relaxed);
        c.paused.store(false, Ordering::Relaxed);
    });

    status()
}

pub fn pause() -> Status {
    let c = ctl();
    if c.running.load(Ordering::Relaxed) {
        c.paused.store(true, Ordering::Relaxed);
    }
    status()
}

pub fn resume() -> Status {
    let c = ctl();
    c.paused.store(false, Ordering::Relaxed);
    status()
}

pub fn stop() -> Status {
    let c = ctl();
    c.cancel.store(true, Ordering::Relaxed);
    c.paused.store(false, Ordering::Relaxed);
    status()
}
