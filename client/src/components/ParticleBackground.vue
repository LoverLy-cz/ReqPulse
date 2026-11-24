<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

export type ParticleMode = 'constellation' | 'drift' | 'pulse';

const props = defineProps<{ mode: ParticleMode }>();

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  phase: number;
};

type TrailParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  decay: number;
};

const canvas = ref<HTMLCanvasElement | null>(null);
let context: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let trailParticles: TrailParticle[] = [];
let frameId = 0;
let width = 0;
let height = 0;
let pixelRatio = 1;
let lastTime = 0;
let palette = { primary: '183, 243, 74', secondary: '77, 226, 208' };
let themeObserver: MutationObserver | null = null;
let pointerX = 0;
let pointerY = 0;
let previousPointerX = 0;
let previousPointerY = 0;
let pointerActive = false;
let lastPointerTime = 0;
let lastEmissionTime = 0;
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  palette = {
    primary: hexToRgb(styles.getPropertyValue('--acid').trim()) ?? '183, 243, 74',
    secondary: hexToRgb(styles.getPropertyValue('--cyan').trim()) ?? '77, 226, 208',
  };
}

function hexToRgb(value: string): string | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return null;
  return `${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}`;
}

function resize() {
  if (!canvas.value) return;
  width = window.innerWidth;
  height = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.value.width = Math.round(width * pixelRatio);
  canvas.value.height = Math.round(height * pixelRatio);
  canvas.value.style.width = `${width}px`;
  canvas.value.style.height = `${height}px`;
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  createParticles();
}

function createParticles() {
  const area = width * height;
  const count = Math.max(28, Math.min(110, Math.round(area / 18_000)));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.18,
    vy: (Math.random() - 0.5) * 0.18,
    radius: 0.55 + Math.random() * 1.25,
    phase: Math.random() * Math.PI * 2,
  }));
}

function draw(time: number) {
  if (!context) return;
  const elapsed = Math.min(32, time - lastTime || 16);
  lastTime = time;
  context.clearRect(0, 0, width, height);

  if (props.mode === 'constellation') drawConstellation(elapsed, time);
  if (props.mode === 'drift') drawDrift(elapsed, time);
  if (props.mode === 'pulse') drawPulse(time);
  drawCursorEffect(elapsed, time);

  if (!prefersReducedMotion?.matches) frameId = window.requestAnimationFrame?.(draw) ?? 0;
}

function moveParticles(multiplier: number, elapsed: number) {
  for (const particle of particles) {
    particle.x += particle.vx * elapsed * multiplier;
    particle.y += particle.vy * elapsed * multiplier;
    applyPointerField(particle, elapsed);
    if (particle.x < -20) particle.x = width + 20;
    if (particle.x > width + 20) particle.x = -20;
    if (particle.y < -20) particle.y = height + 20;
    if (particle.y > height + 20) particle.y = -20;
  }
}

function applyPointerField(particle: Particle, elapsed: number) {
  if (!pointerActive || performance.now() - lastPointerTime > 900) return;
  const deltaX = pointerX - particle.x;
  const deltaY = pointerY - particle.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (!distance || distance > 190) return;
  const force = (1 - distance / 190) * elapsed * 0.009;
  const direction = props.mode === 'drift' ? 0.55 : 1;
  particle.x += (deltaX / distance) * force * direction;
  particle.y += (deltaY / distance) * force * direction;
  if (props.mode === 'drift') {
    particle.x += (-deltaY / distance) * force * 0.7;
    particle.y += (deltaX / distance) * force * 0.7;
  }
}

function drawConstellation(elapsed: number, time: number) {
  if (!context) return;
  moveParticles(1, elapsed);
  const linkDistance = Math.min(145, Math.max(100, width / 10));

  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    for (let otherIndex = index + 1; otherIndex < particles.length; otherIndex += 1) {
      const other = particles[otherIndex];
      const distance = Math.hypot(particle.x - other.x, particle.y - other.y);
      if (distance > linkDistance) continue;
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(other.x, other.y);
      context.strokeStyle = `rgba(${palette.secondary}, ${(1 - distance / linkDistance) * 0.2})`;
      context.lineWidth = 1;
      context.stroke();
    }
    drawDot(particle.x, particle.y, particle.radius, 0.34 + Math.sin(time * 0.0015 + particle.phase) * 0.1);
  }
}

function drawDrift(elapsed: number, time: number) {
  if (!context) return;
  moveParticles(2.4, elapsed);
  for (const particle of particles) {
    const wave = Math.sin(particle.x * 0.006 + time * 0.00055 + particle.phase);
    particle.y += wave * 0.12;
    const length = 10 + particle.radius * 12;
    context.beginPath();
    context.moveTo(particle.x - length, particle.y - wave * 4);
    context.lineTo(particle.x, particle.y);
    context.strokeStyle = `rgba(${palette.secondary}, ${0.12 + particle.radius * 0.075})`;
    context.lineWidth = Math.max(1, particle.radius * 0.75);
    context.stroke();
    drawDot(particle.x, particle.y, particle.radius * 0.72, 0.42);
  }
}

function drawPulse(time: number) {
  if (!context) return;
  const spacing = Math.max(130, Math.min(210, width / 7));
  const progress = (time * 0.00008) % 1;
  for (let y = spacing * 0.65; y < height + spacing; y += spacing) {
    for (let x = spacing * 0.55; x < width + spacing; x += spacing) {
      const offset = ((x / spacing + y / spacing) * 0.13) % 1;
      const localProgress = (progress + offset) % 1;
      const radius = 3 + localProgress * spacing * 0.42;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(${palette.secondary}, ${(1 - localProgress) * 0.18})`;
      context.lineWidth = 1;
      context.stroke();
      drawDot(x, y, 1.15, 0.32);
    }
  }
}

function drawCursorEffect(elapsed: number, time: number) {
  if (!context) return;
  const pointerAge = time - lastPointerTime;
  const pointerOpacity = pointerActive ? Math.max(0, 1 - pointerAge / 900) : 0;

  context.save();
  context.globalCompositeOperation = 'lighter';

  for (const particle of trailParticles) {
    particle.x += particle.vx * elapsed;
    particle.y += particle.vy * elapsed;
    particle.vx *= 0.985;
    particle.vy *= 0.985;
    particle.life -= particle.decay * elapsed;
    if (particle.life <= 0) continue;
    const alpha = Math.min(0.72, particle.life * 0.62);
    context.shadowBlur = 8 + particle.radius * 3;
    context.shadowColor = `rgba(${palette.secondary}, ${alpha})`;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.radius * (0.55 + particle.life * 0.65), 0, Math.PI * 2);
    context.fillStyle = `rgba(${palette.primary}, ${alpha})`;
    context.fill();
  }
  trailParticles = trailParticles.filter((particle) => particle.life > 0).slice(-96);

  if (pointerOpacity > 0.01) {
    connectPointerToParticles(pointerOpacity);
    const haloRadius = 18 + Math.sin(time * 0.006) * 3;
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(pointerX, pointerY, haloRadius, 0, Math.PI * 2);
    context.strokeStyle = `rgba(${palette.secondary}, ${pointerOpacity * 0.32})`;
    context.lineWidth = 1;
    context.stroke();
    drawDot(pointerX, pointerY, 1.5, pointerOpacity * 0.62);
  }

  context.restore();
}

function connectPointerToParticles(opacity: number) {
  if (!context || props.mode === 'pulse') return;
  const nearby = particles
    .map((particle) => ({ particle, distance: Math.hypot(pointerX - particle.x, pointerY - particle.y) }))
    .filter(({ distance }) => distance < 150)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 7);

  for (const { particle, distance } of nearby) {
    context.beginPath();
    context.moveTo(pointerX, pointerY);
    context.lineTo(particle.x, particle.y);
    context.strokeStyle = `rgba(${palette.secondary}, ${(1 - distance / 150) * opacity * 0.38})`;
    context.lineWidth = 1;
    context.stroke();
  }
}

function handlePointerMove(event: PointerEvent) {
  const x = event.clientX;
  const y = event.clientY;
  if (!pointerActive) {
    previousPointerX = x;
    previousPointerY = y;
  }
  pointerX = x;
  pointerY = y;
  pointerActive = true;
  const now = performance.now();
  lastPointerTime = now;
  if (lastEmissionTime > 0 && now - lastEmissionTime < 8) {
    previousPointerX = x;
    previousPointerY = y;
    return;
  }
  lastEmissionTime = now;

  const distance = Math.hypot(x - previousPointerX, y - previousPointerY);
  const steps = Math.max(1, Math.min(8, Math.ceil(distance / 12)));
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    spawnTrailParticle(
      previousPointerX + (x - previousPointerX) * progress,
      previousPointerY + (y - previousPointerY) * progress,
      1,
    );
  }
  previousPointerX = x;
  previousPointerY = y;
}

function handlePointerDown(event: PointerEvent) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  pointerActive = true;
  lastPointerTime = performance.now();
  for (let index = 0; index < 22; index += 1) spawnTrailParticle(pointerX, pointerY, 2.8);
}

function spawnTrailParticle(x: number, y: number, intensity: number) {
  if (prefersReducedMotion?.matches) return;
  const angle = Math.random() * Math.PI * 2;
  const speed = (0.018 + Math.random() * 0.045) * intensity;
  trailParticles.push({
    x: x + (Math.random() - 0.5) * 5,
    y: y + (Math.random() - 0.5) * 5,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 0.8 + Math.random() * 1.8 * Math.min(intensity, 1.8),
    life: 0.72 + Math.random() * 0.28,
    decay: 0.0007 + Math.random() * 0.00055,
  });
  if (trailParticles.length > 96) trailParticles.splice(0, trailParticles.length - 96);
}

function handleWindowBlur() {
  pointerActive = false;
}

function drawDot(x: number, y: number, radius: number, alpha: number) {
  if (!context) return;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = `rgba(${palette.primary}, ${alpha})`;
  context.fill();
}

function restart() {
  window.cancelAnimationFrame?.(frameId);
  lastTime = 0;
  frameId = window.requestAnimationFrame?.(draw) ?? 0;
}

watch(() => props.mode, restart);

onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null;
  readPalette();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('pointerdown', handlePointerDown, { passive: true });
  window.addEventListener('blur', handleWindowBlur);
  prefersReducedMotion?.addEventListener('change', restart);
  themeObserver = new MutationObserver(() => {
    readPalette();
    restart();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  restart();
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame?.(frameId);
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerdown', handlePointerDown);
  window.removeEventListener('blur', handleWindowBlur);
  prefersReducedMotion?.removeEventListener('change', restart);
  themeObserver?.disconnect();
});
</script>

<template>
  <canvas ref="canvas" class="particle-background" aria-hidden="true"></canvas>
</template>
