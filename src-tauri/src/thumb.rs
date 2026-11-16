use base64::Engine;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

const PSD_SIG: u32 = 0x3842_5053;
const IR_SIG: u32 = 0x3842_494d;
const MAX_IR: u64 = 8 * 1024 * 1024;
const MAX_COMPOSITE_PIXELS: usize = 40_000_000;

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "webp", "bmp", "gif", "ico", "tif", "tiff", "avif",
];

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThumbResult {
    pub ok: bool,
    pub data_url: Option<String>,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub color_mode: Option<u16>,
    pub depth: Option<u16>,
    pub err: Option<String>,
}

impl ThumbResult {
    pub fn fail(err: &str) -> Self {
        Self {
            ok: false,
            err: Some(err.to_string()),
            ..Default::default()
        }
    }
}

/// 渲染结果：JPEG 字节 + 元数据（不含 base64，避免预生成时无谓的编解码往返）
pub struct ThumbData {
    pub jpeg: Vec<u8>,
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub color_mode: Option<u16>,
    pub depth: Option<u16>,
}

pub struct PsdHead {
    pub width: u32,
    pub height: u32,
    pub depth: u16,
    pub color_mode: u16,
    pub jpeg: Option<Vec<u8>>,
}

fn be_u32(b: &[u8]) -> Option<u32> {
    if b.len() < 4 {
        return None;
    }
    Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

fn be_u16(b: &[u8]) -> Option<u16> {
    if b.len() < 2 {
        return None;
    }
    Some(u16::from_be_bytes([b[0], b[1]]))
}

fn find_jpeg_end(buf: &[u8], start: usize) -> usize {
    if buf.len() < 4 {
        return buf.len();
    }
    let mut i = buf.len() - 2;
    while i > start {
        if buf[i] == 0xff && buf[i + 1] == 0xd9 {
            return i + 2;
        }
        i -= 1;
    }
    buf.len()
}

pub fn read_psd(path: &Path) -> Option<PsdHead> {
    let f = File::open(path).ok()?;
    let mut r = BufReader::new(f);

    let mut head = [0u8; 26];
    r.read_exact(&mut head).ok()?;
    if be_u32(&head[0..4])? != PSD_SIG {
        return None;
    }

    let height = be_u32(&head[14..18])?;
    let width = be_u32(&head[18..22])?;
    let depth = be_u16(&head[22..24])?;
    let color_mode = be_u16(&head[24..26])?;

    let mut tmp4 = [0u8; 4];
    r.read_exact(&mut tmp4).ok()?;
    let cm_len = u32::from_be_bytes(tmp4) as u64;
    r.seek(SeekFrom::Current(cm_len as i64)).ok()?;

    r.read_exact(&mut tmp4).ok()?;
    let ir_len = u32::from_be_bytes(tmp4) as u64;
    let read_len = ir_len.min(MAX_IR) as usize;

    let mut ir = vec![0u8; read_len];
    r.read_exact(&mut ir).ok()?;

    let mut p = 0usize;
    let mut fallback: Option<Vec<u8>> = None;

    while p + 12 <= ir.len() {
        if be_u32(&ir[p..p + 4])? != IR_SIG {
            break;
        }
        let id = be_u16(&ir[p + 4..p + 6])?;
        let name_len = ir[p + 6] as usize;
        let mut name_total = 1 + name_len;
        if name_total % 2 != 0 {
            name_total += 1;
        }
        let size_pos = p + 6 + name_total;
        if size_pos + 4 > ir.len() {
            break;
        }
        let size = be_u32(&ir[size_pos..size_pos + 4])? as usize;
        let data_start = size_pos + 4;
        if data_start >= ir.len() {
            break;
        }
        let data_end = (data_start + size).min(ir.len());

        if id == 1036 || id == 1033 {
            let mut s = data_start;
            if !(ir[s] == 0xff && ir.get(s + 1) == Some(&0xd8)) {
                s += 28;
            }
            if s + 2 < data_end && ir[s] == 0xff && ir[s + 1] == 0xd8 {
                let e = find_jpeg_end(&ir[s..data_end], 2) + s;
                let jpeg = ir[s..e.min(data_end)].to_vec();
                if id == 1036 {
                    return Some(PsdHead {
                        width,
                        height,
                        depth,
                        color_mode,
                        jpeg: Some(jpeg),
                    });
                }
                if fallback.is_none() {
                    fallback = Some(jpeg);
                }
            }
        }

        p = data_start + size + (size % 2);
    }

    Some(PsdHead {
        width,
        height,
        depth,
        color_mode,
        jpeg: fallback,
    })
}

fn unpack_bits_into(src: &[u8], dst: &mut [u8]) {
    let mut di = 0usize;
    let mut si = 0usize;
    let dlen = dst.len();
    while si < src.len() && di < dlen {
        let n = src[si] as i8;
        si += 1;
        if n >= 0 {
            let avail = src.len() - si;
            let cnt = (n as usize + 1).min(dlen - di).min(avail);
            dst[di..di + cnt].copy_from_slice(&src[si..si + cnt]);
            di += cnt;
            si += cnt;
        } else if n != -128 {
            let cnt = ((1i32 - n as i32) as usize).min(dlen - di);
            if si < src.len() {
                let v = src[si];
                for k in 0..cnt {
                    dst[di + k] = v;
                }
                di += cnt;
            }
            si += 1;
        }
    }
}

fn planes_to_rgb(planes: &[u8], plane: usize, channels: usize, color_mode: u16) -> Vec<u8> {
    let mut out = vec![0u8; plane * 3];
    if color_mode == 4 && channels >= 4 {
        for i in 0..plane {
            let c = planes[i] as u32;
            let m = planes[plane + i] as u32;
            let y = planes[plane * 2 + i] as u32;
            let k = planes[plane * 3 + i] as u32;
            out[i * 3] = ((c * k) / 255) as u8;
            out[i * 3 + 1] = ((m * k) / 255) as u8;
            out[i * 3 + 2] = ((y * k) / 255) as u8;
        }
    } else if channels >= 3 {
        for i in 0..plane {
            out[i * 3] = planes[i];
            out[i * 3 + 1] = planes[plane + i];
            out[i * 3 + 2] = planes[plane * 2 + i];
        }
    } else {
        for i in 0..plane {
            let v = planes[i];
            out[i * 3] = v;
            out[i * 3 + 1] = v;
            out[i * 3 + 2] = v;
        }
    }
    out
}

pub fn decode_composite(path: &Path) -> Option<(Vec<u8>, u32, u32)> {
    let f = File::open(path).ok()?;
    let mut r = BufReader::new(f);

    let mut head = [0u8; 26];
    r.read_exact(&mut head).ok()?;
    if be_u32(&head[0..4])? != PSD_SIG {
        return None;
    }
    let version = be_u16(&head[4..6])?;
    if version != 1 {
        return None;
    }
    let channels = be_u16(&head[12..14])? as usize;
    let height = be_u32(&head[14..18])? as usize;
    let width = be_u32(&head[18..22])? as usize;
    let depth = be_u16(&head[22..24])?;
    let color_mode = be_u16(&head[24..26])?;

    if depth != 8 || channels == 0 || channels > 5 {
        return None;
    }
    if width == 0 || height == 0 {
        return None;
    }
    if width.saturating_mul(height) > MAX_COMPOSITE_PIXELS {
        return None;
    }

    let mut b4 = [0u8; 4];
    r.read_exact(&mut b4).ok()?;
    let cm_len = u32::from_be_bytes(b4) as i64;
    r.seek(SeekFrom::Current(cm_len)).ok()?;

    r.read_exact(&mut b4).ok()?;
    let ir_len = u32::from_be_bytes(b4) as i64;
    r.seek(SeekFrom::Current(ir_len)).ok()?;

    r.read_exact(&mut b4).ok()?;
    let layer_len = u32::from_be_bytes(b4) as i64;
    r.seek(SeekFrom::Current(layer_len)).ok()?;

    let mut b2 = [0u8; 2];
    r.read_exact(&mut b2).ok()?;
    let comp = u16::from_be_bytes(b2);

    let plane = width * height;

    if comp == 0 {
        let mut data = vec![0u8; plane * channels];
        r.read_exact(&mut data).ok()?;
        let rgb = planes_to_rgb(&data, plane, channels, color_mode);
        return Some((rgb, width as u32, height as u32));
    }

    if comp != 1 {
        return None;
    }

    let mut counts = vec![0usize; channels * height];
    let mut cb = [0u8; 2];
    for i in 0..counts.len() {
        r.read_exact(&mut cb).ok()?;
        counts[i] = u16::from_be_bytes(cb) as usize;
    }

    let mut planes = vec![0u8; plane * channels];
    let mut row: Vec<u8> = Vec::with_capacity(width * 2);

    for ch in 0..channels {
        let base = ch * plane;
        for y in 0..height {
            let n = counts[ch * height + y];
            row.resize(n, 0);
            if n > 0 {
                r.read_exact(&mut row).ok()?;
            }
            let start = base + y * width;
            unpack_bits_into(&row, &mut planes[start..start + width]);
        }
    }

    let rgb = planes_to_rgb(&planes, plane, channels, color_mode);
    Some((rgb, width as u32, height as u32))
}

fn scale_to(img: image::DynamicImage, size: u32) -> image::DynamicImage {
    let (w, h) = (img.width(), img.height());
    let longest = w.max(h);
    if longest <= size || longest == 0 {
        return img;
    }
    let ratio = size as f32 / longest as f32;
    let nw = ((w as f32) * ratio).round().max(1.0) as u32;
    let nh = ((h as f32) * ratio).round().max(1.0) as u32;
    img.resize(nw, nh, image::imageops::FilterType::Triangle)
}

fn encode_jpeg(img: &image::DynamicImage) -> Option<Vec<u8>> {
    let rgb = img.to_rgb8();
    let mut out: Vec<u8> = Vec::new();
    let mut cur = Cursor::new(&mut out);
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cur, 84);
    enc.encode(
        rgb.as_raw(),
        rgb.width(),
        rgb.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    Some(out)
}

/// JPEG 直接按目标尺寸做 IDCT 缩放解码：
/// 解码器只解出 ≤ max_dim 的像素，而不是解全图再缩。
/// 对 2000x1500 这类大图能省掉大部分 IDCT 运算。
/// JPEG 用 IDCT 缩放解码：
/// jpeg-decoder 支持在解码阶段按 1/2、1/4、1/8 直接输出缩小后的像素，
/// 避免"解全图 -> 再缩放"这一步，对 2000x1500 这类大图能省掉大部分 IDCT 运算。
fn decode_jpeg_scaled(path: &Path, target: u32) -> Result<image::DynamicImage, String> {
    let f = File::open(path).map_err(|_| "open-failed".to_string())?;
    let r = BufReader::with_capacity(128 * 1024, f);
    let mut dec = jpeg_decoder::Decoder::new(r);
    dec.read_info().map_err(|_| "jpeg-info".to_string())?;

    let (ow, oh) = dec.info().map(|i| (i.width, i.height)).unwrap_or((0, 0));
    let long = ow.max(oh) as u32;
    if long > target && target > 0 {
        // 请求 1.5 倍目标值，让解码器能落到 1/2 或 1/4 档而不是过度缩小
        let req = (target * 3 / 2).max(1).min(u16::MAX as u32) as u16;
        let _ = dec.scale(req, req);
    }

    let pixels = dec.decode().map_err(|_| "jpeg-decode".to_string())?;
    let info = dec.info().ok_or("jpeg-info-missing")?;
    let (w, h) = (info.width as u32, info.height as u32);

    let rgb: Vec<u8> = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => pixels,
        jpeg_decoder::PixelFormat::L8 => {
            let mut v = Vec::with_capacity(pixels.len() * 3);
            for p in pixels {
                v.push(p);
                v.push(p);
                v.push(p);
            }
            v
        }
        _ => return Err("jpeg-format".into()),
    };

    let buf = image::RgbImage::from_raw(w, h, rgb).ok_or("jpeg-buffer")?;
    Ok(image::DynamicImage::ImageRgb8(buf))
}

fn render_psd(path: &Path, size: u32) -> Result<ThumbData, String> {
    let info = read_psd(path).ok_or("psd-parse-failed")?;

    let meta_w = Some(info.width);
    let meta_h = Some(info.height);
    let meta_cm = Some(info.color_mode);
    let meta_d = Some(info.depth);

    let img = if let Some(jpeg) = info.jpeg.as_ref() {
        match image::load_from_memory(jpeg) {
            Ok(i) => i,
            Err(_) => {
                return Err("thumb-decode-failed".into());
            }
        }
    } else {
        let (rgb, w, h) = decode_composite(path).ok_or("no-preview")?;
        let buf = image::RgbImage::from_raw(w, h, rgb).ok_or("composite-buffer")?;
        image::DynamicImage::ImageRgb8(buf)
    };

    let scaled = scale_to(img, size);
    let jpeg = encode_jpeg(&scaled).ok_or("encode-failed")?;

    Ok(ThumbData {
        jpeg,
        w: meta_w,
        h: meta_h,
        color_mode: meta_cm,
        depth: meta_d,
    })
}

fn render_image(path: &Path, size: u32) -> Result<ThumbData, String> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err("unsupported".into());
    }

    let (img, orig_w, orig_h) = if ext == "jpg" || ext == "jpeg" || ext == "jfif" {
        match decode_jpeg_scaled(path, size) {
            Ok(i) => {
                let (w, h) = (i.width(), i.height());
                (i, Some(w), Some(h))
            }
            Err(_) => {
                let i = image::open(path).map_err(|_| "decode-failed".to_string())?;
                let (w, h) = (i.width(), i.height());
                (i, Some(w), Some(h))
            }
        }
    } else {
        let i = image::open(path).map_err(|_| "decode-failed".to_string())?;
        let (w, h) = (i.width(), i.height());
        (i, Some(w), Some(h))
    };

    let scaled = scale_to(img, size);
    let jpeg = encode_jpeg(&scaled).ok_or("encode-failed")?;

    Ok(ThumbData {
        jpeg,
        w: orig_w,
        h: orig_h,
        color_mode: None,
        depth: None,
    })
}

/// 渲染缩略图，返回 JPEG 字节。预生成走这条路径，避免 base64 往返。
pub fn render_thumb(path: &str, size: u32) -> Result<ThumbData, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext == "psd" || ext == "psb" {
        render_psd(p, size)
    } else {
        render_image(p, size)
    }
}

fn to_data_url(bytes: &[u8]) -> String {
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

pub fn get_thumb(path: &str, size: u32) -> ThumbResult {
    match render_thumb(path, size) {
        Ok(t) => ThumbResult {
            ok: true,
            data_url: Some(to_data_url(&t.jpeg)),
            w: t.w,
            h: t.h,
            color_mode: t.color_mode,
            depth: t.depth,
            err: None,
        },
        Err(e) => ThumbResult::fail(&e),
    }
}
