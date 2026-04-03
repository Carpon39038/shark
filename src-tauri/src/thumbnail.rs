use std::io::Cursor;
use std::path::Path;

use crate::error::AppError;

pub fn generate_thumbnail(
    src_path: &Path,
    thumb_dir: &Path,
    item_id: &str,
    size: u32,
) -> Result<std::path::PathBuf, AppError> {
    let img = image::open(src_path).map_err(|e| AppError::Io(format!("Failed to open {:?}: {e}", src_path)))?;
    // Convert to RGB8 first — JPEG doesn't support RGBA
    let rgb_img = img.to_rgb8();
    let thumb = image::imageops::thumbnail(&rgb_img, size, size);

    std::fs::create_dir_all(thumb_dir)?;

    let dest = thumb_dir.join(format!("{item_id}.jpg"));
    let mut buf = Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
    thumb.write_with_encoder(encoder).map_err(|e| AppError::Io(format!("JPEG encode failed: {e}")))?;

    std::fs::write(&dest, buf.into_inner())?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_image(path: &Path) {
        let img = image::RgbImage::from_pixel(800, 600, image::Rgb([100, 150, 200]));
        img.save(path).unwrap();
    }

    #[test]
    fn test_generate_thumbnail_jpg() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("test.jpg");
        create_test_image(&src);

        let thumb_dir = dir.path().join("thumbs");
        let result = generate_thumbnail(&src, &thumb_dir, "item-1", 256).unwrap();

        assert!(result.exists());
        assert!(result.to_string_lossy().contains("item-1.jpg"));

        let thumb_img = image::open(&result).unwrap();
        assert!(thumb_img.width() <= 256);
        assert!(thumb_img.height() <= 256);
    }

    #[test]
    fn test_generate_thumbnail_png() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("test.png");
        create_test_image(&src);

        let thumb_dir = dir.path().join("thumbs");
        let result = generate_thumbnail(&src, &thumb_dir, "item-2", 256).unwrap();
        assert!(result.exists());
    }

    #[test]
    fn test_corrupted_file() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("bad.jpg");
        std::fs::write(&src, b"not an image").unwrap();

        let thumb_dir = dir.path().join("thumbs");
        let result = generate_thumbnail(&src, &thumb_dir, "item-3", 256);
        assert!(result.is_err());
    }
}
