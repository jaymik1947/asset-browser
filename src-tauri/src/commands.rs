use serde::Serialize;
use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use std::time::UNIX_EPOCH;

const ATTR_HIDDEN: u32 = 0x2;
const ATTR_SYSTEM: u32 = 0x4;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".git",
    ".svn",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    pub name: String,
    pub entries: Vec<Entry>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveListing {
    pub path: String,
    pub name: String,
    pub entries: Vec<Entry>,
    pub truncated: bool,
    pub scanned: usize,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubDir {
    pub name: String,
    pub path: String,
}

fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 && i + 1 < name.len() => name[i + 1..].to_lowercase(),
        _ => String::new(),
    }
}

fn join_path(base: &str, name: &str) -> String {
    if base.ends_with('\\') || base.ends_with('/') {
        format!("{}{}", base, name)
    } else {
        format!("{}\\{}", base, name)
    }
}

fn mtime_ms(md: &fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_skippable(name: &str, attr: u32) -> bool {
    if name.starts_with('.') {
        return true;
    }
    if attr & ATTR_SYSTEM != 0 {
        return true;
    }
    SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name))
}

#[tauri::command]
pub fn list_dir(path: String, show_hidden: bool) -> DirListing {
    let p = Path::new(&path);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let rd = match fs::read_dir(p) {
        Ok(r) => r,
        Err(e) => {
            return DirListing {
                path,
                name,
                entries: Vec::new(),
                error: Some(e.to_string()),
            }
        }
    };

    let mut entries: Vec<Entry> = Vec::new();
    for item in rd.flatten() {
        let md = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let fname = item.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') || fname == "$RECYCLE.BIN" {
            continue;
        }
        let attr = md.file_attributes();
        if !show_hidden && (attr & ATTR_HIDDEN != 0 || attr & ATTR_SYSTEM != 0) {
            continue;
        }
        let is_dir = md.is_dir();
        entries.push(Entry {
            id: join_path(&path, &fname),
            name: fname.clone(),
            kind: if is_dir { "dir".into() } else { "file".into() },
            ext: if is_dir { String::new() } else { ext_of(&fname) },
            size: if is_dir { 0 } else { md.len() as i64 },
            mtime: if is_dir { 0 } else { mtime_ms(&md) },
            rel: None,
        });
    }

    DirListing {
        path,
        name,
        entries,
        error: None,
    }
}

#[tauri::command]
pub fn list_recursive(
    path: String,
    limit: usize,
    show_hidden: bool,
    exts: Vec<String>,
) -> RecursiveListing {
    let root = Path::new(&path);
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let cap = if limit == 0 { 50_000 } else { limit.min(200_000) };
    let ext_filter: Vec<String> = exts.iter().map(|e| e.to_lowercase()).collect();

    let mut out: Vec<Entry> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root.to_path_buf()];
    let mut scanned = 0usize;
    let mut truncated = false;
    let mut err: Option<String> = None;

    while let Some(dir) = stack.pop() {
        let rd = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(e) => {
                if err.is_none() && dir == root {
                    err = Some(e.to_string());
                }
                continue;
            }
        };

        for item in rd.flatten() {
            scanned += 1;
            let md = match item.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let fname = item.file_name().to_string_lossy().to_string();
            let attr = md.file_attributes();

            if is_skippable(&fname, attr) {
                continue;
            }
            if !show_hidden && attr & ATTR_HIDDEN != 0 {
                continue;
            }

            let full = item.path();

            if md.is_dir() {
                stack.push(full);
                continue;
            }

            let ext = ext_of(&fname);
            if !ext_filter.is_empty() && !ext_filter.contains(&ext) {
                continue;
            }

            if out.len() >= cap {
                truncated = true;
                break;
            }

            let rel = full
                .strip_prefix(root)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| fname.clone());

            out.push(Entry {
                id: full.to_string_lossy().to_string(),
                name: fname,
                kind: "file".into(),
                ext,
                size: md.len() as i64,
                mtime: mtime_ms(&md),
                rel: Some(rel),
            });
        }

        if truncated {
            break;
        }
    }

    RecursiveListing {
        path,
        name,
        entries: out,
        truncated,
        scanned,
        error: err,
    }
}

#[tauri::command]
pub fn list_subdirs(path: String) -> Vec<SubDir> {
    let mut out = Vec::new();
    let rd = match fs::read_dir(&path) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for item in rd.flatten() {
        let md = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !md.is_dir() {
            continue;
        }
        let fname = item.file_name().to_string_lossy().to_string();
        let attr = md.file_attributes();
        if is_skippable(&fname, attr) || attr & ATTR_HIDDEN != 0 {
            continue;
        }
        out.push(SubDir {
            name: fname.clone(),
            path: join_path(&path, &fname),
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pick_exe(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("程序", &["exe"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) {
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().open_path(&path, None::<&str>);
}

#[tauri::command]
pub fn reveal_in_explorer(app: tauri::AppHandle, path: String) {
    use tauri_plugin_opener::OpenerExt;
    let p = std::path::Path::new(&path);
    let target = if p.is_dir() {
        path.clone()
    } else {
        p.parent()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone())
    };
    let _ = app.opener().open_path(&target, None::<&str>);
}

fn cache_key_for(path: &str) -> Option<String> {
    std::fs::metadata(path).ok().and_then(|md| {
        let mtime = md
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_millis() as i64;
        Some(crate::cache::key_for(path, mtime, md.len() as i64))
    })
}

fn store_thumb_bytes(key: &str, t: &crate::thumb::ThumbData) {
    store_thumb_bytes_inner(key, t, true);
}

fn store_thumb_bytes_inner(key: &str, t: &crate::thumb::ThumbData, to_mem: bool) {
    let mut buf = Vec::with_capacity(12 + t.jpeg.len());
    buf.extend_from_slice(&t.w.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&t.h.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&t.color_mode.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&t.depth.unwrap_or(0).to_le_bytes());
    buf.extend_from_slice(&t.jpeg);
    if to_mem {
        crate::cache::put(key, &buf);
    } else {
        crate::cache::put_disk_only(key, &buf);
    }
}

/// 预生成用：只保证缓存里有，不生成 base64，省掉一次编码 + 一次解码
pub fn ensure_cached(path: &str) -> Result<bool, ()> {
    let key = cache_key_for(path).ok_or(())?;
    if crate::cache::has(&key) {
        return Ok(true);
    }
    let t = crate::thumb::render_thumb(path, crate::cache::THUMB_SIZE).map_err(|_| ())?;
    store_thumb_bytes_inner(&key, &t, false);
    let _ = crate::cache::evict_if_needed();
    Ok(false)
}

fn thumb_cached(path: &str, size: u32) -> crate::thumb::ThumbResult {
    use base64::Engine;

    let use_cache = size == crate::cache::THUMB_SIZE;
    let key = if use_cache { cache_key_for(path) } else { None };

    if let Some(k) = key.as_ref() {
        if let Some(buf) = crate::cache::get(k) {
            if buf.len() > 12 {
                let w = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
                let h = u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]);
                let cm = u16::from_le_bytes([buf[8], buf[9]]);
                let d = u16::from_le_bytes([buf[10], buf[11]]);
                let jpeg = &buf[12..];
                return crate::thumb::ThumbResult {
                    ok: true,
                    data_url: Some(format!(
                        "data:image/jpeg;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(jpeg)
                    )),
                    w: Some(w),
                    h: Some(h),
                    color_mode: Some(cm),
                    depth: Some(d),
                    err: None,
                };
            }
        }
    }

    match crate::thumb::render_thumb(path, size) {
        Ok(t) => {
            if use_cache {
                if let Some(k) = key.as_ref() {
                    store_thumb_bytes(k, &t);
                    let _ = crate::cache::evict_if_needed();
                }
            }
            crate::thumb::ThumbResult {
                ok: true,
                data_url: Some(format!(
                    "data:image/jpeg;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(&t.jpeg)
                )),
                w: t.w,
                h: t.h,
                color_mode: t.color_mode,
                depth: t.depth,
                err: None,
            }
        }
        Err(e) => crate::thumb::ThumbResult::fail(&e),
    }
}

#[tauri::command]
pub async fn get_thumb(path: String, size: u32) -> crate::thumb::ThumbResult {
    use std::sync::{Arc, OnceLock};
    use tokio::sync::Semaphore;

    static SEM: OnceLock<Arc<Semaphore>> = OnceLock::new();
    // 与前端并发上限对齐（8）。之前是 4，前端开 8 也只有 4 张在真正解码
    let sem = SEM.get_or_init(|| Arc::new(Semaphore::new(8))).clone();

    let permit = sem.acquire_owned().await.ok();
    let res =
        tauri::async_runtime::spawn_blocking(move || thumb_cached(&path, size)).await;
    drop(permit);

    match res {
        Ok(r) => r,
        Err(_) => crate::thumb::ThumbResult::fail("join-error"),
    }
}

#[tauri::command]
pub fn cache_stats() -> crate::cache::CacheStats {
    crate::cache::stats()
}

#[tauri::command]
pub fn cache_set_limit(mb: i64) -> crate::cache::CacheStats {
    let mb = mb.max(64).min(200_000);
    crate::cache::set_limit(mb * 1024 * 1024);
    crate::cache::evict_if_needed();
    crate::cache::stats()
}

#[tauri::command]
pub fn cache_set_dir(dir: String) -> Result<crate::cache::CacheStats, String> {
    crate::cache::set_dir(&dir)?;
    Ok(crate::cache::stats())
}

#[tauri::command]
pub fn cache_clear() -> crate::cache::CacheStats {
    crate::cache::clear();
    crate::cache::stats()
}

#[tauri::command]
pub fn prewarm_start(
    paths: Vec<String>,
    workers: usize,
    limit: usize,
) -> crate::prewarm::Status {
    crate::prewarm::start(paths, workers, limit)
}

#[tauri::command]
pub fn prewarm_pause() -> crate::prewarm::Status {
    crate::prewarm::pause()
}

#[tauri::command]
pub fn prewarm_resume() -> crate::prewarm::Status {
    crate::prewarm::resume()
}

#[tauri::command]
pub fn prewarm_stop() -> crate::prewarm::Status {
    crate::prewarm::stop()
}

#[tauri::command]
pub fn prewarm_status() -> crate::prewarm::Status {
    crate::prewarm::status()
}

#[tauri::command]
pub fn path_is_dir(path: String) -> bool {
    std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

#[tauri::command]
pub fn auto_watch_set(
    enabled: bool,
    interval_min: usize,
    paths: Vec<String>,
) -> crate::prewarm::AutoStatus {
    crate::prewarm::auto_set(enabled, interval_min, paths)
}

#[tauri::command]
pub fn auto_watch_get() -> crate::prewarm::AutoStatus {
    crate::prewarm::auto_status()
}

#[link(name = "kernel32")]
extern "system" {
    fn MultiByteToWideChar(
        code_page: u32,
        flags: u32,
        s: *const u8,
        cb: i32,
        out: *mut u16,
        cch: i32,
    ) -> i32;
}

/// 把系统 ANSI 代码页(CP_ACP)的字节转成 String。
/// 中文系统是 GBK，用 UTF-8 直接解会变成乱码，后面的 exists() 校验就会失败。
fn ansi_to_string(bytes: &[u8]) -> String {
    const CP_ACP: u32 = 0;
    if bytes.is_empty() {
        return String::new();
    }
    let n = unsafe {
        MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), bytes.len() as i32, std::ptr::null_mut(), 0)
    };
    if n <= 0 {
        return String::from_utf8_lossy(bytes).to_string();
    }
    let mut buf = vec![0u16; n as usize];
    let m = unsafe {
        MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), bytes.len() as i32, buf.as_mut_ptr(), n)
    };
    if m <= 0 {
        return String::from_utf8_lossy(bytes).to_string();
    }
    String::from_utf16_lossy(&buf[..m as usize])
}

fn read_cstr_ansi(data: &[u8], start: usize) -> String {
    if start == 0 || start >= data.len() {
        return String::new();
    }
    let end = data[start..]
        .iter()
        .position(|&b| b == 0)
        .map(|i| start + i)
        .unwrap_or(data.len());
    ansi_to_string(&data[start..end])
}

fn read_cstr_utf16(data: &[u8], start: usize) -> String {
    if start == 0 || start + 1 >= data.len() {
        return String::new();
    }
    let mut units: Vec<u16> = Vec::new();
    let mut i = start;
    while i + 1 < data.len() {
        let u = u16::from_le_bytes([data[i], data[i + 1]]);
        if u == 0 {
            break;
        }
        units.push(u);
        i += 2;
    }
    String::from_utf16_lossy(&units)
}

fn norm_path(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut prev_sep = false;
    for ch in raw.chars() {
        let sep = ch == '\\' || ch == '/';
        if sep {
            if !prev_sep {
                out.push('\\');
            }
        } else {
            out.push(ch);
        }
        prev_sep = sep;
    }
    // 去掉末尾多余的分隔符，但保留根目录的 "G:/"
    while out.len() > 3 && out.ends_with('\\') {
        out.pop();
    }
    out
}

/// 解析 Windows 快捷方式(.lnk)，取出它指向的真实路径。
///
/// 直接读 Shell Link 二进制格式，不走 COM。关键结构（MS-SHLLINK）：
/// ```text
/// 0x00  HeaderSize (0x4C)
/// 0x04  LinkCLSID (16 字节，占 0x04-0x13)
/// 0x14  LinkFlags          bit0=HasLinkTargetIDList bit1=HasLinkInfo bit7=IsUnicode
/// 0x4C  LinkTargetIDList   [可选] 2 字节长度 + 数据；有它时 LinkInfo 位置要往后挪
/// ????  LinkInfo           字段偏移都相对本块开头：
///          +0x04 HeaderSize     >= 0x24 时才有 Unicode 偏移字段
///          +0x08 Flags          bit0=有本地路径
///          +0x0C VolumeIDOffset
///          +0x10 LocalBasePathOffset
///          +0x14 CommonNetworkRelativeLinkOffset
///          +0x18 CommonPathSuffixOffset
///          +0x1C LocalBasePathOffsetUnicode
///          +0x20 CommonPathSuffixOffsetUnicode
/// ```
#[tauri::command]
pub fn resolve_shortcut(path: String) -> Option<String> {
    let p = std::path::Path::new(&path);
    if p.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() != Some("lnk") {
        return None;
    }
    let data = std::fs::read(p).ok()?;
    if data.len() < 0x4C {
        return None;
    }
    let u32_at = |o: usize| -> Option<u32> {
        if o + 4 > data.len() {
            return None;
        }
        Some(u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]))
    };
    let u16_at = |o: usize| -> Option<u16> {
        if o + 2 > data.len() {
            return None;
        }
        Some(u16::from_le_bytes([data[o], data[o + 1]]))
    };

    let flags = u32_at(0x14)?;
    if flags & 0x02 == 0 {
        return None; // 没有 LinkInfo，取不到本地路径
    }

    // 1) 跳过 LinkTargetIDList —— 这一步是之前对真实快捷方式失效的根因
    let mut li = 0x4Cusize;
    if flags & 0x01 != 0 {
        let id_len = u16_at(0x4C)? as usize;
        li = 0x4C + 2 + id_len;
    }
    if li + 0x1C > data.len() {
        return None;
    }

    let li_hdr = u32_at(li + 0x04)? as usize;
    let li_flags = u32_at(li + 0x08)?;
    if li_flags & 0x01 == 0 {
        return None; // 不是「卷 + 本地路径」形式（网络路径这张表里不处理）
    }

    let base_off = u32_at(li + 0x10)? as usize;
    let suffix_off = u32_at(li + 0x18)? as usize;
    let mut base_uni = 0usize;
    let mut suffix_uni = 0usize;
    if li_hdr >= 0x24 && li + 0x24 <= data.len() {
        base_uni = u32_at(li + 0x1C)? as usize;
        suffix_uni = u32_at(li + 0x20)? as usize;
    }

    // 2) 优先 Unicode 字段（不受代码页影响），没有再退回 ANSI
    let mut raw: Option<String> = None;
    if base_uni != 0 {
        let b = read_cstr_utf16(&data, li + base_uni);
        if !b.is_empty() {
            let s = if suffix_uni != 0 {
                read_cstr_utf16(&data, li + suffix_uni)
            } else {
                String::new()
            };
            raw = Some(format!("{}{}", b, s));
        }
    }
    if raw.is_none() && base_off != 0 {
        // 3) ANSI 字段按系统代码页解码（中文系统 GBK）
        let b = read_cstr_ansi(&data, li + base_off);
        if !b.is_empty() {
            let s = if suffix_off != 0 {
                read_cstr_ansi(&data, li + suffix_off)
            } else {
                String::new()
            };
            raw = Some(format!("{}{}", b, s));
        }
    }

    let full = norm_path(&raw?);
    if full.is_empty() {
        return None;
    }
    if std::path::Path::new(&full).exists() {
        Some(full)
    } else {
        None
    }
}

#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    crate::CLOSE_TO_TRAY.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// 在常见安装位置找 Photoshop.exe，取版本号最大的那个。
fn detect_photoshop() -> Option<String> {
    let roots = [
        "C://Program Files//Adobe",
        "C://Program Files (x86)//Adobe",
        "D://Program Files//Adobe",
        "D://Adobe",
    ];
    let mut best: Option<(u32, String)> = None;
    for root in roots {
        let rd = match std::fs::read_dir(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for item in rd.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().starts_with("adobe photoshop") {
                continue;
            }
            let exe = item.path().join("Photoshop.exe");
            if !exe.exists() {
                continue;
            }
            let ver: u32 = name
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0);
            if best.as_ref().map(|(v, _)| ver > *v).unwrap_or(true) {
                best = Some((ver, exe.to_string_lossy().to_string()));
            }
        }
    }
    best.map(|(_, p)| p)
}

#[tauri::command]
pub fn find_photoshop() -> Option<String> {
    detect_photoshop()
}

#[tauri::command]
pub fn open_in_photoshop(path: String, ps_path: Option<String>) -> Result<(), String> {
    let exe = ps_path
        .filter(|p| std::path::Path::new(p).exists())
        .or_else(detect_photoshop)
        .ok_or_else(|| "找不到 Photoshop，请在设置里指定 Photoshop.exe 的位置".to_string())?;
    std::process::Command::new(&exe)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("启动 Photoshop 失败: {}", e))?;
    Ok(())
}
