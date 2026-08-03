/* ============================================================
   files.js — small file store for uploads (e.g. tech-spec PDFs)
   ------------------------------------------------------------
   HONEST LIMITATION: browsers cap localStorage at ~5MB *total*
   and we store files as base64, so this is a prototype stopgap.
   Files are capped at MAX and only written to storage on save
   (readAsDataUrl reads into memory; persist writes). Real file
   storage is a backend job — this is exactly what motivates one.
   When the backend lands, persist() uploads and returns a URL;
   the {id,name,size,type} metadata kept on records is unchanged.

   Blobs live under their own key (rmtp:file:<id>) so they never
   bloat a collection and quota failures stay isolated.
   ============================================================ */
RMTP.files = (function () {
  const MAX = 3 * 1024 * 1024; // 3MB per file
  const fileKey = (id) => 'file:' + id; // stored via RMTP.store raw helpers

  /* Read a File into memory (no storage write). Resolves with
     { dataUrl, name, size, type }. */
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('no-file')); return; }
      if (file.size > MAX) { reject(new Error('too-large')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('read-failed'));
      reader.onload = () => resolve({ dataUrl: reader.result, name: file.name, size: file.size, type: file.type || 'application/octet-stream' });
      reader.readAsDataURL(file);
    });
  }

  /* Write an in-memory file to storage. Returns metadata to keep on
     the record. Throws on quota errors — callers should catch. */
  function persist(pending) {
    const id = RMTP.store.uid('file');
    RMTP.store.writeRaw(fileKey(id), pending.dataUrl); // may throw QuotaExceededError
    return { id: id, name: pending.name, size: pending.size, type: pending.type };
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const bin = atob(parts[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function openDataUrl(dataUrl) {
    try {
      const url = URL.createObjectURL(dataUrlToBlob(dataUrl));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { RMTP.ui.toast('Could not open file', 'danger'); }
  }

  function open(meta) {
    if (!meta) return;
    if (meta.url) { window.open(meta.url, '_blank'); return; }   // remote (Supabase/SharePoint)
    const dataUrl = RMTP.store.readRaw(fileKey(meta.id), null);
    if (!dataUrl) { RMTP.ui.toast('File no longer available', 'danger'); return; }
    openDataUrl(dataUrl);
  }

  /* Raw stored data URL for a saved file — used for inline <img> thumbnails. */
  function dataUrl(meta) {
    if (meta && meta.url) return meta.url;                        // remote thumbnail src
    return meta ? RMTP.store.readRaw(fileKey(meta.id), null) : null;
  }

  /* Promote a locally-stored file to remote storage when a backend is
     active. Returns a {url,...} meta the sync layer stores on the record.
     No-op (returns the meta unchanged) in local mode or if already remote. */
  async function toRemote(meta) {
    if (!meta) return null;
    if (meta.url) return meta;                                    // already remote
    if (!(RMTP.supabase && RMTP.supabase.isConfigured())) return meta;
    const raw = RMTP.store.readRaw(fileKey(meta.id), null);
    if (!raw) return meta;
    const safe = String(meta.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const url = await RMTP.supabase.uploadFile(meta.id + '-' + safe, dataUrlToBlob(raw), meta.type);
    return { url: url, name: meta.name, type: meta.type, size: meta.size };
  }

  function remove(meta) {
    if (meta && meta.id) RMTP.store.removeRaw(fileKey(meta.id));
  }

  function humanSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return { readAsDataUrl, persist, open, openDataUrl, dataUrl, toRemote, remove, humanSize, MAX };
})();
