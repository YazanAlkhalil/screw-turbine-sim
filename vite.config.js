export default {
  base: './', // relative asset paths, so the build works under /<repo>/ on GitHub Pages
  build: { chunkSizeWarningLimit: 1000 }, // three.js alone is ~600 kB
};
