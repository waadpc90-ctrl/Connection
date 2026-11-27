// Multi-child saved pass storage and resilient timestamp-based broadcast read tracking

export interface SavedChildPass {
  passToken: string;
  studentDisplayName: string;
  className: string;
  stageId?: string;
  stageName?: string;
}

const LEGACY_SINGLE_CHILD_KEY = 'wisaal_saved_child_pass';
const MULTI_CHILDREN_KEY = 'wisaal_saved_children_v2';
const MAX_SAVED_CHILDREN = 10;

function isValidChildEntry(item: unknown): item is SavedChildPass {
  if (!item || typeof item !== 'object') return false;
  const c = item as Partial<SavedChildPass>;
  return (
    typeof c.passToken === 'string' &&
    /^[a-zA-Z0-9_\-]{16,64}$/.test(c.passToken) &&
    typeof c.studentDisplayName === 'string' &&
    c.studentDisplayName.trim().length > 0 &&
    typeof c.className === 'string'
  );
}

export function getSavedChildren(): SavedChildPass[] {
  try {
    const list: SavedChildPass[] = [];
    const seen = new Set<string>();

    const rawMulti = window.localStorage.getItem(MULTI_CHILDREN_KEY);
    if (rawMulti) {
      const parsed = JSON.parse(rawMulti) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isValidChildEntry(item) && !seen.has(item.passToken)) {
            seen.add(item.passToken);
            list.push(item);
          }
        }
      }
    }

    // Auto-migrate legacy single saved child if not already present
    const rawLegacy = window.localStorage.getItem(LEGACY_SINGLE_CHILD_KEY);
    if (rawLegacy) {
      const parsedLegacy = JSON.parse(rawLegacy) as unknown;
      if (isValidChildEntry(parsedLegacy) && !seen.has(parsedLegacy.passToken)) {
        seen.add(parsedLegacy.passToken);
        list.push(parsedLegacy);
        window.localStorage.setItem(MULTI_CHILDREN_KEY, JSON.stringify(list.slice(0, MAX_SAVED_CHILDREN)));
      }
    }

    return list.slice(0, MAX_SAVED_CHILDREN);
  } catch {
    return [];
  }
}

export function saveChildPass(child: SavedChildPass): SavedChildPass[] {
  if (!isValidChildEntry(child)) return getSavedChildren();
  try {
    const existing = getSavedChildren().filter((c) => c.passToken !== child.passToken);
    const updated = [child, ...existing].slice(0, MAX_SAVED_CHILDREN);
    window.localStorage.setItem(MULTI_CHILDREN_KEY, JSON.stringify(updated));
    window.localStorage.setItem(LEGACY_SINGLE_CHILD_KEY, JSON.stringify(child));
    return updated;
  } catch {
    return [];
  }
}

export function removeSavedChildPass(passToken: string): SavedChildPass[] {
  try {
    const updated = getSavedChildren().filter((c) => c.passToken !== passToken);
    window.localStorage.setItem(MULTI_CHILDREN_KEY, JSON.stringify(updated));
    if (updated.length > 0) {
      window.localStorage.setItem(LEGACY_SINGLE_CHILD_KEY, JSON.stringify(updated[0]));
    } else {
      window.localStorage.removeItem(LEGACY_SINGLE_CHILD_KEY);
    }
    return updated;
  } catch {
    return [];
  }
}

// --- Timestamp-Resilient Stage Read Tracking ---
export interface StageReadState {
  lastReadId: string;
  lastReadIso: string;
}

export function getStageReadState(storageKeyPrefix: string): StageReadState {
  try {
    const lastReadId = window.localStorage.getItem(`wisaal_stage_read_${storageKeyPrefix}`) || '';
    const lastReadIso = window.localStorage.getItem(`wisaal_stage_read_iso_${storageKeyPrefix}`) || '';
    return { lastReadId, lastReadIso };
  } catch {
    return { lastReadId: '', lastReadIso: '' };
  }
}

export function saveStageReadState(
  storageKeyPrefix: string,
  lastReadId: string,
  lastReadIso: string
): void {
  try {
    if (lastReadId) {
      window.localStorage.setItem(`wisaal_stage_read_${storageKeyPrefix}`, lastReadId);
    }
    if (lastReadIso) {
      window.localStorage.setItem(`wisaal_stage_read_iso_${storageKeyPrefix}`, lastReadIso);
    }
  } catch {
    // Ignore restricted storage
  }
}
