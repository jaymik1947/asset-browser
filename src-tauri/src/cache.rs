use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PIPELINE_VER: u32 = 2;
pub const THUMB_SIZE: u32 = 400;
const DEFAULT_LIMIT: i64 = 2 * 1024 * 1024 * 1024;

static DB: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();
static CUR_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn default_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("AssetBrowser")
}

fn config_file() -> PathBuf {
    default_dir().join("datadir.txt")
}

fn slot() -> &'static Mutex<Option<Connection>> {
    DB.get_or_init(|| Mutex::new(None))
}

fn dir_slot() -> &'static Mutex<Option<PathBuf>> {
    CUR_DIR.get_or_init(|| Mutex::new(None))
}


const MEM_LIMIT_BYTES: usize = 64 * 1024 * 1024;

struct MemCache {
    map: HashMap<String, Vec<u8>>,
    order: Vec<String>,
    bytes: usize,
}

static MEM: OnceLock<Mutex<MemCache>> = OnceLock::new();
static HIT_TICK: AtomicUsize = AtomicUsize::new(0);

/// 已用字节数（内存计数，-1 表示尚未初始化）。
/// 存在的唯一理由：避免每次写缓存都去数据库做全表 SUM。
static TOTAL_BYTES: AtomicI64 = AtomicI64::new(-1);

fn mem() -> &'static Mutex<MemCache> {
    MEM.get_or_init(|| {
        Mutex::new(MemCache {
            map: HashMap::new(),
            order: Vec::new(),
            bytes: 0,
        })
    })
}

fn mem_get(key: &str) -> Option<Vec<u8>> {
    let m = mem().lock().ok()?;
    m.map.get(key).cloned()
}

fn mem_put(key: &str, data: Vec<u8>) {
    let Ok(mut m) = mem().lock() else {
        return;
    };
    if m.map.contains_key(key) {
        return;
    }
    let len = data.len();
    m.map.insert(key.to_string(), data);
    m.order.push(key.to_string());
    m.bytes += len;
    if m.bytes > MEM_LIMIT_BYTES {
        let drop_n = (m.order.len() / 4).max(1);
        for _ in 0..drop_n {
            if m.order.is_empty() {
                break;
            }
            let k = m.order.remove(0);
            if let Some(v) = m.map.remove(&k) {
                m.bytes -= v.len();
            }
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn current_dir() -> PathBuf {
    if let Ok(mut g) = dir_slot().lock() {
        if let Some(p) = g.as_ref() {
            return p.clone();
        }
        let p = std::fs::read_to_string(config_file())
            .ok()
            .map(|s| PathBuf::from(s.trim().to_string()))
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(default_dir);
        *g = Some(p.clone());
        return p;
    }
    default_dir()
}

fn open_at(dir: &PathBuf) -> Option<Connection> {
    std::fs::create_dir_all(dir).ok()?;
    let conn = Connection::open(dir.join("cache.db")).ok()?;
    let _ = conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS thumb (
           key TEXT PRIMARY KEY,
           data BLOB NOT NULL,
           bytes INTEGER NOT NULL,
           last_hit_at INTEGER NOT NULL
         ) WITHOUT ROWID;
         CREATE INDEX IF NOT EXISTS idx_thumb_lru ON thumb(last_hit_at);
         CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    );
    Some(conn)
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> T) -> Option<T> {
    let mut g = slot().lock().ok()?;
    if g.is_none() {
        *g = open_at(&current_dir());
    }
    g.as_ref().map(f)
}

pub fn set_dir(dir: &str) -> Result<(), String> {
    let p = PathBuf::from(dir);
    if p.as_os_str().is_empty() {
        return Err("目录为空".into());
    }
    std::fs::create_dir_all(&p).map_err(|e| format!("无法创建目录: {}", e))?;
    // 先把 WAL 落盘，再释放连接，否则未 checkpoint 的数据会随连接关闭一起丢失
    if let Ok(mut g) = slot().lock() {
        if let Some(conn) = g.as_ref() {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        *g = None;
    }
    // 换库了，已用量计数作废，下次用时重新从新库统计
    TOTAL_BYTES.store(-1, Ordering::Relaxed);
    if let Ok(mut g) = dir_slot().lock() {
        *g = Some(p.clone());
    }
    let _ = std::fs::create_dir_all(default_dir());
    std::fs::write(config_file(), p.to_string_lossy().as_bytes())
        .map_err(|e| format!("无法保存配置: {}", e))?;
    Ok(())
}

fn get_limit(conn: &Connection) -> i64 {
    conn.query_row("SELECT v FROM meta WHERE k='limit'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(DEFAULT_LIMIT)
}

pub fn key_for(path: &str, mtime_ms: i64, size: i64) -> String {
    let mut h = blake3::Hasher::new();
    h.update(path.to_lowercase().as_bytes());
    h.update(&mtime_ms.to_le_bytes());
    h.update(&size.to_le_bytes());
    h.update(&THUMB_SIZE.to_le_bytes());
    h.update(&PIPELINE_VER.to_le_bytes());
    let hex = h.finalize().to_hex();
    hex[..32].to_string()
}

pub fn get(key: &str) -> Option<Vec<u8>> {
    // 热点文件直接走内存，不碰 SQLite、不写盘
    if let Some(v) = mem_get(key) {
        return Some(v);
    }
    let data = with_conn(|conn| {
        let mut stmt = conn
            .prepare_cached("SELECT data FROM thumb WHERE key=?1")
            .ok()?;
        let data: Option<Vec<u8>> = stmt.query_row(params![key], |r| r.get(0)).ok();
        if data.is_some() {
            // last_hit_at 只用于 LRU 淘汰，没必要每次命中都写一次盘
            // 节流到每 64 次才更新一次
            let t = HIT_TICK.fetch_add(1, Ordering::Relaxed);
            if t % 64 == 0 {
                let _ = conn.execute(
                    "UPDATE thumb SET last_hit_at=?1 WHERE key=?2",
                    params![now_ms(), key],
                );
            }
        }
        data
    })??;
    mem_put(key, data.clone());
    Some(data)
}

pub fn has(key: &str) -> bool {
    with_conn(|conn| {
        conn.query_row("SELECT 1 FROM thumb WHERE key=?1", params![key], |_| Ok(()))
            .is_ok()
    })
    .unwrap_or(false)
}

pub fn put(key: &str, data: &[u8]) {
    mem_put(key, data.to_vec());
    put_disk_only(key, data);
}

/// 只写库、不往内存缓存塞。预生成用这个：
/// 批量生成时那些图短期不会被浏览，塞进 64MB 内存层只是白占内存 + 触发淘汰抖动。
pub fn put_disk_only(key: &str, data: &[u8]) {
    let n = data.len() as i64;
    let _ = with_conn(|conn| {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO thumb(key,data,bytes,last_hit_at) VALUES(?1,?2,?3,?4)",
            params![key, data, n, now_ms()],
        );
    });
    if TOTAL_BYTES.load(Ordering::Relaxed) >= 0 {
        TOTAL_BYTES.fetch_add(n, Ordering::Relaxed);
    }
}

/// 已用量：优先读内存计数，未初始化时才查一次库
fn total_bytes(conn: &Connection) -> i64 {
    let v = TOTAL_BYTES.load(Ordering::Relaxed);
    if v >= 0 {
        return v;
    }
    let t: i64 = conn
        .query_row("SELECT COALESCE(SUM(bytes),0) FROM thumb", [], |r| r.get(0))
        .unwrap_or(0);
    TOTAL_BYTES.store(t, Ordering::Relaxed);
    t
}

pub fn evict_if_needed() -> i64 {
    // 关键：先用内存计数判断，绝大多数情况根本不碰数据库。
    // 之前每次写入都跑一次 SELECT SUM(bytes) 全表扫描，串行在一把全局锁后面，
    // 直接把预生成压到 11 张/秒（占单张成本的一半以上）。
    let head = with_conn(|conn| (get_limit(conn), total_bytes(conn)));
    let Some((limit, total)) = head else {
        return 0;
    };
    if total < limit * 90 / 100 {
        return 0;
    }

    let removed = with_conn(|conn| {
        let target = limit * 70 / 100;
        let mut removed: i64 = 0;
        let mut guard = 0;
        while total - removed > target && guard < 200 {
            guard += 1;
            let rows: Vec<(String, i64)> = {
                let mut stmt = match conn
                    .prepare("SELECT key, bytes FROM thumb ORDER BY last_hit_at ASC LIMIT 400")
                {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let it =
                    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)));
                match it {
                    Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                    Err(_) => break,
                }
            };
            if rows.is_empty() {
                break;
            }
            for (k, b) in &rows {
                if conn
                    .execute("DELETE FROM thumb WHERE key=?1", params![k])
                    .is_ok()
                {
                    removed += b;
                }
            }
        }
        // 淘汰后重新对齐计数，顺便纠正长期累积的偏差
        let real: i64 = conn
            .query_row("SELECT COALESCE(SUM(bytes),0) FROM thumb", [], |r| r.get(0))
            .unwrap_or(0);
        TOTAL_BYTES.store(real, Ordering::Relaxed);
        removed
    })
    .unwrap_or(0);
    removed
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub count: i64,
    pub bytes: i64,
    pub limit: i64,
    pub dir: String,
    pub default_dir: String,
}

pub fn stats() -> CacheStats {
    let dir = current_dir().to_string_lossy().to_string();
    let ddir = default_dir().to_string_lossy().to_string();
    let (count, bytes, limit) = with_conn(|conn| {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM thumb", [], |r| r.get(0))
            .unwrap_or(0);
        let bytes: i64 = conn
            .query_row("SELECT COALESCE(SUM(bytes),0) FROM thumb", [], |r| r.get(0))
            .unwrap_or(0);
        (count, bytes, get_limit(conn))
    })
    .unwrap_or((0, 0, DEFAULT_LIMIT));

    CacheStats {
        count,
        bytes,
        limit,
        dir,
        default_dir: ddir,
    }
}

pub fn set_limit(bytes: i64) {
    let _ = with_conn(|conn| {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO meta(k,v) VALUES('limit',?1)",
            params![bytes.to_string()],
        );
    });
}

pub fn clear() {
    let _ = with_conn(|conn| {
        let _ = conn.execute("DELETE FROM thumb", []);
        let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE);", []);
        let _ = conn.execute("VACUUM", []);
    });
    TOTAL_BYTES.store(0, Ordering::Relaxed);
}
