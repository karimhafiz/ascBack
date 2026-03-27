const cloudinary = require("../config/cloudinary");

/**
 * Extracts the Cloudinary public ID from a URL and deletes the image.
 * Throws on failure so callers can detect and log deletion errors.
 *
 * Handles standard Cloudinary URLs:
 *   https://res.cloudinary.com/<cloud>/image/upload/v<ver>/<folder>/<filename>.<ext>
 *
 * @param {string} imageUrl - Full Cloudinary image URL
 * @param {string} folder   - Cloudinary folder prefix (e.g. "event-images")
 */
async function deleteCloudinaryImage(imageUrl, folder) {
  // Strip query string, take the last path segment, remove extension
  const filename = imageUrl.split("?")[0].split("/").pop();
  if (!filename) {
    throw new Error(`Cannot extract filename from Cloudinary URL: ${imageUrl}`);
  }
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  const publicId = `${folder}/${nameWithoutExt}`;
  await cloudinary.uploader.destroy(publicId);
}

module.exports = { deleteCloudinaryImage };
