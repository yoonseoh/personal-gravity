# Point Cloud Exhibition Viewer

Interactive point-cloud viewer for the provided GLB model. The app samples the model surface into points and exposes exhibition-friendly controls for density, particle size, glow, and rotation speed.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

## Controls

- `Particle Size`: changes rendered point size.
- `Density`: changes visible point count with `BufferGeometry.setDrawRange`.
- `Glow`: controls postprocessing bloom intensity.
- `Rotation Speed`: controls automatic model rotation.
