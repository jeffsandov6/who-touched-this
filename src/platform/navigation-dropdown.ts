const navigationSelector = '[data-pages-navigation]';

export function initializeNavigationDropdowns(root: ParentNode = document): () => void {
  const cleanups = [...root.querySelectorAll<HTMLElement>(navigationSelector)].map((navigation) => {
    const trigger = navigation.querySelector<HTMLButtonElement>('[data-pages-trigger]');
    const dropdown = navigation.querySelector<HTMLElement>('[data-pages-dropdown]');
    if (!trigger || !dropdown) return () => undefined;

    const setOpen = (open: boolean): void => {
      trigger.setAttribute('aria-expanded', String(open));
      dropdown.hidden = !open;
    };
    const onTriggerClick = (): void => setOpen(trigger.getAttribute('aria-expanded') !== 'true');
    const onNavigationClick = (event: Event): void => {
      if ((event.target as Element).closest('[data-pages-dropdown] a')) setOpen(false);
    };
    const onDocumentPointerDown = (event: Event): void => {
      if (!navigation.contains(event.target as Node)) setOpen(false);
    };
    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        trigger.focus();
      }
    };

    trigger.addEventListener('click', onTriggerClick);
    navigation.addEventListener('click', onNavigationClick);
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);

    return () => {
      trigger.removeEventListener('click', onTriggerClick);
      navigation.removeEventListener('click', onNavigationClick);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  });

  return () => cleanups.forEach((cleanup) => cleanup());
}

