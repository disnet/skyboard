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
