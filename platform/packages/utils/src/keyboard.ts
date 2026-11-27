import { isMacOS } from './platform';

export const isCommandPressed = (event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) => {
  const isMac = isMacOS();

  if (isMac) {
    return event.metaKey; // Use metaKey (Command key) on macOS
  } else {
    return event.ctrlKey; // Use ctrlKey on Windows/Linux
  }
};
