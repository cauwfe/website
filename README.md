# ASCII koi pond homepage

A single-page site: one `index.html`, no build step, no dependencies.

## Edit
Open `index.html` and change the block between `EDIT YOUR CONTENT BELOW` (name, bio, links). Page `<title>` and meta description are at the top.

## Host on GitHub Pages
1. Create a repo (e.g. `yourname.github.io`) and push `index.html` (and `.nojekyll`) to the root of `main`.
2. Repo **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**.
3. Visit `https://yourname.github.io`. For a custom domain, add it under Pages and a `CNAME` file.

## Tweaks (top of the `<script>`)
- `FISH_COUNT` – number of koi
- `CS` in `resize()` – cell size in px
- `PAL` – colours for dark/light themes
