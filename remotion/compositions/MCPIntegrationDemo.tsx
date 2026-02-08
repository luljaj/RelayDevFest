import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface MCPIntegrationDemoProps {
  showCode: boolean;
}

export const MCPIntegrationDemo: React.FC<MCPIntegrationDemoProps> = ({
  showCode,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation timings
  const titleAppears = spring({ frame: frame - 10, fps });
  const codeBlockAppears = spring({ frame: frame - 40, fps });
  const step1Appears = spring({ frame: frame - 80, fps });
  const step2Appears = spring({ frame: frame - 140, fps });
  const step3Appears = spring({ frame: frame - 200, fps });
  const responseAppears = spring({ frame: frame - 260, fps });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        fontFamily: 'JetBrains Mono, Consolas, monospace',
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
          opacity: interpolate(titleAppears, [0, 1], [0, 1]),
        }}
      >
        <h2
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: '#fff',
            margin: 0,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Native MCP Integration
        </h2>
        <p
          style={{
            fontSize: 24,
            color: '#94a3b8',
            margin: '10px 0 0 0',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Seamless coordination through Model Context Protocol
        </p>
      </div>

      {/* Main content area */}
      <div
        style={{
          position: 'absolute',
          top: 180,
          left: 80,
          right: 80,
          display: 'flex',
          gap: 40,
        }}
      >
        {/* Left: Request flow */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 30,
          }}
        >
          {/* Step 1: Check Status */}
          <CodeBlock
            title="1. Check Status"
            code={`curl http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "check_status",
      "arguments": {
        "file_paths": ["auth.ts"]
      }
    }
  }'`}
            progress={step1Appears}
            color="#3b82f6"
          />

          {/* Step 2: Get Orchestration Command */}
          <CodeBlock
            title="2. Response: PROCEED"
            code={`{
  "action": "PROCEED",
  "message": "Clear to edit",
  "locks": []
}`}
            progress={step2Appears}
            color="#10b981"
          />

          {/* Step 3: Claim Lock */}
          <CodeBlock
            title="3. Claim Lock"
            code={`curl http://localhost:3000/mcp \\
  -d '{
    "method": "tools/call",
    "params": {
      "name": "post_status",
      "arguments": {
        "file_paths": ["auth.ts"],
        "status": "WRITING"
      }
    }
  }'`}
            progress={step3Appears}
            color="#f59e0b"
          />
        </div>

        {/* Right: MCP Architecture diagram */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: interpolate(responseAppears, [0, 1], [0, 1]),
          }}
        >
          <MCPArchitectureDiagram />
        </div>
      </div>

      {/* Footer with MCP tools */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 80,
          right: 80,
          display: 'flex',
          justifyContent: 'space-around',
          opacity: interpolate(responseAppears, [0, 1], [0, 1]),
        }}
      >
        <ToolCard
          icon="🔍"
          name="check_status"
          description="Query file lock status"
        />
        <ToolCard
          icon="📤"
          name="post_status"
          description="Claim or release locks"
        />
        <ToolCard
          icon="📊"
          name="get_graph"
          description="Fetch dependency graph"
        />
      </div>
    </AbsoluteFill>
  );
};

const CodeBlock: React.FC<{
  title: string;
  code: string;
  progress: number;
  color: string;
}> = ({ title, code, progress, color }) => {
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [20, 0]);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          background: 'rgba(30, 41, 59, 0.9)',
          border: `2px solid ${color}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            background: color,
            padding: '12px 20px',
            fontSize: 18,
            fontWeight: 600,
            color: '#fff',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          {title}
        </div>

        {/* Code content */}
        <pre
          style={{
            margin: 0,
            padding: 20,
            fontSize: 14,
            color: '#e2e8f0',
            lineHeight: 1.6,
            overflow: 'hidden',
          }}
        >
          {code}
        </pre>
      </div>
    </div>
  );
};

const MCPArchitectureDiagram: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 30,
      }}
    >
      {/* Agent layer */}
      <div
        style={{
          background: 'rgba(59, 130, 246, 0.2)',
          border: '3px solid #3b82f6',
          borderRadius: 15,
          padding: '20px 40px',
          fontSize: 24,
          fontWeight: 600,
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        🤖 AI Agent (Claude, Cline, etc.)
      </div>

      {/* Arrow down */}
      <div
        style={{
          fontSize: 32,
          color: '#64748b',
        }}
      >
        ↓
      </div>

      {/* MCP Protocol */}
      <div
        style={{
          background: 'rgba(16, 185, 129, 0.2)',
          border: '3px solid #10b981',
          borderRadius: 15,
          padding: '20px 40px',
          fontSize: 24,
          fontWeight: 600,
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        ⚡ MCP Protocol (JSON-RPC 2.0)
      </div>

      {/* Arrow down */}
      <div
        style={{
          fontSize: 32,
          color: '#64748b',
        }}
      >
        ↓
      </div>

      {/* Relay Coordination */}
      <div
        style={{
          background: 'rgba(245, 158, 11, 0.2)',
          border: '3px solid #f59e0b',
          borderRadius: 15,
          padding: '20px 40px',
          fontSize: 24,
          fontWeight: 600,
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        🔗 Relay Coordination Layer
      </div>

      {/* Arrow down */}
      <div
        style={{
          fontSize: 32,
          color: '#64748b',
        }}
      >
        ↓
      </div>

      {/* Redis/KV */}
      <div
        style={{
          background: 'rgba(239, 68, 68, 0.2)',
          border: '3px solid #ef4444',
          borderRadius: 15,
          padding: '20px 40px',
          fontSize: 24,
          fontWeight: 600,
          color: '#fff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        💾 Vercel KV (Redis)
      </div>
    </div>
  );
};

const ToolCard: React.FC<{
  icon: string;
  name: string;
  description: string;
}> = ({ icon, name, description }) => {
  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.8)',
        border: '2px solid rgba(148, 163, 184, 0.3)',
        borderRadius: 12,
        padding: 20,
        width: 250,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 32 }}>{icon}</div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: '#3b82f6',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: 14,
          color: '#94a3b8',
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {description}
      </div>
    </div>
  );
};
