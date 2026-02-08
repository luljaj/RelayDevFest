# Remotion Quick Reference

## 🚀 Most Common Commands

```bash
# Preview all videos (interactive)
npm run remotion:studio

# Render a single video
npm run remotion:render <CompositionId> output.mp4

# Render all videos
./scripts/render-all-videos.sh
```

## 🎬 Available Compositions

| ID | Description | Duration |
|----|-------------|----------|
| `HeroVideo` | Intro animation | 10s |
| `LockCoordinationDemo` | Lock mechanism demo | 15s |
| `ConflictDetectionDemo` | Dependency graph demo | 13s |
| `MCPIntegrationDemo` | MCP protocol demo | 12s |

## 📝 Render Examples

```bash
# Basic render
npm run remotion:render HeroVideo hero.mp4

# High quality
npm run remotion:render HeroVideo hero.mp4 --quality=100

# Lower resolution (faster)
npm run remotion:render HeroVideo hero.mp4 --width=1280 --height=720

# Different format
npm run remotion:render HeroVideo hero.webm --codec=vp8

# Specific frames only
npm run remotion:render HeroVideo hero.mp4 --frames=0-150

# Use more CPU cores
npm run remotion:render HeroVideo hero.mp4 --concurrency=8
```

## 🎨 Customization Locations

| What to Change | File | Line |
|----------------|------|------|
| Video title/subtitle | `remotion/Root.tsx` | defaultProps |
| Animation timing | `remotion/compositions/*.tsx` | spring({ frame: ... }) |
| Colors | `remotion/compositions/*.tsx` | style={{ color: ... }} |
| Duration | `remotion/Root.tsx` | durationInFrames |
| Resolution | `remotion/Root.tsx` | width/height |

## 🐛 Common Issues

| Problem | Solution |
|---------|----------|
| Port 3000 in use | Stop Next.js dev OR use `--port=3001` |
| Slow renders | Use `--concurrency` and `--quality` flags |
| Module not found | Run `npm install` |
| TypeScript errors | Run `npm run typecheck` |

## 📊 File Sizes (Approximate)

- **Low quality (--quality=50)**: ~5-10 MB per video
- **Medium quality (--quality=70)**: ~8-15 MB per video
- **High quality (--quality=90)**: ~12-20 MB per video
- **Max quality (--quality=100)**: ~15-25 MB per video

## 🎯 Render Times (Approximate, MacBook Pro M1)

| Quality | Concurrency | Time per Video |
|---------|-------------|----------------|
| Low (50) | 4 cores | ~30-60s |
| Medium (70) | 4 cores | ~60-90s |
| High (90) | 4 cores | ~90-120s |
| Max (100) | 8 cores | ~2-3 min |

## 🔗 Quick Links

- **Detailed docs**: `remotion/README.md`
- **Setup guide**: `REMOTION_SETUP.md`
- **Compositions**: `remotion/compositions/`
- **Remotion docs**: https://remotion.dev/docs
