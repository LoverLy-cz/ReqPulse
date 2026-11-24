// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ParticleBackground from './ParticleBackground.vue';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParticleBackground', () => {
  it('draws a cursor trail and a larger burst on pointer input', () => {
    let animationFrame: FrameRequestCallback | undefined;
    const context = createContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const wrapper = mount(ParticleBackground, { props: { mode: 'constellation' } });
    window.dispatchEvent(pointerEvent('pointermove', 180, 120));
    animationFrame?.(performance.now() + 16);
    const moveArcCount = context.arc.mock.calls.length;

    window.dispatchEvent(pointerEvent('pointerdown', 180, 120));
    animationFrame?.(performance.now() + 32);

    expect(moveArcCount).toBeGreaterThan(0);
    expect(context.arc.mock.calls.length).toBeGreaterThan(moveArcCount);
    expect(context.save).toHaveBeenCalled();
    expect(context.restore).toHaveBeenCalled();
    wrapper.unmount();
  });
});

function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type);
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function createContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    lineWidth: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D & {
    arc: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
}
