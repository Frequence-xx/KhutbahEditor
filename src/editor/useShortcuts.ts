import { useEffect } from 'react';

type Handlers = {
  onPlayPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onStepBackFrame: () => void;
  onStepForwardFrame: () => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onSplit: () => void;
};

export function useEditorShortcuts(h: Handlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          h.onPlayPause();
          return;
        case 'j':
        case 'J':
          e.preventDefault();
          h.onStepBack();
          return;
        case 'l':
        case 'L':
          e.preventDefault();
          h.onStepForward();
          return;
        case 'i':
        case 'I':
          e.preventDefault();
          h.onSetIn();
          return;
        case 'o':
        case 'O':
          e.preventDefault();
          h.onSetOut();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) h.onStepBackFrame();
          else h.onStepBack();
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) h.onStepForwardFrame();
          else h.onStepForward();
          return;
        case 's':
        case 'S':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            h.onSplit();
          }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);
}
