# IFC Viewer Component

This folder contains a standalone React component extracted from the project.
It is intended to be pushed to GitHub and reused in other apps.

## Usage (local)

```ts
import { IfcViewer } from 'ifc-viewer-component'
```

```tsx
<IfcViewer
  defaultModelUrl="/test.ifc"
  showTree
  showProperties
  showShortcuts
  metadata={metadata}
  furniture={furniture}
  history={history}
  onMetadataChange={setMetadata}
  onFurnitureChange={setFurniture}
  onHistoryChange={setHistory}
/>
```

## Notes

- Styles are imported inside `IfcViewer.tsx` via `./IfcViewer.css`.
- The component relies on `three`, `web-ifc`, and `web-ifc-viewer` being installed in the host app.
- The host app is responsible for loading/saving project data (metadata/furniture/history).

## Publishing

1. Create a new GitHub repo (empty).
2. Copy this folder into the repo root.
3. Commit and push.
