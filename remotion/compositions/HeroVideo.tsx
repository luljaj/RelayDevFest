import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

interface HeroVideoProps {
  titleText: string;
  subtitleText: string;
}

export const HeroVideo: React.FC<HeroVideoProps> = ({
  titleText,
  subtitleText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title animation
  const titleProgress = spring({
    frame: frame - 10,
    fps,
    config: {
      damping: 100,
      stiffness: 200,
      mass: 0.5,
    },
  });

  // Subtitle animation
  const subtitleProgress = spring({
    frame: frame - 30,
    fps,
    config: {
      damping: 100,
    },
  });

  // Badge animations
  const badge1Progress = spring({
    frame: frame - 60,
    fps,
  });

  const badge2Progress = spring({
    frame: frame - 75,
    fps,
  });

  const badge3Progress = spring({
    frame: frame - 90,
    fps,
  });

  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);
  const titleTranslateY = interpolate(titleProgress, [0, 1], [50, 0]);

  const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 1]);
  const subtitleTranslateY = interpolate(subtitleProgress, [0, 1], [30, 0]);

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        fontFamily: 'Inter, system-ui, sans-serif',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Animated background grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(148, 163, 184, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          opacity: interpolate(frame, [0, 30], [0, 0.3]),
        }}
      />

      {/* Main content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 40,
          zIndex: 1,
        }}
      >
        {/* Title */}
        <h1
          style={{
            fontSize: 140,
            fontWeight: 900,
            color: '#fff',
            margin: 0,
            opacity: titleOpacity,
            transform: `translateY(${titleTranslateY}px)`,
            letterSpacing: '-0.02em',
            textShadow: '0 4px 30px rgba(0, 0, 0, 0.3)',
          }}
        >
          {titleText}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 36,
            color: '#94a3b8',
            margin: 0,
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleTranslateY}px)`,
            textAlign: 'center',
            maxWidth: '900px',
            lineHeight: 1.5,
          }}
        >
          {subtitleText}
        </p>

        {/* Feature badges */}
        <div
          style={{
            display: 'flex',
            gap: 30,
            marginTop: 40,
          }}
        >
          <Badge
            text="Real-time Locking"
            icon="🔒"
            progress={badge1Progress}
          />
          <Badge
            text="Dependency-Aware"
            icon="🔗"
            progress={badge2Progress}
          />
          <Badge
            text="MCP Native"
            icon="⚡"
            progress={badge3Progress}
          />
        </div>
      </div>

      {/* DevFest branding */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          fontSize: 24,
          color: '#64748b',
          opacity: interpolate(frame, [200, 230], [0, 1]),
        }}
      >
        Built for DevFest 2026 — Dedalus Labs Track
      </div>
    </AbsoluteFill>
  );
};

const Badge: React.FC<{ text: string; icon: string; progress: number }> = ({
  text,
  icon,
  progress,
}) => {
  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const scale = interpolate(progress, [0, 1], [0.8, 1]);

  return (
    <div
      style={{
        background: 'rgba(148, 163, 184, 0.1)',
        border: '2px solid rgba(148, 163, 184, 0.2)',
        borderRadius: 50,
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <span style={{ fontSize: 28 }}>{icon}</span>
      <span style={{ fontSize: 22, color: '#e2e8f0', fontWeight: 600 }}>
        {text}
      </span>
    </div>
  );
};
