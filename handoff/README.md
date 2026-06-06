# Personal Gravity Detail Handoff

`personal-gravity-detail.html` contains only the inner/detail page without the home orbit page.

## 3D Mount Point

Mount the Three.js or React Three Fiber point-cloud scene into:

```html
<div id="point-cloud-stage" aria-label="3D point cloud room"></div>
```

The intended stage size is:

```css
#point-cloud-stage {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 46vw;
  height: 100vh;
}
```

In the current React project, this corresponds to the `Scene` and `PointCloudModel` components in `src/main.tsx` and `src/point-cloud-model.tsx`.
