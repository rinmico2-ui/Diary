import { useLayoutEffect, useRef } from 'react';

/** Fit the conversation above the keyboard even when only the visual viewport shrinks. */
export function useChatViewport() {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      // Preserve native pinch zoom rather than reflowing the conversation into it.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      node.style.setProperty('--chat-height', `${viewport?.height ?? window.innerHeight}px`);
      node.style.setProperty('--chat-top', `${viewport?.offsetTop ?? 0}px`);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('resize', scheduleUpdate);
    viewport?.addEventListener('scroll', scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
      viewport?.removeEventListener('scroll', scheduleUpdate);
    };
  }, []);

  return ref;
}
