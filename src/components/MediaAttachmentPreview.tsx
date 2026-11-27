import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Download, ImageIcon, X, ZoomIn } from 'lucide-react';
import { db } from '../lib/firebase';
import { MediaAttachmentDoc } from '../types/wisaal';

interface MediaAttachmentPreviewProps {
  scope: 'stage' | 'pass';
  scopeToken: string;
  mediaId: string;
  caption?: string;
  darkSurface?: boolean;
  /** Optional preloaded data URL (used in demo previews without Firestore fetch) */
  inlineDataUrl?: string;
}

const mediaCache = new Map<string, { dataUrl: string; caption: string }>();

export function evictMediaFromCache(
  scope: 'stage' | 'pass',
  scopeToken: string,
  mediaId: string
): void {
  mediaCache.delete(`${scope}:${scopeToken}:${mediaId}`);
}

export function MediaAttachmentPreview({
  scope,
  scopeToken,
  mediaId,
  caption,
  darkSurface = false,
  inlineDataUrl,
}: MediaAttachmentPreviewProps) {
  const cacheKey = `${scope}:${scopeToken}:${mediaId}`;
  const [dataUrl, setDataUrl] = useState<string | null>(() => {
    if (inlineDataUrl) return inlineDataUrl;
    return mediaCache.get(cacheKey)?.dataUrl ?? null;
  });
  const [resolvedCaption, setResolvedCaption] = useState<string>(
    () => caption || mediaCache.get(cacheKey)?.caption || ''
  );
  const [loading, setLoading] = useState<boolean>(() => !inlineDataUrl && !mediaCache.has(cacheKey));
  const [failed, setFailed] = useState<boolean>(false);
  const [lightboxOpen, setLightboxOpen] = useState<boolean>(false);

  useEffect(() => {
    if (inlineDataUrl) {
      setDataUrl(inlineDataUrl);
      setLoading(false);
      setFailed(false);
      return;
    }

    const cached = mediaCache.get(cacheKey);
    if (cached) {
      setDataUrl(cached.dataUrl);
      if (!caption && cached.caption) setResolvedCaption(cached.caption);
      setLoading(false);
      setFailed(false);
      return;
    }

    if (!scopeToken || !mediaId) {
      setLoading(false);
      setFailed(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const parentCollection = scope === 'stage' ? 'stagePortals' : 'passes';
    getDoc(doc(db, parentCollection, scopeToken, 'media', mediaId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setFailed(true);
          setLoading(false);
          return;
        }
        const docData = snap.data() as MediaAttachmentDoc;
        if (
          typeof docData.dataUrl === 'string' &&
          /^data:image\/(jpeg|png|webp);base64,/.test(docData.dataUrl)
        ) {
          mediaCache.set(cacheKey, {
            dataUrl: docData.dataUrl,
            caption: docData.caption || '',
          });
          setDataUrl(docData.dataUrl);
          if (!caption && docData.caption) {
            setResolvedCaption(docData.caption);
          }
        } else {
          setFailed(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, scope, scopeToken, mediaId, caption, inlineDataUrl]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  if (loading) {
    return (
      <div
        className={`mt-3 h-40 w-full max-w-md rounded-xl animate-pulse flex items-center justify-center border ${
          darkSurface
            ? 'bg-white/10 border-white/15 text-white/60'
            : 'bg-slate-100 border-slate-200 text-slate-400'
        }`}
      >
        <ImageIcon className="w-5 h-5" />
      </div>
    );
  }

  if (failed || !dataUrl) {
    return null;
  }

  const displayCaption = caption || resolvedCaption;

  return (
    <>
      <div className="mt-3 max-w-md">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className={`group relative block w-full overflow-hidden rounded-xl border text-right transition-colors ${
            darkSurface
              ? 'border-white/20 bg-black/20 hover:border-white/40'
              : 'border-slate-200 bg-slate-50 hover:border-emerald-600/50'
          }`}
        >
          <img
            src={dataUrl}
            alt={displayCaption || 'صورة مرفقة من المدرسة'}
            className="w-full max-h-64 object-cover"
          />
          <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/75 text-white text-[11px] font-medium backdrop-blur-xs">
            <ZoomIn className="w-3.5 h-3.5" />
            <span>تكبير الصورة</span>
          </div>
        </button>

        {displayCaption && (
          <p
            className={`text-xs mt-1.5 leading-snug ${
              darkSurface ? 'text-slate-200/90' : 'text-slate-500'
            }`}
          >
            {displayCaption}
          </p>
        )}
      </div>

      {/* Full-Screen Lightbox Viewer */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex flex-col items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="عرض الصورة المرفقة"
        >
          <div
            className="w-full max-w-4xl flex items-center justify-between gap-3 mb-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium truncate">
              {displayCaption || 'صورة مرفقة من إدارة المدرسة'}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={dataUrl}
                download={`wisaal-attachment-${mediaId}.jpg`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تحميل الصورة</span>
              </a>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            className="max-w-4xl max-h-[82vh] overflow-auto rounded-xl border border-white/15 bg-black/40 p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={dataUrl}
              alt={displayCaption || 'صورة مرفقة من المدرسة'}
              className="max-w-full max-h-[78vh] w-auto h-auto mx-auto rounded-lg object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
