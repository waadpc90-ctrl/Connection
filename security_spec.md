# Security Specification & Payload-First TDD (Wisaal)

## 1. Data Invariants
1. **School Ownership Master Gate**: Every subcollection under `/schools/{schoolId}` (`classrooms`, `students`, `attendanceLogs`, `gradeEntries`) requires that `/schools/{schoolId}` exists and its `ownerId == request.auth.uid` (or verified Admin).
2. **PII Isolation**: Parent phone numbers (`parentPhone`) and parent full names (`parentName`) live strictly in `/schools/{schoolId}/students/{studentId}`, readable only by the owning school admin. Public `/passes/{passToken}` documents contain ZERO parent contact PII and disallow `list` queries (`allow list: if false`).
3. **Immutable Ownership & Timestamps**: `ownerId`, `schoolId`, `studentId`, `passToken`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.
4. **Action-Based Updates & Terminal Locking**: Updates use `affectedKeys().hasOnly(...)` allowlists. `ParentAcknowledgement.schoolStatus` transitions strictly from `'pending'` to `'reviewed'` and cannot be mutated back once `'reviewed'` (except by Admin).
5. **Bounded Arrays**: `recentAttendance` and `recentGrades` on `/passes/{passToken}` are bounded to `<= 40` entries with index-0 type guards.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Identity Spoofing on School Create**: `{ ownerId: "victim-uid", name: "Fake School", ... }`
2. **Shadow Field Injection on Student**: `{ ..., isAdmin: true }` (extra key blocked by `hasOnly`)
3. **PII Leak Attempt**: Signed-in non-owner calling `get(/schools/ownerA/students/s1)`
4. **Pass Scraping / Enumeration**: Unauthenticated or non-owner calling `list(/passes)`
5. **Short/Guessable Pass Token**: Creating `/passes/abc` (`size() < 16`)
6. **ID Poisoning**: Creating document with 200-char ID or invalid characters (`../evil`)
7. **Unverified Email Write**: Creating school with `email_verified: false`
8. **Fake Client Timestamp**: Sending `createdAt: Timestamp(2020-01-01)` instead of `request.time`
9. **Immutable Field Hijack**: Updating `Student.passToken` or `Student.ownerId`
10. **Array Exhaustion**: Writing `recentAttendance` with 41+ items on `/passes/{passToken}`
11. **Value Poisoning on Whitelisted Update**: Updating `AttendanceLog.status` to `"hacked"` or a 10KB string
12. **Terminal State Bypass**: Parent attempting to revert `ParentAcknowledgement.schoolStatus` from `'reviewed'` back to `'pending'`
