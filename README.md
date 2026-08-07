# Marlett Software 93

Personal site rebuilt on **Angular 22** with the Vite-based application builder, **Tailwind CSS 4**, and **Angular Material Icons**.

Live site: [jmarlett93.github.io/marlett-software-93](https://jmarlett93.github.io/marlett-software-93)

## Requirements

- Node `24.19+` (see `.nvmrc`)

## Develop

```bash
nvm use
npm start
```

## Build (GitHub Pages)

```bash
npm run build:pages
```

Builds with `--base-href /marlett-software-93/`, copies `404.html` for SPA routes, and flattens `docs/browser/` into `docs/` for GitHub Pages (`Settings → Pages → Deploy from branch → master → /docs`).

```bash
git add docs
git commit -m "Publish GitHub Pages build"
git push origin master
```

## Assets

Image and icon assets live in `public/assets/`.
