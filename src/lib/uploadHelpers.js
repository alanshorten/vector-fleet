import { CLOUD_NAME, UPLOAD_PRESET } from './db';

async function uploadToCloudinary(file) {
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
