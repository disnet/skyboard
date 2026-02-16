export interface SelectedPos {
  col: number;
  row: number;
}

let selectedPos = $state<SelectedPos | null>(null);

export function getSelectedPos(): SelectedPos | null {
  return selectedPos;
}

export function setSelectedPos(pos: SelectedPos): void {
  selectedPos = pos;
}

export function clearSelection(): void {
  selectedPos = null;
}

// Hover suppression: prevent onmouseenter from stealing selection after
// keyboard-based card reordering moves DOM elements under a static cursor.
let hoverSuppressed = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "mousemove",
    () => {
      hoverSuppressed = false;
    },
    { passive: true },
  );
}

export function suppressHover(): void {
  hoverSuppressed = true;
}

export function shouldHandleHover(): boolean {
  return !hoverSuppressed;
}
