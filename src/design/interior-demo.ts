// Development page for the playable Trollskull Manor (D34): pick a floor, pick a miniature, click
// a lit square to move it. `window.__interior` exposes the viewer to the browser smoke test.
import planJson from '../../content/maps/waterdeep/trollskull/floor-plan.json' with {
  type: 'json',
};
import catalogJson from '../../content/props/catalog.json' with { type: 'json' };
import type { FloorPlan, PropCatalog } from '../generated/contracts.ts';
import {
  createInteriorViewer,
  liveInteriorViewerCount,
  type FloorCellRef,
  type InteriorPieceSpec,
  type InteriorViewer,
} from '../lib/engine/interior-viewer.ts';

const plan = planJson as FloorPlan;
const catalog = catalogJson as PropCatalog;
/** Squares a miniature may walk in one move: 30 ft, a common D&D speed. */
const MOVE_SQUARES = 6;
const params = new URLSearchParams(location.search);

const PIECES: InteriorPieceSpec[] = [
  { id: 'exploradora', look: 'ranger', side: 'ally', cell: { floor: 'planta-baja', x: 4, y: 5 } },
  { id: 'maga', look: 'mage', side: 'ally', cell: { floor: 'planta-baja', x: 3, y: 3 } },
  { id: 'clerigo', look: 'cleric', side: 'ally', cell: { floor: 'cuspide-torreta', x: 1, y: 1 } },
  { id: 'matón', look: 'thug', side: 'enemy', cell: { floor: 'sotano', x: 3, y: 1 } },
];

const status = document.getElementById('status') as HTMLElement;
let selected: string | null = null;

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-pressed', 'false');
  element.addEventListener('click', onClick);
  return element;
}

function press(group: HTMLElement, active: HTMLButtonElement): void {
  for (const element of group.querySelectorAll('button')) {
    element.setAttribute('aria-pressed', String(element === active));
  }
}

function floorButtons(viewer: InteriorViewer): void {
  const group = document.getElementById('floors') as HTMLElement;
  const floors = [...plan.floors].sort((a, b) => b.elevation_m - a.elevation_m);
  for (const floor of floors) {
    const element = button(floor.name, () => {
      viewer.setFloor(floor.id);
      press(group, element);
    });
    group.append(element);
    if (floor.id === viewer.stats().floor) press(group, element);
  }
}

function pieceButtons(viewer: InteriorViewer): void {
  const group = document.getElementById('pieces') as HTMLElement;
  for (const piece of PIECES) {
    const element = button(piece.id, () => {
      selected = piece.id;
      const cell = viewer.pieceCell(piece.id);
      if (cell) viewer.setFloor(cell.floor);
      viewer.setMoveMode(piece.id, MOVE_SQUARES);
      press(group, element);
      status.textContent = `${piece.id}: ${viewer.stats().reachable} casillas a su alcance`;
    });
    group.append(element);
  }
}

function moveOnClick(viewer: InteriorViewer): void {
  viewer.on('cell', (cell: FloorCellRef) => {
    if (!selected) return;
    const moved = viewer.movePiece(selected, cell);
    status.textContent = moved
      ? `${selected} → ${cell.floor} (${cell.x}, ${cell.y})`
      : `${selected} no puede llegar ahí`;
  });
}

async function main(): Promise<void> {
  const canvas = document.getElementById('interior') as HTMLCanvasElement;
  try {
    const viewer = await createInteriorViewer(canvas, {
      plan,
      catalog,
      modelBase: '/models/trollskull/',
      backend: params.get('backend') === 'webgl2' ? 'webgl2' : 'auto',
      quality: params.get('quality') === 'low' ? 'low' : 'high',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    viewer.setPieces(PIECES);
    floorButtons(viewer);
    pieceButtons(viewer);
    moveOnClick(viewer);
    status.textContent = 'Elige una miniatura para moverla.';
    Object.assign(window, { __interior: viewer, __interiorLive: liveInteriorViewerCount });
  } catch (error) {
    status.textContent = `No se pudo abrir la mansión: ${String(error)}`;
    Object.assign(window, { __interiorError: String(error) });
  }
}

void main();
