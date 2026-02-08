# Remotion Videos for Relay

This directory contains Remotion video compositions for showcasing Relay's features.

## 📹 Available Videos

### 1. **HeroVideo** (10 seconds)
Introduction animation showcasing Relay's branding and key features.
- Animated title and subtitle
- Feature badges (Real-time Locking, Dependency-Aware, MCP Native)
- DevFest 2026 branding

### 2. **LockCoordinationDemo** (15 seconds)
Demonstrates the agent lock coordination mechanism.
- Agent A claims a WRITING lock on `auth.ts`
- Agent B tries to edit the same file
- Agent B receives SWITCH_TASK command
- Agent B pivots to safe work automatically
- Visual timeline and status updates

### 3. **ConflictDetectionDemo** (13 seconds)
Shows dependency-aware conflict detection.
- Live dependency graph visualization
- Direct and neighbor conflict detection
- Visual warning system
- Color-coded file states

### 4. **MCPIntegrationDemo** (12 seconds)
Showcases the MCP protocol integration.
- MCP tool calls (check_status, post_status)
- Architecture diagram
- JSON-RPC 2.0 request/response flow
- Available MCP tools overview

## 🚀 Quick Start

### Preview all videos in Remotion Studio
```bash
npm run remotion:studio
```

This will open the Remotion Studio at `http://localhost:3000` where you can:
- Preview all compositions
- Adjust timing and properties
- Export individual frames
- Scrub through the timeline

### Render a specific video
```bash
# Render the Hero video
npm run remotion:render HeroVideo remotion/output/hero.mp4

# Render the Lock Coordination Demo
npm run remotion:render LockCoordinationDemo remotion/output/lock-demo.mp4

# Render the Conflict Detection Demo
npm run remotion:render ConflictDetectionDemo remotion/output/conflict-demo.mp4

# Render the MCP Integration Demo
npm run remotion:render MCPIntegrationDemo remotion/output/mcp-demo.mp4
```

### Render all videos at once
```bash
# Create output directory
mkdir -p remotion/output

# Render all compositions
npm run remotion:render HeroVideo remotion/output/01-hero.mp4 && \
npm run remotion:render LockCoordinationDemo remotion/output/02-lock-coordination.mp4 && \
npm run remotion:render ConflictDetectionDemo remotion/output/03-conflict-detection.mp4 && \
npm run remotion:render MCPIntegrationDemo remotion/output/04-mcp-integration.mp4

echo "✅ All videos rendered successfully!"
```

## 📁 Directory Structure

```
remotion/
├── Root.tsx                    # Main composition registry
├── index.ts                    # Remotion entry point
├── webpack-override.ts         # Webpack configuration
├── compositions/               # Video compositions
│   ├── HeroVideo.tsx
│   ├── LockCoordinationDemo.tsx
│   ├── ConflictDetectionDemo.tsx
│   └── MCPIntegrationDemo.tsx
├── components/                 # Reusable video components
└── assets/                     # Static assets (images, fonts, etc.)
```

## 🎨 Customization

### Changing Video Properties

Edit the composition properties in `remotion/Root.tsx`:

```tsx
<Composition
  id="HeroVideo"
  component={HeroVideo}
  durationInFrames={300}  // 10 seconds at 30fps
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{
    titleText: 'Your Custom Title',
    subtitleText: 'Your Custom Subtitle',
  }}
/>
```

### Adjusting Timing

All animations use Remotion's `spring` and `interpolate` functions for smooth motion:

```tsx
const titleProgress = spring({
  frame: frame - 10,  // Start at frame 10
  fps,
  config: {
    damping: 100,
    stiffness: 200,
    mass: 0.5,
  },
});
```

### Color Scheme

The videos use Relay's color palette:
- Background: `#0f172a` → `#1e293b` (gradient)
- Primary: `#10b981` (green)
- Warning: `#f59e0b` (amber)
- Error: `#ef4444` (red)
- Accent: `#3b82f6` (blue)
- Text: `#e2e8f0` (light gray)
- Secondary text: `#94a3b8` (gray)

## 🎬 Export Settings

Default export settings (configured in `remotion.config.ts`):
- Codec: H.264
- Image format: JPEG
- Overwrite output: Yes

### Custom export settings

```bash
# Higher quality (slower)
npm run remotion:render HeroVideo output.mp4 --quality 100

# Different codec
npm run remotion:render HeroVideo output.webm --codec vp8

# Specific frame range
npm run remotion:render HeroVideo output.mp4 --frames=0-150

# Custom resolution
npm run remotion:render HeroVideo output.mp4 --width=1280 --height=720
```

## 📊 Video Specifications

| Composition | Duration | FPS | Resolution | File Size (est.) |
|-------------|----------|-----|------------|------------------|
| HeroVideo | 10s | 30 | 1920x1080 | ~8-12 MB |
| LockCoordinationDemo | 15s | 30 | 1920x1080 | ~12-18 MB |
| ConflictDetectionDemo | 13s | 30 | 1920x1080 | ~10-15 MB |
| MCPIntegrationDemo | 12s | 30 | 1920x1080 | ~9-14 MB |

## 🐛 Troubleshooting

### "Cannot find module 'remotion'"
```bash
npm install
```

### Port 3000 already in use (Remotion Studio conflicts with Next.js dev server)
```bash
# Stop Next.js dev server first
# Or use a different port for Remotion Studio
npx remotion studio --port=3001
```

### Videos render too slowly
```bash
# Use more CPU cores (adjust based on your machine)
npm run remotion:render HeroVideo output.mp4 --concurrency=4

# Lower quality for faster renders
npm run remotion:render HeroVideo output.mp4 --quality=70
```

## 📝 Adding New Videos

1. Create a new composition file in `remotion/compositions/`:
```tsx
// remotion/compositions/MyNewVideo.tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const MyNewVideo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: 'blue' }}>
      <h1>Frame: {frame}</h1>
    </AbsoluteFill>
  );
};
```

2. Register it in `remotion/Root.tsx`:
```tsx
import { MyNewVideo } from './compositions/MyNewVideo';

<Composition
  id="MyNewVideo"
  component={MyNewVideo}
  durationInFrames={150}
  fps={30}
  width={1920}
  height={1080}
/>
```

3. Preview and render:
```bash
npm run remotion:studio
npm run remotion:render MyNewVideo output.mp4
```

## 🔗 Resources

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Remotion Examples](https://www.remotion.dev/showcase)
- [Animation Techniques](https://www.remotion.dev/docs/animating)
- [Easing Functions](https://www.remotion.dev/docs/easing)

## 🎯 Use Cases for Videos

- **Demo videos** for README.md
- **Social media** promotion (Twitter, LinkedIn)
- **Presentation slides** for DevFest 2026
- **Documentation** tutorials
- **Landing page** hero sections
