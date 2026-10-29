/** Keep unchanged rows attached: removing and reattaching them resets focus and scroll anchors. */
export function reconcileElements(parent: HTMLElement, wanted: readonly HTMLElement[]): void {
  const retained = new Set(wanted);
  for (const child of Array.from(parent.children))
    if (!retained.has(child as HTMLElement)) child.remove();
  let next = parent.firstElementChild;
  for (const element of wanted) {
    if (element === next) next = next.nextElementSibling;
    else parent.insertBefore(element, next);
  }
}
