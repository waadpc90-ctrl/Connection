import { FIELD_LIMITS } from '../types/wisaal';

export interface CompressedImageResult {
  dataUrl: string;
  sizeKb: number;
  width: number;
  height: number;
}

const VALID_DATA_URL_REGEX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function loadHtmlImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة.'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('تنسيق الصورة غير مدعوم.'));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export async function compressImageToDataUrl(file: File): Promise<CompressedImageResult> {
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('يرجى اختيار ملف صورة صالح (JPG أو PNG أو WebP).');
  }
  if (file.type === 'image/svg+xml') {
    throw new Error('ملفات SVG غير مسموح بها؛ يرجى اختيار صورة JPG أو PNG.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('حجم الصورة كبير جداً (الحد الأقصى قبل الضغط 15 ميجابايت).');
  }

  const img = await loadHtmlImageFromFile(file);
  const maxChars = FIELD_LIMITS.maxImageDataUrlChars;

  // Progressively resize & compress until cleanly under Firestore's safe single-doc threshold
  const dimensionSteps = [1150, 920, 720, 560];
  const qualitySteps = [0.82, 0.72, 0.62, 0.5, 0.4];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('المتصفح لا يدعم ضغط الصور.');
  }

  for (const maxDim of dimensionSteps) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    canvas.width = width;
    canvas.height = height;

    // White background so transparent PNGs convert cleanly to crisp JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualitySteps) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxChars && VALID_DATA_URL_REGEX.test(dataUrl)) {
        const approxBytes = Math.round(((dataUrl.length - 23) * 3) / 4);
        return {
          dataUrl,
          sizeKb: Math.max(1, Math.round(approxBytes / 1024)),
          width,
          height,
        };
      }
    }
  }

  throw new Error('تعذر ضغط الصورة إلى الحجم المسموح. جرب صورة أصغر أو أقل تعقيداً.');
}

export function isValidMediaDataUrl(dataUrl: string): boolean {
  return (
    typeof dataUrl === 'string' &&
    dataUrl.length >= 32 &&
    dataUrl.length <= FIELD_LIMITS.maxImageDataUrlChars &&
    VALID_DATA_URL_REGEX.test(dataUrl)
  );
}
