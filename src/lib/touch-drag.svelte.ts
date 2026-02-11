import {
  setDraggedCard,
  getColumnRegistry,
  type DraggedCard,
} from "./drag-state.svelte.js";

const LONG_PRESS_MS = 200;
const MOVE_THRESHOLD = 8;
const AUTO_SCROLL_EDGE = 80;
const AUTO_SCROLL_MAX_SPEED = 20;

let ghostEl: HTMLElement | null = null;
let isDragging = false;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let dragData: DraggedCard | null = null;
let offsetX = 0;
let offsetY = 0;
let currentColumnId: string | null = null;
let currentDropIndex: number | null = null;
let lastTouchX = 0;
let lastTouchY = 0;
let autoScrollRAF: number | null = null;
let onDragStartCallback: (() => void) | null = null;
let removeEarlyListeners: (() => void) | null = null;

export function handleTouchStart(
  e: TouchEvent,
  cardEl: HTMLElement,
  data: DraggedCard,
  onDragStart?: () => void,
) {
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];
  const startX = touch.clientX;
  const startY = touch.clientY;
  dragData = data;
  isDragging = false;
  onDragStartCallback = onDragStart ?? null;

  const cancelEarlyMove = (ev: TouchEvent) => {
    const t = ev.touches[0];
    if (
      Math.abs(t.clientX - startX) + Math.abs(t.clientY - startY) >
      MOVE_THRESHOLD
    ) {
      cancelLongPress();
      cleanupEarly();
    }
  };

  const earlyEnd = () => {
    cancelLongPress();
    cleanupEarly();
  };

  const cleanupEarly = () => {
    document.removeEventListener("touchmove", cancelEarlyMove);
    document.removeEventListener("touchend", earlyEnd);
    document.removeEventListener("touchcancel", earlyEnd);
    removeEarlyListeners = null;
  };

  removeEarlyListeners = cleanupEarly;

  document.addEventListener("touchmove", cancelEarlyMove, { passive: true });
  document.addEventListener("touchend", earlyEnd);
  document.addEventListener("touchcancel", earlyEnd);

  longPressTimer = setTimeout(() => {
    cleanupEarly();
    beginDrag(cardEl, touch);
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function beginDrag(cardEl: HTMLElement, touch: Touch) {
  isDragging = true;
  longPressTimer = null;

  window.getSelection()?.removeAllRanges();
  if (navigator.vibrate) navigator.vibrate(30);

  const rect = cardEl.getBoundingClientRect();
  offsetX = touch.clientX - rect.left;
  offsetY = touch.clientY - rect.top;
  lastTouchX = touch.clientX;
  lastTouchY = touch.clientY;

  ghostEl = cardEl.cloneNode(true) as HTMLElement;
  Object.assign(ghostEl.style, {
    position: "fixed",
    width: rect.width + "px",
    left: rect.left + "px",
    top: rect.top + "px",
    opacity: "0.9",
    transform: "scale(1.03)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
    pointerEvents: "none",
    zIndex: "10000",
    transition: "none",
    margin: "0",
  });
  document.body.appendChild(ghostEl);

  setDraggedCard(dragData);
  onDragStartCallback?.();

  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd);
  document.addEventListener("touchcancel", onTouchEnd);

  autoScrollRAF = requestAnimationFrame(autoScroll);
}

function onTouchMove(e: TouchEvent) {
  if (!isDragging || !ghostEl) return;
  e.preventDefault();

  const touch = e.touches[0];
  lastTouchX = touch.clientX;
  lastTouchY = touch.clientY;

  ghostEl.style.left = touch.clientX - offsetX + "px";
  ghostEl.style.top = touch.clientY - offsetY + "px";

  updateDropTarget(touch.clientX, touch.clientY);
}

function updateDropTarget(x: number, y: number) {
  if (!ghostEl) return;

  ghostEl.style.display = "none";
  const elUnder = document.elementFromPoint(x, y);
  ghostEl.style.display = "";

  if (!elUnder) {
    clearAllDropIndicators();
    currentColumnId = null;
    currentDropIndex = null;
    return;
  }

  const columnEl = elUnder.closest("[data-column-id]") as HTMLElement | null;
  if (!columnEl) {
    clearAllDropIndicators();
    currentColumnId = null;
    currentDropIndex = null;
    return;
  }

  const columnId = columnEl.dataset.columnId!;
  currentColumnId = columnId;

  const taskList = columnEl.querySelector(".task-list");
  const slots = taskList
    ? (Array.from(
        taskList.querySelectorAll(":scope > .card-slot"),
      ) as HTMLElement[])
    : [];
  let dropIndex = slots.length;

  for (let i = 0; i < slots.length; i++) {
    const slotRect = slots[i].getBoundingClientRect();
    const midY = slotRect.top + slotRect.height / 2;
    if (y < midY) {
      dropIndex = i;
      break;
    }
  }

  currentDropIndex = dropIndex;

  const registry = getColumnRegistry();
  for (const [colId, reg] of registry) {
    if (colId === columnId) {
      reg.setDropIndex(dropIndex);
    } else {
      reg.clearDropIndex();
    }
  }
}

function edgeSpeed(pos: number, edgeStart: number, edgeEnd: number): number {
  if (pos < edgeStart + AUTO_SCROLL_EDGE) {
    const ratio = 1 - (pos - edgeStart) / AUTO_SCROLL_EDGE;
    return -AUTO_SCROLL_MAX_SPEED * Math.max(0, Math.min(1, ratio));
  }
  if (pos > edgeEnd - AUTO_SCROLL_EDGE) {
    const ratio = 1 - (edgeEnd - pos) / AUTO_SCROLL_EDGE;
    return AUTO_SCROLL_MAX_SPEED * Math.max(0, Math.min(1, ratio));
  }
  return 0;
}

function autoScroll() {
  if (!isDragging) return;

  let scrolled = false;

  const container = document.querySelector(".columns-container");
  if (container) {
    const rect = container.getBoundingClientRect();
    const hSpeed = edgeSpeed(lastTouchX, rect.left, rect.right);
    if (hSpeed !== 0) {
      container.scrollLeft += hSpeed;
      scrolled = true;
    }
  }

  if (currentColumnId) {
    const registry = getColumnRegistry();
    const col = registry.get(currentColumnId);
    if (col) {
      const taskList = col.element.querySelector(".task-list");
      if (taskList) {
        const tlRect = taskList.getBoundingClientRect();
        const vSpeed = edgeSpeed(lastTouchY, tlRect.top, tlRect.bottom);
        if (vSpeed !== 0) {
          taskList.scrollTop += vSpeed;
          scrolled = true;
        }
      }
    }
  }

  if (scrolled) {
    updateDropTarget(lastTouchX, lastTouchY);
  }

  autoScrollRAF = requestAnimationFrame(autoScroll);
}

function clearAllDropIndicators() {
  const registry = getColumnRegistry();
  for (const [, reg] of registry) {
    reg.clearDropIndex();
  }
}

function onTouchEnd() {
  document.removeEventListener("touchmove", onTouchMove);
  document.removeEventListener("touchend", onTouchEnd);
  document.removeEventListener("touchcancel", onTouchEnd);

  if (autoScrollRAF) {
    cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
  }

  if (!isDragging) return;

  if (currentColumnId && dragData && currentDropIndex !== null) {
    const registry = getColumnRegistry();
    const col = registry.get(currentColumnId);
    if (col) {
      col.onDrop(dragData.id, dragData.did, currentDropIndex);
    }
  }

  cleanup();
}

function cleanup() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }

  clearAllDropIndicators();
  setDraggedCard(null);
  isDragging = false;
  dragData = null;
  currentColumnId = null;
  currentDropIndex = null;
  onDragStartCallback = null;
}
