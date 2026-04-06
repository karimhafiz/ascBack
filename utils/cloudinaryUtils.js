const cloudinary = require("../config/cloudinary");

/**
 * Deletes an image from Cloudinary using its public ID or URL.
 * Throws on failure so callers can detect and log deletion errors.
 *
 * Accepts either:
 *   1. Cloudinary public ID directly (e.g. "page-images/hero_abc123")
 *   2. Full Cloudinary URL (extracts public ID from URL)
 *
 * @param {string} publicIdOrUrl - Cloudinary public ID or full URL
 * @param {string} [folder] - (Optional) Folder prefix if extracting from URL
 */
async function deleteCloudinaryImage(publicIdOrUrl, folder) {
  if (!publicIdOrUrl) {
    throw new Error("Cannot delete image: public ID or URL is missing");
  }

  let publicId = publicIdOrUrl;

  // If it looks like a URL, extract the public ID
  if (publicIdOrUrl.includes("/") && publicIdOrUrl.includes(".")) {
    // Strip query string, take the last path segment, remove extension
    const filename = publicIdOrUrl.split("?")[0].split("/").pop();
    if (!filename) {
      throw new Error(`Cannot extract filename from Cloudinary URL: ${publicIdOrUrl}`);
    }
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    publicId = folder ? `${folder}/${nameWithoutExt}` : nameWithoutExt;
  }

  await cloudinary.uploader.destroy(publicId);
}

module.exports = { deleteCloudinaryImage };
