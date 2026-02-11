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
