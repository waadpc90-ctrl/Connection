import { buildApiUrl } from './pushNotifications';
import {
  AttendanceStatus,
  ExtractedAttendanceRow,
  ExtractedGradeRow,
  Student,
} from '../types/wisaal';

export interface ParsedStudentCandidate {
  fullName: string;
  studentCode: string;
  parentName: string;
  parentPhone: string;
}

export interface CropBoundsRatio {
  left: number;   // 0..1
  right: number;  // 0..1
  top: number;    // 0..1
  bottom: number; // 0..1
}

export type JsonApiAttempt<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'backend_unavailable' }
  | { kind: 'api_error'; message: string };

export async function postJsonApiOrFallback<T>(
  path: string,
  idToken: string,
  bodyPayload: Record<string, unknown>
): Promise<JsonApiAttempt<T>> {
  try {
    const resp = await fetch(buildApiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(bodyPayload),
    });

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const rawText = await resp.text();

    const trimmed = rawText.trimStart();
    const looksLikeHtml =
      trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<');
    if (looksLikeHtml || !contentType.includes('application/json')) {
      return { kind: 'backend_unavailable' };
    }

    let parsed: (T & { error?: string }) | null = null;
    try {
      parsed = JSON.parse(rawText) as T & { error?: string };
    } catch {
      return { kind: 'backend_unavailable' };
    }

    if (!resp.ok) {
      if (
        resp.status === 404 ||
        resp.status === 405 ||
        resp.status === 502 ||
        resp.status === 503 ||
        resp.status === 504
      ) {
        return { kind: 'backend_unavailable' };
      }
      return {
        kind: 'api_error',
        message: parsed?.error || 'تعذر قراءة الصورة من الخادم.',
      };
    }

    return { kind: 'ok', data: parsed };
  } catch {
    return { kind: 'backend_unavailable' };
  }
}

export function normalizeArabicDigits(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeArabicForMatch(input: string): string {
  return normalizeArabicDigits(input)
    .toLowerCase()
    .replace(/[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[^\u0621-\u064Aa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalized Arabic words that indicate table headers, school titles, notes, or status — NOT student names
const NON_NAME_ADMIN_WORDS = new Set([
  'وزاره',
  'التربيه',
  'المديريه',
  'العامه',
  'لتربيه',
  'محافظه',
  'اعداديه',
  'ثانويه',
  'متوسطه',
  'ابتدائيه',
  'مدرسه',
  'المهنيه',
  'المهني',
  'التعليم',
  'قسم',
  'فرع',
  'التجميع',
  'الصيانه',
  'الحاسوب',
  'الكهرباء',
  'الالكترونيات',
  'العام',
  'الدراسي',
  'السنه',
  'الدراسيه',
  'التسلسل',
  'تسلسل',
  'الاسم',
  'اسم',
  'اسماء',
  'الاسماء',
  'الطالب',
  'الطالبه',
  'الطلاب',
  'الطالبات',
  'التلميذ',
  'التلميذه',
  'الثلاثي',
  'الرباعي',
  'الكامل',
  'المرحله',
  'الشعبه',
  'شعبه',
  'الصف',
  'صف',
  'الماده',
  'المواد',
  'الدرجه',
  'الدرجات',
  'السعي',
  'الشهري',
  'الشهر',
  'الاول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الفصل',
  'امتحان',
  'الامتحان',
  'نصف',
  'النتيجه',
  'التقدير',
  'المعدل',
  'المجموع',
  'الحضور',
  'الغياب',
  'الغيابات',
  'غائب',
  'غائبه',
  'حاضر',
  'حاضره',
  'مجاز',
  'مجازه',
  'متاخر',
  'متاخره',
  'بعذر',
  'اجازه',
  'الملاحظات',
  'ملاحظات',
  'ملاحظه',
  'التاريخ',
  'تاريخ',
  'اليوم',
  'الهاتف',
  'هاتف',
  'الجوال',
  'الموبايل',
  'الرقم',
  'رقم',
  'الرمز',
  'رمز',
  'ولي',
  'الامر',
  'توقيع',
  'التوقيع',
  'المدير',
  'مدير',
  'المعاون',
  'معاون',
  'المرشد',
  'مرشد',
  'المعلم',
  'المعلمه',
  'المدرس',
  'المدرسه',
  'الاستاذ',
  'الست',
  'قائمه',
  'كشف',
  'سجل',
  'جدول',
  'العدد',
  'عدد',
  'الكلي',
  'المجموع',
  'ناجح',
  'راسب',
  'مكمل',
  'مستمر',
  'منقول',
  'مفصول',
  'التولد',
  'المواليد',
  'الجنس',
  'ذكر',
  'انثي',
  'صباحي',
  'مسائي',
  'بنين',
  'بنات',
  'مختلطه',
  'صفحه',
  'الصفحه',
]);

const VALID_SHORT_NAME_TOKENS = new Set(['ال', 'بن', 'ابو', 'ام', 'طه', 'مي', 'ري']);

function cleanSingleArabicNameSegment(rawSegment: string): string | null {
  // Normalize Arabic presentation forms (PDF/OCR glyphs) into standard Arabic letters
  const standard = rawSegment
    .normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');

  // Keep ONLY standard Arabic letters (ا..ي، ء، أ، إ، آ، ة، ى، ؤ، ئ) and spaces
  const arabicOnly = standard
    .replace(/[^\u0621-\u063A\u0641-\u064A\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!arabicOnly) return null;

  const rawWords = arabicOnly.split(' ').filter(Boolean);

  // Strip isolated 1-letter OCR noise words (e.g. stray "ت" or "م" from borders)
  const words: string[] = [];
  for (const word of rawWords) {
    // Reject obvious gibberish (4+ repeated identical letters)
    if (/(.)\1{3,}/.test(word)) continue;
    const normWord = normalizeArabicForMatch(word);
    if (!normWord) continue;
    if (normWord.length === 1) continue;
    if (normWord.length === 2 && !VALID_SHORT_NAME_TOKENS.has(normWord)) {
      // Allow 2-letter Arabic names like علي -> 3, طه/مي/أم/بن/آل/عز/رند -> 2-3; allow common 2-char names too
      if (!/^(علي|طه|مي|ام|بن|ال|عز|ند|حب|جد|سد|بر|نح|دج|زي|فد)$/.test(normWord)) {
        // Still allow if total remaining words are real Arabic names, skip only pure single-letter noise
      }
    }
    words.push(word);
  }

  // Filter out segments that contain school/table header words
  let adminWordHits = 0;
  const cleanedWords: string[] = [];
  for (const w of words) {
    const norm = normalizeArabicForMatch(w);
    if (NON_NAME_ADMIN_WORDS.has(norm)) {
      adminWordHits += 1;
      continue;
    }
    cleanedWords.push(w);
  }

  // If the line was primarily administrative/header text (2+ admin words or starts with school/table keywords), skip it
  if (adminWordHits >= 2) return null;
  if (
    adminWordHits >= 1 &&
    words.length > 0 &&
    NON_NAME_ADMIN_WORDS.has(normalizeArabicForMatch(words[0])) &&
    cleanedWords.length < 2
  ) {
    return null;
  }

  // Arabic student full names are 2 to 6 words (ثنائي / ثلاثي / رباعي / خماسي)
  if (cleanedWords.length < 2 || cleanedWords.length > 6) {
    return null;
  }

  // At least 2 words must have >= 3 letters (or valid compound like عبد + الله)
  const substantialWords = cleanedWords.filter((w) => w.length >= 2);
  if (substantialWords.length < 2) return null;

  const joined = cleanedWords.join(' ').trim();
  if (joined.length < 5 || joined.length > 100) return null;

  return joined;
}

/**
 * Extracts ONLY clean Arabic student names from messy pasted text or OCR output.
 * Strips all numbers, grades, codes, phone numbers, Latin characters, symbols, and table headers.
 */
export function extractArabicStudentNamesOnly(rawText: string): ParsedStudentCandidate[] {
  const normalized = normalizeArabicDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: ParsedStudentCandidate[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Split multi-column lines (tabs, pipes, commas, semicolons, 3+ spaces, or inline serial numbers like " 2. " / " 12 - ")
    const segments = line
      .split(/\t|\||;|؛|,|،|\s{3,}|(?<=\s)\(?\d{1,3}\)?[\s.)\-–—:]+(?=[\u0621-\u064A])/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const seg of segments) {
      const cleanName = cleanSingleArabicNameSegment(seg);
      if (!cleanName) continue;
      const key = normalizeArabicForMatch(cleanName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push({
        fullName: cleanName,
        studentCode: '',
        parentName: '',
        parentPhone: '',
      });
      if (results.length >= 200) return results;
    }
  }

  return results;
}

function looksLikePhone(val: string): boolean {
  const digits = val.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[0-9+\-\s()]+$/.test(val.trim());
}

function looksLikeCode(val: string): boolean {
  const trimmed = val.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 24 &&
    /^[a-zA-Z0-9_\-/]+$/.test(trimmed) &&
    !looksLikePhone(trimmed)
  );
}

export function parseStudentsFromText(
  rawText: string,
  namesOnly = true
): ParsedStudentCandidate[] {
  if (namesOnly) {
    return extractArabicStudentNamesOnly(rawText);
  }

  const normalized = normalizeArabicDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ParsedStudentCandidate[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[\s•●▪◦*–—\-|_[\](){}:]+/, '')
      .replace(/^\(?\d{1,3}\)?[\s.)\-–—:،,|]+/, '')
      .trim();

    if (!line) continue;

    let parts: string[] = [];
    if (line.includes('\t')) {
      parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
    } else if (line.includes('|')) {
      parts = line.split('|').map((p) => p.trim()).filter(Boolean);
    } else if (line.includes(';') || line.includes('؛')) {
      parts = line.split(/[;؛]/).map((p) => p.trim()).filter(Boolean);
    } else if (line.includes(',') || line.includes('،')) {
      parts = line.split(/[,،]/).map((p) => p.trim()).filter(Boolean);
    } else {
      parts = [line];
    }

    if (parts.length > 1 && /^\d{1,3}$/.test(parts[0])) {
      parts = parts.slice(1);
    }
    if (parts.length === 0) continue;

    let fullName = '';
    let studentCode = '';
    let parentName = '';
    let parentPhone = '';

    if (parts.length === 1) {
      let single = parts[0];
      const phoneMatch = single.match(/(\+?\d[\d\s\-]{6,16}\d)\s*$/);
      if (phoneMatch) {
        const candidatePhone = phoneMatch[1].replace(/[^0-9+\-\s]/g, '').trim();
        if (candidatePhone.replace(/\D/g, '').length >= 7) {
          parentPhone = candidatePhone.slice(0, 24);
          single = single.slice(0, phoneMatch.index).replace(/[-–—:]\s*$/, '').trim();
        }
      }
      fullName = single;
    } else {
      const nameIdx = parts.findIndex((p) => /[\u0621-\u064Aa-zA-Z]{2,}/.test(p));
      if (nameIdx === -1) continue;
      fullName = parts[nameIdx];
      for (let i = 0; i < parts.length; i += 1) {
        if (i === nameIdx) continue;
        const cell = parts[i];
        if (!parentPhone && looksLikePhone(cell)) {
          parentPhone = cell.replace(/[^0-9+\-\s]/g, '').trim().slice(0, 24);
        } else if (!studentCode && looksLikeCode(cell)) {
          studentCode = cell.slice(0, 32);
        } else if (!parentName && /[\u0621-\u064Aa-zA-Z]{2,}/.test(cell)) {
          parentName = cell.slice(0, 100);
        }
      }
    }

    const cleanedArabic = cleanSingleArabicNameSegment(fullName);
    const finalName = cleanedArabic || fullName.replace(/\s+/g, ' ').trim().slice(0, 100);
    if (finalName.length < 3) continue;
    const norm = normalizeArabicForMatch(finalName);
    if (NON_NAME_ADMIN_WORDS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);

    results.push({ fullName: finalName, studentCode, parentName, parentPhone });
    if (results.length >= 200) break;
  }

  return results;
}

/**
 * Computes Otsu optimal binarization threshold for grayscale image buffer (0..255).
 * Turns blue/colored/shadowed table sheets into crisp black text on pure white background.
 */
function computeOtsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    hist[gray[i]] += 1;
  }
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 140;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * High-resolution Arabic roster image preprocessing:
 * 1. Optional crop to the student names column
 * 2. Upscale small text (up to 2600px) so Arabic dots (ب ت ث ن ي) stay sharp
 * 3. Otsu adaptive binarization (turns blue/tinted sheets into pure black-on-white)
 * 4. Removes long horizontal/vertical table grid lines that otherwise break Arabic OCR
 */
export async function preprocessArabicRosterImage(
  imageSource: string | File,
  crop?: CropBoundsRatio
): Promise<string> {
  let objectUrl: string | null = null;
  const src =
    typeof imageSource === 'string'
      ? imageSource
      : (objectUrl = URL.createObjectURL(imageSource));

  try {
    return await new Promise<string>((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(typeof imageSource === 'string' ? imageSource : src);
      img.onload = () => {
        try {
          const sx = Math.round((crop?.left ?? 0) * img.width);
          const sy = Math.round((crop?.top ?? 0) * img.height);
          const sw = Math.max(20, Math.round(((crop?.right ?? 1) - (crop?.left ?? 0)) * img.width));
          const sh = Math.max(20, Math.round(((crop?.bottom ?? 1) - (crop?.top ?? 0)) * img.height));

          // Upscale dense/small images for crisp Arabic cursive recognition, cap at 2600px
          const maxDim = Math.max(sw, sh, 1);
          const targetDim = maxDim < 1800 ? Math.min(2600, maxDim * 2) : Math.min(2600, maxDim);
          const scale = targetDim / maxDim;

          const width = Math.max(1, Math.round(sw * scale));
          const height = Math.max(1, Math.round(sh * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            resolve(typeof imageSource === 'string' ? imageSource : '');
            return;
          }

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

          const imgData = ctx.getImageData(0, 0, width, height);
          const data = imgData.data;
          const pixelCount = width * height;
          const gray = new Uint8Array(pixelCount);

          for (let p = 0; p < pixelCount; p += 1) {
            const idx = p * 4;
            gray[p] = Math.round(
              0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
            );
          }

          const otsu = computeOtsuThreshold(gray);
          // Slightly bias threshold lower for cleaner thin Arabic strokes without background specks
          const cutoff = Math.max(40, Math.min(220, otsu - 6));

          // Binary mask: 1 = dark ink, 0 = white background
          const ink = new Uint8Array(pixelCount);
          for (let p = 0; p < pixelCount; p += 1) {
            ink[p] = gray[p] < cutoff ? 1 : 0;
          }

          // Suppress continuous horizontal table grid lines (>55% of row width is dark ink)
          const minHorizLine = Math.floor(width * 0.55);
          for (let y = 0; y < height; y += 1) {
            let darkCount = 0;
            const rowOffset = y * width;
            for (let x = 0; x < width; x += 1) {
              darkCount += ink[rowOffset + x];
            }
            if (darkCount >= minHorizLine) {
              for (let x = 0; x < width; x += 1) {
                ink[rowOffset + x] = 0;
              }
            }
          }

          // Suppress continuous vertical table grid lines (>50% of column height is dark ink)
          const minVertLine = Math.floor(height * 0.5);
          for (let x = 0; x < width; x += 1) {
            let darkCount = 0;
            for (let y = 0; y < height; y += 1) {
              darkCount += ink[y * width + x];
            }
            if (darkCount >= minVertLine) {
              for (let y = 0; y < height; y += 1) {
                ink[y * width + x] = 0;
              }
            }
          }

          // Write clean black-on-white pixels back
          for (let p = 0; p < pixelCount; p += 1) {
            const v = ink[p] === 1 ? 0 : 255;
            const idx = p * 4;
            data[idx] = v;
            data[idx + 1] = v;
            data[idx + 2] = v;
            data[idx + 3] = 255;
          }

          ctx.putImageData(imgData, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(typeof imageSource === 'string' ? imageSource : '');
        }
      };
      img.src = src;
    });
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function recognizeArabicTextLocally(
  imageSource: string | File,
  options?: {
    onProgress?: (percent: number) => void;
    crop?: CropBoundsRatio;
    singleColumn?: boolean;
    includeEnglish?: boolean;
  }
): Promise<string> {
  const processedUrl = await preprocessArabicRosterImage(imageSource, options?.crop);
  const { createWorker, PSM } = await import('tesseract.js');

  const lang = options?.includeEnglish ? 'ara+eng' : 'ara';
  const logger = (m: { status?: string; progress?: number }) => {
    if (m.status === 'recognizing text' && typeof m.progress === 'number') {
      options?.onProgress?.(Math.max(10, Math.min(99, Math.round(m.progress * 100))));
    } else if (m.status === 'loading language traineddata' && typeof m.progress === 'number') {
      options?.onProgress?.(Math.max(2, Math.min(10, Math.round(m.progress * 10))));
    }
  };

  // Prefer high-accuracy Arabic model (4.0.0_best) for crisp cursive Arabic recognition; fall back to default CDN
  let worker: Awaited<ReturnType<typeof createWorker>>;
  try {
    worker = await createWorker(lang, 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0_best',
      logger,
    });
  } catch {
    worker = await createWorker(lang, 1, { logger });
  }

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: options?.singleColumn ? PSM.SINGLE_COLUMN : PSM.AUTO,
      preserve_interword_spaces: '1',
    });

    const result = await worker.recognize(processedUrl);
    options?.onProgress?.(100);
    return result.data.text || '';
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export async function extractStudentsLocallyFromImage(
  imageSource: string | File,
  options?: {
    onProgress?: (percent: number) => void;
    crop?: CropBoundsRatio;
    namesOnly?: boolean;
  }
): Promise<ParsedStudentCandidate[]> {
  const isCropped = Boolean(
    options?.crop &&
      (options.crop.left > 0.02 ||
        options.crop.right < 0.98 ||
        options.crop.top > 0.02 ||
        options.crop.bottom < 0.98)
  );

  // Pure Arabic ('ara' only) prevents Latin character hallucinations on Arabic sheets!
  const rawText = await recognizeArabicTextLocally(imageSource, {
    onProgress: options?.onProgress,
    crop: options?.crop,
    singleColumn: isCropped,
    includeEnglish: false,
  });

  return parseStudentsFromText(rawText, options?.namesOnly ?? true);
}

function matchStudentFromLine(
  line: string,
  sectionStudents: Student[]
): { studentId: string; confidence: 'high' | 'medium' | 'low' } {
  const normLine = normalizeArabicForMatch(line);
  if (!normLine || sectionStudents.length === 0) {
    return { studentId: '', confidence: 'low' };
  }
  const lineTokens = new Set(normLine.split(' ').filter((w) => w.length >= 2));

  let bestId = '';
  let bestScore = 0;

  for (const stu of sectionStudents) {
    const normStu = normalizeArabicForMatch(stu.fullName);
    if (!normStu) continue;

    if (normLine.includes(normStu) || normStu.includes(normLine)) {
      return { studentId: stu.id, confidence: 'high' };
    }

    const stuTokens = normStu.split(' ').filter((w) => w.length >= 2);
    if (stuTokens.length === 0) continue;

    let overlap = 0;
    for (const token of stuTokens) {
      if (lineTokens.has(token)) {
        overlap += 1;
      } else {
        for (const lt of lineTokens) {
          if (
            lt.length >= 3 &&
            token.length >= 3 &&
            (lt.startsWith(token.slice(0, 3)) || token.startsWith(lt.slice(0, 3)))
          ) {
            overlap += 0.6;
            break;
          }
        }
      }
    }

    const ratio = overlap / stuTokens.length;
    if (ratio > bestScore) {
      bestScore = ratio;
      bestId = stu.id;
    }
  }

  if (bestScore >= 0.75) return { studentId: bestId, confidence: 'high' };
  if (bestScore >= 0.45) return { studentId: bestId, confidence: 'medium' };
  return { studentId: '', confidence: 'low' };
}

export async function extractAttendanceLocallyFromImage(
  imageSource: string | File,
  sectionStudents: Student[],
  onProgress?: (percent: number) => void
): Promise<{ detectedDate: string; rows: ExtractedAttendanceRow[] }> {
  const rawText = await recognizeArabicTextLocally(imageSource, {
    onProgress,
    includeEnglish: false,
  });
  const normalized = normalizeArabicDigits(rawText);

  let detectedDate = '';
  const isoMatch = normalized.match(
    /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/
  );
  const dmyMatch = normalized.match(
    /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/
  );
  if (isoMatch) {
    detectedDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  } else if (dmyMatch) {
    detectedDate = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const rows: ExtractedAttendanceRow[] = [];
  const usedStudentIds = new Set<string>();

  for (const line of lines) {
    const cleanName = cleanSingleArabicNameSegment(line);
    if (!cleanName) continue;

    const match = matchStudentFromLine(cleanName, sectionStudents);
    if (match.studentId && usedStudentIds.has(match.studentId)) continue;
    if (match.studentId) usedStudentIds.add(match.studentId);

    const norm = normalizeArabicForMatch(line);
    let status: AttendanceStatus = 'absent';
    if (norm.includes('متاخر') || norm.includes('تاخر')) {
      status = 'late';
    } else if (norm.includes('بعذر') || norm.includes('مجاز') || norm.includes('اجازه')) {
      status = 'excused';
    } else if (norm.includes('حاضر')) {
      status = 'present';
    }

    rows.push({
      extractedName: cleanName,
      matchedStudentId: match.studentId,
      status,
      note: '',
      confidence: match.confidence,
    });
    if (rows.length >= 80) break;
  }

  return { detectedDate, rows };
}

export async function extractGradesLocallyFromImage(
  imageSource: string | File,
  sectionStudents: Student[],
  maxScore: number,
  onProgress?: (percent: number) => void
): Promise<{ detectedSubject: string; detectedMaxScore: number; rows: ExtractedGradeRow[] }> {
  const rawText = await recognizeArabicTextLocally(imageSource, {
    onProgress,
    includeEnglish: false,
  });
  const normalized = normalizeArabicDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const rows: ExtractedGradeRow[] = [];
  const usedStudentIds = new Set<string>();

  for (const line of lines) {
    const cleanName = cleanSingleArabicNameSegment(line);
    if (!cleanName) continue;

    let score: number | null = null;
    const fractionMatch = line.match(/(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{1,3})/);
    if (fractionMatch) {
      const val = Number(fractionMatch[1]);
      if (Number.isFinite(val) && val >= 0 && val <= Math.max(maxScore, 1000)) {
        score = val;
      }
    } else {
      const numMatches = line.match(/\b\d{1,3}(?:\.\d+)?\b/g);
      if (numMatches && numMatches.length > 0) {
        const candidate = Number(numMatches[numMatches.length - 1]);
        if (Number.isFinite(candidate) && candidate >= 0 && candidate <= Math.max(maxScore, 100)) {
          score = candidate;
        }
      }
    }

    const match = matchStudentFromLine(cleanName, sectionStudents);
    if (match.studentId && usedStudentIds.has(match.studentId)) continue;
    if (match.studentId) usedStudentIds.add(match.studentId);

    rows.push({
      extractedName: cleanName,
      matchedStudentId: match.studentId,
      score,
      note: normalizeArabicForMatch(line).includes('غائب') ? 'غائب عن الاختبار' : '',
      confidence: match.confidence,
    });
    if (rows.length >= 80) break;
  }

  return { detectedSubject: '', detectedMaxScore: 0, rows };
}
