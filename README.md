# IFC Viewer Component

This folder contains a standalone React component extracted from the project.
It is intended to be pushed to GitHub and reused in other apps.

## Quick Start (downloaded repos)

This project is typically used together with the demo app repo:

- `IFCViewerComponent` (this repo)
- `IFCViewerApp` (host app + backend/docker)

### Prerequisites

- Node.js + npm
- (Optional) Docker Desktop for `docker compose`

### 1. Clone both repositories (recommended side-by-side)

```powershell
git clone https://github.com/Korryan/IFCViewerComponent.git
git clone https://github.com/Korryan/IFCViewerApp.git
```

### 2. Install dependencies

PowerShell on Windows may block `npm.ps1`. If that happens, use `npm.cmd` (examples below use `npm.cmd`).

```powershell
v IFCViewerComponent
npm.cmd install

v IFCViewerApp\ifcViewer
npm.cmd install
```

### 3. Run the app (local dev)

```powershell
v IFCViewerApp\ifcViewer
npm.cmd run dev
```

### 4. Run the app (Docker, optional)

```powershell
v IFCViewerApp
docker compose up --build
```

## Using the component in the host app

The app can use the component directly from GitHub (pinned commit) or from a local folder.

### Option A: Install from GitHub (recommended for stable tests)

From `IFCViewerApp\ifcViewer`:

```powershell
npm.cmd install --save-exact --force ifc-viewer-component@github:Korryan/IFCViewerComponent#<COMMIT_SHA>
```

Then restart local dev server, or rebuild the frontend container:

```powershell
cd ..  # IFCViewerApp
docker compose build --no-cache frontend
docker compose up -d --force-recreate frontend
```

### Option B: Install from local component repo (recommended for development)

From `IFCViewerApp\ifcViewer` (assuming both repos are side-by-side):

```powershell
npm.cmd install --save-exact --force ..\..\IFCViewerComponent
```

If Vite keeps stale cached code after updating the component, restart with force:

```powershell
npm.cmd run dev -- --force
```

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
- This repo currently ships source files (`src/*`); the consuming app builds them during its own Vite build.

## Publishing

1. Create a new GitHub repo (empty).
2. Copy this folder into the repo root.
3. Commit and push.
