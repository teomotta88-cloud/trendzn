// Linee magnetiche per l'allineamento durante il drag (Fase 6): agganciano
// la posizione dell'elemento trascinato a bordi/centro degli altri elementi
// e del canvas quando sono entro una soglia in px, mostrando una guida.
// Solo per il drag (posizione) — il resize non aggancia, per scope
// deliberatamente limitato in questa prima versione.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuides {
  vertical: number[];
  horizontal: number[];
}

const SNAP_THRESHOLD_PX = 6;

function closestCandidate(value: number, candidates: number[]): number | null {
  let best: number | null = null;
  let bestDist = SNAP_THRESHOLD_PX;
  for (const c of candidates) {
    const dist = Math.abs(value - c);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export function computeSnap(
  moving: Box,
  others: Box[],
  canvas: { width: number; height: number },
): { x: number; y: number; guides: SnapGuides } {
  // Due elenchi separati, non uno solo: un bordo (0, canvas.width, il bordo
  // di un altro elemento) deve poter agganciare solo il bordo corrispondente
  // dell'elemento trascinato (sinistra/destra o alto/basso), MAI il suo
  // centro — altrimenti un bordo del frame che capita vicino al centro
  // dell'elemento lo aggancia lì, spostandolo fuori posto invece di
  // allinearne il bordo (bug osservato: il centro "saltava" sul bordo del
  // frame invece che il bordo dell'elemento).
  const edgeCandidatesX = [0, canvas.width];
  const centerCandidatesX = [canvas.width / 2];
  const edgeCandidatesY = [0, canvas.height];
  const centerCandidatesY = [canvas.height / 2];
  for (const o of others) {
    edgeCandidatesX.push(o.x, o.x + o.width);
    centerCandidatesX.push(o.x + o.width / 2);
    edgeCandidatesY.push(o.y, o.y + o.height);
    centerCandidatesY.push(o.y + o.height / 2);
  }

  const movingLeft = moving.x;
  const movingCenterX = moving.x + moving.width / 2;
  const movingRight = moving.x + moving.width;
  const movingTop = moving.y;
  const movingCenterY = moving.y + moving.height / 2;
  const movingBottom = moving.y + moving.height;

  let snappedX = moving.x;
  const vertical: number[] = [];
  const leftSnap = closestCandidate(movingLeft, edgeCandidatesX);
  const centerXSnap = closestCandidate(movingCenterX, centerCandidatesX);
  const rightSnap = closestCandidate(movingRight, edgeCandidatesX);
  if (centerXSnap !== null) {
    snappedX = centerXSnap - moving.width / 2;
    vertical.push(centerXSnap);
  } else if (leftSnap !== null) {
    snappedX = leftSnap;
    vertical.push(leftSnap);
  } else if (rightSnap !== null) {
    snappedX = rightSnap - moving.width;
    vertical.push(rightSnap);
  }

  let snappedY = moving.y;
  const horizontal: number[] = [];
  const topSnap = closestCandidate(movingTop, edgeCandidatesY);
  const centerYSnap = closestCandidate(movingCenterY, centerCandidatesY);
  const bottomSnap = closestCandidate(movingBottom, edgeCandidatesY);
  if (centerYSnap !== null) {
    snappedY = centerYSnap - moving.height / 2;
    horizontal.push(centerYSnap);
  } else if (topSnap !== null) {
    snappedY = topSnap;
    horizontal.push(topSnap);
  } else if (bottomSnap !== null) {
    snappedY = bottomSnap - moving.height;
    horizontal.push(bottomSnap);
  }

  return { x: snappedX, y: snappedY, guides: { vertical, horizontal } };
}
