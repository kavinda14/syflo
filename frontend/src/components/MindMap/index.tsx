import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getStraightPath,
  useInternalNode,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CornerDownRight, MessageSquare, Home } from 'lucide-react';
import type { Chat } from '../../types';

// Returns the half-width/half-height of a node. Falls back to the
// dimensions configured on the node object when the ResizeObserver
// hasn't measured the DOM yet — without this fallback, custom-typed
// nodes render their first frame with measured.width === undefined,
// which collapses every floating edge to a zero-length path
// (invisible line).
function nodeHalfSize(n: InternalNode) {
  const w = (n.measured?.width ?? n.width ?? 200) / 2;
  const h = (n.measured?.height ?? n.height ?? 80) / 2;
  return { w, h };
}

// Where a line from outerNode's center to innerNode's center crosses
// innerNode's rectangular border. Lets edges terminate at the bubble edge
// instead of the center, so arrowheads stay visible outside the node.
function getNodeIntersection(innerNode: InternalNode, outerNode: InternalNode) {
  const ip = innerNode.internals.positionAbsolute;
  const op = outerNode.internals.positionAbsolute;
  const { w, h } = nodeHalfSize(innerNode);
  const { w: ow, h: oh } = nodeHalfSize(outerNode);

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
  // Kompakt vs. voll: Labels sind oft ganze markierte Sätze. Zusammengeklappt
  // (eine Zeile, Ellipse) kollidieren sie nicht; beim Hover klappt das Label
  // mehrzeilig auf — gleiche Geste wie die Knoten-Vorschau.
  const [hovered, setHovered] = useState(false);

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
            data-testid="mindmap-edge-label"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              pointerEvents: 'all',
              // Branch words can be whole selected sentences from a PDF.
              // Without a cap the label renders as one enormous unwrapped
              // line that collides with every node it crosses. Collapsed:
              // one clipped line. Hovered: the full text, wrapped, floating
              // above nodes and other labels.
              ...(hovered
                ? {
                    maxWidth: 280,
                    whiteSpace: 'normal',
                    overflowWrap: 'break-word',
                    zIndex: 1000,
                    boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                  }
                : {
                    maxWidth: 180,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }),
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

// Inhalt eines Mindmap-Knotens. Zeigt den Verzweigungsanlass, den Titel
// und einen Auszug aus der ersten Nutzer-Frage — beim Hover wird der
// Auszug nicht mehr gekürzt, damit man den vollen Text sehen kann.
interface ChatNodeData {
  title: string;
  parentWord?: string | null;
  preview?: string | null;
  messageCount?: number;
  color: string;
  isRoot: boolean;
}

function ChatNodeView({ data }: NodeProps) {
  const { title, parentWord, preview, messageCount, color, isRoot } = data as unknown as ChatNodeData;
  const [hovered, setHovered] = useState(false);

  // Inline-Style statt Tailwind-Klasse für das line-clamp — vermeidet
  // mögliche Cascade-Layer-Konflikte mit Tailwind v4.
  const previewStyle: React.CSSProperties = hovered
    ? { display: 'block' }
    : {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
      };

  // Unsichtbare Handles als Anker für Floating Edges — React Flow braucht
  // mindestens je einen Source- und Target-Handle, sonst sind die Edges
  // null-gehandled und werden gar nicht erst gerendert (Fehler #008).
  const handleStyle: React.CSSProperties = {
    opacity: 0,
    width: 1,
    height: 1,
    border: 'none',
    background: 'transparent',
    pointerEvents: 'none',
  };

  // Wurzelknoten bleibt stilistisch in der gleichen Designsprache (flache Farbe,
  // gleiche Schatten-Art). Prominenz kommt durch Größe, Schatten-Intensität und
  // ein Badge — nicht durch Gradient/Ring/Glow.
  const baseShadow = isRoot
    ? '0 14px 36px rgba(0,0,0,0.35)'
    : '0 4px 12px rgba(0,0,0,0.15)';
  const hoverShadow = isRoot
    ? '0 20px 48px rgba(0,0,0,0.4)'
    : '0 12px 30px rgba(0,0,0,0.25)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative transition-all duration-150"
      style={{
        background: color,
        color: 'white',
        width: isRoot ? 360 : 220,
        padding: isRoot ? '22px 26px' : '12px 14px',
        borderRadius: 16,
        boxShadow: hovered ? hoverShadow : baseShadow,
        transform: hovered ? 'scale(1.03)' : 'scale(1)',
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />

      {/* Root-Badge: macht sofort klar, dass dies der Wurzelknoten ist.
          Gleiche Optik wie das Verzweigungs-Badge bei Kindern (Icon + Versalien),
          nur etwas prominenter (font-semibold + bisschen mehr opacity). */}
      {isRoot && (
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider opacity-90 font-semibold mb-2">
          <Home size={12} />
          <span>Main Topic</span>
        </div>
      )}

      {/* Verzweigungs-Badge: das Wort, durch das dieser Chat entstanden ist */}
      {parentWord && (
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80 mb-1">
          <CornerDownRight size={10} />
          <span className="truncate">{parentWord}</span>
        </div>
      )}

      {/* Titel */}
      <div
        className="font-semibold leading-tight break-words"
        style={{ fontSize: isRoot ? 22 : 13 }}
      >
        {title}
      </div>

      {/* Auszug aus der ersten Nutzer-Frage — beim Hover wird das Clamp aufgehoben */}
      {preview && (
        <div
          className="mt-1.5 text-[11px] italic leading-snug opacity-90 break-words"
          style={previewStyle}
        >
          „{preview}"
        </div>
      )}

      {/* Footer: Anzahl Nachrichten */}
      {typeof messageCount === 'number' && messageCount > 0 && (
        <div className="mt-2 flex items-center gap-1 text-[10px] opacity-70">
          <MessageSquare size={10} />
          <span>{messageCount}</span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { chat: ChatNodeView };

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
// Radius zwischen Tiefenebenen. Vergrößert gegenüber dem ursprünglichen Wert,
// damit die jetzt größeren, mehrzeiligen Knoten nicht überlappen.
const RADIUS_STEP = 360;
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
    // Maße direkt am Node-Objekt setzen, damit React Flow sie ab dem ersten
    // Render kennt. Sonst rechnet FloatingEdge mit width/height = 0 und der
    // Edge-Pfad kollabiert zu Länge 0 → unsichtbare Linie.
    const width = isRoot ? 360 : 220;
    const estimatedHeight = (isRoot ? 22 : 0) + (chat.parent_word ? 18 : 0) + (isRoot ? 32 : 22) + (chat.preview ? 36 : 0) + ((chat.message_count ?? 0) > 0 ? 18 : 0) + (isRoot ? 44 : 24);
    nodes.push({
      id: chat.id,
      type: 'chat',
      position: posMap[chat.id] || { x: 0, y: 0 },
      width,
      height: estimatedHeight,
      data: {
        title: chat.title,
        parentWord: chat.parent_word,
        preview: chat.preview,
        messageCount: chat.message_count,
        color,
        isRoot,
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

// Manuell verschobene Knoten-Positionen, pro Baum in localStorage — damit
// eine per Drag zurechtgelegte Map Chat-Wechsel, View-Toggles und Reloads
// überlebt (das Layout-Rebuild setzte sonst jede Verschiebung zurück).
function positionsKey(rootId: string) {
  return `syflo.mindmap-pos.${rootId}`;
}

function loadSavedPositions(rootId: string | undefined): Record<string, { x: number; y: number }> {
  if (!rootId) return {};
  try {
    return JSON.parse(localStorage.getItem(positionsKey(rootId)) || '{}');
  } catch {
    return {};
  }
}

export function MindMap({ chats, activeChatId, onSelect }: Props) {
  // Only show the tree of the currently active chat's root.
  const activeTree = useMemo(() => {
    const root = findRoot(chats, activeChatId);
    return root ? [root] : chats.slice(0, 1); // fallback: first root
  }, [chats, activeChatId]);
  const rootId = activeTree[0]?.id;

  // Radiales Layout, überlagert mit den gespeicherten manuellen Positionen.
  const applySaved = (n: Node[]): Node[] => {
    const saved = loadSavedPositions(rootId);
    return n.map(node => (saved[node.id] ? { ...node, position: saved[node.id] } : node));
  };

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => buildLayout(activeTree), [activeTree]);
  const [nodes, setNodes, onNodesChange] = useNodesState(applySaved(initialNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildLayout(activeTree);
    setNodes(applySaved(n));
    setEdges(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTree]);

  // Nach jedem Drag die neue Position merken.
  const handleNodeDragStop = (_: unknown, node: Node) => {
    if (!rootId) return;
    const saved = loadSavedPositions(rootId);
    saved[node.id] = { x: node.position.x, y: node.position.y };
    try {
      localStorage.setItem(positionsKey(rootId), JSON.stringify(saved));
    } catch {
      // localStorage voll/gesperrt — Verschieben funktioniert trotzdem,
      // nur eben nicht über Reloads hinweg.
    }
  };

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
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
      >
        <Background color="#e0e7ff" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
