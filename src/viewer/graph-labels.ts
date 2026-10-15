export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelRequest extends LabelBox {
  id: string;
  radius: number;
  priority: number;
}

export function placeLabels(
  requests: LabelRequest[],
  obstacles: LabelBox[],
  bounds?: LabelBox,
): Map<string, LabelBox> {
  const placed = new Map<string, LabelBox>();
  const occupied = [...obstacles];
  const overlaps = (a: LabelBox, b: LabelBox) =>
    a.x < b.x + b.width + 4 &&
    a.x + a.width + 4 > b.x &&
    a.y < b.y + b.height + 4 &&
    a.y + a.height + 4 > b.y;
  for (const request of [...requests].sort((a, b) => b.priority - a.priority)) {
    const { x, y, width, height, radius } = request;
    const offset = radius + 8;
    const candidates = [
      { x: x + offset, y: y - height / 2 },
      { x: x - offset - width, y: y - height / 2 },
      { x: x - width / 2, y: y + offset },
      { x: x - width / 2, y: y - offset - height },
    ].map((position) => ({ ...position, width, height }));
    const box = candidates.find(
      (candidate) =>
        (!bounds ||
          (candidate.x >= bounds.x &&
            candidate.y >= bounds.y &&
            candidate.x + width <= bounds.x + bounds.width &&
            candidate.y + height <= bounds.y + bounds.height)) &&
        !occupied.some((obstacle) => overlaps(candidate, obstacle)),
    );
    if (box) {
      placed.set(request.id, box);
      occupied.push(box);
    }
  }
  return placed;
}
