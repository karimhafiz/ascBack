const multer = require("multer");
const cloudinary = require("cloudinary");
const multerStorageCloudinary = require("multer-storage-cloudinary");
const CloudinaryStorage = multerStorageCloudinary.CloudinaryStorage || multerStorageCloudinary;

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, JPG, and WebP images are allowed"), false);
  }
};

/**
 * Creates a multer upload instance that stores files in the given Cloudinary folder.
 * Each route that handles uploads should call this with its own folder name so
 * images are organised correctly in Cloudinary and can be deleted by folder later.
 *
 * @param {string} folder - Cloudinary folder name (e.g. "event-images")
 * @returns {import('multer').Multer}
 */
function createUpload(folder) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder,
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
    },
  });
  return multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });
}

module.exports = { createUpload };
