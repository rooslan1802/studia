const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const path = require('path');

module.exports = defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')]
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, '../components'),
      '@pages': path.resolve(__dirname, '../pages')
    }
  }
});
