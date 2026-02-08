# UI Execution Plan: Relay Coordination Graph

**Objective**: transform the concept into a concrete, executable engineering plan. This document details the implementation of the "Mission Control" interface using **React**, **React Flow**, and **Radix UI**, powered by the existing Redis backend.

## 1. System Architecture & Data Flow

### Data Fetching Strategy (Mirroring `app/page.tsx`)
We will maintain the existing **Polling Architecture** to ensure real-time synchronization with the Redis backend without introducing new WebSocket complexity.

*   **Source of Truth**: `GET /api/graph`
*   **Polling Interval**: 3000ms (3s) for perceived real-time responsiveness.
*   **State Management**: `swr` or `tanstack-query` is recommended for robust polling, caching, and deduping, but to keep dependencies minimal (per user preference), we can stick to a robust `useEffect` + `fetch` hook pattern as currently implemented.

**Derived State (Client-Side)**:
Since the API returns a snapshot (`nodes`, `edges`, `locks`), the client MUST derive the following transient states:
1.  **Activity Log**: Deduced by comparing `prevLocks` vs `currentLocks`.
    *   *New Lock* -> "User started working on [file]"
    *   *Release Lock* -> "User finished [file]"
    *   *Message Change* -> "User updated intent: [message]"
2.  **Connected Developers**: Aggregated from unique `user_id`s in `locks` + recent `activity` history.
3.  **"Just Updated" Highlight**: `nodes` that were locked in `T-1` but unlocked in `T` will get a temporary "flash" style.

## 2. Component Architecture

```
/app/page.tsx (Page Root)
├── <LayoutShell> (Grid Container)
│   │
│   ├── <GraphPanel> (Left/Center - 75%)
│   │   ├── <ControlDock> (Top-Center Floating)
│   │   ├── <ReactFlowCanvas>
│   │   │   ├── <FileNode> (Custom Node)
│   │   │   ├── <DependencyEdge> (Custom Edge)
│   │   │   ├── <Background>
│   │   │   └── <Controls>
│   │   │
│   │   ├── <LegendOverlay> (Bottom-Left)
│   │   └── <NodeDetailsDialog> (Radix Dialog - Triggered on Node Click)
│   │
│   └── <SidebarPanel> (Right - 25%)
│       ├── <DeveloperList> (Top - 20%)
│       └── <ActivityFeed> (Bottom - 80%)
```

## 3. detailed Implementation Specs

### A. The Graph (`<GraphPanel>` & React Flow)

**Configuration**:
*   `nodesDraggable`: `true`
*   `nodesConnectable`: `false` (Read-only graph)
*   `fitView`: `true` (Initially)

**Custom Node: `<FileNode />`**
We will creating a custom node type to handle the rich visualizations.
*   **Props**: `data: { label, lockStatus, developerColor, intentMessage, isUpdated }`
*   **Structure**:
    ```tsx
    <div className="relative rounded-xl border-2 transition-all duration-300"
         style={{
             borderColor: isLocked ? developerColor : '#94a3b8',
             borderStyle: isLocked ? 'solid' : 'dashed',
             borderWidth: isLocked ? 3 : 1,
             backgroundColor: isUpdated ? transparentize(developerColor, 0.8) : 'white'
         }}>
         
         {/* File Icon & Name */}
         <div className="flex items-center gap-2 p-3">
             <FileIcon className="text-slate-500" />
             <span className="font-mono text-sm font-bold">{fileName}</span>
         </div>

         {/* Intent Bubble (Absolute Positioned) */}
         {intentMessage && (
             <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                 className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black text-white px-3 py-1 rounded-full text-xs whitespace-nowrap shadow-xl">
                 {intentMessage}
                 <div className="arrow-down" />
             </motion.div>
         )}
    </div>
    ```

**Custom Edge: `<DependencyEdge />`**
*   **Logic**: Standard `Bezier` or `SmoothStep`.
*   **Animation**: If `data.isNew` is true, animate the stroke color from `developerColor` to Gray over 2 seconds.

### B. Node Details "Box" (`<NodeDetailsDialog />`)

**Interaction**: Clicking a node opens this modal/dialog.
**Component**: `Radix UI Dialog` (Primitive).

**Content**:
1.  **Header**: Full File Path (`app/components/Graph.tsx`).
2.  **Status Badge**: `AVAILABLE`, `WRITING` (with User), `READING`.
3.  **Metadata**: Size, Language, Last Modified (if available).
4.  **Dependencies List**:
    *   *Incoming* (Used by...)
    *   *Outgoing* (Uses...)
    *   *Visualization*: Simple list or mini-tree.
5.  **Actions**: "View on GitHub", "Copy Path".

**Styling**:
*   `Dialog.Overlay`: `fixed inset-0 bg-black/50 backdrop-blur-sm`
*   `Dialog.Content`: `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-md`

### C. Sidebar: "Mission Control"

**1. Connected Developers (`<DeveloperList />`)**
*   **Visual**: Grid of "User Cards".
*   **Card**:
    *   Avatar (GitHub image or Initials).
    *   Name (Truncated).
    *   **Agent Count Badge**: Number of active locks.
    *   *Border*: colored by their assigned developer color.

**2. Activity Feed (`<ActivityFeed />`)**
*   **Component**: `Radix UI ScrollArea`.
*   **Item Structure**:
    ```tsx
    <div className="flex gap-3 text-sm py-2 px-3 border-l-2" style={{ borderColor: userColor }}>
        <span className="text-xs text-slate-400">{timeAgo}</span>
        <p>
            <span className="font-bold" style={{ color: userColor }}>{user}</span>
            <span> {actionDescription} </span>
            <code className="bg-slate-100 px-1 rounded">{file}</code>
        </p>
    </div>
    ```
*   **Auto-Scroll**: A `useEffect` ref on the container to scroll to bottom when `activities` changes, *unless* user has scrolled up.

### D. Controls (`<ControlDock />`)

**Position**: `absolute top-4 left-1/2 -translate-x-1/2 z-50`.
**Style**: "Dynamic Island" aesthetic. Glassmorphism (`backdrop-filter: blur(10px)`), `bg-white/80`, `rounded-full`, `shadow-lg`, `border border-white/20`.
**Inputs**:
*   Repo URL (Mini text input, expands on focus).
*   Branch (Dropdown or text).
*   Status (Loading/Polling indicator pulse).

## 4. Execution Plan (Step-by-Step)

### Phase 1: Setup & Foundations
1.  **Install Dependencies**: `radix-ui` primitives (`@radix-ui/react-dialog`, `@radix-ui/react-scroll-area`, `@radix-ui/react-tooltip`, etc.), `framer-motion` (for smooth animations).
2.  **Scaffold Components**: Create empty files for `FileNode.tsx`, `DependencyEdge.tsx`, `Sidebar.tsx`, `NodeDetailDialog.tsx`.
3.  **Layout**: Replace `app/page.tsx` return with the new Grid Layout.

### Phase 2: Graph Core (The "Big Screen")
1.  **Migrate Graph Logic**: Copy state logic (`useGraph`, `fetchGraph`) from current `page.tsx` to a hook `hooks/useGraphData.ts`.
2.  **Implement `FileNode`**: Build the visual node component with "Intent Bubble" support.
3.  **React Flow Setup**: Wire up the `nodeTypes` and grid background.
4.  **Legend**: Add the static legend overlay.

### Phase 3: Sidebar & Data Derivation
1.  **Activity Logic**: Implement `captureActivity` (existing function) but ensure it feeds the `ActivityFeed` component.
2.  **Developer List**: Create helper to `getUniqueUsers(locks)`.
3.  **Activity Feed UI**: Build the scrollable panel using `mac-scrollbar` styling or Radix ScrollArea.

### Phase 4: Interaction & Details
1.  **Node Click Handler**: Connect `onNodeClick` -> `setSelectedNode`.
2.  **Dialog Implementation**: wire `selectedNode` state to the Radix Dialog `open` prop.
3.  **Content Population**: Filter `graph.edges` to show dependencies inside the dialog.

### Phase 5: Polish & Animations
1.  **Transitions**: Add `layout` prop from framer-motion to nodes if possible (careful with React Flow performance), or use CSS transitions for border colors.
2.  **New Edge Animation**: Logic to detect `newEdges` and pass `animated: true` or custom style.
3.  **Glassmorphism**: Apply `backdrop-blur` to Controls and Sidebar.

## 5. Technical Constraints & Edge Cases

*   **Performance**: With 500+ nodes, React Flow can get heavy.
    *   *Mitigation*: Use `memo` for `FileNode`. Only animate visible changes.
*   **Colors**: We need a consistent hashing function: `string -> RadixColor`.
    *   *Algo*: `djb2` hash % palette size.
*   **Responsive**: On smaller screens, collapse Sidebar to a drawer/sheet.
