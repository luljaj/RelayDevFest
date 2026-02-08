import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface ConflictDetectionDemoProps {
  showDependencyGraph: boolean;
}

export const ConflictDetectionDemo: React.FC<ConflictDetectionDemoProps> = ({
  showDependencyGraph,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation timings
  const graphAppears = spring({ frame: frame - 20, fps });
  const node1Appears = spring({ frame: frame - 40, fps });
  const node2Appears = spring({ frame: frame - 60, fps });
  const node3Appears = spring({ frame: frame - 80, fps });
  const edgesAppear = spring({ frame: frame - 100, fps });
  const conflictDetected = spring({ frame: frame - 180, fps });
  const warningShows = spring({ frame: frame - 220, fps });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Background grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.05) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Title */}
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 80,
        }}
      >
        <h2
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: '#fff',
            margin: 0,
          }}
        >
          Dependency-Aware Conflict Detection
        </h2>
        <p
          style={{
            fontSize: 24,
            color: '#94a3b8',
            margin: '10px 0 0 0',
          }}
        >
          Catching conflicts before they happen
        </p>
      </div>

      {/* Dependency Graph */}
      <div
        style={{
          position: 'absolute',
          top: 200,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          opacity: interpolate(graphAppears, [0, 1], [0, 1]),
        }}
      >
        <svg
          width="1200"
          height="600"
          style={{
            filter: 'drop-shadow(0 4px 20px rgba(0, 0, 0, 0.3))',
          }}
        >
          {/* Edges (dependencies) */}
          <g opacity={interpolate(edgesAppear, [0, 1], [0, 1])}>
            {/* auth.ts -> types.ts */}
            <line
              x1="300"
              y1="150"
              x2="600"
              y2="150"
              stroke={frame >= 180 ? '#ef4444' : '#64748b'}
              strokeWidth="3"
              strokeDasharray="10,5"
            />
            {/* auth.ts -> utils.ts */}
            <line
              x1="300"
              y1="150"
              x2="600"
              y2="300"
              stroke="#64748b"
              strokeWidth="3"
              strokeDasharray="10,5"
            />
            {/* utils.ts -> types.ts */}
            <line
              x1="600"
              y1="300"
              x2="600"
              y2="150"
              stroke="#64748b"
              strokeWidth="3"
              strokeDasharray="10,5"
            />
          </g>

          {/* Nodes (files) */}
          <g>
            {/* auth.ts - Agent A is editing */}
            <FileNode
              x={150}
              y={150}
              label="auth.ts"
              status="editing"
              agent="Agent A"
              progress={node1Appears}
              color="#10b981"
            />

            {/* types.ts - Agent B wants to edit (conflict!) */}
            <FileNode
              x={600}
              y={150}
              label="types.ts"
              status={frame >= 180 ? 'conflict' : 'idle'}
              agent="Agent B"
              progress={node2Appears}
              color={frame >= 180 ? '#ef4444' : '#3b82f6'}
            />

            {/* utils.ts - Safe to edit */}
            <FileNode
              x={600}
              y={300}
              label="utils.ts"
              status="safe"
              agent=""
              progress={node3Appears}
              color="#64748b"
            />
          </g>

          {/* Conflict warning arrow */}
          {frame >= 180 && (
            <g opacity={interpolate(conflictDetected, [0, 1], [0, 1])}>
              <path
                d="M 450 150 Q 475 120, 500 150"
                fill="none"
                stroke="#ef4444"
                strokeWidth="4"
                markerEnd="url(#arrowhead)"
              />
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3, 0 6" fill="#ef4444" />
                </marker>
              </defs>
            </g>
          )}
        </svg>
      </div>

      {/* Warning message */}
      {frame >= 220 && (
        <div
          style={{
            position: 'absolute',
            bottom: 150,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: interpolate(warningShows, [0, 1], [0, 1]),
          }}
        >
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '3px solid #ef4444',
              borderRadius: 20,
              padding: '30px 50px',
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              boxShadow: '0 8px 32px rgba(239, 68, 68, 0.4)',
            }}
          >
            <div style={{ fontSize: 48 }}>⚠️</div>
            <div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                Neighbor Conflict Detected
              </div>
              <div
                style={{
                  fontSize: 20,
                  color: '#fca5a5',
                  marginTop: 8,
                }}
              >
                Agent B: types.ts is a dependency of auth.ts (being edited by
                Agent A)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 80,
          display: 'flex',
          gap: 40,
          fontSize: 18,
          color: '#94a3b8',
        }}
      >
        <LegendItem color="#10b981" label="Currently Editing" />
        <LegendItem color="#ef4444" label="Conflict Detected" />
        <LegendItem color="#64748b" label="Safe to Edit" />
      </div>
    </AbsoluteFill>
  );
};

const FileNode: React.FC<{
  x: number;
  y: number;
  label: string;
  status: string;
  agent: string;
  progress: number;
  color: string;
}> = ({ x, y, label, status, agent, progress, color }) => {
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [0.8, 1]);

  return (
    <g
      transform={`translate(${x}, ${y}) scale(${scale})`}
      opacity={opacity}
    >
      {/* Node background */}
      <rect
        x="-75"
        y="-50"
        width="150"
        height="100"
        rx="15"
        fill="rgba(30, 41, 59, 0.9)"
        stroke={color}
        strokeWidth="3"
      />

      {/* File icon */}
      <text
        x="0"
        y="-10"
        textAnchor="middle"
        fontSize="32"
      >
        📄
      </text>

      {/* File name */}
      <text
        x="0"
        y="25"
        textAnchor="middle"
        fill="#fff"
        fontSize="18"
        fontWeight="600"
      >
        {label}
      </text>

      {/* Agent badge */}
      {agent && (
        <text
          x="0"
          y="45"
          textAnchor="middle"
          fill={color}
          fontSize="14"
          fontWeight="600"
        >
          {agent}
        </text>
      )}

      {/* Status indicator */}
      {status === 'editing' && (
        <circle
          cx="60"
          cy="-35"
          r="8"
          fill="#10b981"
        />
      )}
      {status === 'conflict' && (
        <circle
          cx="60"
          cy="-35"
          r="8"
          fill="#ef4444"
        />
      )}
    </g>
  );
};

const LegendItem: React.FC<{ color: string; label: string }> = ({
  color,
  label,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span>{label}</span>
    </div>
  );
};
