import { defineConfig } from 'vite';

// base: './' -> GitHub Pages 프로젝트 페이지(/<repo>/)에서도 경로가 깨지지 않음
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
});
