import { CLOUD_NAME, UPLOAD_PRESET } from './db';

// Item 6B (18 Aug review): every uploadToCloudinary() call site in the app
// (AssetTabs.jsx photo galleries, PhotosAndSpecs.jsx asset photos + LOPA
// crop, AdminView.jsx logos/engine covers/airframe covers) feeds it through
// a file <input accept="image/*"> — confirmed by checking every call site,
// per the review's instruction to verify rather than assume the list. This
// is a client-side check only; it's a UX/abuse-reduction backstop, not a
// security boundary — the real enforcement is the "Allowed formats" setting
// on the Cloudinary preset itself (item 6A, done by Alan in the Cloudinary
// console), which the browser can't bypass. Keep this list in sync with 6A
// if the preset's allowed formats ever change.
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// Generous for photos (asset/engine/airframe photos, logos, LOPA crops),
// blocks obvious abuse. Matches the cap already used elsewhere in the app
// for other upload paths (email-ingest.js attachments use a similar-sized
// ceiling for the same "generous but bounded" reasoning).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function hasAllowedExtension(filename) {
  const lower = (filename || '').toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Throws a clear, user-facing Error if the file fails validation; returns
// normally otherwise. Checks MIME type OR extension (not both required) —
// some OS/browser combinations report an empty or generic `file.type` for
// certain image files, so relying on type alone would false-reject
// legitimate uploads.
function validateImageFile(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`File is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB).`);
  }
  const typeOk = file.type && ALLOWED_IMAGE_TYPES.has(file.type);
  const extOk = hasAllowedExtension(file.name);
  if (!typeOk && !extOk) {
    throw new Error('Unsupported file type. Please upload a JPG, PNG, or WEBP image.');
  }
}

async function uploadToCloudinary(file) {
  validateImageFile(file);
  const cloudName = CLOUD_NAME();
  const uploadPreset = UPLOAD_PRESET();
  if (!cloudName || !uploadPreset) throw new Error('Cloudinary config not loaded yet — try again in a moment');
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', 'vector-fleet');
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error('Upload failed');
  const data = await res.json();
  return data.secure_url;
};


export { uploadToCloudinary };