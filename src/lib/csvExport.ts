import {
  AttendanceLog,
  classifyPercentage,
  getAttendanceMeta,
  Student,
  SubjectSummary,
} from '../types/wisaal';

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  // Guard against spreadsheet formula injection (+, -, =, @)
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function triggerCsvDownload(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  // UTF-8 BOM ensures Arabic text opens cleanly in Microsoft Excel
  const csvContent = `\uFEFF${lines.join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSectionGradesCsv(params: {
  schoolName: string;
  stageName: string;
  sectionName: string;
  subjects: string[];
  rows: Array<{
    student: Student;
    metrics: {
      averagePercent: number;
      subjectsCount: number;
      totalScoreSum: number;
      totalMaxScoreSum: number;
      totalAbsent: number;
      totalLate: number;
    };
    bySub: Map<string, SubjectSummary>;
  }>;
}) {
  const headers = [
    'ت',
    'اسم الطالب',
    'الرمز',
    ...params.subjects,
    'المجموع',
    'المعدل %',
    'التقدير',
    'الغياب',
    'التأخر',
  ];

  const dataRows = params.rows.map((row, index) => {
    const rating =
      row.metrics.subjectsCount > 0 ? classifyPercentage(row.metrics.averagePercent).label : '—';
    const subjectCells = params.subjects.map((sub) => {
      const s = row.bySub.get(sub);
      return s ? `${s.latestScore}/${s.latestMaxScore}` : '—';
    });
    return [
      index + 1,
      row.student.fullName,
      row.student.studentCode,
      ...subjectCells,
      row.metrics.totalMaxScoreSum > 0
        ? `${row.metrics.totalScoreSum}/${row.metrics.totalMaxScoreSum}`
        : '—',
      row.metrics.subjectsCount > 0 ? `${row.metrics.averagePercent}%` : '—',
      rating,
      row.metrics.totalAbsent,
      row.metrics.totalLate,
    ];
  });

  const safeSection = params.sectionName.replace(/[^\u0621-\u064Aa-zA-Z0-9_-]/g, '_');
  const today = new Date().toISOString().slice(0, 10);
  triggerCsvDownload(`درجات_${safeSection}_${today}.csv`, headers, dataRows);
}

export function exportSectionAttendanceCsv(params: {
  sectionName: string;
  date: string;
  students: Student[];
  logsForDate: Map<string, AttendanceLog>;
  allLogs: AttendanceLog[];
}) {
  const headers = [
    'ت',
    'اسم الطالب',
    'الرمز',
    'التاريخ',
    'الحالة',
    'الملاحظة',
    'إجمالي الغياب',
    'إجمالي التأخر',
    'إجمالي بعذر',
  ];

  const totalsByStudent = new Map<string, { absent: number; late: number; excused: number }>();
  for (const log of params.allLogs) {
    const cur = totalsByStudent.get(log.studentId) || { absent: 0, late: 0, excused: 0 };
    if (log.status === 'absent') cur.absent += 1;
    else if (log.status === 'late') cur.late += 1;
    else if (log.status === 'excused') cur.excused += 1;
    totalsByStudent.set(log.studentId, cur);
  }

  const dataRows = params.students.map((stu, idx) => {
    const dayLog = params.logsForDate.get(stu.id);
    const statusLabel = dayLog ? getAttendanceMeta(dayLog.status).shortLabel : 'حاضر';
    const totals = totalsByStudent.get(stu.id) || { absent: 0, late: 0, excused: 0 };
    return [
      idx + 1,
      stu.fullName,
      stu.studentCode,
      params.date,
      statusLabel,
      dayLog?.note || '',
      totals.absent,
      totals.late,
      totals.excused,
    ];
  });

  const safeSection = params.sectionName.replace(/[^\u0621-\u064Aa-zA-Z0-9_-]/g, '_');
  triggerCsvDownload(`حضور_${safeSection}_${params.date}.csv`, headers, dataRows);
}
