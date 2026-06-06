Personal Gravity Exhibition Viewer

This folder includes the HTML, compiled assets, and the 3D GLB model.

Do not open index.html by double-clicking it.
The 3D model may not load from a file:// URL because browsers block local model loading.

Mac:
1. Double-click start-mac.command.
2. If macOS blocks it, right-click start-mac.command and choose Open.
3. Open this URL:
   http://localhost:8080/

Windows:
1. Double-click start-windows.bat.
2. Open this URL:
   http://localhost:8080/

If port 8080 is already in use:
Mac:
python3 -m http.server 8090

Windows:
python -m http.server 8090

Then open:
http://localhost:8090/

Included:
- index.html
- assets/
- models/lg-0527-test.glb
