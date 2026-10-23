// Designs genau wie am PC (ThemeManager.cs). Standard: Design und Akzentfarbe kommen vom PC.

export const THEMES = {
  Orbit: { dark: true, bg: '#0A0A16', side: '#0D0D1C', surface: '#14142A', alt: '#1B1B36', border: '#272742', text: '#F2F2F8', muted: '#9C9CB6', accent: '#6366F1', grad: '#130F2E' },
  Hell: { dark: false, bg: '#F3F4F7', side: '#EBEDF2', surface: '#FFFFFF', alt: '#F2F4F7', border: '#E1E4EA', text: '#1B1F24', muted: '#5D6573', accent: '#2563EB' },
  Dunkel: { dark: true, bg: '#16171A', side: '#1C1D21', surface: '#23252A', alt: '#2C2F35', border: '#363940', text: '#ECEDEF', muted: '#A1A7B1', accent: '#4C8DFF' },
  Graphit: { dark: true, bg: '#1F2023', side: '#26272A', surface: '#2D2E32', alt: '#36373C', border: '#434449', text: '#E6E6E8', muted: '#9D9EA4', accent: '#8EA4C4' },
  Nord: { dark: true, bg: '#2E3440', side: '#2A2F3A', surface: '#3B4252', alt: '#434C5E', border: '#4C566A', text: '#ECEFF4', muted: '#A7B0C0', accent: '#88C0D0' },
  Sonnenuntergang: { dark: false, bg: '#FBF4EF', side: '#F6E8DF', surface: '#FFFFFF', alt: '#FAEEE7', border: '#EFD9CB', text: '#3A2722', muted: '#7D6158', accent: '#E4572E' },
  Wald: { dark: true, bg: '#17201B', side: '#1B2620', surface: '#212F28', alt: '#293A31', border: '#33473B', text: '#E7EFE9', muted: '#9DB3A5', accent: '#5DBB7E' },
};
export const ACCENTS = ['#2563EB', '#0EA5E9', '#14B8A6', '#22C55E', '#84CC16', '#EAB308', '#F97316', '#EF4444', '#EC4899', '#A855F7', '#6366F1', '#64748B'];

function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
function shift([r, g, b], a) {
  const ch = (v) => Math.round(Math.max(0, Math.min(255, a >= 0 ? v + (255 - v) * a : v * (1 + a))));
  return `rgb(${ch(r)},${ch(g)},${ch(b)})`;
}

/** Setzt alle Farben. name/accent: wie am PC; Fehlendes wird mit „Orbit“ aufgefüllt. */
export function applyDesign(name, accent) {
  const t = THEMES[name] || THEMES.Orbit;
  const a = rgb(/^#[0-9a-f]{6}$/i.test(accent || '') ? accent : t.accent);
  const s = document.documentElement.style;
  const set = (k, v) => s.setProperty(k, v);
  set('--bg', t.bg);
  set('--bg-grad', t.grad ? `linear-gradient(135deg, ${t.bg}, ${t.grad})` : t.bg);
  set('--side', t.side);
  set('--surface', t.surface);
  set('--alt', t.alt);
  set('--border', t.border);
  set('--text', t.text);
  set('--muted', t.muted);
  set('--accent', `rgb(${a.join(',')})`);
  set('--accent-hover', shift(a, t.dark ? 0.12 : -0.10));
  set('--accent-soft', `rgba(${a.join(',')},${t.dark ? 0.25 : 0.13})`);
  set('--accent-text', lum(a) > 0.55 ? '#101418' : '#FFFFFF');
  set('--ok', t.dark ? '#4ADE80' : '#16A34A');
  set('--warn', t.dark ? '#FBBF24' : '#D97706');
  set('--danger', t.dark ? '#F87171' : '#DC2626');
  set('--hover', t.dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.055)');
  set('--shadow', t.dark ? '0 6px 22px rgba(0,0,0,.35)' : '0 6px 22px rgba(64,72,96,.10)');
  document.documentElement.style.colorScheme = t.dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.side);
}
