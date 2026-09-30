import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const tw = {
  content: ['./index.html', './src/**/*.js'],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        logo: ['Poppins', 'sans-serif'],
        cond: ['Oswald', 'Impact', 'sans-serif'],
      },
      colors: {
        night: '#07040f',
        'violet-vibe': '#a259ff',
        lbl: '#8f83bd',
        hint: '#6f649a',
      },
    },
  },
};

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss(tw), autoprefixer()] } },
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 700 },
  server: { host: true, port: 5173 },
});
