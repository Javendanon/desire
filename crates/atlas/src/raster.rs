//! Source rasters: decoding an image file into a row-major RGB buffer.

use std::path::Path;

/// A decoded image, three bytes per pixel, row-major.
pub struct RgbRaster {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}

/// Decodes a JPEG or PNG, dropping any alpha channel.
pub fn read_rgb(path: &Path) -> Result<RgbRaster, image::ImageError> {
    let mut reader = image::ImageReader::open(path)?.with_guessed_format()?;
    reader.no_limits();
    let rgb = reader.decode()?.into_rgb8();
    let (width, height) = rgb.dimensions();
    Ok(RgbRaster {
        width: width as usize,
        height: height as usize,
        rgb: rgb.into_raw(),
    })
}
