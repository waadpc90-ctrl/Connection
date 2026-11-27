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

    // Static hosting (e.g. GitHub Pages) returns HTML 404/405 instead of JSON
    const trimmed = rawText.trimStart();
    const looksLikeHtml = trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<');
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
      if (resp.status === 404 || resp.status === 405 || resp.status === 502 || resp.status === 503 || resp.status === 504) {
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
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeArabicForMatch(input: string): string {
  return normalizeArabicDigits(input)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip Arabic diacritics
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\u0621-\u064Aa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_EXACT_WORDS = new Set([
  'الاسم',
  'اسم الطالب',
  'اسم الطالبه',
  'الاسم الثلاثي',
  'الاسم الرباعي',
  'الاسم الكامل',
  'الاسماء',
  'التسلسل',
  'تسلسل',
  'ت',
  'م',
  'الرمز',
  'الهاتف',
  'الجوال',
  'رقم الهاتف',
  'ولي الامر',
  'الملاحظات',
  'ملاحظات',
  'الشعبه',
  'الصف',
  'المرحله',
  'الدرجه',
  'المجموع',
  'الماده',
  'الحضور',
  'الغياب',
  'التوقيع',
  'name',
  'student',
  'student name',
  'phone',
]);

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
  fromOcr = false
): ParsedStudentCandidate[] {
  const normalized = normalizeArabicDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: ParsedStudentCandidate[] = [];

  for (const rawLine of lines) {
    // Strip leading bullets, table pipes, or row numbering like "1-", "1.", "1)", "(1)"
    let line = rawLine
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
      // Pick the part that looks most like a person's name (contains Arabic/Latin letters)
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

    if (fromOcr) {
      // Clean table border artifacts and trailing numbers from OCR lines
      fullName = fullName
        .replace(/[|_~`^=\\/<>[\]{}]+/g, ' ')
        .replace(/\b\d{1,3}\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      fullName = fullName.replace(/\s+/g, ' ').trim();
    }

    fullName = fullName.slice(0, 100);
    if (fullName.length < 3) continue;

    // Must contain real letters (at least 2 letters)
    const letterCount = (fullName.match(/[\u0621-\u064Aa-zA-Z]/g) || []).length;
    if (letterCount < 3) continue;

    const normHeader = normalizeArabicForMatch(fullName);
    if (HEADER_EXACT_WORDS.has(normHeader)) continue;
    if (
      fromOcr &&
      (normHeader.startsWith('اعداديه ') ||
        normHeader.startsWith('مدرسه ') ||
        normHeader.startsWith('ثانويه ') ||
        normHeader.startsWith('متوسطه ') ||
        normHeader.startsWith('كشف ') ||
        normHeader.startsWith('قائمه ') ||
        normHeader.startsWith('المرحله ') ||
        normHeader.startsWith('الشعبه '))
    ) {
      continue;
    }

    results.push({
      fullName,
      studentCode,
      parentName,
      parentPhone,
    });

    if (results.length >= 200) break;
  }

  return results;
}

async function preprocessImageForOcr(imageDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(imageDataUrl);
    img.onload = () => {
      try {
        const targetMax = 2000;
        const scale = Math.min(2, targetMax / Math.max(img.width, img.height, 1));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageDataUrl);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to high-contrast grayscale so blue/tinted sheets read much more cleanly
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const contrast = 1.45;
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const adj = Math.max(0, Math.min(255, (lum - 128) * contrast + 138));
          data[i] = adj;
          data[i + 1] = adj;
          data[i + 2] = adj;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(imageDataUrl);
      }
    };
    img.src = imageDataUrl;
  });
}

export async function recognizeArabicTextLocally(
  imageDataUrl: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const processedUrl = await preprocessImageForOcr(imageDataUrl);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('ara+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.max(5, Math.min(99, Math.round(m.progress * 100))));
      }
    },
  });

  try {
    const result = await worker.recognize(processedUrl);
    onProgress?.(100);
    return result.data.text || '';
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export async function extractStudentsLocallyFromImage(
  imageDataUrl: string,
  onProgress?: (percent: number) => void
): Promise<ParsedStudentCandidate[]> {
  const rawText = await recognizeArabicTextLocally(imageDataUrl, onProgress);
  return parseStudentsFromText(rawText, true);
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
        // Allow partial prefix match for minor OCR character variations
        for (const lt of lineTokens) {
          if (lt.length >= 3 && token.length >= 3 && (lt.startsWith(token.slice(0, 3)) || token.startsWith(lt.slice(0, 3)))) {
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
  imageDataUrl: string,
  sectionStudents: Student[],
  onProgress?: (percent: number) => void
): Promise<{ detectedDate: string; rows: ExtractedAttendanceRow[] }> {
  const rawText = await recognizeArabicTextLocally(imageDataUrl, onProgress);
  const normalized = normalizeArabicDigits(rawText);

  let detectedDate = '';
  const isoMatch = normalized.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  const dmyMatch = normalized.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
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
    const cleanName = line
      .replace(/^[\s•*–—\-|_[\]():0-9.]+/, '')
      .replace(/[|_~`^=\\/<>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    if (cleanName.length < 3) continue;
    if ((cleanName.match(/[\u0621-\u064Aa-zA-Z]/g) || []).length < 3) continue;
    if (HEADER_EXACT_WORDS.has(normalizeArabicForMatch(cleanName))) continue;

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
  imageDataUrl: string,
  sectionStudents: Student[],
  maxScore: number,
  onProgress?: (percent: number) => void
): Promise<{ detectedSubject: string; detectedMaxScore: number; rows: ExtractedGradeRow[] }> {
  const rawText = await recognizeArabicTextLocally(imageDataUrl, onProgress);
  const normalized = normalizeArabicDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);

  const rows: ExtractedGradeRow[] = [];
  const usedStudentIds = new Set<string>();

  for (const line of lines) {
    const cleanText = line
      .replace(/^[\s•*–—\-|_[\]()]+/, '')
      .replace(/^\d{1,3}[\s.)\-:]+/, '')
      .replace(/[|_~`^=\\<>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if ((cleanText.match(/[\u0621-\u064Aa-zA-Z]/g) || []).length < 3) continue;
    if (HEADER_EXACT_WORDS.has(normalizeArabicForMatch(cleanText))) continue;

    let score: number | null = null;
    const fractionMatch = cleanText.match(/(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{1,3})/);
    if (fractionMatch) {
      const val = Number(fractionMatch[1]);
      if (Number.isFinite(val) && val >= 0 && val <= Math.max(maxScore, 1000)) {
        score = val;
      }
    } else {
      const numMatches = cleanText.match(/\b\d{1,3}(?:\.\d+)?\b/g);
      if (numMatches && numMatches.length > 0) {
        const candidate = Number(numMatches[numMatches.length - 1]);
        if (Number.isFinite(candidate) && candidate >= 0 && candidate <= Math.max(maxScore, 100)) {
          score = candidate;
        }
      }
    }

    const nameOnly = cleanText
      .replace(/\d+(?:\.\d+)?(?:\s*\/\s*\d+)?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    if (nameOnly.length < 3) continue;

    const match = matchStudentFromLine(nameOnly, sectionStudents);
    if (match.studentId && usedStudentIds.has(match.studentId)) continue;
    if (match.studentId) usedStudentIds.add(match.studentId);

    rows.push({
      extractedName: nameOnly,
      matchedStudentId: match.studentId,
      score,
      note: normalizeArabicForMatch(line).includes('غائب') ? 'غائب عن الاختبار' : '',
      confidence: match.confidence,
    });
    if (rows.length >= 80) break;
  }

  return { detectedSubject: '', detectedMaxScore: 0, rows };
}
