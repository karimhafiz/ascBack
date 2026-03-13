const cloudinary = require("../config/cloudinary");

/**
 * Extracts the Cloudinary public ID from a URL and deletes the image.
 * @param {string} imageUrl - Full Cloudinary image URL
 * @param {string} folder - Cloudinary folder name (e.g. "event-images")
 */
async function deleteCloudinaryImage(imageUrl, folder) {
  try {
    const publicId = imageUrl.split("/").pop().split(".")[0];
    await cloudinary.uploader.destroy(`${folder}/${publicId}`);
  } catch (err) {
    console.error(`Failed to delete Cloudinary image (${folder}):`, err);
  }
}

module.exports = { deleteCloudinaryImage };
