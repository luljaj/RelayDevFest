#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎬 Rendering all Relay demo videos...${NC}\n"

# Create output directory
OUTPUT_DIR="remotion/output"
mkdir -p "$OUTPUT_DIR"

# Array of compositions to render
declare -a compositions=(
  "HeroVideo:01-hero"
  "LockCoordinationDemo:02-lock-coordination"
  "ConflictDetectionDemo:03-conflict-detection"
  "MCPIntegrationDemo:04-mcp-integration"
)

# Function to render a single composition
render_composition() {
  local comp_id=$1
  local filename=$2

  echo -e "${BLUE}📹 Rendering ${comp_id}...${NC}"

  npm run remotion:render "$comp_id" "$OUTPUT_DIR/${filename}.mp4"

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Successfully rendered ${filename}.mp4${NC}\n"
  else
    echo -e "${RED}❌ Failed to render ${comp_id}${NC}\n"
    return 1
  fi
}

# Render each composition
for comp in "${compositions[@]}"; do
  IFS=':' read -r comp_id filename <<< "$comp"
  render_composition "$comp_id" "$filename"
done

echo -e "${GREEN}🎉 All videos rendered successfully!${NC}"
echo -e "${BLUE}📁 Output directory: ${OUTPUT_DIR}${NC}"

# List rendered files
echo -e "\n${BLUE}📊 Rendered videos:${NC}"
ls -lh "$OUTPUT_DIR"/*.mp4 2>/dev/null || echo "No videos found"
