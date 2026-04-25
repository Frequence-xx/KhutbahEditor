export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { 0: '#050810', 1: '#0C1118', 2: '#0F1721', 3: '#1A2332', 4: '#151c27' },
        border: { DEFAULT: '#1F2A38', strong: '#243242', slate: '#2D3E50' },
        text: { DEFAULT: '#E8E3D6', strong: '#F5E9C8', muted: '#6A7788', dim: '#A4AFC2' },
        amber: { DEFAULT: '#E8B73C', dark: '#C4932F', glow: '#F5E9C8' },
        green: { DEFAULT: '#7BA05B', light: '#9BC27A' },
        danger: { DEFAULT: '#d97757', muted: '#5a3a30' },
      },
      fontFamily: {
        display: ['Cinzel', 'Trajan Pro 3', 'serif'],
        body: ['Open Sans', 'system-ui', 'sans-serif'],
        arabic: ['Amiri', 'Noto Naskh Arabic', 'serif'],
      },
    },
  },
  plugins: [],
};
