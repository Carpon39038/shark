//! Dominant-color extraction and fixed-palette bucketing.
//!
//! On import we run a lightweight k-means over a downsized copy of each image
//! to find its dominant colors. Those colors are (a) stored as hex for display
//! in the Inspector and (b) mapped onto a fixed set of 12 named buckets
//! (red/orange/.../gray) so the sidebar palette filter can match by a simple
//! `LIKE '%,bucket,%'` query — no per-query color-distance math.

// The 12 fixed palette buckets are produced by `rgb_to_bucket` below:
// red/orange/yellow/green/cyan/blue/purple/pink/brown + black/white/gray.
// These string keys are the contract shared verbatim with the frontend
// (`COLOR_BUCKETS` in types.ts) and stored in the `color_buckets` column.

/// How many dominant colors we keep per image.
const PALETTE_K: usize = 5;
/// Fixed k-means iteration budget — images are small after downsampling so this
/// converges well in practice and keeps import cost bounded.
const KMEANS_ITERS: usize = 10;
/// Cap the pixel sample fed to k-means; the import path already hands us a
/// ~128px thumbnail, but guard anyway for safety/perf.
const MAX_SAMPLE: usize = 4096;

/// Extract up to `k` dominant colors from an RGB image, ordered by cluster size
/// (most dominant first). Returns fewer than `k` colors for images with little
/// color variety (e.g. a solid fill yields a single color).
pub fn extract_palette(img: &image::RgbImage, k: usize) -> Vec<[u8; 3]> {
    let pixels = sample_pixels(img);
    if pixels.is_empty() {
        return Vec::new();
    }
    kmeans(&pixels, k.max(1))
}

/// Collect pixels for clustering, striding so we look at no more than
/// `MAX_SAMPLE` of them regardless of source size.
fn sample_pixels(img: &image::RgbImage) -> Vec<[f32; 3]> {
    let raw = img.as_raw();
    let total = raw.len() / 3;
    if total == 0 {
        return Vec::new();
    }
    let stride = (total / MAX_SAMPLE).max(1);
    let mut out = Vec::with_capacity((total / stride) + 1);
    let mut i = 0;
    while i < total {
        let b = i * 3;
        out.push([raw[b] as f32, raw[b + 1] as f32, raw[b + 2] as f32]);
        i += stride;
    }
    out
}

/// Minimal k-means over RGB points. Deterministic seeding (evenly spaced
/// initial centroids) so the same image always yields the same palette.
fn kmeans(points: &[[f32; 3]], k: usize) -> Vec<[u8; 3]> {
    let k = k.min(points.len());
    if k == 0 {
        return Vec::new();
    }

    // Deterministic init: evenly spaced picks across the sample.
    let mut centroids: Vec<[f32; 3]> = (0..k)
        .map(|c| points[(c * points.len()) / k])
        .collect();

    let mut assignments = vec![0usize; points.len()];

    for _ in 0..KMEANS_ITERS {
        // Assign each point to nearest centroid.
        let mut changed = false;
        for (pi, p) in points.iter().enumerate() {
            let mut best = 0usize;
            let mut best_dist = f32::MAX;
            for (ci, c) in centroids.iter().enumerate() {
                let d = dist_sq(p, c);
                if d < best_dist {
                    best_dist = d;
                    best = ci;
                }
            }
            if assignments[pi] != best {
                assignments[pi] = best;
                changed = true;
            }
        }

        // Recompute centroids as the mean of their members.
        let mut sums = vec![[0f32; 3]; k];
        let mut counts = vec![0usize; k];
        for (pi, p) in points.iter().enumerate() {
            let a = assignments[pi];
            sums[a][0] += p[0];
            sums[a][1] += p[1];
            sums[a][2] += p[2];
            counts[a] += 1;
        }
        for ci in 0..k {
            if counts[ci] > 0 {
                let n = counts[ci] as f32;
                centroids[ci] = [sums[ci][0] / n, sums[ci][1] / n, sums[ci][2] / n];
            }
        }

        if !changed {
            break;
        }
    }

    // Order clusters by population (most dominant first), dropping empties.
    let mut counts = vec![0usize; k];
    for &a in &assignments {
        counts[a] += 1;
    }
    let mut order: Vec<usize> = (0..k).filter(|&c| counts[c] > 0).collect();
    order.sort_by(|&a, &b| counts[b].cmp(&counts[a]));

    order
        .into_iter()
        .map(|ci| {
            [
                centroids[ci][0].round().clamp(0.0, 255.0) as u8,
                centroids[ci][1].round().clamp(0.0, 255.0) as u8,
                centroids[ci][2].round().clamp(0.0, 255.0) as u8,
            ]
        })
        .collect()
}

fn dist_sq(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    let dr = a[0] - b[0];
    let dg = a[1] - b[1];
    let db = a[2] - b[2];
    dr * dr + dg * dg + db * db
}

/// Map a single RGB color onto one of the 12 fixed buckets.
///
/// Achromatic colors (low saturation) fall into black/white/gray by lightness.
/// Otherwise we bucket by HSV hue, with two special cases: low-value
/// orange/yellow hues read as "brown", and the magenta/rose range as "pink".
pub fn rgb_to_bucket(rgb: [u8; 3]) -> &'static str {
    let (h, s, v) = rgb_to_hsv(rgb);

    // Achromatic: decide by brightness.
    if s < 0.15 || v < 0.10 {
        if v < 0.20 {
            return "black";
        } else if v > 0.85 {
            return "white";
        } else {
            return "gray";
        }
    }

    // Brown is dark/desaturated orange-yellow.
    if (h < 45.0 || h >= 350.0) && v < 0.55 && h >= 10.0 {
        // dark reddish-orange — treat as brown
        return "brown";
    }
    if (10.0..45.0).contains(&h) && v < 0.65 {
        return "brown";
    }

    // Chromatic: bucket by hue.
    match h {
        h if h < 15.0 || h >= 345.0 => "red",
        h if h < 45.0 => "orange",
        h if h < 70.0 => "yellow",
        h if h < 165.0 => "green",
        h if h < 195.0 => "cyan",
        h if h < 255.0 => "blue",
        h if h < 290.0 => "purple",
        _ => "pink", // 290–345: magenta / rose
    }
}

/// Convert RGB (0–255) to HSV with hue in degrees [0,360), s/v in [0,1].
fn rgb_to_hsv(rgb: [u8; 3]) -> (f32, f32, f32) {
    let r = rgb[0] as f32 / 255.0;
    let g = rgb[1] as f32 / 255.0;
    let b = rgb[2] as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;

    let h = if delta < 1e-6 {
        0.0
    } else if max == r {
        60.0 * (((g - b) / delta).rem_euclid(6.0))
    } else if max == g {
        60.0 * (((b - r) / delta) + 2.0)
    } else {
        60.0 * (((r - g) / delta) + 4.0)
    };
    let h = if h < 0.0 { h + 360.0 } else { h };
    let s = if max <= 0.0 { 0.0 } else { delta / max };
    (h, s, max)
}

/// Build the `,bucket,bucket,` string (leading/trailing commas, deduped,
/// dominance order preserved) for a palette. Matches the storage convention
/// used by tags so the same `LIKE '%,x,%'` filter applies.
pub fn palette_to_buckets(palette: &[[u8; 3]]) -> String {
    let mut seen: Vec<&'static str> = Vec::new();
    for &c in palette {
        let b = rgb_to_bucket(c);
        if !seen.contains(&b) {
            seen.push(b);
        }
    }
    if seen.is_empty() {
        String::new()
    } else {
        format!(",{},", seen.join(","))
    }
}

/// Extract dominant colors for the image at `path`, returning
/// `(colors_json, color_buckets)` ready to store on an `Item`. Decodes the
/// image at a small size (≤128px) for speed; on any decode failure returns
/// empty strings so import never fails on color extraction alone.
pub fn extract_for_path(path: &std::path::Path) -> (String, String) {
    let img = match image::open(path) {
        Ok(img) => img,
        Err(_) => return (String::new(), String::new()),
    };
    let small = img.thumbnail(128, 128).to_rgb8();
    let palette = extract_palette(&small, PALETTE_K);
    if palette.is_empty() {
        return (String::new(), String::new());
    }
    (palette_to_hex_json(&palette), palette_to_buckets(&palette))
}

/// Serialize a palette to a JSON array of `#RRGGBB` hex strings for display.
pub fn palette_to_hex_json(palette: &[[u8; 3]]) -> String {
    let hexes: Vec<String> = palette
        .iter()
        .map(|c| format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2]))
        .collect();
    serde_json::to_string(&hexes).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_red_buckets_red() {
        assert_eq!(rgb_to_bucket([255, 0, 0]), "red");
    }

    #[test]
    fn primaries_and_secondaries() {
        assert_eq!(rgb_to_bucket([0, 255, 0]), "green");
        assert_eq!(rgb_to_bucket([0, 0, 255]), "blue");
        assert_eq!(rgb_to_bucket([255, 255, 0]), "yellow");
        assert_eq!(rgb_to_bucket([0, 255, 255]), "cyan");
        // Pure magenta sits in the pink/rose range in our mapping.
        assert_eq!(rgb_to_bucket([255, 0, 255]), "pink");
    }

    #[test]
    fn achromatic_buckets() {
        assert_eq!(rgb_to_bucket([0, 0, 0]), "black");
        assert_eq!(rgb_to_bucket([255, 255, 255]), "white");
        assert_eq!(rgb_to_bucket([128, 128, 128]), "gray");
    }

    #[test]
    fn orange_and_purple() {
        assert_eq!(rgb_to_bucket([255, 140, 0]), "orange");
        assert_eq!(rgb_to_bucket([150, 0, 200]), "purple");
    }

    #[test]
    fn brown_is_dark_orange() {
        // A muted dark orange/tan should read as brown, not orange.
        assert_eq!(rgb_to_bucket([120, 70, 20]), "brown");
    }

    #[test]
    fn solid_image_yields_single_color() {
        let img = image::RgbImage::from_pixel(64, 64, image::Rgb([200, 30, 30]));
        let palette = extract_palette(&img, PALETTE_K);
        assert_eq!(palette.len(), 1);
        assert_eq!(rgb_to_bucket(palette[0]), "red");
    }

    #[test]
    fn two_tone_image_yields_two_dominant_colors() {
        // Left half red, right half blue.
        let mut img = image::RgbImage::new(64, 64);
        for (x, _y, px) in img.enumerate_pixels_mut() {
            *px = if x < 32 {
                image::Rgb([220, 20, 20])
            } else {
                image::Rgb([20, 20, 220])
            };
        }
        let palette = extract_palette(&img, PALETTE_K);
        assert!(palette.len() >= 2);
        let buckets = palette_to_buckets(&palette);
        assert!(buckets.contains(",red,"), "buckets were {buckets}");
        assert!(buckets.contains(",blue,"), "buckets were {buckets}");
    }

    #[test]
    fn palette_to_buckets_dedups_and_wraps() {
        let s = palette_to_buckets(&[[255, 0, 0], [250, 5, 5], [0, 0, 255]]);
        assert_eq!(s, ",red,blue,");
    }

    #[test]
    fn empty_palette_is_empty_string() {
        assert_eq!(palette_to_buckets(&[]), "");
    }

    #[test]
    fn hex_json_roundtrips() {
        let s = palette_to_hex_json(&[[255, 0, 16]]);
        assert_eq!(s, "[\"#FF0010\"]");
    }
}
