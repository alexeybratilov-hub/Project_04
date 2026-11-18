const openModalStack: symbol[] = [];

export function registerOpenModal(id: symbol): void {
  if (!openModalStack.includes(id)) {
    openModalStack.push(id);
  }
}

export function unregisterOpenModal(id: symbol): void {
  const idx = openModalStack.indexOf(id);
  if (idx !== -1) {
    openModalStack.splice(idx, 1);
  }
}

export function isTopMostModal(id: symbol): boolean {
  return openModalStack.length > 0 && openModalStack[openModalStack.length - 1] === id;
}
