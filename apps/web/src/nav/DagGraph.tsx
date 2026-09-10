import { useMemo } from "react";
import type { DagNode, Edge, NodeStatus } from "../nav-types";
import { formatUnits, short } from "./format";

const BOX_W = 176;
const BOX_H = 66;
const GAP_X = 18;
const GAP_Y = 54;
const PAD = 16;

type Placed = { node: DagNode; x: number; y: number; layer: number };

/** Longest-path layering from the roots; unreachable nodes land in a trailing layer. */
function layerNodes(nodes: DagNode[], edges: Edge[], rootIds: string[]): DagNode[][] {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.parent) || !byId.has(edge.child)) continue;
    children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
  }
  const layerOf = new Map<string, number>();
  const roots = rootIds.filter((id) => byId.has(id));
  const seedIds = roots.length > 0 ? roots : nodes.filter((node) => !edges.some((edge) => edge.child === node.node_id)).map((node) => node.node_id);
  let frontier = seedIds.map((id) => ({ id, depth: 0 }));
  let guard = 0;
  while (frontier.length > 0 && guard++ < nodes.length + 1) {
    const next: Array<{ id: string; depth: number }> = [];
    for (const { id, depth } of frontier) {
      if ((layerOf.get(id) ?? -1) >= depth) continue;
      layerOf.set(id, depth);
      for (const child of children.get(id) ?? []) next.push({ id: child, depth: depth + 1 });
    }
    frontier = next;
  }
  const layers: DagNode[][] = [];
  for (const node of nodes) {
    const depth = layerOf.get(node.node_id);
    if (depth === undefined) continue;
    (layers[depth] ??= []).push(node);
  }
  const orphans = nodes.filter((node) => !layerOf.has(node.node_id));
  if (orphans.length > 0) layers.push(orphans);
  return layers.map((layer) => layer.sort((a, b) => a.kind.localeCompare(b.kind) || a.node_id.localeCompare(b.node_id)));
}

export function DagGraph({ nodes, edges, rootIds, selectedId, onSelect }: {
  nodes: DagNode[];
  edges: Edge[];
  rootIds: string[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const { placed, width, height } = useMemo(() => {
    const layers = layerNodes(nodes, edges, rootIds);
    const widest = Math.max(1, ...layers.map((layer) => layer.length));
    const width = PAD * 2 + widest * BOX_W + (widest - 1) * GAP_X;
    const placed = new Map<string, Placed>();
    layers.forEach((layer, layerIndex) => {
      const rowWidth = layer.length * BOX_W + (layer.length - 1) * GAP_X;
      const startX = (width - rowWidth) / 2;
      layer.forEach((node, index) => {
        placed.set(node.node_id, { node, layer: layerIndex, x: startX + index * (BOX_W + GAP_X), y: PAD + layerIndex * (BOX_H + GAP_Y) });
      });
    });
    const height = PAD * 2 + layers.length * BOX_H + Math.max(0, layers.length - 1) * GAP_Y;
    return { placed, width, height };
  }, [nodes, edges, rootIds]);

  if (nodes.length === 0) {
    return <div className="nav-graph-empty">No nodes written yet. Run “Open valuation” to seed the roots.</div>;
  }

  return (
    <div className="nav-graph-scroll">
      <svg className="nav-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Valuation DAG">
        <g className="nav-graph-edges">
          {edges.map((edge) => {
            const from = placed.get(edge.parent);
            const to = placed.get(edge.child);
            if (!from || !to) return null;
            const x1 = from.x + BOX_W / 2;
            const y1 = from.y + BOX_H;
            const x2 = to.x + BOX_W / 2;
            const y2 = to.y;
            const bend = Math.max(18, (y2 - y1) / 2);
            const path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
            const highlighted = edge.parent === selectedId || edge.child === selectedId;
            return (
              <g key={`${edge.parent}-${edge.child}-${edge.relation}`} className={highlighted ? "hot" : undefined}>
                <path d={path} />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} textAnchor="middle">{edge.relation}</text>
              </g>
            );
          })}
        </g>
        <g className="nav-graph-nodes">
          {[...placed.values()].map(({ node, x, y }) => (
            <NodeBox key={node.node_id} node={node} x={x} y={y} selected={node.node_id === selectedId} onSelect={() => onSelect(node.node_id)} />
          ))}
        </g>
      </svg>
    </div>
  );
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  proposed: "PROPOSED",
  verified: "VERIFIED",
  priced: "PRICED",
  excluded: "EXCLUDED",
  unresolved: "UNRESOLVED",
};

function NodeBox({ node, x, y, selected, onSelect }: { node: DagNode; x: number; y: number; selected: boolean; onSelect: () => void }) {
  const quantity = node.quantity
    ? `${formatUnits(node.quantity.raw, node.quantity.decimals)} ${node.quantity.symbol}`.trim()
    : node.status === "unresolved" ? (node.unresolved?.reason ?? "unresolved") : "—";
  const label = STATUS_LABEL[node.status];
  const pillWidth = label.length * 5.4 + 10;
  return (
    <g
      className={`nav-node ${node.status} ${selected ? "selected" : ""} ${node.boundary.in_scope ? "" : "out-of-scope"}`}
      transform={`translate(${x} ${y})`}
      onClick={onSelect}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
    >
      <title>{`${node.kind} · ${node.contract} · ${node.status}`}</title>
      <rect className="nav-node-box" width={BOX_W} height={BOX_H} />
      <rect className="nav-node-accent" width={3} height={BOX_H} />
      <text className="nav-node-kind" x={11} y={19}>{node.kind}</text>
      <rect className="nav-node-pill" x={BOX_W - pillWidth - 8} y={7} width={pillWidth} height={14} rx={1} />
      <text className="nav-node-pill-text" x={BOX_W - 8 - pillWidth / 2} y={17} textAnchor="middle">{label}</text>
      <text className="nav-node-contract" x={11} y={37}>{short(node.contract, 6, 4)}</text>
      <text className="nav-node-qty" x={11} y={54}>{quantity.length > 26 ? `${quantity.slice(0, 25)}…` : quantity}</text>
    </g>
  );
}
