import type { PageElement, PageState, StateDiff } from "./types.js";

export class StateDiffer {
  private previousState: PageState | null = null;

  /**
   * Compute the diff between the previous state and the current state.
   * Returns null if there's no previous state to compare against.
   */
  computeDiff(currentState: PageState): StateDiff | null {
    if (!this.previousState) {
      this.previousState = currentState;
      return null;
    }

    const prev = this.previousState;
    const curr = currentState;

    const navigated = prev.url !== curr.url;

    // Build maps by role+name for matching (since IDs are reassigned each snapshot)
    const prevMap = new Map<string, PageElement>();
    for (const el of prev.elements) {
      prevMap.set(elementKey(el), el);
    }

    const currMap = new Map<string, PageElement>();
    for (const el of curr.elements) {
      currMap.set(elementKey(el), el);
    }

    // Find removed elements (in prev but not in curr)
    const removed: number[] = [];
    for (const [key, el] of prevMap) {
      if (!currMap.has(key)) {
        removed.push(el.id);
      }
    }

    // Find added elements (in curr but not in prev)
    const added: PageElement[] = [];
    for (const [key, el] of currMap) {
      if (!prevMap.has(key)) {
        added.push(el);
      }
    }

    // Find modified elements (in both but with changed properties)
    const modified: StateDiff["modified"] = [];
    for (const [key, currEl] of currMap) {
      const prevEl = prevMap.get(key);
      if (!prevEl) continue;

      const changes: Record<string, { from: unknown; to: unknown }> = {};

      if (prevEl.value !== currEl.value) {
        changes.value = { from: prevEl.value, to: currEl.value };
      }
      if (prevEl.checked !== currEl.checked) {
        changes.checked = { from: prevEl.checked, to: currEl.checked };
      }
      if (prevEl.disabled !== currEl.disabled) {
        changes.disabled = { from: prevEl.disabled, to: currEl.disabled };
      }
      if (prevEl.expanded !== currEl.expanded) {
        changes.expanded = { from: prevEl.expanded, to: currEl.expanded };
      }
      if (prevEl.selected !== currEl.selected) {
        changes.selected = { from: prevEl.selected, to: currEl.selected };
      }
      if (prevEl.pressed !== currEl.pressed) {
        changes.pressed = { from: prevEl.pressed, to: currEl.pressed };
      }

      if (Object.keys(changes).length > 0) {
        modified.push({ id: currEl.id, changes });
      }
    }

    // Update stored state
    this.previousState = currentState;

    return {
      navigated,
      previousUrl: navigated ? prev.url : undefined,
      newUrl: navigated ? curr.url : undefined,
      removed,
      added,
      modified,
    };
  }

  /**
   * Reset the differ (no previous state).
   */
  reset(): void {
    this.previousState = null;
  }

  /**
   * Check if a diff has meaningful changes.
   */
  static hasChanges(diff: StateDiff): boolean {
    return (
      diff.navigated ||
      diff.removed.length > 0 ||
      diff.added.length > 0 ||
      diff.modified.length > 0
    );
  }
}

/** Create a stable key for an element based on its role and name */
function elementKey(el: PageElement): string {
  return `${el.role}::${el.name}::${el.level ?? ""}`;
}
