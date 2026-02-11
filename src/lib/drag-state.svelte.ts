export interface DraggedCard {
  id: number;
  did: string;
  rkey: string;
  columnId: string;
}

let draggedCard = $state<DraggedCard | null>(null);

export function getDraggedCard(): DraggedCard | null {
  return draggedCard;
}

export function setDraggedCard(card: DraggedCard | null): void {
  draggedCard = card;
}

// Column registry for touch drag coordination
export interface ColumnRegistration {
  element: HTMLElement;
  onDrop: (taskId: number, taskDid: string, dropIndex: number) => void;
  setDropIndex: (index: number) => void;
  clearDropIndex: () => void;
}

const columnRegistry = new Map<string, ColumnRegistration>();

export function registerColumn(columnId: string, reg: ColumnRegistration) {
  columnRegistry.set(columnId, reg);
}

export function unregisterColumn(columnId: string) {
  columnRegistry.delete(columnId);
}

export function getColumnRegistry() {
  return columnRegistry;
}
