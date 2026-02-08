import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface LockCoordinationDemoProps {
  demoType: 'basic' | 'advanced';
}

export const LockCoordinationDemo: React.FC<LockCoordinationDemoProps> = ({
  demoType,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation timings
  const agentAAppears = spring({ frame: frame - 20, fps });
  const agentALocks = spring({ frame: frame - 80, fps });
  const agentBAppears = spring({ frame: frame - 140, fps });
  const agentBBlocked = spring({ frame: frame - 200, fps });
  const agentBSwitches = spring({ frame: frame - 260, fps });
  const agentACompletes = spring({ frame: frame - 320, fps });

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
          Lock Coordination in Action
        </h2>
        <p
          style={{
            fontSize: 24,
            color: '#94a3b8',
            margin: '10px 0 0 0',
          }}
        >
          How agents coordinate file access in real-time
        </p>
      </div>

      {/* Demo area */}
      <div
        style={{
          position: 'absolute',
          top: 200,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-around',
          padding: '0 80px',
        }}
      >
        {/* Agent A */}
        <AgentCard
          name="Agent A"
          color="#10b981"
          status={
            frame < 80
              ? 'idle'
              : frame < 320
              ? 'writing'
              : 'completed'
          }
          file="auth.ts"
          progress={agentAAppears}
          lockProgress={agentALocks}
        />

        {/* File visualization */}
        <FileVisualization
          locked={frame >= 80 && frame < 320}
          lockedBy="Agent A"
          lockProgress={agentALocks}
        />

        {/* Agent B */}
        <AgentCard
          name="Agent B"
          color="#f59e0b"
          status={
            frame < 140
              ? 'idle'
              : frame < 200
              ? 'checking'
              : frame < 260
              ? 'blocked'
              : 'switched'
          }
          file="auth.ts"
          progress={agentBAppears}
          blockProgress={agentBBlocked}
        />
      </div>

      {/* Timeline */}
      <Timeline frame={frame} />

      {/* Status messages */}
      <StatusMessages
        frame={frame}
        agentALocks={agentALocks}
        agentBBlocked={agentBBlocked}
        agentBSwitches={agentBSwitches}
        agentACompletes={agentACompletes}
      />
    </AbsoluteFill>
  );
};

const AgentCard: React.FC<{
  name: string;
  color: string;
  status: string;
  file: string;
  progress: number;
  lockProgress?: number;
  blockProgress?: number;
}> = ({ name, color, status, file, progress, lockProgress, blockProgress }) => {
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [30, 0]);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          background: 'rgba(30, 41, 59, 0.8)',
          border: `3px solid ${color}`,
          borderRadius: 20,
          padding: 40,
          width: 300,
          boxShadow: `0 8px 32px ${color}40`,
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: color,
            marginBottom: 20,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: 20,
            color: '#94a3b8',
            marginBottom: 10,
          }}
        >
          Target: <code style={{ color: '#e2e8f0' }}>{file}</code>
        </div>
        <div
          style={{
            fontSize: 24,
            color: '#fff',
            marginTop: 20,
            padding: '12px 20px',
            background:
              status === 'writing'
                ? 'rgba(16, 185, 129, 0.2)'
                : status === 'blocked'
                ? 'rgba(239, 68, 68, 0.2)'
                : status === 'switched'
                ? 'rgba(59, 130, 246, 0.2)'
                : 'rgba(148, 163, 184, 0.2)',
            borderRadius: 10,
            textAlign: 'center',
            fontWeight: 600,
          }}
        >
          {status.toUpperCase()}
        </div>
      </div>
    </div>
  );
};

const FileVisualization: React.FC<{
  locked: boolean;
  lockedBy: string;
  lockProgress: number;
}> = ({ locked, lockedBy, lockProgress }) => {
  const lockOpacity = interpolate(lockProgress, [0, 1], [0, 1]);
  const lockScale = interpolate(lockProgress, [0, 1], [0.5, 1]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div
        style={{
          width: 200,
          height: 250,
          background: locked
            ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
            : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          borderRadius: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          transition: 'all 0.5s ease',
          boxShadow: locked
            ? '0 8px 32px rgba(239, 68, 68, 0.4)'
            : '0 8px 32px rgba(16, 185, 129, 0.4)',
        }}
      >
        <div style={{ fontSize: 80 }}>{locked ? '🔒' : '📄'}</div>
        <div
          style={{
            fontSize: 24,
            color: '#fff',
            marginTop: 20,
            fontWeight: 600,
          }}
        >
          auth.ts
        </div>
      </div>
      {locked && (
        <div
          style={{
            fontSize: 18,
            color: '#ef4444',
            fontWeight: 600,
            opacity: lockOpacity,
            transform: `scale(${lockScale})`,
          }}
        >
          🔒 Locked by {lockedBy}
        </div>
      )}
    </div>
  );
};

const Timeline: React.FC<{ frame: number }> = ({ frame }) => {
  const progress = interpolate(frame, [0, 450], [0, 100]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 150,
        left: 80,
        right: 80,
      }}
    >
      <div
        style={{
          height: 4,
          background: 'rgba(148, 163, 184, 0.2)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #10b981 0%, #3b82f6 100%)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>
    </div>
  );
};

const StatusMessages: React.FC<{
  frame: number;
  agentALocks: number;
  agentBBlocked: number;
  agentBSwitches: number;
  agentACompletes: number;
}> = ({ frame, agentALocks, agentBBlocked, agentBSwitches, agentACompletes }) => {
  const messages = [
    {
      frame: 80,
      text: 'Agent A claims WRITING lock on auth.ts',
      progress: agentALocks,
    },
    {
      frame: 200,
      text: 'Agent B receives SWITCH_TASK command',
      progress: agentBBlocked,
    },
    {
      frame: 260,
      text: 'Agent B pivots to safe work automatically',
      progress: agentBSwitches,
    },
    {
      frame: 320,
      text: 'Agent A completes and releases lock',
      progress: agentACompletes,
    },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 60,
        left: 80,
        right: 80,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {messages.map((msg, idx) => {
        if (frame >= msg.frame) {
          const opacity = interpolate(msg.progress, [0, 1], [0, 1]);
          return (
            <div
              key={idx}
              style={{
                fontSize: 22,
                color: '#10b981',
                fontWeight: 600,
                opacity,
                textAlign: 'center',
              }}
            >
              ✓ {msg.text}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};
