import { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  useInternalNode,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Chat } from '../../types';

// Where a line from outerNode's center to innerNode's center crosses
// innerNode's rectangular border. Lets edges terminate at the bubble edge
// instead of the center, so arrowheads stay visible outside the node.
function getNodeIntersection(innerNode: InternalNode, outerNode: InternalNode) {
  const ip = innerNode.internals.positionAbsolute;
  const op = outerNode.internals.positionAbsolute;
  const w = (innerNode.measured.width ?? 0) / 2;
  const h = (innerNode.measured.height ?? 0) / 2;
  const ow = (outerNode.measured.width ?? 0) / 2;
  const oh = (outerNode.measured.height ?? 0) / 2;

  const x2 = ip.x + w;
  const y2 = ip.y + h;
  const x1 = op.x + ow;
  const y1 = op.y + oh;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  return {
    x: w * (xx3 + yy3) + x2,
    y: h * (-xx3 + yy3) + y2,
  };
}

function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sp = getNodeIntersection(sourceNode, targetNode);
  const tp = getNodeIntersection(targetNode, sourceNode);

  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX: sp.x,
    sourceY: sp.y,
    targetX: tp.x,
    targetY: tp.y,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label != null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              pointerEvents: 'all',
              ...(labelStyle as React.CSSProperties),
            }}
          >
            {label as React.ReactNode}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { floating: FloatingEdge };

interface Props {
  chats: Chat[];
  activeChatId?: string | null;
  onSelect: (id: string) => void;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

// Radial layout: root sits at the origin, children radiate outward. Each
// non-root parent fans its children in an arc centered on its own outward
// direction, so a subtree always extends *away* from the center — never back
// toward it and never collapsed onto a single ray.
const RADIUS_STEP = 260;
// Maximum angular spread for a non-root parent's children. Prevents single-
// child chains from collapsing onto one straight line: even with one child,
// a small offset is applied so descendants curve outward instead of stacking.
const MAX_FAN = (Math.PI * 2) / 3; // 120°

export function buildLayout(chats: Chat[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const posMap: Record<string, { x: number; y: number }> = {};

  const roots = chats.filter(c => !c.parent_id);

  // myAngle: the polar angle from the origin to this node.
  // mySlice: the angular range this node's subtree is allowed to occupy.
  const placeSubtree = (chat: Chat, depth: number, myAngle: number, mySlice: number) => {
    if (depth === 0) {
      posMap[chat.id] = { x: 0, y: 0 };
    } else {
      const radius = depth * RADIUS_STEP;
      posMap[chat.id] = {
        x: Math.cos(myAngle) * radius,
        y: Math.sin(myAngle) * radius,
      };
    }

    const children = chat.children || [];
    if (children.length === 0) return;

    let fanWidth: number;
    let fanCenter: number;

    if (depth === 0) {
      // Root: distribute children around the full circle.
      fanWidth = Math.PI * 2;
      // Start from the top (-π/2 in screen coords) so the first child sits
      // above the root rather than to its left.
      fanCenter = -Math.PI / 2 + Math.PI;
    } else {
      // Non-root: fan children in an arc on the *outward* side of this node,
      // centered on its own outward direction. Cap the arc so children stay
      // close to the parent's direction even when the inherited slice is huge.
      fanWidth = Math.min(mySlice, MAX_FAN);
      fanCenter = myAngle;
    }

    // For a single child, place it slightly offset from the parent's outward
    // direction (perpendicular nudge) so chains of singletons curve instead
    // of collapsing into one straight ray.
    if (children.length === 1 && depth > 0) {
      const offset = MAX_FAN / 6; // ~20°
      const childAngle = fanCenter + (depth % 2 === 0 ? offset : -offset);
      placeSubtree(children[0], depth + 1, childAngle, fanWidth);
      return;
    }

    const start = fanCenter - fanWidth / 2;
    const childSlice = fanWidth / children.length;
    children.forEach((child, i) => {
      const childAngle = start + childSlice * (i + 0.5);
      placeSubtree(child, depth + 1, childAngle, childSlice);
    });
  };

  roots.forEach(root => placeSubtree(root, 0, 0, Math.PI * 2));

  // Build nodes & edges
  const addNodes = (chat: Chat, depth: number) => {
    const color = COLORS[depth % COLORS.length];
    const isRoot = depth === 0;
    nodes.push({
      id: chat.id,
      position: posMap[chat.id] || { x: 0, y: 0 },
      data: { label: chat.title, word: chat.parent_word },
      style: {
        background: color,
        color: 'white',
        border: 'none',
        borderRadius: isRoot ? '20px' : '12px',
        padding: isRoot ? '22px 32px' : '14px 20px',
        fontSize: isRoot ? '16px' : '13px',
        fontWeight: isRoot ? '700' : '500',
        minWidth: isRoot ? '180px' : '140px',
        maxWidth: isRoot ? '240px' : '200px',
        textAlign: 'center',
        boxShadow: isRoot
          ? '0 8px 24px rgba(0,0,0,0.18)'
          : '0 4px 12px rgba(0,0,0,0.15)',
      },
    });

    if (chat.parent_id) {
      edges.push({
        id: `${chat.parent_id}-${chat.id}`,
        source: chat.parent_id,
        target: chat.id,
        label: chat.parent_word || '',
        style: { stroke: color, strokeWidth: 2 },
        labelStyle: { fontSize: '11px', fill: color, fontWeight: '500' },
        type: 'floating',
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
      });
    }

    (chat.children || []).forEach(child => addNodes(child, depth + 1));
  };

  roots.forEach(root => addNodes(root, 0));
  return { nodes, edges };
}

// Find the root chat that contains the given chatId (or is the chatId itself).
function findRoot(chats: Chat[], chatId: string | null | undefined): Chat | null {
  if (!chatId) return null;
  for (const root of chats) {
    if (root.id === chatId) return root;
    const inChildren = (root.children || []).some(c => c.id === chatId);
    if (inChildren) return root;
  }
  return null;
}

export function MindMap({ chats, activeChatId, onSelect }: Props) {
  // Only show the tree of the currently active chat's root.
  const activeTree = useMemo(() => {
    const root = findRoot(chats, activeChatId);
    return root ? [root] : chats.slice(0, 1); // fallback: first root
  }, [chats, activeChatId]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => buildLayout(activeTree), [activeTree]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildLayout(activeTree);
    setNodes(n);
    setEdges(e);
  }, [activeTree]);

  if (chats.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
        No chats yet
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
      >
        <Background color="#e0e7ff" gap={20} />
        <Controls />
        <MiniMap nodeColor={(n) => (n.style?.background as string) || '#3b82f6'} />
      </ReactFlow>
    </div>
  );
}
